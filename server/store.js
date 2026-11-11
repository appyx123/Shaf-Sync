import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Atomic write helper: tulis ke file .tmp, fsync ke disk, backup file lama ke .bak, lalu rename.
 * Mencegah korupsi JSON saat listrik masjid padam mendadak.
 */
export function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}`;
  const bakPath = `${filePath}.bak`;
  const payload = JSON.stringify(data, null, 2);

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch {
      // Abaikan jika gagal menyalin backup
    }
  }

  fs.renameSync(tmpPath, filePath);
}

/**
 * Baca file JSON dengan fallback otomatis ke .bak bila file utama rusak akibat mati listrik
 */
export function readJsonSafe(filePath, fallbackValue) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Coba kandidat berikutnya (.bak)
    }
  }
  return structuredClone(fallbackValue);
}

export function hashPin(pin) {
  return crypto.createHash('sha256').update(`shafsync-pin:${String(pin)}`).digest('hex');
}

export function createDefaultState() {
  return {
    settings: {
      mosque_name: 'Masjid Al-Ikhlas',
      mosque_address: 'Jl. Melati Raya No. 12, Jakarta',
      latitude: -6.1702,
      longitude: 106.831,
      elevation: 10,
      timezone: 7,
      hijri_correction: 0,
      azan_duration: 3,
      sholat_duration: 15,
      iqomah_durations: {
        subuh: 12,
        dzuhur: 8,
        ashar: 8,
        maghrib: 7,
        isya: 10
      },
      prayer_offsets: {
        subuh: 0,
        terbit: 0,
        dzuhur: 0,
        ashar: 0,
        maghrib: 0,
        isya: 0
      },
      pin_hash: hashPin('123456')
    },
    announcements: [
      {
        id: 1,
        text: 'Mohon luruskan dan rapatkan shaf sebelum sholat berjamaah dimulai.',
        is_active: 1,
        priority: 2,
        created_at: '2026-11-11T00:00:00.000Z'
      },
      {
        id: 2,
        text: 'Harap menonaktifkan atau mengheningkan ponsel selama berada di dalam masjid.',
        is_active: 1,
        priority: 1,
        created_at: '2026-11-11T00:00:00.000Z'
      }
    ],
    financial_records: [
      {
        id: 1,
        balance_amount: 12500000,
        weekly_income: 2350000,
        weekly_expense: 850000,
        recorded_date: '2026-11-11',
        note: 'Saldo Kas Masjid Pekan Ini'
      }
    ],
    media_slides: []
  };
}

export class ShafSyncStore {
  constructor(dataDir = process.env.SHAFSYNC_DATA_DIR || path.resolve(process.cwd(), 'data')) {
    this.dataDir = dataDir;
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.dbPath = path.join(this.dataDir, 'db.json');

    fs.mkdirSync(this.uploadsDir, { recursive: true });

    const defaults = createDefaultState();
    this.state = readJsonSafe(this.dbPath, defaults);

    // Pastikan seluruh key default tetap ada jika versi skema bertambah
    this.state.settings = {
      ...defaults.settings,
      ...(this.state.settings || {}),
      iqomah_durations: {
        ...defaults.settings.iqomah_durations,
        ...(this.state.settings?.iqomah_durations || {})
      },
      prayer_offsets: {
        ...defaults.settings.prayer_offsets,
        ...(this.state.settings?.prayer_offsets || {})
      }
    };
    this.state.announcements = Array.isArray(this.state.announcements)
      ? this.state.announcements
      : defaults.announcements;
    this.state.financial_records = Array.isArray(this.state.financial_records)
      ? this.state.financial_records
      : defaults.financial_records;
    this.state.media_slides = Array.isArray(this.state.media_slides)
      ? this.state.media_slides
      : defaults.media_slides;

    if (!fs.existsSync(this.dbPath)) {
      this.save();
    }
  }

  save() {
    writeJsonAtomic(this.dbPath, this.state);
  }

  getPublicSettings() {
    const { pin_hash, ...rest } = this.state.settings;
    return structuredClone(rest);
  }

  verifyPin(pin) {
    if (!pin || typeof pin !== 'string') return false;
    return this.state.settings.pin_hash === hashPin(pin.trim());
  }

  updateSettings(patch = {}) {
    const current = this.state.settings;
    const next = { ...current };

    if (typeof patch.mosque_name === 'string' && patch.mosque_name.trim()) {
      next.mosque_name = patch.mosque_name.trim();
    }
    if (typeof patch.mosque_address === 'string') {
      next.mosque_address = patch.mosque_address.trim();
    }
    if (patch.latitude !== undefined && !Number.isNaN(Number(patch.latitude))) {
      next.latitude = Math.max(-90, Math.min(90, Number(patch.latitude)));
    }
    if (patch.longitude !== undefined && !Number.isNaN(Number(patch.longitude))) {
      next.longitude = Math.max(-180, Math.min(180, Number(patch.longitude)));
    }
    if (patch.elevation !== undefined && !Number.isNaN(Number(patch.elevation))) {
      next.elevation = Math.max(0, Number(patch.elevation));
    }
    if (patch.timezone !== undefined && !Number.isNaN(Number(patch.timezone))) {
      next.timezone = Number(patch.timezone);
    }
    if (patch.hijri_correction !== undefined && !Number.isNaN(Number(patch.hijri_correction))) {
      next.hijri_correction = Math.max(-2, Math.min(2, Math.trunc(Number(patch.hijri_correction))));
    }
    if (patch.azan_duration !== undefined && !Number.isNaN(Number(patch.azan_duration))) {
      next.azan_duration = Math.max(1, Math.min(15, Math.trunc(Number(patch.azan_duration))));
    }
    if (patch.sholat_duration !== undefined && !Number.isNaN(Number(patch.sholat_duration))) {
      next.sholat_duration = Math.max(1, Math.min(45, Math.trunc(Number(patch.sholat_duration))));
    }
    if (patch.iqomah_durations && typeof patch.iqomah_durations === 'object') {
      const updatedIqomah = { ...next.iqomah_durations };
      for (const k of ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']) {
        if (patch.iqomah_durations[k] !== undefined && !Number.isNaN(Number(patch.iqomah_durations[k]))) {
          updatedIqomah[k] = Math.max(1, Math.min(30, Math.trunc(Number(patch.iqomah_durations[k]))));
        }
      }
      next.iqomah_durations = updatedIqomah;
    }
    if (patch.prayer_offsets && typeof patch.prayer_offsets === 'object') {
      const updatedOffsets = { ...next.prayer_offsets };
      for (const k of ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya']) {
        if (patch.prayer_offsets[k] !== undefined && !Number.isNaN(Number(patch.prayer_offsets[k]))) {
          updatedOffsets[k] = Math.max(-10, Math.min(10, Math.trunc(Number(patch.prayer_offsets[k]))));
        }
      }
      next.prayer_offsets = updatedOffsets;
    }
    if (typeof patch.new_pin === 'string' && /^\d{4,6}$/.test(patch.new_pin.trim())) {
      next.pin_hash = hashPin(patch.new_pin.trim());
    }

    this.state.settings = next;
    this.save();
    return this.getPublicSettings();
  }

  getActiveAnnouncements() {
    return this.state.announcements
      .filter((a) => Boolean(a.is_active))
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id);
  }

  upsertAnnouncement(payload) {
    const list = this.state.announcements;
    if (payload.id) {
      const idx = list.findIndex((a) => a.id === Number(payload.id));
      if (idx === -1) return null;
      list[idx] = {
        ...list[idx],
        text: typeof payload.text === 'string' ? payload.text.trim() : list[idx].text,
        is_active: payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : list[idx].is_active,
        priority: payload.priority !== undefined ? Number(payload.priority) || 0 : list[idx].priority
      };
      this.save();
      return list[idx];
    }

    const nextId = list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
    const item = {
      id: nextId,
      text: String(payload.text || '').trim(),
      is_active: payload.is_active === undefined || payload.is_active ? 1 : 0,
      priority: Number(payload.priority) || 0,
      created_at: new Date().toISOString()
    };
    list.push(item);
    this.save();
    return item;
  }

  deleteAnnouncement(id) {
    const before = this.state.announcements.length;
    this.state.announcements = this.state.announcements.filter((a) => a.id !== Number(id));
    if (this.state.announcements.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  getLatestFinancial() {
    const list = this.state.financial_records;
    if (!list.length) return null;
    return list[list.length - 1];
  }

  recordFinancial(payload) {
    const list = this.state.financial_records;
    const nextId = list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
    const item = {
      id: nextId,
      balance_amount: Number(payload.balance_amount) || 0,
      weekly_income: Number(payload.weekly_income) || 0,
      weekly_expense: Number(payload.weekly_expense) || 0,
      recorded_date: payload.recorded_date || new Date().toISOString().slice(0, 10),
      note: typeof payload.note === 'string' ? payload.note.trim() : ''
    };
    list.push(item);
    // Simpan maksimal 52 catatan pekanan terakhir agar file JSON tetap ramping
    if (list.length > 52) {
      this.state.financial_records = list.slice(-52);
    }
    this.save();
    return item;
  }

  getActiveSlides() {
    return this.state.media_slides
      .filter((s) => Boolean(s.is_active))
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || a.id - b.id);
  }

  addSlide(payload) {
    const list = this.state.media_slides;
    const nextId = list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
    const item = {
      id: nextId,
      title: String(payload.title || 'Slide Informasi').trim(),
      file_path: String(payload.file_path || '').trim(),
      display_order: Number(payload.display_order) || nextId,
      duration_seconds: Math.max(3, Math.min(120, Number(payload.duration_seconds) || 12)),
      is_active: payload.is_active === undefined || payload.is_active ? 1 : 0
    };
    list.push(item);
    this.save();
    return item;
  }

  updateSlide(id, patch) {
    const idx = this.state.media_slides.findIndex((s) => s.id === Number(id));
    if (idx === -1) return null;
    const cur = this.state.media_slides[idx];
    this.state.media_slides[idx] = {
      ...cur,
      title: typeof patch.title === 'string' ? patch.title.trim() : cur.title,
      display_order: patch.display_order !== undefined ? Number(patch.display_order) || 0 : cur.display_order,
      duration_seconds:
        patch.duration_seconds !== undefined
          ? Math.max(3, Math.min(120, Number(patch.duration_seconds) || 12))
          : cur.duration_seconds,
      is_active: patch.is_active !== undefined ? (patch.is_active ? 1 : 0) : cur.is_active
    };
    this.save();
    return this.state.media_slides[idx];
  }

  deleteSlide(id) {
    const idx = this.state.media_slides.findIndex((s) => s.id === Number(id));
    if (idx === -1) return null;
    const [removed] = this.state.media_slides.splice(idx, 1);
    this.save();
    return removed;
  }
}
