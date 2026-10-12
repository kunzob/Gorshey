// Credentials live OUTSIDE the repo (M10). Temp directories and fake, empty files only: no real secret file is ever
// opened, listed or read by these tests.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREDENTIAL_FILES,
  KNOWN_REPO_PATHS,
  assertOutsideRepo,
  credentialPath,
  findCredentialFilesInRepo,
  preflightSecrets,
  resolveSecretsDir,
} from '../tools/secrets';

let base: string;
let repo: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'secrets-'));
  repo = join(base, 'gorshey');
  mkdirSync(join(repo, 'tools'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('resolveSecretsDir', () => {
  it('GORSHEY_SECRETS_DIR wins and is made absolute', () => {
    expect(resolveSecretsDir({ GORSHEY_SECRETS_DIR: join(base, 'keys') }, 'linux', '/home/k')).toBe(join(base, 'keys'));
    expect(resolveSecretsDir({ GORSHEY_SECRETS_DIR: 'rel/keys' }, 'linux', '/home/k')).toBe(resolve('rel/keys'));
  });

  it('an empty GORSHEY_SECRETS_DIR counts as unset', () => {
    expect(resolveSecretsDir({ GORSHEY_SECRETS_DIR: '' }, 'linux', '/home/k')).toBe(join('/home/k', '.config', 'gorshey'));
  });

  it('Windows default: %APPDATA%\\gorshey', () => {
    expect(resolveSecretsDir({ APPDATA: 'C:\\Users\\k\\AppData\\Roaming' }, 'win32', 'C:\\Users\\k')).toBe(
      join('C:\\Users\\k\\AppData\\Roaming', 'gorshey'),
    );
  });

  it('Windows without APPDATA falls back to the roaming profile under home', () => {
    expect(resolveSecretsDir({}, 'win32', 'C:\\Users\\k')).toBe(join('C:\\Users\\k', 'AppData', 'Roaming', 'gorshey'));
  });

  it('elsewhere: ~/.config/gorshey', () => {
    expect(resolveSecretsDir({}, 'darwin', '/Users/k')).toBe(join('/Users/k', '.config', 'gorshey'));
    expect(resolveSecretsDir({}, 'linux', '/home/k')).toBe(join('/home/k', '.config', 'gorshey'));
  });
});

describe('assertOutsideRepo', () => {
  it('refuses the repo itself and any folder inside it', () => {
    expect(() => assertOutsideRepo(repo, repo, process.platform)).toThrow(/inside the repository/);
    expect(() => assertOutsideRepo(join(repo, 'tools', 'keys'), repo, process.platform)).toThrow(/inside the repository/);
  });

  it('accepts a sibling whose name only starts with the repo name (no prefix trap)', () => {
    expect(() => assertOutsideRepo(`${repo}-secrets`, repo, process.platform)).not.toThrow();
    expect(() => assertOutsideRepo(join(base, 'keys'), repo, process.platform)).not.toThrow();
  });

  it.skipIf(process.platform !== 'win32')('on Windows the comparison ignores case', () => {
    expect(() => assertOutsideRepo('C:\\DEV\\GORSHEY\\keys', 'c:\\dev\\gorshey', 'win32')).toThrow(/inside the repository/);
    expect(() => assertOutsideRepo('D:\\keys\\gorshey', 'c:\\dev\\gorshey', 'win32')).not.toThrow();
  });
});

describe('findCredentialFilesInRepo (names only, never contents)', () => {
  const noTracked = (): string[] => [];

  it('a clean repo has none', () => {
    expect(findCredentialFilesInRepo(repo, noTracked)).toEqual([]);
  });

  it('finds an old-location file by a non-recursive existence check of the known paths', () => {
    writeFileSync(join(repo, 'tools', '.supabase-service-key.env'), ''); // fake, empty
    expect(findCredentialFilesInRepo(repo, noTracked)).toEqual(['tools/.supabase-service-key.env']);
  });

  it('finds a tracked credential file anywhere by name (git ls-files output)', () => {
    const tracked = (): string[] => ['src/main.ts', 'docs/r2-credentials.env', 'nested/deep/.supabase-service-key.env.bak'];
    expect(findCredentialFilesInRepo(repo, tracked)).toEqual(['docs/r2-credentials.env', 'nested/deep/.supabase-service-key.env.bak']);
  });

  it('existence checks touch only the known paths and never read a file', () => {
    const exists = vi.fn<(path: string) => boolean>(() => false);
    findCredentialFilesInRepo(repo, noTracked, exists);
    expect(exists.mock.calls.map((c) => c[0])).toEqual(KNOWN_REPO_PATHS.map((p) => join(repo, p)));
  });

  it('a file elsewhere in the tree that is not tracked is NOT searched for (no recursive scan)', () => {
    mkdirSync(join(repo, 'deep', 'er'), { recursive: true });
    writeFileSync(join(repo, 'deep', 'er', 'r2-credentials.env'), '');
    expect(findCredentialFilesInRepo(repo, noTracked)).toEqual([]);
  });
});

describe('preflightSecrets: refuse to run, or return the folder', () => {
  const env = (): Record<string, string> => ({ GORSHEY_SECRETS_DIR: join(base, 'keys') });

  it('returns the outside folder when the repo is clean', () => {
    expect(preflightSecrets({ env: env(), platform: 'linux', home: '/h', repoRoot: repo, lsFiles: () => [] })).toBe(join(base, 'keys'));
  });

  it('refuses when the resolved folder is inside the repo', () => {
    expect(() =>
      preflightSecrets({ env: { GORSHEY_SECRETS_DIR: join(repo, 'keys') }, platform: 'linux', home: '/h', repoRoot: repo, lsFiles: () => [] }),
    ).toThrow(/inside the repository/);
  });

  it('refuses while any credentials file exists inside the repo, naming the files but never their contents', () => {
    writeFileSync(join(repo, 'tools', '.r2-credentials.env'), 'FAKE_VALUE_MUST_NOT_APPEAR');
    let message = '';
    try {
      preflightSecrets({ env: env(), platform: 'linux', home: '/h', repoRoot: repo, lsFiles: () => [] });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/tools\/\.r2-credentials\.env/);
    expect(message).toMatch(/move/i);
    expect(message).not.toContain('FAKE_VALUE_MUST_NOT_APPEAR');
  });
});

describe('credential file names', () => {
  it('lives in the secrets folder under fixed names', () => {
    expect(credentialPath('/k', 'supabase')).toBe(join('/k', CREDENTIAL_FILES.supabase));
    expect(credentialPath('/k', 'r2')).toBe(join('/k', CREDENTIAL_FILES.r2));
    expect(CREDENTIAL_FILES).toEqual({ supabase: 'supabase-service-key.env', r2: 'r2-credentials.env' });
  });
});

describe('upload-media uses the outside folder only', () => {
  const src = readFileSync('tools/upload-media.ts', 'utf8');
  it('no credentials path inside the repo remains in the tool', () => {
    expect(src).not.toMatch(/tools\/\.supabase-service-key|tools\/\.r2-credentials/);
    expect(src).toMatch(/preflightSecrets\(/);
    expect(src).toMatch(/credentialPath\(/);
  });
});

describe('.gitignore covers credential files anywhere in the repo (names only)', () => {
  it.each([
    'tools/.supabase-service-key.env',
    'tools/.r2-credentials.env',
    'supabase-service-key.env',
    'r2-credentials.env',
    'docs/nested/supabase-service-key.env',
    'any/where/r2-credentials.env.bak',
  ])('%s is ignored', (path) => {
    // check-ignore exits 0 when the path is ignored; the file does not need to exist and is never read.
    expect(() => execFileSync('git', ['check-ignore', '-q', '--no-index', path])).not.toThrow();
  });
});
