# Documento de Requisitos

## Introducción

Esta funcionalidad define una aplicación **local** con interfaz gráfica que se ejecuta en `localhost` sobre macOS y automatiza la edición de shorts verticales hablados (formato "cabeza parlante"). El usuario selecciona varios clips de video, los ordena manualmente mediante arrastrar y soltar, ajusta subtítulos y música desde la interfaz, y obtiene un video vertical 9:16 listo para publicar.

La arquitectura es fija: un frontend Next.js (App Router) + TypeScript + Tailwind en `localhost:3000`, y un backend Python FastAPI en `localhost:8000` que envuelve un pipeline de procesamiento basado en `ffmpeg`, `auto-editor` y `faster-whisper`. No existe autenticación porque el uso es local y personal. Todo el procesamiento ocurre en la máquina local, sin claves de API ni servicios externos.

El pipeline de procesamiento ejecuta, en orden estricto: (1) unir y normalizar clips a 9:16, (2) cortar silencios, (3) transcribir con timestamps por palabra, (4) generar y quemar subtítulos animados estilo shorts, y (5) mezclar música de fondo con ducking.

## Glosario

- **Sistema**: La aplicación completa de edición de shorts verticales, compuesta por la Interfaz y el Backend.
- **Interfaz**: La aplicación frontend Next.js que se ejecuta en `localhost:3000` y con la que interactúa el usuario.
- **Backend**: La aplicación FastAPI que se ejecuta en `localhost:8000` y expone los endpoints REST.
- **Motor_de_Procesamiento**: El componente del Backend que ejecuta el pipeline de edición de video (unir, cortar silencios, transcribir, subtitular, mezclar música).
- **Verificador_de_Dependencias**: El componente del Backend que comprueba la disponibilidad de las herramientas externas al iniciar.
- **Clip**: Un archivo de video individual seleccionado por el usuario como entrada.
- **Orden_de_Clips**: La secuencia posicional (posición 1, 2, 3, ...) de los Clips definida por el usuario en la Interfaz.
- **Job**: Una ejecución del pipeline de procesamiento identificada por un identificador único.
- **Timestamp_por_Palabra**: El tiempo de inicio y fin de cada palabra transcrita, producido por faster-whisper con `word_timestamps=True`.
- **Grupo_de_Subtítulo**: Un conjunto de hasta N palabras consecutivas que se muestran juntas como una línea de subtítulo, con tiempos calculados a partir de los Timestamps_por_Palabra.
- **Archivo_ASS**: El archivo de subtítulos en formato Advanced SubStation Alpha generado por el Sistema.
- **Ducking**: La reducción automática del volumen de la música de fondo cuando hay voz presente, implementada con `sidechaincompress` de ffmpeg.
- **Resolución_Objetivo**: La resolución vertical de salida configurable, con valor por defecto 1080x1920 (9:16).
- **Cuadros_Por_Segundo_Objetivo**: La tasa de cuadros por segundo (fps) de salida configurable a la que se normalizan los Clips, con valor por defecto 30 fps.
- **Video_Final**: El archivo MP4 vertical resultante del pipeline, listo para descargar.
- **auto-editor**: Herramienta externa de línea de comandos usada para eliminar silencios.
- **faster-whisper**: Biblioteca local de transcripción de voz a texto ejecutada en CPU.
- **ffmpeg / ffprobe**: Herramientas externas de procesamiento e inspección de video/audio.

## Requisitos

### Requisito 1: Selección y adición de clips

**Historia de Usuario:** Como creador de contenido, quiero agregar varios clips de video a la aplicación, para poder componer un short a partir de ellos.

#### Criterios de Aceptación

