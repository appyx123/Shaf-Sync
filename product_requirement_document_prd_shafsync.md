# Product Requirement Document (PRD)
# ShafSync: Open-Source Offline Digital Signage & Prayer Kiosk

---

## 1. Identitas Dokumen & Metadata Proyek

| Atribut | Nilai |
| :--- | :--- |
| **Nama Proyek** | ShafSync (`shaf-sync`) |
| **Tipe Perangkat Lunak** | Open-Source Self-Hosted Kiosk & Digital Signage |
| **Target Lingkungan** | Linux/Armbian OS (TV Box Android bekas: HG680-P, B860H, X96 Mini), Raspberry Pi, Mini PC x86 |
| **Arsitektur Operasional** | **100% Offline-First Local Appliance** (Local Server + Kiosk Browser) |
| **Target Tampilan** | Smart TV / Monitor LED 1080p (1920x1080) rasio 16:9 Landscape |
| **Lisensi** | MIT License |
| **Target Pengguna** | Pengurus Masjid / Dewan Kemakmuran Masjid (DKM), Takmir, Jamaah |

---

## 2. Latar Belakang & Pernyataan Masalah

Banyak masjid dan musholla di Indonesia menghadapi kendala berikut:
1. **Biaya Hardware Proprietary Mahal:** Paket mesin digital signage masjid komersial dijual berkisar Rp 2.500.000 – Rp 6.000.000, membebani kas musholla kecil.
2. **Ketergantungan Internet yang Rapuh:** Banyak aplikasi display modern bergantung pada API cloud. Ketika koneksi internet masjid mati atau kehabisan paket data, tampilan layar berhenti beroperasi (*error*).
3. **Ketiadaan Hardware RTC (Real-Time Clock) pada TV Box Murahan:** TV Box berbasis SoC Amlogic/Allwinner tidak memiliki baterai CMOS/RTC. Ketika listrik padam dan perangkat menyala kembali tanpa koneksi internet (NTP tidak aktif), jam sistem melompat mundur ke epoch 1970, membuat seluruh jadwal sholat meleset.
4. **Kesulitan Operasional bagi Takmir Awam:** Memperbarui saldo kas atau pengumuman via keyboard/mouse pada perangkat yang terpasang di dinding masjid sangat tidak praktis.

---

## 3. Visi & Prinsip Rekayasa (Engineering Principles)

1. **Zero External Dependency:** Aplikasi harus dapat *booting*, menghitung waktu sholat, dan berjalan tanpa internet seumur hidup perangkat.
2. **Local Appliance Topology:** Satu perangkat menjalankan local server ringan sekaligus menampilkan browser kiosk. DKM dapat mengonfigurasi perangkat dari HP mereka cukup dengan terhubung ke Wi-Fi lokal yang sama.
3. **Low Resource Footprint:** Total konsumsi RAM seluruh sistem (OS + Server + Chromium Kiosk) tidak boleh melebihi **400 MB**, dengan runtime server tidak melebihi **80 MB** RAM.
4. **Distraction-Free Protocol:** Saat azan dan sholat berjamaah berlangsung, layar wajib mengeliminasi distraksi visual dan cahaya demi menjaga kekhusyukan jamaah di shaf pertama.

---

## 4. Arsitektur Teknis Sistem

ShafSync beroperasi menggunakan model **Single-Box Local Appliance Architecture**:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      TV BOX / MINI PC (DEVICE)                         │
 │                                                                        │
 │  ┌─────────────────────────┐           ┌─────────────────────────────┐ │
 │  │  Chromium Kiosk Mode    │           │  Node.js / Hono Local Server│ │
 │  │  (Fullscreen 1080p)     │  HTTP/SSE │  (Port 3000)                │ │
 │  │  - URL: localhost:3000  │ ◄───────► │  - Static Files Servicing   │ │
 │  │  - No Cursor / No Nav   │           │  - Calculation Engine       │ │
 │  └─────────────────────────┘           │  - REST & SSE Endpoint      │ │
 │                                        │  - OS Time Sync Executable  │ │
 │                                        └──────────────┬──────────────┘ │
 │                                                       │ Read/Write     │
 │                                        ┌──────────────▼──────────────┐ │
 │                                        │ Local Database (SQLite/JSON)│ │
 │                                        └─────────────────────────────┘ │
 └───────────────────────────────────▲────────────────────────────────────┘
                                     │
                                     │ LAN / Wi-Fi Lokal (Port 3000)
                                     │
                 ┌───────────────────┴───────────────────┐
                 │  Smartphone Takmir / DKM              │
                 │  - URL: http://shafsync.local:3000/admin │
                 │  - Sinkronkan Jam, Edit Kas, Edit Teks │
                 └───────────────────────────────────────┘
