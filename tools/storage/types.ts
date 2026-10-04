// Shared interface for both storage backends (ARCHITECTURE §0).
// Backends never read the filesystem themselves: the caller injects readFile,
// which keeps these modules free of Node built-ins and easy to test.

export interface StorageBackend {
  upload(localPath: string, remoteKey: string, contentType: string): Promise<void>;
  exists(remoteKey: string): Promise<boolean>;
}

export type ReadFile = (localPath: string) => Promise<Uint8Array<ArrayBuffer>>;

export type UploadOutcome = 'uploaded' | 'skipped';

// Skip-if-exists wrapper used by upload-media.ts so it can report skipped vs uploaded.
export async function ensureUploaded(
  backend: StorageBackend,
  localPath: string,
  remoteKey: string,
  contentType: string,
): Promise<UploadOutcome> {
  if (await backend.exists(remoteKey)) return 'skipped';
  await backend.upload(localPath, remoteKey, contentType);
  return 'uploaded';
}
