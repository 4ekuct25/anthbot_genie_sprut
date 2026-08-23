/**
 * Логический сценарий: опрос облака → характеристики и характеристики → команды косилке.
 *
 * Тесты написаны от README сценария: каждый it проверяет обещание, данное пользователю
 * («кнопка на базу отправляет charge_start и сама отжимается»), а не текущую реализацию.
 */

const API = 'https://api.anthbot.com';
const ENDPOINT = 'a2bhy9nr7jkgaj-ats.iot.eu-central-1.amazonaws.com';
const SHADOW_URL = `https://${ENDPOINT}/things/GN800TEST01/shadow`;
const SN = 'GN800TEST01';

const OPTIONS = {
  username: 'user@example.com',
  password: 'secret',
  areaCode: '7',
  serialNumber: '',
  pollIntervalSec: 60,
  commandViaShadow: false,
  valueInName: true,
  debug: false,
};

// Форма ответа — как у живой Genie 800 (снято через tools/probe.mjs), значения тестовые.
const REPORTED = {
  online: 1,
  robot_sta: { value: 'globalmowing' },
  elec: 64,
  volume: 40,
  rain_switch: 1,
  rain_continue_time: 10800,
  param_set: { cutter_height: 45, mow_head: 30, enable_adaptive_head: 0, nest_switch: 1, rid_switch: 0 },
  nest_param_set: { cutter_height: 40, mow_count: 2, pobctl_switch: 1, pobctl_level: 2 },
  err_code: 0,
  sta_ip_addr: '192.168.1.50',
  sta_ssid: 'Garden',
  rtk_state: 1,
  map_area: 320,
  map_sta: { value: 'idle' },
  fw_version: { system_version: '1.19.21' },
  mowing_time_new: { value: 1500 },
  mowing_area_new: { value: 110 },
};

const AREA = {
  custom_areas: [
    { id: 100, name: 'Перед домом' },
    { id: 101, name: 'За домом' },
  ],
  // У Genie 800 авто-зона задана одной точкой в полях x/y, без списка points
  region_areas: [
    { id: 0, name: 'Клумба', x: 1, y: 2 },
  ],
};

function envelope(data) {
  return { status: 200, body: JSON.stringify({ code: 0, msg: 'ok', data: data }) };
}

/** Полный успешный контур облака: логин, устройство, креды, shadow, разметка. */
function mockCloud(http, reported, area) {
  http.mock.onPost(`${API}/api/v1/login`, envelope({ access_token: 'ACCESS1' }));
  http.mock.onGet(`${API}/api/v1/device/bind/list`,
    envelope([{ sn: SN, alias: 'Косилка', category_id: 'Genie 800', is_owner: 1 }]));
  http.mock.onGet(`${API}/api/v1/device/v2/region`,
    envelope({ region_name: 'eu-central-1', iot_endpoint: ENDPOINT }));
  http.mock.onPost(`${API}/api/v1/device/v2/iot/sts/arn`, envelope({
    access_key_id: 'ASIATEST', secret_access_key: 'secret', session_token: 'token',
    region_name: 'eu-central-1', endpoint: ENDPOINT, expiration: 3600,
  }));
  http.mock.onGet(`${API}/api/v1/device/v2/presigned_url`,
    envelope({ presigned_url: 'https://s3.example.com/area.txt' }));
  http.mock.onGet('https://s3.example.com/area.txt',
    { status: 200, body: JSON.stringify(area || AREA) });
  http.mock.onGet(SHADOW_URL, {
    status: 200,
    body: JSON.stringify({ state: { reported: reported || REPORTED } }),
  });
  http.mock.onPost(SHADOW_URL, { status: 200, body: '{}' });
  http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });
}