```

### 4.1. Komponen Stack Perangkat Lunak
* **Backend Runtime:** Node.js (v18+ LTS) dengan framework ultra-ringan **Hono** atau **Fastify**.
* **Database / Persistence:** SQLite via `better-sqlite3` (atau JSON store dengan atomic write) disimpan pada storage internal perangkat.
* **Frontend:** Single Page Application (SPA) dibangun dengan **Vite + Vanilla JS / Preact** dan **Tailwind CSS**. 
* **Real-time Pipeline:** **Server-Sent Events (SSE)** lokal pada endpoint `/api/events` untuk memicu pembaruan instan pada layar TV saat admin mengubah data dari ponsel.
* **Kiosk Runner:** Script bash systemd yang menjalankan `chromium-browser` dengan flag `--kiosk`.

---

## 5. Mitigasi Ketiadaan Hardware RTC (Clock Drift Solution)

Untuk mengatasi hilangnya waktu sistem pada TV Box murah saat mati listrik tanpa internet:

### 5.1. Mekanisme "One-Tap Phone Time Sync"
1. Takmir membuka dashboard admin di ponsel pintar melalui browser (`http://shafsync.local:3000/admin` atau via IP lokal perangkat).
2. Terdapat indikator peringatan status waktu di halaman admin jika waktu server berbeda $>60$ detik dari waktu ponsel takmir.
3. Tombol **"Sinkronkan Jam TV dengan Jam HP"**:
   * Frontend admin mengambil timestamp presisi HP (`new Date().toISOString()`).
   * Melakukan `POST /api/system/time` dengan payload timestamp tersebut.
   * Server mengeksekusi perintah level OS (via sudo hook tanpa password):
     ```bash
     sudo timedatectl set-ntp false
     sudo date -s "2026-11-11 12:30:00"
     ```
   * Server memancarkan event SSE `TIME_RESYNCED` ke layar TV untuk me-refresh clock engine seketika.

### 5.2. Persistent Periodic Time Bookmark
* Server menulis timestamp saat ini ke file database setiap 60 detik.
* Saat sistem boot ulang tanpa internet, server membaca bookmark terakhir. Jika waktu sistem OS lebih lampau dari waktu bookmark, server secara otomatis memajukan jam sistem ke waktu bookmark terakhir untuk mencegah bug tahun 1970 sebelum takmir melakukan sinkronisasi presisi.

---

## 6. Finite State Machine (FSM) Kiosk Display

Tampilan TV beroperasi di bawah 4 state otomatis berbasis perbandingan jam lokal terhadap jadwal sholat:

```
[ STANDBY ] ──(Waktu Sholat Masuk)──► [ AZAN_ALERT ]
     ▲                                       │
     │                                (Durasi Azan Selesai)
     │                                       ▼
 [ SHOLAT ] ◄──(Timer = 00:00)────── [ IQOMAH_COUNTDOWN ]
```

### State 1: `STANDBY` (Status Siaga Normal)
* **Kondisi Aktif:** Berjalan di luar waktu azan, iqomah, dan sholat berjamaah.
* **Visual:**
  * Header: Jam digital besar (HH:mm:ss), tanggal Masehi & Hijriah, profil masjid.
  * Card Grid: 6 kolom jadwal sholat (Subuh, Terbit, Dzuhur, Ashar, Maghrib, Isya). Kartu sholat berikutnya diberi styling aksen emas menyala (*active glow*).
  * Media Slider: Menampilkan banner kajian, transparansi kas, atau poster QRIS infaq secara bergantian (rotasi tiap 12 detik).
  * Footer: Teks berjalan (*running text*) berisi himbauan dan pesan pengumuman.

### State 2: `AZAN_ALERT` (Notifikasi Masuk Waktu Sholat)
* **Pemicu:** Waktu sistem tepat sama dengan jadwal sholat fardhu.
* **Durasi:** Konfigurabel per masjid (Default: 3 menit).
* **Visual & Audio:**
  * Bunyi bip nada lembut (menggunakan Web Audio API sintesis lokal, tanpa file mp3 eksternal).
  * Kartu sholat terkait membesar ke tengah layar dengan animasi berkedip kalem (*soft pulse*).
  * Teks: "Waktu Sholat [Nama Sholat] Telah Tiba". Media slider dan running text dijeda (*pause*).

### State 3: `IQOMAH_COUNTDOWN` (Hitung Mundur Merapatkan Shaf)
* **Pemicu:** Selesainya fase `AZAN_ALERT`.
* **Durasi:** Ditentukan per sholat fardhu:
  * Subuh: 12 menit
  * Dzuhur: 8 menit
  * Ashar: 8 menit
  * Maghrib: 7 menit
  * Isya: 10 menit
