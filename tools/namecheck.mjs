#!/usr/bin/env node
/**
 * Проверяет имена сервисов на предел длины хаба (32 символа).
 *
 * Зачем: хаб молча обрезает имя сервиса по 32-му символу — ВМЕСТЕ с ключом, который стоит
 * последним словом. Обрезанный ключ означает, что сценарий больше не находит сервис: он
 * застывает навсегда, до ручного переименования. Один раз это уже случилось с «Статус
 * Возвращается на базу status» (34 символа → ключ превратился в «stat»).
 *
 *   node tools/namecheck.mjs
 *
 * Проверяются три источника имён:
 *   1) имена, которые ставит сам сценарий (подпись + самое длинное возможное значение + ключ);
 *   2) имена сервисов, рекомендованные в README — их владелец хаба вбивает руками;
 *   3) имена зон из разметки участка (длина берётся как «сколько остаётся под название»).
 *
 * Выход: код 1, если что-то не влезает и при этом не режется сценарием.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGIC = fs.readFileSync(path.join(ROOT, 'AnthbotGenie/source/AnthbotGenie.Logic.js'), 'utf-8');
const GLOBAL = fs.readFileSync(path.join(ROOT, 'AnthbotGenie/source/AnthbotGenie.Global.js'), 'utf-8');
const README = fs.readFileSync(path.join(ROOT, 'AnthbotGenie/README.md'), 'utf-8');

/** Достаёт литерал объекта/строки/числа из исходника сценария — без выполнения самого сценария. */
function literal(source, name) {
  const at = source.indexOf(name + ' = ');
  if (at < 0) throw new Error(`не найдено объявление ${name}`);
  const from = at + name.length + 3;
  const head = source[from];

  if (head === '{') {
    let depth = 0;
    for (let i = from; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) {
        return eval('(' + source.slice(from, i + 1) + ')');
      }
    }
    throw new Error(`не закрыт литерал ${name}`);
  }
  return eval('(' + source.slice(from, source.indexOf(';', from)) + ')');
}

/** Вырезает объявление функции целиком — чтобы проверка гоняла код сценария, а не его копию. */
function fn(source, name) {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`не найдена функция ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`не закрыта функция ${name}`);
}

const MAX = literal(LOGIC, 'ANTHBOT_NAME_MAX');
const LABELS = literal(LOGIC, 'ANTHBOT_NAME_LABELS');
const UNITS = literal(LOGIC, 'ANTHBOT_NAME_UNITS');
const VALUE_ONLY_RAW = literal(LOGIC, 'ANTHBOT_NAME_VALUE_ONLY');
const VALUE_ONLY = VALUE_ONLY_RAW.split(' ');
const STATUS_LABELS = literal(GLOBAL, 'ANTHBOT_STATUS_LABELS');

// Сборка имени берётся из самого сценария: иначе проверка проверяла бы свою копию правил,
// а не то, что реально уедет в хаб, — и разошлась бы с ним при первой же правке.
const composeName = new Function(
  'ANTHBOT_NAME_MAX', 'ANTHBOT_NAME_LABELS', 'ANTHBOT_NAME_UNITS', 'ANTHBOT_NAME_VALUE_ONLY',
  `${fn(LOGIC, 'anthbotComposeName')}\n${fn(LOGIC, 'anthbotTrimToWords')}\nreturn anthbotComposeName;`
)(MAX, LABELS, UNITS, VALUE_ONLY_RAW);

// Статус несёт не только состояние косилки, но и текст сбоя — он длиннее любой метки
const STATUS_VALUES = Object.values(STATUS_LABELS).concat([
  'Недоступна (нет связи с облаком)',
  // Самая длинная строка статуса: потеря связи несёт в себе ещё и последнее известное состояние
  'Связь потеряна 40 мин назад (было: Возвращается на базу)',
  'Нет связи: не заполнены логин и пароль Anthbot',
  'Нет связи: облако отвергло запрос (HTTP 403)',
]);

// Самые длинные значения, которые сценарий реально пишет в каждый сервис
const LONGEST = {
  status: STATUS_VALUES.reduce((a, b) => (b.length > a.length ? b : a), ''),
  error: 'Ошибка 65535',
  height: '100', volume: '100', dir: '359', raintime: '24',
  nestcount: '10', nestheight: '100', nestlevel: '3',
  rtk: '4', ip: '255.255.255.255', ssid: 'Keenetic-5923-guest-network',
  fw: '1.19.21', mapstate: 'mapping', maparea: '99999',
  time: '9999', area: '99999',
  // Итоги за всё время растут весь срок службы косилки: сезон ежедневного кошения по часу
  // даёт около 10 000 минут, поэтому здесь запас на порядок больше, чем у задания.
  timetotal: '999999', areatotal: '999999',
};

let bad = 0;
console.log(`Предел хаба: ${MAX} символов\n`);
console.log('ИМЕНА, КОТОРЫЕ СТАВИТ СЦЕНАРИЙ (самое длинное значение):');

for (const key of Object.keys(LABELS)) {
  const value = LONGEST[key];
  if (value === undefined) {
    console.log(`  ? ${key} — нет образца значения, пропущено`);
    continue;
  }
  const head = VALUE_ONLY.includes(key) ? '' : LABELS[key] + ' ';
  const full = head + value + (UNITS[key] || '') + ' ' + key;
  const cut = composeName(key, value);

  const mark = full.length > MAX ? (cut.length <= MAX ? '~' : '✗') : '✓';
  if (mark === '✗') bad++;
  const note = mark === '~' ? `  → режется до «${cut}» (${cut.length})` : '';
  console.log(`  ${mark} ${String(full.length).padStart(2)} «${full}»${note}`);
}

console.log('\nИМЕНА ИЗ README (их вбивает владелец хаба руками):');
const fromReadme = [...README.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
for (const name of new Set(fromReadme)) {
  const ok = name.length <= MAX;
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${String(name.length).padStart(2)} «${name}»`);
}

console.log('\nИМЕНА ЗОН (сколько остаётся под название участка):');
for (const key of ['zone1', 'zone16', 'azone1', 'azone16']) {
  console.log(`  ${key}: ${MAX - key.length - 1} символов`);
}

console.log(bad === 0
  ? '\nВсё влезает либо режется сценарием без потери ключа.'
  : `\nНЕ ВЛЕЗАЕТ: ${bad} — ключ будет обрезан хабом.`);
process.exit(bad === 0 ? 0 : 1);