1. CUANDO el usuario selecciona entre 1 y 50 archivos de video en la Interfaz, LA Interfaz DEBERÁ enviarlos al Backend mediante una petición multipart al endpoint `POST /clips`.
2. CUANDO el Backend recibe Clips en el endpoint `POST /clips`, EL Backend DEBERÁ almacenar cada Clip y devolver un identificador único por cada Clip recibido.
3. CUANDO el Backend devuelve los identificadores de los Clips, EL Backend DEBERÁ conservar el orden en que los Clips fueron recibidos en la petición.
4. SI el usuario selecciona un archivo cuyo formato no está entre los formatos de video soportados o cuyo tamaño excede los 500 MB por archivo, ENTONCES LA Interfaz DEBERÁ rechazar dicho archivo antes de enviarlo al Backend y mostrar un mensaje de error que identifique el archivo rechazado y el motivo del rechazo, conservando la selección de los archivos válidos.
5. SI el usuario selecciona más de 50 archivos en una misma acción, ENTONCES LA Interfaz DEBERÁ rechazar la selección y mostrar un mensaje de error que indique que el número máximo de archivos por adición es 50.
6. SI el Backend no puede almacenar uno o más Clips recibidos en el endpoint `POST /clips`, ENTONCES EL Backend DEBERÁ responder con un error que identifique los Clips no almacenados y no DEBERÁ conservar ningún almacenamiento parcial de los Clips de esa petición.
7. SI la petición multipart al endpoint `POST /clips` falla por error de red o no recibe respuesta del Backend dentro de un plazo de 60 segundos, ENTONCES LA Interfaz DEBERÁ mostrar un mensaje de error que indique que la carga no se completó y DEBERÁ conservar la selección de archivos del usuario para permitir un reintento.

### Requisito 2: Reordenamiento de clips por arrastrar y soltar

**Historia de Usuario:** Como creador de contenido, quiero reordenar los clips arrastrándolos, para definir el orden final del video.

#### Criterios de Aceptación

1. LA Interfaz DEBERÁ mostrar los Clips agregados como elementos reordenables mediante arrastrar y soltar usando dnd-kit, habilitando el reordenamiento cuando existan como mínimo 2 Clips.
2. CUANDO el usuario suelta un Clip en una posición válida distinta de su posición original, LA Interfaz DEBERÁ actualizar el Orden_de_Clips para reflejar la nueva secuencia posicional y presentar el nuevo orden en un máximo de 500 milisegundos.
3. CUANDO el usuario inicia el procesamiento, LA Interfaz DEBERÁ enviar al Backend el Orden_de_Clips vigente en ese momento.
4. EL Motor_de_Procesamiento DEBERÁ unir los Clips respetando exactamente el Orden_de_Clips recibido del usuario.
5. MIENTRAS el usuario arrastra un Clip, LA Interfaz DEBERÁ mostrar una indicación visual de la posición de destino donde se insertará el Clip.
6. SI el usuario suelta un Clip fuera del área válida de reordenamiento o cancela el arrastre, ENTONCES LA Interfaz DEBERÁ conservar el Orden_de_Clips previo sin modificaciones e indicar que el reordenamiento no se aplicó.

### Requisito 3: Unir y normalizar clips a formato vertical

**Historia de Usuario:** Como creador de contenido, quiero que mis clips con distinta resolución, fps u orientación se unan sin deformarse, para obtener un video vertical uniforme.

#### Criterios de Aceptación

1. CUANDO el Motor_de_Procesamiento normaliza un Clip a la Resolución_Objetivo, EL Motor_de_Procesamiento DEBERÁ escalar el contenido para que quepa completo dentro de la Resolución_Objetivo conservando la relación de aspecto original sin deformar, centrar el contenido y rellenar las áreas restantes con barras negras.
2. LA Resolución_Objetivo DEBERÁ ser configurable con cada dimensión, ancho y alto, expresada como un entero entre 2 y 7680 píxeles, con valor por defecto 1080x1920.
3. CUANDO los Clips de entrada tienen resoluciones, fps u orientaciones distintas entre sí, EL Motor_de_Procesamiento DEBERÁ normalizar cada Clip tanto a la Resolución_Objetivo como a los Cuadros_Por_Segundo_Objetivo antes de concatenarlos en un único video continuo sin fallar.
4. CUANDO el Motor_de_Procesamiento concatena los Clips normalizados, EL Motor_de_Procesamiento DEBERÁ mantener el Orden_de_Clips definido por el usuario.
5. LOS Cuadros_Por_Segundo_Objetivo DEBERÁN ser configurables como un entero entre 1 y 120, con valor por defecto 30.
6. SI un Clip está corrupto, no soportado o no decodificable, ENTONCES EL Motor_de_Procesamiento DEBERÁ detener la unión, no producir salida parcial y mostrar un error que identifique el Clip que falló.

