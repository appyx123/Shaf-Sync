#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/shafsync"
SERVICE_FILE="/etc/systemd/system/shafsync.service"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "  Instalasi ShafSync — Offline Digital Signage & Prayer Kiosk"
echo "============================================================"

if [ "$(id -u)" -ne 0 ]; then
    echo "[ERROR] Jalankan skrip ini menggunakan sudo: sudo ./install.sh"
    exit 1
fi

echo "[1/5] Memperbarui paket sistem dan menginstal dependensi kiosk..."
apt-get update -y
# Di Debian/Armbian paket bernama 'chromium', di Ubuntu bernama 'chromium-browser'
CHROMIUM_PKG="chromium-browser"
if ! apt-cache show chromium-browser >/dev/null 2>&1; then
    CHROMIUM_PKG="chromium"
fi

apt-get install -y \
    curl \
    git \
    "$CHROMIUM_PKG" \
    xdotool \
    unclutter \
    x11-xserver-utils \
    avahi-daemon

# Aktifkan mDNS (shafsync.local) bila diperlukan
systemctl enable --now avahi-daemon || true

echo "[2/5] Memeriksa runtime Node.js LTS (v18+)..."
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "      Node.js terpasang: $(node -v)"

echo "[3/5] Menyalin aplikasi ke ${INSTALL_DIR} & membangun aset web..."
mkdir -p "$INSTALL_DIR"
if [ "$SRC_DIR" != "$INSTALL_DIR" ]; then
    cp -r "$SRC_DIR"/* "$INSTALL_DIR"/
fi

cd "$INSTALL_DIR"
npm install
npm run build
chmod +x "$INSTALL_DIR/start-kiosk.sh"

echo "[4/5] Mendaftarkan systemd service (shafsync.service)..."
cp "$INSTALL_DIR/deploy/shafsync.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --now shafsync.service

echo "[5/5] Menyiapkan autostart Kiosk X11..."
AUTOSTART_DIR="/etc/xdg/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "${AUTOSTART_DIR}/shafsync-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ShafSync Kiosk Display
Comment=Fullscreen Prayer Kiosk & Digital Signage
Exec=/opt/shafsync/start-kiosk.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

echo "============================================================"
echo "  Instalasi Selesai!"
echo "  - Kiosk TV View   : http://localhost:3000/"
echo "  - Mobile Admin    : http://$(hostname -I | awk '{print $1}'):3000/admin"
echo "  - PIN Default DKM : 123456"
echo "============================================================"
