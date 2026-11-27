#!/bin/bash
# ---------------------------------------------------------------------------
# Pemulihan database SIMKEU dari berkas dump SQL (Backup_FULL_SIMKEU_*.sql).
#
# Dipakai dari cPanel > Cron Jobs, contoh:
#   /bin/bash /home/manbi/simkola3/tools/restore.sh > /home/manbi/restore.log 2>&1
#
# Berkas SQL diletakkan di: /home/manbi/simkola3/data/import.sql
#   (boleh juga dikirim sebagai argumen pertama)
#
# Jalankan hanya saat aplikasi berhenti (Stop App) agar tidak ada berkas
# database yang sedang terbuka.
# ---------------------------------------------------------------------------
set -u

APP_DIR="/home/manbi/simkola3"
SQL_FILE="${1:-$APP_DIR/data/import.sql}"

NODE_NATIVE=""
for c in "/home/manbi/nodevenv/simkola3/22/bin/node" "/usr/local/bin/node" "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ] 2>/dev/null || [ -n "$c" ] && command -v "$c" >/dev/null 2>&1; then NODE_NATIVE="$c"; break; fi
done
if [ -n "$NODE_NATIVE" ] && [ -f "$APP_DIR/tools/restore-sql-node.js" ]; then
  export DB_PATH="$APP_DIR/data/keuangan.sqlite"
  export SAAS_DB_PATH="$APP_DIR/data/saas.db"
  cd "$APP_DIR" || exit 1
  exec "$NODE_NATIVE" tools/restore-sql-node.js "$SQL_FILE"
fi

PYTHON=""
for c in python3 python3.13 python3.12 python3.11 python3.10 python; do
  if command -v "$c" >/dev/null 2>&1; then PYTHON="$c"; break; fi
done
if [ -n "$PYTHON" ] && [ -f "$APP_DIR/tools/restore-sql.py" ]; then
  export DB_PATH="$APP_DIR/data/keuangan.sqlite"
  export SAAS_DB_PATH="$APP_DIR/data/saas.db"
  cd "$APP_DIR" || exit 1
  exec "$PYTHON" tools/restore-sql.py "$SQL_FILE"
fi

export DB_PATH="$APP_DIR/data/keuangan.sqlite"
export SAAS_DB_PATH="$APP_DIR/data/saas.db"
export DEMO_DB_PATH="$APP_DIR/data/demo.sqlite"
export STORAGE_DIR="$APP_DIR/storage"
export APP_TIMEZONE="Asia/Jakarta"
export APP_BASE_URL="https://simkola.web.id"

NODE=""
for c in \
  "/home/manbi/nodevenv/simkola3/22/bin/node" \
  "/home/manbi/nodevenv/simkola3/24/bin/node" \
  "$APP_DIR/../../nodevenv/simkola3/22/bin/node"
do
  if [ -x "$c" ]; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then NODE="$(command -v node 2>/dev/null || true)"; fi
if [ -z "$NODE" ]; then echo "[restore.sh] node tidak ditemukan"; exit 1; fi

echo "[restore.sh] $(date '+%Y-%m-%d %H:%M:%S')  node=$NODE"
echo "[restore.sh] berkas SQL: $SQL_FILE"
cd "$APP_DIR" || { echo "[restore.sh] gagal masuk $APP_DIR"; exit 1; }

"$NODE" tools/restore-sql.js "$SQL_FILE"
RC=$?
echo "[restore.sh] kode keluar=$RC"
exit $RC
