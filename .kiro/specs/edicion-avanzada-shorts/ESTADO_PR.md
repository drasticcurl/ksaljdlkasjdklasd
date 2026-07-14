# Estado del PR #21 — edicion-avanzada-shorts

> Rama: `feature/edicion-avanzada-shorts-tarea-4-4` → `main`. Este documento resume
> el estado actual de la feature para la revisión del PR. Actualizado tras la
> **tarea 5.4** (registro del router de silencios).

## Qué hace la feature (resumen breve)

Edición avanzada de shorts verticales, en varias capas aditivas sobre el pipeline
existente:

- **Timeline de silencios editable**: tras UNIR los clips se detectan los tramos
  de silencio sobre el vídeo **unido** (sin recortar); el pipeline se **pausa**
  (`ESPERANDO_EDICION_SILENCIOS`) y la Interfaz muestra un timeline tipo CapCut
  para mover/estirar/añadir/eliminar los tramos a borrar. Al confirmar se
  **aplica** el corte y el pipeline continúa (detección → pausa → aplicación).
- **Revisión de subtítulos solo texto**: el usuario revisa el texto de los
  subtítulos (sin estilos) antes del render.
- **Textos extra tipo hook** en la edición final, superpuestos sobre el vídeo.
- **Render SIEMPRE con Remotion** (sin fallback a ffmpeg para esta feature).
- **Clave OpenAI persistida en `localStorage`** en el frontend.
- **Extensión ADITIVA de `ShortVideoProps`** con dos copias sincronizadas de la
  composición (`remotion/src` para render SSR y `frontend/components/remotion`
  para el navegador).

## Estado / hecho

- **Modelos y validadores**: `app/models/job.py`, `app/models/settings.py`
  (incluye `validar_tramos_silencio` y la validación de textos extra).
- **Motor de silencios**: refactor de `app/engine/silence.py`
  (detectar / aplicar / complemento de tramos).
- **Constructor de props Remotion**: `app/engine/remotion.py` propaga
  `textosExtra` en las props.
- **Pipeline**: `app/engine/pipeline.py` con pausas + reanudaciones
  (`reanudar_desde_silencios`, always-Remotion, propagación de `textos_extra`).
- **Jobs**: `app/jobs/manager.py` (estado `ESPERANDO_EDICION_SILENCIOS`,
  `marcar_esperando_edicion_silencios`) y `app/jobs/runner.py`
  (`lanzar_reanudacion_silencios`).
- **Endpoints**: `GET/POST /silencios/{id}`, `GET/POST /subtitulos/{id}`,
  `GET/POST /render/{id}` (render ampliado con textos extra) y **registro del
  router de silencios en `main.py` (tarea 5.4)**.
- **`GET /workfile/{job_id}/{nombre}`**: sirve por nombre cualquier artefacto del
  workdir del Job (incluye `unido.mp4` y `cortado.mp4`), validado contra path
  traversal — cubre el timeline de silencios (vídeo unido) y el preview (vídeo
  cortado).
- **Frontend**: tipos y `api`, mapeo/estilo, composición Remotion (types +
  `TextosExtraLayer` + `ShortVideo` + `Root`), componentes UI
  (`TimelineSilencios`, `SubtitleReview` reutilizado, `TextosExtra` /
  `EstiloTextoExtra`, `PreviewFinal`, `OpenAIKeyInput` con `localStorage`) y
  orquestación en `page.tsx`.
- **PBT ya hechas**: P5 (complemento de tramos), P8 (validación de textos extra),
  P9 (retrocompatibilidad de `ShortVideoProps`), P7 (mapeo coherente), además de
  tests de `silence`, transiciones/pausas (tarea 4.4), api del frontend,
  `TimelineSilencios` y `TextosExtra`.
- **Suites** (al momento de 4.4): frontend en verde (~214 tests) y backend en
  verde (~299 tests).

## Lo que falta (pendiente)

- **Tarea 5.5**: pruebas pytest de los endpoints `/silencios`, `/subtitulos`,
  `/render` (códigos 200/202/400/404/409 y límites de validación).
- **Tarea 11.1**: pruebas de integración del pipeline extremo a extremo con las
  pausas.
- **Tarea 11.2**: suite de verificación frontend/Remotion (`vitest` +
  `tsc --noEmit`) y confirmación de la sincronía de las dos copias de la
  composición.
- **Puntos de control 6 y 12**: correr toda la suite (backend + frontend).

> **Nota de diseño para retomar**: conviene que
> `app/engine/pipeline.py: ejecutar_pipeline` acepte e ignore inyecciones extra
> (`**_inyecciones_ignoradas`), igual que ya hacen `reanudar_desde_silencios` /
> `reanudar_pipeline`, para poder inyectar `fn_remotion` / `fn_aplicar` en las
> pruebas de integración.

## Razonamiento / plan (steering de pensamiento)

- **Orden por olas de dependencias**: modelos → motores puros → pipeline/runner →
  endpoints → UI → registro. Cada ola depende de la anterior, lo que permite
  probar el núcleo (validadores, complemento de tramos) de forma aislada antes de
  cablearlo.
- **Por qué el render es SIEMPRE Remotion**: esta feature necesita superponer
  textos extra tipo hook y un estilo rico sobre el vídeo, algo que se expresa de
  forma aditiva en las props de `ShortVideo`; mantener un único motor evita
  divergencias de resultado y simplifica el contrato.
- **Cómo continuar**: registrar el router (hecho en 5.4) → 5.5 (pruebas de
  endpoints) → 11.1 (integración del pipeline con pausas) → 11.2 (verificación
  frontend/Remotion + sincronía de copias) → checkpoints 6 y 12 (suite completa).
