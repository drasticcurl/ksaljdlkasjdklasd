# Diseño del Bugfix: Añadir tramo de silencio en la posición del cursor

## Overview

El botón **"Añadir tramo"** del componente `TimelineSilencios` no crea un tramo
nuevo: en la práctica **agranda el último tramo existente** e **ignora la
posición del cursor** (`cursorS`).

La causa es doble y está en el manejador `anadirTramo`:

1. Coloca el inicio del tramo nuevo exactamente en el fin del último tramo
   (`inicio = ultimo.fin_s`). Como `normalizarTramos` **fusiona los tramos
   adyacentes** (regla `t.inicio_s <= ultimo.fin_s`), el "tramo nuevo" se funde
   con el último y el resultado es un único tramo más largo. El número de tramos
   no aumenta.
2. Nunca lee `cursorS`: siempre añade al final (o en 0 si no cabe), sin tener en
   cuenta dónde está posicionado el usuario.

**Estrategia del arreglo (mínima y localizada):** reescribir únicamente la
lógica de colocación dentro de `anadirTramo` para que:

- Use la posición del cursor `cursorS`, recortada (clamp) a `[0, duración]`, como
  punto de partida del tramo nuevo.
- Aplique una duración por defecto (`DURACION_TRAMO_NUEVO_S`), ajustada si no cabe
  hasta el final del vídeo o dentro del hueco libre disponible.
- Coloque el tramo en el **interior de un hueco libre**, sin compartir borde con
  los tramos vecinos reales, de modo que `normalizarTramos` NO lo fusione y el
  número de tramos aumente en 1.

El resto del contrato del componente (mover, estirar/achicar, eliminar,
confirmar, solo-lectura y previsualización recortada) **no cambia**. En
particular, `normalizarTramos` y `segmentosConservar` **conservan su semántica
intacta** (incluida la fusión de tramos genuinamente solapados/adyacentes por
edición manual): el arreglo no toca esos helpers, solo cómo se elige la posición
del tramo nuevo antes de sanear.

## Glossary

- **Bug_Condition (C)**: La acción "pulsar Añadir tramo" que, con el código
  actual, no produce un tramo nuevo y distinto en la posición del cursor (fusiona
  con el último tramo y/o ignora `cursorS`).
- **Property (P)**: El comportamiento deseado al pulsar "Añadir tramo": aparece un
  tramo NUEVO, clampeado a `[0, duración]`, ubicado en la posición del cursor,
  sin fusionarse con los tramos preexistentes que no solapan.
- **Preservation**: El comportamiento existente que debe permanecer sin cambios:
  mover/estirar/achicar bloques, eliminar, confirmar, modo solo-lectura, la
  previsualización recortada y la semántica de `normalizarTramos` /
  `segmentosConservar`.
- **`anadirTramo`**: Manejador (callback `useCallback`) en
  `frontend/components/TimelineSilencios.tsx` que se ejecuta al pulsar el botón
  "Añadir tramo" (`data-testid="timeline-anadir"`). Es la ÚNICA función que se
  modifica.
- **`normalizarTramos(tramos, duracion)`**: Helper puro y exportable en
  `frontend/components/TimelineSilencios.tsx`. Recorta a `[0, duración]`, descarta
  degenerados (`fin <= inicio`), ordena por `inicio_s` y **fusiona tramos
  solapados o adyacentes** (`t.inicio_s <= ultimo.fin_s`). No se modifica.
- **`segmentosConservar(tramos, duracion)`**: Helper puro que calcula el
  complemento de los tramos a borrar dentro de `[0, duración]` (los huecos
  libres). No se modifica; la lógica de arreglo reutiliza la misma idea de
  "hueco libre".
- **`cursorS`**: Estado (`useState<number>`) con la posición del cursor de
  scrubbing en segundos del tiempo ORIGINAL del vídeo unido. Es la posición del
  "botón/cursor" que el arreglo debe respetar.
