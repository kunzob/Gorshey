// Where the upload credentials live: a per-user folder OUTSIDE the repository (M10), so no search of the working tree
// can ever reach them. This module only resolves paths and checks for the existence of known names; it never opens,
// lists or reads a credentials file. Reading happens in upload-media.ts, after preflightSecrets() has passed.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const CREDENTIAL_FILES = { supabase: 'supabase-service-key.env', r2: 'r2-credentials.env' } as const;
export type CredentialBackend = keyof typeof CREDENTIAL_FILES;

/** Repo-relative paths where credentials used to live, or could be dropped by mistake. Checked by existence only. */
export const KNOWN_REPO_PATHS = [
  'tools/.supabase-service-key.env',
  'tools/.r2-credentials.env',
  'tools/supabase-service-key.env',
  'tools/r2-credentials.env',
  '.supabase-service-key.env',
  '.r2-credentials.env',
  'supabase-service-key.env',
  'r2-credentials.env',
] as const;

const CREDENTIAL_NAME = /(^|\/)\.?(supabase-service-key|r2-credentials)[^/]*$/;

/** GORSHEY_SECRETS_DIR if set; else %APPDATA%\gorshey on Windows and ~/.config/gorshey elsewhere. */
export function resolveSecretsDir(env: Record<string, string | undefined>, platform: string, home: string): string {
  if (env.GORSHEY_SECRETS_DIR) return resolve(env.GORSHEY_SECRETS_DIR);
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'gorshey');
  return join(home, '.config', 'gorshey');
}

function real(p: string): string {
  try {
    return realpathSync(p); // resolves symlinks for paths that exist; reads no file contents
  } catch {
    return p;
  }
}

/**
 * Throws if `dir` is the repository or anywhere inside it (no prefix trap). Paths are host paths; `platform` only
 * decides whether the comparison ignores case (Windows file systems do).
 */
export function assertOutsideRepo(dir: string, repoRoot: string, platform: string): void {
  const norm = (x: string): string => (platform === 'win32' ? resolve(real(x)).toLowerCase() : resolve(real(x)));
  const rel = relative(norm(repoRoot), norm(dir));
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(
      `The secrets folder ${dir} is inside the repository. Set GORSHEY_SECRETS_DIR to a folder outside it ` +
        '(default: %APPDATA%\\gorshey on Windows, ~/.config/gorshey elsewhere).',
    );
  }
}

/**
 * Credential files inside the repository, by NAME only: tracked files from `git ls-files` whose name looks like a
 * credentials file, plus a non-recursive existence check of KNOWN_REPO_PATHS. Never opens or reads a file.
 */
export function findCredentialFilesInRepo(
  repoRoot: string,
  lsFiles: () => string[],
  exists: (path: string) => boolean = existsSync,
): string[] {
  const found = lsFiles().filter((f) => CREDENTIAL_NAME.test(f));
  for (const rel of KNOWN_REPO_PATHS) {
    if (exists(join(repoRoot, rel)) && !found.includes(rel)) found.push(rel);
  }
  return found;
}

/** Tracked file names of the repository (names only). */
export function gitLsFiles(repoRoot: string): () => string[] {
  return () => execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/** Resolves the secrets folder and refuses to run while it, or any credentials file, is inside the repository. */
export function preflightSecrets(opts: {
  env: Record<string, string | undefined>;
  platform: string;
  home: string;
  repoRoot: string;
  lsFiles: () => string[];
  exists?: (path: string) => boolean;
}): string {
  const dir = resolveSecretsDir(opts.env, opts.platform, opts.home);
  assertOutsideRepo(dir, opts.repoRoot, opts.platform);
  const inRepo = findCredentialFilesInRepo(opts.repoRoot, opts.lsFiles, opts.exists);
  if (inRepo.length > 0) {
    throw new Error(
      `Credentials files found inside the repository: ${inRepo.join(', ')}. Move them to ${dir} ` +
        `(as ${CREDENTIAL_FILES.supabase} / ${CREDENTIAL_FILES.r2}) and rotate the key. ` +
        'npm run upload refuses to run until none remain (docs/ARCHITECTURE.md, Secrets).',
    );
  }
  return dir;
}

export function credentialPath(dir: string, backend: CredentialBackend): string {
  return join(dir, CREDENTIAL_FILES[backend]);
}