### Requisito 4: Corte de silencios

**Historia de Usuario:** Como creador de contenido, quiero eliminar las pausas de silencio del video, para lograr un ritmo dinámico típico de shorts.

#### Criterios de Aceptación

1. DONDE el corte de silencios está activado, EL Motor_de_Procesamiento DEBERÁ identificar como segmento de silencio todo intervalo cuyo nivel de audio esté por debajo del umbral de silencio durante una duración mayor o igual al margen configurado, y DEBERÁ eliminar dichos segmentos usando auto-editor.
2. EL Motor_de_Procesamiento DEBERÁ aceptar un umbral de silencio configurable entre 0% y 100%, con valor por defecto 4%, y un margen configurable entre 0 y 5 segundos, con valor por defecto 0,2 segundos.
3. DONDE el corte de silencios está desactivado, EL Motor_de_Procesamiento DEBERÁ omitir el paso de corte de silencios y conservar el video sin recortar pausas.
4. SI el umbral de silencio o el margen configurados están fuera de su rango permitido, ENTONCES EL Motor_de_Procesamiento DEBERÁ rechazar el valor, indicar un error y conservar el último valor válido.
5. SI auto-editor falla durante el corte de silencios, ENTONCES EL Motor_de_Procesamiento DEBERÁ indicar un error y conservar el video original sin recortar.

### Requisito 5: Transcripción con timestamps por palabra

**Historia de Usuario:** Como creador de contenido, quiero transcribir el audio con tiempos por palabra, para generar subtítulos sincronizados.

#### Criterios de Aceptación

1. CUANDO el Motor_de_Procesamiento transcribe el audio, EL Motor_de_Procesamiento DEBERÁ usar faster-whisper de forma local en CPU con `word_timestamps=True` para producir Timestamps_por_Palabra, donde cada palabra incluye un tiempo de inicio y un tiempo de fin expresados en segundos con precisión de milisegundos (0.001 s).
2. EL Motor_de_Procesamiento DEBERÁ aceptar un idioma de transcripción configurable, con valor por defecto español y con la opción "auto" para detección automática.
3. EL Motor_de_Procesamiento DEBERÁ aceptar un modelo de faster-whisper configurable de entre los modelos soportados por faster-whisper.
4. DONDE el idioma configurado es "auto", EL Motor_de_Procesamiento DEBERÁ detectar automáticamente el idioma del audio antes de transcribir.
5. SI el idioma configurado no es "auto" y no está entre los idiomas soportados por faster-whisper, ENTONCES EL Motor_de_Procesamiento DEBERÁ rechazar la operación antes de iniciar la transcripción, indicar un error que señale que el idioma no es válido, y no producir Timestamps_por_Palabra.
6. SI el modelo de faster-whisper configurado no está entre los modelos soportados, ENTONCES EL Motor_de_Procesamiento DEBERÁ rechazar la operación antes de iniciar la transcripción, indicar un error que señale que el modelo no es válido, y no producir Timestamps_por_Palabra.
7. SI la transcripción del audio falla porque el audio es ilegible, está corrupto o no contiene voz reconocible, ENTONCES EL Motor_de_Procesamiento DEBERÁ finalizar la operación indicando un error que señale la causa del fallo y no producir Timestamps_por_Palabra parciales.

### Requisito 6: Agrupación de palabras en subtítulos

**Historia de Usuario:** Como creador de contenido, quiero que los subtítulos se muestren en grupos cortos de palabras, para que sean legibles en móvil.

#### Criterios de Aceptación

