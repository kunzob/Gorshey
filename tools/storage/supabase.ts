// Supabase Storage backend (current). Uses the service-role client supplied by the caller;
// upload-media.ts is responsible for loading that key from tools/.supabase-service-key.env.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type ReadFile, type StorageBackend } from './types';

export const SUPABASE_CACHE_CONTROL = '31536000';

export interface SupabaseBackendOptions {
  client: Pick<SupabaseClient, 'storage'>;
  bucket: string;
  readFile: ReadFile;
}

export function createSupabaseBackend(opts: SupabaseBackendOptions): StorageBackend {
  const bucket = () => opts.client.storage.from(opts.bucket);

  return {
    async upload(localPath, remoteKey, contentType) {
      const body = await opts.readFile(localPath);
      const { error } = await bucket().upload(remoteKey, body, {
        contentType,
        cacheControl: SUPABASE_CACHE_CONTROL,
        upsert: false,
      });
      if (error) {
        throw new Error(`supabase upload failed for ${remoteKey}: ${error.message}`);
      }
    },

    // Asks "is this name in its folder?" by listing, instead of HEAD-ing the object. Supabase
    // answers a HEAD for a missing object with a bodyless HTTP 400, which is indistinguishable
    // from a real bad request. A listing answers "missing" with an empty array and no error,
    // so any error that does come back (bad key, permissions, network) is a real failure.
    async exists(remoteKey) {
      const slash = remoteKey.lastIndexOf('/');
      const folder = slash >= 0 ? remoteKey.slice(0, slash) : '';
      const name = remoteKey.slice(slash + 1);
      const { data, error } = await bucket().list(folder, { search: name, limit: 100 });
      if (error) {
        throw new Error(`supabase exists check failed for ${remoteKey}: ${error.message}`);
      }
      return (data ?? []).some((entry) => entry.name === name);
    },
  };
}