/** Виртуальный аксессуар косилки: сервисы помечены ключами, как требует README. */
function addMower(hub) {
  return hub.addAccessory({
    id: 42,
    name: 'Газонокосилка',
    room: 'Двор',
    services: [
      { type: HS.Switch, name: 'Кошение mow', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'На базу dock', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.BatteryService, name: 'Заряд battery', characteristics: [
        { type: HC.BatteryLevel, value: 0 },
        { type: HC.ChargingState, value: 0 },
        { type: HC.StatusLowBattery, value: 0 },
      ] },
      { type: HS.C_Option, name: 'Статус status', characteristics: [{ type: HC.C_String, value: '' }] },
      { type: HS.C_Option, name: 'Высота кошения height', characteristics: [{ type: HC.C_Integer, value: 0 }] },
      { type: HS.C_Option, name: 'Громкость volume', characteristics: [{ type: HC.C_Integer, value: 0 }] },
      { type: HS.C_Option, name: 'Пауза после дождя raintime', characteristics: [{ type: HC.C_Integer, value: 0 }] },
      { type: HS.Switch, name: 'Датчик дождя rain', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Кошение у базы nest', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.C_Option, name: 'Ошибка error', characteristics: [{ type: HC.C_String, value: '' }] },
      { type: HS.C_Option, name: 'IP ip', characteristics: [{ type: HC.C_String, value: '' }] },
      { type: HS.C_Option, name: 'Прошивка fw', characteristics: [{ type: HC.C_String, value: '' }] },
      { type: HS.C_Option, name: 'Карта mapstate', characteristics: [{ type: HC.C_String, value: '' }] },
      { type: HS.C_Option, name: 'Площадь карты maparea', characteristics: [{ type: HC.C_Integer, value: 0 }] },
      { type: HS.C_Option, name: 'Время задания time', characteristics: [{ type: HC.C_Integer, value: 0 }] },
      { type: HS.Switch, name: 'Зона 1 zone1', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Зона 2 zone2', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Зона 3 zone3', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Авто-зона 1 azone1', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Авто-зона 2 azone2', characteristics: [{ type: HC.On, value: false }] },
      { type: HS.Switch, name: 'Без метки', characteristics: [{ type: HC.On, value: false }] },
    ],
  });
}

/** Сервис по ключу — так же, как его ищет сценарий. */
function serviceByKey(mower, key) {
  const services = mower.getServices();
  for (const service of services) {
    if (String(service.getName()).split(/\s+/).pop() === key) return service;
  }
  return null;
}

function charByKey(mower, key, type) {
  const service = serviceByKey(mower, key);
  return service ? service.getCharacteristic(type) : null;
}

/** Команды, ушедшие косилке любым из путей доставки. */
function sentCommands(http) {
  return http.requests
    .filter((r) => r.method === 'POST' &&
      (r.url.indexOf('/topics/') >= 0 || r.url.indexOf(`${ENDPOINT}/things/`) >= 0))
    .map((r) => JSON.parse(r.body).state.desired);
}

function shadowReads(http) {
  return http.requests.filter((r) => r.method === 'GET' && r.url.indexOf('/shadow?name=property') >= 0);
}

/**
 * Запускает сценарий и доводит его до первого выполненного опроса.
 *
 * firstActive / nextActive — состав задания (active_area) на первом опросе и на всех следующих;
 * задаются только теми тестами, которым нужна смена задания на ходу, остальные мокают облако сами.
 * extra — что подмешать в ответ облака (например robot_sta: косилка на базе).
 *
 * Смена задания сделана счётчиком ответов, а НЕ через http.reset() с повторным mockCloud:
 * reset сносит и логин с разметкой, следующий опрос падает в «Нет связи» и до характеристик не
 * доходит — проверка тогда проходит по пустой причине, ничего не проверив.
 */
function startScenario(ctx, options, firstActive, nextActive, extra) {
  const { hub, scenario, time } = ctx;
  if (nextActive) {
    // Правило-счётчик регистрируем ПЕРВЫМ: матчер отдаёт первое подошедшее
    let reads = 0;
    ctx.http.mock.on((req) => {
      if (req.method !== 'GET' || req.url.indexOf('/shadow?name=property') < 0) return false;
      reads += 1;
      return reads > 1;
    }, {
      status: 200,
      body: JSON.stringify({
        state: {
          reported: Object.assign({}, REPORTED, extra || {}, { active_area: { id: nextActive } }),
        },
      }),
    });
  }
  if (firstActive) {
    mockCloud(ctx.http,
      Object.assign({}, REPORTED, extra || {}, { active_area: { id: firstActive } }));
  }
  const mower = addMower(hub);
  const variables = {};
  const opts = Object.assign({}, OPTIONS, options || {});
  scenario.run({
    source: mower.char(HS.Switch, HC.On),
    value: false,
    variables,
    options: opts,
    context: 'HUB[OnStart]',
  });
  time.advance('1s');
  return { mower, variables, options: opts };
}

/**
 * Тот же запуск, но косилка стоит на базе: только из этого состояния пользователь может
 * осмысленно нажать «косить». Стартовать из уже включённого кошения нельзя —
 * повторная запись того же значения и есть эхо, которое сценарий обязан игнорировать.
 */
function startDocked(ctx, options) {
  mockCloud(ctx.http, Object.assign({}, REPORTED, { robot_sta: { value: 'charge' } }));
  const started = startScenario(ctx, options);
  ctx.http.reset();
  mockCloud(ctx.http, Object.assign({}, REPORTED, { robot_sta: { value: 'charge' } }));
  return started;
}

describe('AnthbotGenie — опрос облака', () => {
  it('поднимает ровно один таймер опроса, сколько бы раз ни сработал trigger', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);

    // Пересохранение сценария и старт хаба переигрывают характеристики пачкой
    for (let i = 0; i < 5; i++) {
      ctx.scenario.run({
        source: mower.char(HS.Switch, HC.On), value: false, variables, options,
        context: 'HUB[OnStart]',
      });
    }

    expect(ctx.time.pendingCount()).toBe(1);
    expect(variables.pollTask).toBeDefined();
  });

  it('собственная запись сценария таймер опроса не пересоздаёт', (ctx) => {
    // Хаб тянет цепочку причин сквозь таймеры. Таймер, поставленный из trigger'а, который сам
    // поднят нашей же записью в [mow], наследует эту цепочку — и она удлиняется на «LOGIC ← C»
    // каждый опрос, пока хаб не оборвёт её на 32 звеньях. На живом хабе 22.08.2026 это дало
    // «Max call stack size exceeded (32)» раз в минуту и карточку, застывшую на одном статусе.
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    const armedAt = variables.pollArmedAtMs;

    // Дольше дебаунса переармирования (10 с) — иначе он скроет ошибку
    ctx.time.advance('61s');
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'LOGIC[5] <- C[42.1.1] <- LOGIC[5]',
    });

    expect(variables.pollArmedAtMs).toBe(armedAt);
    expect(ctx.time.pendingCount()).toBe(1);
  });

  it('действие пользователя таймер опроса переармирует', (ctx) => {
    // Обратная сторона проверки выше: заперев переармирование целиком, легко получить сценарий,
    // который после первого же собственного опроса перестаёт реагировать на смену настроек.
    const { mower, variables, options } = startDocked(ctx);
    const armedAt = variables.pollArmedAtMs;

    ctx.time.advance('61s');
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(variables.pollArmedAtMs).toBeGreaterThan(armedAt);
  });

  it('первый опрос раскладывает состояние косилки по характеристикам', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'status', HC.C_String).getValue()).toBe('Косит весь газон');
    expect(charByKey(mower, 'mow', HC.On).getValue()).toBe(true);
    expect(charByKey(mower, 'battery', HC.BatteryLevel).getValue()).toBe(64);
    expect(charByKey(mower, 'height', HC.C_Integer).getValue()).toBe(45);
    expect(charByKey(mower, 'volume', HC.C_Integer).getValue()).toBe(40);
    expect(charByKey(mower, 'rain', HC.On).getValue()).toBe(true);
    expect(charByKey(mower, 'raintime', HC.C_Integer).getValue()).toBe(3);
    expect(charByKey(mower, 'nest', HC.On).getValue()).toBe(true);
    expect(charByKey(mower, 'error', HC.C_String).getValue()).toBe('Нет ошибок');
    expect(charByKey(mower, 'ip', HC.C_String).getValue()).toBe('192.168.1.50');
    expect(charByKey(mower, 'fw', HC.C_String).getValue()).toBe('1.19.21');
    expect(charByKey(mower, 'mapstate', HC.C_String).getValue()).toBe('idle');
  });

  it('наработка сессии показывается в минутах, а косилка отдаёт секунды', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'time', HC.C_Integer).getValue()).toBe(25);
  });

  it('низкий заряд поднимает признак StatusLowBattery, зарядка — ChargingState', (ctx) => {
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      robot_sta: { value: 'charge' }, elec: { value: 15 },
    }));
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'battery', HC.StatusLowBattery).getValue()).toBe(1);
    expect(charByKey(mower, 'battery', HC.ChargingState).getValue()).toBe(1);
    expect(charByKey(mower, 'mow', HC.On).getValue()).toBe(false);
    expect(charByKey(mower, 'status', HC.C_String).getValue()).toBe('На зарядке');
  });

  it('косилка вне сети помечается в статусе, а не обнуляет показания', (ctx) => {
    mockCloud(ctx.http, Object.assign({}, REPORTED, { online: 0 }));
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'status', HC.C_String).getValue()).toContain('Недоступна');
    expect(charByKey(mower, 'battery', HC.BatteryLevel).getValue()).toBe(64);
  });

  it('опрос повторяется с заданным периодом', (ctx) => {
    mockCloud(ctx.http);
    startScenario(ctx, { pollIntervalSec: 30 });
    const afterFirst = shadowReads(ctx.http).length;

    ctx.time.advance('30s');
    ctx.time.advance('30s');

    expect(afterFirst).toBe(1);
    expect(shadowReads(ctx.http)).toHaveLength(3);
  });

  it('403 от AWS обновляет временные креды и повторяет запрос', (ctx) => {
    // Правило-отказ регистрируем ПЕРВЫМ: матчер отдаёт первое подошедшее,
    // поэтому иначе успешный ответ из mockCloud перекрыл бы отказ.
    let shadowCalls = 0;
    ctx.http.mock.on((req) => {
      if (req.method !== 'GET' || req.url.indexOf('/shadow?name=property') < 0) return false;
      shadowCalls += 1;
      return shadowCalls === 1; // так выглядит истёкший session token
    }, { status: 403, body: 'ExpiredTokenException' });
    mockCloud(ctx.http);

    const { mower } = startScenario(ctx);

    const stsCalls = ctx.http.requests.filter((r) => r.url.indexOf('/iot/sts/arn') >= 0);
    expect(stsCalls).toHaveLength(2);
    expect(charByKey(mower, 'status', HC.C_String).getValue()).toBe('Косит весь газон');
  });

  it('недоступное облако попадает в статус и предупреждение в логе — один раз', (ctx) => {
    ctx.http.mock.onPost(`${API}/api/v1/login`, { status: 500, body: 'oops' });
    const { mower } = startScenario(ctx);

    ctx.time.advance('60s');
    ctx.time.advance('60s');

    expect(charByKey(mower, 'status', HC.C_String).getValue()).toContain('Нет связи');
    expect(ctx.logs.byLevel('warn')).toHaveLength(1);
  });

  it('без логина и пароля сценарий не ходит в сеть', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx, { username: '', password: '' });

    expect(ctx.http.requests).toHaveLength(0);
    expect(charByKey(mower, 'status', HC.C_String).getValue()).toContain('логин');
  });
});

