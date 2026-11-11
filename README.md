# ShafSync (`shaf-sync`)

**Open-Source Offline Digital Signage & Prayer Kiosk** untuk Masjid dan Musholla. Dirancang khusus agar berjalan sangat ringan pada TV Box Android bekas berbasis Linux/Armbian (HG680-P, B860H, X96 Mini), Raspberry Pi, maupun Mini PC x86 **100% tanpa ketergantungan internet**.

---

## Fitur Utama

1. **100% Offline-First Hisab Engine (Standar Kemenag RI / SIHAT)**
   * Menghitung waktu **Subuh ($-20^\circ$)**, **Terbit**, **Dzuhur**, **Ashar (Syafi'i)**, **Maghrib**, dan **Isya ($-18^\circ$)** secara astronomis lokal beserta faktor pengaman *Ihtiyat* $+2$ menit dan opsi koreksi manual $\pm 10$ menit.
   * Konversi penanggalan **Hijriah lokal** dengan koreksi manual $\pm 2$ hari mengikuti hasil sidang isbat.
2. **Solusi TV Box Tanpa Baterai CMOS/RTC**
   * **One-Tap Phone Time Sync:** Sinkronkan jam TV dengan jam HP takmir dalam 1 sentuhan ($\le 1.5\text{ detik}$) melalui Wi-Fi lokal.
   * **Persistent Periodic Time Bookmark:** Menyimpan bookmark waktu setiap 60 detik agar jam sistem tidak pernah melompat mundur ke tahun 1970 saat listrik padam.
3. **Finite State Machine (FSM) 4 Fase Otomatis**
   * `STANDBY`: Jam digital `tabular-nums`, kalender Masehi & Hijriah, 6 kartu waktu sholat (*active glow*), slider laporan kas & poster kajian/QRIS, serta *running text*.
   * `AZAN_ALERT`: Nada lembut Web Audio API (tanpa file MP3 eksternal) & tampilan fokus panggilan azan.
   * `IQOMAH_COUNTDOWN`: Hitung mundur ekstra besar ($\ge 120\text{pt}$), indikator warna kuning pada 30 detik terakhir, dan bip ritmis pada 5 detik terakhir.
   * `SHOLAT`: Layar hitam pekat (`#000000`) bebas distraksi cahaya dengan pesan tenang merapatkan shaf.
4. **Penyimpanan Non-SQL Atomic JSON Store**
   * Bebas kompilasi modul C++ di arsitektur ARM (`aarch64`/`armv7`) dan tahan mati listrik mendadak berkat mekanisme *atomic write* (`fsync` + `.bak` recovery).

---

## Cara Menjalankan (Development / PC Lokal)

```bash
# 1. Instal dependensi
npm install

# 2. Jalankan unit & API test
npm test

# 3. Build aset frontend dan jalankan server appliance lokal
npm run build
npm start
```

* **Tampilan TV Kiosk:** `http://localhost:3000/`
* **Mode Simulasi 4 State FSM:** `http://localhost:3000/?preview=1`
* **Dashboard Mobile Admin DKM:** `http://localhost:3000/admin` (PIN Awal: **`123456`**)

---

## Instalasi Otomatis pada TV Box Armbian / Ubuntu

```bash
sudo chmod +x install.sh start-kiosk.sh
sudo ./install.sh
```