* **Visual & Audio:**
  * Layar berganti fokus: Angka hitung mundur menit dan detik (mm:ss) ditampilkan sangat besar (ukuran font $\ge 120\text{pt}$, kontras tinggi) di tengah layar.
  * Indikator teks: "Menuju Iqomah [Nama Sholat]".
  * Saat timer mencapai 30 detik terakhir: Warna angka beralih ke warna peringatan (kuning cerah) dan bunyi bip ritmis setiap detik di 5 detik terakhir (00:05 s/d 00:00).

### State 4: `SHOLAT` (Layar Meredup / Mode Tenang)
* **Pemicu:** Timer iqomah menyentuh `00:00`.
* **Durasi:** Konfigurabel (Default: 15 menit).
* **Visual:**
  * Layar beralih menjadi hitam pekat (`#000000`).
  * Menampilkan satu baris teks statis redup di bagian tengah bawah:  
    *"Luruskan dan Rapatkan Shaf | Harap Menonaktifkan Ponsel"*
  * Seluruh animasi dinonaktifkan untuk menghemat daya GPU dan mencegah distraksi cahaya ke jamaah.
* **Transisi Keluar:** Setelah durasi berakhir, layar kembali secara halus (*fade-in*) ke mode `STANDBY`.

---

## 7. Mesin Hisab & Perhitungan Waktu Sholat (Lokal)

ShafSync menghitung seluruh jadwal secara matematis di sisi klien/server lokal tanpa memanggil API eksternal:

### 7.1. Formula Perhitungan Astronomis
* Mengimplementasikan kalkulasi posisi matahari berbasis koordinat geografis lintang ($\phi$), bujur ($\lambda$), dan elevasi ($h$).
* **Parameter Standard Fikih Kementerian Agama RI (SIHAT):**
  * Subuh: Sudut depresi matahari $\alpha = 20^\circ$.
  * Isya: Sudut depresi matahari $\alpha = 18^\circ$.
  * Dzuhur: Saat matahari melintasi meridian langit lokal ditambah margin bayangan tergelincir (*zawal*).
  * Ashar: Menggunakan rasio panjang bayangan Shafi'i (panjang bayangan = panjang benda + bayangan tengah hari).
  * Maghrib: Saat piringan matahari terbenam sempurna di bawah ufuk (memperhitungkan refraksi atmosfer dan elevasi).
* **Ihtiyat (Safety Factor):** Otomatis menambahkan pengaman $+2$ menit untuk setiap waktu sholat fardhu sesuai standar Kemenag RI.
* **Offset Khusus:** Opsi penyesuaian manual ($-10$ hingga $+10$ menit) per jadwal sholat jika DKM setempat mengikuti rujukan hisab lokal tertentu.

### 7.2. Penanggalan Hijriah Lokal
* Algoritma konversi Ummul Qura / Tabular Hijri lokal.
* Disediakan fitur **Koreksi Hijriah Manual** ($-2$ hingga $+2$ hari) di panel admin untuk menyesuaikan hasil sidang isbat rukyatul hilal tanpa mengubah kode.

---

## 8. Spesifikasi Antarmuka Pengguna (UI/UX)

### 8.1. Desain Kiosk View (`/`)
* **Resolusi Patokan:** 1920x1080 px (Desain fluid berbasis `rem` / `vh` / `vw` agar tetap tajam jika dijalankan di TV 720p atau 4K).
* **Palet Warna:**
  * Background Utama: `#1E293B` (Slate Dark)
  * Kartu Kontainer: `#334155` (Slate Navy)
  * Highlight / Aksen Emas: `#F59E0B` (Amber Gold)
  * Teks Judul / Jam: `#FFFFFF` (Pure White)
  * Teks Keterangan: `#94A3B8` (Slate Muted)
* **Tipografi:** Wajib menggunakan font sans-serif dengan fitur *Tabular Numbers* (`font-variant-numeric: tabular-nums`) seperti **Inter** atau **Plus Jakarta Sans** lokal agar pergerakan detik jam tidak menimbulkan pergeseran tata letak (*layout shift*).

### 8.2. Desain Mobile Admin View (`/admin`)
* **Aksesibilitas:** Responsif *mobile-first*, optimal dibuka via Google Chrome/Safari ponsel.
* **Proteksi:** Login berbasis PIN sederhana 4–6 digit (disimpan dalam hash lokal).
* **Menu Utama:**
  1. **Status Jam & Sinkronisasi:** Tampilan jam TV vs jam HP + tombol sinkronisasi instan.
  2. **Profil Masjid:** Pengaturan nama, alamat, dan koordinat lintang/bujur.
  3. **Pengaturan Timer & Waktu:** Set durasi iqomah per sholat dan nilai offset menit.
  4. **Modul Keuangan (Kas):** Form input cepat: Saldo saat ini, total pemasukan pekan ini, pengeluaran pekan ini.
  5. **Teks Berjalan & Slide:** Daftar pengumuman aktif/nonaktif, upload file gambar QRIS statis / poster kajian.