1. CUANDO el Motor_de_Procesamiento genera los subtítulos, EL Motor_de_Procesamiento DEBERÁ agrupar las palabras transcritas en Grupos_de_Subtítulo cuyo tamaño no exceda un máximo configurable entre 1 y 10 palabras, con valor por defecto 4.
2. SI el valor máximo configurado es menor que 1 o mayor que 10, ENTONCES EL Motor_de_Procesamiento DEBERÁ usar el valor por defecto de 4 palabras y presentar una indicación que señale que la configuración es inválida.
3. CUANDO el número de palabras restantes de la transcripción es menor que el máximo configurado, EL Motor_de_Procesamiento DEBERÁ crear un Grupo_de_Subtítulo con las palabras restantes.
4. CUANDO el Motor_de_Procesamiento crea un Grupo_de_Subtítulo, EL Motor_de_Procesamiento DEBERÁ establecer el tiempo de inicio del grupo igual al Timestamp_por_Palabra de inicio de la primera palabra del grupo y el tiempo de fin igual al Timestamp_por_Palabra de fin de la última palabra del grupo.
5. SI una palabra que compone un Grupo_de_Subtítulo carece de un Timestamp_por_Palabra válido, ENTONCES EL Motor_de_Procesamiento DEBERÁ presentar una indicación que señale la ausencia del timestamp y no generar tiempos de inicio o fin inválidos para ese grupo.

### Requisito 7: Generación y quemado de subtítulos animados

**Historia de Usuario:** Como creador de contenido, quiero subtítulos animados estilo shorts quemados en el video, para captar la atención del espectador.

#### Criterios de Aceptación

1. CUANDO el Motor_de_Procesamiento genera los subtítulos, EL Motor_de_Procesamiento DEBERÁ producir un Archivo_ASS que contenga los Grupos_de_Subtítulo con sus tiempos.
2. CUANDO el Motor_de_Procesamiento dispone del Archivo_ASS, EL Motor_de_Procesamiento DEBERÁ quemar los subtítulos en el video usando ffmpeg.
3. EL Motor_de_Procesamiento DEBERÁ aplicar a cada Grupo_de_Subtítulo una animación de entrada de deslizamiento hacia arriba (slide-up) y una animación de salida de desvanecimiento (fade), con duraciones configurables entre 100 y 2000 milisegundos, con valor por defecto 300 milisegundos cada una.
4. CUANDO el Motor_de_Procesamiento escribe cada línea del Archivo_ASS, EL Motor_de_Procesamiento DEBERÁ incluir un override de línea con la forma `{\anN\move(...)\fad(entrada,salida)}` donde la coordenada Y inicial es igual a la coordenada Y final más el valor de píxeles de deslizamiento configurado, siendo los píxeles de deslizamiento configurables entre 1 y 500 con valor por defecto 50.
5. EL Motor_de_Procesamiento DEBERÁ aceptar una posición vertical de subtítulo configurable con valores superior, centro o inferior.
6. EL Motor_de_Procesamiento DEBERÁ aceptar una posición horizontal de subtítulo configurable con valores izquierda, centro o derecha.
7. EL Motor_de_Procesamiento DEBERÁ aceptar márgenes de subtítulo configurables entre 0 y 500 píxeles.
8. EL Motor_de_Procesamiento DEBERÁ aceptar un estilo de subtítulo configurable que incluya fuente, tamaño entre 12 y 200 puntos, color, color de borde, grosor de borde entre 0 y 20 píxeles y negrita activada o desactivada.
9. DONDE el usuario no especifica valores de estilo, EL Motor_de_Procesamiento DEBERÁ aplicar valores por defecto orientados a móvil con tamaño de fuente 72 y grosor de borde entre 4 y 5 píxeles.
10. SI ffmpeg falla al quemar los subtítulos devolviendo un código de salida distinto de cero o sin producir un archivo de salida, ENTONCES EL Motor_de_Procesamiento DEBERÁ conservar el video original y mostrar un error.
11. SI algún valor enumerado o numérico de la configuración de subtítulos está fuera de su conjunto o rango permitido, ENTONCES EL Motor_de_Procesamiento DEBERÁ rechazar la configuración e indicar un error.

### Requisito 8: Música de fondo con ducking

**Historia de Usuario:** Como creador de contenido, quiero añadir música de fondo que baje de volumen cuando hablo, para que la voz se escuche con claridad.

#### Criterios de Aceptación

