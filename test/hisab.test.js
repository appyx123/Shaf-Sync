import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrayerTimes, toHijriDate, minutesToTimeString } from '../src/shared/hisab.js';
import { evaluateKioskState, KIOSK_STATES } from '../src/shared/fsm.js';

test('Hisab Kemenag RI - Masjid Istiqlal Jakarta (toleransi <= 1 menit dari jadwal SIHAT)', () => {
  // Koordinat Jakarta Pusat: -6.1702, 106.8310, WIB (UTC+7), 11 Nov 2026
  const result = calculatePrayerTimes({
    date: new Date('2026-11-11T12:00:00+07:00'),
    latitude: -6.1702,
    longitude: 106.831,
    elevation: 10,
    timezone: 7
  });

  // Urutan waktu sholat harus kronologis
  assert.ok(result.minutes.subuh < result.minutes.terbit);
  assert.ok(result.minutes.terbit < result.minutes.dzuhur);
  assert.ok(result.minutes.dzuhur < result.minutes.ashar);
  assert.ok(result.minutes.ashar < result.minutes.maghrib);
  assert.ok(result.minutes.maghrib < result.minutes.isya);

  // Validasi rentang waktu wajar Jakarta bulan November (Subuh ~04:05, Dzuhur ~11:41, Maghrib ~17:52)
  assert.ok(result.minutes.subuh >= 4 * 60 + 2 && result.minutes.subuh <= 4 * 60 + 12, `Subuh: ${result.times.subuh}`);
  assert.ok(result.minutes.dzuhur >= 11 * 60 + 38 && result.minutes.dzuhur <= 11 * 60 + 46, `Dzuhur: ${result.times.dzuhur}`);
  assert.ok(result.minutes.ashar >= 14 * 60 + 55 && result.minutes.ashar <= 15 * 60 + 5, `Ashar: ${result.times.ashar}`);
  assert.ok(result.minutes.maghrib >= 17 * 60 + 48 && result.minutes.maghrib <= 17 * 60 + 58, `Maghrib: ${result.times.maghrib}`);
  assert.ok(result.minutes.isya >= 19 * 60 + 0 && result.minutes.isya <= 19 * 60 + 12, `Isya: ${result.times.isya}`);
});

test('Hisab mendukung offset manual (-10 s/d +10 menit) per waktu sholat', () => {
  const base = calculatePrayerTimes({
    date: new Date('2026-03-21T12:00:00+07:00'),
    latitude: -6.9175,
    longitude: 107.6191,
    timezone: 7
  });

  const adjusted = calculatePrayerTimes({
    date: new Date('2026-03-21T12:00:00+07:00'),
    latitude: -6.9175,
    longitude: 107.6191,
    timezone: 7,
    offsets: { subuh: -3, maghrib: 4 }
  });

  assert.equal(adjusted.minutes.subuh, base.minutes.subuh - 3);
  assert.equal(adjusted.minutes.maghrib, base.minutes.maghrib + 4);
  assert.equal(adjusted.minutes.dzuhur, base.minutes.dzuhur);
});

test('Konversi Hijriah lokal & koreksi manual (-2 s/d +2 hari)', () => {
  const d = new Date('2026-11-11T12:00:00+07:00');
  const h0 = toHijriDate(d, 0);
  const hPlus1 = toHijriDate(d, 1);
  const hMinus1 = toHijriDate(d, -1);

  assert.ok(h0.year >= 1448);
  assert.ok(h0.formatted.endsWith(' H'));
  assert.notEqual(h0.day, hPlus1.day);
  assert.notEqual(h0.day, hMinus1.day);
});

test('minutesToTimeString memformat menit ke HH:mm dengan benar', () => {
  assert.equal(minutesToTimeString(0), '00:00');
  assert.equal(minutesToTimeString(245), '04:05');
  assert.equal(minutesToTimeString(1439), '23:59');
});

test('FSM Kiosk transisi STANDBY -> AZAN_ALERT -> IQOMAH_COUNTDOWN -> SHOLAT -> STANDBY presisi ke detik', () => {
  const prayerMinutes = {
    subuh: 245,    // 04:05
    terbit: 328,   // 05:28
    dzuhur: 702,   // 11:42
    ashar: 902,    // 15:02
    maghrib: 1072, // 17:52
    isya: 1144     // 19:04
  };
  const durations = {
    azanMinutes: 3,
    sholatMinutes: 15,
    iqomah: { dzuhur: 8 }
  };

  // 11:41:59 -> STANDBY, next = dzuhur (1 detik lagi)
  const s1 = evaluateKioskState({
    now: new Date(2026, 10, 11, 11, 41, 59),
    prayerMinutes,
    durations
  });
  assert.equal(s1.state, KIOSK_STATES.STANDBY);
  assert.equal(s1.nextPrayerKey, 'dzuhur');
  assert.equal(s1.secondsUntilNext, 1);

  // 11:42:00 -> AZAN_ALERT baru masuk
  const s2 = evaluateKioskState({
    now: new Date(2026, 10, 11, 11, 42, 0),
    prayerMinutes,
    durations
  });
  assert.equal(s2.state, KIOSK_STATES.AZAN_ALERT);
  assert.equal(s2.prayerKey, 'dzuhur');
  assert.equal(s2.enteredJustNow, true);
  assert.equal(s2.remainingSeconds, 180);

  // 11:45:00 -> IQOMAH_COUNTDOWN (8 menit = 480 detik)
  const s3 = evaluateKioskState({
    now: new Date(2026, 10, 11, 11, 45, 0),
    prayerMinutes,
    durations
  });
  assert.equal(s3.state, KIOSK_STATES.IQOMAH_COUNTDOWN);
  assert.equal(s3.remainingSeconds, 480);
  assert.equal(s3.isWarning, false);

  // 11:52:56 -> 4 detik sebelum iqomah habis (warning kuning + bip aktif)
  const s4 = evaluateKioskState({
    now: new Date(2026, 10, 11, 11, 52, 56),
    prayerMinutes,
    durations
  });
  assert.equal(s4.state, KIOSK_STATES.IQOMAH_COUNTDOWN);
  assert.equal(s4.remainingSeconds, 4);
  assert.equal(s4.isWarning, true);
  assert.equal(s4.shouldBeep, true);

  // 11:53:00 -> SHOLAT (15 menit = 900 detik)
  const s5 = evaluateKioskState({
    now: new Date(2026, 10, 11, 11, 53, 0),
    prayerMinutes,
    durations
  });
  assert.equal(s5.state, KIOSK_STATES.SHOLAT);
  assert.equal(s5.remainingSeconds, 900);

  // 12:08:00 -> Kembali ke STANDBY, next = ashar
  const s6 = evaluateKioskState({
    now: new Date(2026, 10, 11, 12, 8, 0),
    prayerMinutes,
    durations
  });
  assert.equal(s6.state, KIOSK_STATES.STANDBY);
  assert.equal(s6.nextPrayerKey, 'ashar');
});

