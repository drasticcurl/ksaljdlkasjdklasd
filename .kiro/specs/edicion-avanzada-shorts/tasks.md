# Plan de Implementación: Edición Avanzada de Shorts

> Feature: `edicion-avanzada-shorts` · Tipo: `feature` · Flujo: `design-first`
>
> **Convención obligatoria:** todos los títulos y descripciones de tareas, así como el código a implementar y sus comentarios, están en **ESPAÑOL** (Requisito 17).

## Resumen

Este plan convierte el diseño aprobado (`design.md`) en pasos de codificación incrementales. El orden respeta las dependencias: primero los modelos de datos (backend) y contratos de tipos (frontend), luego los motores puros (silencios, props de Remotion), después la orquestación del pipeline y los endpoints, y finalmente los componentes de UI y la integración. Cada paso se apoya en los anteriores y termina cableando las piezas al flujo real (sin código huérfano).

Lenguajes fijados por el diseño: **Python** (backend, `pytest` + `hypothesis`) y **TypeScript** (frontend/Remotion, `vitest` + `fast-check`). Todas las pruebas basadas en propiedades DEBEN ejecutar **≥ 100 iteraciones** (Requisito 19.6). El diseño es **aditivo**: no se rompen contratos existentes; `ShortVideoProps` se extiende de forma opcional; las **dos copias** de la composición Remotion (`remotion/src/` y `frontend/components/remotion/`) sólo pueden diferir en `FondoVideo`.

---

## Tareas

### BACKEND

- [x] 1. Modelos de datos y validadores del backend
  - [x] 1.1 Ampliar estados y campos del Job en `backend/app/models/job.py`
    - Añadir el estado `ESPERANDO_EDICION_SILENCIOS = "esperando_edicion_silencios"` a `JobStatus`.
    - Renombrar `ESPERANDO_ELECCION_RENDER` → `ESPERANDO_EDICION_FINAL` con valor de string `"esperando_edicion_final"` (documentar que ocupa el mismo punto lógico de pausa).
    - Añadir a `JobState` los campos opcionales `unido_path`, `silencios_detectados: List[TramoSilencio]`, `duracion_unido_s: float`, `textos_extra: List[TextoExtra]`.
    - _Requisitos: 1.2, 1.3, 8.1, 11, 16.2_
  - [x] 1.2 Añadir modelos y validadores en `backend/app/models/settings.py`
    - Definir `TramoSilencio` (`inicio_s`, `fin_s`), `EstiloTextoExtra` (fuente, tamaño, color, color_borde, grosor_borde, negrita, pos_vertical_pct, pos_horizontal_pct) y `TextoExtra` (texto, inicio_s, fin_s, estilo).
    - Implementar `validar_tramos_silencio(tramos, duracion_s) -> List[str]` (cada tramo `0 <= inicio < fin <= duracion`).
    - Implementar `validar_texto_extra(t, duracion_s) -> List[str]` según §7.3 (rango temporal + rangos de estilo: tamaño 12–200, grosor 0–20, posiciones 0–100, color y color_borde `#RRGGBB`).
    - Añadir los rangos de estilo de texto extra a `RANGOS_MOTOR` reutilizando los límites de subtítulos.
    - _Requisitos: 1.1, 13, 15.1, 15.2, 15.4, 15.5_
  - [x]* 1.3 Escribir prueba de propiedad de validación de textos extra (hypothesis)
    - **Propiedad 8 (P8): Validación de rangos de estilo de textos extra**
    - **Valida: Requisitos 15.4, 15.5, 19.4**
    - Verificar el bicondicional: `validar_texto_extra` devuelve lista vacía si y sólo si el rango temporal y todos los campos de estilo están dentro de rango. Ejecutar ≥ 100 iteraciones.