---

## 9. Skema Basis Data & API Contract

### 9.1. Skema Basis Data (Tabel SQLite)

```sql
-- Tabel Konfigurasi Utama
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Tabel Pengumuman Running Text
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Pencatatan Kas
CREATE TABLE IF NOT EXISTS financial_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    balance_amount REAL NOT NULL,
    weekly_income REAL DEFAULT 0,
    weekly_expense REAL DEFAULT 0,
    recorded_date DATE NOT NULL,
    note TEXT
);

-- Tabel Media Slide (Poster / Banner)
CREATE TABLE IF NOT EXISTS media_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 12,
    is_active INTEGER DEFAULT 1
);
```

### 9.2. Spesifikasi Endpoint REST API

| Method | Endpoint | Deskripsi | Autentikasi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/display-data` | Mengambil seluruh bundle data untuk view kiosk (jadwal hari ini, pengumuman, slide, kas). | Publik |
| `GET` | `/api/events` | Endpoint Server-Sent Events (SSE) untuk push update real-time. | Publik |
| `POST` | `/api/admin/login` | Verifikasi PIN admin DKM. | Publik |
| `GET` | `/api/admin/config` | Mengambil seluruh parameter setting (koordinat, offset, durasi). | Bearer Token / Session |
| `PUT` | `/api/admin/config` | Memperbarui setting masjid dan memicu SSE reload. | Bearer Token / Session |
| `POST` | `/api/system/time-sync` | Menerima ISO string dari HP takmir dan menyetel jam OS. | Bearer Token / Session |
| `POST` | `/api/admin/financial` | Memperbarui ringkasan saldo kas masjid. | Bearer Token / Session |
| `POST` | `/api/admin/announcements` | Menambah atau mengubah baris running text. | Bearer Token / Session |

---

## 10. Paket Otomasi Deployment Sistem (TV Box / Linux)

Proyek ShafSync menyediakan skrip automasi agar pengguna cukup mengkloning repositori dan menjalankan satu baris perintah instalasi.

### 10.1. Skrip Instalasi: `install.sh`
Skrip ini mengonfigurasi perangkat Armbian/Ubuntu pada TV Box:
1. Memperbarui paket sistem dan menginstal dependensi: `curl`, `git`, `chromium-browser`, `xdotool`, `unclutter`.
2. Menginstal runtime Node.js LTS (jika belum terpasang).
3. Melakukan build asset web front-end (`npm run build`).
4. Mendaftarkan systemd service untuk auto-start server lokal dan browser kiosk.

### 10.2. Service Unit Systemd: `/etc/systemd/system/shafsync.service`
```ini
[Unit]
Description=ShafSync Local Appliance Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/shafsync
ExecStart=/usr/bin/node /opt/shafsync/server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### 10.3. Kiosk Runner Script: `/opt/shafsync/start-kiosk.sh`
```bash
#!/usr/bin/env bash
# Mencegah layar sleep / screensaver aktif
xset s off
xset -dpms
xset s noblank

# Sembunyikan kursor mouse setelah 2 detik tidak bergerak
unclutter -idle 2 -root &

# Tunggu server lokal siap melayani
until $(curl --output /dev/null --silent --head --fail http://localhost:3000); do
    sleep 1
done

# Jalankan Chromium dalam Mode Kiosk Layar Penuh Tanpa Indikator Error
chromium-browser \
    --noerrdialogs \
    --disable-infobars \
    --kiosk \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --disable-features=TranslateUI \
    --app=http://localhost:3000
```

---

## 11. Kriteria Keberhasilan (Acceptance Criteria)

1. **Cold Boot Test:** Saat saklar listrik dinyalakan dari posisi mati total, layar TV harus otomatis menampilkan antarmuka ShafSync dalam waktu $<60$ detik tanpa intervensi mouse/keyboard.
2. **Konektivitas Nol:** Sistem berjalan normal selama pengujian 7 hari berturut-turut dengan kabel LAN tercabut dan Wi-Fi eksternal dinonaktifkan.
3. **Akurasi State Machine:** Transisi dari Standby $\rightarrow$ Azan Alert $\rightarrow$ Iqomah Countdown $\rightarrow$ Sholat Blank berjalan presisi hingga toleransi detik tanpa adanya *freezing* atau *memory leak*.
4. **Verifikasi Sinkronisasi Waktu:** Saat tombol "Sinkronkan Jam" ditekan di HP takmir, jam di layar TV harus berubah sesuai jam HP dalam tempo $\le 1.5$ detik.