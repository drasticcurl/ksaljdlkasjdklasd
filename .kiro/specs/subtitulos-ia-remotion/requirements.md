# Documento de Requisitos: Subtítulos IA + Render Remotion

## Introduction

Esta especificación añade dos capacidades al editor de shorts verticales (backend FastAPI + frontend Next.js), preservando su arquitectura de pipeline de 5 pasos y su principio de operación 100 % local:

1. **Verificación/corrección de subtítulos con IA (OpenAI GPT-4.1 mini):** un paso opcional (opt-in) que corrige la ortografía del texto de cada grupo de subtítulos y, opcionalmente, fuerza minúsculas, **preservando los tiempos por grupo**. La clave de API se introduce manualmente en la interfaz y es **transitoria** (nunca se persiste en disco ni en logs). Ante ausencia de clave o fallo de la API, el paso **degrada con gracia** al texto original sin tumbar el pipeline.

2. **Motor de render Remotion con elección manual:** un motor de render alternativo al quemado ASS de ffmpeg/libass. Tras preparar los grupos de subtítulos, el pipeline se **pausa** (estado `ESPERANDO_ELECCION_RENDER`) y el usuario **elige manualmente** el motor mediante dos botones ("Editar con Remotion" y "ffmpeg"). **No existe fallback automático**: se ejecuta exactamente el motor elegido y, si falla, el Job pasa a `FALLIDO` con un error accionable.

Ambas capacidades son opt-in y mantienen **compatibilidad hacia atrás**: cuando están desactivadas o se elige el motor ASS, el comportamiento es idéntico al actual.

## Glossary

- **Sistema**: El editor de shorts verticales en su conjunto (backend + frontend).
- **Pipeline**: El proceso de 5 pasos (`backend/app/engine/pipeline.py`) que transforma clips en el vídeo final.
- **Backend**: La capa FastAPI que expone los endpoints HTTP (`backend/app/api/`).
- **Interfaz**: El frontend Next.js que interactúa con el usuario (`frontend/`).
- **Motor_Revision_IA**: El componente `engine/ai_review.py` que corrige el texto de los grupos mediante OpenAI GPT-4.1 mini.
- **Motor_Remotion**: El componente `engine/remotion.py` más el subproyecto Node `remotion/` que renderiza el vídeo con Remotion.
- **Motor_ASS**: El motor de render existente basado en ffmpeg/libass (`engine/subtitles.py`).
- **Gestor_Jobs**: El gestor de Jobs en memoria (`jobs/manager.py`) que mantiene el estado de cada Job.
- **Almacen_Configuracion**: El componente `storage/config_store.py` que persiste el modelo `Ajustes` en disco.
- **Grupo_Subtitulo**: Una línea de subtítulo con `texto`, `inicio_s`, `fin_s` y `palabras` opcionales.
- **Caption**: El tipo de subtítulo del paquete `@remotion/captions` (`text`, `startMs`, `endMs`, `timestampMs`, `confidence`).
- **Clave_API**: La clave de API de OpenAI introducida manualmente, transitoria y nunca persistida (`openai_api_key`).
- **Motor_Render**: El valor `"ass"` o `"remotion"` que identifica el motor de render elegido.
- **ESPERANDO_ELECCION_RENDER**: El estado no terminal del Job en el que el Pipeline queda pausado esperando la elección de motor del usuario.
- **SUPPORTED_OPENAI_MODELS**: El conjunto de modelos de OpenAI admitidos (`gpt-4.1-mini`, `gpt-4.1`, `gpt-4.1-nano`, `gpt-4o-mini`).
- **Video_Final**: El artefacto de vídeo resultante que se preserva al terminar el Job.

## Requirements

### Requirement 1: Opt-in de la corrección con IA

**User Story:** Como usuario que valora la privacidad, quiero que la corrección con IA esté desactivada por defecto y solo se ejecute cuando yo la active, para conservar el carácter 100 % local del Sistema salvo que decida lo contrario.

#### Acceptance Criteria

1. THE Motor_Revision_IA SHALL tener el ajuste `revision_ia.activado` con valor por defecto `False`.
2. WHERE `revision_ia.activado` es `True` y hay una Clave_API presente, THE Pipeline SHALL ejecutar la corrección con IA después de la agrupación de palabras y antes del render.
3. WHERE `revision_ia.activado` es `False`, THE Pipeline SHALL usar el texto original de los grupos sin invocar a OpenAI.