describe('AnthbotGenie — команды косилке', () => {
  it('включение [mow] будит приложение и запускает кошение', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    const on = charByKey(mower, 'mow', HC.On);
    ctx.scenario.run({ source: on, value: true, variables, options, context: 'C[42.1.1] <- WEB[user]' });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'app_state', data: 1 },
      { cmd: 'mow_start', data: 1 },
    ]);
  });

  it('выключение [mow] останавливает задачи', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: false, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([{ cmd: 'stop_all_tasks', data: 1 }]);
  });

  it('[dock] отправляет возврат на базу и сама отжимается', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    const dock = charByKey(mower, 'dock', HC.On);
    dock.setValueSilent(true);
    ctx.scenario.run({ source: dock, value: true, variables, options, context: 'C[42.2.1] <- WEB[user]' });

    expect(sentCommands(ctx.http)[0]).toEqual({ cmd: 'charge_start', data: 1 });
    expect(dock.getValue()).toBe(true);
    ctx.time.advance('3s');
    expect(dock.getValue()).toBe(false);
  });

  it('высота кошения уходит вместе с rid_switch, как ждёт облако', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'height', HC.C_Integer), value: 55, variables, options,
      context: 'C[42.5.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'param_set', data: { cutter_height: 55, rid_switch: 0 } },
    ]);
  });

  it('изменение соседнего сервиса доходит через подписку, а не только через trigger', (ctx) => {
    // Логика в хабе привязана к одному сервису; остальные сценарий слушает сам.
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    // Пользователь крутит громкость в интерфейсе хаба — trigger для этого сервиса не вызывается
    charByKey(mower, 'volume', HC.C_Integer).setValue(70);

    expect(sentCommands(ctx.http)).toEqual([{ cmd: 'volume_ctl', data: { volume: 70 } }]);
  });

  it('подписка не дублирует команду для сервиса, к которому привязана логика', (ctx) => {
    // Без лишнего mockCloud до startDocked: правила матчера копятся, и первое
    // зарегистрированное (косилка косит) перекрыло бы состояние «на базе».
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    // Ровно две команды старта, а не четыре
    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'app_state', data: 1 },
      { cmd: 'mow_start', data: 1 },
    ]);
  });

  it('собственная запись сценария не превращается в команду через подписку', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    // Опрос пишет громкость сам — это эхо, а не действие пользователя
    ctx.time.advance('60s');

    expect(sentCommands(ctx.http)).toHaveLength(0);
    expect(charByKey(mower, 'volume', HC.C_Integer).getValue()).toBe(40);
  });

  it('пауза после дождя переводится из часов в секунды и сохраняет состояние датчика', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'raintime', HC.C_Integer), value: 5, variables, options,
      context: 'C[42.7.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'ctl_rainer', data: { switch: 1, continue_time: 18000 } },
    ]);
  });

  it('включение кошения у базы идёт отдельной командой param_set', (ctx) => {
    // Проверено на живой Genie 800: сам переключатель живёт в param_set,
    // а остальные настройки базы — в nest_param_set, который шлётся целиком.
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'nest', HC.On), value: false, variables, options,
      context: 'C[42.9.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([{ cmd: 'param_set', data: { nest_switch: 0 } }]);
  });

  it('после команды запрашивается свежее состояние, а не ждётся следующий опрос', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });
    const beforeRefresh = shadowReads(ctx.http).length;
    ctx.time.advance('2s');

    const refreshSent = sentCommands(ctx.http)
      .filter((c) => c.cmd === 'get_all_props' && c.data === 1);
    expect(beforeRefresh).toBe(0);
    expect(refreshSent).toHaveLength(1);
    expect(shadowReads(ctx.http)).toHaveLength(1);
  });

  it('непринятая косилкой настройка попадает в лог, а не теряется молча', (ctx) => {
    // Формы команд восстановлены реверсом и для разных моделей отличаются: настройка,
    // которую облако приняло, но косилка не применила, обязана быть видна.
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'height', HC.C_Integer), value: 55, variables, options,
      context: 'C[42.5.1] <- WEB[user]',
    });
    ctx.time.advance('2s'); // облако продолжает отдавать прежние 45 мм

    const warnings = ctx.logs.byLevel('warn').filter((e) => String(e.message).indexOf('[height]') >= 0);
    expect(warnings).toHaveLength(1);
  });

  it('принятая настройка молчит', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    // http.reset() чистит только историю запросов; правила надо снимать отдельно,
    // иначе прежний ответ (45 мм) так и останется первым подходящим.
    ctx.http.mock.reset();
    ctx.http.reset();
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      param_set: Object.assign({}, REPORTED.param_set, { cutter_height: 55 }),
    }));

    ctx.scenario.run({
      source: charByKey(mower, 'height', HC.C_Integer), value: 55, variables, options,
      context: 'C[42.5.1] <- WEB[user]',
    });
    ctx.time.advance('2s');

    expect(ctx.logs.byLevel('warn')).toHaveLength(0);
    expect(charByKey(mower, 'height', HC.C_Integer).getValue()).toBe(55);
  });

  it('команды по умолчанию публикуются в топик — только их косилка исполняет', (ctx) => {
    // Проверено на живой Genie 800: UpdateThingShadow облако принимает (200), но косилка
    // настройку не применяет; публикация в топик применяется за 5 секунд.
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    const topicRequests = ctx.http.requests.filter((r) => r.url.indexOf('/topics/') >= 0);
    expect(topicRequests).toHaveLength(2);
    expect(topicRequests[0].url).toBe(
      `https://${ENDPOINT}/topics/%24aws%2Fthings%2F${SN}%2Fshadow%2Fname%2Fservice%2Fupdate`);
  });

  it('запасной путь пишет в shadow, если так задано опцией', (ctx) => {
    const { mower, variables, options } = startDocked(ctx, { commandViaShadow: true });

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    const shadowWrites = ctx.http.requests.filter(
      (r) => r.method === 'POST' && r.url.indexOf('/shadow?name=service') >= 0);
    expect(shadowWrites).toHaveLength(2);
    expect(ctx.http.requests.filter((r) => r.url.indexOf('/topics/') >= 0)).toHaveLength(0);
  });

  it('403 на публикации перебирает варианты подписи пути и запоминает рабочий', (ctx) => {
    // HTTP-клиент хаба может нормализовать %24/%2F в пути — тогда подпись не сойдётся,
    // и единственный признак этого — стабильный 403 при живых кредах.
    ctx.http.mock.on((req) => req.method === 'POST' && req.url.indexOf('/topics/') >= 0 &&
      req.url.indexOf('%24aws') >= 0, { status: 403, body: 'SignatureDoesNotMatch' });
    ctx.http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    // Вариант 2 шлёт сырой путь топика — он и должен остаться запомненным
    expect(variables.topicMode).toBe(2);
    const accepted = ctx.http.requests.filter(
      (r) => r.url.indexOf('/topics/$aws/things/') >= 0);
    expect(accepted.length).toBeGreaterThan(0);
  });

  it('после отказа нулевого варианта перебор не делает лишних попыток', (ctx) => {
    // Перебор состоит из двух вариантов: 0 и 2. Любой лишний запрос с закодированным путём
    // означал бы, что вернулась изъятая промежуточная форма (бывший вариант 1), — а она даёт
    // 403 на живом AWS и стоит круга ожидания сети на каждой команде.
    ctx.http.mock.on((req) => req.method === 'POST' && req.url.indexOf('/topics/') >= 0 &&
      req.url.indexOf('%24aws') >= 0, { status: 403, body: 'SignatureDoesNotMatch' });
    ctx.http.mock.onPost(/\/topics\//, { status: 200, body: '{}' });
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    // Две попытки с закодированным путём — вариант 0 и он же после переполучения кредов.
    // Третья означала бы вклинившуюся промежуточную форму.
    const encoded = ctx.http.requests.filter(
      (r) => r.url.indexOf('/topics/') >= 0 && r.url.indexOf('%24aws') >= 0);
    expect(encoded).toHaveLength(2);
  });
});

