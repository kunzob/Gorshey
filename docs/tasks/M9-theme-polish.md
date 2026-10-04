# M9 — Theme polish

**Goal:** the finished Potala-at-night identity, still light and fast.
**Skills:** `frontend-design`, `gorshey-tibetan`.

## Steps
1. Grain overlay: inline SVG `feTurbulence` as a fixed, `pointer-events: none` layer at low opacity.
2. Potala mark: original SVG line drawing (simple geometric silhouette: terraced White Palace, central Red Palace,
   hill line). Faint, behind content; hidden below ~360px height if it crowds the layout.
3. Presence dot: gold, gentle pulse; static under `prefers-reduced-motion`.
4. Kora ring: subtle gold stroke while playing; dim when paused.
5. Footer line from the catalog; `.caps` styling for Latin only.
6. Check total transferred size of the first load (excluding audio and the Tibetan font): target < 60 KB gzip.

## Acceptance
- Visual review approved by Kunshe (screenshots at 375px and 1280px, both locales).
- No new dependencies; no external image or font requests other than R2 artwork.
