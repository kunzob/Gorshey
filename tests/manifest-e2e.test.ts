// End-to-end: real ffmpeg generates two silent files; the full CLI pipeline runs locally.
// No storage backend and no network.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runManifest } from '../tools/run-manifest';
import type { Manifest } from '../tools/build-manifest';

const run = promisify(execFile);
let dir: string;

function sourceYaml(boTitle: string, cdnBase: string): string {
  return `epoch: "2026-01-01T00:00:00Z"
cdnBase: "${cdnBase}"
tracks:
  - file: media/audio/song1.m4a
    art: media/art/song1.jpg
    title: { bo: "${boTitle}", en: "Song one" }
    artist: { bo: "ཨ་ཁུ", en: "Uncle" }
  - file: media/audio/song2.m4a
    art: media/art/song2.jpg
    title: { bo: "སྒྲོལ་མ།", en: "Song two" }
    artist: { bo: "ཨ་ཁུ", en: "Uncle" }
`;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gorshey-m1-'));
  await mkdir(join(dir, 'media/audio'), { recursive: true });
  await mkdir(join(dir, 'media/art'), { recursive: true });
  const silence = (seconds: string, out: string) =>
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', seconds, '-c:a', 'aac', out]);
  const picture = (out: string) =>
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64',
      '-frames:v', '1', out]);
  await silence('2', join(dir, 'media/audio/song1.m4a'));
  await silence('3', join(dir, 'media/audio/song2.m4a'));
  await picture(join(dir, 'media/art/song1.jpg'));
  await picture(join(dir, 'media/art/song2.jpg'));
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function build(name: string, boTitle: string, cdnBase: string) {
  const sourcePath = join(dir, `${name}.yaml`);
  const outPath = join(dir, name, 'public/manifest.json');
  await writeFile(sourcePath, sourceYaml(boTitle, cdnBase));
  await runManifest({ sourcePath, root: dir, outPath });
  return JSON.parse(await readFile(outPath, 'utf8')) as Manifest;
}

describe('manifest pipeline end to end', () => {
  it('measures float durations from real audio and sums them into totalDuration', async () => {
    const m = await build('main', 'སྒྲོལ་མ།', 'https://cdn.example.com');
    expect(m.tracks).toHaveLength(2);
    expect(Math.abs((m.tracks[0]?.duration ?? 0) - 2)).toBeLessThan(0.1);
    expect(Math.abs((m.tracks[1]?.duration ?? 0) - 3)).toBeLessThan(0.1);
    const sum = m.tracks.reduce((s, t) => s + t.duration, 0);
    expect(m.totalDuration).toBeCloseTo(sum, 10);
    expect(m.epoch).toBe('2026-01-01T00:00:00Z');
  });

  it('writes content-hashed URLs under cdnBase', async () => {
    const m = await build('urls', 'སྒྲོལ་མ།', 'https://cdn.example.com');
    for (const t of m.tracks) {
      expect(t.src).toMatch(/^https:\/\/cdn\.example\.com\/audio\/[0-9a-f]{12}\.m4a$/);
      expect(t.artwork).toMatch(/^https:\/\/cdn\.example\.com\/art\/[0-9a-f]{12}\.jpg$/);
      expect(t.id).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('produces the same tracks for a different cdnBase, only the URL prefix changes', async () => {
    const a = await build('backend-a', 'སྒྲོལ་མ།', 'https://a.supabase.example/object/public/gorshey-media');
    const b = await build('backend-b', 'སྒྲོལ་མ།', 'https://media.example.org');
    expect(b.totalDuration).toBe(a.totalDuration);
    expect(b.tracks.map((t) => t.duration)).toEqual(a.tracks.map((t) => t.duration));
    expect(b.tracks.map((t) => t.id)).toEqual(a.tracks.map((t) => t.id));
    expect(a.tracks[0]?.src.startsWith('https://a.supabase.example')).toBe(true);
    expect(b.tracks[0]?.src.startsWith('https://media.example.org')).toBe(true);
  });

  it('gives a deterministic version for identical inputs', async () => {
    const first = await build('ver1', 'སྒྲོལ་མ།', 'https://cdn.example.com');
    const second = await build('ver2', 'སྒྲོལ་མ།', 'https://cdn.example.com');
    expect(first.version).toMatch(/^[0-9a-f]{12}$/);
    expect(second.version).toBe(first.version);
  });

  it('fails with a clear message on a non-Unicode bo title and writes no manifest', async () => {
    const outPath = join(dir, 'legacy', 'public/manifest.json');
    const sourcePath = join(dir, 'legacy.yaml');
    await writeFile(sourcePath, sourceYaml('Drolma', 'https://cdn.example.com'));
    await expect(runManifest({ sourcePath, root: dir, outPath })).rejects.toThrow(
      /not Tibetan Unicode/,
    );
    await expect(readFile(outPath, 'utf8')).rejects.toThrow();
  });
});
