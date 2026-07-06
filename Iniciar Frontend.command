#!/bin/bash
#
# Iniciar Frontend.command — Arranca la Interfaz Next.js del Vertical Shorts
# Editor en localhost:3000, con doble clic desde Finder (macOS).
#
# Extensión .command para poder ejecutarse con DOBLE CLIC desde Finder. Al
# ejecutarse por doble clic, hacemos `cd` a la carpeta del script (raíz del
# proyecto) porque el directorio de trabajo puede no coincidir.
#
# Comportamiento (reutiliza la lógica de scripts/start-frontend.sh):
#   - Detecta si el puerto 3000 ya está en uso. En ese caso, finaliza con un
#     mensaje de conflicto de puerto y NO deja procesos parciales activos.
#   - Lanza Next.js en modo desarrollo (npm run dev).

set -uo pipefail

# --- Ir a la raíz del proyecto (carpeta del script) ----------------------------
cd "$(dirname "${BASH_SOURCE[0]}")" || {
  echo "ERROR: no se pudo acceder a la carpeta del proyecto." >&2
  exit 1
}

readonly HOST="127.0.0.1"
readonly PORT="3000"

# --- Detección de conflicto de puerto (igual que scripts/start-frontend.sh) ----
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
  echo ""
  echo "Pulsa cualquier tecla para cerrar esta ventana..."
  read -r -n 1 -s
  # Salir ANTES de lanzar npm run dev evita dejar procesos parciales activos.
  exit 1
fi

echo "Arrancando la Interfaz en http://${HOST}:${PORT} ..."
cd frontend
exec npm run dev
