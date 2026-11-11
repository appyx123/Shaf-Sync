import { useState, useEffect, useMemo } from 'preact/hooks';
import {
  MosqueIcon,
  ClockSyncIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  MapPinIcon,
  SlidersIcon,
  WalletIcon,
  MegaphoneIcon,
  TvIcon,
  TrashIcon
} from './icons.jsx';

const TOKEN_STORAGE_KEY = 'shafsync_admin_token';

function compressImageToBase64(file, maxWidth = 1600, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(outType, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatHMS(date) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function formatRupiah(num) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(num) || 0);
}

const INPUT_CLASS =
  'w-full min-h-[44px] bg-[#0F172A] border border-slate-600 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/40 transition-colors';

const PRIMARY_BTN_CLASS =
  'w-full min-h-[48px] bg-[#F59E0B] hover:bg-amber-400 active:opacity-90 disabled:opacity-50 text-slate-950 font-extrabold py-3 px-4 rounded-xl text-sm shadow-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white inline-flex items-center justify-center gap-2';

export function AdminView() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '');
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('time');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const [phoneNowMs, setPhoneNowMs] = useState(() => Date.now());
  const [serverDeltaMs, setServerDeltaMs] = useState(0);

  const [settings, setSettings] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [announcements, setAnnouncements] = useState([]);
  const [financialRecords, setFinancialRecords] = useState([]);
  const [mediaSlides, setMediaSlides] = useState([]);

  const [finForm, setFinForm] = useState({
    balance_amount: '',
    weekly_income: '',
    weekly_expense: '',
    note: ''
  });
  const [newAnnouncementText, setNewAnnouncementText] = useState('');
  const [slideTitle, setSlideTitle] = useState('');
  const [slideDuration, setSlideDuration] = useState(12);
  const [slideFile, setSlideFile] = useState(null);

  function showNotification(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function apiRequest(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken('');
      throw new Error('Sesi berakhir, silakan masukkan kembali PIN Admin.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Terjadi kesalahan pada server');
    }
    return data;
  }

  async function loadAdminConfig() {
    if (!token) return;
    try {
      const data = await apiRequest('/api/admin/config');
      setSettings(data.settings);
      setAnnouncements(data.announcements || []);
      setFinancialRecords(data.financial_records || []);
      setMediaSlides(data.media_slides || []);

      if (data.serverTime?.epochMs) {
        setServerDeltaMs(data.serverTime.epochMs - Date.now());
      }

      const latestFin = data.financial_records?.[data.financial_records.length - 1];
      if (latestFin) {
        setFinForm({
          balance_amount: latestFin.balance_amount,
          weekly_income: latestFin.weekly_income,
          weekly_expense: latestFin.weekly_expense,
          note: latestFin.note || ''
        });
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  useEffect(() => {
    if (token) loadAdminConfig();
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setPhoneNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const tvNowMs = phoneNowMs + serverDeltaMs;
  const driftSeconds = useMemo(
    () => Math.round(Math.abs(tvNowMs - phoneNowMs) / 1000),
    [tvNowMs, phoneNowMs]
  );
  const isDriftWarning = driftSeconds > 60;

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.error || 'PIN tidak valid');
        return;
      }
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      setToken(data.token);
      setPinInput('');
    } catch {
      setAuthError('Gagal menghubungi server lokal');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken('');
    setSettings(null);
  }

  async function handleSyncTimeNow() {
    setLoading(true);
    try {
      const nowIso = new Date().toISOString();
      const res = await apiRequest('/api/system/time-sync', {
        method: 'POST',
        body: JSON.stringify({ timestamp: nowIso })
      });
      const syncedEpoch = new Date(res.syncedAt).getTime();
      setServerDeltaMs(syncedEpoch - Date.now());
      showNotification('Jam TV berhasil disinkronkan dengan Jam HP!');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    if (!settings) return;
    setLoading(true);
    try {
      const payload = { ...settings };
      if (newPin.trim()) {
        if (!/^\d{4,6}$/.test(newPin.trim())) {
          showNotification('PIN baru harus terdiri dari 4 hingga 6 angka', 'error');
          setLoading(false);
          return;
        }
        payload.new_pin = newPin.trim();
      }
      const res = await apiRequest('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setSettings(res.settings);
      setNewPin('');
      showNotification('Pengaturan berhasil disimpan & diterapkan ke TV!');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleUsePhoneGps() {
    if (!navigator.geolocation) {
      showNotification('Browser HP ini tidak mendukung lokasi GPS', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSettings((prev) => ({
          ...prev,
          latitude: Number(pos.coords.latitude.toFixed(5)),
          longitude: Number(pos.coords.longitude.toFixed(5)),
          elevation: pos.coords.altitude ? Math.max(0, Math.round(pos.coords.altitude)) : prev.elevation
        }));
        showNotification('Koordinat GPS HP berhasil diambil! Klik Simpan di bawah.');
      },
      () => {
        showNotification('Gagal mengambil GPS. Pastikan izin lokasi aktif atau isi manual.', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function handleSaveFinancial(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/financial', {
        method: 'POST',
        body: JSON.stringify({
          balance_amount: Number(finForm.balance_amount) || 0,
          weekly_income: Number(finForm.weekly_income) || 0,
          weekly_expense: Number(finForm.weekly_expense) || 0,
          note: finForm.note
        })
      });
      setFinancialRecords((prev) => [...prev, res.financial]);
      showNotification('Laporan saldo kas masjid berhasil diperbarui di layar TV!');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAnnouncement(e) {
    e.preventDefault();
    if (!newAnnouncementText.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          text: newAnnouncementText.trim(),
          is_active: 1,
          priority: 1
        })
      });
      setAnnouncements((prev) => [...prev, res.announcement]);
      setNewAnnouncementText('');
      showNotification('Teks berjalan berhasil ditambahkan!');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleAnnouncement(item) {
    try {
      const res = await apiRequest('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({
          id: item.id,
          is_active: item.is_active ? 0 : 1
        })
      });
      setAnnouncements((prev) => prev.map((a) => (a.id === item.id ? res.announcement : a)));
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  async function handleDeleteAnnouncement(id) {
    try {
      await apiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      showNotification('Pengumuman dihapus.');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  async function handleUploadSlide(e) {
    e.preventDefault();
    if (!slideFile) {
      showNotification('Pilih file gambar poster atau QRIS terlebih dahulu', 'error');
      return;
    }
    setLoading(true);
    try {
      const base64Image = await compressImageToBase64(slideFile);
      const res = await apiRequest('/api/admin/slides', {
        method: 'POST',
        body: JSON.stringify({
          title: slideTitle.trim() || 'Poster Informasi Masjid',
          duration_seconds: Number(slideDuration) || 12,
          image_base64: base64Image,
          is_active: 1
        })
      });
      setMediaSlides((prev) => [...prev, res.slide]);
      setSlideTitle('');
      setSlideFile(null);
      e.target.reset();
      showNotification('Poster / QRIS berhasil diunggah ke layar TV!');
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleSlide(slide) {
    try {
      const res = await apiRequest(`/api/admin/slides/${slide.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: slide.is_active ? 0 : 1 })
      });
      setMediaSlides((prev) => prev.map((s) => (s.id === slide.id ? res.slide : s)));
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  async function handleDeleteSlide(id) {
    try {
      await apiRequest(`/api/admin/slides/${id}`, { method: 'DELETE' });
      setMediaSlides((prev) => prev.filter((s) => s.id !== id));
      showNotification('Slide gambar berhasil dihapus.');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }

  // ==========================================================================
  // TAMPILAN LOGIN PIN DKM (4 - 6 DIGIT)
  // ==========================================================================
  if (!token) {
    return (
      <div class="min-h-screen bg-islamic-pattern text-white flex items-center justify-center p-4">
        <div class="bg-[#334155] border border-slate-600/80 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
          <div class="text-center mb-6">
            <div class="w-16 h-16 rounded-2xl bg-[#0F172A] border-2 border-[#F59E0B]/60 text-[#F59E0B] flex items-center justify-center mx-auto mb-3">
              <MosqueIcon className="w-8 h-8" />
            </div>
            <h1 class="text-2xl font-extrabold text-white">Panel Takmir DKM</h1>
            <p class="text-sm text-slate-300 mt-1">
              Masukkan PIN Admin untuk mengelola layar TV Masjid
            </p>
          </div>

          <form onSubmit={handleLogin} class="space-y-4">
            <div>
              <label
                htmlFor="admin-pin-input"
                class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5"
              >
                PIN Keamanan (4–6 Digit)
              </label>
              <input
                id="admin-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                value={pinInput}
                onInput={(e) => setPinInput(e.target.value)}
                placeholder="••••••"
                class="w-full min-h-[52px] bg-[#0F172A] border border-slate-600 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/40 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.4em] font-bold text-white outline-none tabular-nums placeholder:text-slate-600"
                required
              />
            </div>

            {authError && (
              <div
                role="alert"
                class="bg-rose-500/20 border border-rose-500/50 text-rose-200 text-sm rounded-xl px-3.5 py-2.5 flex items-center justify-center gap-2"
              >
                <AlertTriangleIcon className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{authError}</span>
              </div>
            )}

            <button type="submit" disabled={loading} class={PRIMARY_BTN_CLASS}>
              {loading ? 'Memeriksa...' : 'Masuk Dashboard'}
            </button>

            <p class="text-xs text-center text-[#94A3B8] pt-1">
              PIN bawaan instalasi awal: <span class="text-slate-200 font-mono font-bold">123456</span>
            </p>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // TAMPILAN DASHBOARD MOBILE ADMIN (DENGAN BOTTOM NAV 5 MENU)
  // ==========================================================================
  const tabs = [
    { id: 'time', label: 'Jam & Sync', Icon: ClockSyncIcon, badge: isDriftWarning },
    { id: 'profile', label: 'Profil', Icon: MosqueIcon },
    { id: 'timers', label: 'Timer', Icon: SlidersIcon },
    { id: 'finance', label: 'Kas', Icon: WalletIcon },
    { id: 'content', label: 'Konten', Icon: MegaphoneIcon }
  ];

  return (
    <div class="min-h-screen bg-[#1E293B] text-white pb-24 md:pb-12">
      {/* Header Atas Mobile */}
      <header class="sticky top-0 z-30 bg-[#0F172A]/95 backdrop-blur border-b border-slate-700/80 px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] flex items-center justify-center shrink-0">
            <MosqueIcon className="w-5 h-5" />
          </div>
          <div class="min-w-0">
            <h1 class="text-base font-extrabold text-white leading-tight truncate">
              {settings?.mosque_name || 'ShafSync Admin'}
            </h1>
            <p class="text-xs text-[#94A3B8]">Pengaturan Layar Kiosk Masjid</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <a
            href="/"
            target="_blank"
            class="min-h-[44px] px-3.5 rounded-xl bg-[#334155] hover:bg-slate-600 text-xs font-bold text-slate-100 inline-flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-[#F59E0B]"
          >
            <TvIcon className="w-4 h-4 text-[#F59E0B]" />
            <span>Layar TV</span>
          </a>
          <button
            type="button"
            onClick={handleLogout}
            class="min-h-[44px] px-3.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-200 text-xs font-bold cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            Keluar
          </button>
        </div>
      </header>

      {/* Navigasi Desktop/Tablet (md ke atas) */}
      <nav
        aria-label="Menu Pengaturan"
        class="hidden md:flex max-w-lg mx-auto px-4 pt-4 gap-2"
      >
        {tabs.map(({ id, label, Icon, badge }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            class={`flex-1 min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#F59E0B] ${
              activeTab === id
                ? 'bg-[#F59E0B] text-slate-950 shadow'
                : 'bg-[#334155] text-slate-200 hover:bg-slate-600'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{label}</span>
            {badge && <span class="w-2 h-2 rounded-full bg-rose-500" />}
          </button>
        ))}
      </nav>

      {/* Notifikasi Toast Aksesibel */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          class="fixed bottom-20 md:bottom-6 left-4 right-4 z-50 max-w-md mx-auto"
        >
          <div
            class={`rounded-xl px-4 py-3 text-sm font-bold shadow-2xl border flex items-center gap-2.5 ${
              toast.type === 'error'
                ? 'bg-rose-950/95 border-rose-500 text-rose-100'
                : 'bg-emerald-950/95 border-emerald-500 text-emerald-100'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangleIcon className="w-5 h-5 text-rose-400 shrink-0" />
            ) : (
              <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Peringatan Global jika Jam TV Meleset > 60 Detik */}
      {isDriftWarning && (
        <div
          role="alert"
          class="max-w-lg mx-auto px-4 mt-3"
        >
          <div class="bg-amber-500/20 border-2 border-[#F59E0B] rounded-2xl p-3.5 flex items-center justify-between gap-3">
            <div class="flex items-start gap-2.5">
              <AlertTriangleIcon className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
              <div>
                <div class="text-xs font-extrabold uppercase tracking-wider text-[#F59E0B]">
                  Peringatan Jam TV Meleset ({driftSeconds} detik)
                </div>
                <p class="text-xs text-slate-200 mt-0.5">
                  Jam TV berbeda dari jam HP Anda (kemungkinan habis mati listrik).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncTimeNow}
              class="min-h-[44px] shrink-0 bg-[#F59E0B] hover:bg-amber-400 text-slate-950 font-extrabold text-xs px-4 rounded-xl cursor-pointer transition-colors"
            >
              Sinkronkan
            </button>
          </div>
        </div>
      )}

      {/* KONTEN UTAMA */}
      <main class="max-w-lg mx-auto p-4 space-y-4">
        {/* ================================================================ */}
        {/* TAB 1: STATUS JAM & ONE-TAP PHONE TIME SYNC                      */}
        {/* ================================================================ */}
        {activeTab === 'time' && (
          <section class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-5 shadow-lg">
            <div>
              <h2 class="text-lg font-extrabold text-white">
                Sinkronisasi Jam TV (Tanpa Internet)
              </h2>
              <p class="text-xs text-slate-300 mt-1 leading-relaxed">
                TV Box tidak memiliki baterai CMOS/RTC. Tekan tombol di bawah untuk menyamakan jam TV dengan jam HP Anda.
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="bg-[#0F172A] border border-slate-700 rounded-2xl p-4 text-center">
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                  Jam di Layar TV
                </div>
                <div class="text-2xl font-black tabular-nums text-white mt-1.5">
                  {formatHMS(new Date(tvNowMs))}
                </div>
                <div class="text-xs text-[#94A3B8] mt-1 tabular-nums">
                  {new Date(tvNowMs).toLocaleDateString('id-ID')}
                </div>
              </div>

              <div class="bg-[#0F172A] border-2 border-[#F59E0B]/50 rounded-2xl p-4 text-center">
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#F59E0B]">
                  Jam di HP Anda
                </div>
                <div class="text-2xl font-black tabular-nums text-[#F59E0B] mt-1.5">
                  {formatHMS(new Date(phoneNowMs))}
                </div>
                <div class="text-xs text-slate-300 mt-1 tabular-nums">
                  {new Date(phoneNowMs).toLocaleDateString('id-ID')}
                </div>
              </div>
            </div>

            <div
              class={`rounded-xl px-4 py-3 text-xs font-semibold flex items-center justify-between ${
                isDriftWarning
                  ? 'bg-rose-500/20 border border-rose-500/40 text-rose-200'
                  : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-200'
              }`}
            >
              <span class="flex items-center gap-2">
                {isDriftWarning ? (
                  <AlertTriangleIcon className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircleIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span>
                  Selisih Waktu: <strong class="tabular-nums">{driftSeconds} detik</strong>
                </span>
              </span>
              <span class="font-bold">{isDriftWarning ? 'Perlu Sinkronisasi' : 'Akurat & Sinkron'}</span>
            </div>

            <button
              type="button"
              onClick={handleSyncTimeNow}
              disabled={loading}
              class={PRIMARY_BTN_CLASS}
            >
              <ClockSyncIcon className="w-5 h-5" />
              <span>{loading ? 'Menyinkronkan...' : 'Sinkronkan Jam TV dengan Jam HP'}</span>
            </button>
          </section>
        )}

        {/* ================================================================ */}
        {/* TAB 2: PROFIL MASJID, KOORDINAT HISAB, KOREKSI HIJRIAH & PIN     */}
        {/* ================================================================ */}
        {activeTab === 'profile' && settings && (
          <form
            onSubmit={handleSaveSettings}
            class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-4 shadow-lg"
          >
            <h2 class="text-lg font-extrabold text-white">Profil & Lokasi Masjid</h2>

            <div>
              <label htmlFor="mosque-name" class="block text-xs font-bold text-slate-200 mb-1.5">
                Nama Masjid / Musholla
              </label>
              <input
                id="mosque-name"
                type="text"
                value={settings.mosque_name}
                onInput={(e) => setSettings({ ...settings, mosque_name: e.target.value })}
                class={INPUT_CLASS}
                required
              />
            </div>

            <div>
              <label htmlFor="mosque-address" class="block text-xs font-bold text-slate-200 mb-1.5">
                Alamat Singkat
              </label>
              <input
                id="mosque-address"
                type="text"
                value={settings.mosque_address}
                onInput={(e) => setSettings({ ...settings, mosque_address: e.target.value })}
                class={INPUT_CLASS}
              />
            </div>

            <div class="pt-3 border-t border-slate-600/60">
              <div class="flex items-center justify-between gap-2 mb-3">
                <span class="text-xs font-bold uppercase tracking-wider text-[#F59E0B]">
                  Koordinat Astronomis Hisab
                </span>
                <button
                  type="button"
                  onClick={handleUsePhoneGps}
                  class="min-h-[44px] bg-[#0F172A] hover:bg-slate-800 border border-[#F59E0B]/50 text-[#F59E0B] px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <MapPinIcon className="w-4 h-4" />
                  <span>Ambil GPS HP</span>
                </button>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="lat-input" class="block text-xs text-slate-300 mb-1">
                    Lintang (Latitude)
                  </label>
                  <input
                    id="lat-input"
                    type="number"
                    step="any"
                    value={settings.latitude}
                    onInput={(e) => setSettings({ ...settings, latitude: Number(e.target.value) })}
                    class={`${INPUT_CLASS} tabular-nums`}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="lng-input" class="block text-xs text-slate-300 mb-1">
                    Bujur (Longitude)
                  </label>
                  <input
                    id="lng-input"
                    type="number"
                    step="any"
                    value={settings.longitude}
                    onInput={(e) => setSettings({ ...settings, longitude: Number(e.target.value) })}
                    class={`${INPUT_CLASS} tabular-nums`}
                    required
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label htmlFor="elev-input" class="block text-xs text-slate-300 mb-1">
                    Elevasi / Tinggi (mdpl)
                  </label>
                  <input
                    id="elev-input"
                    type="number"
                    value={settings.elevation}
                    onInput={(e) => setSettings({ ...settings, elevation: Number(e.target.value) })}
                    class={`${INPUT_CLASS} tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor="tz-select" class="block text-xs text-slate-300 mb-1">
                    Zona Waktu
                  </label>
                  <select
                    id="tz-select"
                    value={settings.timezone}
                    onChange={(e) => setSettings({ ...settings, timezone: Number(e.target.value) })}
                    class={INPUT_CLASS}
                  >
                    <option value={7}>WIB (UTC+7)</option>
                    <option value={8}>WITA (UTC+8)</option>
                    <option value={9}>WIT (UTC+9)</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-slate-600/60">
              <label htmlFor="hijri-corr" class="block text-xs font-bold text-slate-200 mb-1.5">
                Koreksi Tanggal Hijriah Manual (Sidang Isbat: -2 s/d +2 Hari)
              </label>
              <input
                id="hijri-corr"
                type="number"
                min={-2}
                max={2}
                value={settings.hijri_correction}
                onInput={(e) =>
                  setSettings({ ...settings, hijri_correction: Number(e.target.value) })
                }
                class={`${INPUT_CLASS} tabular-nums`}
              />
            </div>

            <div class="pt-3 border-t border-slate-600/60">
              <label htmlFor="new-pin" class="block text-xs font-bold text-slate-200 mb-1.5">
                Ganti PIN Admin Baru (Opsional, 4–6 Angka)
              </label>
              <input
                id="new-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onInput={(e) => setNewPin(e.target.value)}
                placeholder="Kosongkan bila tidak ingin mengubah PIN"
                class={INPUT_CLASS}
              />
            </div>

            <button type="submit" disabled={loading} class={PRIMARY_BTN_CLASS}>
              <CheckCircleIcon className="w-5 h-5" />
              <span>Simpan Profil & Lokasi</span>
            </button>
          </form>
        )}

        {/* ================================================================ */}
        {/* TAB 3: PENGATURAN TIMER IQOMAH & OFFSET WAKTU SHOLAT             */}
        {/* ================================================================ */}
        {activeTab === 'timers' && settings && (
          <form
            onSubmit={handleSaveSettings}
            class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-5 shadow-lg"
          >
            <div>
              <h2 class="text-lg font-extrabold text-white">Durasi Iqomah & Koreksi Menit</h2>
              <p class="text-xs text-slate-300 mt-0.5">
                Atur jeda waktu hitung mundur iqomah dan koreksi menit jadwal sholat.
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="azan-dur" class="block text-xs font-bold text-slate-200 mb-1.5">
                  Durasi Alert Azan (Menit)
                </label>
                <input
                  id="azan-dur"
                  type="number"
                  min={1}
                  max={15}
                  value={settings.azan_duration}
                  onInput={(e) =>
                    setSettings({ ...settings, azan_duration: Number(e.target.value) })
                  }
                  class={`${INPUT_CLASS} tabular-nums`}
                />
              </div>
              <div>
                <label htmlFor="sholat-dur" class="block text-xs font-bold text-slate-200 mb-1.5">
                  Layar Hitam Sholat (Menit)
                </label>
                <input
                  id="sholat-dur"
                  type="number"
                  min={1}
                  max={45}
                  value={settings.sholat_duration}
                  onInput={(e) =>
                    setSettings({ ...settings, sholat_duration: Number(e.target.value) })
                  }
                  class={`${INPUT_CLASS} tabular-nums`}
                />
              </div>
            </div>

            <div class="border-t border-slate-600/60 pt-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-[#F59E0B] mb-2.5">
                Durasi Hitung Mundur Iqomah (Menit)
              </h3>
              <div class="grid grid-cols-2 gap-2.5">
                {['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'].map((k) => (
                  <label
                    key={k}
                    class="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <span class="text-xs font-bold capitalize text-slate-200">{k}</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={settings.iqomah_durations[k]}
                      onInput={(e) =>
                        setSettings({
                          ...settings,
                          iqomah_durations: {
                            ...settings.iqomah_durations,
                            [k]: Number(e.target.value)
                          }
                        })
                      }
                      class="w-16 min-h-[38px] bg-[#1E293B] border border-slate-600 focus:border-[#F59E0B] rounded-lg px-2 py-1 text-right text-sm font-bold text-white tabular-nums outline-none"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div class="border-t border-slate-600/60 pt-3">
              <h3 class="text-xs font-bold uppercase tracking-wider text-[#F59E0B] mb-1">
                Offset Penyesuaian Jadwal (-10 s/d +10 Menit)
              </h3>
              <p class="text-xs text-slate-300 mb-2.5">
                Standar Ihtiyat Kemenag (+2 menit) sudah aktif otomatis.
              </p>
              <div class="grid grid-cols-2 gap-2.5">
                {['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'].map((k) => (
                  <label
                    key={k}
                    class="bg-[#0F172A] border border-slate-700 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <span class="text-xs font-bold capitalize text-slate-200">{k}</span>
                    <input
                      type="number"
                      min={-10}
                      max={10}
                      value={settings.prayer_offsets[k]}
                      onInput={(e) =>
                        setSettings({
                          ...settings,
                          prayer_offsets: {
                            ...settings.prayer_offsets,
                            [k]: Number(e.target.value)
                          }
                        })
                      }
                      class="w-16 min-h-[38px] bg-[#1E293B] border border-slate-600 focus:border-[#F59E0B] rounded-lg px-2 py-1 text-right text-sm font-bold text-white tabular-nums outline-none"
                    />
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" disabled={loading} class={PRIMARY_BTN_CLASS}>
              <CheckCircleIcon className="w-5 h-5" />
              <span>Simpan Pengaturan Timer & Waktu</span>
            </button>
          </form>
        )}

        {/* ================================================================ */}
        {/* TAB 4: MODUL KEUANGAN (SALDO KAS MASJID)                         */}
        {/* ================================================================ */}
        {activeTab === 'finance' && (
          <div class="space-y-4">
            <form
              onSubmit={handleSaveFinancial}
              class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-4 shadow-lg"
            >
              <div>
                <h2 class="text-lg font-extrabold text-white">Transparansi Kas Masjid</h2>
                <p class="text-xs text-slate-300 mt-0.5">
                  Perbarui angka saldo kas pekanan yang ditampilkan di layar TV.
                </p>
              </div>

              <div>
                <label htmlFor="fin-balance" class="block text-xs font-bold text-[#F59E0B] mb-1.5">
                  Saldo Kas Saat Ini (Rp)
                </label>
                <input
                  id="fin-balance"
                  type="number"
                  value={finForm.balance_amount}
                  onInput={(e) => setFinForm({ ...finForm, balance_amount: e.target.value })}
                  class={`${INPUT_CLASS} text-base font-bold tabular-nums`}
                  required
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fin-income" class="block text-xs font-bold text-emerald-400 mb-1.5">
                    Pemasukan Pekan Ini (Rp)
                  </label>
                  <input
                    id="fin-income"
                    type="number"
                    value={finForm.weekly_income}
                    onInput={(e) => setFinForm({ ...finForm, weekly_income: e.target.value })}
                    class={`${INPUT_CLASS} tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor="fin-expense" class="block text-xs font-bold text-rose-400 mb-1.5">
                    Pengeluaran Pekan Ini (Rp)
                  </label>
                  <input
                    id="fin-expense"
                    type="number"
                    value={finForm.weekly_expense}
                    onInput={(e) => setFinForm({ ...finForm, weekly_expense: e.target.value })}
                    class={`${INPUT_CLASS} tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="fin-note" class="block text-xs font-bold text-slate-200 mb-1.5">
                  Keterangan / Catatan Singkat
                </label>
                <input
                  id="fin-note"
                  type="text"
                  value={finForm.note}
                  onInput={(e) => setFinForm({ ...finForm, note: e.target.value })}
                  placeholder="Contoh: Laporan Kas per Jumat Pekan ke-2"
                  class={INPUT_CLASS}
                />
              </div>

              <button type="submit" disabled={loading} class={PRIMARY_BTN_CLASS}>
                <WalletIcon className="w-5 h-5" />
                <span>Perbarui Saldo Kas di TV</span>
              </button>
            </form>

            {financialRecords.length > 0 && (
              <div class="bg-[#334155] border border-slate-600/70 rounded-2xl p-4 shadow-lg">
                <h3 class="text-xs font-bold uppercase tracking-wider text-[#94A3B8] mb-2.5">
                  Riwayat Input Terakhir
                </h3>
                <div class="space-y-2">
                  {financialRecords
                    .slice(-3)
                    .reverse()
                    .map((rec) => (
                      <div
                        key={rec.id}
                        class="bg-[#0F172A] border border-slate-700 rounded-xl p-3 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div class="font-bold text-white text-sm tabular-nums">
                            {formatRupiah(rec.balance_amount)}
                          </div>
                          <div class="text-[#94A3B8] mt-0.5">{rec.note || rec.recorded_date}</div>
                        </div>
                        <div class="text-right tabular-nums font-semibold">
                          <div class="text-emerald-400">+{formatRupiah(rec.weekly_income)}</div>
                          <div class="text-rose-400">-{formatRupiah(rec.weekly_expense)}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* TAB 5: RUNNING TEXT & UPLOAD SLIDE GAMBAR (QRIS / POSTER)        */}
        {/* ================================================================ */}
        {activeTab === 'content' && (
          <div class="space-y-5">
            {/* Bagian Running Text */}
            <section class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-4 shadow-lg">
              <h2 class="text-lg font-extrabold text-white">Teks Berjalan (Running Text)</h2>

              <form onSubmit={handleAddAnnouncement} class="flex gap-2">
                <input
                  type="text"
                  aria-label="Teks pengumuman baru"
                  value={newAnnouncementText}
                  onInput={(e) => setNewAnnouncementText(e.target.value)}
                  placeholder="Tulis pengumuman atau himbauan baru..."
                  class={`${INPUT_CLASS} flex-1`}
                  required
                />
                <button
                  type="submit"
                  disabled={loading}
                  class="min-h-[44px] bg-[#F59E0B] hover:bg-amber-400 text-slate-950 font-extrabold px-4 rounded-xl text-xs shrink-0 cursor-pointer transition-colors"
                >
                  + Tambah
                </button>
              </form>

              <div class="space-y-2.5">
                {announcements.map((item) => (
                  <div
                    key={item.id}
                    class="bg-[#0F172A] border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3"
                  >
                    <p
                      class={`text-xs leading-relaxed flex-1 ${
                        item.is_active ? 'text-white' : 'text-slate-500 line-through'
                      }`}
                    >
                      {item.text}
                    </p>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleAnnouncement(item)}
                        aria-pressed={Boolean(item.is_active)}
                        class={`min-h-[44px] px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                          item.is_active
                            ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-800 border border-slate-700 text-slate-400'
                        }`}
                      >
                        {item.is_active ? 'Aktif' : 'Nonaktif'}
                      </button>
                      <button
                        type="button"
                        aria-label="Hapus pengumuman"
                        onClick={() => handleDeleteAnnouncement(item.id)}
                        class="min-h-[44px] min-w-[44px] rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 flex items-center justify-center cursor-pointer transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Bagian Upload Poster Kajian / QRIS Infaq */}
            <section class="bg-[#334155] border border-slate-600/70 rounded-2xl p-5 space-y-4 shadow-lg">
              <div>
                <h2 class="text-lg font-extrabold text-white">Slide Poster Kajian & QRIS Infaq</h2>
                <p class="text-xs text-slate-300 mt-0.5">
                  Gambar yang diunggah akan tampil bergantian di layar utama TV.
                </p>
              </div>

              <form onSubmit={handleUploadSlide} class="space-y-3">
                <div>
                  <label htmlFor="slide-title" class="block text-xs font-bold text-slate-200 mb-1.5">
                    Judul Slide
                  </label>
                  <input
                    id="slide-title"
                    type="text"
                    value={slideTitle}
                    onInput={(e) => setSlideTitle(e.target.value)}
                    placeholder="Contoh: Infaq QRIS Masjid / Kajian Ahad Pagi"
                    class={INPUT_CLASS}
                    required
                  />
                </div>

                <div class="grid grid-cols-3 gap-2.5">
                  <div class="col-span-2">
                    <label htmlFor="slide-file" class="block text-xs font-bold text-slate-200 mb-1.5">
                      Pilih Gambar (PNG/JPG/WEBP)
                    </label>
                    <input
                      id="slide-file"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setSlideFile(e.target.files?.[0] || null)}
                      class={`${INPUT_CLASS} text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:bg-[#F59E0B] file:text-slate-950 file:font-bold`}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="slide-dur" class="block text-xs font-bold text-slate-200 mb-1.5">
                      Durasi (dtk)
                    </label>
                    <input
                      id="slide-dur"
                      type="number"
                      min={5}
                      max={120}
                      value={slideDuration}
                      onInput={(e) => setSlideDuration(Number(e.target.value))}
                      class={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} class={PRIMARY_BTN_CLASS}>
                  {loading ? 'Mengunggah...' : 'Unggah Slide ke TV'}
                </button>
              </form>

              {mediaSlides.length > 0 && (
                <div class="space-y-2.5 pt-2">
                  {mediaSlides.map((s) => (
                    <div
                      key={s.id}
                      class="bg-[#0F172A] border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3"
                    >
                      <div class="flex items-center gap-3 min-w-0">
                        <img
                          src={s.file_path}
                          alt={s.title}
                          class="w-16 h-11 object-cover rounded-lg bg-slate-800 shrink-0"
                        />
                        <div class="min-w-0">
                          <div class="text-xs font-bold text-white truncate">{s.title}</div>
                          <div class="text-xs text-[#94A3B8] tabular-nums">{s.duration_seconds} detik</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSlide(s)}
                          aria-pressed={Boolean(s.is_active)}
                          class={`min-h-[44px] px-3 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                            s.is_active
                              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                              : 'bg-slate-800 border border-slate-700 text-slate-400'
                          }`}
                        >
                          {s.is_active ? 'Aktif' : 'Off'}
                        </button>
                        <button
                          type="button"
                          aria-label={`Hapus slide ${s.title}`}
                          onClick={() => handleDeleteSlide(s.id)}
                          class="min-h-[44px] min-w-[44px] rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 flex items-center justify-center cursor-pointer transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar Mobile (<= 5 item, tinggi >= 56px, safe-area compliant) */}
      <nav
        aria-label="Navigasi Bawah"
        class="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0F172A]/95 backdrop-blur border-t border-slate-700/90 px-2 py-1.5 grid grid-cols-5 gap-1"
      >
        {tabs.map(({ id, label, Icon, badge }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              class={`min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-1 transition-colors relative cursor-pointer focus-visible:ring-2 focus-visible:ring-[#F59E0B] ${
                isActive
                  ? 'bg-[#F59E0B]/15 text-[#F59E0B] font-extrabold'
                  : 'text-[#94A3B8] hover:text-white font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span class="text-[11px] leading-none">{label}</span>
              {badge && (
                <span class="absolute top-1.5 right-4 w-2.5 h-2.5 rounded-full bg-rose-500 border border-[#0F172A]" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
