# Font setup for Gorshey

Place in `src/styles/fonts.css`. Tune the percentages by eye during M5/M10 — the values below are starting points.

```css
/* Primary self-hosted Tibetan web font */
@font-face {
  font-family: "Gorshey Tibetan";
  src: url("/fonts/jomolhari.woff2") format("woff2");
  unicode-range: U+0F00-0FFF, U+25CC; /* Tibetan block + dotted circle used for isolated marks */
  font-display: swap;
  size-adjust: 115%;
  ascent-override: 95%;
  descent-override: 45%;
  line-gap-override: 0%;
}

/* Corrected aliases for system fallbacks, so the swap does not jump */
@font-face {
  font-family: "Gorshey Tibetan Fallback";
  src: local("Kailasa"), local("Microsoft Himalaya"), local("Tibetan Machine Uni");
  unicode-range: U+0F00-0FFF;
  size-adjust: 135%; /* Microsoft Himalaya renders very small */
}

:lang(bo) {
  font-family: "Gorshey Tibetan", "Gorshey Tibetan Fallback", serif;
  line-height: 1.9;
  letter-spacing: normal;
  text-transform: none;
}

/* Latin UI chrome */
:root {
  --font-mono: ui-monospace, "Geist Mono", "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
}
:lang(en) .caps, :lang(fr) .caps { text-transform: uppercase; letter-spacing: 0.08em; }
```

Notes
- One `local()` alias with a single `size-adjust` is a compromise: Kailasa and Himalaya differ in size.
  If QA shows a big mismatch, split into two aliases and order them per platform.
- `size-adjust` support: current Chrome, Edge, Firefox, Safari 17+. Older Safari ignores it harmlessly.
- Preload snippet (only when needed):
  `<link rel="preload" href="/fonts/jomolhari.woff2" as="font" type="font/woff2" crossorigin>`
