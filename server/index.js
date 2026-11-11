import { serve } from '@hono/node-server';
import { ShafSyncStore } from './store.js';
import { ClockManager } from './clock.js';
import { SseHub } from './sse.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const store = new ShafSyncStore();
  const clock = new ClockManager(store.dataDir);
  const sse = new SseHub();

  await clock.restoreBookmarkOnBoot();
  clock.startPeriodicBookmark(60_000);

  const app = createApp({ store, clock, sse });

  serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: '0.0.0.0'
    },
    (info) => {
      console.log(`[ShafSync] Local Appliance Server berjalan di http://0.0.0.0:${info.port}`);
      console.log(`[ShafSync] Kiosk View : http://localhost:${info.port}/`);
      console.log(`[ShafSync] Admin View : http://localhost:${info.port}/admin`);
    }
  );
}

main().catch((err) => {
  console.error('[ShafSync] Gagal menjalankan server:', err);
  process.exit(1);
});
