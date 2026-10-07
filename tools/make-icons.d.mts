export type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string; background: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string | null; stroke: string | null; strokeWidth: number }
  | { kind: 'polygon'; points: Array<[number, number]>; fill: string };
export function parseSvg(source: string): Shape[];
/** RGB bytes, size × size × 3. safeZone scales every non-background shape to 80% about the centre. */
export function rasterize(shapes: Shape[], size: number, opts: { safeZone: boolean }): Uint8Array;
export function encodePng(rgb: Uint8Array, size: number): Buffer;