- **`duracion`**: `datos.duracion_s`, duración total del vídeo unido en segundos.
- **`editable`**: `datos.editable`; solo `true` cuando el Job está en
  `esperando_edicion_silencios`. Si es `false`, no se añaden tramos.
- **Hueco libre / zona libre**: Un intervalo `[g0, g1]` del complemento de los
  tramos normalizados dentro de `[0, duración]`. Tras `normalizarTramos`, los
  tramos consecutivos cumplen `siguiente.inicio_s > previo.fin_s`, por lo que
  todo hueco entre tramos reales tiene anchura estrictamente positiva.
- **`DURACION_TRAMO_NUEVO_S`**: Constante existente (`1.0` s) con la duración por
  defecto del tramo nuevo.

## Bug Details

### Bug Condition

El bug se manifiesta al pulsar "Añadir tramo": el manejador coloca el inicio en
`ultimo.fin_s` (que `normalizarTramos` fusiona con el último tramo) e ignora
`cursorS`, de modo que NO se crea un tramo nuevo y distinto en la posición del
cursor.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input = { tramos, duracion, cursorS, editable, accion }
  OUTPUT: boolean

  // Solo consideramos la acción de añadir con timeline editable y válido.
  IF input.accion != "anadir_tramo" THEN RETURN false
  IF input.editable = false THEN RETURN false
  IF NOT (input.duracion > 0) THEN RETURN false

  saneados := normalizarTramos(input.tramos, input.duracion)
  cursor   := clamp(input.cursorS, 0, input.duracion)

  // El cursor cae en una zona libre con hueco suficiente para un tramo nuevo.
  enZonaLibre := cursorEnInteriorDeHuecoLibre(cursor, saneados, input.duracion)

  resultadoActual := anadirTramo_original(input)   // implementación con el bug

  // La condición del bug: en zona libre, el código actual NO incrementa el
  // número de tramos (fusiona con un vecino) o coloca el tramo lejos del cursor.
  RETURN enZonaLibre
         AND ( |resultadoActual| != |saneados| + 1
               OR NOT tramoNuevoContieneOEmpiezaEn(resultadoActual, cursor) )
