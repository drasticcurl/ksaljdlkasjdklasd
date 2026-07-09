#!/bin/bash
#
# Instalar.command — Configuración de PRIMERA VEZ del Vertical Shorts Editor
# para macOS.
#
# Este archivo tiene extensión .command para poder ejecutarse con DOBLE CLIC
# desde Finder (Finder lo abre en Terminal.app). Los .sh no son
# doble-clickeables: Finder los abre en un editor de texto.
#
# Qué hace:
#   1. Verifica que Homebrew (brew) esté instalado.
#   2. Instala ffmpeg (ffprobe) con Homebrew si no está presente.
#   3. Crea el entorno virtual .venv (si no existe) e instala las dependencias
#      de Python de requirements.txt.
#   4. Instala las dependencias del frontend (npm install).
#
# Al ejecutarse por doble clic, el directorio de trabajo puede no ser el del
# script, por eso hacemos `cd` a la carpeta que contiene este archivo.

set -uo pipefail

# --- Ir a la carpeta del script (raíz del proyecto) ----------------------------
cd "$(dirname "${BASH_SOURCE[0]}")" || {
  echo "ERROR: no se pudo acceder a la carpeta del proyecto." >&2
  exit 1
}

# Pausa final para que la ventana de Terminal no se cierre de golpe y el usuario
# pueda leer el resultado.
pausa_final() {
  echo ""
  echo "Pulsa cualquier tecla para cerrar esta ventana..."
  read -r -n 1 -s
  echo ""
}

echo "==================================================================="
echo " Instalación de primera vez — Vertical Shorts Editor (macOS)"
echo "==================================================================="
echo ""

# --- 1) Verificar Homebrew -----------------------------------------------------
echo "[1/4] Comprobando Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  echo "ERROR: Homebrew (brew) no está instalado." >&2
  echo "" >&2
  echo "Instala Homebrew ejecutando en Terminal el siguiente comando y luego" >&2
  echo "vuelve a ejecutar este instalador:" >&2
  echo "" >&2
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
  echo "" >&2
  pausa_final
  exit 1
fi
echo "      Homebrew detectado: $(brew --version | head -n 1)"
echo ""

# --- 2) Instalar ffmpeg si falta ----------------------------------------------
echo "[2/4] Comprobando ffmpeg / ffprobe..."
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "      ffmpeg y ffprobe ya están instalados."
else
  echo "      Instalando ffmpeg con Homebrew..."
  if ! brew install ffmpeg; then
    echo "ERROR: falló la instalación de ffmpeg con Homebrew." >&2
    pausa_final
    exit 1
  fi
fi
echo ""

# --- 2b) Fuente Poppins (para los subtítulos "Bold Pop") -----------------------
# Best-effort: si falla, la app sigue funcionando (libass usará otra fuente).
echo "[2b] Comprobando la fuente Poppins (subtítulos)..."
if system_profiler SPFontsDataType 2>/dev/null | grep -qi "Poppins"; then
  echo "      La fuente Poppins ya está instalada."
else
  echo "      Instalando la fuente Poppins con Homebrew (opcional)..."
  brew install --cask font-poppins >/dev/null 2>&1 \
    && echo "      Fuente Poppins instalada." \
    || echo "      (No se pudo instalar Poppins automáticamente; podés instalarla" \
            "manualmente desde Google Fonts. Los subtítulos funcionarán igual con" \
            "otra fuente.)"
fi
echo ""

# --- 3) Entorno virtual e instalación de dependencias de Python ----------------
echo "[3/4] Configurando el entorno virtual de Python (.venv)..."
if [ ! -d ".venv" ]; then
  echo "      Creando entorno virtual .venv..."
  if ! python3 -m venv .venv; then
    echo "ERROR: no se pudo crear el entorno virtual .venv." >&2
    pausa_final
    exit 1
  fi
else
  echo "      El entorno virtual .venv ya existe."
fi

# shellcheck disable=SC1091
source .venv/bin/activate || {
  echo "ERROR: no se pudo activar el entorno virtual .venv." >&2
  pausa_final
  exit 1
}

echo "      Instalando dependencias de Python (requirements.txt)..."
if ! pip install -r requirements.txt; then
  echo "ERROR: falló la instalación de las dependencias de Python." >&2
  pausa_final
  exit 1
fi
echo ""

# --- 4) Dependencias del frontend ---------------------------------------------
echo "[4/4] Instalando dependencias del frontend (npm install)..."
if ! (cd frontend && npm install); then
  echo "ERROR: falló 'npm install' en el frontend." >&2
  pausa_final
  exit 1
fi
echo ""

echo "==================================================================="
echo " ¡Instalación completada con éxito!"
echo ""
echo " Ahora puedes arrancar la aplicación haciendo doble clic en:"
echo "   - 'Iniciar Editor.command'   (abre backend y frontend a la vez)"
echo " o por separado:"
echo "   - 'Iniciar Backend.command'"
echo "   - 'Iniciar Frontend.command'"
echo "==================================================================="
pausa_final