- [x] 2. Refactor del motor de silencios en `backend/app/engine/silence.py`
  - [x] 2.1 Separar detección y aplicación en funciones puras/inyectables
    - Añadir `@dataclass(frozen=True) ResultadoDeteccionSilencios(silencios, duracion)`.
    - Implementar `detectar_silencios(entrada, *, umbral_db, margen_ms, modo="db", runner, detector_voz)` reutilizando `parsear_silencedetect`/VAD + `obtener_duracion`, sin recortar.
    - Implementar `segmentos_conservar_desde_borrado(tramos_borrar, duracion)` según pseudocódigo §7.1 (normaliza/clamp, fusiona solapados, complemento en `[0,duracion]`, ordenado, sin solapes, NUNCA vacío, caso D-VACIO → `[(0, duracion)]`).
    - Implementar `aplicar_tramos_borrado(entrada, salida, tramos_borrar, duracion, *, runner)` reutilizando `construir_filtro_recorte`/comando de recorte.
    - Reescribir `cortar_silencios` en términos de las nuevas funciones (compatibilidad de comportamiento).
    - _Requisitos: 1.1, 5.5, 5.6, 5.8, 16.3_
  - [x]* 2.2 Escribir prueba de propiedad del complemento de tramos (hypothesis)
    - **Propiedad 5 (P5): Complemento de tramos a borrar**
    - **Valida: Requisitos 5.5, 5.8, 19.1, 19.2**
    - Verificar P5a (complemento exacto salvo D-VACIO), P5b (ordenado, sin solapes), P5c (clamp a `[0,duracion]`), P5d (no vacío). Ejecutar ≥ 100 iteraciones.
  - [x]* 2.3 Escribir pruebas unitarias de equivalencia del refactor
    - Comprobar que `cortar_silencios` (nueva implementación) produce el mismo resultado que la versión previa para las mismas entradas de detección.
    - Casos borde: sin silencios, silencios adyacentes/solapados, todo marcado para borrar (D-VACIO).
    - _Requisitos: 5.6, 5.8_

- [x] 3. Ampliar el constructor de props en `backend/app/engine/remotion.py`
  - [x] 3.1 Emitir `textosExtra` en las props del render
    - Implementar `mapear_texto_extra_a_props(t) -> dict` con `{texto, inicioMs, finMs, estilo:{...camelCase...}}` usando la conversión de segundos→ms existente.
    - Ampliar `construir_props(..., textos_extra: Sequence[TextoExtra] = ())` para añadir `props["textosExtra"] = [...]` (lista vacía si no hay textos).
    - _Requisitos: 10.2, 13.1, 13.2_
  - [x]* 3.2 Escribir prueba de propiedad de retrocompatibilidad (hypothesis)
    - **Propiedad 9 (P9): Idempotencia/retrocompatibilidad de `ShortVideoProps`**
    - **Valida: Requisitos 13.2, 13.3, 19.5**
    - Verificar que `construir_props(..., textos_extra=())` produce `props["textosExtra"] == []` y el resto del contrato es idéntico al previo (no regresión). Ejecutar ≥ 100 iteraciones.

- [x] 4. Orquestación del pipeline y gestión de Jobs
  - [x] 4.1 Ampliar `backend/app/jobs/manager.py` con marcadores y setters
    - Añadir `marcar_esperando_edicion_silencios(job_id, unido_path, silencios, duracion)`.
    - Renombrar `marcar_esperando_eleccion_render` → `marcar_esperando_edicion_final`.
    - Añadir setter de `textos_extra`; garantizar monotonía no decreciente del progreso (0–100) y fijar 100% al finalizar.
    - _Requisitos: 1.3, 8.1, 11.2, 16.4, 16.5_
  - [x] 4.2 Partir el pipeline de silencios y las pausas en `backend/app/engine/pipeline.py`
    - Dividir `CORTAR_SILENCIOS` en FASE A (detección → pausa `pendiente_edicion_silencios`) y aplicación en reanudación; añadir flag `pendiente_edicion_silencios` a `ResultadoPipeline`.
    - Implementar `reanudar_desde_silencios(job, tramos_editados)` (calcula segmentos, aplica corte, continúa a TRANSCRIBIR).
    - Ajustar `preparar_grupos_y_pausar` para marcar `ESPERANDO_EDICION_FINAL`; fijar motor `"remotion"` por defecto y propagar `textos_extra` al render.
    - Respetar el orden secuencial exacto del flujo y no regenerar artefactos ya completados.
    - _Requisitos: 1.1, 1.2, 1.4, 1.5, 5.5, 5.6, 5.7, 6.1, 8.1, 10.2, 11.2, 11.6, 16.1, 16.3, 16.6_
  - [x] 4.3 Añadir reanudaciones y persistencia de pausas en `backend/app/jobs/runner.py`
    - Implementar `reanudar_silencios_job` + `lanzar_reanudacion_silencios`; persistir la pausa de silencios sin limpiar el workdir.
    - En la reanudación final, pasar `textos_extra` a `reanudar_pipeline`; conservar el workdir en todas las pausas.
    - _Requisitos: 5.1, 5.7, 7.1, 10.1, 16.2, 16.3_
  - [x]* 4.4 Escribir pruebas de transiciones de estado y pausas (pytest)
    - Verificar el orden del flujo, la persistencia del workdir entre pausas, la monotonía del progreso y la parada en fallo sin avanzar.
    - _Requisitos: 16.1, 16.2, 16.4, 16.6_

