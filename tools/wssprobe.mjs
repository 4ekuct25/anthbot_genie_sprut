#!/usr/bin/env node
/**
 * Проверяет, пускает ли AWS IoT наши временные креды по MQTT over WebSocket.
 *
 * Зачем: сейчас состояние косилки читается опросом раз в минуту. Push дало бы подписка на
 * shadow-топики, но для неё нужно MQTT-соединение, а plain MQTT с логином/паролем AWS IoT не
 * принимает — только mTLS с клиентским сертификатом (его у нас нет, он в прошивке косилки) либо
 * WebSocket с подписью SigV4. Вопрос, на который отвечает эта проба: разрешает ли политика,
 * привязанная к кредам из /iot/sts/arn, вообще подключаться и подписываться — или права выданы
 * только под HTTP-чтение shadow. Без ответа обсуждать MQTT-контроллер Sprut.Hub бессмысленно.
 *
 *   ANTHBOT_USER=... ANTHBOT_PASS=... ANTHBOT_AREA=49 node tools/wssprobe.mjs
 *
 * Ключи:
 *   --trigger   после подписки отправить get_all_props по HTTP и ждать push от косилки:
 *               это сквозная проверка, что подписка не только принята, но и доставляет
 *   --verbose   печатать пакеты MQTT
 *
 * ВАЖНО про clientId: подключаться идентификатором самой косилки нельзя. AWS IoT разрывает
 * прежнее соединение при подключении с тем же clientId — косилка потеряла бы связь с облаком.
 * Поэтому идентификатор заведомо свой (--sprut-probe-…), а отказ по политике из-за чужого
 * clientId сам по себе является ответом на вопрос.
 *
 * Подпись отличается от той, что использует сценарий: сервис iotdevicegateway (не iotdata),
 * параметры уезжают в query-строку, а X-Amz-Security-Token дописывается ПОСЛЕ подписи и в
 * канонический запрос не входит.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL_SOURCE = path.join(HERE, '..', 'AnthbotGenie', 'source', 'AnthbotGenie.Global.js');
const STATUS_MARKER = '\n<<<STATUS:';

const args = {
  trigger: process.argv.includes('--trigger'),
  verbose: process.argv.includes('--verbose'),
};

// --- синхронный HttpClient поверх curl: тот же shim, что в probe.mjs -------------------------

function curlSync(state) {
  const argv = ['-sS', '-X', state.method, '--max-time', '30'];
  for (const [name, value] of Object.entries(state.headers)) argv.push('-H', `${name}: ${value}`);
  if (state.body !== undefined) argv.push('--data-raw', state.body);
  argv.push('-w', `${STATUS_MARKER}%{http_code}>>>`, state.url);
  let raw;
  try {
    raw = execFileSync('curl', argv, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return { status: 0, body: String(e.message || e) };
  }
  const at = raw.lastIndexOf(STATUS_MARKER);
  if (at < 0) return { status: 0, body: raw };
  return {
    status: Number(raw.slice(at + STATUS_MARKER.length, raw.lastIndexOf('>>>'))),
    body: raw.slice(0, at),
  };
}

function makeRequest(method, url) {
  const state = { method, url: String(url), headers: {}, body: undefined };
  const request = {
    header(n, v) { state.headers[String(n)] = String(v); return request; },
    body(t) { state.body = String(t); return request; },
    timeout() { return request; },
    send() {
      const r = curlSync(state);
      return { getStatus: () => r.status, getBody: () => r.body };
    },
  };
  return request;
}

const HttpClient = { GET: (u) => makeRequest('GET', u), POST: (u) => makeRequest('POST', u) };

// --- пакеты MQTT 3.1.1 -----------------------------------------------------------------------

function remainingLength(n) {
  const out = [];
  let value = n;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    out.push(byte);
  } while (value > 0);
  return out;
}

function mqttString(text) {
  const bytes = Buffer.from(text, 'utf-8');
  return Buffer.concat([Buffer.from([bytes.length >> 8, bytes.length & 0xff]), bytes]);
}

function connectPacket(clientId, keepaliveSec) {
  const variable = Buffer.concat([
    mqttString('MQTT'),
    Buffer.from([0x04, 0x02, keepaliveSec >> 8, keepaliveSec & 0xff]), // level 4, clean session
  ]);
  const body = Buffer.concat([variable, mqttString(clientId)]);
  return Buffer.concat([Buffer.from([0x10, ...remainingLength(body.length)]), body]);
}

function subscribePacket(packetId, topic, qos) {
  const body = Buffer.concat([
    Buffer.from([packetId >> 8, packetId & 0xff]),
    mqttString(topic),
    Buffer.from([qos]),
  ]);
  // 0x82 = тип 8 (SUBSCRIBE) со старшими флагами 0b0010, обязательными по спецификации.
  // 0xA2 — это тип 10, UNSUBSCRIBE: с байтом QoS в payload пакет невалиден, и брокер молча
  // рвёт соединение. Отличить такой обрыв от отказа по политике по внешнему виду нельзя.
  return Buffer.concat([Buffer.from([0x82, ...remainingLength(body.length)]), body]);
}

const CONNACK_REASONS = {
  0: 'соединение принято',
  1: 'неподдерживаемая версия протокола',
  2: 'clientId отвергнут',
  3: 'сервер недоступен',
  4: 'неверные учётные данные',
  5: 'НЕ АВТОРИЗОВАН — политика не разрешает iot:Connect',
};

/** Разбирает поток MQTT-пакетов: возвращает список [{ type, ...поля }] и остаток буфера. */
function parsePackets(buffer) {
  const packets = [];
  let at = 0;
  while (at < buffer.length) {
    const first = buffer[at];
    let multiplier = 1;
    let length = 0;
    let cursor = at + 1;
    let byte;
    do {
      if (cursor >= buffer.length) return { packets, rest: buffer.slice(at) };
      byte = buffer[cursor++];
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
    } while ((byte & 0x80) !== 0);
    if (cursor + length > buffer.length) return { packets, rest: buffer.slice(at) };

    const body = buffer.slice(cursor, cursor + length);
    const type = first >> 4;
    if (type === 2) packets.push({ type: 'CONNACK', code: body[1] });
    else if (type === 9) packets.push({ type: 'SUBACK', code: body[2] });
    else if (type === 3) {
      const topicLength = (body[0] << 8) | body[1];
      const topic = body.slice(2, 2 + topicLength).toString('utf-8');
      const qos = (first >> 1) & 0x03;
      const payloadAt = 2 + topicLength + (qos > 0 ? 2 : 0);
      packets.push({ type: 'PUBLISH', topic, payload: body.slice(payloadAt).toString('utf-8') });
    } else packets.push({ type: `0x${type.toString(16)}` });
    at = cursor + length;
  }
  return { packets, rest: Buffer.alloc(0) };
}

