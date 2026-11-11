#!/usr/bin/env bash
set -e

# Pastikan variabel DISPLAY aktif jika dipanggil dari sesi X11
export DISPLAY="${DISPLAY:-:0}"

# Mencegah layar sleep / screensaver aktif
xset s off || true
xset -dpms || true
xset s noblank || true

# Sembunyikan kursor mouse setelah 2 detik tidak bergerak
if command -v unclutter >/dev/null 2>&1; then
    unclutter -idle 2 -root &
fi

# Tunggu server lokal siap melayani
until $(curl --output /dev/null --silent --head --fail http://localhost:3000); do
    sleep 1
done

# Deteksi binary Chromium pada Ubuntu (chromium-browser) atau Debian/Armbian (chromium)
CHROMIUM_BIN="chromium-browser"
if ! command -v "$CHROMIUM_BIN" >/dev/null 2>&1; then
    CHROMIUM_BIN="chromium"
fi

# Jalankan Chromium dalam Mode Kiosk Layar Penuh Tanpa Indikator Error & Izinkan Web Audio API
exec "$CHROMIUM_BIN" \
    --noerrdialogs \
    --disable-infobars \
    --kiosk \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --disable-features=TranslateUI \
    --autoplay-policy=no-user-gesture-required \
    --app=http://localhost:3000
