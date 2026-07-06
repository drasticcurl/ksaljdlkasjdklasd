"""Ajuste del ``PATH`` del proceso para localizar binarios de Homebrew (Req 12).

Cuando el backend se lanza desde la GUI de macOS (doble clic en un archivo
``.command``) o desde ciertos entornos virtuales, ``os.environ["PATH"]`` puede
**no** incluir las rutas donde Homebrew instala los binarios
(``/opt/homebrew/bin`` en Apple Silicon, ``/usr/local/bin`` en Intel). Como
consecuencia, herramientas como ``ffmpeg``, ``ffprobe`` o ``auto-editor`` no se
encuentran aunque estén instaladas, y la verificación de dependencias al
arrancar las reporta (erróneamente) como faltantes.

Este módulo expone :func:`asegurar_path_local`, que **antepone** al ``PATH`` del
proceso las rutas estándar de Homebrew/macOS que aún no estén presentes. Es:

* **Idempotente**: llamarla varias veces no duplica entradas.
* **Segura en cualquier SO**: solo manipula ``os.environ["PATH"]`` con rutas
  estándar; no ejecuta nada ni falla si las rutas no existen en el sistema.

Se invoca muy temprano en el arranque del backend (en ``main.py``) y también al
inicio de :func:`app.deps.checker.verificar_dependencias`, de modo que tanto la
verificación como los ``subprocess`` posteriores hereden el ``PATH`` corregido.
"""

from __future__ import annotations

import os
from typing import List

# Rutas comunes donde Homebrew (y el sistema) instalan binarios en macOS.
#   - Apple Silicon: /opt/homebrew/{bin,sbin}
#   - Intel:         /usr/local/{bin,sbin}
RUTAS_LOCALES_MACOS: tuple[str, ...] = (
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
)


def asegurar_path_local(rutas: tuple[str, ...] = RUTAS_LOCALES_MACOS) -> str:
    """Antepone al ``PATH`` del proceso las rutas locales de macOS que falten.

    Recorre ``rutas`` y añade al **principio** de ``os.environ["PATH"]`` aquellas
    que todavía no estén presentes, preservando el orden dado. Las rutas ya
    presentes no se duplican (idempotencia). No comprueba la existencia física de
    las rutas: añadirlas es inocuo en cualquier SO, ya que el sistema
    simplemente las ignora al resolver ejecutables.

    Args:
        rutas: Rutas a garantizar al inicio del ``PATH``. Por defecto, las rutas
            estándar de Homebrew/macOS (:data:`RUTAS_LOCALES_MACOS`).

    Returns:
        El valor final de ``os.environ["PATH"]`` tras el ajuste.
    """
    path_actual = os.environ.get("PATH", "")
    separador = os.pathsep
    # Entradas actuales (sin vacíos) para comprobar pertenencia rápidamente.
    existentes = [p for p in path_actual.split(separador) if p]
    existentes_set = set(existentes)

    a_anteponer: List[str] = []
    for ruta in rutas:
        if ruta and ruta not in existentes_set and ruta not in a_anteponer:
            a_anteponer.append(ruta)

    if not a_anteponer:
        # Nada que añadir: idempotente, no modifica el PATH.
        return path_actual

    nuevas_entradas = a_anteponer + existentes
    nuevo_path = separador.join(nuevas_entradas)
    os.environ["PATH"] = nuevo_path
    return nuevo_path