describe('AnthbotGenie — что командой НЕ считается', () => {
  it('собственная запись сценария не превращается в команду', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    // Опрос только что записал в [mow] значение true — хаб переигрывает его обратно в сценарий
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'LOGIC[5] <- C[42.1.1] <- LOGIC[5]',
    });

    expect(sentCommands(ctx.http)).toHaveLength(0);
  });

  it('старт хаба не отправляет команд', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'HUB[OnStart]',
    });

    expect(sentCommands(ctx.http)).toHaveLength(0);
  });

  it('ключ читается и со скобками, и без них — хаб скобки из имени вырезает', (ctx) => {
    mockCloud(ctx.http);
    const { hub, scenario, time } = ctx;
    // Пользователь мог назвать сервис по README со скобками; хаб сохранит его без них
    const mower = hub.addAccessory({
      id: 77, name: 'Косилка 2', room: 'Двор',
      services: [
        { type: HS.Switch, name: 'Кошение [mow]', characteristics: [{ type: HC.On, value: false }] },
        { type: HS.C_Option, name: 'Статус status', characteristics: [{ type: HC.C_String, value: '' }] },
      ],
    });
    const variables = {};

    scenario.run({
      source: mower.char(HS.Switch, HC.On), value: false, variables,
      options: Object.assign({}, OPTIONS), context: 'HUB[OnStart]',
    });
    time.advance('1s');

    // Оба сервиса найдены: статус заполнен, кошение отражает состояние косилки
    expect(mower.getService(HS.C_Option).getCharacteristic(HC.C_String).getValue())
      .toBe('Косит весь газон');
    expect(mower.char(HS.Switch, HC.On).getValue()).toBe(true);
  });

  it('сервис без метки в имени игнорируется', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    const unmarked = mower.getServices().filter((s) => String(s.getName()) === 'Без метки')[0];
    ctx.scenario.run({
      source: unmarked.getCharacteristic(HC.On), value: true, variables, options,
      context: 'C[42.16.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toHaveLength(0);
  });

  it('кнопки зон показывают состав задания косилки', (ctx) => {
    // active_area — зоны задания, а не набор зон карты: замер на живой Genie 800 23.08.2026.
    // Здесь на карте две зоны (100 «Перед домом», 101 «За домом»), в задании одна.
    mockCloud(ctx.http, Object.assign({}, REPORTED, { active_area: { id: [101] } }));
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(false);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);
  });

  it('пустой список зон отметку не стирает', (ctx) => {
    // Зонального задания не было ни разу — это не то же самое, что «ничего не выбрано»,
    // и затирать по нему выбор владельца хаба нельзя
    mockCloud(ctx.http, Object.assign({}, REPORTED, { active_area: { id: [] } }));
    const { mower } = startScenario(ctx);
    charByKey(mower, 'zone1', HC.On).setValue(true);

    ctx.time.advance('61s');

    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(true);
  });

  it('отметка человека несколько минут главнее облака', (ctx) => {
    // Список задания переживает его завершение, поэтому на базе косилка отдаёт состав
    // ПРОШЛОГО задания. Без окна защиты первый же опрос вернул бы старые зоны поверх
    // новых отметок, и собрать выбор было бы нельзя в принципе.
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      robot_sta: { value: 'charge' }, active_area: { id: [101] },
    }));
    const { mower, variables, options } = startScenario(ctx);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);

    // Нажатие в интерфейсе — это запись значения плюс вызов сценария
    charByKey(mower, 'zone1', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'zone1', HC.On), value: true, variables, options,
      context: 'C[42.14.1] <- WEB[user]',
    });
    ctx.time.advance('61s');

    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(true);
  });

  it('после «Кошение» новое задание ложится в кнопки, не дожидаясь окна защиты', (ctx) => {
    // Нажатие расходует выбор: окно снимается, и следующее задание косилки применяется сразу,
    // а не через пять минут. Прежний состав при этом отметку не трогает — соседний тест.
    // Стартуем с базы: если косилка уже косит, опрос сам записал mow=true, и «нажатие»
    // сценарий примет за эхо — команда не уйдёт, а окно защиты не снимется
    const { mower, variables, options } =
      startScenario(ctx, {}, [100], [101], { robot_sta: { value: 'charge' } });
    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(true);

    // Человек добавляет вторую зону и запускает кошение
    charByKey(mower, 'zone2', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'zone2', HC.On), value: true, variables, options,
      context: 'C[42.15.1] <- WEB[user]',
    });
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    ctx.time.advance('61s');

    // Косилка сообщила другое задание — оно и в кнопках, без пятиминутной паузы
    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(false);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);
  });

  it('прежний состав задания отметку не воскрешает', (ctx) => {
    // Поймано на живом хабе 23.08.2026. Владелец гасит зону, отмечает авто-зону и жмёт
    // «Кошение» — окно защиты снимается, выбор израсходован. Но active_area авто-задание не
    // отражает, и ближайший опрос зажигал ручную зону обратно, к делу отношения не имеющую.
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      robot_sta: { value: 'charge' }, active_area: { id: [101] },
    }));
    const { mower, variables, options } = startScenario(ctx);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);

    // Человек гасит зону вручную
    charByKey(mower, 'zone2', HC.On).setValue(false);
    ctx.scenario.run({
      source: charByKey(mower, 'zone2', HC.On), value: false, variables, options,
      context: 'C[42.15.1] <- WEB[user]',
    });

    // Ждём заведомо дольше окна защиты (5 минут): дальше отметку держит уже не оно
    for (let i = 0; i < 7; i++) ctx.time.advance('61s');

    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(false);
  });

  it('новое задание косилки подсветку обновляет', (ctx) => {
    // Обратная сторона проверки выше: заперев перезапись совсем, получим кнопки, навсегда
    // застывшие на первом опросе
    const { mower } = startScenario(ctx, {}, [101], [100]);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);

    ctx.time.advance('61s');

    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(true);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(false);
  });

  it('перестановка тех же зон новым заданием не считается', (ctx) => {
    // Косилка отдаёт идентификаторы в произвольном порядке — на живой Genie 800 один и тот же
    // набор приходил и как [102,103,104,100,101], и как [105,101,100,102,103,104].
    // Без сортировки в отпечатке перестановка выглядела бы новым заданием и затирала выбор.
    const { mower } = startScenario(ctx, {}, [100, 101], [101, 100]);
    charByKey(mower, 'zone1', HC.On).setValue(false);

    // Дольше окна защиты: запись характеристики доходит до сценария через подписку и сама
    // взводит окно, поэтому короткого ожидания хватило бы и старому коду — проверка была бы
    // пустой. Держать отметку дальше может только отпечаток состава.
    for (let i = 0; i < 7; i++) ctx.time.advance('61s');

    expect(charByKey(mower, 'zone1', HC.On).getValue()).toBe(false);
  });

  it('косимая авто-зона определяется по ближайшему якорю', (ctx) => {
    // Прямого ответа «какая авто-зона» облако не даёт: active_area авто-задания не отражает,
    // а region_area.points сообщает точку, которая с якорем в разметке не совпадает —
    // на живой Genie 800 расхождение было 4,8 и 20,2 метра у двух зон.
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      mow_region: 1, region_area: { points: [[2380, -8129]] },
    }), {
      custom_areas: [{ id: 100, name: 'Перед домом' }],
      region_areas: [
        { id: 0, name: 'Клумба', x: 2469, y: -12965 },
        { id: 1, name: 'Дальняя', x: 28004, y: -10503 },
      ],
    });
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'azone1', HC.On).getValue()).toBe(true);
    expect(charByKey(mower, 'azone2', HC.On).getValue()).toBe(false);
  });

  it('две почти одинаково близкие авто-зоны не подсвечиваются вовсе', (ctx) => {
    // Якорь в разметке и точка задания расходятся на метры, поэтому «ближайший» — догадка.
    // На соседних зонах она ошибётся, а подсветить не ту хуже, чем не подсветить.
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      mow_region: 1, region_area: { points: [[2380, -8129]] },
    }), {
      custom_areas: [{ id: 100, name: 'Перед домом' }],
      region_areas: [
        { id: 0, name: 'Клумба', x: 2469, y: -12965 },
        { id: 1, name: 'Рядом', x: 2469, y: -16000 },
      ],
    });
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'azone1', HC.On).getValue()).toBe(false);
    expect(charByKey(mower, 'azone2', HC.On).getValue()).toBe(false);
  });

  it('точка прошлого авто-задания подсветку не зажигает', (ctx) => {
    // region_area.points, как и active_area, переживает завершение задания. Признак
    // «идёт авто-задание» — это mow_region, иначе кнопка горела бы вечно после первого раза.
    mockCloud(ctx.http, Object.assign({}, REPORTED, {
      mow_region: 0, region_area: { points: [[2380, -8129]] },
    }), {
      custom_areas: [{ id: 100, name: 'Перед домом' }],
      region_areas: [{ id: 0, name: 'Клумба', x: 2469, y: -12965 }],
    });
    const { mower } = startScenario(ctx);

    expect(charByKey(mower, 'azone1', HC.On).getValue()).toBe(false);
  });

  it('подсветка зон командой косилке не становится', (ctx) => {
    // Кнопки зон команд не порождают, но пишет их теперь опрос — а любая запись
    // возвращается в сценарий через подписку. Приняв её за нажатие, сценарий отправил бы
    // задание, которого никто не заказывал.
    mockCloud(ctx.http, Object.assign({}, REPORTED, { active_area: { id: [100, 101] } }));
    startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http, Object.assign({}, REPORTED, { active_area: { id: [100, 101] } }));

    ctx.time.advance('61s');

    expect(sentCommands(ctx.http)).toHaveLength(0);
  });

  it('высота вне диапазона обрезается, и хаб сразу показывает исправленное', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'height', HC.C_Integer), value: 120, variables, options,
      context: 'C[42.5.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'param_set', data: { cutter_height: 70, rid_switch: 0 } },
    ]);
    expect(charByKey(mower, 'height', HC.C_Integer).getValue()).toBe(70);
  });

  it('диагностическая характеристика только читается', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);
    ctx.http.reset();
    mockCloud(ctx.http);

    ctx.scenario.run({
      source: charByKey(mower, 'ip', HC.C_String), value: '10.0.0.1', variables, options,
      context: 'C[42.11.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toHaveLength(0);
  });
});