1. CUANDO el usuario selecciona un archivo WAV de música en la Interfaz, LA Interfaz DEBERÁ enviarlo al Backend mediante el endpoint `POST /musica`.
2. SI el archivo de música recibido no es un WAV válido o supera los 100 MB, ENTONCES EL Backend DEBERÁ rechazar el archivo y conservar el audio y el video originales sin modificar.
3. DONDE se ha proporcionado un archivo WAV de música válido, EL Motor_de_Procesamiento DEBERÁ mezclar la música con el audio del video aplicando Ducking mediante `sidechaincompress` de ffmpeg.
4. EL Motor_de_Procesamiento DEBERÁ aceptar un volumen base de música configurable entre 0% y 100%, con valor por defecto 30%.
5. MIENTRAS hay voz presente en el audio con un nivel superior a -30 dBFS, EL Motor_de_Procesamiento DEBERÁ reducir el volumen de la música de fondo al menos 12 decibelios respecto de su volumen base, con un tiempo de ataque máximo de 250 milisegundos.
6. CUANDO el nivel de voz cae por debajo del umbral de -30 dBFS, EL Motor_de_Procesamiento DEBERÁ restaurar el volumen base de la música con un tiempo de liberación máximo de 500 milisegundos.
7. SI `sidechaincompress` falla durante la mezcla, ENTONCES EL Motor_de_Procesamiento DEBERÁ indicar un error.

### Requisito 9: Configuración de ajustes desde la interfaz

**Historia de Usuario:** Como creador de contenido, quiero controlar todos los ajustes desde la interfaz, para personalizar el resultado sin editar código.

#### Criterios de Aceptación

1. LA Interfaz DEBERÁ permitir configurar los ajustes de subtítulos dentro de rangos validados: posición vertical (0 % a 100 % de la altura del video), posición horizontal (0 % a 100 % del ancho del video), márgenes (0 a 500 píxeles), fuente (seleccionada de la lista de fuentes disponibles), tamaño (8 a 200 píxeles), color y color de borde (seleccionados mediante selector de color), grosor de borde (0 a 50 píxeles), negrita (activada o desactivada), máximo de palabras por subtítulo (1 a 20), duración de la animación de entrada (0 a 5000 milisegundos), duración de la animación de salida (0 a 5000 milisegundos) y píxeles de deslizamiento (0 a 500 píxeles).
2. LA Interfaz DEBERÁ permitir configurar el umbral de silencio (-60 a 0 decibelios), el margen de silencio (0 a 5000 milisegundos) y la activación o desactivación del corte de silencios.
3. LA Interfaz DEBERÁ permitir configurar el idioma de transcripción, el modelo de faster-whisper y la Resolución_Objetivo, cada uno seleccionado de su respectiva lista de valores admitidos.
4. LA Interfaz DEBERÁ permitir seleccionar el archivo WAV de música y ajustar su volumen base (0 % a 100 %).
5. CUANDO el usuario inicia el procesamiento y todos los ajustes están dentro de los rangos válidos, LA Interfaz DEBERÁ enviar al Backend el Orden_de_Clips junto con todos los ajustes configurados mediante el endpoint `POST /procesar`.
6. SI algún ajuste está fuera del rango permitido o tiene un valor inválido cuando el usuario inicia el procesamiento, ENTONCES LA Interfaz DEBERÁ rechazar el envío, mostrar un mensaje de error indicando el campo inválido y conservar los ajustes previamente configurados sin iniciar el procesamiento.
7. SI el archivo de música seleccionado no tiene formato WAV, ENTONCES LA Interfaz DEBERÁ rechazar la selección y mostrar un mensaje de error indicando el formato requerido.
8. SI el envío mediante el endpoint `POST /procesar` falla, ENTONCES LA Interfaz DEBERÁ mostrar un mensaje de error indicando el fallo del envío y conservar los ajustes configurados sin iniciar el procesamiento.

### Requisito 10: Inicio del procesamiento y seguimiento de progreso

**Historia de Usuario:** Como creador de contenido, quiero ver el progreso por cada paso del pipeline, para saber en qué etapa se encuentra el procesamiento.

#### Criterios de Aceptación

