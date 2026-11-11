import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { evaluateKioskState, KIOSK_STATES, PRAYER_LABELS, FARDHU_KEYS } from '../shared/fsm.js';
import { calculatePrayerTimes, toHijriDate } from '../shared/hisab.js';
import { playAzanChime, playCountdownBeep } from './audio.js';
import {
  MosqueIcon,
  RubElHizbIcon,
  PrayerTimeIcon,
  WalletIcon,
  CheckCircleIcon
} from './icons.jsx';

const PRAYER_ORDER = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];

function splitClockParts(date) {
  return {
    hm: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    ss: String(date.getSeconds()).padStart(2, '0')
  };
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
  const [sliderPaused, setSliderPaused] = useState(false);
  const [sseConnected, setSseConnected] = useState(true);
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
      // Tetap berjalan menggunakan hisab lokal jika sedang reconnect
    }
  }

  useEffect(() => {
    fetchDisplayData();

    let es = null;
    let reconnectTimer = null;

    function connectSse() {
      es = new EventSource('/api/events');

      es.addEventListener('CONNECTED', (ev) => {
        setSseConnected(true);
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
        setSseConnected(false);
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

  useEffect(() => {
    const id = setInterval(() => {
      const effectiveNowMs = Date.now() + serverDeltaMs;
      setNowMs(effectiveNowMs);

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
  const clockParts = useMemo(() => splitClockParts(nowDate), [nowDate]);

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
    items.push({
      type: 'default-banner',
      id: 'default-hikmah',
      duration_seconds: 12
    });
    return items;
  }, [bundle?.financial, bundle?.mediaSlides]);

  useEffect(() => {
    if (fsm.state !== KIOSK_STATES.STANDBY || slides.length <= 1 || sliderPaused) return;
    const currentSlide = slides[slideIndex % slides.length];
    const durationMs = (Number(currentSlide?.duration_seconds) || 12) * 1000;
    const timer = setTimeout(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [fsm.state, slideIndex, slides, sliderPaused]);

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
      <div class="fixed inset-0 bg-[#000000] text-[#94A3B8]/60 flex flex-col justify-end items-center pb-[6vh] select-none cursor-none">
        <div class="flex items-center gap-[1vw] text-[1.4vw] tracking-wide font-medium">
          <span>Luruskan dan Rapatkan Shaf</span>
          <RubElHizbIcon className="w-[1.1vw] h-[1.1vw] text-[#94A3B8]/40" />
          <span>Harap Menonaktifkan Ponsel</span>
        </div>
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
    const totalIqomahSec = (Number(settings.iqomah_durations?.[fsm.prayerKey]) || 8) * 60;
    const progressPct = Math.max(0, Math.min(100, (fsm.remainingSeconds / totalIqomahSec) * 100));

    return (
      <div class="fixed inset-0 bg-islamic-pattern text-white flex flex-col justify-between p-[3vw] select-none overflow-hidden animate-fade-in">
        <header class="flex items-center justify-between bg-[#334155]/90 border border-slate-600/60 rounded-2xl px-[2.2vw] py-[1.6vh]">
          <div class="flex items-center gap-[1.2vw]">
            <div class="w-[3.4vw] h-[3.4vw] rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B]">
              <MosqueIcon className="w-[2vw] h-[2vw]" />
            </div>
            <div>
              <h1 class="text-[1.8vw] font-bold tracking-tight text-white leading-tight">
                {settings.mosque_name}
              </h1>
              <p class="text-[1vw] text-[#94A3B8]">{settings.mosque_address}</p>
            </div>
          </div>
          <div class="text-right">
            <div class="text-[2.4vw] font-black tabular-nums text-white leading-none">
              {clockParts.hm}
              <span class="text-[#F59E0B]">:{clockParts.ss}</span>
            </div>
            <div class="text-[0.95vw] text-[#94A3B8] mt-[0.4vh]">{hijriDate.formatted}</div>
          </div>
        </header>

        <main class="flex-1 flex flex-col items-center justify-center text-center my-auto">
          <div class="inline-flex items-center gap-[0.8vw] px-[1.8vw] py-[0.8vh] rounded-full bg-[#334155] border-2 border-[#F59E0B]/60 text-[#F59E0B] text-[1.4vw] font-bold uppercase tracking-widest mb-[2vh]">
            <PrayerTimeIcon prayerKey={fsm.prayerKey} className="w-[1.6vw] h-[1.6vw]" />
            <span>Menuju Iqomah {fsm.prayerName}</span>
          </div>

          <div
            role="timer"
            aria-live="polite"
            class={`font-black tabular-nums leading-none tracking-tight transition-colors duration-300 text-[15vw] ${
              fsm.isWarning
                ? 'text-[#FACC15] drop-shadow-[0_0_45px_rgba(250,204,21,0.5)]'
                : 'text-white'
            }`}
          >
            {formatCountdownMMSS(fsm.remainingSeconds)}
          </div>

          {/* Bar Progres Visual (aksesibel: tidak hanya mengandalkan warna) */}
          <div class="w-[46vw] h-[1.1vh] bg-[#0F172A] rounded-full overflow-hidden mt-[2.5vh] border border-slate-700">
            <div
              class={`h-full transition-all duration-300 ${
                fsm.isWarning ? 'bg-[#FACC15]' : 'bg-[#F59E0B]'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <p class="mt-[2.8vh] text-[1.55vw] text-slate-200 font-medium max-w-[68vw]">
            {fsm.isWarning
              ? 'Iqomah sesaat lagi — Mohon berdiri, luruskan dan rapatkan barisan shaf.'
              : 'Gunakan waktu menjelang Iqomah untuk sholat sunnah Rawatib dan berdoa.'}
          </p>
        </main>

        <footer class="bg-[#334155]/90 border border-slate-600/60 rounded-xl px-[2vw] py-[1.4vh] flex items-center justify-between text-[1.1vw] text-[#94A3B8]">
          <span>
            Jadwal Azan {fsm.prayerName}:{' '}
            <strong class="text-white tabular-nums">{prayerSchedule.times[fsm.prayerKey]}</strong>
          </span>
          <span class="text-[#F59E0B] font-semibold">
            Harap Nonaktifkan Dering Ponsel Anda
          </span>
        </footer>

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
      <div class="fixed inset-0 bg-islamic-pattern text-white flex flex-col justify-between p-[3vw] select-none overflow-hidden animate-fade-in">
        <header class="flex items-center justify-between bg-[#334155]/90 border border-slate-600/60 rounded-2xl px-[2.2vw] py-[1.6vh]">
          <div class="flex items-center gap-[1.2vw]">
            <div class="w-[3.4vw] h-[3.4vw] rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B]">
              <MosqueIcon className="w-[2vw] h-[2vw]" />
            </div>
            <div>
              <h1 class="text-[1.9vw] font-bold text-white leading-tight">{settings.mosque_name}</h1>
              <p class="text-[1vw] text-[#94A3B8]">{settings.mosque_address}</p>
            </div>
          </div>
          <div class="text-right">
            <div class="text-[2.6vw] font-black tabular-nums text-white leading-none">
              {clockParts.hm}
              <span class="text-[#F59E0B]">:{clockParts.ss}</span>
            </div>
            <div class="text-[1vw] text-[#F59E0B] font-semibold mt-[0.4vh]">
              {formatGregorianId(nowDate)} • {hijriDate.formatted}
            </div>
          </div>
        </header>

        <main class="flex-1 flex items-center justify-center">
          <div class="animate-soft-pulse bg-[#334155] border-2 border-[#F59E0B] rounded-3xl px-[5.5vw] py-[5vh] text-center max-w-[74vw] w-full">
            <div class="inline-flex items-center gap-[0.6vw] px-[1.5vw] py-[0.6vh] rounded-full bg-[#F59E0B]/20 text-[#F59E0B] text-[1.25vw] font-bold uppercase tracking-widest mb-[2vh]">
              <RubElHizbIcon className="w-[1.3vw] h-[1.3vw]" />
              <span>Panggilan Azan Berkumandang</span>
              <RubElHizbIcon className="w-[1.3vw] h-[1.3vw]" />
            </div>
            <h2 class="text-[3.6vw] font-extrabold text-white tracking-tight leading-tight">
              Waktu Sholat {fsm.prayerName} Telah Tiba
            </h2>
            <div class="my-[2.5vh] text-[7.5vw] font-black tabular-nums text-[#F59E0B] leading-none">
              {prayerSchedule.times[fsm.prayerKey]}
            </div>
            <p class="text-[1.4vw] text-slate-200">
              Mari hentikan aktivitas sejenak, jawab panggilan muadzin, dan meraih pahala berjamaah.
            </p>
          </div>
        </main>

        <footer class="bg-[#334155]/90 border border-slate-600/60 rounded-2xl px-[2vw] py-[1.4vh] text-center text-[1.2vw] text-slate-200">
          Hitung mundur Iqomah akan dimulai dalam{' '}
          <span class="text-[#F59E0B] font-extrabold tabular-nums">
            {formatCountdownMMSS(fsm.remainingSeconds)}
          </span>
        </footer>

        {showPreviewControls && (
          <PreviewBar current={previewOverride} onSelect={setPreviewOverride} />
        )}
      </div>
    );
  }

  // ============================================================================
  // STATE 1: STANDBY (Status Siaga Normal 1080p 16:9 Bento Grid)
  // ============================================================================
  const activeSlide = slides[slideIndex % slides.length];

  return (
    <div class="fixed inset-0 bg-islamic-pattern text-white flex flex-col justify-between p-[2vw] select-none overflow-hidden animate-fade-in">
      {/* 1. HEADER: Identitas Masjid, Penanggalan Masehi & Hijriah, Jam Digital Presisi */}
      <header class="flex items-center justify-between bg-[#334155]/95 border border-slate-600/60 rounded-2xl px-[2vw] py-[1.6vh] shadow-lg">
        <div class="flex items-center gap-[1.3vw] min-w-0">
          <div class="w-[4vw] h-[4vw] rounded-2xl bg-[#0F172A] border-2 border-[#F59E0B]/60 flex items-center justify-center text-[#F59E0B] shrink-0">
            <MosqueIcon className="w-[2.2vw] h-[2.2vw]" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-[0.8vw]">
              <h1 class="text-[2.1vw] font-extrabold tracking-tight text-white leading-tight truncate">
                {settings.mosque_name}
              </h1>
              <span
                title={sseConnected ? 'Terhubung ke Server Lokal' : 'Menyambung ulang...'}
                class={`w-[0.65vw] h-[0.65vw] rounded-full shrink-0 ${
                  sseConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </div>
            <p class="text-[1.02vw] text-[#94A3B8] mt-[0.2vh] truncate">
              {settings.mosque_address}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-[2.2vw] shrink-0">
          <div class="text-right border-r border-slate-600/80 pr-[2vw]">
            <div class="text-[1.2vw] font-semibold text-white">
              {formatGregorianId(nowDate)}
            </div>
            <div class="inline-flex items-center gap-[0.5vw] text-[1.15vw] font-bold text-[#F59E0B] mt-[0.3vh]">
              <RubElHizbIcon className="w-[1vw] h-[1vw]" />
              <span>{hijriDate.formatted}</span>
            </div>
          </div>

          <div class="text-right">
            <div class="text-[3.7vw] font-black tabular-nums leading-none tracking-tight text-white">
              {clockParts.hm}
              <span class="text-[#F59E0B] text-[2.7vw] font-extrabold ml-[0.15vw]">
                :{clockParts.ss}
              </span>
            </div>
            <div class="text-[0.95vw] text-[#94A3B8] mt-[0.5vh] tabular-nums">
              Menuju <span class="text-[#F59E0B] font-bold">{fsm.nextPrayerName}</span> dalam{' '}
              <span class="text-white font-bold">{formatCountdownHMS(fsm.secondsUntilNext)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. AREA BENTO TENGAH: Media Slider (8 Kolom) + Spotlight Sholat Berikutnya (4 Kolom) */}
      <main class="flex-1 my-[1.6vh] grid grid-cols-12 gap-[1.5vw] min-h-0">
        {/* Panel Kiri (8 Kolom): Konten Slide Berputar */}
        <section
          aria-label="Informasi dan Transparansi Masjid"
          onMouseEnter={() => setSliderPaused(true)}
          onMouseLeave={() => setSliderPaused(false)}
          class="col-span-8 bg-[#334155]/95 border border-slate-600/60 rounded-2xl p-[1.9vw] flex flex-col justify-between relative overflow-hidden shadow-lg"
        >
          {activeSlide?.type === 'financial' && (
            <div class="flex flex-col justify-between h-full animate-fade-in">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-[0.8vw]">
                  <span class="inline-flex items-center gap-[0.4vw] px-[0.9vw] py-[0.4vh] rounded-lg bg-[#F59E0B]/20 border border-[#F59E0B]/40 text-[#F59E0B] text-[0.9vw] font-bold uppercase tracking-wider">
                    <WalletIcon className="w-[1.1vw] h-[1.1vw]" />
                    <span>Transparansi Kas</span>
                  </span>
                  <h2 class="text-[1.7vw] font-extrabold text-white">
                    Laporan Keuangan Masjid
                  </h2>
                </div>
                <span class="px-[0.8vw] py-[0.3vh] rounded-lg bg-[#0F172A] text-[0.95vw] text-slate-300 tabular-nums font-medium">
                  Periode: {activeSlide.data.recorded_date}
                </span>
              </div>

              <div class="my-auto bg-[#0F172A] border-2 border-[#F59E0B]/45 rounded-2xl p-[1.7vw] flex items-center justify-between">
                <div>
                  <div class="text-[1vw] text-[#94A3B8] uppercase tracking-wider font-semibold">
                    Saldo Kas Saat Ini
                  </div>
                  <div class="text-[3.5vw] font-black text-[#F59E0B] tabular-nums leading-tight mt-[0.3vh]">
                    {formatRupiah(activeSlide.data.balance_amount)}
                  </div>
                  {activeSlide.data.note && (
                    <div class="text-[1vw] text-slate-300 mt-[0.4vh]">
                      {activeSlide.data.note}
                    </div>
                  )}
                </div>
                <div class="w-[4.5vw] h-[4.5vw] rounded-2xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B]">
                  <WalletIcon className="w-[2.4vw] h-[2.4vw]" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-[1.2vw]">
                <div class="bg-[#0F172A]/85 border border-emerald-500/40 rounded-xl px-[1.4vw] py-[1.3vh] flex items-center justify-between">
                  <div>
                    <div class="text-[0.92vw] text-[#94A3B8] font-medium">Pemasukan Pekan Ini</div>
                    <div class="text-[1.75vw] font-extrabold text-emerald-400 tabular-nums mt-[0.2vh]">
                      + {formatRupiah(activeSlide.data.weekly_income)}
                    </div>
                  </div>
                  <span class="px-[0.6vw] py-[0.2vh] rounded bg-emerald-500/15 text-emerald-300 text-[0.8vw] font-bold">
                    MASUK
                  </span>
                </div>
                <div class="bg-[#0F172A]/85 border border-rose-500/40 rounded-xl px-[1.4vw] py-[1.3vh] flex items-center justify-between">
                  <div>
                    <div class="text-[0.92vw] text-[#94A3B8] font-medium">Pengeluaran Pekan Ini</div>
                    <div class="text-[1.75vw] font-extrabold text-rose-400 tabular-nums mt-[0.2vh]">
                      - {formatRupiah(activeSlide.data.weekly_expense)}
                    </div>
                  </div>
                  <span class="px-[0.6vw] py-[0.2vh] rounded bg-rose-500/15 text-rose-300 text-[0.8vw] font-bold">
                    KELUAR
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeSlide?.type === 'media' && (
            <div class="flex flex-col h-full animate-fade-in">
              <div class="flex items-center justify-between mb-[1vh]">
                <h2 class="text-[1.45vw] font-bold text-white truncate">
                  {activeSlide.title}
                </h2>
                <span class="px-[0.8vw] py-[0.25vh] rounded-md bg-[#F59E0B]/20 text-[#F59E0B] text-[0.85vw] font-bold uppercase tracking-wider">
                  Informasi & Infaq
                </span>
              </div>
              <div class="flex-1 bg-[#0F172A] border border-slate-700 rounded-xl overflow-hidden flex items-center justify-center min-h-0 p-2">
                <img
                  src={activeSlide.file_path}
                  alt={activeSlide.title}
                  class="max-h-full max-w-full object-contain rounded-lg"
                />
              </div>
            </div>
          )}

          {activeSlide?.type === 'default-banner' && (
            <div class="flex flex-col justify-center items-center text-center h-full px-[3vw] animate-fade-in">
              <div class="inline-flex items-center gap-[0.5vw] px-[1.1vw] py-[0.5vh] rounded-full bg-[#F59E0B]/20 border border-[#F59E0B]/40 text-[#F59E0B] text-[0.95vw] font-bold uppercase tracking-widest mb-[2vh]">
                <RubElHizbIcon className="w-[1vw] h-[1vw]" />
                <span>Hikmah & Keutamaan Berjamaah</span>
                <RubElHizbIcon className="w-[1vw] h-[1vw]" />
              </div>
              <p class="text-[1.95vw] font-bold text-white leading-snug max-w-[46vw]">
                “Luruskanlah shaf-shaf kalian, karena sesungguhnya meluruskan shaf termasuk kesempurnaan sholat.”
              </p>
              <p class="text-[1.1vw] text-[#F59E0B] font-semibold mt-[1.5vh]">
                HR. Bukhari no. 723 & Muslim no. 433
              </p>
            </div>
          )}

          {/* Navigasi & Indikator Slide Aksesibel */}
          {slides.length > 1 && (
            <div class="flex items-center justify-between mt-[1.2vh] pt-[0.8vh] border-t border-slate-600/40">
              <div class="flex items-center gap-1.5">
                {slides.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Tampilkan slide ${idx + 1}`}
                    onClick={() => setSlideIndex(idx)}
                    class={`h-2 rounded-full transition-all cursor-pointer ${
                      idx === slideIndex % slides.length
                        ? 'w-7 bg-[#F59E0B]'
                        : 'w-2 bg-slate-500/60 hover:bg-slate-400'
                    }`}
                  />
                ))}
              </div>
              <span class="text-[0.8vw] text-[#94A3B8] tabular-nums font-medium">
                Slide {(slideIndex % slides.length) + 1} / {slides.length}
              </span>
            </div>
          )}
        </section>

        {/* Panel Kanan (4 Kolom): Spotlight Sholat Berikutnya & Panduan Jamaah */}
        <aside class="col-span-4 bg-[#334155]/95 border border-slate-600/60 rounded-2xl p-[1.9vw] flex flex-col justify-between shadow-lg">
          <div class="bg-[#0F172A] border border-[#F59E0B]/40 rounded-2xl p-[1.4vw]">
            <div class="flex items-center justify-between">
              <span class="text-[0.9vw] font-bold uppercase tracking-widest text-[#F59E0B]">
                Jadwal Berikutnya
              </span>
              <PrayerTimeIcon
                prayerKey={fsm.nextPrayerKey}
                className="w-[1.5vw] h-[1.5vw] text-[#F59E0B]"
              />
            </div>
            <div class="flex items-baseline justify-between mt-[0.8vh]">
              <h3 class="text-[2.4vw] font-black text-white">
                {fsm.nextPrayerName}
              </h3>
              <span class="text-[2.5vw] font-black text-[#F59E0B] tabular-nums">
                {prayerSchedule.times[fsm.nextPrayerKey]}
              </span>
            </div>
            <div class="mt-[1.2vh] pt-[1vh] border-t border-slate-800 flex items-center justify-between">
              <span class="text-[0.95vw] text-[#94A3B8]">Hitung Mundur</span>
              <span class="text-[1.35vw] font-extrabold text-white tabular-nums">
                - {formatCountdownHMS(fsm.secondsUntilNext)}
              </span>
            </div>
          </div>

          <div class="pt-[1.2vh]">
            <div class="text-[0.92vw] font-bold uppercase tracking-widest text-[#94A3B8] mb-[1vh]">
              Ketertiban & Kekhusyukan
            </div>
            <ul class="space-y-[0.9vh] text-[0.98vw] text-slate-200">
              <li class="flex items-center gap-[0.65vw]">
                <CheckCircleIcon className="w-[1.15vw] h-[1.15vw] text-[#F59E0B] shrink-0" />
                <span>Luruskan & rapatkan barisan shaf dari depan</span>
              </li>
              <li class="flex items-center gap-[0.65vw]">
                <CheckCircleIcon className="w-[1.15vw] h-[1.15vw] text-[#F59E0B] shrink-0" />
                <span>Nonaktifkan atau heningkan dering ponsel</span>
              </li>
              <li class="flex items-center gap-[0.65vw]">
                <CheckCircleIcon className="w-[1.15vw] h-[1.15vw] text-[#F59E0B] shrink-0" />
                <span>Jaga ketenangan selama dzikir & kajian</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>

      {/* 3. CARD GRID: 6 Kolom Jadwal Sholat (Dimensi Box-Model Stabil Tanpa Pergeseran) */}
      <section aria-label="Jadwal Waktu Sholat Hari Ini" class="grid grid-cols-6 gap-[1.1vw] mb-[1.5vh]">
        {PRAYER_ORDER.map((key) => {
          const isNext = fsm.nextPrayerKey === key;
          const isFardhu = FARDHU_KEYS.includes(key);
          const iqomahMin = settings.iqomah_durations?.[key];

          return (
            <div
              key={key}
              class={`rounded-2xl px-[1.3vw] py-[1.5vh] border-2 transition-colors duration-200 flex flex-col justify-between ${
                isNext
                  ? 'bg-[#0F172A] border-[#F59E0B] shadow-[0_0_28px_rgba(245,158,11,0.28)]'
                  : 'bg-[#334155]/95 border-slate-600/60'
              }`}
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-[0.45vw]">
                  <PrayerTimeIcon
                    prayerKey={key}
                    className={`w-[1.25vw] h-[1.25vw] ${
                      isNext ? 'text-[#F59E0B]' : 'text-[#94A3B8]'
                    }`}
                  />
                  <span
                    class={`text-[1.15vw] font-bold uppercase tracking-wider ${
                      isNext ? 'text-[#F59E0B]' : 'text-slate-300'
                    }`}
                  >
                    {PRAYER_LABELS[key]}
                  </span>
                </div>

                {isNext ? (
                  <span class="px-[0.5vw] py-[0.15vh] rounded bg-[#F59E0B] text-slate-950 text-[0.7vw] font-extrabold uppercase tracking-wider">
                    Aktif
                  </span>
                ) : isFardhu && iqomahMin ? (
                  <span class="text-[0.78vw] text-[#94A3B8] tabular-nums font-medium">
                    +{iqomahMin}m
                  </span>
                ) : null}
              </div>

              <div
                class={`text-[2.85vw] font-black tabular-nums leading-none mt-[0.9vh] ${
                  isNext ? 'text-white' : 'text-slate-100'
                }`}
              >
                {prayerSchedule.times[key]}
              </div>
            </div>
          );
        })}
      </section>

      {/* 4. FOOTER: Running Text (Pengumuman & Himbauan dengan Ornamen Vektor) */}
      <footer class="bg-[#0F172A] border border-slate-700 rounded-xl px-[1.4vw] py-[1vh] overflow-hidden flex items-center gap-[1.1vw]">
        <span class="inline-flex items-center gap-[0.4vw] px-[0.85vw] py-[0.3vh] rounded-lg bg-[#F59E0B] text-slate-950 font-extrabold text-[0.9vw] uppercase tracking-wider shrink-0">
          <RubElHizbIcon className="w-[0.9vw] h-[0.9vw]" />
          <span>Pengumuman</span>
        </span>
        <div class="overflow-hidden flex-1 relative">
          <div class="animate-marquee text-[1.15vw] font-medium text-slate-100">
            {[...announcements, ...announcements].map((item, idx) => (
              <span key={`${item.id}-${idx}`} class="mx-[2.2vw] inline-flex items-center gap-[1.2vw]">
                <span>{item.text}</span>
                <RubElHizbIcon className="w-[0.95vw] h-[0.95vw] text-[#F59E0B] shrink-0" />
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
    { label: 'Otomatis', value: null },
    { label: '1. STANDBY', value: KIOSK_STATES.STANDBY },
    { label: '2. AZAN_ALERT', value: KIOSK_STATES.AZAN_ALERT },
    { label: '3. IQOMAH_COUNTDOWN', value: KIOSK_STATES.IQOMAH_COUNTDOWN },
    { label: '4. SHOLAT', value: KIOSK_STATES.SHOLAT }
  ];
  return (
    <div class="fixed bottom-3 right-3 z-50 bg-[#0F172A]/95 border border-slate-600 rounded-xl p-2 flex items-center gap-2 text-xs shadow-2xl">
      <span class="text-[#94A3B8] px-2 font-semibold">Simulasi FSM:</span>
      {states.map((s) => (
        <button
          key={String(s.value)}
          type="button"
          onClick={() => onSelect(s.value)}
          class={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#F59E0B] ${
            current === s.value
              ? 'bg-[#F59E0B] text-slate-950 font-bold'
              : 'bg-[#1E293B] text-slate-200 hover:bg-slate-700'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
