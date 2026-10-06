import { ringDashOffset, ringFraction } from './view';

export const RING_RADIUS = 45;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Sets the ring from the clock-derived position. Never reads audio.currentTime. */
export function setRing(fill: SVGCircleElement, positionSec: number, durationSec: number): void {
  fill.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  fill.style.strokeDashoffset = `${ringDashOffset(RING_CIRCUMFERENCE, ringFraction(positionSec, durationSec))}`;
}