1. CUANDO el Backend recibe una petición válida en `POST /procesar` que contiene un Orden_de_Clips con entre 1 y 500 clips y los ajustes requeridos, EL Backend DEBERÁ iniciar un Job y devolver, en un máximo de 2 segundos, un identificador único de Job.
2. SI el Backend recibe una petición en `POST /procesar` sin Orden_de_Clips, con un Orden_de_Clips vacío, con más de 500 clips o sin los ajustes requeridos, ENTONCES EL Backend DEBERÁ rechazar la petición sin iniciar un Job y devolver un mensaje de error que indique el motivo del rechazo.
3. CUANDO el usuario consulta el endpoint `GET /progreso/{id}` con un identificador de Job existente, EL Backend DEBERÁ devolver, en un máximo de 2 segundos, el estado del Job (en cola, en ejecución, completado o fallido) y el porcentaje de progreso (0 a 100) junto con el paso del pipeline en curso.
4. SI el usuario consulta el endpoint `GET /progreso/{id}` con un identificador de Job inexistente, ENTONCES EL Backend DEBERÁ devolver un mensaje de error que indique que el Job no existe, sin modificar ningún estado.
5. CUANDO el Motor_de_Procesamiento avanza de un paso del pipeline al siguiente, EL Backend DEBERÁ actualizar, en un máximo de 1 segundo, el estado de progreso del Job para reflejar el paso en curso.
6. MIENTRAS un Job está en ejecución, LA Interfaz DEBERÁ mostrar un indicador de progreso que identifique el paso actual del pipeline y el porcentaje de avance (0 a 100), actualizándose al menos cada 5 segundos mediante SSE o sondeo (polling).
7. SI un paso del pipeline falla durante la ejecución de un Job, ENTONCES EL Backend DEBERÁ marcar el Job como fallido, detener el procesamiento de los pasos restantes e incluir en la respuesta de progreso un mensaje de error que indique el paso que falló y el motivo del fallo.

### Requisito 11: Previsualización y descarga del video final

**Historia de Usuario:** Como creador de contenido, quiero previsualizar y descargar el video terminado, para revisarlo y publicarlo.

#### Criterios de Aceptación

1. CUANDO un Job finaliza correctamente, LA Interfaz DEBERÁ mostrar una previsualización reproducible del Video_Final en un máximo de 3 segundos.
2. CUANDO el usuario solicita el endpoint `GET /descargar/{id}` para un Job finalizado correctamente, EL Backend DEBERÁ iniciar la transferencia del archivo MP4 del Video_Final en un máximo de 2 segundos.
3. SI el usuario solicita la descarga de un Job que no ha finalizado correctamente, ENTONCES EL Backend DEBERÁ rechazar la solicitud, no devolver ningún archivo y devolver un error que indique que el Video_Final no está disponible.
4. SI el usuario solicita el endpoint `GET /descargar/{id}` con un identificador que no corresponde a ningún Job existente, ENTONCES EL Backend DEBERÁ rechazar la solicitud y devolver un error que indique que el Job no existe.
5. SI la previsualización del Video_Final no puede cargarse, ENTONCES LA Interfaz DEBERÁ mostrar un mensaje de error que indique que la previsualización no está disponible y ofrecer al usuario la opción de descargar el Video_Final.

### Requisito 12: Verificación de dependencias al iniciar

**Historia de Usuario:** Como usuario, quiero que la aplicación verifique las herramientas necesarias al arrancar, para recibir un error claro si falta alguna.

#### Criterios de Aceptación

