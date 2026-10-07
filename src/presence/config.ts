// Presence config from the repo's existing env names only. Missing or empty means presence is disabled.
export interface PresenceConfig {
  url: string;
  key: string;
}

export function readConfig(env: Record<string, string | undefined>): PresenceConfig | null {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}
