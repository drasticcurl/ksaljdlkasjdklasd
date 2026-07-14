# Documento de Requisitos: Edición Avanzada de Shorts

> Feature: `edicion-avanzada-shorts` · Tipo: `feature` · Flujo: `design-first`
>
> **Convención obligatoria del proyecto:** todo el documento, las historias de usuario y los criterios de aceptación están en **ESPAÑOL**. Los criterios siguen el formato **EARS** (CUANDO/SI … ENTONCES el sistema DEBERÁ …).

## Introducción

Esta feature amplía el editor de "shorts" verticales con cuatro capacidades de edición manual, derivadas del diseño técnico ya aprobado (`design.md`) y coherentes con él:

1. **Timeline de cortes de silencio** (estilo CapCut web) **antes** de transcribir: el pipeline detecta silencios, pausa en `ESPERANDO_EDICION_SILENCIOS` y permite al usuario ajustar con precisión los tramos a borrar sobre el vídeo unido; al confirmar se reconstruye el vídeo cortado y continúa a transcribir.
2. **Revisión de subtítulos (solo texto)**: tras el subtitulado automático, el pipeline pausa en `ESPERANDO_REVISION` mostrando el texto de los grupos para que el usuario confirme, con corrección ligera de texto (sin editar tiempos ni dividir/unir grupos).
3. **Textos extra tipo "hook"** en la etapa final `ESPERANDO_EDICION_FINAL`: hasta 2 overlays de texto plano sin animación, con rango temporal (in/out) y estilo independiente de los subtítulos, previsualizados en vivo sobre el vídeo real.
4. **Render siempre con Remotion**: se elimina la elección de motor de la interfaz; el código ffmpeg permanece en el repositorio pero no se elige ni se usa en este flujo.

