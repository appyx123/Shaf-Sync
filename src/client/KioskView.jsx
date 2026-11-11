import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { evaluateKioskState, KIOSK_STATES, PRAYER_LABELS } from '../shared/fsm.js';
import { calculatePrayerTimes, toHijriDate } from '../shared/hisab.js';
import { playAzanChime, playCountdownBeep } from './audio.js';

const PRAYER_ORDER = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

function formatClockHMS(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatCountdownMMSS(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatCountdownHMS(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatGregorianId(date) {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);
}

export function KioskView() {
  const [bundle, setBundle] = useState(null);
  const [serverDeltaMs, setServerDeltaMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [slideIndex, setSlideIndex] = useState(0);
  const [previewOverride, setPreviewOverride] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('state') || null;
  });

  const showPreviewControls = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('preview') || params.has('state');
  }, []);

  const lastBeepSecondRef = useRef(null);
  const lastAzanAlertKeyRef = useRef(null);
  const lastDateStrRef = useRef('');

  async function fetchDisplayData() {
    try {
      const res = await fetch('/api/display-data');
      if (!res.ok) return;
      const data = await res.json();
      setBundle(data);
      if (data.serverTime?.epochMs) {
        const delta = data.serverTime.epochMs - Date.now();
        setServerDeltaMs(delta);
        setNowMs(Date.now() + delta);
      }
      lastDateStrRef.current = data.prayerSchedule?.date || '';
    } catch {
      // Tetap berjalan menggunakan kalkulasi lokal jika sedang reconnect
    }
  }

  // Ambil data awal & buka koneksi SSE real-time
  useEffect(() => {
    fetchDisplayData();

    let es = null;
    let reconnectTimer = null;

    function connectSse() {
      es = new EventSource('/api/events');

      es.addEventListener('CONNECTED', (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload.serverTimeMs) {
            const delta = payload.serverTimeMs - Date.now();
            setServerDeltaMs(delta);
            setNowMs(Date.now() + delta);
          }
        } catch {}
      });

      es.addEventListener('TIME_RESYNCED', (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload.epochMs) {
            const delta = payload.epochMs - Date.now();
            setServerDeltaMs(delta);
            setNowMs(Date.now() + delta);
          }
        } catch {}
        fetchDisplayData();
      });

      es.addEventListener('DATA_UPDATED', () => {
        fetchDisplayData();
      });

      es.onerror = () => {
        es.close();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSse, 3000);
      };
    }

    connectSse();

    return () => {
      clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, []);

  // Tick jam presisi setiap 250ms agar transisi detik tidak pernah meleset
  useEffect(() => {
    const id = setInterval(() => {
      const effectiveNowMs = Date.now() + serverDeltaMs;
      setNowMs(effectiveNowMs);

      // Jika hari berganti lewat tengah malam, hitung ulang jadwal hari baru
      const d = new Date(effectiveNowMs);
      const curDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (lastDateStrRef.current && curDateStr !== lastDateStrRef.current) {
        lastDateStrRef.current = curDateStr;
        fetchDisplayData();
      }
    }, 250);
    return () => clearInterval(id);
  }, [serverDeltaMs]);

  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);

  // Hitung jadwal sholat & hijriah lokal bila bundle belum termuat atau tanggal berganti
  const settings = bundle?.settings || {
    mosque_name: 'Masjid Al-Ikhlas',
    mosque_address: 'Jl. Melati Raya No. 12, Jakarta',
    latitude: -6.1702,
    longitude: 106.831,
    elevation: 10,
    timezone: 7,
    hijri_correction: 0,
    azan_duration: 3,
    sholat_duration: 15,
    iqomah_durations: { subuh: 12, dzuhur: 8, ashar: 8, maghrib: 7, isya: 10 },
    prayer_offsets: { subuh: 0, terbit: 0, dzuhur: 0, ashar: 0, maghrib: 0, isya: 0 }
  };

  const prayerSchedule = useMemo(() => {
    return calculatePrayerTimes({
      date: nowDate,
      latitude: settings.latitude,
      longitude: settings.longitude,
      elevation: settings.elevation,
      timezone: settings.timezone,
      offsets: settings.prayer_offsets
    });
  }, [
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    settings.latitude,
    settings.longitude,
    settings.elevation,
    settings.timezone,
    JSON.stringify(settings.prayer_offsets)
  ]);

  const hijriDate = useMemo(() => {
    return toHijriDate(nowDate, settings.hijri_correction);
  }, [nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), settings.hijri_correction]);

  // Evaluasi Finite State Machine (FSM)
  const computedFsm = useMemo(() => {
    return evaluateKioskState({
      now: nowDate,
      prayerMinutes: prayerSchedule.minutes,
      durations: {
        azanMinutes: settings.azan_duration,
        sholatMinutes: settings.sholat_duration,
        iqomah: settings.iqomah_durations
      }
    });
  }, [
    nowDate.getHours(),
    nowDate.getMinutes(),
    nowDate.getSeconds(),
    prayerSchedule,
    settings.azan_duration,
    settings.sholat_duration,
    settings.iqomah_durations
  ]);

  const fsm = useMemo(() => {
    if (!previewOverride) return computedFsm;
    if (previewOverride === KIOSK_STATES.AZAN_ALERT) {
      return {
        state: KIOSK_STATES.AZAN_ALERT,
        prayerKey: 'maghrib',
        prayerName: 'Maghrib',
        remainingSeconds: 145,
        enteredJustNow: false
      };
    }
    if (previewOverride === KIOSK_STATES.IQOMAH_COUNTDOWN) {
      return {
        state: KIOSK_STATES.IQOMAH_COUNTDOWN,
        prayerKey: 'maghrib',
        prayerName: 'Maghrib',
        remainingSeconds: 25,
        isWarning: true,
        shouldBeep: false
      };
    }
    if (previewOverride === KIOSK_STATES.SHOLAT) {
      return {
        state: KIOSK_STATES.SHOLAT,
        prayerKey: 'maghrib',
        prayerName: 'Maghrib',
        remainingSeconds: 840
      };
    }
    return computedFsm;
  }, [computedFsm, previewOverride]);

  // Pemicu Web Audio API pada state AZAN_ALERT dan 5 detik terakhir IQOMAH_COUNTDOWN
  useEffect(() => {
    if (fsm.state === KIOSK_STATES.AZAN_ALERT) {
      const alertId = `${prayerSchedule.date}-${fsm.prayerKey}`;
      if (fsm.enteredJustNow && lastAzanAlertKeyRef.current !== alertId) {
        lastAzanAlertKeyRef.current = alertId;
        playAzanChime();
      }
    }

    if (fsm.state === KIOSK_STATES.IQOMAH_COUNTDOWN && fsm.shouldBeep) {
      if (lastBeepSecondRef.current !== fsm.remainingSeconds) {
        lastBeepSecondRef.current = fsm.remainingSeconds;
        playCountdownBeep(fsm.remainingSeconds === 1);
      }
    } else {
      lastBeepSecondRef.current = null;
    }
  }, [fsm.state, fsm.prayerKey, fsm.enteredJustNow, fsm.shouldBeep, fsm.remainingSeconds, prayerSchedule.date]);

  // Susun daftar slide untuk STANDBY (Slide Kas + Media Slides poster/QRIS)
  const slides = useMemo(() => {
    const items = [];
    if (bundle?.financial) {
      items.push({
        type: 'financial',
        id: 'fin-summary',
        duration_seconds: 12,
        data: bundle.financial
      });
    }
    const mediaList = bundle?.mediaSlides || [];
    for (const s of mediaList) {
      items.push({
        type: 'media',
        id: `media-${s.id}`,
        title: s.title,
        file_path: s.file_path,
        duration_seconds: s.duration_seconds || 12
      });
    }
    if (items.length === 0) {
      items.push({
        type: 'default-banner',
        id: 'default-hikmah',
        duration_seconds: 12
      });
    }
    return items;
  }, [bundle?.financial, bundle?.mediaSlides]);

  // Rotasi Media Slider hanya saat state === STANDBY (dijeda saat AZAN_ALERT)
  useEffect(() => {
    if (fsm.state !== KIOSK_STATES.STANDBY || slides.length <= 1) return;
    const currentSlide = slides[slideIndex % slides.length];
    const durationMs = (Number(currentSlide?.duration_seconds) || 12) * 1000;
    const timer = setTimeout(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [fsm.state, slideIndex, slides]);

  const announcements = bundle?.announcements?.length
    ? bundle.announcements
    : [
        {
          id: 1,
          text: 'Mohon luruskan dan rapatkan shaf sebelum sholat berjamaah dimulai.'
        },
        {
          id: 2,
          text: 'Harap menonaktifkan atau mengheningkan ponsel selama berada di dalam masjid.'
        }
      ];

  // ============================================================================
  // STATE 4: SHOLAT (Layar Hitam Pekat #000000 - Distraction-Free Protocol)
  // ============================================================================
  if (fsm.state === KIOSK_STATES.SHOLAT) {
    return (
      <div class="fixed inset-0 bg-[#000000] text-[#94A3B8]/55 flex flex-col justify-end items-center pb-[6vh] select-none cursor-none">
        <p class="text-[1.45vw] tracking-wide font-medium">
          Luruskan dan Rapatkan Shaf &nbsp;|&nbsp; Harap Menonaktifkan Ponsel
        </p>
        {showPreviewControls && (
          <PreviewBar current={previewOverride} onSelect={setPreviewOverride} />
        )}
      </div>
    );
  }

  // ============================================================================
  // STATE 3: IQOMAH_COUNTDOWN (Hitung Mundur Besar >= 120pt + Peringatan 30 Detik)
  // ============================================================================
  if (fsm.state === KIOSK_STATES.IQOMAH_COUNTDOWN) {
    return (
      <div class="fixed inset-0 bg-[#1E293B] text-white flex flex-col justify-between p-[3.2vw] select-none overflow-hidden animate-fade-in">
        {/* Baris Atas: Nama Masjid & Jam Sekarang */}
        <div class="flex items-center justify-between border-b border-slate-700/80 pb-[2vh]">
          <div>
            <h1 class="text-[2vw] font-bold tracking-tight text-white">
              {settings.mosque_name}
            </h1>
            <p class="text-[1.1vw] text-[#94A3B8]">{settings.mosque_address}</p>
          </div>
          <div class="text-right">
            <div class="text-[2.6vw] font-bold tabular-nums text-white">
              {formatClockHMS(nowDate)}
            </div>
            <div class="text-[1vw] text-[#94A3B8]">{hijriDate.formatted}</div>
          </div>
        </div>

        {/* Fokus Utama Tengah: Countdown Iqomah >= 120pt */}
        <div class="flex-1 flex flex-col items-center justify-center text-center my-auto">
          <span class="px-[1.8vw] py-[0.7vh] rounded-full bg-[#334155] border border-[#F59E0B]/40 text-[#F59E0B] text-[1.5vw] font-semibold uppercase tracking-widest mb-[2.5vh]">
            Menuju Iqomah {fsm.prayerName}
          </span>

          <div
            class={`font-black tabular-nums leading-none tracking-tight transition-colors duration-300 text-[15vw] ${
              fsm.isWarning ? 'text-[#FACC15] drop-shadow-[0_0_45px_rgba(250,204,21,0.45)]' : 'text-white'
            }`}
          >
            {formatCountdownMMSS(fsm.remainingSeconds)}
          </div>

          <p class="mt-[3vh] text-[1.7vw] text-[#94A3B8] font-medium max-w-[70vw]">
            Mari luruskan dan rapatkan shaf, serta menonaktifkan dering ponsel Anda.
          </p>
        </div>

        {/* Footer Statis Tenang */}
        <div class="text-center text-[1.15vw] text-[#94A3B8] border-t border-slate-700/80 pt-[1.8vh]">
          Jadwal {fsm.prayerName} Hari Ini: <span class="text-white font-semibold tabular-nums">{prayerSchedule.times[fsm.prayerKey]}</span>
        </div>

        {showPreviewControls && (
          <PreviewBar current={previewOverride} onSelect={setPreviewOverride} />
        )}
      </div>
    );
  }

  // ============================================================================
  // STATE 2: AZAN_ALERT (Notifikasi Masuk Waktu Sholat Fardhu)
  // ============================================================================
  if (fsm.state === KIOSK_STATES.AZAN_ALERT) {
    return (
      <div class="fixed inset-0 bg-[#1E293B] text-white flex flex-col justify-between p-[3.2vw] select-none overflow-hidden animate-fade-in">
        {/* Header Ringkas */}
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-[2.1vw] font-bold text-white">{settings.mosque_name}</h1>
            <p class="text-[1.1vw] text-[#94A3B8]">{settings.mosque_address}</p>
          </div>
          <div class="text-right">
            <div class="text-[3vw] font-extrabold tabular-nums text-white">
              {formatClockHMS(nowDate)}
            </div>
            <div class="text-[1.1vw] text-[#F59E0B] font-medium">
              {formatGregorianId(nowDate)} • {hijriDate.formatted}
            </div>
          </div>
        </div>

        {/* Kartu Sholat Membesar di Tengah dengan Soft Pulse */}
        <div class="flex-1 flex items-center justify-center">
          <div class="animate-soft-pulse bg-[#334155] border-2 border-[#F59E0B] rounded-3xl px-[6vw] py-[5.5vh] text-center max-w-[76vw] w-full">
            <div class="inline-block px-[1.5vw] py-[0.5vh] rounded-full bg-[#F59E0B]/20 text-[#F59E0B] text-[1.3vw] font-bold uppercase tracking-widest mb-[2vh]">
              Panggilan Azan Berkumandang
            </div>
            <h2 class="text-[3.8vw] font-extrabold text-white tracking-tight leading-tight">
              Waktu Sholat {fsm.prayerName} Telah Tiba
            </h2>
            <div class="my-[3vh] text-[7.5vw] font-black tabular-nums text-[#F59E0B] leading-none">
              {prayerSchedule.times[fsm.prayerKey]}
            </div>
            <p class="text-[1.45vw] text-[#94A3B8]">
              Jawablah panggilan muadzin dan bersiap melaksanakan sholat berjamaah.
            </p>
          </div>
        </div>

        {/* Footer Dijeda (Statis) */}
        <div class="bg-[#334155]/80 rounded-2xl px-[2vw] py-[1.4vh] text-center text-[1.2vw] text-[#94A3B8]">
          Hitung mundur Iqomah akan dimulai dalam{' '}
          <span class="text-white font-bold tabular-nums">
            {formatCountdownMMSS(fsm.remainingSeconds)}
          </span>
        </div>

        {showPreviewControls && (
          <PreviewBar current={previewOverride} onSelect={setPreviewOverride} />
        )}
      </div>
    );
  }

  // ============================================================================
  // STATE 1: STANDBY (Status Siaga Normal 1080p 16:9)
  // ============================================================================
  const activeSlide = slides[slideIndex % slides.length];

  return (
    <div class="fixed inset-0 bg-[#1E293B] text-white flex flex-col justify-between p-[2.2vw] select-none overflow-hidden animate-fade-in">
      {/* 1. HEADER: Profil Masjid, Tanggal Masehi & Hijriah, Jam Digital Besar */}
      <header class="flex items-center justify-between bg-[#334155]/90 border border-slate-600/50 rounded-2xl px-[2.2vw] py-[1.8vh] shadow-lg">
        <div class="flex items-center gap-[1.4vw]">
          <div class="w-[4.2vw] h-[4.2vw] rounded-2xl bg-[#F59E0B]/15 border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B] shrink-0">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-[2.4vw] h-[2.4vw]">
              <path d="M12 2C9.5 4.5 8 7.2 8 10h8c0-2.8-1.5-5.5-4-8zm-7 9v10h14V11H5zm4 4h2v4H9v-4zm4 0h2v4h-2v-4zM3 13l-1 1v7h2v-8H3zm18 0h-1v8h2v-7l-1-1z" />
            </svg>
          </div>
          <div>
            <h1 class="text-[2.2vw] font-extrabold tracking-tight text-white leading-tight">
              {settings.mosque_name}
            </h1>
            <p class="text-[1.05vw] text-[#94A3B8] mt-[0.3vh]">
              {settings.mosque_address}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-[2.5vw]">
          <div class="text-right border-r border-slate-600/70 pr-[2.2vw]">
            <div class="text-[1.25vw] font-semibold text-white">
              {formatGregorianId(nowDate)}
            </div>
            <div class="text-[1.2vw] font-bold text-[#F59E0B] mt-[0.3vh]">
              {hijriDate.formatted}
            </div>
          </div>

          <div class="text-right">
            <div class="text-[3.8vw] font-black tabular-nums leading-none tracking-tight text-white">
              {formatClockHMS(nowDate)}
            </div>
            <div class="text-[0.95vw] text-[#94A3B8] mt-[0.5vh] tabular-nums">
              Menuju <span class="text-[#F59E0B] font-semibold">{fsm.nextPrayerName}</span> dalam{' '}
              <span class="text-white font-semibold">{formatCountdownHMS(fsm.secondsUntilNext)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. AREA TENGAH: Media Slider (Kas Masjid / Poster Kajian / QRIS Infaq) */}
      <main class="flex-1 my-[1.8vh] grid grid-cols-12 gap-[1.6vw] min-h-0">
        {/* Panel Kiri (8 Kolom): Konten Slide Berputar */}
        <section class="col-span-8 bg-[#334155] border border-slate-600/50 rounded-2xl p-[2vw] flex flex-col justify-between relative overflow-hidden shadow-lg">
          {activeSlide?.type === 'financial' && (
            <div class="flex flex-col justify-between h-full animate-fade-in">
              <div class="flex items-center justify-between">
                <div>
                  <span class="px-[1vw] py-[0.4vh] rounded-full bg-[#F59E0B]/20 text-[#F59E0B] text-[0.95vw] font-bold uppercase tracking-wider">
                    Transparansi Dana Umat
                  </span>
                  <h2 class="text-[2vw] font-extrabold text-white mt-[1vh]">
                    Laporan Saldo Kas Masjid
                  </h2>
                </div>
                <span class="text-[1vw] text-[#94A3B8] tabular-nums">
                  Update: {activeSlide.data.recorded_date}
                </span>
              </div>

              <div class="my-auto bg-[#1E293B]/90 border border-[#F59E0B]/40 rounded-2xl p-[1.8vw]">
                <div class="text-[1.05vw] text-[#94A3B8] uppercase tracking-wider font-medium">
                  Saldo Kas Saat Ini
                </div>
                <div class="text-[3.6vw] font-black text-[#F59E0B] tabular-nums leading-tight mt-[0.4vh]">
                  {formatRupiah(activeSlide.data.balance_amount)}
                </div>
                {activeSlide.data.note && (
                  <div class="text-[1vw] text-[#94A3B8] mt-[0.5vh]">
                    {activeSlide.data.note}
                  </div>
                )}
              </div>

              <div class="grid grid-cols-2 gap-[1.2vw]">
                <div class="bg-[#1E293B]/70 border border-emerald-500/30 rounded-xl px-[1.5vw] py-[1.4vh]">
                  <div class="text-[0.95vw] text-[#94A3B8]">Pemasukan Pekan Ini</div>
                  <div class="text-[1.8vw] font-bold text-emerald-400 tabular-nums mt-[0.3vh]">
                    + {formatRupiah(activeSlide.data.weekly_income)}
                  </div>
                </div>
                <div class="bg-[#1E293B]/70 border border-rose-500/30 rounded-xl px-[1.5vw] py-[1.4vh]">
                  <div class="text-[0.95vw] text-[#94A3B8]">Pengeluaran Pekan Ini</div>
                  <div class="text-[1.8vw] font-bold text-rose-400 tabular-nums mt-[0.3vh]">
                    - {formatRupiah(activeSlide.data.weekly_expense)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSlide?.type === 'media' && (
            <div class="flex flex-col h-full animate-fade-in">
              <div class="flex items-center justify-between mb-[1vh]">
                <h2 class="text-[1.5vw] font-bold text-white truncate">
                  {activeSlide.title}
                </h2>
                <span class="text-[0.9vw] text-[#F59E0B] font-semibold uppercase tracking-wider">
                  Informasi Masjid
                </span>
              </div>
              <div class="flex-1 bg-[#1E293B] rounded-xl overflow-hidden flex items-center justify-center min-h-0">
                <img
                  src={activeSlide.file_path}
                  alt={activeSlide.title}
                  class="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          )}

          {activeSlide?.type === 'default-banner' && (
            <div class="flex flex-col justify-center items-center text-center h-full px-[3vw] animate-fade-in">
              <span class="px-[1.2vw] py-[0.5vh] rounded-full bg-[#F59E0B]/20 text-[#F59E0B] text-[1vw] font-bold uppercase tracking-widest mb-[2vh]">
                Keutamaan Sholat Berjamaah
              </span>
              <p class="text-[2vw] font-bold text-white leading-snug">
                “Luruskanlah shaf-shaf kalian, karena sesungguhnya meluruskan shaf termasuk kesempurnaan sholat.”
              </p>
              <p class="text-[1.15vw] text-[#94A3B8] mt-[1.5vh]">
                (HR. Bukhari no. 723 & Muslim no. 433)
              </p>
            </div>
          )}

          {/* Indikator Dot Slide */}
          {slides.length > 1 && (
            <div class="flex items-center justify-center gap-2 mt-[1.2vh]">
              {slides.map((s, idx) => (
                <span
                  key={s.id}
                  class={`h-2 rounded-full transition-all ${
                    idx === slideIndex % slides.length
                      ? 'w-8 bg-[#F59E0B]'
                      : 'w-2 bg-slate-500/60'
                  }`}
                />
              ))}
            </div>
          )}
        </section>

        {/* Panel Kanan (4 Kolom): Highlight Waktu Sholat Berikutnya & Adab Masjid */}
        <aside class="col-span-4 bg-[#334155] border border-slate-600/50 rounded-2xl p-[2vw] flex flex-col justify-between shadow-lg">
          <div>
            <div class="text-[0.95vw] font-bold uppercase tracking-widest text-[#F59E0B]">
              Waktu Sholat Berikutnya
            </div>
            <div class="flex items-baseline justify-between mt-[1vh]">
              <h3 class="text-[2.6vw] font-black text-white">
                {fsm.nextPrayerName}
              </h3>
              <span class="text-[2.6vw] font-black text-[#F59E0B] tabular-nums">
                {prayerSchedule.times[fsm.nextPrayerKey]}
              </span>
            </div>
            <div class="mt-[1.4vh] bg-[#1E293B] rounded-xl px-[1.2vw] py-[1.2vh] flex items-center justify-between">
              <span class="text-[1vw] text-[#94A3B8]">Hitung Mundur</span>
              <span class="text-[1.5vw] font-bold text-white tabular-nums">
                - {formatCountdownHMS(fsm.secondsUntilNext)}
              </span>
            </div>
          </div>

          <div class="border-t border-slate-600/60 pt-[1.8vh]">
            <div class="text-[0.95vw] font-bold uppercase tracking-widest text-[#94A3B8] mb-[1vh]">
              Adab di Dalam Masjid
            </div>
            <ul class="space-y-[1vh] text-[1.05vw] text-slate-200">
              <li class="flex items-center gap-[0.7vw]">
                <span class="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
                <span>Mendahulukan kaki kanan & membaca doa masuk masjid</span>
              </li>
              <li class="flex items-center gap-[0.7vw]">
                <span class="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
                <span>Melaksanakan sholat sunnah Tahiyatul Masjid 2 rakaat</span>
              </li>
              <li class="flex items-center gap-[0.7vw]">
                <span class="w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
                <span>Menonaktifkan dering HP & menjaga ketenangan</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      {/* 3. CARD GRID: 6 Kolom Jadwal Sholat (Subuh, Terbit, Dzuhur, Ashar, Maghrib, Isya) */}
      <section class="grid grid-cols-6 gap-[1.2vw] mb-[1.6vh]">
        {PRAYER_ORDER.map((key) => {
          const isNext = fsm.nextPrayerKey === key;
          return (
            <div
              key={key}
              class={`rounded-2xl px-[1.4vw] py-[1.8vh] transition-all flex flex-col justify-between ${
                isNext
                  ? 'bg-[#334155] border-2 border-[#F59E0B] shadow-[0_0_30px_rgba(245,158,11,0.3)] -translate-y-0.5'
                  : 'bg-[#334155]/90 border border-slate-600/50'
              }`}
            >
              <div class="flex items-center justify-between">
                <span
                  class={`text-[1.25vw] font-bold uppercase tracking-wider ${
                    isNext ? 'text-[#F59E0B]' : 'text-[#94A3B8]'
                  }`}
                >
                  {PRAYER_LABELS[key]}
                </span>
                {isNext && (
                  <span class="px-[0.6vw] py-[0.2vh] rounded-md bg-[#F59E0B] text-slate-950 text-[0.75vw] font-extrabold uppercase tracking-wider">
                    Berikutnya
                  </span>
                )}
              </div>

              <div
                class={`text-[3vw] font-black tabular-nums leading-none mt-[1vh] ${
                  isNext ? 'text-white' : 'text-slate-100'
                }`}
              >
                {prayerSchedule.times[key]}
              </div>
            </div>
          );
        })}
      </section>

      {/* 4. FOOTER: Running Text (Pengumuman & Himbauan) */}
      <footer class="bg-[#334155] border border-slate-600/50 rounded-xl px-[1.5vw] py-[1.1vh] overflow-hidden flex items-center gap-[1.2vw]">
        <span class="px-[0.9vw] py-[0.3vh] rounded-lg bg-[#F59E0B] text-slate-950 font-extrabold text-[0.95vw] uppercase tracking-wider shrink-0">
          Info Masjid
        </span>
        <div class="overflow-hidden flex-1 relative">
          <div class="animate-marquee text-[1.2vw] font-medium text-white">
            {[...announcements, ...announcements].map((item, idx) => (
              <span key={`${item.id}-${idx}`} class="mx-[2.5vw] inline-flex items-center gap-[1vw]">
                <span>{item.text}</span>
                <span class="text-[#F59E0B]">✦</span>
              </span>
            ))}
          </div>
        </div>
      </footer>

      {showPreviewControls && (
        <PreviewBar current={previewOverride} onSelect={setPreviewOverride} />
      )}
    </div>
  );
}

function PreviewBar({ current, onSelect }) {
  const states = [
    { label: 'Otomatis (Real-time)', value: null },
    { label: '1. STANDBY', value: KIOSK_STATES.STANDBY },
    { label: '2. AZAN_ALERT', value: KIOSK_STATES.AZAN_ALERT },
    { label: '3. IQOMAH_COUNTDOWN', value: KIOSK_STATES.IQOMAH_COUNTDOWN },
    { label: '4. SHOLAT', value: KIOSK_STATES.SHOLAT }
  ];
  return (
    <div class="fixed bottom-3 right-3 z-50 bg-slate-900/95 border border-slate-600 rounded-xl p-2 flex items-center gap-1.5 text-xs shadow-2xl">
      <span class="text-slate-400 px-2 font-semibold">Simulasi FSM:</span>
      {states.map((s) => (
        <button
          key={String(s.value)}
          onClick={() => onSelect(s.value)}
          class={`px-2.5 py-1 rounded-lg font-medium cursor-pointer ${
            current === s.value
              ? 'bg-[#F59E0B] text-slate-950 font-bold'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
