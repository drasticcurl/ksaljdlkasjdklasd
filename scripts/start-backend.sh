#!/usr/bin/env bash
#
# start-backend.sh — Arranca el backend FastAPI del Vertical Shorts Editor en
# localhost:8000 (Req 14.2, 14.3, 14.4).
#
# Comportamiento:
#   - Lanza uvicorn escuchando en el puerto 8000.
#   - Antes de lanzar, detecta si el puerto 8000 ya está en uso. En ese caso,
#     finaliza el arranque con un mensaje de error de conflicto de puerto y NO
#     deja procesos parciales activos (nunca llega a ejecutar uvicorn).
#
# Uso:
#   ./scripts/start-backend.sh
#
# Si necesitas un entorno virtual, actívalo en la misma terminal antes de
# ejecutar este script (por ejemplo: `source .venv/bin/activate`).

set -euo pipefail

# Puerto en el que debe escuchar el backend (Req 14.2/14.3).
readonly HOST="127.0.0.1"
readonly PORT="8000"

# Directorio del backend, resuelto de forma relativa a la ubicación del script,
# para poder ejecutarlo desde cualquier directorio de trabajo.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly BACKEND_DIR="${SCRIPT_DIR}/../backend"

# --- Detección de conflicto de puerto (Req 14.4) -------------------------------
# Comprueba si algún proceso ya está escuchando en el puerto indicado. Se usa
# `lsof` cuando está disponible (macOS lo trae por defecto); si no, se recurre a
# `nc` como alternativa.
port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z "${HOST}" "${port}" >/dev/null 2>&1
  else
    # Sin herramientas de comprobación disponibles: no podemos garantizar la
    # detección, así que asumimos que el puerto está libre.
    return 1
  fi
}

if port_in_use "${PORT}"; then
  echo "ERROR: el puerto ${PORT} ya está en uso; no se puede arrancar el backend." >&2
  echo "       Libera el puerto ${PORT} o detén el proceso que lo ocupa e inténtalo de nuevo." >&2
  # Salir ANTES de lanzar uvicorn evita dejar procesos parciales activos.
  exit 1
fi

echo "Arrancando el backend en http://${HOST}:${PORT} ..."
cd "${BACKEND_DIR}"
exec uvicorn main:app --host "${HOST}" --port "${PORT}"