### Requirement 2: Clave de API manual y transitoria (no persistencia)

**User Story:** Como usuario, quiero introducir mi clave de OpenAI manualmente y que nunca se guarde, para que mi credencial no quede expuesta en disco ni en logs.

#### Acceptance Criteria

1. WHEN el usuario introduce la Clave_API en la Interfaz, THE Interfaz SHALL mantener la Clave_API únicamente en el estado de React sin escribirla en `localStorage`.
2. WHEN el usuario inicia el procesado con `revision_ia.activado` en `True`, THE Interfaz SHALL enviar la Clave_API en el cuerpo de `POST /procesar` como campo transitorio `openai_api_key`.
3. THE Almacen_Configuracion SHALL persistir únicamente el modelo `Ajustes`, excluyendo la Clave_API.
4. THE Backend SHALL excluir la Clave_API de todo volcado del estado del Job (`model_dump`) y de los mensajes de log.
5. WHEN un Job alcanza un estado terminal (`COMPLETADO` o `FALLIDO`), THE Gestor_Jobs SHALL eliminar la Clave_API de la memoria.
6. WHEN `PUT /configuracion` recibe una petición, THE Backend SHALL ignorar cualquier Clave_API presente y persistir solo el modelo `Ajustes`.

### Requirement 3: Preservación de tiempos en la corrección con IA

**User Story:** Como creador de contenido, quiero que la corrección con IA solo cambie el texto y nunca los tiempos, para que la sincronización de los subtítulos con el audio se mantenga intacta.

#### Acceptance Criteria

1. WHEN el Motor_Revision_IA corrige una lista de grupos, THE Motor_Revision_IA SHALL devolver una lista con la misma cardinalidad que la lista de entrada.
2. WHEN el Motor_Revision_IA corrige una lista de grupos, THE Motor_Revision_IA SHALL conservar los valores `inicio_s`, `fin_s` y `palabras` de cada grupo sin modificarlos.
3. THE Motor_Revision_IA SHALL modificar únicamente el campo `texto` de cada Grupo_Subtitulo.
4. THE Motor_Revision_IA SHALL tratar la lista de grupos de entrada como inmutable, sin producir efectos secundarios sobre ella.

### Requirement 4: Corrección ortográfica y minúsculas

**User Story:** Como creador de contenido, quiero que la IA corrija la ortografía en español y opcionalmente ponga el texto en minúsculas, para publicar subtítulos limpios y con el estilo que prefiero.

#### Acceptance Criteria

1. WHEN el Motor_Revision_IA llama a OpenAI, THE Motor_Revision_IA SHALL solicitar corrección ortográfica en español conservando el número y el orden de las líneas.
2. WHEN el Motor_Revision_IA llama a OpenAI, THE Motor_Revision_IA SHALL solicitar la salida como un array JSON de textos con la misma cantidad de elementos que la entrada.
3. WHERE la opción `minusculas` está activada, THE Motor_Revision_IA SHALL devolver el texto corregido de cada grupo en minúscula.
4. IF el modelo devuelve texto vacío para un índice, THEN THE Motor_Revision_IA SHALL conservar el texto original de ese índice.

### Requirement 5: Degradación con gracia de la corrección con IA

**User Story:** Como usuario, quiero que un fallo o ausencia de la clave de IA no interrumpa el procesado, para obtener siempre un vídeo aunque la corrección no esté disponible.

#### Acceptance Criteria

1. IF la Clave_API está ausente o vacía, THEN THE Motor_Revision_IA SHALL devolver los grupos originales sin invocar a OpenAI.
2. IF la llamada a OpenAI falla, expira o devuelve una forma o cardinalidad inválida, THEN THE Motor_Revision_IA SHALL devolver los grupos originales.
3. IF la corrección con IA se degrada, THEN THE Pipeline SHALL continuar sin marcar el Job como `FALLIDO`.
4. WHEN el Motor_Revision_IA degrada por un error, THE Motor_Revision_IA SHALL registrar una advertencia que excluya la Clave_API.
5. WHERE `revision_ia.max_reintentos` es mayor que 0 y OpenAI responde con código 429, THE Motor_Revision_IA SHALL reintentar hasta `revision_ia.max_reintentos` veces antes de degradar.

### Requirement 6: Pausa de elección de motor de render

