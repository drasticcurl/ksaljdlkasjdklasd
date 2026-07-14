# Feature: Previsualización del vídeo real con subtítulos (Remotion)

Contexto de una feature ya IMPLEMENTADA y validada en este repo. Úsalo como referencia para futuras tareas relacionadas.

## Proyecto
- Editor de "shorts" verticales. Backend FastAPI (Python) en 127.0.0.1:8000; Frontend Next.js (`/frontend`); subproyecto Remotion (Node) en `/remotion`.
- Pipeline: UNIR → CORTAR_SILENCIOS → TRANSCRIBIR → SUBTITULOS → MUSICA (`backend/app/engine/pipeline.py`).
- Dos motores de render de subtítulos elegidos por el usuario: `ass` (ffmpeg/libass) y `remotion`. Tras preparar subtítulos, el pipeline se pausa en `esperando_eleccion_render` y el usuario elige motor vía `POST /render/{job_id} { motor }`. Sin fallback.
- El vídeo intermedio se sirve por `GET /workfile/{job_id}/{nombre}`.
- IDIOMA: todo el código y los comentarios están en ESPAÑOL. Mantener esa convención.

## Qué añade la feature
Un paso opcional de previsualización EN VIVO del vídeo REAL cortado con los subtítulos reales (grupos con tiempos de la transcripción) usando `@remotion/player`, antes de disparar el render real de Remotion. Solo se ajusta el ESTILO (no el texto). Se activa con un TOGGLE cuando el Job está en `esperando_eleccion_render` y el usuario elige Remotion. Incluye "Guardar estilo" (persiste vía `PUT /configuracion`) y "Confirmar y renderizar" (`POST /render {motor:"remotion"}`). El flujo ffmpeg permanece intacto (no monta el Player ni consulta `/workfile`).

## Documentos de la spec
`.kiro/specs/previsualizacion-video-real-remotion/` → `requirements.md`, `design.md`, `tasks.md` (todas las tareas completadas).

## Cambios de backend
- `backend/app/api/render.py`: `GET /render/{job_id}` ampliado (función `construir_respuesta_render(job, inspeccionar_fn=inspeccionar_clip)`). Añade `video_url`, `video_nombre` (derivados de `job.cortado_path` + `config.BACKEND_HOST/PORT` con el patrón de `/workfile`), `fps`/`ancho`/`alto` (de `job.ajustes.generales`), `duracion_s` (inspección best-effort con `app.engine.ffprobe.inspeccionar_clip`; `None` si falla), y `palabras` en cada grupo. Es de SOLO LECTURA (no muta el Job). `video_url`/`video_nombre`/`duracion_s` son `null` si no hay `cortado_path`.
- `POST /render`, `GET /workfile`, `GET/PUT /configuracion`: SIN cambios.
- Tests: `backend/tests/test_render_pbt.py` (PBT con hypothesis) y ampliación de `backend/tests/test_endpoints_nuevos.py`.

## Cambios de frontend
- `frontend/lib/types.ts`: añadidos `PalabraSubtitulo`, `GrupoSubtituloConPalabras`; `RenderEleccion` ampliado con `video_url`, `video_nombre`, `fps`, `ancho`, `alto`, `duracion_s` (retrocompatible).
- `frontend/lib/remotion-map.ts`: `grupoBackendARemotion`/`gruposBackendARemotion` (mapeo puro segundos→ms), `calcularDurationInFrames`, y `redondearMitadAPar` (redondeo banker's / round-half-to-even para coincidir EXACTAMENTE con `round()` de Python; NO usar `Math.round`). Replica el criterio de `backend/app/engine/remotion.py` (`mapear_grupo_a_props_grupo`, `_ms_desde_segundos`, `_calcular_duration_in_frames`).
- `frontend/lib/estilo.ts`: `estiloDesdeAjustes` / `ajustesConEstilo` (proyección `AjustesSubtitulos` ↔ `Estilo`, inmutable, round-trip idempotente).
- `frontend/components/EstiloSubtitulos.tsx`: controles de estilo reutilizables (componente controlado `{estilo, onChange}`). El `/playground` (`frontend/app/playground/page.tsx`) fue refactorizado para consumirlo.
- `frontend/components/PreviewRemotionReal.tsx`: componente principal de la preview (carga estilo desde `GET /configuracion`, monta `<Player>` con `videoSrc=videoUrl` y `gruposBackendARemotion`, panel de estilo, "Guardar estilo", "Confirmar y renderizar" con manejo de 409, y un Error Boundary `LimiteErrorVideo` que aísla fallos de carga del vídeo mostrando `data-testid="video-error"` sin bloquear la confirmación).
- `frontend/components/EleccionRender.tsx`: toggle `data-testid="toggle-preview-remotion"` (desactivado por defecto, deshabilitado si `video_url` es null con aviso `preview-no-disponible`); monta/desmonta `PreviewRemotionReal`; `onRenderConfirmado` → `onElegido('remotion')`.
- `frontend/lib/api.ts`: `elegirRender(jobId, 'remotion')` ya cubre la confirmación (sin cambios de contrato).

## Composición Remotion (sincronía CRÍTICA)
- Existen DOS copias que deben mantenerse sincronizadas: `remotion/src/` (render SSR) y `frontend/components/remotion/` (navegador con `@remotion/player`).
- La ÚNICA diferencia permitida entre `ShortVideo.tsx` de ambas es el subcomponente `FondoVideo`: `<OffthreadVideo>` en SSR, `<Video>` (de `remotion`) en el navegador. El resto (fondo blanco cuando `videoSrc===""`, capa `<Captions>`) es idéntico.
- `types.ts` (contrato `Palabra`, `Grupo`, `Estilo`, `ShortVideoProps`) DEBE ser idéntico en ambas copias y coherente con `backend/app/engine/remotion.py`. `ShortVideoProps` NO cambió.

## Propiedades de correctitud (verificadas con PBT)
- P1: `grupoBackendARemotion` produce los mismos `startMs/endMs/words` que el backend.
- P2: `calcularDurationInFrames` coincide con `_calcular_duration_in_frames` (usa `Math.ceil`, mínimo 1).
- P4: round-trip `estiloDesdeAjustes ∘ ajustesConEstilo` idempotente.
- PBT: `hypothesis` (backend), `fast-check` (frontend).

## Cómo probar
- Backend: `cd backend && pytest` (262 tests en verde).
- Frontend: `cd frontend && npm run typecheck` y `npm test` (vitest, 142 tests en verde).
- Remotion SSR: `cd remotion && npx tsc --noEmit`.

## Estado / PR
- Rama: `feat/previsualizacion-video-real-remotion`. PR #19 abierto contra `main`.
- Nota: `remotion/package-lock.json` quedó versionado (generado al instalar deps para el typecheck); puede eliminarse del repo si se prefiere no versionarlo.
