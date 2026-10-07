// Pure view logic: no DOM. Every visible string is a catalog key; this module only chooses which key applies.
import type { EngineState } from '../audio/AudioEngine';
import { buildIndex, nextTrackIdx } from '../core/schedule';
import type { Manifest } from '../core/types';
import { formatDuration, titleParts, type LangRun } from '../i18n/i18n';
import type { Locale } from '../i18n/locales';

export const NEXT_UP_TRACK_KEY = 'player.nextUp';

/** Every catalog key the shell can show. The tests check each one exists in bo and en. */
export const VIEW_KEYS = [
  'station.name',
  'player.play',
  'player.pause',
  'player.buffering',
  'player.error',
  'player.offline',
  'player.live',
  'place.marpoRi',
  'eyebrow.line',
  'badge.listeners',
  'badge.unknown',
  'player.nextUp',
  'list.separator',
  'update.available',
];

const ACTIVE: EngineState[] = ['loading', 'playing', 'buffering'];

export function playLabelKey(state: EngineState): 'player.play' | 'player.pause' {
  return ACTIVE.includes(state) ? 'player.pause' : 'player.play';
}

/** Offline outranks error, which outranks buffering. null means the status line stays empty. */
export function statusKey(state: EngineState, offline: boolean): 'player.offline' | 'player.error' | 'player.buffering' | null {
  if (offline) return 'player.offline';
  if (state === 'error') return 'player.error';
  if (state === 'buffering') return 'player.buffering';
  return null;
}

/** Position over duration, clamped to [0, 1]. A missing duration gives 0, never NaN. */
export function ringFraction(positionSec: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

export function ringDashOffset(circumference: number, fraction: number): number {
  return circumference * (1 - fraction);
}

/** "m:ss / m:ss" while active; empty otherwise (no placeholder text under the artist). */
export function positionLabel(positionSec: number, durationSec: number, active: boolean): string {
  if (!active) return '';
  return `${formatDuration(positionSec)} / ${formatDuration(durationSec)}`;
}

/** Runs for the next track, computed from the clock (resolve at end-of-track + 1 ms), never idx+1. */
export function nextUpRuns(manifest: Manifest, nowMs: number, locale: Locale): LangRun[] {
  const starts = buildIndex(manifest.tracks);
  const idx = nextTrackIdx(nowMs, manifest.epochMs, starts);
  return titleParts(manifest.tracks[idx]!.title, locale);
}
