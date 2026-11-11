import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { calculatePrayerTimes, toHijriDate } from '../src/shared/hisab.js';

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon'
};

export function createApp({ store, clock, sse, distDir = path.resolve(process.cwd(), 'dist') }) {
  const app = new Hono();
  const activeTokens = new Map(); // token -> expiresAtMs

  function createSessionToken() {
    const token = crypto.randomBytes(24).toString('hex');
    // Masa berlaku token 7 hari untuk kemudahan takmir
    activeTokens.set(token, Date.now() + 7 * 24 * 3600 * 1000);
    return token;
  }

  function isValidToken(authHeader = '') {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || !activeTokens.has(token)) return false;
    const expiresAt = activeTokens.get(token);
    if (Date.now() > expiresAt) {
      activeTokens.delete(token);
      return false;
    }
    return true;
  }

  function buildDisplayBundle() {
    const now = clock.now();
    const settings = store.getPublicSettings();
    const prayerSchedule = calculatePrayerTimes({
      date: now,
      latitude: settings.latitude,
      longitude: settings.longitude,
      elevation: settings.elevation,
      timezone: settings.timezone,
      offsets: settings.prayer_offsets
    });
    const hijriDate = toHijriDate(now, settings.hijri_correction);

    return {
      serverTime: {
        iso: now.toISOString(),
        epochMs: now.getTime(),
        virtualOffsetMs: clock.virtualOffsetMs
      },
      settings,
      prayerSchedule,
      hijriDate,
      announcements: store.getActiveAnnouncements(),
      financial: store.getLatestFinancial(),
      mediaSlides: store.getActiveSlides()
    };
  }

  // Middleware autentikasi untuk endpoint admin & sinkronisasi sistem
  const requireAdmin = async (c, next) => {
    const authHeader = c.req.header('Authorization') || '';
    if (!isValidToken(authHeader)) {
      return c.json({ error: 'Akses ditolak. Silakan login PIN terlebih dahulu.' }, 401);
    }
    await next();
  };

  // 1. GET /api/display-data (Publik)
  app.get('/api/display-data', (c) => {
    return c.json(buildDisplayBundle());
  });

  // 2. GET /api/events (SSE Real-time Pipeline - Publik)
  app.get('/api/events', (c) => {
    let clientController = null;
    let heartbeatTimer = null;

    const stream = new ReadableStream({
      start(controller) {
        clientController = controller;
        sse.addClient(controller);

        const initialMsg = `event: CONNECTED\ndata: ${JSON.stringify({
          serverTimeMs: clock.now().getTime()
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(initialMsg));

        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`));
          } catch {
            clearInterval(heartbeatTimer);
            sse.removeClient(controller);
          }
        }, 25_000);
        if (typeof heartbeatTimer.unref === 'function') {
          heartbeatTimer.unref();
        }
      },
      cancel() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (clientController) sse.removeClient(clientController);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    });
  });

  // 3. POST /api/admin/login (Publik)
  app.post('/api/admin/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const pin = String(body.pin || '');
    if (!store.verifyPin(pin)) {
      return c.json({ error: 'PIN Admin tidak sesuai' }, 401);
    }
    const token = createSessionToken();
    return c.json({ ok: true, token });
  });

  // 4. GET /api/admin/config (Terproteksi)
  app.get('/api/admin/config', requireAdmin, (c) => {
    const now = clock.now();
    return c.json({
      serverTime: {
        iso: now.toISOString(),
        epochMs: now.getTime(),
        virtualOffsetMs: clock.virtualOffsetMs
      },
      settings: store.getPublicSettings(),
      announcements: store.state.announcements,
      financial_records: store.state.financial_records,
      media_slides: store.state.media_slides
    });
  });

  // 5. PUT /api/admin/config (Terproteksi)
  app.put('/api/admin/config', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const updated = store.updateSettings(body);
    sse.broadcast('DATA_UPDATED', { section: 'settings' });
    return c.json({ ok: true, settings: updated });
  });

  // 6. POST /api/system/time-sync & alias POST /api/system/time (Terproteksi)
  const handleTimeSync = async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const timestamp = body.timestamp || body.iso || body.time;
    if (!timestamp) {
      return c.json({ error: 'Parameter timestamp ISO wajib diisi' }, 400);
    }

    try {
      const result = await clock.syncFromPhone(timestamp);
      sse.broadcast('TIME_RESYNCED', {
        syncedAt: result.syncedAt,
        epochMs: clock.now().getTime()
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  };
  app.post('/api/system/time-sync', requireAdmin, handleTimeSync);
  app.post('/api/system/time', requireAdmin, handleTimeSync);

  // 7. POST /api/admin/financial (Terproteksi)
  app.post('/api/admin/financial', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (body.balance_amount === undefined || Number.isNaN(Number(body.balance_amount))) {
      return c.json({ error: 'Saldo kas (balance_amount) wajib berupa angka' }, 400);
    }
    const record = store.recordFinancial(body);
    sse.broadcast('DATA_UPDATED', { section: 'financial' });
    return c.json({ ok: true, financial: record });
  });

  // 8. POST & DELETE /api/admin/announcements (Terproteksi)
  app.post('/api/admin/announcements', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.id && (!body.text || !String(body.text).trim())) {
      return c.json({ error: 'Teks pengumuman wajib diisi' }, 400);
    }
    const item = store.upsertAnnouncement(body);
    if (!item) {
      return c.json({ error: 'Pengumuman tidak ditemukan' }, 404);
    }
    sse.broadcast('DATA_UPDATED', { section: 'announcements' });
    return c.json({ ok: true, announcement: item });
  });

  app.delete('/api/admin/announcements/:id', requireAdmin, (c) => {
    const deleted = store.deleteAnnouncement(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'Pengumuman tidak ditemukan' }, 404);
    }
    sse.broadcast('DATA_UPDATED', { section: 'announcements' });
    return c.json({ ok: true });
  });

  // 9. POST, PUT & DELETE /api/admin/slides (Upload Poster Kajian / QRIS Lokal)
  app.post('/api/admin/slides', requireAdmin, async (c) => {
    const contentType = c.req.header('content-type') || '';
    let title = 'Poster Informasi';
    let durationSeconds = 12;
    let displayOrder = undefined;
    let isActive = 1;
    let filePath = '';

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      title = String(form.get('title') || title);
      durationSeconds = Number(form.get('duration_seconds')) || 12;
      displayOrder = form.get('display_order') ? Number(form.get('display_order')) : undefined;
      isActive = form.get('is_active') !== null ? Number(form.get('is_active')) : 1;

      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return c.json({ error: 'File gambar wajib diunggah' }, 400);
      }
      const ext = path.extname(file.name || '.png').toLowerCase() || '.png';
      const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
      if (!allowedExts.includes(ext)) {
        return c.json({ error: 'Format gambar harus PNG, JPG, WEBP, atau SVG' }, 400);
      }
      const safeName = `slide-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const fullDest = path.join(store.uploadsDir, safeName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(fullDest, buffer);
      filePath = `/uploads/${safeName}`;
    } else {
      const body = await c.req.json().catch(() => ({}));
      title = body.title || title;
      durationSeconds = Number(body.duration_seconds) || 12;
      displayOrder = body.display_order;
      isActive = body.is_active ?? 1;

      if (typeof body.image_base64 === 'string' && body.image_base64.startsWith('data:image/')) {
        const match = body.image_base64.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/i);
        if (!match) {
          return c.json({ error: 'Data gambar base64 tidak valid' }, 400);
        }
        const rawExt = match[1].toLowerCase();
        const ext = rawExt === 'jpeg' ? '.jpg' : rawExt === 'svg+xml' ? '.svg' : `.${rawExt}`;
        const safeName = `slide-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        const fullDest = path.join(store.uploadsDir, safeName);
        fs.writeFileSync(fullDest, Buffer.from(match[2], 'base64'));
        filePath = `/uploads/${safeName}`;
      } else if (typeof body.file_path === 'string' && body.file_path.trim()) {
        filePath = body.file_path.trim();
      } else {
        return c.json({ error: 'Gambar slide (file / image_base64 / file_path) wajib diisi' }, 400);
      }
    }

    const slide = store.addSlide({
      title,
      file_path: filePath,
      display_order: displayOrder,
      duration_seconds: durationSeconds,
      is_active: isActive
    });
    sse.broadcast('DATA_UPDATED', { section: 'slides' });
    return c.json({ ok: true, slide });
  });

  app.put('/api/admin/slides/:id', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const updated = store.updateSlide(c.req.param('id'), body);
    if (!updated) {
      return c.json({ error: 'Slide tidak ditemukan' }, 404);
    }
    sse.broadcast('DATA_UPDATED', { section: 'slides' });
    return c.json({ ok: true, slide: updated });
  });

  app.delete('/api/admin/slides/:id', requireAdmin, (c) => {
    const removed = store.deleteSlide(c.req.param('id'));
    if (!removed) {
      return c.json({ error: 'Slide tidak ditemukan' }, 404);
    }
    if (removed.file_path?.startsWith('/uploads/')) {
      const filename = path.basename(removed.file_path);
      const target = path.join(store.uploadsDir, filename);
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch {
        // Abaikan jika gagal hapus file
      }
    }
    sse.broadcast('DATA_UPDATED', { section: 'slides' });
    return c.json({ ok: true });
  });

  // Layani file gambar poster/QRIS dari folder uploads lokal
  app.get('/uploads/:filename', (c) => {
    const filename = path.basename(c.req.param('filename'));
    const filePath = path.join(store.uploadsDir, filename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return c.notFound();
    }
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  });

  // Layani static asset SPA (dist/) saat production
  app.get('*', (c) => {
    if (!fs.existsSync(distDir)) {
      return c.text('ShafSync API Server Active. Run `npm run build` for Kiosk UI.', 200);
    }
    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const candidate = path.resolve(distDir, `.${reqPath}`);
    if (
      candidate.startsWith(distDir) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      const ext = path.extname(candidate).toLowerCase();
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      return new Response(fs.readFileSync(candidate), {
        headers: { 'Content-Type': contentType }
      });
    }

    // SPA Fallback untuk route / dan /admin
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return new Response(fs.readFileSync(indexHtml), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return c.notFound();
  });

  return app;
}
