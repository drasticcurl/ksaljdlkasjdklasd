"""Punto de entrada del backend FastAPI (vertical-shorts-editor).

Esta aplicación FastAPI sirve de base para el resto del backend e integra la
verificación de dependencias al arrancar (Verificador_de_Dependencias, tarea 10)
y los routers de subida de clips y música (tarea 13).

Routers registrados:

- `POST /clips` y `POST /musica` (tarea 13, Req 1 y 8.1/8.2).
- `POST /procesar`, `GET /progreso/{id}` (JSON + SSE) y `GET /descargar/{id}`
  (tarea 14, Req 9.5, 10.x, 11.x), cableados con el Gestor de Jobs y el ejecutor
  en background compartidos.

Verificación de dependencias al iniciar (Req 12):

- En el evento de arranque (lifespan) se comprueban `ffmpeg`, `ffprobe`,
  `auto-editor` y `faster-whisper` dentro de un plazo total de 10 s.
- Si falta al menos una dependencia se **aborta el arranque** lanzando una
  excepción (fallo de inicialización), identificando por nombre las faltantes
  (Req 12.2, 12.4). Si todas están disponibles, el arranque continúa (Req 12.5).

Se ejecuta localmente con:

    uvicorn main:app --host 127.0.0.1 --port 8000

Referencias de requisitos: 12.4, 12.5, 14.5, 14.6.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app import config
from app.api import clips as clips_router
from app.api import download as download_router
from app.api import music as music_router
from app.api import process as process_router
from app.api import progress as progress_router
from app.deps import DependenciasFaltantesError, verificar_dependencias

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Ciclo de vida de la app: verifica dependencias antes de servir (Req 12).

    Ejecuta el Verificador_de_Dependencias en el arranque. Si falta alguna
    dependencia, lanza :class:`DependenciasFaltantesError`, lo que impide que el
    Backend complete su arranque e indica el fallo de inicialización (Req 12.4).
    Cuando todas están disponibles, cede el control y la app comienza a servir
    peticiones (Req 12.5).
    """
    resultado = verificar_dependencias()
    if resultado.debe_bloquear:
        # Req 12.4: impedir que el Backend complete su arranque.
        raise DependenciasFaltantesError(resultado.faltantes)
    logger.info("Todas las dependencias están disponibles; el Backend inicia.")
    yield


app = FastAPI(
    title="Vertical Shorts Editor",
    description=(
        "Backend local que envuelve el Motor de Procesamiento de shorts "
        "verticales (unir, cortar silencios, transcribir, subtitular, música)."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Routers de la API (tarea 13): subida de clips (Req 1) y música (Req 8.1, 8.2).
app.include_router(clips_router.router)
app.include_router(music_router.router)

# Routers de la API (tarea 14): procesamiento, progreso y descarga, cableados con
# el Gestor de Jobs y el ejecutor en background compartidos (Req 9.5, 10.x, 11.x).
app.include_router(process_router.router)
app.include_router(progress_router.router)
app.include_router(download_router.router)


@app.get("/salud")
def salud() -> dict[str, str]:
    """Endpoint de salud trivial para verificar que el backend está arriba.

    No forma parte del contrato funcional del pipeline; sirve como comprobación
    básica de disponibilidad durante el desarrollo.
    """
    return {"estado": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config.BACKEND_HOST,
        port=config.BACKEND_PORT,
        reload=False,
    )
