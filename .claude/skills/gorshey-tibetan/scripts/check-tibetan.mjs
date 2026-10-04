#!/usr/bin/env node
// Scan a JSON file for Tibetan text problems. Usage: node check-tibetan.mjs <file.json>
// Errors: bo fields with no Tibetan code points (likely legacy encoding), deprecated characters,
// unassigned code points in the Tibetan block. Warnings: double tsheg, tsheg before shad, non-NFC text.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: check-tibetan.mjs <file.json>'); process.exit(2); }
const data = JSON.parse(readFileSync(file, 'utf8'));

const DEPRECATED = new Map([
  [0x0f73, 'U+0F73 (use 0F71 0F72)'], [0x0f75, 'U+0F75 (use 0F71 0F74)'],
  [0x0f81, 'U+0F81 (use 0F71 0F80)'], [0x0f77, 'U+0F77 (use 0FB2 0F71 0F80)'],
  [0x0f79, 'U+0F79 (use 0FB3 0F71 0F80)'],
]);
const UNASSIGNED = (cp) =>
  cp === 0x0f48 || (cp >= 0x0f6d && cp <= 0x0f70) || cp === 0x0f98 || cp === 0x0fbd ||
  cp === 0x0fcd || (cp >= 0x0fdb && cp <= 0x0fff);
const isTibetan = (cp) => cp >= 0x0f00 && cp <= 0x0fff;

let errors = 0, warnings = 0;
const report = (level, path, msg) => {
  console.log(`${level.padEnd(5)} ${path}: ${msg}`);
  level === 'ERROR' ? errors++ : warnings++;
};

function checkString(s, path, isBoField) {
  const cps = [...s].map((c) => c.codePointAt(0));
  const hasTib = cps.some(isTibetan);
  if (isBoField && s.trim() && !hasTib) report('ERROR', path, 'bo field has no Tibetan code points (legacy encoding?)');
  if (!hasTib) return;
  cps.forEach((cp, i) => {
    if (DEPRECATED.has(cp)) report('ERROR', path, `deprecated ${DEPRECATED.get(cp)} at index ${i}`);
    else if (isTibetan(cp) && UNASSIGNED(cp)) report('ERROR', path, `unassigned U+${cp.toString(16).toUpperCase()} at index ${i}`);
  });
  if (s.includes('\u0f0b\u0f0b')) report('WARN', path, 'double tsheg');
  if (s.includes('\u0f0b\u0f0d')) report('WARN', path, 'tsheg directly before shad');
  if (s !== s.normalize('NFC')) report('WARN', path, 'text is not NFC-normalized');
}

function walk(node, path, parentKey) {
  if (typeof node === 'string') return checkString(node, path, parentKey === 'bo' || /\.bo(\.|$)/.test(path));
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, parentKey));
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, k);
}

walk(data, '', '');
// Catalog files (bo.json) are flat: every value is a bo field.
if (/(^|\/)bo\.json$/.test(file)) {
  for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && v.trim() && ![...v].some((c) => isTibetan(c.codePointAt(0))))
    report('ERROR', k, 'bo catalog value has no Tibetan code points');
}
console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
