// npm run upload — run by Kunshe, never by the agent. Backend = STORAGE_BACKEND (default supabase).
// Secrets are read at runtime from gitignored files; their values never appear in code or logs.
//   supabase: tools/.supabase-service-key.env  → SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   r2:       tools/.r2-credentials.env        → R2_ENDPOINT (signing is not implemented yet)
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SourceConfig, TrackFacts } from './build-manifest';
import { gatherFacts, parseSource } from './run-manifest';
import { contentTypeFor, remoteKeys } from './media-keys';
import { readBytes } from './media';
import { createR2Backend } from './storage/r2';
import { createSupabaseBackend } from './storage/supabase';
import { ensureUploaded, type StorageBackend } from './storage/types';

const BUCKET = 'gorshey-media';

export type BackendName = 'supabase' | 'r2';

export interface UploadItem {
  localPath: string;
  remoteKey: string;
  contentType: string;
}

export function resolveBackendName(env: Record<string, string | undefined>): BackendName {
  const name = env.STORAGE_BACKEND ?? 'supabase';
  if (name === 'supabase' || name === 'r2') return name;
  throw new Error(`unknown STORAGE_BACKEND "${name}" (expected supabase or r2)`);
}

export function planUploads(
  source: SourceConfig,
  facts: ReadonlyMap<string, TrackFacts>,
  root: string,
): UploadItem[] {
  const items: UploadItem[] = [];
  for (const track of source.tracks) {
    const f = facts.get(track.file);
    if (!f) throw new Error(`no file facts for ${track.file}`);
    const keys = remoteKeys(f);
    items.push({
      localPath: resolve(root, track.file),
      remoteKey: keys.audio,
      contentType: contentTypeFor(f.audioExt),
    });
    items.push({
      localPath: resolve(root, track.art),
      remoteKey: keys.art,
      contentType: contentTypeFor(f.artExt),
    });
  }
  return items;
}

// Minimal KEY=VALUE parser for the gitignored credential files. Comments and blanks skipped.
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    env[key] = value;
  }
  return env;
}

// Supabase-js appends /storage/v1 itself, so SUPABASE_URL must be the bare project origin.
// A path here (e.g. the /rest/v1 suffix shown on some dashboard pages) sends every request
// to the wrong route, and the 404s that come back look like "object not found".
export function validateSupabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SUPABASE_URL is not a valid URL. Expected https://<project-ref>.supabase.co');
  }
  if (url.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must use https. Expected https://<project-ref>.supabase.co');
  }
  if (url.pathname !== '/' || url.search || url.hash || value.endsWith('/')) {
    throw new Error(
      'SUPABASE_URL must be the bare project origin with no path or trailing slash ' +
        `(found path "${url.pathname}"). Expected https://<project-ref>.supabase.co`,
    );
  }
  return url.origin;
}

function required(env: Record<string, string>, key: string, file: string): string {
  const value = env[key];
  if (!value) throw new Error(`${file} is missing ${key}`);
  return value;
}

async function createBackend(name: BackendName, root: string): Promise<StorageBackend> {
  if (name === 'supabase') {
    const file = 'tools/.supabase-service-key.env';
    const env = parseEnvFile(await readFile(resolve(root, file), 'utf8'));
    const client = createClient(
      validateSupabaseUrl(required(env, 'SUPABASE_URL', file)),
      required(env, 'SUPABASE_SERVICE_ROLE_KEY', file),
      { auth: { persistSession: false } },
    );
    return createSupabaseBackend({ client, bucket: BUCKET, readFile: readBytes });
  }
  const file = 'tools/.r2-credentials.env';
  const env = parseEnvFile(await readFile(resolve(root, file), 'utf8'));
  return createR2Backend({
    endpoint: required(env, 'R2_ENDPOINT', file),
    bucket: BUCKET,
    readFile: readBytes,
  });
}

async function main(): Promise<void> {
  const name = resolveBackendName(process.env);
  const root = process.cwd();
  const source = parseSource(await readFile(resolve(root, 'tools/tracks.source.yaml'), 'utf8'));
  const facts = await gatherFacts(source, root);
  const backend = await createBackend(name, root);

  let uploaded = 0;
  let skipped = 0;
  for (const item of planUploads(source, facts, root)) {
    const outcome = await ensureUploaded(backend, item.localPath, item.remoteKey, item.contentType);
    console.log(`${outcome.padEnd(8)} ${item.remoteKey}`);
    if (outcome === 'uploaded') uploaded++;
    else skipped++;
  }
  console.log(`${name}: ${uploaded} uploaded, ${skipped} skipped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