- [ ] 5. Endpoints de API y registro de routers
  - [x] 5.1 Crear el router `backend/app/api/silencios.py`
    - `GET /silencios/{job_id}`: devolver tramos (ordenados, sin solapes), `duracion_s`, `video_url`/`video_nombre` del vídeo unido, `fps`/`ancho`/`alto`, `editable` según estado; `404 JOB_NOT_FOUND` si no existe.
    - `POST /silencios/{job_id}`: validar con `validar_tramos_silencio`, reanudar (`202`, `EN_EJECUCION`); `404`/`409 CONFLICT`/`400 INVALID_REQUEST` según §5.2.
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 5.4, 14.2, 14.3, 14.4, 14.5_
  - [x] 5.2 Mantener el contrato de solo texto en `backend/app/api/subtitles.py`
    - `GET /subtitulos/{job_id}`: devolver grupos con texto + tiempos informativos y `editable` según estado.
    - `POST /subtitulos/{job_id}`: aceptar sólo texto confirmado; validar que la cantidad de grupos coincide y ningún texto queda vacío tras `trim`; conservar tiempos por palabra sin recalcular karaoke; `202`/`400`/`409` según §5.4.
    - _Requisitos: 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 14.2, 14.3, 14.4_
  - [x] 5.3 Ampliar `backend/app/api/render.py`
    - `GET /render/{job_id}`: añadir `textos_extra` (últimos o `[]`) y datos del vídeo cortado (duración, ancho, alto); `editable = true` en `ESPERANDO_EDICION_FINAL`.
    - `POST /render/{job_id}`: aceptar `textos_extra` (máx 2, validados con `validar_texto_extra`), `motor` opcional que sólo acepta `"remotion"` (por defecto `"remotion"`), persistir y reanudar siempre con Remotion; `202`/`400`/`409` según §5.6.
    - _Requisitos: 8.2, 10.1, 10.5, 11.2, 11.3, 11.4, 11.5, 14.3, 14.4, 15.3, 15.4, 15.5_
  - [-] 5.4 Registrar router y servir el vídeo unido en `backend/main.py`
    - Registrar el router `silencios`; garantizar que `GET /workfile/{job_id}/{nombre}` sirve `unido.mp4` (y `cortado.mp4`) por HTTP; envoltura de error homogénea en todos los endpoints.
    - _Requisitos: 2.6, 14.1, 14.5_
  - [ ]* 5.5 Escribir pruebas de los endpoints (pytest)
    - Cubrir códigos `200/202/400/404/409` de `/silencios`, `/subtitulos` y `/render`, incluidos límites de validación (tramos, textos extra, motor).
    - _Requisitos: 2, 5, 6, 7, 8, 10, 11, 14, 15_

- [~] 6. Punto de control del backend
  - Asegurarse de que todas las pruebas del backend pasan; preguntar al usuario si surgen dudas.

### FRONTEND

- [x] 7. Tipos y cliente de API del frontend
  - [x] 7.1 Ampliar `frontend/lib/types.ts`
    - Añadir `TramoSilencio`, `SilenciosEdicion`, `EstiloTextoExtra`, `TextoExtra`; ampliar la elección de render con `textos_extra`; añadir los estados `esperando_edicion_silencios` y `esperando_edicion_final` a `JobStatus`. Mantener el tipo de revisión de subtítulos de solo texto.
    - _Requisitos: 2.1, 5, 10, 13.1_
  - [x] 7.2 Ampliar `frontend/lib/api.ts` con nuevos clientes y persistencia de clave
    - Añadir `obtenerSilencios`, `enviarSilencios`, `confirmarRenderFinal`; mantener el cliente de revisión de subtítulos de solo texto.
    - Añadir helpers de `localStorage` para la clave de OpenAI: `guardarApiKeyLocal`, `leerApiKeyLocal`, `olvidarApiKeyLocal` (clave `openai_api_key`).
    - _Requisitos: 2.1, 5.1, 10.1, 12.1, 12.2, 12.3, 14_
  - [x]* 7.3 Escribir pruebas del cliente API y de la persistencia de clave (vitest)
    - Verificar guardado/lectura/olvido en `localStorage` y el formato de las peticiones.
    - _Requisitos: 12.1, 12.2, 12.3_