El alcance incluye además la persistencia de la clave de OpenAI en `localStorage`, la extensión aditiva y retrocompatible del contrato Remotion (`ShortVideoProps`), contratos de API con errores homogéneos, validaciones, y requisitos no funcionales (convención en español, reutilización de la infraestructura del PR #19, orden del flujo, manejo de pausas/reanudación sin perder el workdir, monotonía del progreso y verificación por Property-Based Testing).

El diseño es **aditivo y retrocompatible**: no rompe artefactos existentes y reutiliza funciones puras e infraestructura de previsualización ya entregadas.

## Glosario

- **Sistema**: el editor de shorts en su conjunto (backend FastAPI + frontend Next.js + composición Remotion).
- **Pipeline**: componente de orquestación del backend que ejecuta las etapas del Job y gestiona sus estados y pausas.
- **Backend**: capa de API FastAPI que expone los endpoints y valida las peticiones.
- **Frontend**: aplicación Next.js con la que interactúa el usuario en el navegador.
- **Timeline_de_Silencios**: componente del frontend que muestra los tramos de silencio sobre una línea de tiempo del vídeo unido y permite editarlos.
- **Panel_de_Textos_Extra**: componente del frontend para agregar y gestionar hasta 2 textos extra en la etapa final.
- **Panel_de_Clave_OpenAI**: componente del frontend para introducir, persistir y olvidar la clave de OpenAI.
- **Composicion_Remotion**: composición de vídeo Remotion (dos copias sincronizadas: `remotion/src/` para SSR y `frontend/components/remotion/` para navegador) que renderiza el vídeo con subtítulos y textos extra.
- **Validador**: lógica del backend que valida tramos de silencio y textos extra (`validar_tramos_silencio`, `validar_texto_extra`).
- **JobManager**: gestor de estado del Job (progreso, pausas, campos persistidos y workdir).
- **Vídeo unido**: vídeo resultante de unir los clips de entrada, previo al corte de silencios (`unido.mp4`).
- **Vídeo cortado**: vídeo reconstruido tras aplicar los tramos a borrar confirmados por el usuario (`cortado.mp4`); es la entrada de la transcripción.
- **Tramo de silencio**: intervalo `[inicio_s, fin_s]` marcado para BORRAR del vídeo unido.
- **Segmentos a conservar**: complemento de los tramos a borrar dentro de `[0, duración]`; define lo que permanece en el vídeo cortado.
- **Texto extra**: overlay de texto plano sin animación aplicado al vídeo final, con punto de entrada/salida (in/out) en segundos y estilo independiente.
- **Grupo de subtítulo**: unidad de subtítulo con `texto`, `inicio_s`, `fin_s` y opcionalmente palabras; en la revisión solo se corrige el `texto`.
- **Pausa / Reanudación**: estado en el que el Pipeline se detiene esperando una acción del usuario (`ESPERANDO_*`) y su posterior continuación al recibir la confirmación correspondiente.
- **Estilo independiente**: conjunto de controles de estilo del texto extra (fuente, tamaño, color, color de borde, grosor de borde, negrita, posición vertical %, posición horizontal %) separado del estilo de los subtítulos.
- **PBT**: Property-Based Testing (hypothesis en backend, fast-check en frontend).

## Requisitos

### Requisito 1: Detección de silencios y pausa para edición

**Historia de usuario:** Como editor de shorts, quiero que el sistema detecte los silencios tras unir los clips y pause antes de transcribir, para poder ajustar manualmente los cortes con precisión.

#### Criterios de Aceptación

1. CUANDO el Pipeline termina la etapa de UNIR Y la opción de silencios está activada, EL Pipeline DEBERÁ detectar los tramos de silencio sobre el vídeo unido sin recortarlo, produciendo una lista de tramos `{inicio, fin}` en segundos donde cada tramo cumple `0 <= inicio < fin <= duración_total`, ordenada de forma ascendente por `inicio` y sin solapamientos (los tramos solapados o adyacentes se fusionan en uno solo).
2. CUANDO el Pipeline termina de detectar los tramos de silencio, EL Pipeline DEBERÁ transicionar el Job al estado `ESPERANDO_EDICION_SILENCIOS` y detener la ejecución del pipeline hasta recibir una confirmación válida mediante `POST /silencios/{job_id}`.
3. CUANDO el Pipeline entra en el estado `ESPERANDO_EDICION_SILENCIOS`, EL JobManager DEBERÁ persistir la ruta del vídeo unido, la lista de tramos de silencio detectados y la duración total del vídeo unido en segundos.
4. SI la detección no encuentra ningún tramo de silencio, ENTONCES EL Pipeline DEBERÁ igualmente transicionar el Job al estado `ESPERANDO_EDICION_SILENCIOS` con una lista de tramos vacía.
5. DONDE la opción de silencios esté desactivada, EL Pipeline DEBERÁ continuar directamente a la etapa de TRANSCRIBIR usando el vídeo unido, sin entrar en el estado `ESPERANDO_EDICION_SILENCIOS`.

### Requisito 2: Visualización del timeline de silencios sobre el vídeo unido

**Historia de usuario:** Como editor de shorts, quiero ver los tramos de silencio detectados sobre una línea de tiempo del vídeo unido, para entender qué partes se van a borrar.

#### Criterios de Aceptación

1. CUANDO el Frontend solicita `GET /silencios/{job_id}` para un Job existente, EL Backend DEBERÁ responder `200` con la lista de tramos de silencio (ordenada ascendentemente por `inicio` y sin solapamientos), la duración total del vídeo unido en segundos, la URL HTTP del vídeo unido y los parámetros de vídeo `fps`, `ancho` y `alto` como enteros positivos.
2. SI el Frontend solicita `GET /silencios/{job_id}` con un `job_id` inexistente, ENTONCES EL Backend DEBERÁ responder `404` con el código de error `JOB_NOT_FOUND`.
3. MIENTRAS el Job está en estado `ESPERANDO_EDICION_SILENCIOS`, EL Backend DEBERÁ indicar `editable = true` en la respuesta de `GET /silencios/{job_id}`.
4. MIENTRAS el Job no está en estado `ESPERANDO_EDICION_SILENCIOS`, EL Backend DEBERÁ indicar `editable = false` en la respuesta de `GET /silencios/{job_id}`.
5. CUANDO el Timeline_de_Silencios recibe los datos, EL Timeline_de_Silencios DEBERÁ representar cada tramo como un bloque cuya anchura relativa sea igual a `(fin - inicio) / duración_total` respecto del ancho total de la línea de tiempo.
6. CUANDO el Frontend solicita el vídeo unido mediante la URL devuelta, EL Backend DEBERÁ responder `200` sirviendo el artefacto de vídeo por HTTP.

### Requisito 3: Edición manual de los tramos de silencio

**Historia de usuario:** Como editor de shorts, quiero mover, estirar, achicar, añadir y eliminar tramos de silencio, para lograr la máxima precisión en los cortes.

#### Criterios de Aceptación

1. CUANDO el usuario arrastra un bloque completo, EL Timeline_de_Silencios DEBERÁ actualizar `inicio` y `fin` del tramo conservando su duración (`fin - inicio`) constante y recortar (clamp) la posición a `[0, duración]` cuando el arrastre exceda los límites.
2. CUANDO el usuario arrastra el borde inicial o final de un bloque, EL Timeline_de_Silencios DEBERÁ modificar respectivamente `inicio` o `fin`, manteniendo siempre `inicio < fin`.
3. CUANDO el usuario añade un tramo, EL Timeline_de_Silencios DEBERÁ crearlo con `0 <= inicio < fin <= duración`.
4. CUANDO el usuario elimina un tramo, EL Timeline_de_Silencios DEBERÁ quitarlo de la lista sin alterar los demás tramos.
5. MIENTRAS el usuario edita cualquier tramo, EL Timeline_de_Silencios DEBERÁ mantener `inicio` y `fin` dentro de `[0, duración]` y descartar los tramos cuya duración resultante sea `<= 0`.
6. CUANDO dos o más tramos quedan solapados o adyacentes tras una edición, EL Timeline_de_Silencios DEBERÁ fusionarlos en un único tramo y mantener la lista ordenada ascendentemente por `inicio`.

### Requisito 4: Previsualización en vivo del vídeo unido (opcional)

**Historia de usuario:** Como editor de shorts, quiero previsualizar fotogramas del vídeo unido mientras ajusto los tramos, para verificar visualmente los puntos de corte.

#### Criterios de Aceptación

1. DONDE la previsualización esté disponible, EL Frontend DEBERÁ mostrar el fotograma del vídeo unido correspondiente a la posición temporal seleccionada dentro de `[0, duración]`.
2. DONDE la previsualización no esté disponible, EL Frontend DEBERÁ permitir editar y confirmar los tramos sin bloquear el flujo de edición.

### Requisito 5: Confirmación de silencios y reconstrucción del vídeo cortado

**Historia de usuario:** Como editor de shorts, quiero confirmar mis tramos editados y que el sistema reconstruya el vídeo recortado y continúe transcribiendo, para avanzar con mi edición aplicada.

#### Criterios de Aceptación

1. CUANDO el usuario envía `POST /silencios/{job_id}` con una lista de tramos válidos Y el Job está en estado `ESPERANDO_EDICION_SILENCIOS`, EL Backend DEBERÁ responder `202` y transicionar el Job al estado `EN_EJECUCION`; un tramo es válido si `0 <= inicio < fin <= duración`.
2. SI el usuario envía `POST /silencios/{job_id}` con un `job_id` inexistente, ENTONCES EL Backend DEBERÁ responder `404` con el código de error `JOB_NOT_FOUND` sin modificar ningún estado.
3. SI el usuario envía `POST /silencios/{job_id}` con uno o más tramos inválidos (por ejemplo `inicio >= fin`, valores fuera de `[0, duración]` o no numéricos), ENTONCES EL Backend DEBERÁ responder `400` con el código de error `INVALID_REQUEST` sin modificar el estado del Job.
4. SI el usuario envía `POST /silencios/{job_id}` cuando el Job no está en estado `ESPERANDO_EDICION_SILENCIOS`, ENTONCES EL Backend DEBERÁ responder `409` con el código de error `CONFLICT` sin reanudar el pipeline.
5. CUANDO el Pipeline reanuda, EL Pipeline DEBERÁ calcular los segmentos a conservar como complemento de los tramos confirmados dentro de `[0, duración]`, fusionando previamente los tramos solapados o adyacentes antes de calcular el complemento.
6. CUANDO el Pipeline calcula los segmentos, EL Pipeline DEBERÁ reconstruir el vídeo cortado conservando dichos segmentos en orden temporal ascendente.
7. CUANDO el vídeo cortado queda reconstruido, EL Pipeline DEBERÁ continuar a TRANSCRIBIR usando el vídeo cortado.
8. SI los tramos confirmados cubren la totalidad de `[0, duración]`, ENTONCES EL Pipeline DEBERÁ conservar el vídeo unido completo para evitar una duración cero.

### Requisito 6: Revisión de subtítulos de solo texto

**Historia de usuario:** Como editor de shorts, quiero revisar el texto de los subtítulos generados automáticamente y confirmarlos, para asegurar que el texto es correcto antes de la etapa final.

#### Criterios de Aceptación

1. CUANDO el Pipeline termina de generar los subtítulos automáticos, EL Pipeline DEBERÁ transicionar el Job al estado `ESPERANDO_REVISION` y detener el procesamiento hasta recibir una confirmación válida mediante `POST /subtitulos/{job_id}`.
2. CUANDO el Frontend solicita `GET /subtitulos/{job_id}` y el Job está en `ESPERANDO_REVISION`, EL Backend DEBERÁ devolver la lista de grupos, incluyendo para cada grupo su texto y sus tiempos de inicio y fin, e indicar `editable = true`.
3. MIENTRAS el Job está en `ESPERANDO_REVISION`, EL Frontend DEBERÁ mostrar el texto de cada grupo y permitir únicamente la edición del texto, sin exponer ningún control para editar tiempos, dividir o unir grupos.
4. MIENTRAS el Job está en `ESPERANDO_REVISION`, EL Backend DEBERÁ conservar sin modificar el número de grupos y los tiempos de inicio y fin de cada grupo.
5. SI el Frontend solicita `GET /subtitulos/{job_id}` y el Job no está en `ESPERANDO_REVISION`, ENTONCES EL Backend DEBERÁ indicar `editable = false` y no exponer los grupos como editables.

### Requisito 7: Corrección ligera de texto y confirmación de subtítulos

**Historia de usuario:** Como editor de shorts, quiero corregir ligeramente el texto de los grupos y confirmar, para avanzar hacia la etapa final con subtítulos correctos.

#### Criterios de Aceptación

1. CUANDO el usuario envía `POST /subtitulos/{job_id}` con exactamente el mismo número de grupos que la propuesta y con el texto de cada grupo no vacío tras aplicar trim, y el Job está en `ESPERANDO_REVISION`, EL Backend DEBERÁ responder `202`, persistir el texto confirmado y reanudar el Pipeline hacia la etapa final.
2. SI la cantidad de grupos recibidos difiere del número de grupos de la propuesta, ENTONCES EL Backend DEBERÁ rechazar la solicitud con `400 INVALID_REQUEST` sin modificar el estado del Job.
3. SI el texto de al menos un grupo queda vacío (longitud 0) tras aplicar trim de espacios en blanco, ENTONCES EL Backend DEBERÁ rechazar la solicitud con `400 INVALID_REQUEST` sin modificar el estado del Job.
4. EL Backend DEBERÁ conservar los tiempos por palabra de la transcripción original sin recalcular el karaoke al aplicar el texto corregido.
5. SI el usuario envía `POST /subtitulos/{job_id}` y el Job no está en `ESPERANDO_REVISION`, ENTONCES EL Backend DEBERÁ responder `409 CONFLICT` sin modificar el texto ni el estado del Job.

### Requisito 8: Pantalla de edición final con previsualización en vivo

**Historia de usuario:** Como editor de shorts, quiero ver el vídeo real con subtítulos en la etapa final y previsualizar mis cambios en vivo, para editar sobre el resultado producido.

#### Criterios de Aceptación

1. CUANDO el Pipeline termina de preparar los grupos finales, EL Pipeline DEBERÁ transicionar el Job al estado `ESPERANDO_EDICION_FINAL` y detener el procesamiento hasta recibir una confirmación válida mediante `POST /render/{job_id}`.
2. CUANDO el Frontend solicita `GET /render/{job_id}` y el Job está en `ESPERANDO_EDICION_FINAL`, EL Backend DEBERÁ devolver la lista de textos extra actuales (lista vacía si no hay ninguno) y los datos del vídeo cortado (al menos duración total, ancho y alto en píxeles), e indicar `editable = true`.
3. MIENTRAS el Job está en `ESPERANDO_EDICION_FINAL`, EL Frontend DEBERÁ mostrar una previsualización en vivo del vídeo cortado con los subtítulos confirmados mediante @remotion/player.
4. CUANDO el usuario modifica el texto, el inicio (in) o el fin (out) de un texto extra, EL Frontend DEBERÁ actualizar la previsualización de modo que dicho texto sea visible únicamente en el intervalo [in, out) y quede oculto fuera de él.

### Requisito 9: Gestión de textos extra tipo "hook"

**Historia de usuario:** Como editor de shorts, quiero agregar hasta dos textos extra con su rango temporal y estilo independiente, para destacar mensajes tipo "hook".

#### Criterios de Aceptación

1. CUANDO el usuario pulsa "Agregar texto" y el número de textos extra existentes es menor que 2, EL Frontend DEBERÁ añadir un nuevo texto extra editable e incrementar el conteo en 1.
2. SI ya existen 2 textos extra, ENTONCES EL Frontend DEBERÁ deshabilitar la acción "Agregar texto" e impedir añadir un tercero.
3. CUANDO el usuario configura el rango temporal de un texto extra, EL Frontend DEBERÁ permitir definir in y out en segundos, con in ≥ 0, out ≤ duración total del vídeo cortado e in < out.
4. CUANDO el usuario configura el estilo de un texto extra, EL Frontend DEBERÁ permitir definir fuente, tamaño, color de relleno, color de borde, grosor de borde, negrita (activada o desactivada) y posición vertical y horizontal expresadas en porcentaje de 0 a 100, de forma independiente del estilo de los subtítulos.
5. EL Frontend DEBERÁ representar cada texto extra como texto plano sin ninguna animación de entrada, salida ni transición.
6. SI el usuario define un in/out inválido (in < 0, out > duración total del vídeo cortado, o in ≥ out), ENTONCES EL Frontend DEBERÁ impedir confirmar dicho texto extra e indicar el error.

### Requisito 10: Aplicación de textos extra al vídeo final

**Historia de usuario:** Como editor de shorts, quiero confirmar la edición final y que mis textos extra se apliquen al render, para obtener el vídeo definitivo con los overlays.

#### Criterios de Aceptación

1. CUANDO el usuario envía `POST /render/{job_id}` con como máximo 2 textos extra, cada uno con in/out válidos (0 ≤ in < out ≤ duración total del vídeo cortado), y el Job está en `ESPERANDO_EDICION_FINAL`, EL Backend DEBERÁ responder `202`, persistir los textos extra y reanudar el render.
2. CUANDO el Pipeline construye las props del render, EL Pipeline DEBERÁ incluir los textos extra persistidos, con su texto, in, out y estilo, en el contrato de la Composicion_Remotion.
3. MIENTRAS el tiempo de reproducción está dentro del intervalo [in, out) de un texto extra, LA Composicion_Remotion DEBERÁ mostrar ese texto con su estilo configurado.
4. MIENTRAS el tiempo de reproducción está fuera del intervalo [in, out) de un texto extra, LA Composicion_Remotion DEBERÁ ocultar ese texto.
5. SI el usuario envía `POST /render/{job_id}` con más de 2 textos extra o con algún texto de in/out inválido, ENTONCES EL Backend DEBERÁ rechazar la solicitud con `400 INVALID_REQUEST` sin modificar el estado del Job.

### Requisito 11: Render siempre con Remotion

**Historia de usuario:** Como usuario del editor, quiero que el render final use siempre Remotion sin tener que elegir motor, para simplificar el flujo y obtener un resultado consistente.

#### Criterios de Aceptación

1. EL Frontend DEBERÁ omitir cualquier control de elección de motor en la edición final.
2. CUANDO el Backend reanuda el render, EL Backend DEBERÁ usar Remotion como motor.
3. DONDE la petición `POST /render/{job_id}` incluya el campo `motor`, EL Backend DEBERÁ aceptar únicamente el valor exacto `"remotion"` (comparación sensible a mayúsculas).
4. DONDE la petición omita el campo `motor`, EL Backend DEBERÁ usar `"remotion"` por defecto.
5. SI la petición incluye un `motor` distinto de `"remotion"`, ENTONCES EL Backend DEBERÁ rechazar con `400 INVALID_REQUEST` sin modificar el estado del Job.
6. SI el render Remotion falla, ENTONCES EL Pipeline DEBERÁ marcar el Job como `FALLIDO` con un motivo accionable, sin recurrir a un motor alternativo.

### Requisito 12: Persistencia de la clave de OpenAI en localStorage

**Historia de usuario:** Como usuario del editor, quiero que mi clave de OpenAI se recuerde en el navegador, para no tener que reintroducirla en cada sesión.

#### Criterios de Aceptación

1. CUANDO el usuario introduce una clave de OpenAI, EL Panel_de_Clave_OpenAI DEBERÁ almacenarla en el `localStorage` del navegador.
2. CUANDO el Frontend se monta, EL Frontend DEBERÁ precargar la clave desde `localStorage` si existe.
3. CUANDO el usuario pulsa "Olvidar clave", EL Panel_de_Clave_OpenAI DEBERÁ eliminar la clave de `localStorage` y vaciar el campo.
4. MIENTRAS el Panel_de_Clave_OpenAI está visible, EL Panel_de_Clave_OpenAI DEBERÁ mostrar un aviso de seguridad visible que informe de que la clave se almacena en el navegador.
5. EL Backend DEBERÁ no registrar la clave de OpenAI en ningún log (información, error o trazas).

### Requisito 13: Extensión aditiva y retrocompatible del contrato Remotion

**Historia de usuario:** Como responsable del contrato Remotion, quiero extender `ShortVideoProps` con textos extra sin romper la compatibilidad, para preservar los renders existentes.

#### Criterios de Aceptación

1. EL contrato `ShortVideoProps` DEBERÁ incluir el campo opcional `textosExtra` sin alterar los campos existentes.
2. CUANDO el Backend construye las props sin textos extra, EL Backend DEBERÁ emitir `textosExtra` como lista vacía.
3. CUANDO un `props.json` no contiene `textosExtra`, LA Composicion_Remotion DEBERÁ renderizar con el comportamiento previo sin overlays.
4. EL Sistema DEBERÁ mantener sincronizadas las dos copias de la Composicion_Remotion (`remotion/src/` y `frontend/components/remotion/`), permitiendo como única diferencia el subcomponente de fondo de vídeo (FondoVideo).

### Requisito 14: Contratos de API y errores homogéneos

**Historia de usuario:** Como desarrollador integrador, quiero endpoints con contratos claros y errores homogéneos, para manejar de forma predecible los estados y fallos.

#### Criterios de Aceptación

1. EL Backend DEBERÁ exponer `GET/POST /silencios/{job_id}`, `GET/POST /subtitulos/{job_id}` y `GET/POST /render/{job_id}`.
2. SI se solicita con un `job_id` no registrado, ENTONCES EL Backend DEBERÁ responder `404` con código `JOB_NOT_FOUND`.
3. SI se hace POST cuando el Job no está en la pausa esperada, ENTONCES EL Backend DEBERÁ responder `409` con código `CONFLICT`.
4. SI la petición contiene datos inválidos, ENTONCES EL Backend DEBERÁ responder `400` con código `INVALID_REQUEST`.
5. EL Backend DEBERÁ devolver los errores usando la misma estructura de envoltura de error (identificador de código + mensaje) en todos los endpoints.

### Requisito 15: Validación de tramos de silencio y de textos extra

**Historia de usuario:** Como desarrollador integrador, quiero que el sistema valide los tramos y los textos extra, para prevenir datos incoherentes en el render.

#### Criterios de Aceptación

1. SI algún tramo cumple `fin_s <= inicio_s`, ENTONCES EL Validador DEBERÁ rechazar con `400 INVALID_REQUEST` indicando el tramo afectado.
2. SI algún tramo queda fuera de `[0, duración]`, ENTONCES EL Validador DEBERÁ rechazar con `400 INVALID_REQUEST` indicando el tramo afectado.
3. SI hay más de dos textos extra, ENTONCES EL Validador DEBERÁ rechazar con `400 INVALID_REQUEST`.
4. SI algún texto extra incumple `0 <= inicio_s < fin_s <= duración`, ENTONCES EL Validador DEBERÁ rechazar con `400 INVALID_REQUEST` indicando el texto afectado.
5. SI algún campo de estilo de un texto extra queda fuera de rango (tamaño 12–200 inclusive, grosor de borde 0–20 inclusive, posición vertical 0–100% inclusive, posición horizontal 0–100% inclusive, color y color de borde en formato exacto `#RRGGBB`), ENTONCES EL Validador DEBERÁ rechazar con `400 INVALID_REQUEST` indicando el campo afectado.

### Requisito 16: Orden del flujo, pausas/reanudación y monotonía del progreso

**Historia de usuario:** Como usuario del editor, quiero que el flujo mantenga un orden coherente y no pierda mi trabajo entre pausas, para completar la edición sin errores ni retrocesos.

#### Criterios de Aceptación

1. EL Pipeline DEBERÁ ejecutar las etapas exactamente en este orden secuencial: detección de silencios, corte, transcripción, subtítulos automáticos, revisión de texto, edición final con textos extra y render Remotion, iniciando cada etapa únicamente cuando la etapa inmediatamente anterior haya finalizado con éxito.
2. MIENTRAS el Job está en pausa (`ESPERANDO_EDICION_SILENCIOS`, `ESPERANDO_REVISION`, `ESPERANDO_EDICION_FINAL`), EL JobManager DEBERÁ conservar el workdir y todos sus artefactos sin eliminarlos ni modificarlos, de modo que su contenido permanezca idéntico desde el instante en que comienza la pausa hasta el instante de la reanudación.
3. CUANDO el Pipeline reanuda tras una pausa, EL Pipeline DEBERÁ continuar a partir de la etapa siguiente al punto de pausa reutilizando los artefactos persistidos, sin regenerar los artefactos de las etapas ya completadas.
4. CUANDO el Pipeline actualiza el progreso, EL JobManager DEBERÁ garantizar que el porcentaje está entre 0 y 100 (ambos inclusive) y que cada actualización es mayor o igual que la anterior (monotonía no decreciente).
5. CUANDO el render Remotion finaliza con éxito, EL JobManager DEBERÁ fijar el progreso en 100%.
6. SI una etapa falla antes de completarse, ENTONCES EL Pipeline DEBERÁ detenerse en la etapa fallida sin avanzar, conservar el workdir y sus artefactos, y exponer una indicación de error que identifique la etapa fallida.

### Requisito 17: Convención de código y comentarios en español

**Historia de usuario:** Como miembro del equipo, quiero que el código y los comentarios estén en español, para mantener la convención del proyecto.

#### Criterios de Aceptación

1. EL Sistema DEBERÁ nombrar todos los identificadores nuevos (variables, funciones, clases y endpoints) y redactar todos los comentarios nuevos en español, admitiendo únicamente términos técnicos sin traducción establecida (por ejemplo, nombres de librerías o APIs).
2. DONDE se añadan nuevos componentes, funciones o endpoints, EL Sistema DEBERÁ incluir documentación en español que describa su propósito, sus parámetros de entrada y sus valores de salida.

### Requisito 18: Reutilización de la infraestructura del PR #19

**Historia de usuario:** Como responsable de la arquitectura, quiero reutilizar la infraestructura de previsualización y estilo ya entregada, para no duplicar funcionalidad ni ampliar dependencias.

#### Criterios de Aceptación

1. EL Frontend DEBERÁ reutilizar el componente `@remotion/player` existente para la preview del timeline de silencios y de la edición final, sin instanciar un reproductor alternativo.
2. EL Frontend DEBERÁ reutilizar `EstiloSubtitulos`, `remotion-map.ts` y `estilo.ts` existentes para el estilo y el mapeo de textos extra, sin crear módulos equivalentes duplicados.
3. EL Frontend DEBERÁ reutilizar el componente de revisión de solo texto existente (`SubtitleReview`) para la revisión de texto.
4. EL Sistema DEBERÁ implementar la feature sin añadir nuevas dependencias externas, manteniendo sin cambios la lista de dependencias declaradas en los manifiestos del backend (`requirements.txt`) y del frontend (`package.json`).

### Requisito 19: Verificación de correctitud mediante Property-Based Testing

**Historia de usuario:** Como responsable de calidad, quiero que las propiedades de correctitud del diseño se verifiquen con PBT, para garantizar robustez ante entradas variadas.

#### Criterios de Aceptación

1. EL Sistema DEBERÁ verificar con hypothesis, para toda lista de tramos a borrar y toda duración positiva, que los segmentos a conservar están ordenados de forma ascendente por su instante de inicio, no presentan solapes entre sí, están contenidos en `[0, duración]`, y NUNCA constituyen una lista vacía.
2. EL Sistema DEBERÁ verificar que los segmentos a conservar son exactamente el complemento en `[0, duración]` de los tramos a borrar fusionados, salvo el caso en que los tramos cubren la totalidad de `[0, duración]`, en el cual los segmentos a conservar DEBERÁN ser el vídeo entero `[(0, duración)]` para evitar una duración cero.
3. EL Sistema DEBERÁ verificar con fast-check, usando vectores de prueba generados por el backend, que el mapeo de textos extra produce idénticos valores de `inicioMs`, `finMs` y estilo en backend y frontend para cada texto extra.
4. EL Sistema DEBERÁ verificar que la validación de un texto extra devuelve ausencia de errores si y solo si (bicondicional) su rango temporal y su estilo están dentro de los rangos válidos definidos.
5. EL Sistema DEBERÁ verificar que construir `ShortVideoProps` sin textos extra produce `textosExtra` igual a lista vacía y preserva sin cambios el resto del contrato previo (retrocompatibilidad).
6. CUANDO se ejecuta una prueba basada en propiedades, EL Sistema DEBERÁ ejecutar al menos 100 iteraciones por cada propiedad verificada.
