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

import importlib.util
import logging
import os
import stat
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)

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


# Bits de ejecución (propietario, grupo, otros) que debe tener un binario.
_BITS_EJECUCION = stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH


def _localizar_bin_auto_editor() -> Path | None:
    """Devuelve el directorio ``bin/`` del paquete ``auto_editor`` si existe.

    Usa :func:`importlib.util.find_spec` para localizar el paquete de forma
    segura sin importarlo. Si el paquete no está instalado (o no expone una
    ubicación en disco), devuelve ``None``.
    """
    try:
        spec = importlib.util.find_spec("auto_editor")
    except (ImportError, ValueError, ModuleNotFoundError):
        # find_spec puede lanzar si el paquete/su padre no es importable.
        return None
    if spec is None:
        return None

    # Reúne las posibles raíces del paquete (origin y search locations).
    raices: List[Path] = []
    if spec.submodule_search_locations:
        raices.extend(Path(p) for p in spec.submodule_search_locations)
    if spec.origin and spec.origin != "namespace":
        raices.append(Path(spec.origin).parent)

    for raiz in raices:
        bin_dir = raiz / "bin"
        if bin_dir.is_dir():
            return bin_dir
    return None


def asegurar_permisos_auto_editor() -> int:
    """Garantiza que los binarios empaquetados de ``auto_editor`` sean ejecutables.

    Algunos entornos (por ejemplo, ciertas instalaciones con ``pip`` en macOS)
    dejan el binario que trae el paquete ``auto_editor`` (``auto_editor/bin/*``)
    **sin bit de ejecución**, lo que provoca al invocarlo un
    ``PermissionError: [Errno 13] Permission denied`` y hace fallar el paso de
    corte de silencios.

    Esta función localiza el paquete de forma segura y, para cada archivo dentro
    de su directorio ``bin/``, añade los bits de ejecución que le falten. Es:

    * **Idempotente**: si los bits ya están, no hace nada.
    * **Tolerante a fallos**: si el paquete no está instalado o no tiene
      directorio ``bin/``, o si ``chmod`` falla (p. ej. permisos de solo lectura),
      no lanza excepción; solo registra a nivel de depuración/aviso.
    * **Multiplataforma**: en sistemas que no sean macOS simplemente no rompe (los
      bits de ejecución son inocuos en otros SO y en Windows ``chmod`` se ignora
      en la práctica).

    Returns:
        El número de archivos a los que se les añadió el bit de ejecución.
    """
    bin_dir = _localizar_bin_auto_editor()
    if bin_dir is None:
        logger.debug(
            "auto_editor no está instalado o no expone un directorio bin/; "
            "no hay permisos que ajustar."
        )
        return 0

    corregidos = 0
    try:
        entradas = list(bin_dir.iterdir())
    except OSError as exc:  # pragma: no cover - defensivo
        logger.debug("No se pudo listar %s: %s", bin_dir, exc)
        return 0

    for archivo in entradas:
        try:
            if not archivo.is_file():
                continue
            st = archivo.stat()
            if st.st_mode & _BITS_EJECUCION == _BITS_EJECUCION:
                # Ya es ejecutable para todos: nada que hacer (idempotencia).
                continue
            os.chmod(archivo, st.st_mode | _BITS_EJECUCION)
            corregidos += 1
            logger.debug("Bit de ejecución añadido a %s", archivo)
        except OSError as exc:
            logger.warning(
                "No se pudo ajustar el permiso de ejecución de %s: %s",
                archivo,
                exc,
            )

    if corregidos:
        logger.info(
            "Permisos de ejecución corregidos en %d binario(s) de auto_editor (%s).",
            corregidos,
            bin_dir,
        )
    return corregidos
