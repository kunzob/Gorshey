// The only file that imports @supabase/realtime-js. Maps the client onto the PresenceTransport interface.
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import type { PresenceConfig } from './config';
import type { PresenceTransport } from './presence';

const CHANNEL = 'gorshey-kora';

export function createSupabaseTransport(cfg: PresenceConfig, key: string): PresenceTransport {
  const wsBase = cfg.url.replace(/^http/, 'ws');
  const client = new RealtimeClient(`${wsBase}/realtime/v1`, { params: { apikey: cfg.key } });
  const channel: RealtimeChannel = client.channel(CHANNEL, { config: { presence: { key, enabled: true } } });
  return {
    subscribe(onStatus, onSync) {
      channel.on('presence', { event: 'sync' }, () => onSync(Object.keys(channel.presenceState())));
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onStatus(status);
        }
      });
    },
    track(payload) {
      void channel.track(payload).catch(() => undefined);
    },
    untrack() {
      void channel.untrack().catch(() => undefined);
    },
    close() {
      void channel.unsubscribe();
      client.disconnect();
    },
  };
}