END FUNCTION
```

### Examples

- **Fusión con el último tramo (síntoma principal):** `duracion = 10`,
  `tramos = [{inicio_s: 2, fin_s: 4}]`, `cursorS = 7`.
  - Esperado: aparece un tramo nuevo `~[7, 8]`; `|tramos| = 2`.
  - Actual: `inicio = ultimo.fin_s = 4`, nuevo `[4, 5]`; como `4 <= 4`,
    `normalizarTramos` fusiona con `[2, 4]` → `[{2, 5}]`; `|tramos| = 1`
    (el último tramo se agranda, el cursor se ignora).
- **Se ignora el cursor:** `duracion = 20`, `tramos = [{inicio_s: 0, fin_s: 3}]`,
  `cursorS = 12`.
  - Esperado: tramo nuevo `~[12, 13]`.
  - Actual: `inicio = 3`, nuevo `[3, 4]` (junto al primero), nada que ver con 12.
- **Reubicación al inicio que vuelve a fusionar:** `duracion = 3`,
  `tramos = [{inicio_s: 0, fin_s: 2.5}]`, `cursorS = 1`.
  - Actual: `inicio = 2.5`, `2.5 + 1 = 3.5 > 3` ⇒ `inicio = 0`, nuevo `[0, 1]`;
    como `0 <= 2.5` se fusiona con `[0, 2.5]` → `[{0, 2.5}]`; `|tramos| = 1`.
  - Esperado: un tramo nuevo en el hueco libre alrededor del cursor.
- **Caso límite — cursor dentro de un tramo:** `duracion = 10`,
  `tramos = [{inicio_s: 3, fin_s: 6}]`, `cursorS = 4` (dentro del tramo).
  - Esperado (best-effort): el tramo nuevo se coloca en el hueco libre más
    cercano a partir del cursor (p. ej. tras el fin del tramo, `~[6, 7]`), sin
    agrandar el tramo existente.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- **Mover / estirar / achicar**: arrastrar el cuerpo o los bordes de un bloque
  sigue aplicando el clamp a `[0, duración]` y manteniendo `inicio < fin`; la
  fusión de solapados/adyacentes por arrastre se sigue difiriendo a `alSoltar`
  vía `normalizarTramos`.
- **Eliminar**: `eliminarTramo(i)` sigue quitando solo el tramo indicado, sin
  alterar los demás.
- **Confirmar**: `confirmar` sigue saneando con `normalizarTramos`, llamando a
  `enviarSilencios` e invocando `onEnviado` en éxito; los errores se muestran sin
  romper la UI.
- **Solo lectura**: con `editable = false` o `duracion <= 0`, añadir sigue
  deshabilitado y los tramos son de solo lectura.
- **Previsualización recortada**: `segmentosConservar`, el cálculo de
  `durationInFrames`, el mapeo cut-time ⇄ tiempo original y la sincronización del
  cursor con la reproducción permanecen sin cambios.
- **Semántica de `normalizarTramos`**: recorte, descarte de degenerados, orden
  ascendente y fusión de solapados/adyacentes se mantienen idénticos
  (incluida su idempotencia).

**Scope:**
Toda entrada que NO sea la acción "Añadir tramo" debe quedar completamente
inalterada por este arreglo. Esto incluye:
- Arrastres de mover/estirar/achicar (`alPresionar` / `alMover` / `alSoltar`).
- Eliminación de tramos y confirmación.
- Cálculo de la preview y scrubbing del cursor.
- Cualquier llamada directa a `normalizarTramos` o `segmentosConservar`.

**Nota:** El comportamiento correcto concreto de la acción "Añadir tramo" se
define en la sección **Correctness Properties** (Propiedades 1–3). Esta sección
se centra en lo que NO debe cambiar.

## Hypothesized Root Cause

A partir del análisis del código, las causas son:

1. **Colocación en el borde del último tramo (fusión no deseada)**: la línea
   `let inicio = ultimo ? ultimo.fin_s : 0;` hace que el tramo nuevo empiece
   exactamente donde termina el último. Como `normalizarTramos` fusiona con la
   regla de adyacencia `t.inicio_s <= ultimo.fin_s`, el nuevo tramo se absorbe en
   el anterior y el conteo de tramos no aumenta. **Esta es la causa principal.**

2. **No se usa `cursorS`**: `anadirTramo` no lee en absoluto el estado del cursor,
   por lo que la posición del usuario en la línea de tiempo se ignora.

3. **Reubicación en 0 que también fusiona**: cuando el tramo no cabe al final
   (`inicio + dur > duracion`), se fuerza `inicio = 0`; si ya hay un tramo que
   empieza en 0, se fusiona igualmente.

4. **Ausencia de selección de hueco libre**: el manejador no calcula dónde hay
   espacio disponible; por eso no puede garantizar que el tramo nuevo quede
   separado de los vecinos.

## Correctness Properties

Property 1: Bug Condition - Añadir en zona libre incrementa el número de tramos

_For any_ lista de tramos ya normalizada `T` (`normalizarTramos(T) = T`),
duración `d > 0` y cursor `c` tal que `c` cae en el **interior de un hueco libre**
(no dentro ni en el borde de ningún tramo de `T`, con `0 <= c < d` y hueco de
anchura suficiente para un tramo mínimo), la función corregida `anadirTramo`
SHALL producir una lista `T'` con `|T'| = |T| + 1`, donde el tramo nuevo no
solapa ni comparte borde con ningún tramo de `T` (es decir, `normalizarTramos` no
lo fusiona).

**Validates: Requirements 2.1**

Property 2: Bug Condition - El tramo nuevo respeta el cursor, el clamp y la duración

_For any_ entrada donde se añade en zona libre, el tramo nuevo `n` de la lista
resultante SHALL cumplir `0 <= n.inicio_s < n.fin_s <= d` (clamp válido), su
inicio SHALL coincidir con la posición del cursor recortada a `[0, d]` cuando esa
posición cabe en el hueco, y su duración `n.fin_s - n.inicio_s` SHALL ser como
máximo `DURACION_TRAMO_NUEVO_S`, reducida si no cabe hasta el final del hueco o
del vídeo.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Se conservan los tramos preexistentes que no solapan

_For any_ entrada donde se añade en zona libre, todos los tramos de `T` que no
solapan con el tramo nuevo SHALL aparecer sin cambios en `T'` (mismos
`inicio_s`/`fin_s`), y `T'` SHALL quedar ordenada ascendentemente por `inicio_s`
y sin solapes.

