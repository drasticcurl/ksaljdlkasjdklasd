"""Endpoint de subida de música ``POST /musica`` (Req 8.1, 8.2).

Recibe un archivo WAV vía ``multipart/form-data``, valida **formato** (WAV
válido: extensión ``.wav`` y cabecera RIFF/WAVE) y **tamaño** (<= 100 MB), y lo
almacena devolviendo un ``musica_id``. Si el archivo no es un WAV válido o supera
el límite, se **rechaza** conservando el audio y el video originales sin
modificar (Req 8.2): el rechazo ocurre antes de cualquier almacenamiento.

Comportamiento (contrato del diseño):

* **200 OK:** ``{"musica_id": ..., "nombre_original": ..., "duracion_s": null}``.
* **415 INVALID_WAV:** el archivo no es un WAV válido (Req 8.2).
* **413 MUSIC_TOO_LARGE:** el archivo supera 100 MB (Req 8.2).

Referencias de requisitos: 8.1, 8.2.
"""

from __future__ import annotations

import logging
import os
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse

from app import config
from app.models.errors import error_envelope
from app.storage.music_store import MusicStore, MusicStorageError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["musica"])

# Firmas de cabecera aceptadas para la familia WAV/RIFF. Además del ``RIFF``
# canónico se admite ``RF64``, la variante para archivos de audio grandes (> 4 GB)
# que también usa el contenedor WAVE y que algunos editores generan: antes se
# rechazaba como "WAV inválido" pese a reproducirse correctamente.
_FIRMAS_WAV = {b"RIFF", b"RF64"}

_music_store = MusicStore()


def obtener_music_store() -> MusicStore:
    """Dependencia que provee el :class:`MusicStore` a usar por el endpoint."""
    return _music_store


def _es_wav_valido(nombre: str, contenido: bytes) -> bool:
    """Comprueba que el archivo sea un WAV válido (extensión + cabecera RIFF/WAVE).

    Un WAV comienza con una firma de contenedor (bytes 0..4) —``RIFF`` en el caso
    canónico o ``RF64`` para archivos grandes (> 4 GB)— seguida del tamaño y la
    firma de formato ``WAVE`` (bytes 8..12). Se aceptan ambas firmas de la familia
    RIFF/RF64 y se exige la extensión ``.wav`` para rechazar archivos con
    contenido no-WAV (Req 8.2).

    Cuando se rechaza por cabecera, se registra el nombre, el tamaño y los primeros
    12 bytes para poder diagnosticar futuros falsos negativos.
    """
    ext = os.path.splitext(nombre or "")[1].lower()
    if ext not in config.SUPPORTED_MUSIC_EXTENSIONS:
        logger.warning(
            "Rechazado WAV %s: extensión %r no soportada", nombre, ext
        )
        return False
    if len(contenido) < 12 or contenido[0:4] not in _FIRMAS_WAV or contenido[8:12] != b"WAVE":
        logger.warning(
            "Rechazado WAV %s (%d bytes): cabecera=%r",
            nombre,
            len(contenido),
            contenido[:12],
        )
        return False
    return True


@router.post("/musica")
async def subir_musica(
    file: UploadFile = File(...),
    store: MusicStore = Depends(obtener_music_store),
) -> JSONResponse:
    """Sube y almacena el archivo WAV de música (Req 8.1, 8.2)."""
    nombre = file.filename or "sin_nombre"
    contenido = await file.read()

    # --- Validación de tamaño (Req 8.2) ---
    if len(contenido) > config.MAX_MUSIC_SIZE_BYTES:
        return JSONResponse(
            status_code=413,
            content=error_envelope(
                "MUSIC_TOO_LARGE",
                "El archivo de música supera el tamaño máximo (100 MB).",
                {"tamano_bytes": len(contenido), "maximo_bytes": config.MAX_MUSIC_SIZE_BYTES},
            ),
        )

    # --- Validación de formato WAV (Req 8.2) ---
    if not _es_wav_valido(nombre, contenido):
        return JSONResponse(
            status_code=415,
            content=error_envelope(
                "INVALID_WAV",
                "El archivo de música no es un WAV válido.",
                {"nombre": nombre, "formato_requerido": "WAV (.wav)"},
            ),
        )

    # --- Almacenamiento ---
    try:
        almacenada = store.guardar(nombre, contenido)
    except MusicStorageError as exc:
        return JSONResponse(
            status_code=422,
            content=error_envelope(
                "MUSIC_STORAGE_FAILED",
                "No se pudo almacenar el archivo de música.",
                {"motivo": exc.motivo},
            ),
        )

    return JSONResponse(
        status_code=200,
        content={
            "musica_id": almacenada.musica_id,
            "nombre_original": almacenada.nombre_original,
            "duracion_s": None,
        },
    )
