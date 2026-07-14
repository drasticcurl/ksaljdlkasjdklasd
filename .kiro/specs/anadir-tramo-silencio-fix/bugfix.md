# Documento de Requisitos del Bugfix

## Introducción

En el timeline de edición de silencios (`TimelineSilencios`, feature `edicion-avanzada-shorts`), el botón **"Añadir tramo"** no crea un tramo nuevo: en la práctica **agranda (estira) el último tramo existente**. El usuario lo reportó así: *"el botón de añadir tramo solo estira el tramo actual, que agregue un tramo en la posición del botón"*.

El defecto tiene dos facetas observables:

1. **No se crea un tramo distinto.** El manejador coloca el inicio del tramo nuevo exactamente en el fin del último tramo existente (`inicio = ultimo.fin_s`). Como la normalización posterior fusiona los tramos **adyacentes** (los que se tocan en el borde, `inicio <= fin_previo`), el "tramo nuevo" se funde con el último y el resultado es un único tramo más largo. El número de tramos no aumenta.
2. **Se ignora la posición del botón/cursor.** El manejador nunca usa la posición del cursor/reproductor (`cursorS`); siempre añade al final (o al inicio si no cabe), sin tener en cuenta dónde está el usuario en la línea de tiempo.

El impacto es que resulta imposible añadir nuevos tramos de silencio de forma intuitiva: en lugar de aparecer un bloque nuevo donde el usuario está posicionado, el último bloque simplemente crece, lo que confunde y bloquea el flujo de edición manual de cortes.

**Condición del bug (en lenguaje natural):** la entrada disparadora es la acción "pulsar Añadir tramo". Para esa acción, el sistema falla al no producir un tramo nuevo y distinto en la posición del cursor. El resto de operaciones (mover, estirar, eliminar, confirmar y la normalización de tramos genuinamente solapados) NO están afectadas y deben preservarse.

## Bug Analysis

### Current Behavior (Defect)

Comportamiento actual al pulsar "Añadir tramo":

1.1 WHEN el usuario pulsa "Añadir tramo" y existe al menos un tramo previo que "cabe" al final THEN el sistema coloca el inicio del tramo nuevo en el fin del último tramo (`inicio = ultimo.fin_s`), lo que al normalizar fusiona ambos y AGRANDA el último tramo en lugar de crear uno nuevo (el número de tramos no aumenta).

1.2 WHEN el usuario pulsa "Añadir tramo" THEN el sistema IGNORA por completo la posición del cursor/botón (`cursorS`) y coloca el tramo siempre al final del último tramo (o en el inicio, 0, si no cabe), independientemente de dónde esté posicionado el usuario en la línea de tiempo.

1.3 WHEN el nuevo tramo colocado al final NO cabe en `[0, duración]` y se reubica en el inicio (0) mientras ya existe un tramo que empieza en 0 THEN el sistema vuelve a fusionarlo con ese tramo inicial, agrandándolo, sin crear un tramo nuevo.

### Expected Behavior (Correct)

Comportamiento correcto que debe tener el botón:

2.1 WHEN el usuario pulsa "Añadir tramo" y la posición del cursor está en una zona libre (no dentro de un tramo existente) THEN el sistema SHALL crear un tramo NUEVO y distinto, de modo que el número de tramos aumente exactamente en 1.

2.2 WHEN el usuario pulsa "Añadir tramo" THEN el sistema SHALL colocar el nuevo tramo en la posición del cursor/botón (`cursorS`), recortado (clamp) a `[0, duración]`, con la duración por defecto `DURACION_TRAMO_NUEVO_S` (ajustada si no cabe hasta el final del vídeo).

2.3 WHEN el usuario pulsa "Añadir tramo" y ya existen otros tramos que NO solapan con la nueva posición THEN el sistema SHALL conservar esos tramos existentes sin agrandarlos ni alterarlos, manteniendo la lista ordenada por `inicio_s`.

### Unchanged Behavior (Regression Prevention)

Comportamiento existente que debe preservarse sin cambios:

3.1 WHEN el usuario arrastra el cuerpo de un tramo (mover) o sus bordes izquierdo/derecho (estirar/achicar) THEN el sistema SHALL CONTINUAR aplicando el clamp a `[0, duración]` y manteniendo `inicio < fin`, igual que antes.

3.2 WHEN existen tramos que realmente se solapan o son adyacentes por edición manual (arrastre) THEN el sistema SHALL CONTINUAR fusionándolos y ordenándolos ascendentemente mediante `normalizarTramos` (misma semántica de saneado, sin cambios).

3.3 WHEN el usuario elimina un tramo o confirma la edición THEN el sistema SHALL CONTINUAR eliminando el tramo indicado sin afectar a los demás, y enviando los tramos saneados con `enviarSilencios` e invocando `onEnviado` en caso de éxito.

3.4 WHEN el Job no está en edición de silencios (`editable = false`) o la duración no es positiva THEN el sistema SHALL CONTINUAR deshabilitando la adición de tramos y tratando los tramos como de solo lectura.

3.5 WHEN se carga la vista y se recalculan los segmentos a conservar para la previsualización recortada THEN el sistema SHALL CONTINUAR calculando el complemento con `segmentosConservar` y sincronizando el cursor con la reproducción, sin cambios.
