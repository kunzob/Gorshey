import tseslint from 'typescript-eslint';

// Architecture guard (CLAUDE.md "Module boundaries" and invariant 1).
// Overrides below re-enable each call only where the architecture allows it.
const noDocument = {
  name: 'document',
  message: 'DOM access belongs in src/ui/ only.',
};

const noDateNow = {
  selector: "MemberExpression[object.name='Date'][property.name='now']",
  message: 'Use clock.now() from src/core/clock.ts instead of Date.now().',
};

const noNewDate = {
  selector: "NewExpression[callee.name='Date']",
  message: 'Use clock.now() from src/core/clock.ts instead of new Date().',
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'media/**', '.claude/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,js}'],
    rules: {
      'no-restricted-globals': ['error', noDocument],
      'no-restricted-syntax': ['error', noDateNow, noNewDate],
    },
  },
  {
    // Code-execution sinks (M10): never allowed anywhere, including tools and tests.
    files: ['**/*.{ts,js,mjs,cjs}'],
    // no-implied-eval only flags calls it can resolve to these globals; flat config declares none by default.
    languageOptions: {
      globals: { setTimeout: 'readonly', setInterval: 'readonly', execScript: 'readonly', window: 'readonly' },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    // The one DOM-level test file exercises src/ui from a happy-dom environment.
    files: ['tests/render.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    // Catalog and manifest strings must go in with textContent, never as markup.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent; never write markup from strings.' },
        { property: 'outerHTML', message: 'Use textContent; never write markup from strings.' },
        { property: 'insertAdjacentHTML', message: 'Use textContent; never write markup from strings.' },
      ],
    },
  },
  {
    files: ['src/core/clock.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
