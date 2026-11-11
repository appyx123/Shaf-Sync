/**
 * Mesin Hisab Waktu Sholat & Penanggalan Hijriah Lokal (100% Offline)
 * Standar Parameter: Kementerian Agama RI (SIHAT)
 * - Subuh: -20°
 * - Isya: -18°
 * - Ashar: Syafi'i (rasio bayangan = 1 + tan(|lintang - deklinasi|))
 * - Refraksi & Dip ufuk: -0.8333° - 0.0347 * sqrt(elevasi)
 * - Ihtiyat: +2 menit untuk seluruh waktu sholat fardhu
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const sinD = (deg) => Math.sin(deg * DEG2RAD);
const cosD = (deg) => Math.cos(deg * DEG2RAD);
const tanD = (deg) => Math.tan(deg * DEG2RAD);
const asinD = (x) => Math.asin(Math.max(-1, Math.min(1, x))) * RAD2DEG;
const acosD = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * RAD2DEG;
const atan2D = (y, x) => Math.atan2(y, x) * RAD2DEG;
const acotD = (x) => Math.atan(1 / x) * RAD2DEG;

const normalizeAngle = (deg) => ((deg % 360) + 360) % 360;

/**
 * Hitung Julian Day dari tanggal kalender Masehi (UT)
 */
export function toJulianDay(year, month, day, utHours = 0) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    utHours / 24 +
    B -
    1524.5
  );
}

/**
 * Deklinasi matahari (derajat) dan Equation of Time (jam) menggunakan algoritma Jean Meeus
 */