describe('AnthbotGenie — значение в названии сервиса', () => {
  it('плитка «Параметра» получает значение в название', (ctx) => {
    // Хаб не выводит значения сервиса «Параметр» на рабочий стол — только в карточку,
    // поэтому значение выносится в имя, которое видно всегда.
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);

    expect(String(serviceByKey(mower, 'status').getName())).toBe('Косит весь газон status');
    expect(String(serviceByKey(mower, 'height').getName())).toBe('Высота 45 мм height');
    expect(String(serviceByKey(mower, 'time').getName())).toBe('Время задания 25 мин time');
    expect(String(serviceByKey(mower, 'time').getName())).toBe('Время задания 25 мин time');
  });

  it('ключ остаётся последним словом — привязка не ломается', (ctx) => {
    mockCloud(ctx.http);
    const { mower, variables, options } = startScenario(ctx);

    // Имя уже переписано; сценарий должен по-прежнему узнавать сервис и слать команду
    ctx.http.reset();
    mockCloud(ctx.http);
    ctx.scenario.run({
      source: charByKey(mower, 'height', HC.C_Integer), value: 55, variables, options,
      context: 'C[42.5.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'param_set', data: { cutter_height: 55, rid_switch: 0 } },
    ]);
  });

  it('скрытый с рабочего стола сервис не переименовывается', (ctx) => {
    mockCloud(ctx.http);
    const { hub, scenario, time } = ctx;
    const mower = addMower(hub);
    serviceByKey(mower, 'ip').setVisible(false);

    scenario.run({
      source: mower.char(HS.Switch, HC.On), value: false, variables: {},
      options: Object.assign({}, OPTIONS), context: 'HUB[OnStart]',
    });
    time.advance('1s');

    expect(String(serviceByKey(mower, 'ip').getName())).toBe('IP ip');
    expect(String(serviceByKey(mower, 'status').getName())).toBe('Косит весь газон status');
  });

  it('редкие настройки и диагностика убираются с рабочего стола', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);

    expect(serviceByKey(mower, 'volume').isVisible()).toBe(false);
    expect(serviceByKey(mower, 'raintime').isVisible()).toBe(false);
    expect(serviceByKey(mower, 'ip').isVisible()).toBe(false);
    expect(serviceByKey(mower, 'maparea').isVisible()).toBe(false);
    // Управление, состояние и зоны на столе остаются
    expect(serviceByKey(mower, 'mow').isVisible()).toBe(true);
    expect(serviceByKey(mower, 'status').isVisible()).toBe(true);
    expect(serviceByKey(mower, 'height').isVisible()).toBe(true);
    expect(serviceByKey(mower, 'zone1').isVisible()).toBe(true);
  });

  it('владелец хаба может вернуть плитку — сценарий её не прячет снова', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);
    expect(serviceByKey(mower, 'volume').isVisible()).toBe(false);

    serviceByKey(mower, 'volume').setVisible(true);
    ctx.time.advance('61s');

    expect(serviceByKey(mower, 'volume').isVisible()).toBe(true);
  });

  it('длинный статус не выталкивает ключ за предел длины имени', (ctx) => {
    // Хаб режет имя сервиса по 32 символам вместе с ключом в конце. «Статус Возвращается на базу
    // status» = 34 символа, и сервис терял ключ навсегда: сценарий переставал его находить.
    mockCloud(ctx.http, Object.assign({}, REPORTED, { robot_sta: { value: 'backtodock' } }));
    const { mower } = startScenario(ctx);

    const name = String(serviceByKey(mower, 'status').getName());
    expect(name).toBe('Возвращается на базу status');
    expect(name.length <= 32).toBe(true);
    expect(serviceByKey(mower, 'status')).toBeTruthy();
  });

  it('слишком длинное значение обрезается, ключ остаётся последним словом', (ctx) => {
    mockCloud(ctx.http, Object.assign({}, REPORTED, { robot_sta: { value: 'нераспознанное очень длинное состояние робота' } }));
    const { mower } = startScenario(ctx);

    const name = String(serviceByKey(mower, 'status').getName());
    expect(name.length <= 32).toBe(true);
    expect(name.split(' ').pop()).toBe('status');
    // Режем по границе слова — обрывок посреди слова читать невозможно
    expect(name).toBe('нераспознанное очень status');
  });

  it('длинное имя зоны тоже обрезается', (ctx) => {
    mockCloud(ctx.http, REPORTED, {
      custom_areas: [{ id: 100, name: 'Дальний угол за старой яблоней у забора' }],
    });
    const { mower } = startScenario(ctx);

    const name = String(serviceByKey(mower, 'zone1').getName());
    expect(name.length <= 32).toBe(true);
    expect(name.split(' ').pop()).toBe('zone1');
  });

  it('имя, из которого хаб вырезал знаки, второй раз не переписывается', (ctx) => {
    // Хаб выбрасывает из имени сервиса знаки препинания: «кв м» он сохранит как «квм».
    // Если сравнивать имена буквально, сценарий будет переименовывать сервис каждую минуту.
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);
    serviceByKey(mower, 'volume').setVisible(true);
    ctx.time.advance('61s');
    expect(String(serviceByKey(mower, 'volume').getName())).toBe('Громкость 40 % volume');

    // Так имя выглядело бы, вырежи хаб знак процента
    serviceByKey(mower, 'volume').setName('Громкость 40  volume');
    ctx.time.advance('61s');

    expect(String(serviceByKey(mower, 'volume').getName())).toBe('Громкость 40  volume');
  });

  it('спрятанному с рабочего стола сервису возвращается чистое имя', (ctx) => {
    // Иначе в карточке навсегда застревает значение, каким оно было в момент скрытия
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);
    expect(String(serviceByKey(mower, 'time').getName())).toBe('Время задания 25 мин time');

    // Владелец хаба спрятал плитку — следующий же опрос должен убрать значение из имени
    serviceByKey(mower, 'time').setVisible(false);
    ctx.time.advance('61s');

    expect(String(serviceByKey(mower, 'time').getName())).toBe('Время задания time');
  });

  it('при выключенной опции имена не трогаются', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx, { valueInName: false });

    expect(String(serviceByKey(mower, 'status').getName())).toBe('Статус status');
    expect(String(serviceByKey(mower, 'height').getName())).toBe('Высота кошения height');
  });

  it('пустое значение имя не портит', (ctx) => {
    // У Genie 800 нет наработки «за всё время» — такие сервисы остаются с исходным именем
    mockCloud(ctx.http, Object.assign({}, REPORTED, { map_sta: undefined }));
    const { mower } = startScenario(ctx);

    expect(String(serviceByKey(mower, 'mapstate').getName())).toBe('Карта mapstate');
  });
});