1. CUANDO el Backend se inicia, EL Verificador_de_Dependencias DEBERÁ comprobar, en un plazo máximo de 10 segundos, la disponibilidad de ffmpeg, ffprobe, auto-editor y faster-whisper.
2. SI una o más de las dependencias ffmpeg, ffprobe, auto-editor o faster-whisper no están disponibles al iniciar, ENTONCES EL Verificador_de_Dependencias DEBERÁ registrar un mensaje de error que identifique por su nombre cada una de las dependencias faltantes.
3. SI la comprobación de disponibilidad de una dependencia no finaliza dentro del plazo de 10 segundos, ENTONCES EL Verificador_de_Dependencias DEBERÁ tratar esa dependencia como no disponible y registrar un mensaje de error que la identifique como no verificable.
4. SI al menos una dependencia no está disponible tras finalizar la verificación, ENTONCES EL Verificador_de_Dependencias DEBERÁ impedir que el Backend complete su arranque y DEBERÁ indicar el fallo de inicialización.
5. CUANDO todas las dependencias (ffmpeg, ffprobe, auto-editor y faster-whisper) están disponibles tras la verificación, EL Verificador_de_Dependencias DEBERÁ permitir que el Backend continúe su proceso de inicio.

### Requisito 13: Operación local y gestión de archivos temporales

**Historia de Usuario:** Como usuario, quiero que todo se ejecute localmente y que los archivos temporales se limpien, para no depender de servicios externos ni acumular basura en disco.

#### Criterios de Aceptación

1. EL Sistema DEBERÁ ejecutar todo el procesamiento de forma local en macOS sin establecer ninguna conexión de red saliente hacia servicios externos y sin requerir claves de API.
2. SI un componente intenta establecer una conexión de red saliente hacia un servicio externo, ENTONCES EL Sistema DEBERÁ bloquear la operación y registrar una indicación de error que identifique el intento, sin interrumpir el Job en curso.
3. CUANDO el Motor_de_Procesamiento inicia un Job, EL Motor_de_Procesamiento DEBERÁ crear todos los archivos temporales dentro del directorio de trabajo asignado a ese Job.
4. CUANDO un Job finaliza correctamente, EL Motor_de_Procesamiento DEBERÁ eliminar, en un plazo máximo de 5 segundos tras la finalización, todos los archivos temporales creados durante ese Job.
5. CUANDO un Job termina por error o es cancelado, EL Motor_de_Procesamiento DEBERÁ eliminar, en un plazo máximo de 5 segundos tras la terminación, todos los archivos temporales creados durante ese Job.
6. SI la eliminación de un archivo temporal falla, ENTONCES EL Motor_de_Procesamiento DEBERÁ reintentar la eliminación hasta 3 veces y, si el fallo persiste, registrar una indicación de error que identifique el archivo afectado sin interrumpir el procesamiento de otros Jobs.
7. EL Backend DEBERÁ operar sin requerir autenticación.

### Requisito 14: Instrucciones de arranque del proyecto

**Historia de Usuario:** Como usuario, quiero instrucciones y scripts para levantar el proyecto, para poder ejecutarlo fácilmente en mi Mac.

#### Criterios de Aceptación

1. EL Sistema DEBERÁ incluir un archivo README en la raíz del proyecto que contenga una sección de instalación en macOS con los tres pasos ordenados: (a) instalación de ffmpeg mediante `brew install ffmpeg`, (b) creación de un entorno virtual e instalación de dependencias de Python mediante pip a partir de `requirements.txt`, y (c) instalación de dependencias del frontend mediante `npm install`.
2. EL Sistema DEBERÁ incluir instrucciones o scripts documentados en el README que permitan levantar el Backend en `localhost:8000` y la Interfaz en `localhost:3000`.
3. CUANDO se ejecuten las instrucciones o scripts de arranque en un entorno macOS con las dependencias ya instaladas, EL Sistema DEBERÁ dejar el Backend accesible en `localhost:8000` y la Interfaz accesible en `localhost:3000` en un plazo máximo de 60 segundos.
4. SI el puerto 8000 o el puerto 3000 ya está en uso al ejecutar el arranque, ENTONCES EL Sistema DEBERÁ finalizar el arranque del componente afectado y mostrar un mensaje de error que indique el conflicto de puerto, sin dejar procesos parciales activos.
5. EL Sistema DEBERÁ incluir en la raíz del proyecto un archivo `requirements.txt` que declare, como mínimo, las dependencias fastapi, uvicorn, auto-editor, faster-whisper y python-multipart.
6. EL Sistema DEBERÁ incluir un archivo `package.json` del frontend que declare, como mínimo, las dependencias necesarias para ejecutar la Interfaz.
