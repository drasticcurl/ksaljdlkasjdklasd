# Plan de Implementación: Previsualización del vídeo REAL con subtítulos (Remotion)

Cada tarea es incremental, se prueba con las suites existentes (`pytest` en backend, `vitest` en frontend) y referencia los requisitos de `requirements.md`. El orden minimiza el riesgo: primero el contrato de datos del backend, luego el mapeo/tipos del frontend, después la composición, y por último el ensamblado de UI.

- [x] 1. Ampliar el contrato de `GET /render/{job_id}` en el backend
- [x] 1.1 Añadir los campos del vídeo y dimensiones a la respuesta
  - En `backend/app/api/render.py`, extender la respuesta de `obtener_render` con `video_nombre`, `video_url`, `fps`, `ancho`, `alto` y `duracion_s`.
  - Derivar `video_nombre` de `Path(job.cortado_path).name` y `video_url` con `config.BACKEND_HOST`/`BACKEND_PORT` reutilizando el mismo patrón que `renderizar_con_motor_elegido` en `pipeline.py`.
  - Devolver `video_url`/`video_nombre` como `null` cuando `cortado_path` sea `None`.
  - Tomar `fps`/`ancho`/`alto` de `job.ajustes.generales`.
  - Garantizar que `grupos` incluya `palabras` (ya lo hace `GrupoSubtitulo.model_dump()`; añadir aserción de contrato).
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

- [x] 1.2 Inspección best-effort de la duración del vídeo cortado
  - Obtener `duracion_s` inspeccionando `cortado_path` con `app/engine/ffprobe.inspeccionar_clip` (inyectable), capturando cualquier excepción y devolviendo `null` sin lanzar.
  - _Requisitos: 1.5_

- [x] 1.3 [PBT] Propiedad: la respuesta de `GET /render` es consistente y de solo lectura
  - Con `hypothesis`, generar `JobState` variados (con/sin `cortado_path`, distintos `ajustes.generales`, grupos con/sin palabras) y verificar: `video_url` es `null` sii `cortado_path` es `None`; `fps/ancho/alto` reflejan los ajustes; `grupos` conserva `palabras`; el `job` no se muta.
  - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

- [x] 1.4 Tests de endpoint para el contrato ampliado
  - En `backend/tests/test_endpoints_nuevos.py` (o `test_api.py`), cubrir: Job con `cortado_path` (devuelve `video_url` correcta), Job sin `cortado_path` (`null`), fallo del inspector (`duracion_s = null`), Job inexistente (`404`).
  - _Requisitos: 1.1, 1.2, 1.3, 1.5, 1.7_

- [x] 2. Tipos y mapeo en el frontend
- [x] 2.1 Ampliar los tipos de `RenderEleccion` y `GrupoSubtitulo`
  - En `frontend/lib/types.ts`, añadir `PalabraSubtitulo`, `GrupoSubtituloConPalabras` y ampliar `RenderEleccion` con `video_url`, `video_nombre`, `fps`, `ancho`, `alto`, `duracion_s`, de forma retrocompatible.
  - _Requisitos: 1.1, 1.6_

- [x] 2.2 Implementar el mapeo `grupoBackendARemotion` (segundos → ms)
  - Nueva utilidad (p. ej. `frontend/lib/remotion-map.ts`) que replique el criterio de `mapear_grupo_a_props_grupo` de `backend/app/engine/remotion.py`: `startMs/endMs` redondeados con `endMs >= startMs`; `words` por palabra (herencia de tiempos del grupo si faltan); `words=[]` si no hay palabras.
  - _Requisitos: 3.2, 3.3, 3.4, 3.5_

- [x] 2.3 Implementar `calcularDurationInFrames`, `estiloDesdeAjustes` y `ajustesConEstilo`
  - `calcularDurationInFrames(duracionS, fps, grupos)` con el mismo criterio que `_calcular_duration_in_frames` del backend (fallback al mayor `endMs`).
  - `estiloDesdeAjustes` / `ajustesConEstilo` extraídos del patrón ya presente en `/playground` (proyección de `AjustesSubtitulos` ↔ `Estilo`).
  - _Requisitos: 3.6, 4.1, 4.4, 5.2_

- [x] 2.4 [PBT] Propiedades de coherencia y round-trip
  - Con `fast-check`: (P1) `grupoBackendARemotion` produce los mismos `startMs/endMs/words` que el criterio del backend para grupos aleatorios (incl. tiempos degenerados/invertidos, palabras faltantes); (P2) `calcularDurationInFrames` coincide con el criterio del backend; (P4) round-trip `estiloDesdeAjustes ∘ ajustesConEstilo` es idempotente.
  - _Requisitos: 3.2, 3.4, 3.5, 3.6, 5.2_

- [x] 2.5 Añadir `motor: "remotion"` reutilizando `elegirRender`
  - Verificar que `elegirRender(jobId, 'remotion')` de `lib/api.ts` cubre la confirmación; añadir helper si hiciera falta (no debería). Sin cambios de contrato.
  - _Requisitos: 6.2_

- [x] 3. Composición Remotion: motor de vídeo por entorno (sincronía)
- [x] 3.1 Extraer `FondoVideo` en la copia SSR
  - En `remotion/src/ShortVideo.tsx`, mover el fondo de vídeo a un subcomponente `FondoVideo` que use `<OffthreadVideo src={videoSrc} />`; conservar el fondo blanco cuando `videoSrc === ""` y la capa `<Captions>`.
  - _Requisitos: 8.1, 8.2, 8.3_

