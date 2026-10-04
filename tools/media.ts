// Filesystem and ffprobe access for the build tooling. Not used by the browser.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Float seconds, measured by ffprobe (ARCHITECTURE §1: never typed by hand).
export async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned no usable duration for ${path}: "${stdout.trim()}"`);
  }
  return seconds;
}

// First 12 hex chars of SHA-256; used in object names on either backend.
export async function contentHash(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

export async function readBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await readFile(path));
}
