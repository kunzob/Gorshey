// npm run manifest → public/manifest.json. Args: [sourceYaml] [outJson] [mediaRoot].
// The Tibetan check runs afterwards in package.json.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import {
  buildManifest,
  type Manifest,
  type SourceConfig,
  type TrackFacts,
} from './build-manifest';
import { contentHash, probeDuration } from './media';

export interface ManifestRunOptions {
  sourcePath: string;
  root: string;
  outPath: string;
}

export function parseSource(text: string): SourceConfig {
  const data = parse(text) as Partial<Record<keyof SourceConfig, unknown>> | null;
  if (!data || typeof data !== 'object') throw new Error('source YAML is empty or not an object');
  if (typeof data.epoch !== 'string') throw new Error('source YAML: "epoch" must be a string');
  if (typeof data.cdnBase !== 'string') throw new Error('source YAML: "cdnBase" must be a string');
  if (!Array.isArray(data.tracks)) throw new Error('source YAML: "tracks" must be a list');
  return data as SourceConfig;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function gatherFacts(
  source: SourceConfig,
  root: string,
): Promise<Map<string, TrackFacts>> {
  const facts = new Map<string, TrackFacts>();
  for (const track of source.tracks) {
    const audioPath = resolve(root, track.file);
    const artPath = resolve(root, track.art);
    const audioExists = await exists(audioPath);
    const artExists = await exists(artPath);
    facts.set(track.file, {
      duration: audioExists ? await probeDuration(audioPath) : 0,
      audioExists,
      artExists,
      audioHash: audioExists ? await contentHash(audioPath) : '',
      artHash: artExists ? await contentHash(artPath) : '',
      audioExt: extname(track.file).slice(1),
      artExt: extname(track.art).slice(1),
    });
  }
  return facts;
}

// Version is a content hash, not a timestamp: the repo bans Date outside clock.ts,
// and identical inputs should give identical manifests.
export function withContentVersion(manifest: Manifest): Manifest {
  const unversioned = JSON.stringify({ ...manifest, version: '' });
  const version = createHash('sha256').update(unversioned).digest('hex').slice(0, 12);
  return { ...manifest, version };
}

export async function runManifest(opts: ManifestRunOptions): Promise<Manifest> {
  const source = parseSource(await readFile(opts.sourcePath, 'utf8'));
  const facts = await gatherFacts(source, opts.root);
  const manifest = withContentVersion(buildManifest(source, facts, ''));
  await mkdir(dirname(opts.outPath), { recursive: true });
  await writeFile(opts.outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main(): Promise<void> {
  const sourcePath = resolve(process.argv[2] ?? 'tools/tracks.source.yaml');
  const outPath = resolve(process.argv[3] ?? 'public/manifest.json');
  const root = resolve(process.argv[4] ?? process.cwd());
  const manifest = await runManifest({ sourcePath, root, outPath }).catch((err: unknown) => {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT' && err.message.includes(sourcePath)) {
      throw new Error(`source YAML not found: ${sourcePath}
  copy tools/tracks.source.example.yaml to tools/tracks.source.yaml and fill it in`);
    }
    throw err;
  });
  console.log(
    `wrote ${outPath}: ${manifest.tracks.length} tracks, ${manifest.totalDuration.toFixed(2)} s, version ${manifest.version}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
