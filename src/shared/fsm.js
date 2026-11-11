/**
 * Finite State Machine (FSM) Kiosk Display ShafSync
 * States: STANDBY -> AZAN_ALERT -> IQOMAH_COUNTDOWN -> SHOLAT -> STANDBY
 */

export const KIOSK_STATES = {
  STANDBY: 'STANDBY',
  AZAN_ALERT: 'AZAN_ALERT',
  IQOMAH_COUNTDOWN: 'IQOMAH_COUNTDOWN',
  SHOLAT: 'SHOLAT'
};

export const FARDHU_KEYS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];

export const PRAYER_LABELS = {
  subuh: 'Subuh',
  terbit: 'Terbit',
  dzuhur: 'Dzuhur',
  ashar: 'Ashar',
  maghrib: 'Maghrib',
  isya: 'Isya'
};

/**
 * Evaluasi state tampilan Kiosk pada detik tertentu
 * @param {Object} params
 * @param {Date} params.now - Waktu saat ini
 * @param {Object} params.prayerMinutes - Map waktu sholat dalam menit dari 00:00 ({ subuh, terbit, dzuhur, ashar, maghrib, isya })
 * @param {Object} params.durations - Konfigurasi durasi ({ azanMinutes, sholatMinutes, iqomah: { subuh, dzuhur, ashar, maghrib, isya } })
 */
export function evaluateKioskState({ now, prayerMinutes, durations = {} }) {
  const currentSeconds =
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const azanSec = (Number(durations.azanMinutes) || 3) * 60;
  const sholatSec = (Number(durations.sholatMinutes) || 15) * 60;
  const iqomahMap = {
    subuh: 12,
    dzuhur: 8,
    ashar: 8,
    maghrib: 7,
    isya: 10,
    ...(durations.iqomah || {})
  };

  for (const key of FARDHU_KEYS) {
    const startMin = prayerMinutes[key];
    if (typeof startMin !== 'number') continue;

    const startSec = startMin * 60;
    const iqomahSec = (Number(iqomahMap[key]) || 8) * 60;

    const azanEndSec = startSec + azanSec;
    const iqomahEndSec = azanEndSec + iqomahSec;
    const sholatEndSec = iqomahEndSec + sholatSec;

    if (currentSeconds >= startSec && currentSeconds < azanEndSec) {
      return {
        state: KIOSK_STATES.AZAN_ALERT,
        prayerKey: key,
        prayerName: PRAYER_LABELS[key],
        remainingSeconds: azanEndSec - currentSeconds,
        enteredJustNow: currentSeconds === startSec
      };
    }

    if (currentSeconds >= azanEndSec && currentSeconds < iqomahEndSec) {
      const remainingSeconds = iqomahEndSec - currentSeconds;
      return {
        state: KIOSK_STATES.IQOMAH_COUNTDOWN,
        prayerKey: key,
        prayerName: PRAYER_LABELS[key],
        remainingSeconds,
        isWarning: remainingSeconds <= 30,
        shouldBeep: remainingSeconds <= 5 && remainingSeconds >= 1
      };
    }

    if (currentSeconds >= iqomahEndSec && currentSeconds < sholatEndSec) {
      return {
        state: KIOSK_STATES.SHOLAT,
        prayerKey: key,
        prayerName: PRAYER_LABELS[key],
        remainingSeconds: sholatEndSec - currentSeconds
      };
    }
  }

  // Tentukan jadwal sholat berikutnya (termasuk Terbit di grid 6 kartu)
  const allOrder = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  let nextPrayerKey = 'subuh';
  let secondsUntilNext = 0;

  const foundNext = allOrder.find((k) => currentSeconds < prayerMinutes[k] * 60);
  if (foundNext) {
    nextPrayerKey = foundNext;
    secondsUntilNext = prayerMinutes[foundNext] * 60 - currentSeconds;
  } else {
    nextPrayerKey = 'subuh';
    secondsUntilNext = 86400 - currentSeconds + prayerMinutes.subuh * 60;
  }

  return {
    state: KIOSK_STATES.STANDBY,
    nextPrayerKey,
    nextPrayerName: PRAYER_LABELS[nextPrayerKey],
    secondsUntilNext
  };
}
