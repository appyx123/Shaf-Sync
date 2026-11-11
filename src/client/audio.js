/**
 * Web Audio API Local Synthesizer (100% Offline, Tanpa File MP3 Eksternal)
 * - playAzanChime(): nada lembut 3-harmoni saat waktu sholat fardhu masuk
 * - playCountdownBeep(): nada bip ritmis pada 5 detik terakhir iqomah
 */

let sharedAudioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playTone({ freq = 880, duration = 0.25, delay = 0, type = 'sine', gain = 0.18 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const startAt = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);

  amp.gain.setValueAtTime(0.0001, startAt);
  amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(amp);
  amp.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Bunyi bip nada lembut 3 ketuk saat memasuki waktu Azan
 */
export function playAzanChime() {
  playTone({ freq: 587.33, duration: 0.45, delay: 0.0, type: 'sine', gain: 0.22 }); // D5
  playTone({ freq: 783.99, duration: 0.45, delay: 0.5, type: 'sine', gain: 0.22 }); // G5
  playTone({ freq: 880.0, duration: 0.9, delay: 1.0, type: 'sine', gain: 0.25 });   // A5
}

/**
 * Bunyi bip ritmis setiap detik pada 5 detik terakhir Iqomah (00:05 s/d 00:01)
 */
export function playCountdownBeep(isLastSecond = false) {
  playTone({
    freq: isLastSecond ? 1046.5 : 784.0,
    duration: isLastSecond ? 0.55 : 0.18,
    delay: 0,
    type: 'sine',
    gain: 0.22
  });
}