export function solarPosition(jd) {
  const T = (jd - 2451545.0) / 36525.0;

  // Mean longitude matahari (derajat)
  const L0 = normalizeAngle(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  // Mean anomaly matahari (derajat)
  const M = normalizeAngle(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  // Eksentrisitas orbit bumi
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  // Equation of center
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sinD(M) +
    (0.019993 - 0.000101 * T) * sinD(2 * M) +
    0.000289 * sinD(3 * M);

  // True longitude & apparent longitude
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * sinD(omega);

  // Kemiringan ekliptika (obliquity)
  const epsilon0 =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const epsilon = epsilon0 + 0.00256 * cosD(omega);

  // Deklinasi matahari
  const declination = asinD(sinD(epsilon) * sinD(lambda));

  // Right Ascension & Equation of Time (dalam jam)
  const y = Math.pow(tanD(epsilon / 2), 2);
  const eqTimeRad =
    y * sinD(2 * L0) -
    2 * e * sinD(M) +
    4 * e * y * sinD(M) * cosD(2 * L0) -
    0.5 * y * y * sinD(4 * L0) -
    1.25 * e * e * sinD(2 * M);
  const equationOfTimeHours = (eqTimeRad * RAD2DEG) / 15;

  return { declination, equationOfTimeHours };
}

/**
 * Hitung sudut waktu (Hour Angle) dalam satuan jam untuk ketinggian matahari tertentu
 * Mengembalikan null pada wilayah lintang ekstrem bila matahari tidak mencapai sudut tersebut.
 */
function hourAngleHours(latitude, declination, altitudeDeg) {
  const num = sinD(altitudeDeg) - sinD(latitude) * sinD(declination);
  const den = cosD(latitude) * cosD(declination);
  const cosH = num / den;
  if (cosH < -1 || cosH > 1) return null;
  return acosD(cosH) / 15;
}

/**
 * Format total menit dari tengah malam menjadi string "HH:mm"
 */
export function minutesToTimeString(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Hitung jadwal sholat harian sesuai standar Kemenag RI (SIHAT)
 * @param {Object} params
 * @param {Date} [params.date] - Tanggal perhitungan (default: new Date())
 * @param {number} params.latitude - Lintang geografis (mis. -6.1702 untuk Jakarta)
 * @param {number} params.longitude - Bujur geografis (mis. 106.8310 untuk Jakarta)
 * @param {number} [params.elevation=0] - Tinggi lokasi di atas permukaan laut (meter)
 * @param {number} [params.timezone] - Zona waktu UTC offset (jam, mis. 7 untuk WIB)
 * @param {number} [params.ihtiyat=2] - Pengaman waktu Kemenag RI (menit, default: 2)
 * @param {number} [params.zawal=1] - Margin tergelincir matahari Dzuhur (menit, default: 1)
 * @param {Object} [params.offsets] - Penyesuaian manual (-10 s/d +10 menit) per waktu
 */
export function calculatePrayerTimes({
  date = new Date(),
  latitude,
  longitude,
  elevation = 0,
  timezone,
  ihtiyat = 2,
  zawal = 1,
  offsets = {}
}) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new TypeError('Koordinat latitude dan longitude wajib berupa angka valid');
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const tz = typeof timezone === 'number' ? timezone : -date.getTimezoneOffset() / 60;

  // Evaluasi posisi matahari pada tengah hari waktu lokal (12:00 local)
  const jdNoon = toJulianDay(year, month, day, 12 - tz);
  const { declination, equationOfTimeHours } = solarPosition(jdNoon);

  // Transit meridian (Istiwa') dalam jam lokal
  const transitHours = 12 + tz - longitude / 15 - equationOfTimeHours;

  // Sudut koreksi ufuk (refraksi atmosfer 0.8333° + koreksi ketinggian tempat)
  const horizonDip = 0.8333 + 0.0347 * Math.sqrt(Math.max(0, elevation));

  // Sudut ketinggian Ashar Mazhab Syafi'i (rasio bayangan = 1 + tan(|phi - delta|))
  const asrAltitude = acotD(1 + tanD(Math.abs(latitude - declination)));

  const haSubuh = hourAngleHours(latitude, declination, -20.0) ?? 5.0;
  const haTerbit = hourAngleHours(latitude, declination, -horizonDip) ?? 6.0;
  const haAshar = hourAngleHours(latitude, declination, asrAltitude) ?? 3.2;
  const haMaghrib = haTerbit;
  const haIsya = hourAngleHours(latitude, declination, -18.0) ?? 4.8;

  // Waktu mentah dalam menit dari pukul 00:00 ditambah Ihtiyat + Zawal + Offset manual
  // Standar Kemenag RI membulatkan detik ke menit berikutnya (Math.ceil) atau pembulatan ihtiyat
  const rawMinutes = {
    subuh: (transitHours - haSubuh) * 60 + ihtiyat + (Number(offsets.subuh) || 0),
    terbit: (transitHours - haTerbit) * 60 - ihtiyat + (Number(offsets.terbit) || 0),
    dzuhur: transitHours * 60 + zawal + ihtiyat + (Number(offsets.dzuhur) || 0),
    ashar: (transitHours + haAshar) * 60 + ihtiyat + (Number(offsets.ashar) || 0),
    maghrib: (transitHours + haMaghrib) * 60 + ihtiyat + (Number(offsets.maghrib) || 0),
    isya: (transitHours + haIsya) * 60 + ihtiyat + (Number(offsets.isya) || 0)
  };

  const times = {};
  const minutes = {};
  for (const [key, val] of Object.entries(rawMinutes)) {
    const rounded = Math.round(val);
    minutes[key] = rounded;
    times[key] = minutesToTimeString(rounded);
  }

  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timezone: tz,
    coordinates: { latitude, longitude, elevation },
    times,
    minutes
  };
}

const HIJRI_MONTHS_ID = [
  'Muharram',
  'Safar',
  'Rabiul Awal',
  'Rabiul Akhir',
  'Jumadil Awal',
  'Jumadil Akhir',
  'Rajab',
  "Sya'ban",
  'Ramadhan',
  'Syawal',
  'Dzulqaidah',
  'Dzulhijjah'
];

/**
 * Konversi tanggal Masehi ke Hijriah secara lokal (Ummul Qura dengan fallback Tabular Hijri)
 * @param {Date} [date=new Date()] - Tanggal Masehi
 * @param {number} [correctionDays=0] - Koreksi manual (-2 s/d +2 hari hasil rukyat/isbat)
 */
export function toHijriDate(date = new Date(), correctionDays = 0) {
  const offset = Math.max(-2, Math.min(2, Number(correctionDays) || 0));
  const adjusted = new Date(date.getTime());
  adjusted.setDate(adjusted.getDate() + offset);

  // Gunakan kalender Ummul Qura bawaan runtime bila tersedia
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric'
    }).formatToParts(adjusted);

    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const year = Number(parts.find((p) => p.type === 'year')?.value);

    if (day && month >= 1 && month <= 12 && year > 1300) {
      const monthName = HIJRI_MONTHS_ID[month - 1];
      return {
        day,
        month,
        monthName,
        year,
        formatted: `${day} ${monthName} ${year} H`
      };
    }
  } catch {
    // Lanjut ke algoritma aritmatika Tabular jika ICU tidak mendukung islamic-umalqura
  }

  // Fallback algoritma Kuwaiti / Tabular Islamic Calendar (100% deterministik tanpa ICU)
  const jd = Math.floor(
    toJulianDay(adjusted.getFullYear(), adjusted.getMonth() + 1, adjusted.getDate(), 12)
  );
  const l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  const l2 = l - 10631 * n + 354;
  const j =
    Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
    Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  const l3 =
    l2 -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const month = Math.floor((24 * l3) / 709);
  const day = l3 - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  const monthName = HIJRI_MONTHS_ID[month - 1] || 'Muharram';

  return {
    day,
    month,
    monthName,
    year,
    formatted: `${day} ${monthName} ${year} H`
  };
}