describe('AnthbotGenie — зоны', () => {
  it('кнопки зон получают имена из разметки участка, лишние прячутся', (ctx) => {
    mockCloud(ctx.http);
    const { mower } = startScenario(ctx);

    expect(String(serviceByKey(mower, 'zone1').getName())).toBe('Перед домом zone1');
    expect(String(serviceByKey(mower, 'zone2').getName())).toBe('За домом zone2');
    expect(serviceByKey(mower, 'zone3').isVisible()).toBe(false);
    expect(String(serviceByKey(mower, 'azone1').getName())).toBe('Клумба azone1');
  });

  it('отметка зоны сама по себе ничего не запускает', (ctx) => {
    // Кнопка зоны — выбор, а не команда: облако принимает список зон только целиком,
    // и отправка на каждое нажатие затирала бы предыдущий выбор.
    const { mower, variables, options } = startDocked(ctx);

    charByKey(mower, 'zone2', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'zone2', HC.On), value: true, variables, options,
      context: 'C[42.13.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toHaveLength(0);
    expect(charByKey(mower, 'zone2', HC.On).getValue()).toBe(true);
  });

  it('отмеченные зоны уходят одной командой при старте кошения', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    charByKey(mower, 'zone1', HC.On).setValue(true);
    charByKey(mower, 'zone2', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'custom_area_mow_start', data: { id: [100, 101] } },
    ]);
  });

  it('без отмеченных зон «Кошение» косит весь газон', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'app_state', data: 1 },
      { cmd: 'mow_start', data: 1 },
    ]);
  });

  it('отмеченные авто-зоны уходят одним списком точек', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    charByKey(mower, 'azone1', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'region_mow_start', data: { points: [[1, 2]] } },
    ]);
  });

  it('смешанный выбор: косятся зоны, про авто-зоны предупреждение', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    charByKey(mower, 'zone1', HC.On).setValue(true);
    charByKey(mower, 'azone1', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'custom_area_mow_start', data: { id: [100] } },
    ]);
    expect(ctx.logs.byLevel('warn').length).toBeGreaterThan(0);
  });

  it('отмеченная кнопка без зоны в разметке в задание не попадает', (ctx) => {
    const { mower, variables, options } = startDocked(ctx);

    // В разметке всего две ручные зоны, а кнопок три
    charByKey(mower, 'zone3', HC.On).setValue(true);
    ctx.scenario.run({
      source: charByKey(mower, 'mow', HC.On), value: true, variables, options,
      context: 'C[42.1.1] <- WEB[user]',
    });

    expect(sentCommands(ctx.http)).toEqual([
      { cmd: 'app_state', data: 1 },
      { cmd: 'mow_start', data: 1 },
    ]);
  });
});
