# M0 — Project scaffold

**Goal:** an empty but fully wired TypeScript project that builds, lints, and tests.
**Skills:** none required. **Checkpoint:** show the planned `package.json` dependency list before installing.

## Steps
1. Scaffold Vite `vanilla-ts` into the existing repo (do not overwrite kit files).
2. Dev dependencies only: `typescript`, `vite`, `vitest`, `eslint` + `typescript-eslint`, `prettier`,
   `vite-plugin-pwa`, `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `tsx`, `yaml`.
   Runtime dependency: `@supabase/realtime-js` only.
3. `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, target ES2022.
4. Create the folder tree from `docs/ARCHITECTURE.md` with placeholder `index.ts` files exporting nothing.
5. Scripts: `dev`, `build`, `preview`, `test`, `lint` (`eslint . && tsc --noEmit`), `manifest`, `e2e` (placeholder).
6. ESLint rule: `no-restricted-globals`/`no-restricted-syntax` to forbid `document` outside `src/ui/` and
   `Date.now` outside `src/core/clock.ts` (use overrides per folder).
7. `.gitignore`: `node_modules`, `dist`, `.env*` except `.env.example`, `media/`, `tools/.r2-credentials*`.
8. `.env.example` with the two `VITE_SUPABASE_*` names and empty values.
9. One trivial Vitest test so `npm run test` is green.

## Files
`package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`,
`.env.example`, `index.html` (minimal), `src/main.ts`, `src/{core,audio,presence,i18n,ui,styles}/`, `tests/smoke.test.ts`.

## Acceptance
- `npm run lint && npm run test && npm run build` all pass.
- The ESLint restriction fires if you temporarily add `document.title` in `src/core/`.

## Out of scope
Any real feature code, styling, service worker logic.
