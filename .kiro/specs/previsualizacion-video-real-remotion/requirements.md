# Documento de Requisitos: Previsualización del vídeo REAL con subtítulos (Remotion)

## Introducción

Esta feature añade un **paso de previsualización del vídeo REAL con subtítulos antes de renderizar**, como evolución del playground pero sobre el vídeo ya procesado (cortado) y con los subtítulos reales de la transcripción, en lugar de fondo blanco y textos de prueba.

Se activa cuando un Job está pausado en el estado `esperando_eleccion_render` y el usuario opta por el motor "Remotion": mediante un **toggle** puede ver en vivo (con `@remotion/player`) el vídeo real de fondo (servido por `GET /workfile/{job_id}/{nombre}`) con los subtítulos reales superpuestos. En esa vista solo puede ajustar el **estilo** (no el texto), **guardar el estilo** para reutilizarlo (igual que el playground) y, al conformarse, **confirmar y disparar el render real** de Remotion con ese estilo.

Estos requisitos se derivan del documento de diseño `design.md`. El diseño es aditivo: el flujo `ffmpeg` sigue funcionando sin cambios, el contrato de props de `ShortVideo` no cambia y las dos copias de la composición (`remotion/src` y `frontend/components/remotion`) permanecen en sincronía.

## Glosario

- **Job en elección de render**: Job en estado `esperando_eleccion_render` (grupos finales listos, sin renderizar).
- **Vídeo cortado**: artefacto intermedio (`cortado.mp4`) sobre el que se renderizan los subtítulos, servido por `GET /workfile/{job_id}/{nombre}`.
- **Grupo**: frase/línea de subtítulo con `texto`, `inicio_s`, `fin_s` y, opcionalmente, `palabras` con tiempos (para el karaoke).
- **Estilo**: conjunto de campos visuales (fuente, tamaño, color, colorResaltado, posVerticalPct, animEntradaMs, colorBorde, grosorBorde, negrita).
- **Preview**: la vista en vivo con `@remotion/player` del vídeo real + subtítulos.

---

## Requisitos

### Requisito 1: Exposición de datos del vídeo real y subtítulos al frontend

**Historia de usuario:** Como frontend, quiero obtener del backend la URL del vídeo de fondo, sus dimensiones/fps/duración y los grupos con palabras, para poder montar la previsualización del vídeo real con subtítulos.

#### Criterios de aceptación

1. CUANDO se consulta `GET /render/{job_id}` para un Job existente, EL sistema DEBERÁ incluir en la respuesta los campos `video_url`, `video_nombre`, `fps`, `ancho`, `alto` y `duracion_s`, además de los campos actuales (`job_id`, `estado`, `editable`, `motor_preferido`, `grupos`).
2. CUANDO el Job tiene `cortado_path` definido, EL sistema DEBERÁ derivar `video_nombre` del nombre de archivo de `cortado_path` y construir `video_url` como `http://{BACKEND_HOST}:{BACKEND_PORT}/workfile/{job_id}/{video_nombre}`.
3. CUANDO el Job NO tiene `cortado_path`, EL sistema DEBERÁ devolver `video_url` y `video_nombre` con valor `null`.
4. EL sistema DEBERÁ tomar `fps`, `ancho` y `alto` de `ajustes.generales` del Job.
5. CUANDO se puede inspeccionar la duración del vídeo cortado, EL sistema DEBERÁ devolver `duracion_s` con ese valor; CUANDO la inspección falla, EL sistema DEBERÁ devolver `duracion_s` con valor `null` sin lanzar ningún error.
6. EL sistema DEBERÁ incluir, para cada grupo de `grupos`, el campo `palabras` (lista de palabras con `texto`/`inicio_s`/`fin_s`, o `null` si el grupo no tiene palabras).
7. EL sistema NO DEBERÁ modificar el estado ni los datos del Job al responder a `GET /render/{job_id}` (operación de solo lectura).

### Requisito 2: Toggle de previsualización del vídeo real

**Historia de usuario:** Como usuario con un Job en elección de render, quiero un toggle para activar o desactivar la previsualización del vídeo real, para verla solo cuando la necesito.

