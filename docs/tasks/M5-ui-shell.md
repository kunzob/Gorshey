# M5 — UI shell (Potala at night)

**Goal:** the real interface, mobile-first, wired to engine and i18n events.
**Skills:** `frontend-design`, `gorshey-tibetan`. **Checkpoint:** show a static HTML/CSS mock (no JS) for approval before wiring.

## Files
```
index.html                 # semantic skeleton, neutral placeholders
src/styles/tokens.css      # colors, spacing, type scale; light-mode slots defined, unused
src/styles/fonts.css       # from gorshey-tibetan references/fonts.md
src/styles/base.css        # reset, safe-area insets, :lang rules
src/styles/components.css
src/ui/dom.ts              # typed refs queried once; throws early if an element is missing
src/ui/render.ts           # subscribes to engine / i18n / presence; the only DOM writer
src/ui/KoraRing.ts         # SVG circle, stroke-dashoffset, clockwise from 12 o'clock
src/ui/ClockView.ts        # live local clock, 1 Hz, Western digits
src/ui/LocaleToggle.ts
public/fonts/              # self-hosted Tibetan WOFF2 + OFL.txt
```

## Layout (single column, max-width ~460px, centered)
Header: presence badge (dot + "— on the kora") · local clock · locale toggle →
artwork (square) inside the kora ring → eyebrow "ON AIR · MARPO RI" → Tibetan title (primary) →
subtitle (current locale) → artist → time "0:00 / 3:34" → play button (≥ 72px) → footer line.

## Rules
- Placeholders only in HTML; no fake count or track.
- All touch targets ≥ 48px; `env(safe-area-inset-*)` padding; `theme-color` meta = night base.
- Uppercase/tracking only via `:lang(en) .caps`.
- Kora ring: `transform: rotate(-90deg)` on the circle so progress starts at 12 o'clock and runs clockwise.
- Play button shows loading/buffering states with text for screen readers (`aria-live="polite"` region).
- Remove `devHarness.ts`.

## Acceptance
- Lighthouse accessibility ≥ 95 on mobile emulation.
- Switching locale changes all text without reload; Tibetan title never clips (test with the strings in the tibetan skill §6).
- No layout shift when the Tibetan web font loads (check Performance panel, CLS ≈ 0).
