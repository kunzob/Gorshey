---
name: gorshey-tibetan
description: Tibetan script rendering, fonts, and text-data rules for the Gorshey radio app. Use this skill whenever you touch CSS, @font-face, typography, layout of titles or labels, :lang() selectors, i18n catalogs, track metadata (title/artist maps), the manifest build script, or any string containing Tibetan (U+0F00–U+0FFF) — even if the task doesn't mention Tibetan explicitly, because most UI text in Gorshey can be Tibetan.
---

# Gorshey — Tibetan text

Tibetan stacks letters vertically (head letters, subjoined consonants, vowel signs above and below),
and most Tibetan fonts draw glyphs small inside the em-square. Layouts tuned for Latin monospace
therefore clip vowel marks, shift on font load, or look tiny. These rules prevent that.

## 1. Markup
- Every element whose text may be Tibetan gets `lang="bo"` (or inherits it from `<html lang="bo">`).
  CSS targets Tibetan **only** through `:lang(bo)`, never through class names, so locale switching just works.
- Track titles render as a pair: Tibetan original (always, `lang="bo"`) + subtitle in the current locale
  (`lang` set to that locale). If the current locale is `bo`, show the English title as subtitle.

## 2. CSS rules
Copy the font setup from `references/fonts.md`. Core rules:

```css
:lang(bo) {
  font-family: "Gorshey Tibetan", "Jomolhari", "Noto Serif Tibetan", "Kailasa",
               "Microsoft Himalaya", "Tibetan Machine Uni", serif;
  line-height: 1.9;
  letter-spacing: normal;
  text-transform: none;
  font-feature-settings: normal;
}
```

Why each matters:
- `line-height ≥ 1.8`: anything tighter clips stacked consonants and vowel signs (ི ུ ེ ོ).
- `letter-spacing: normal`: tracking can break mark positioning in shaped scripts. Uppercase-and-tracking styles
  (eyebrows, footer, timestamps) must be scoped to `:lang(en)`, `:lang(fr)` — never global.
- Never put Tibetan in a box with a fixed `height` plus `overflow: hidden`. For truncation use
  `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`
  together with the generous line-height, and reserve space with `min-height: calc(2 * 1.9em)`.
- Size Tibetan up via `size-adjust` in `@font-face` (see references), not by per-element `font-size` hacks,
  so every fallback font is corrected consistently.
- Do not use the monospace stack for Tibetan; no Tibetan monospace font exists. Latin stays mono.

## 3. Fonts
- Self-host one Tibetan web font (Jomolhari or Noto Serif Tibetan, both OFL) as WOFF2 in `public/fonts/`,
  with `unicode-range: U+0F00-0FFF` so English-only views never download it, and `font-display: swap`.
- Preload it only when the initial locale is `bo` or a Tibetan title is on screen.
- Keep the OFL license file next to the font.
- Never load fonts from a third-party CDN (privacy, CSP, and reachability).

## 4. Text data (manifest, catalogs)
All Tibetan strings must be clean Unicode before they reach the browser. The manifest build script
normalizes; the browser never "fixes" text at runtime.

Normalization (implement in `tools/tibetan-normalize.ts`):
1. `s.normalize('NFC')` — this already decomposes U+0F73, U+0F75, U+0F81 (they are composition exclusions).
2. Replace deprecated compatibility characters NFC leaves alone:
   U+0F77 → U+0FB2 U+0F71 U+0F80, and U+0F79 → U+0FB3 U+0F71 U+0F80.
3. Trim whitespace; collapse repeated tsheg (U+0F0B U+0F0B → U+0F0B); remove a tsheg directly before a shad (U+0F0D).
4. Use non-breaking tsheg (U+0F0C) only where the source explicitly wants words kept together.

Validation (fail the build):
- A `bo` field contains no code point in U+0F00–U+0FFF → probably a legacy (pre-Unicode, ASCII-mapped font)
  encoding. Stop and report; conversion requires a mapping table for that specific font (`convertLegacy` stub).
- Any code point in U+0F00–U+0FFF that is unassigned, or a deprecated character surviving normalization.

Run `node .claude/skills/gorshey-tibetan/scripts/check-tibetan.mjs <file.json>` to scan any JSON file
(manifest, catalogs) for these problems. It exits non-zero on errors.

## 5. UI copy
- Tibetan UI strings in `bo.json` are drafts until a native speaker reviews them. Mark unreviewed keys in
  `PROGRESS.md` under "Open questions" — do not invent or "improve" Tibetan phrasing silently.
- Numbers stay Western digits in every locale (agreed decision).

## 6. Testing Tibetan
When doing browser QA, render a test page with titles of increasing stack depth, e.g.
`བཀྲ་ཤིས་བདེ་ལེགས།`, `སྒྲོལ་མ།`, `རྒྱ་མཚོ།`, `བསྒྲུབས།`, `ཀྱཻ།`, and a two-line title, and check:
no clipped marks (top or bottom), no layout jump when the web font swaps in, correct wrapping after tsheg,
and readable size next to Latin text. Check at least Chrome, Safari (iOS) and Windows (Microsoft Himalaya fallback).