#### Criterios de aceptación

1. CUANDO el Job está en `esperando_eleccion_render`, EL sistema DEBERÁ mostrar un control de tipo toggle "Previsualizar con vídeo real (Remotion)" junto a los dos botones de elección de motor.
2. CUANDO `video_url` es `null`, EL sistema DEBERÁ deshabilitar el toggle e informar de que la previsualización no está disponible.
3. CUANDO el usuario activa el toggle y `video_url` está disponible, EL sistema DEBERÁ montar la previsualización con el vídeo real y los subtítulos reales.
4. CUANDO el usuario desactiva el toggle, EL sistema DEBERÁ desmontar la previsualización y liberar el reproductor.
5. EL toggle DEBERÁ estar desactivado por defecto al mostrarse la elección de render.

### Requisito 3: Previsualización en vivo del vídeo real con subtítulos reales

**Historia de usuario:** Como usuario, quiero ver el vídeo real cortado con los subtítulos reales (los grupos con sus tiempos) superpuestos, para juzgar el resultado antes de renderizar.

#### Criterios de aceptación

1. CUANDO la previsualización está activa, EL sistema DEBERÁ usar `@remotion/player` con la composición `ShortVideo` y `videoSrc` igual a `video_url` (no vacío), de modo que se muestre el vídeo real de fondo.
2. EL sistema DEBERÁ mapear cada grupo del backend (segundos) al contrato de la composición (milisegundos), garantizando `startMs <= endMs` a nivel de grupo y de palabra.
3. CUANDO un grupo tiene `palabras` con tiempos, EL sistema DEBERÁ mostrar el resaltado palabra por palabra (karaoke); CUANDO un grupo no tiene palabras, EL sistema DEBERÁ dividir el texto por espacios sin resaltado individual.
4. CUANDO una palabra carece de tiempos válidos, EL sistema DEBERÁ heredar los tiempos del grupo para esa palabra.
5. EL agrupamiento y los tiempos usados en la previsualización DEBERÁN coincidir con los que produce el render real (misma lógica de mapeo que el backend), para que la previsualización sea fiel.
6. EL sistema DEBERÁ derivar la duración de la previsualización de `duracion_s * fps` (mínimo 1 frame) y, cuando `duracion_s` no sea fiable, del mayor tiempo de fin de los grupos.

### Requisito 4: Ajuste de solo estilo (nunca texto)

**Historia de usuario:** Como usuario, quiero ajustar únicamente el estilo de los subtítulos en la previsualización, para afinar la apariencia sin alterar el texto ya corregido.

#### Criterios de aceptación

1. EL sistema DEBERÁ permitir editar en vivo los campos de estilo: fuente, tamaño, color, color de resaltado, posición vertical, animación de entrada, color de borde, grosor de borde y negrita.
2. CUANDO el usuario cambia cualquier campo de estilo, EL sistema DEBERÁ re-renderizar la previsualización aplicando el nuevo estilo sin recargar el vídeo de fondo.
3. EL sistema NO DEBERÁ ofrecer ninguna forma de editar el texto de los grupos en esta vista (el texto es de solo lectura).
4. CUANDO se abre la previsualización, EL sistema DEBERÁ inicializar el estilo desde la configuración guardada (`GET /configuracion`) y, si no existe o falla, desde el estilo por defecto.

### Requisito 5: Guardar el estilo para reutilizarlo

**Historia de usuario:** Como usuario, quiero un botón "Guardar estilo" que persista el estilo, para que se use en el render real y en futuras sesiones, igual que el playground.

#### Criterios de aceptación

1. EL sistema DEBERÁ ofrecer un botón "Guardar estilo" en la previsualización.
2. CUANDO el usuario pulsa "Guardar estilo", EL sistema DEBERÁ cargar la configuración vigente (o los ajustes por defecto), aplicar los campos de estilo actuales sobre `ajustes.subtitulos` y persistirla mediante `PUT /configuracion`.
3. CUANDO el guardado tiene éxito, EL sistema DEBERÁ informar al usuario de que el estilo se ha guardado y se usará en el render real.
4. CUANDO el guardado falla (red o ajustes inválidos), EL sistema DEBERÁ mostrar un mensaje de error, conservar el estilo en memoria y NO cambiar el estado del Job.
5. EL estilo guardado DEBERÁ persistir entre sesiones, de modo que al reabrir la app se recupere (misma semántica que el playground).

