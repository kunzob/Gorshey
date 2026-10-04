// Tibetan normalization per .claude/skills/gorshey-tibetan §4.
// Pure function: no I/O, so the browser never has to "fix" text at runtime.

const TSHEG = /་{2,}/g; // repeated tsheg → single tsheg
const TSHEG_BEFORE_SHAD = /་(?=།)/g; // tsheg directly before shad is removed

// Deprecated compatibility characters that NFC leaves alone.
const DEPRECATED: ReadonlyArray<readonly [RegExp, string]> = [
  [/ཷ/g, 'ྲཱྀ'],
  [/ཹ/g, 'ླཱྀ'],
];

export function normalizeTibetan(input: string): string {
  let s = input.normalize('NFC');
  for (const [pattern, replacement] of DEPRECATED) {
    s = s.replace(pattern, replacement);
  }
  s = s.trim();
  s = s.replace(TSHEG, '་');
  s = s.replace(TSHEG_BEFORE_SHAD, '');
  return s;
}
