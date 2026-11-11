import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ShafSyncStore } from '../server/store.js';
import { ClockManager } from '../server/clock.js';
import { SseHub } from '../server/sse.js';
import { createApp } from '../server/app.js';

function createTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shafsync-test-'));
  const store = new ShafSyncStore(tmpDir);
  const clock = new ClockManager(tmpDir, { enableOsSync: false });
  const sse = new SseHub();
  const app = createApp({ store, clock, sse });
  return { tmpDir, store, clock, sse, app };
}

test('Atomic JSON Store memulihkan data dari db.json.bak jika db.json rusak saat mati listrik', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shafsync-atomic-'));
  const store1 = new ShafSyncStore(tmpDir);
  store1.updateSettings({ mosque_name: 'Masjid Agung Nusantara' });
  // Pemicu penulisan kedua agar db.json.bak memiliki "Masjid Agung Nusantara"
  store1.updateSettings({ mosque_address: 'Jl. Merdeka 45' });

  // Simulasikan korupsi file db.json akibat listrik padam di tengah tulis
  fs.writeFileSync(path.join(tmpDir, 'db.json'), '{corrupted-json', 'utf8');

  const recoveredStore = new ShafSyncStore(tmpDir);
  assert.equal(recoveredStore.getPublicSettings().mosque_name, 'Masjid Agung Nusantara');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /api/display-data mengembalikan jadwal sholat, hijriah, pengumuman, dan kas tanpa pin_hash', async () => {
  const { tmpDir, app } = createTestEnv();

  const res = await app.request('/api/display-data');
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.settings.mosque_name, 'Masjid Al-Ikhlas');
  assert.equal(data.settings.pin_hash, undefined);
  assert.ok(data.prayerSchedule.times.subuh);
  assert.ok(data.prayerSchedule.times.maghrib);
  assert.ok(data.hijriDate.formatted.endsWith(' H'));
  assert.equal(data.announcements.length, 2);
  assert.equal(data.financial.balance_amount, 12500000);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Alur Admin: Login PIN, Update Config, Time Sync, Kas, Pengumuman, dan Upload Slide', async () => {
  const { tmpDir, app } = createTestEnv();

  // 1. Akses tanpa token harus ditolak (401)
  const unauth = await app.request('/api/admin/config');
  assert.equal(unauth.status, 401);

  // 2. Login dengan PIN salah harus ditolak (401)
  const badLogin = await app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '000000' })
  });
  assert.equal(badLogin.status, 401);

  // 3. Login dengan PIN default (123456) berhasil
  const loginRes = await app.request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '123456' })
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  assert.ok(token);

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 4. PUT /api/admin/config mengubah nama masjid, durasi iqomah, dan offset
  const putConfig = await app.request('/api/admin/config', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      mosque_name: 'Masjid Jami Al-Hidayah',
      hijri_correction: -1,
      iqomah_durations: { subuh: 15, maghrib: 5 },
      prayer_offsets: { subuh: 2 }
    })
  });
  assert.equal(putConfig.status, 200);
  const updatedCfg = await putConfig.json();
  assert.equal(updatedCfg.settings.mosque_name, 'Masjid Jami Al-Hidayah');
  assert.equal(updatedCfg.settings.iqomah_durations.subuh, 15);
  assert.equal(updatedCfg.settings.prayer_offsets.subuh, 2);

  // 5. POST /api/system/time-sync menyelaraskan waktu server dengan waktu HP takmir
  const phoneTime = '2026-11-15T14:30:00.000Z';
  const syncRes = await app.request('/api/system/time-sync', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ timestamp: phoneTime })
  });
  assert.equal(syncRes.status, 200);
  const syncData = await syncRes.json();
  assert.ok(Math.abs(new Date(syncData.syncedAt).getTime() - new Date(phoneTime).getTime()) < 1500);

  // 6. POST /api/admin/financial memperbarui saldo kas
  const finRes = await app.request('/api/admin/financial', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      balance_amount: 18750000,
      weekly_income: 3200000,
      weekly_expense: 950000,
      note: 'Kas Jumat Pekan ke-2'
    })
  });
  assert.equal(finRes.status, 200);

  // 7. POST /api/admin/announcements menambah running text baru
  const annRes = await app.request('/api/admin/announcements', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      text: 'Kajian Ba\'da Maghrib bersama Ust. Ahmad',
      priority: 5,
      is_active: 1
    })
  });
  assert.equal(annRes.status, 200);

  // 8. POST /api/admin/slides mengunggah gambar QRIS base64
  const tinyPngBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const slideRes = await app.request('/api/admin/slides', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      title: 'Infaq QRIS Masjid',
      image_base64: tinyPngBase64,
      duration_seconds: 15
    })
  });
  assert.equal(slideRes.status, 200);
  const { slide } = await slideRes.json();
  assert.ok(slide.file_path.startsWith('/uploads/'));

  // Pastikan file gambar yang diunggah bisa diakses oleh Kiosk
  const imgRes = await app.request(slide.file_path);
  assert.equal(imgRes.status, 200);
  assert.equal(imgRes.headers.get('content-type'), 'image/png');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
