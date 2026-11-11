import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJsonSafe, writeJsonAtomic } from './store.js';

const execFileAsync = promisify(execFile);

/**
 * Pengelola Jam Sistem & Persistent Time Bookmark (Mitigasi TV Box Tanpa Baterai RTC)
 * - Menyimpan bookmark waktu setiap 60 detik ke clock.json
 * - Saat boot tanpa internet (jam OS mundur ke 1970), memajukan jam ke bookmark terakhir
 * - Menerima sinkronisasi jam 1-tap dari HP takmir: menjalankan sudo date -s & menyimpan offset
 */
export class ClockManager {
  constructor(dataDir = process.env.SHAFSYNC_DATA_DIR || path.resolve(process.cwd(), 'data'), options = {}) {
    this.clockPath = path.join(dataDir, 'clock.json');
    this.enableOsSync = options.enableOsSync ?? process.env.NODE_ENV === 'production';
    this.timer = null;

    const saved = readJsonSafe(this.clockPath, {
      lastTimestampMs: 0,
      virtualOffsetMs: 0
    });

    this.lastTimestampMs = Number(saved.lastTimestampMs) || 0;
    this.virtualOffsetMs = Number(saved.virtualOffsetMs) || 0;
  }

  /**
   * Mengembalikan objek Date waktu efektif saat ini
   */
  now() {
    return new Date(Date.now() + this.virtualOffsetMs);
  }

  /**
   * Simpan bookmark waktu saat ini secara atomik
   */
  saveBookmark() {
    const currentMs = this.now().getTime();
    this.lastTimestampMs = Math.max(this.lastTimestampMs, currentMs);
    writeJsonAtomic(this.clockPath, {
      lastTimestampMs: this.lastTimestampMs,
      virtualOffsetMs: this.virtualOffsetMs,
      updatedAt: new Date(currentMs).toISOString()
    });
  }

  /**
   * Dipanggil saat server boot: cegah jam mundur ke tahun 1970 sebelum takmir sinkronisasi
   */
  async restoreBookmarkOnBoot() {
    const sysNow = Date.now();
    if (this.lastTimestampMs > sysNow + 5000) {
      const targetDate = new Date(this.lastTimestampMs);
      const osUpdated = await this.trySetOsClock(targetDate);
      if (osUpdated) {
        this.virtualOffsetMs = 0;
      } else {
        this.virtualOffsetMs = this.lastTimestampMs - Date.now();
      }
    }
    this.saveBookmark();
  }

  /**
   * Jalankan interval penulisan bookmark setiap 60 detik
   */
  startPeriodicBookmark(intervalMs = 60_000) {
    this.stopPeriodicBookmark();
    this.timer = setInterval(() => {
      try {
        this.saveBookmark();
      } catch {
        // Jangan hentikan server bila disk sedang penuh/sibuk
      }
    }, intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stopPeriodicBookmark() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Eksekusi perintah level OS untuk menyetel waktu sistem pada Armbian/Linux TV Box
   */
  async trySetOsClock(targetDate) {
    if (!this.enableOsSync) return false;

    // Format UTC "YYYY-MM-DD HH:MM:SS" agar bebas ambiguitas timezone lokal
    const iso = targetDate.toISOString();
    const formattedUtc = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

    try {
      await execFileAsync('sudo', ['-n', 'timedatectl', 'set-ntp', 'false'], { timeout: 3000 }).catch(() => {});
      await execFileAsync('sudo', ['-n', 'date', '-u', '-s', formattedUtc], { timeout: 3000 });
      return Math.abs(Date.now() - targetDate.getTime()) < 5000;
    } catch {
      return false;
    }
  }

  /**
   * Sinkronkan waktu server dengan timestamp ISO dari HP Takmir
   */
  async syncFromPhone(isoTimestamp) {
    const parsed = new Date(isoTimestamp);
    const targetMs = parsed.getTime();
    if (Number.isNaN(targetMs) || targetMs < 1700000000000) {
      throw new Error('Format timestamp tidak valid atau tahun terlalu lampau');
    }

    const osUpdated = await this.trySetOsClock(parsed);
    if (osUpdated) {
      this.virtualOffsetMs = 0;
    } else {
      // Fallback: simpan selisih waktu di memori & clock.json agar jam TV tetap akurat 100%
      this.virtualOffsetMs = targetMs - Date.now();
    }

    this.lastTimestampMs = targetMs;
    this.saveBookmark();

    return {
      syncedAt: this.now().toISOString(),
      osClockUpdated: osUpdated,
      virtualOffsetMs: this.virtualOffsetMs
    };
  }
}
