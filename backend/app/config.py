"""Configuración central del backend.

Define puertos, límites de tamaño y cardinalidad, rutas del directorio de
trabajo y de salida, y los valores por defecto del pipeline.

Esta tarea (2.1) solo define constantes y ayudantes de rutas; la validación de
rangos de los ajustes se implementa en la tarea 8 (`models/settings.py`).

Referencias de requisitos: 1.4, 8.2, 10.1, 10.2, 13.3.
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Puertos de red (operación 100% local en localhost)
# ---------------------------------------------------------------------------
BACKEND_HOST: str = "127.0.0.1"
BACKEND_PORT: int = 8000
FRONTEND_PORT: int = 3000

# ---------------------------------------------------------------------------
# Límites de tamaño (Req 1.4, 8.2)
# ---------------------------------------------------------------------------
MB: int = 1024 * 1024

# Tamaño máximo por clip de video: 500 MB (Req 1.4)
MAX_CLIP_SIZE_BYTES: int = 500 * MB

# Tamaño máximo del archivo de música: 100 MB (Req 8.2)
MAX_MUSIC_SIZE_BYTES: int = 100 * MB

# ---------------------------------------------------------------------------
# Límites de cardinalidad (Req 1.5, 10.1, 10.2)
# ---------------------------------------------------------------------------
# Máximo de clips por adición en una petición `POST /clips` (Req 1.5)
MAX_CLIPS_PER_UPLOAD: int = 50

# Máximo de clips en el `orden_clips` de un Job en `POST /procesar` (Req 10.1, 10.2)
MAX_CLIPS_PER_JOB: int = 500
MIN_CLIPS_PER_JOB: int = 1

# ---------------------------------------------------------------------------
# Formatos soportados
# ---------------------------------------------------------------------------
# Formatos de video de entrada soportados (Req 1.4).
SUPPORTED_VIDEO_EXTENSIONS: tuple[str, ...] = (
    ".mp4",
    ".mov",
    ".m4v",
    ".mkv",
    ".webm",
    ".avi",
)

# Formatos de audio de música soportados (Req 8.1, 8.2).
#
# La mezcla de música se realiza con ffmpeg, que decodifica de forma nativa la
# mayoría de formatos de audio comunes (MP3, AAC/M4A, OGG/Opus, FLAC, etc.). Por
# eso la aceptación en la subida se basa en la **extensión** del archivo y se
# delega la validación real del contenido a ffmpeg en el paso de mezcla: exigir
# un contenedor WAV/RIFF rechazaba archivos perfectamente reproducibles (p. ej.
# un MP3 con extensión .wav).
SUPPORTED_MUSIC_EXTENSIONS: tuple[str, ...] = (
    ".wav",
    ".mp3",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".opus",
    ".flac",
    ".wma",
    ".aiff",
    ".aif",
)

# ---------------------------------------------------------------------------
# Rutas del directorio de trabajo y de salida (Req 13.3)
# ---------------------------------------------------------------------------
# Directorio base del backend (…/backend).
BACKEND_ROOT: Path = Path(__file__).resolve().parent.parent

# Directorio de trabajo raíz; los temporales por Job viven en `<WORKDIR>/jobs/{job_id}/`.
# Configurable mediante variable de entorno para facilitar pruebas locales.
WORKDIR_ROOT: Path = Path(
    os.environ.get("VSE_WORKDIR", str(BACKEND_ROOT / ".workdir"))
).resolve()

# Directorio de salida donde se conserva el `Video_Final` de cada Job, separado
# del directorio temporal para permitir la descarga tras la limpieza (Req 13.4/13.5).
OUTPUT_ROOT: Path = Path(
    os.environ.get("VSE_OUTPUT", str(BACKEND_ROOT / ".output"))
).resolve()

# Nombre del artefacto final por Job.
FINAL_VIDEO_FILENAME: str = "final.mp4"


def job_workdir(job_id: str) -> Path:
    """Devuelve el directorio de trabajo temporal de un Job (`<WORKDIR>/jobs/{job_id}`)."""
    return WORKDIR_ROOT / "jobs" / job_id


def job_output_path(job_id: str) -> Path:
    """Devuelve la ruta del `Video_Final` conservado para descarga del Job."""
    return OUTPUT_ROOT / job_id / FINAL_VIDEO_FILENAME


# ---------------------------------------------------------------------------
# Tiempos límite (Req 12.1)
# ---------------------------------------------------------------------------
# Plazo total de verificación de dependencias al arrancar (Req 12.1).
DEPENDENCY_CHECK_TIMEOUT_S: float = 10.0

# ---------------------------------------------------------------------------
# Valores por defecto del pipeline (Req 3.2, 3.5, 4.2, 5.2, 5.3, 6.1, 7.x, 8.4)
# ---------------------------------------------------------------------------
# Resolución objetivo por defecto: 1080x1920 (9:16) (Req 3.2).
DEFAULT_RESOLUCION_ANCHO: int = 1080
DEFAULT_RESOLUCION_ALTO: int = 1920

# Cuadros por segundo objetivo por defecto (Req 3.5).
DEFAULT_FPS: int = 30

# Corte de silencios (Req 4.2): umbral por defecto 4 %, margen por defecto 0,2 s.
DEFAULT_SILENCIO_ACTIVADO: bool = True
DEFAULT_SILENCIO_UMBRAL_DB: float = -30.0  # equivalente UI (~4 % del motor)
DEFAULT_SILENCIO_MARGEN_MS: int = 200

# Transcripción (Req 5.2, 5.3).
DEFAULT_IDIOMA: str = "es"
DEFAULT_MODELO: str = "small"

# Subtítulos (Req 6.1, 7.3, 7.4, 7.8, 7.9).
DEFAULT_MAX_PALABRAS: int = 4
DEFAULT_TAMANO_FUENTE: int = 72
DEFAULT_GROSOR_BORDE: int = 5
DEFAULT_ANIM_ENTRADA_MS: int = 300
DEFAULT_ANIM_SALIDA_MS: int = 300
DEFAULT_SLIDE_PX: int = 50
DEFAULT_FUENTE: str = "Arial"
DEFAULT_COLOR: str = "#FFFFFF"
DEFAULT_COLOR_BORDE: str = "#000000"

# Música / ducking (Req 8.4, 8.5, 8.6).
DEFAULT_VOLUMEN_MUSICA_PCT: int = 30
DEFAULT_REDUCCION_DB: float = 12.0
DEFAULT_UMBRAL_VOZ_DBFS: float = -30.0
DEFAULT_ATAQUE_MS: int = 250
DEFAULT_LIBERACION_MS: int = 500