// --- presigned URL для iotdevicegateway ------------------------------------------------------

function presignedWssUrl(sandbox, session) {
  const amzDate = sandbox.anthbotAmzDate();
  const dateStamp = amzDate.substring(0, 8);
  const service = 'iotdevicegateway';
  const scope = `${dateStamp}/${session.region}/${service}/aws4_request`;
  const encode = (value) => sandbox.anthbotUriEncode(String(value), true);

  // Параметры канонической query сортируются по имени; токен сессии сюда НЕ входит.
  const canonicalQuery =
    'X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    `&X-Amz-Credential=${encode(`${session.creds.accessKeyId}/${scope}`)}` +
    `&X-Amz-Date=${amzDate}` +
    '&X-Amz-SignedHeaders=host';

  const signed = sandbox.anthbotSigV4Authorization({
    method: 'GET',
    canonicalUri: '/mqtt',
    canonicalQuery,
    headers: { host: session.endpoint },
    payloadHash: sandbox.anthbotSha256Hex(''),
    amzDate,
    region: session.region,
    service,
    accessKeyId: session.creds.accessKeyId,
    secretAccessKey: session.creds.secretAccessKey,
  });

  return `wss://${session.endpoint}/mqtt?${canonicalQuery}` +
         `&X-Amz-Signature=${signed.signature}` +
         `&X-Amz-Security-Token=${encode(session.creds.sessionToken)}`;
}

// --- основной ход ----------------------------------------------------------------------------

