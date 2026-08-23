#!/usr/bin/env node
/**
 * Готовит сценарии к заливке в Sprut.Hub: вырезает комментарии.
 *
 * Зачем: хаб молча не сохраняет крупные сценарии — 61 КБ исходника не доезжает, а полторы
 * строки сохраняются мгновенно. Комментарии в этом коде занимают больше половины объёма,
 * и без них он укладывается в предел. В репозитории остаётся полная версия с документацией,
 * в хаб уезжает та же логика без комментариев.
 *
 * Комментарии вырезаются по AST (acorn), а не регулярками: в коде есть регулярные литералы
 * вроде /^https?:\/\//i, на которых «убрать всё после //» ломает программу.
 *
 *   node tools/hubbuild.mjs                 # соберёт build/*.hub.js и покажет размеры
 *
 * acorn берётся из ScenarioSimulator (он уже есть рядом как тест-раннер).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
// Соседние клоны ScenarioSimulator: acorn уже стоит там как зависимость тест-раннера,
// и ставить его второй раз незачем. Второй путь — раскладка, в которой ScenarioSimulator
// лежит внутри клона SH_VirtualThermostat.
const SIMULATOR_ROOTS = [
  path.join(ROOT, '..', 'Sprut.Hub_Tools/ScenarioSimulator'),
  path.join(ROOT, '..', 'SH_VirtualThermostat/Sprut.Hub_Tools/ScenarioSimulator'),
];

/** Путь к acorn внутри bun-хранилища ScenarioSimulator, без привязки к версии. */
function acornInSimulator() {
  for (const simulator of SIMULATOR_ROOTS) {
    const store = path.join(simulator, 'node_modules/.bun');
    if (!fs.existsSync(store)) continue;
    const pkg = fs.readdirSync(store).find((name) => name.indexOf('acorn@') === 0);
    if (pkg) return path.join(store, pkg, 'node_modules/acorn/dist/acorn.mjs');
  }
  return null;
}

const SOURCES = [
  'AnthbotGenie/source/AnthbotGenie.Global.js',
  'AnthbotGenie/source/AnthbotGenie.Logic.js',
];

async function loadAcorn() {
  // Обычное разрешение модулей — работает, если acorn поставлен в проект или доступен глобально
  try {
    return await import('acorn');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }

  const candidates = [path.join(ROOT, 'node_modules/acorn/dist/acorn.mjs'), acornInSimulator()];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }

  console.error('Не найден acorn — единственная зависимость сборщика.\n' +
                '  npm i acorn\n' +
                'Либо он подхватится сам из соседнего клона ScenarioSimulator, если тот есть.');
  process.exit(1);
}

const acorn = await loadAcorn();

/** Вырезает комментарии и схлопывает пустые строки, оставляя код нетронутым. */
function stripComments(code) {
  const comments = [];
  acorn.parse(code, {
    ecmaVersion: 2020,
    sourceType: 'script',
    onComment: (block, text, start, end) => comments.push([start, end]),
  });

  let out = '';
  let at = 0;
  for (const [start, end] of comments) {
    out += code.slice(at, start);
    at = end;
    // Комментарий на своей строке уходит вместе с остатком строки, иначе остаётся пустой отступ
    if (/(^|\n)[ \t]*$/.test(out) && code[at] === '\n') at += 1;
  }
  out += code.slice(at);

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

for (const rel of SOURCES) {
  const src = path.join(ROOT, rel);
  const code = fs.readFileSync(src, 'utf-8');
  const stripped = stripComments(code);

  // Проверка, что вырезание ничего не сломало
  acorn.parse(stripped, { ecmaVersion: 2020, sourceType: 'script' });

  const out = path.join(ROOT, 'build', path.basename(rel).replace(/\.js$/, '.hub.js'));
  fs.writeFileSync(out, stripped, 'utf-8');

  const was = Buffer.byteLength(code);
  const now = Buffer.byteLength(stripped);
  console.log(`${path.basename(rel)}: ${was} → ${now} байт (${Math.round((1 - now / was) * 100)}% меньше) → ${out}`);
}
