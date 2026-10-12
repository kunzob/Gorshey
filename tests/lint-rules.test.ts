// M10: proves the code-execution sinks are lint errors everywhere ESLint runs (src, tools, tests).
// The samples are linted in memory through the real project config; no sample file is written to the repo.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.ruleId ?? 'parse-error');
}

const FILES = ['src/core/sample.ts', 'src/ui/sample.ts', 'tools/sample.ts', 'tools/sample.mjs', 'tests/sample.test.ts'];

describe('no code-execution sinks (M10)', () => {
  for (const file of FILES) {
    it(`eval is an error in ${file}`, async () => {
      expect(await ruleIds('export const run = (s: string): unknown => eval(s);\n', file)).toContain('no-eval');
    });

    it(`new Function is an error in ${file}`, async () => {
      expect(await ruleIds("export const f = new Function('a', 'return a');\n", file)).toContain('no-new-func');
    });

    it(`a string passed to setTimeout is an error in ${file}`, async () => {
      expect(await ruleIds("setTimeout('alert(1)', 10);\nexport {};\n", file)).toContain('no-implied-eval');
    });
  }

  it('ordinary timers and functions stay clean', async () => {
    const ids = await ruleIds('export const f = (): void => {};\nsetTimeout(f, 10);\n', 'src/core/sample.ts');
    expect(ids).toEqual([]);
  });
});

describe('scratch files can never break lint (M10)', () => {
  it('scratch/** is ignored by the project config', async () => {
    expect(await eslint.isPathIgnored('scratch/m10/measure.mjs')).toBe(true);
    expect(await eslint.isPathIgnored('scratch/any/build/assets/index.js')).toBe(true);
  });

  it('tools/ and src/ are still linted', async () => {
    expect(await eslint.isPathIgnored('tools/e2e.mjs')).toBe(false);
    expect(await eslint.isPathIgnored('src/main.ts')).toBe(false);
  });
});