**User Story:** Como usuario, quiero revisar los subtítulos corregidos y elegir yo mismo el motor de render con dos botones, para decidir entre calidad visual (Remotion) y velocidad (ffmpeg) en cada Job.

#### Acceptance Criteria

1. WHEN el Pipeline termina de preparar los grupos finales de subtítulos, THE Pipeline SHALL pausar el Job en el estado `ESPERANDO_ELECCION_RENDER` sin renderizar todavía.
2. WHILE el Job está en `ESPERANDO_ELECCION_RENDER`, THE Interfaz SHALL mostrar los subtítulos corregidos en solo lectura junto con dos botones etiquetados "Editar con Remotion" y "ffmpeg".
3. WHEN el usuario pulsa un botón de motor, THE Interfaz SHALL enviar `POST /render/{id}` con el Motor_Render elegido (`"remotion"` o `"ass"`).
4. WHILE el Pipeline reporta el sub-paso de IA y el render, THE Pipeline SHALL mantener el porcentaje de progreso dentro del rango 70–90 % del paso `SUBTITULOS` de forma monótona no decreciente.

### Requirement 7: Ejecución del motor elegido sin fallback

**User Story:** Como usuario, quiero que se ejecute exactamente el motor que elegí y que un fallo se me comunique claramente, para tener control determinista sobre el render.

#### Acceptance Criteria

1. WHEN el Backend recibe `POST /render/{id}` con `motor = "ass"`, THE Backend SHALL reanudar el Pipeline ejecutando únicamente el Motor_ASS.
2. WHEN el Backend recibe `POST /render/{id}` con `motor = "remotion"`, THE Backend SHALL reanudar el Pipeline ejecutando únicamente el Motor_Remotion.
3. THE Sistema SHALL ejecutar exactamente el Motor_Render elegido por el usuario, sin que ningún ajuste persistido altere el motor efectivamente ejecutado.
4. IF el motor elegido falla, THEN THE Sistema SHALL marcar el Job como `FALLIDO` con `error = {"paso": "SUBTITULOS", "motivo": ...}` accionable, sin reintentar con el otro motor.

### Requirement 8: Validación del endpoint de elección de render

**User Story:** Como desarrollador del Sistema, quiero que el endpoint de render valide el motor y el estado del Job, para evitar reanudaciones inválidas.

#### Acceptance Criteria

1. IF `POST /render/{id}` recibe un `motor` distinto de `"ass"` o `"remotion"`, THEN THE Backend SHALL rechazar la petición con código 400.
2. IF `POST /render/{id}` se recibe para un Job que no está en `ESPERANDO_ELECCION_RENDER`, THEN THE Backend SHALL rechazar la petición con código 409.
3. WHEN el Backend acepta `POST /procesar` con el campo `openai_api_key`, THE Backend SHALL responder con código 202.

### Requirement 9: Motor de render Remotion

**User Story:** Como creador de contenido, quiero renderizar con Remotion para obtener subtítulos animados de mayor calidad, con fallos claros cuando el entorno Node no esté disponible.

#### Acceptance Criteria

1. WHEN el Motor_Remotion renderiza, THE Motor_Remotion SHALL escribir un archivo `props.json` con la ruta del vídeo de entrada, los captions y el estilo dentro del directorio de trabajo del Job.
2. WHEN el Motor_Remotion invoca el proceso Node, THE Motor_Remotion SHALL pasar los argumentos como lista mediante el Runner sin usar un shell.
3. WHEN el render con Remotion termina con éxito, THE Motor_Remotion SHALL devolver la ruta del artefacto de salida y conservar el vídeo de entrada.
4. IF Node o Chromium no están disponibles, o `renderMedia` termina con código distinto de 0, o el artefacto de salida no existe, THEN THE Motor_Remotion SHALL lanzar `RemotionError` con un mensaje accionable.

### Requirement 10: Mapeo de Grupo_Subtitulo a Caption

**User Story:** Como desarrollador del Sistema, quiero un mapeo fiel de los grupos de subtítulos a los captions de Remotion, para que los tiempos se representen correctamente en el vídeo renderizado.

#### Acceptance Criteria