const username = process.env.ANTHBOT_USER;
const password = process.env.ANTHBOT_PASS;
const areaCode = process.env.ANTHBOT_AREA;
if (!username || !password || !areaCode) {
  console.error('нужны ANTHBOT_USER, ANTHBOT_PASS, ANTHBOT_AREA');
  process.exit(1);
}

const sandbox = vm.createContext({ HttpClient, console });
vm.runInContext(fs.readFileSync(GLOBAL_SOURCE, 'utf-8'), sandbox, { filename: GLOBAL_SOURCE });

const session = {};
const ready = sandbox.anthbotEnsureSession(session, {
  username, password, areaCode, serialNumber: process.env.ANTHBOT_SN || '',
});
if (!ready.ok) {
  console.error(`сессия не собралась: ${ready.error}`);
  process.exit(1);
}
console.log(`Endpoint : ${session.endpoint}`);
console.log(`Регион   : ${session.region}`);

const url = presignedWssUrl(sandbox, session);
console.log(`URL      : wss://${session.endpoint}/mqtt?…подписан…`);

// clientId заведомо не совпадает с серийником: см. предупреждение в шапке.
const clientId = `sprut-probe-${process.pid}`;
const topic = `$aws/things/${session.sn}/shadow/name/property/update/accepted`;
console.log(`clientId : ${clientId} (не серийник — косилку не выбиваем)`);
console.log(`топик    : $aws/things/<SN>/shadow/name/property/update/accepted\n`);

const socket = new WebSocket(url, ['mqtt']);
socket.binaryType = 'arraybuffer';

let pending = Buffer.alloc(0);
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  console.log(`\n${message}`);
  try { socket.close(); } catch { /* уже закрыт */ }
  process.exit(code);
}

const deadline = setTimeout(() => finish(1, '⏱ время вышло — ответа не дождались'), 60000);
deadline.unref?.();

socket.addEventListener('open', () => {
  console.log('✓ WebSocket-рукопожатие принято — подпись SigV4 верна, IAM пропустил');
  socket.send(connectPacket(clientId, 30));
});

socket.addEventListener('error', () => {
  finish(1, '✗ соединение не установлено. 403 на рукопожатии означает, что SigV4 или права IAM ' +
            'отвергнуты — тогда MQTT недоступен независимо от возможностей хаба');
});

socket.addEventListener('close', (event) => {
  if (finished) return;
  finish(1, `✗ AWS закрыл соединение (код ${event.code}). На этом эндпоинте так выглядит отказ ` +
            'по политике: CONNACK/SUBACK не присылается, соединение просто рвётся');
});

socket.addEventListener('message', (event) => {
  pending = Buffer.concat([pending, Buffer.from(event.data)]);
  const { packets, rest } = parsePackets(pending);
  pending = rest;

  for (const packet of packets) {
    if (args.verbose) console.log(`  ← ${JSON.stringify(packet).slice(0, 200)}`);

    if (packet.type === 'CONNACK') {
      const reason = CONNACK_REASONS[packet.code] || `код ${packet.code}`;
      if (packet.code !== 0) finish(1, `✗ CONNACK: ${reason}`);
      console.log(`✓ CONNACK: ${reason} — iot:Connect разрешён`);
      socket.send(subscribePacket(1, topic, 1));
    }

    if (packet.type === 'SUBACK') {
      if (packet.code === 0x80) {
        finish(1, '✗ SUBACK: подписка отклонена — политика не даёт iot:Subscribe на shadow-топик');
      }
      console.log(`✓ SUBACK: подписка принята (QoS ${packet.code}) — iot:Subscribe разрешён`);
      if (!args.trigger) {
        finish(0, '✓ ИТОГ: MQTT-подписка возможна. Ждём push косилки (--trigger, чтобы вызвать)');
      }
      console.log('  → шлю get_all_props по HTTP, жду push…');
      const sent = sandbox.anthbotSendCommand(session, 'get_all_props', 1);
      if (!sent.ok) finish(1, `✗ команду отправить не удалось: ${sent.error}`);
    }

    if (packet.type === 'PUBLISH') {
      console.log(`✓ PUBLISH получен, ${packet.payload.length} байт полезной нагрузки`);
      finish(0, '✓ ИТОГ: push работает end-to-end — подписка доставляет состояние без опроса');
    }
  }
});