**Validates: Requirements 2.3**

Property 4: Preservation - Las operaciones distintas de "Añadir" no cambian

_For any_ entrada cuya acción NO sea "Añadir tramo" (mover, estirar/achicar,
eliminar, confirmar, carga en solo-lectura), el código corregido SHALL producir
exactamente el mismo resultado que el código original, preservando el clamp a
`[0, d]`, el invariante `inicio < fin`, la eliminación selectiva y el envío con
`enviarSilencios`/`onEnviado`.

**Validates: Requirements 3.1, 3.3, 3.4**

Property 5: Preservation - `normalizarTramos` / `segmentosConservar` intactos

_For any_ lista de tramos y duración, `normalizarTramos` y `segmentosConservar`
SHALL producir el mismo resultado que antes del arreglo (misma semántica de
recorte, orden y fusión de solapados/adyacentes), y `normalizarTramos` SHALL
seguir siendo idempotente: `normalizarTramos(normalizarTramos(t, d), d) =
normalizarTramos(t, d)`.

**Validates: Requirements 3.2, 3.5**

## Fix Implementation

### Changes Required

Suponiendo que el análisis de la causa raíz es correcto:

**File**: `frontend/components/TimelineSilencios.tsx`

**Function**: `anadirTramo` (y `cursorS` pasa a ser dependencia del `useCallback`).

**Specific Changes**:

1. **Leer y clampeaer el cursor**: dentro de `anadirTramo`, tomar `cursorS`,
   recortarlo a `[0, duracion]` (`inicioDeseado = clamp(cursorS, 0, duracion)`) y
   añadir `cursorS` a la lista de dependencias del `useCallback`.

2. **Calcular los huecos libres**: obtener `saneados = normalizarTramos(prev,
   duracion)` y su complemento en `[0, duracion]` (misma idea que
   `segmentosConservar`, reutilizable). Cada hueco es `[g0, g1]` con `g0 < g1`.

3. **Seleccionar el hueco objetivo**:
   - Si `inicioDeseado` cae en el interior de un hueco → ese hueco.
   - Si el cursor cae dentro o en el borde de un tramo (caso límite) → el primer
     hueco que empiece en/después del cursor; si no hay ninguno, el último hueco.
   - Si NO hay ningún hueco libre (los tramos cubren todo `[0, duracion]`) →
     devolver `prev` sin cambios (no hay dónde colocar un tramo nuevo).

4. **Colocar el tramo nuevo dentro del hueco, sin tocar los bordes vecinos**:
   dado el hueco `[g0, g1]`:
   - `inicio = clamp(inicioDeseado, g0, g1)`.
   - `fin = min(inicio + DURACION_TRAMO_NUEVO_S, g1)`.
   - Si `fin` alcanzaría el borde derecho `g1` y ese borde corresponde a un tramo
     real (no al final del vídeo), reducir `fin` para que quede **estrictamente**
     por debajo de `g1` (p. ej. un punto interior entre `inicio` y `g1`), de modo
     que `normalizarTramos` no lo fusione con el vecino derecho.
   - De forma análoga, si `g0` corresponde al fin de un tramo real, garantizar
     `inicio > g0` (el cursor interior ya lo cumple; en el caso de fallback se
     coloca ligeramente dentro del hueco).
   - Descartar si el hueco es demasiado pequeño para un tramo con duración
     positiva (`fin <= inicio`).

