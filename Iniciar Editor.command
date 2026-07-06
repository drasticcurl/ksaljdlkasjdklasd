#!/bin/bash
#
# Iniciar Editor.command — Conveniencia: arranca el backend y el frontend a la
# vez, cada uno en su propia ventana de Terminal (macOS, doble clic desde
# Finder).
#
# Extensión .command para poder ejecutarse con DOBLE CLIC desde Finder. Al
# ejecutarse por doble clic, hacemos `cd` a la carpeta del script (raíz del
# proyecto) porque el directorio de trabajo puede no coincidir.
#
# Abre dos ventanas de Terminal ejecutando respectivamente
# 'Iniciar Backend.command' e 'Iniciar Frontend.command' mediante
# `open -a Terminal`.

set -uo pipefail

# --- Ir a la raíz del proyecto (carpeta del script) ----------------------------
cd "$(dirname "${BASH_SOURCE[0]}")" || {
  echo "ERROR: no se pudo acceder a la carpeta del proyecto." >&2
  exit 1
}

# Ruta absoluta de la raíz del proyecto para construir rutas a los otros scripts.
PROJECT_DIR="$(pwd)"

echo "==================================================================="
echo " Iniciando el Vertical Shorts Editor (backend + frontend)"
echo "==================================================================="
echo ""

echo "Abriendo el backend en una nueva ventana de Terminal..."
open -a Terminal "${PROJECT_DIR}/Iniciar Backend.command"

# Pequeña espera para escalonar el arranque de ambos procesos.
sleep 3

echo "Abriendo la Interfaz (frontend) en una nueva ventana de Terminal..."
open -a Terminal "${PROJECT_DIR}/Iniciar Frontend.command"

echo ""
echo "Se han abierto dos ventanas de Terminal (backend y frontend)."
echo "Espera unos segundos a que ambos arranquen y luego abre en tu navegador:"
echo ""
echo "   http://localhost:3000"
echo ""
echo "Pulsa cualquier tecla para cerrar esta ventana..."
read -r -n 1 -s
echo ""
