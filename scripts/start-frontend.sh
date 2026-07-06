#!/usr/bin/env bash
#
# start-frontend.sh — Arranca la Interfaz Next.js del Vertical Shorts Editor en
# localhost:3000 (Req 14.2, 14.3, 14.4).
#
# Comportamiento:
#   - Lanza Next.js en modo desarrollo (`npm run dev`) escuchando en el puerto 3000.
#   - Antes de lanzar, detecta si el puerto 3000 ya está en uso. En ese caso,
#     finaliza el arranque con un mensaje de error de conflicto de puerto y NO
#     deja procesos parciales activos (nunca llega a ejecutar npm run dev).
#
# Uso:
#   ./scripts/start-frontend.sh

set -euo pipefail

# Puerto en el que debe escuchar la Interfaz (Req 14.2/14.3).
readonly HOST="127.0.0.1"
readonly PORT="3000"

# Directorio del frontend, resuelto de forma relativa a la ubicación del script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly FRONTEND_DIR="${SCRIPT_DIR}/../frontend"

# --- Detección de conflicto de puerto (Req 14.4) -------------------------------
port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z "${HOST}" "${port}" >/dev/null 2>&1
  else
    return 1
  fi
}

if port_in_use "${PORT}"; then
  echo "ERROR: el puerto ${PORT} ya está en uso; no se puede arrancar la Interfaz." >&2
  echo "       Libera el puerto ${PORT} o detén el proceso que lo ocupa e inténtalo de nuevo." >&2
  # Salir ANTES de lanzar npm run dev evita dejar procesos parciales activos.
  exit 1
fi

echo "Arrancando la Interfaz en http://${HOST}:${PORT} ..."
cd "${FRONTEND_DIR}"
exec npm run dev
