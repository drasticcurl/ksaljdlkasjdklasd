#!/bin/bash
#
# Iniciar Backend.command — Arranca el backend FastAPI del Vertical Shorts
# Editor en localhost:8000, con doble clic desde Finder (macOS).
#
# Extensión .command para poder ejecutarse con DOBLE CLIC desde Finder. Al
# ejecutarse por doble clic, hacemos `cd` a la carpeta del script (raíz del
# proyecto) porque el directorio de trabajo puede no coincidir.
#
# Comportamiento (reutiliza la lógica de scripts/start-backend.sh):
#   - Detecta si el puerto 8000 ya está en uso. En ese caso, finaliza con un
#     mensaje de conflicto de puerto y NO deja procesos parciales activos.
#   - Activa el entorno virtual .venv si existe.
#   - Lanza uvicorn en 127.0.0.1:8000.

set -uo pipefail

# --- Ir a la raíz del proyecto (carpeta del script) ----------------------------
cd "$(dirname "${BASH_SOURCE[0]}")" || {
  echo "ERROR: no se pudo acceder a la carpeta del proyecto." >&2
  exit 1
}

readonly HOST="127.0.0.1"
readonly PORT="8000"

# --- Detección de conflicto de puerto (igual que scripts/start-backend.sh) -----
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
  echo "ERROR: el puerto ${PORT} ya está en uso; no se puede arrancar el backend." >&2
  echo "       Libera el puerto ${PORT} o detén el proceso que lo ocupa e inténtalo de nuevo." >&2
  echo ""
  echo "Pulsa cualquier tecla para cerrar esta ventana..."
  read -r -n 1 -s
  # Salir ANTES de lanzar uvicorn evita dejar procesos parciales activos.
  exit 1
fi

# --- Activar el entorno virtual si existe --------------------------------------
if [ -f ".venv/bin/activate" ]; then
  echo "Activando el entorno virtual .venv..."
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  echo "AVISO: no se encontró .venv. Si el arranque falla, ejecuta primero"
  echo "       'Instalar.command'."
fi

echo "Arrancando el backend en http://${HOST}:${PORT} ..."
cd backend
exec uvicorn main:app --host "${HOST}" --port "${PORT}"