1. WHEN el Motor_Remotion transforma un Grupo_Subtitulo en un Caption, THE Motor_Remotion SHALL fijar `startMs = round(inicio_s * 1000)` y `endMs = round(fin_s * 1000)`.
2. THE Motor_Remotion SHALL garantizar que cada Caption cumpla `startMs <= endMs`.
3. WHERE un Grupo_Subtitulo contiene `palabras` con timestamps, THE Motor_Remotion SHALL emitir un Caption por palabra; en caso contrario, THE Motor_Remotion SHALL emitir un Caption por grupo.

### Requirement 11: Validación de los ajustes de IA y render

**User Story:** Como usuario, quiero que el Sistema rechace ajustes de IA/render inválidos identificando el campo, para corregirlos antes de crear un Job.

#### Acceptance Criteria

1. IF `revision_ia.activado` es `True` y `revision_ia.modelo` no pertenece a SUPPORTED_OPENAI_MODELS, THEN THE Backend SHALL rechazar los ajustes identificando el campo `revision_ia.modelo` sin crear el Job.
2. IF `revision_ia.timeout_s` está fuera del rango 1.0–120.0, THEN THE Backend SHALL rechazar los ajustes identificando el campo `revision_ia.timeout_s`.
3. IF `revision_ia.max_reintentos` está fuera del rango 0–5, THEN THE Backend SHALL rechazar los ajustes identificando el campo `revision_ia.max_reintentos`.
4. IF `render.combine_tokens_ms` está fuera del rango 0–5000, THEN THE Backend SHALL rechazar los ajustes identificando el campo `render.combine_tokens_ms`.

### Requirement 12: Seguridad y divulgación de red externa

**User Story:** Como usuario consciente de la privacidad, quiero que la única salida de red sea la corrección con IA y que se me informe claramente, para saber qué datos salen del equipo.

#### Acceptance Criteria

1. WHILE `revision_ia.activado` es `True`, THE Interfaz SHALL mostrar un aviso indicando que el texto de los subtítulos se envía a OpenAI y que la Clave_API no se guarda.
2. THE Motor_Revision_IA SHALL ser el único componente que abre conexiones de red externas, dirigidas por HTTPS a `api.openai.com`.
3. THE Motor_Remotion SHALL ejecutarse localmente sin abrir conexiones de red externas.
4. WHEN el Motor_Remotion pasa datos al proceso Node, THE Motor_Remotion SHALL usar `props.json` y variables de entorno en lugar de concatenar datos en la línea de comandos.

### Requirement 13: Conservación del original y limpieza del workdir

**User Story:** Como usuario, quiero que el vídeo de entrada se conserve y los archivos temporales se limpien, para no perder datos ni acumular basura en disco.

#### Acceptance Criteria

1. THE Motor_ASS y THE Motor_Remotion SHALL escribir en un archivo de salida distinto del archivo de entrada.
2. IF el render falla, THEN THE Sistema SHALL conservar el vídeo de entrada.
3. WHEN un Job alcanza un estado terminal, THE Gestor_Jobs SHALL limpiar `props.json` y el MP4 de Remotion del directorio de trabajo, conservando el Video_Final.

### Requirement 14: Compatibilidad hacia atrás

**User Story:** Como usuario existente, quiero que el comportamiento actual no cambie cuando las nuevas capacidades están desactivadas, para no ver regresiones en mis flujos habituales.

#### Acceptance Criteria

1. WHERE `revision_ia.activado` es `False`, THE Sistema SHALL producir una salida de subtítulos idéntica al comportamiento previo a esta especificación.
2. WHERE el usuario elige el Motor_Render `"ass"`, THE Sistema SHALL producir el mismo resultado que el quemado ASS existente.
3. THE Sistema SHALL mantener el campo `openai_api_key` fuera del modelo `Ajustes` para no alterar la configuración persistida existente.

### Requirement 15: Serialización de ajustes (round-trip)

**User Story:** Como desarrollador del Sistema, quiero que los nuevos ajustes se serialicen y deserialicen de forma fiable, para que la configuración persistida no se corrompa al añadir las nuevas capacidades.

#### Acceptance Criteria

1. WHEN el Almacen_Configuracion serializa un `Ajustes` que incluye `revision_ia` y `render`, THE Almacen_Configuracion SHALL producir una representación JSON válida.
2. WHEN el Almacen_Configuracion deserializa una representación JSON previamente serializada, THE Almacen_Configuracion SHALL producir un `Ajustes` equivalente al original (propiedad de round-trip).
3. THE representación serializada de `Ajustes` SHALL excluir la Clave_API en todos los casos.
