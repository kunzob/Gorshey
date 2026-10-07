// Typed element refs, queried once. Throws at startup if the skeleton is missing an element.
export function req<T extends Element = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as unknown as T;
}

export function refs() {
  return {
    badge: req('badge'),
    clock: req<HTMLTimeElement>('clock'),
    locale: req<HTMLButtonElement>('locale'),
    station: req('station'),
    ringFill: req<SVGCircleElement>('ring-fill'),
    artwork: req<HTMLImageElement>('artwork'),
    footer: req('footer'),
    eyebrow: req('eyebrow'),
    title: req('title'),
    subtitle: req('subtitle'),
    artist: req('artist'),
    position: req('position'),
    play: req<HTMLButtonElement>('play'),
    nextup: req('nextup'),
    status: req('status'),
    update: req('update'),
  };
}
