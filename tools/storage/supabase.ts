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

    async exists(remoteKey) {
      const { data, error } = await bucket().exists(remoteKey);
      if (error) {
        throw new Error(`supabase exists check failed for ${remoteKey}: ${error.message}`);
      }
      return data;
    },
  };
}