### Requisito 6: Confirmar y disparar el render real de Remotion

**Historia de usuario:** Como usuario conforme con la previsualización, quiero confirmar y disparar el render real de Remotion con el estilo elegido, para generar el vídeo definitivo.

#### Criterios de aceptación

1. EL sistema DEBERÁ ofrecer una acción "Confirmar y renderizar" en la previsualización.
2. CUANDO el usuario confirma, EL sistema DEBERÁ llamar a `POST /render/{job_id}` con `{ "motor": "remotion" }`.
3. CUANDO el backend responde `202`, EL sistema DEBERÁ notificar la elección (equivalente a elegir "Remotion") y seguir el progreso del Job.
4. CUANDO el backend responde `409` (el Job ya no está en `esperando_eleccion_render`), EL sistema DEBERÁ mostrar el error sin romper la interfaz y continuar mostrando el progreso.
5. EL render real DEBERÁ ejecutarse con el estilo previamente persistido mediante "Guardar estilo".

### Requisito 7: El flujo ffmpeg permanece intacto

**Historia de usuario:** Como usuario que elige ffmpeg, quiero que el flujo funcione exactamente igual que antes, sin previsualización de Remotion.

#### Criterios de aceptación

1. CUANDO el usuario pulsa "ffmpeg", EL sistema DEBERÁ llamar a `POST /render/{job_id}` con `{ "motor": "ass" }` y reanudar el render clásico, sin montar el reproductor ni consultar `GET /workfile`.
2. EL comportamiento de los dos botones de elección de motor DEBERÁ conservarse, incluyendo el resaltado visual de `motor_preferido`.
3. LA introducción del toggle y la previsualización NO DEBERÁN alterar el flujo ni el resultado del motor ffmpeg.

### Requisito 8: Sincronía de composiciones y motor de vídeo en el navegador

**Historia de usuario:** Como mantenedor, quiero que la composición del navegador y la del render SSR sigan sincronizadas, con el motor de vídeo adecuado a cada entorno, para evitar divergencias.

#### Criterios de aceptación

1. EL sistema DEBERÁ usar en la copia del navegador (`frontend/components/remotion`) un motor de vídeo adecuado para reproducción en vivo (`<Video>` de `remotion`), y en la copia del render SSR (`remotion/src`) `<OffthreadVideo>`.
2. EL contrato de props `ShortVideoProps` NO DEBERÁ cambiar entre ambas copias.
3. LA lógica no relacionada con el fondo (fondo blanco cuando `videoSrc` es vacío y la capa de subtítulos) DEBERÁ permanecer idéntica en ambas copias.
4. CUALQUIER cambio en el contrato de datos DEBERÁ reflejarse de forma coherente en `remotion/src/types.ts`, `frontend/components/remotion/types.ts` y `backend/app/engine/remotion.py`.

### Requisito 9: Manejo de errores de la previsualización

**Historia de usuario:** Como usuario, quiero que la previsualización maneje los fallos con elegancia, para no quedar bloqueado.

#### Criterios de aceptación

1. CUANDO el vídeo de fondo no puede cargarse en el reproductor, EL sistema DEBERÁ seguir mostrando la capa de subtítulos y NO DEBERÁ impedir confirmar el render.
2. CUANDO `video_url` es `null`, EL sistema DEBERÁ deshabilitar la previsualización y ofrecer aun así la elección de motor por los botones.
3. CUANDO el render de Remotion falla tras confirmar, EL sistema (backend) DEBERÁ dejar el Job en `fallido` con `{paso: "SUBTITULOS", motivo}` sin fallback y limpiar los artefactos parciales, comportamiento ya existente que esta feature NO DEBERÁ alterar.
4. LOS fallos de la previsualización NO DEBERÁN afectar al flujo de ffmpeg ni al resto del editor.