- [x] 8. Mapeo y proyección de estilo de textos extra
  - [x] 8.1 Añadir `textosExtraBackendARemotion` en `frontend/lib/remotion-map.ts`
    - Mapear `TextoExtra` backend → `TextoExtraProps` reutilizando `redondearMitadAPar` (banker's rounding) para `inicioMs`/`finMs`.
    - _Requisitos: 10.2, 19.3_
  - [x] 8.2 Añadir proyección de estilo en `frontend/lib/estilo.ts`
    - Implementar `estiloTextoExtraDesdeAjustes` y `ajustesTextoExtra` (proyección hermana de la de subtítulos).
    - _Requisitos: 10, 15.5_
  - [x]* 8.3 Escribir prueba de propiedad de coherencia de mapeo (fast-check)
    - **Propiedad 7 (P7): Coherencia del mapeo `textosExtra` backend↔frontend**
    - **Valida: Requisitos 10.2, 19.3**
    - Verificar contra vectores de referencia del backend que `inicioMs`, `finMs` y el estilo camelCase coinciden. Ejecutar ≥ 100 iteraciones.
  - [x]* 8.4 Escribir pruebas unitarias de la proyección de estilo (vitest)
    - Round-trip de estilo de texto extra y casos límite de rango.
    - _Requisitos: 15.5_

- [x] 9. Composición Remotion (DOS copias idénticas salvo `FondoVideo`)
  - [x] 9.1 Extender el contrato de tipos en ambas copias
    - En `frontend/components/remotion/types.ts` y `remotion/src/types.ts`: añadir `TextoExtraProps`, `EstiloTextoExtra` y `ShortVideoProps.textosExtra?` (opcional). Mantener los ficheros idénticos.
    - _Requisitos: 13.1, 13.4_
  - [x] 9.2 Crear `TextosExtraLayer.tsx` en ambas copias
    - Overlay de texto plano SIN animación, visible sólo en `[inicioMs, finMs)` (§7.4). Idéntico en `frontend/components/remotion/` y `remotion/src/`.
    - _Requisitos: 10.3, 10.4, 13.4, 9.5_
  - [x] 9.3 Montar la capa en `ShortVideo.tsx` y ajustar `Root.tsx`
    - Montar `<TextosExtraLayer>` en ambas copias de `ShortVideo.tsx` (única diferencia permitida: `FondoVideo`). En `remotion/src/Root.tsx` añadir `defaultProps.textosExtra: []`.
    - _Requisitos: 10.3, 13.3, 13.4_
  - [x]* 9.4 Verificar tipos y sincronía de copias
    - Ejecutar `tsc --noEmit` para el subproyecto Remotion; verificar que `types.ts`, `ShortVideo.tsx` y `TextosExtraLayer.tsx` de ambas copias sólo difieren en `FondoVideo`.
    - _Requisitos: 13.4, 19_

- [x] 10. Componentes de interfaz y orquestación
  - [x] 10.1 Implementar `frontend/components/TimelineSilencios.tsx`
    - Bloques arrastrables (mover/estirar/achicar/añadir/eliminar) con clamp a `[0, duración]`, descarte de duración `<= 0` y fusión de solapados/adyacentes manteniendo orden ascendente; anchura relativa `(fin-inicio)/duración`.
    - Preview con `@remotion/player` sobre el vídeo unido como nice-to-have (no bloqueante).
    - _Requisitos: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 18.1_
  - [x]* 10.2 Escribir pruebas de `TimelineSilencios` (vitest + fast-check)
    - Verificar clamp, fusión, orden y no-negatividad de duraciones tras ediciones aleatorias. Ejecutar ≥ 100 iteraciones en las propiedades.
    - _Requisitos: 3.1, 3.5, 3.6, 19_
  - [x] 10.3 Reutilizar `SubtitleReview.tsx` para la revisión de solo texto
    - Montar la revisión mostrando el texto de cada grupo, permitiendo únicamente edición de texto (sin controles de tiempo, sin split/merge), enviando el texto confirmado.
    - _Requisitos: 6.3, 7.1, 18.3_
  - [x] 10.4 Implementar `TextosExtra.tsx` + `EstiloTextoExtra.tsx`
    - Gestión de hasta 2 textos (botón "Agregar texto" deshabilitado al llegar a 2), campos in/out en segundos con validación (`0 <= in < out <= duración`), estilo independiente reutilizando el patrón de `EstiloSubtitulos`; texto plano sin animación.
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 18.2_
  - [x]* 10.5 Escribir pruebas de `TextosExtra` (vitest)
    - Verificar límite de 2 textos, validación de in/out y proyección de estilo.
    - _Requisitos: 9.1, 9.2, 9.6, 19_
  - [x] 10.6 Transformar `PreviewRemotionReal.tsx` → `PreviewFinal.tsx`
    - Preview en vivo del vídeo cortado con subtítulos vía `@remotion/player`; inyectar `textosExtra` en `inputProps`; montar `TextosExtra`; botón "Agregar texto" y "Confirmar y renderizar" que envía los textos extra; eliminar cualquier UI de elección de motor.
    - _Requisitos: 8.3, 8.4, 10.1, 11.1, 18.1_
  - [x] 10.7 Persistir la clave en `frontend/components/settings/OpenAIKeyInput.tsx`
    - Guardar/leer la clave en `localStorage`, mostrar aviso de seguridad visible y botón "Olvidar clave".
    - _Requisitos: 12.1, 12.3, 12.4_
  - [x] 10.8 Orquestar los nuevos estados en `frontend/app/page.tsx`
    - Enrutar `esperando_edicion_silencios` → `TimelineSilencios`; `esperando_revision` → `SubtitleReview`; `esperando_edicion_final` → `PreviewFinal`. Precargar la clave de OpenAI desde `localStorage` al montar.
    - _Requisitos: 1.5, 6.1, 8.1, 11.1, 12.2_

### PRUEBAS E INTEGRACIÓN

- [ ] 11. Verificación de integración global
  - [ ]* 11.1 Pruebas de integración del pipeline con pausas (pytest)
    - Recorrido completo: detección → pausa silencios → corte → transcripción → subtítulos → revisión → edición final → render Remotion, reutilizando artefactos y sin perder el workdir.
    - _Requisitos: 16.1, 16.2, 16.3_
  - [ ]* 11.2 Suite de verificación frontend/Remotion
    - Ejecutar `vitest` (mapeo P7, TimelineSilencios, TextosExtra) y `tsc --noEmit`; confirmar sincronía de las dos copias.
    - _Requisitos: 13.4, 19_

- [~] 12. Punto de control final
  - Asegurarse de que todas las pruebas (backend y frontend) pasan; preguntar al usuario si surgen dudas.

## Notas

- Las subtareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido; el resto son obligatorias.
- Cada tarea referencia los requisitos que satisface para trazabilidad.
- Las propiedades de correctitud del diseño se implementan como PBT: **P5** (2.2), **P8** (1.3), **P9** (3.2) en backend con `hypothesis`; **P7** (8.3) en frontend con `fast-check`. Todas ejecutan **≥ 100 iteraciones** (Requisito 19.6).
- Extensión estrictamente aditiva de `ShortVideoProps`; las dos copias de la composición Remotion se mantienen sincronizadas (única diferencia permitida: `FondoVideo`).
- Sin nuevas dependencias externas (Requisito 18.4).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "7.1", "9.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "3.1", "7.2", "8.1", "8.2", "9.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "4.1", "8.3", "8.4", "9.3", "10.1", "10.4", "10.7"] },
    { "id": 3, "tasks": ["4.2", "7.3", "9.4", "10.2", "10.3", "10.5", "10.6"] },
    { "id": 4, "tasks": ["4.3", "10.8"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "4.4"] },
    { "id": 6, "tasks": ["5.4"] },
    { "id": 7, "tasks": ["5.5", "11.1", "11.2"] }
  ]
}
```
