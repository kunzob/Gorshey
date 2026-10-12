export interface Position {
  trackIdx: number;
  offsetSec: number;
  endsAtMs: number;
}

/** starts[i] = seconds from loop start to the start of track i; the last entry is the loop total. */
export function buildIndex(tracks: Array<{ duration: number }>): number[] {
  if (tracks.length === 0) throw new Error('Cannot index an empty playlist');
  const starts = [0];
  for (const t of tracks) starts.push((starts[starts.length - 1] as number) + t.duration);
  return starts;
}

export function resolve(nowMs: number, epochMs: number, starts: number[]): Position {
  // Indices below are in range by construction (buildIndex always returns >= 2 entries).
  const total = starts[starts.length - 1] as number;
  const elapsed = (nowMs - epochMs) / 1000;
  const loopPos = ((elapsed % total) + total) % total; // handles now < epoch
  let lo = 0;
  let hi = starts.length - 2; // binary search: last start <= loopPos
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= loopPos) lo = mid;
    else hi = mid - 1;
  }
  const offsetSec = loopPos - (starts[lo] as number);
  const endsAtMs = nowMs + ((starts[lo + 1] as number) - loopPos) * 1000;
  return { trackIdx: lo, offsetSec, endsAtMs };
}

/**
 * What the player strip shows (display only, never used to advance playback). While the engine is active, its track
 * is authoritative (pass its index); otherwise (`null`: before the first play, paused, idle) the track scheduled now.
 * `nextIdx` is resolved 1 ms past the end of the shown track's slot, so it differs from `trackIdx` whenever the
 * playlist has more than one track.
 */
export function shownTracks(
  nowMs: number,
  epochMs: number,
  starts: number[],
  engineIdx: number | null,
): { trackIdx: number; nextIdx: number } {
  const count = starts.length - 1;
  if (engineIdx !== null && (engineIdx < 0 || engineIdx >= count)) {
    throw new RangeError(`engine track ${engineIdx} is outside the playlist (0..${count - 1})`);
  }
  const trackIdx = engineIdx ?? resolve(nowMs, epochMs, starts).trackIdx;
  const slotEndMs = epochMs + (starts[trackIdx + 1] as number) * 1000;
  return { trackIdx, nextIdx: resolve(slotEndMs + 1, epochMs, starts).trackIdx };
}

/**
 * Index of the track that follows the one playing now (display only, never used to advance playback).
 * Resolves one millisecond past the end of the current track, so the last track wraps to track 0.
 */
export function nextTrackIdx(nowMs: number, epochMs: number, starts: number[]): number {
  const current = resolve(nowMs, epochMs, starts);
  return resolve(current.endsAtMs + 1, epochMs, starts).trackIdx;
}