5. **Insertar y sanear**: `return normalizarTramos([...prev, nuevo], duracion)`.
   Al quedar el tramo nuevo estrictamente dentro del hueco (sin compartir borde
   con vecinos reales), la normalización lo mantiene distinto y el número de
   tramos aumenta en 1. La firma pública, el `data-testid`, el `disabled` del
   botón y `onClick={anadirTramo}` no cambian.

> **Nota de invariantes de puntos flotantes:** como tras `normalizarTramos` los
> tramos consecutivos cumplen `siguiente.inicio_s > previo.fin_s`, todo hueco
> entre tramos reales tiene anchura positiva; colocar el tramo nuevo en el
> interior del hueco (inicio estrictamente mayor que `g0` cuando hay vecino
> izquierdo y fin estrictamente menor que `g1` cuando hay vecino derecho) evita
> la regla de fusión por adyacencia (`<=`).

## Testing Strategy

### Validation Approach

La estrategia sigue dos fases: primero, exponer contraejemplos que demuestren el
bug sobre el código SIN arreglar; después, verificar que el arreglo funciona y que
preserva el comportamiento existente. Se usa Vitest (ya presente en el proyecto,
ver `frontend/components/__tests__/TimelineSilencios.test.tsx`) y fast-check para
las pruebas basadas en propiedades.

### Exploratory Bug Condition Checking

**Goal**: Exponer contraejemplos que demuestren el bug ANTES de implementar el
arreglo, y confirmar (o refutar) el análisis de la causa raíz. Si se refuta, hay
que re-hipotetizar.

**Test Plan**: Escribir pruebas que rendericen `TimelineSilencios` con datos
inyectados (`obtenerFn`), muevan el cursor a una zona libre (clic en la pista o
fijando `cursorS`) y pulsen "Añadir tramo", comprobando el número de tramos y la
posición del nuevo. Ejecutarlas sobre el código SIN arreglar para observar los
fallos.

**Test Cases**:
1. **Fusión con el último tramo**: `tramos = [{2,4}]`, `duracion = 10`, cursor en
   7; pulsar añadir. Se espera `|tramos| = 2`, pero el código actual da 1 (fusiona
   en `[2,5]`) (fallará en el código sin arreglar).
2. **Se ignora el cursor**: `tramos = [{0,3}]`, `duracion = 20`, cursor en 12;
   pulsar añadir. Se espera un tramo cerca de 12, pero el actual lo coloca en
   `[3,4]` (fallará en el código sin arreglar).
3. **Reubicación en 0 que fusiona**: `tramos = [{0,2.5}]`, `duracion = 3`, cursor
   en 1; pulsar añadir. Se espera `|tramos| = 2`, el actual da 1 (fallará en el
   código sin arreglar).
4. **Caso límite — cursor dentro de un tramo**: `tramos = [{3,6}]`, `duracion =
   10`, cursor en 4; pulsar añadir. Se espera un tramo nuevo en el hueco libre sin
   agrandar `[3,6]` (puede fallar en el código sin arreglar).

**Expected Counterexamples**:
- Tras pulsar añadir, el número de tramos no aumenta (se fusiona con un vecino).
- Causas: `inicio = ultimo.fin_s` + regla de fusión por adyacencia; y `cursorS`
  ignorado.

### Fix Checking

**Goal**: Verificar que, para toda entrada donde se cumple la condición del bug
(añadir en zona libre), la función corregida produce el comportamiento esperado.

**Pseudocode:**
```
FUNCTION expectedBehavior(input, resultado)
  saneados := normalizarTramos(input.tramos, input.duracion)
  cursor   := clamp(input.cursorS, 0, input.duracion)
  nuevo    := tramoQueNoEstaEn(resultado, saneados)   // el añadido

  RETURN |resultado| = |saneados| + 1
         AND 0 <= nuevo.inicio_s < nuevo.fin_s <= input.duracion
         AND (nuevo.fin_s - nuevo.inicio_s) <= DURACION_TRAMO_NUEVO_S
         AND cursorDentroDe(cursor, nuevo) OR nuevo.inicio_s = cursor
         AND todosLosTramosNoSolapadosDe(saneados) estan en resultado
         AND estaOrdenadaYSinSolapes(resultado)
END FUNCTION

FOR ALL input WHERE isBugCondition(input) DO
  resultado := anadirTramo_fixed(input)
  ASSERT expectedBehavior(input, resultado)
END FOR
```