- [x] 3.2 Extraer `FondoVideo` en la copia del navegador con `<Video>`
  - En `frontend/components/remotion/ShortVideo.tsx`, `FondoVideo` usa `<Video src={videoSrc} />` de `remotion` (adecuado para `@remotion/player`); mantener idéntico el resto de la lógica y el contrato de props.
  - Confirmar que `remotion/src/types.ts` y `frontend/components/remotion/types.ts` siguen idénticos (sin cambios de contrato).
  - _Requisitos: 8.1, 8.2, 8.3, 8.4_

- [x] 4. Controles de estilo reutilizables (refactor acordado)
- [x] 4.1 Crear `EstiloSubtitulos` reutilizable
  - Nuevo `frontend/components/EstiloSubtitulos.tsx` con los controles de estilo (color, colorResaltado, tamaño, fuente, posición vertical, animación de entrada, color/grosor de borde, negrita), como componente controlado (`estilo` + `onChange`).
  - _Requisitos: 4.1, 4.2, 4.3_

- [x] 4.2 Hacer que `/playground` consuma `EstiloSubtitulos`
  - Refactorizar `frontend/app/playground/page.tsx` para usar `EstiloSubtitulos`, eliminando la duplicación sin cambiar su comportamiento actual.
  - Verificar que los tests existentes del playground siguen pasando.
  - _Requisitos: 4.1, 4.2, 4.3_

- [x] 5. Componente `PreviewRemotionReal`
- [x] 5.1 Estructura y carga inicial del estilo
  - Nuevo `frontend/components/PreviewRemotionReal.tsx` con las props del diseño; al montar, precargar el estilo desde `GET /configuracion` (o por defecto) usando `estiloDesdeAjustes`.
  - _Requisitos: 4.4_

- [x] 5.2 Montaje del `<Player>` con el vídeo real y subtítulos
  - Construir `inputProps` (`videoSrc = videoUrl`, `grupos.map(grupoBackendARemotion)`, `estilo`, dims, `durationInFrames`) y renderizar `<Player component={ShortVideo} ...>` escalado (p. ej. 360×640), con el vídeo real como fondo.
  - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 5.3 Panel de estilo (solo estilo) y re-render en vivo
  - Integrar `EstiloSubtitulos`; al cambiar el estilo, re-renderizar sin recargar el vídeo; no exponer edición de texto.
  - _Requisitos: 4.1, 4.2, 4.3_

- [x] 5.4 Botón "Guardar estilo"
  - Implementar `guardarEstilo`: cargar config vigente (o por defecto), aplicar `ajustesConEstilo` y `PUT /configuracion`; mostrar mensaje de éxito/error; no alterar el estado del Job en caso de fallo.
  - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 5.5 Acción "Confirmar y renderizar"
  - Implementar `confirmarRender`: `POST /render/{id}` con `motor: "remotion"`; en `202` invocar `onRenderConfirmado`; manejar `409` mostrando error sin romper la UI.
  - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 5.6 Manejo de errores de carga del vídeo
  - Manejar el error de carga del `<Player>`/vídeo: mantener visibles los subtítulos y permitir confirmar; no propagar el fallo al resto del editor.
  - _Requisitos: 9.1, 9.4_

- [x] 6. Integración en `EleccionRender`
- [x] 6.1 Toggle de previsualización y almacenamiento de datos del vídeo
  - En `frontend/components/EleccionRender.tsx`, almacenar `video_url/fps/ancho/alto/duracion_s` de la respuesta ampliada; añadir el toggle "Previsualizar con vídeo real (Remotion)", desactivado por defecto y deshabilitado cuando `video_url` es `null` (con aviso).
  - _Requisitos: 2.1, 2.2, 2.5, 9.2_

- [x] 6.2 Montaje/desmontaje de `PreviewRemotionReal`
  - Cuando el toggle está activo y hay `video_url`, montar `PreviewRemotionReal`; al desactivarlo, desmontarlo. Cablear `onRenderConfirmado` a `onElegido('remotion')`.
  - Asegurar que los dos botones y el flujo `ffmpeg` (`POST /render {motor:"ass"}`) permanecen intactos y no montan el Player ni consultan `/workfile`.
  - _Requisitos: 2.3, 2.4, 6.3, 7.1, 7.2, 7.3_

- [x] 7. Pruebas de UI e integración
- [x] 7.1 Tests de `PreviewRemotionReal`
  - Con `vitest` + Testing Library (mock de `@remotion/player` y de `lib/api`): monta el Player con `videoSrc` no vacío; "Guardar estilo" llama a `PUT /configuracion`; "Confirmar" llama a `POST /render` con `remotion`; cambios de estilo no recargan el vídeo; el texto no es editable.
  - _Requisitos: 3.1, 4.2, 4.3, 5.2, 6.2_

- [x] 7.2 Tests de `EleccionRender` con toggle
  - Verificar: toggle deshabilitado si `video_url` es `null`; activar monta la preview; desactivar la desmonta; `ffmpeg` no monta Player ni llama a `/workfile`; resaltado de `motor_preferido` intacto.
  - _Requisitos: 2.1, 2.2, 2.3, 2.4, 7.1, 7.2, 9.2_

- [x] 7.3 Test de flujo de integración
  - Simular el flujo completo con mocks de red: `esperando_eleccion_render` → toggle ON → preview → guardar estilo → confirmar → `onRenderConfirmado`; y el camino `ffmpeg` sin preview.
  - _Requisitos: 5.3, 6.3, 7.3, 9.4_

- [x] 8. Verificación de sincronía y suites completas
  - Ejecutar `pytest` (backend) y `vitest --run` (frontend) y corregir regresiones.
  - Revisar manualmente que `remotion/src/*` y `frontend/components/remotion/*` solo difieren en `FondoVideo` y que los `types.ts` son idénticos.
  - _Requisitos: 7.3, 8.2, 8.3, 8.4_