### Preservation Checking

**Goal**: Verificar que, para toda entrada donde NO se cumple la condición del bug
(cualquier operación que no sea "Añadir tramo", o helpers puros), la función
corregida produce el mismo resultado que la original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT anadirTramo_original(input) = anadirTramo_fixed(input)
  ASSERT normalizarTramos_original(t, d) = normalizarTramos_fixed(t, d)
  ASSERT segmentosConservar_original(t, d) = segmentosConservar_fixed(t, d)
END FOR
```

**Testing Approach**: Las pruebas basadas en propiedades son idóneas para el
preservation checking porque generan muchos casos automáticamente, cubren
esquinas difíciles y dan garantías fuertes de que el comportamiento no cambia para
las entradas no afectadas. Como `anadirTramo` es un manejador de componente, la
preservación de mover/estirar/eliminar/confirmar se verifica con pruebas de
interacción (Testing Library) además de propiedades sobre los helpers puros.

**Test Plan**: Observar el comportamiento en el código SIN arreglar para mover,
estirar, eliminar, confirmar y para los helpers puros; luego escribir pruebas
(unitarias y de propiedades) que capturen ese comportamiento y confirmen que se
mantiene tras el arreglo.

**Test Cases**:
1. **Preservación de mover/estirar**: observar que arrastrar cuerpo/bordes aplica
   clamp y `inicio < fin`; verificar que sigue igual tras el arreglo.
2. **Preservación de eliminar**: observar que `eliminarTramo(i)` quita solo ese
   tramo; verificar que sigue igual.
3. **Preservación de confirmar**: observar que se llama a `enviarSilencios` con
   tramos saneados y a `onEnviado` en éxito; verificar que sigue igual.
4. **Preservación de solo-lectura**: con `editable = false`, añadir/eliminar
   deshabilitados; verificar que sigue igual.
5. **Preservación de helpers**: propiedades sobre `normalizarTramos` y
   `segmentosConservar` (recorte, orden, fusión de solapados) idénticas.

### Unit Tests

- Añadir con cursor en zona libre en distintas posiciones (principio, medio,
  final) y comprobar `|tramos|`, clamp y posición del nuevo.
- Casos límite: cursor dentro de un tramo, cursor pegado a un borde, cursor en 0 y
  en `duracion`, hueco más pequeño que `DURACION_TRAMO_NUEVO_S`, timeline lleno
  (sin huecos), `duracion <= 0` y `editable = false`.
- Mover/estirar/achicar, eliminar y confirmar siguen funcionando.

### Property-Based Tests

- **Propiedad 1**: generar listas normalizadas y un cursor en el interior de un
  hueco; tras añadir, `|tramos|` aumenta en 1 y el nuevo no comparte borde con
  vecinos.
- **Propiedad 2**: el nuevo tramo siempre cumple `0 <= inicio < fin <= duración` y
  duración `<= DURACION_TRAMO_NUEVO_S`, con inicio en el cursor cuando cabe.
- **Propiedad 3**: los tramos preexistentes que no solapan se conservan; la salida
  queda ordenada y sin solapes.
- **Propiedad 5**: idempotencia y semántica de `normalizarTramos` /
  `segmentosConservar` preservadas para entradas aleatorias.

### Integration Tests

- Flujo completo: cargar timeline (mock de `obtenerFn`), mover el cursor con clic
  en la pista, pulsar "Añadir tramo" y ver el bloque nuevo en la pista y el
  contador `timeline-num-tramos` incrementado.
- Añadir varios tramos en distintas posiciones y confirmar; comprobar que
  `enviarFn` recibe la lista saneada con todos los tramos y que se invoca
  `onEnviado`.
- Verificar que la previsualización recortada (`segmentosConservar`) refleja el
  tramo nuevo en vivo sin romperse.
