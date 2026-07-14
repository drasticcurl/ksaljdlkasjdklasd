# Plan de Implementación

Arreglo mínimo y localizado en `frontend/components/TimelineSilencios.tsx`
(función `anadirTramo`). Se sigue la metodología exploratoria del bugfix:
primero se escriben pruebas que **demuestran el bug** sobre el código SIN
arreglar (bug condition checking), luego se implementa el arreglo y se validan
el **fix checking** y el **preservation checking** con PBT (fast-check) y pruebas
de interacción (Testing Library / Vitest).

Tests en `frontend/components/__tests__/TimelineSilencios.test.tsx` (ya existe).

---

- [ ] 1. Escribir prueba exploratoria de la condición del bug (ANTES del arreglo)
  - **Property 1: Bug Condition** - Añadir en zona libre incrementa el número de tramos
  - **CRÍTICO**: Esta prueba DEBE FALLAR sobre el código sin arreglar; el fallo confirma que el bug existe
  - **NO intentes arreglar la prueba ni el código cuando falle**: el fallo es el resultado esperado en esta fase
  - **NOTA**: Esta prueba codifica el comportamiento esperado; validará el arreglo cuando pase tras la implementación
  - **OBJETIVO**: Aflorar contraejemplos que demuestren el bug (fusión con el último tramo e ignorar `cursorS`)
  - **Enfoque PBT acotado (bug determinista)**: acotar la propiedad a casos concretos reproducibles del diseño:
    - `duracion=10`, `tramos=[{inicio_s:2, fin_s:4}]`, `cursorS=7` → esperado `|tramos|=2`, actual `1` (fusiona en `[2,5]`)
    - `duracion=20`, `tramos=[{inicio_s:0, fin_s:3}]`, `cursorS=12` → esperado tramo `~[12,13]`, actual `[3,4]`
    - `duracion=3`, `tramos=[{inicio_s:0, fin_s:2.5}]`, `cursorS=1` → esperado `|tramos|=2`, actual `1` (reubica en 0 y fusiona)
  - Renderizar `TimelineSilencios` con datos inyectados (`obtenerFn`), fijar el cursor en zona libre (clic en la pista o estableciendo `cursorS`) y pulsar `data-testid="timeline-anadir"`
  - Aserción (Bug Condition / Expected Behavior del diseño): tras pulsar, `|tramos|` aumenta en 1 y el tramo nuevo no comparte borde con vecinos (no lo fusiona `normalizarTramos`)
  - Ejecutar sobre el código SIN arreglar
  - **RESULTADO ESPERADO**: la prueba FALLA (es correcto: prueba que el bug existe)
  - Documentar los contraejemplos hallados (p. ej. "añadir con cursor=7 devuelve `[{2,5}]`, `|tramos|=1` en lugar de 2")
  - Marcar la tarea como completa cuando la prueba esté escrita, ejecutada y el fallo documentado
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [ ] 2. Escribir pruebas de preservación (ANTES del arreglo)
  - **Property 2: Preservation** - Operaciones distintas de "Añadir" y helpers puros sin cambios
  - **IMPORTANTE**: Seguir la metodología de observación-primero (observar el comportamiento real sobre el código SIN arreglar y capturarlo)
  - **Observar** sobre el código sin arreglar y registrar la salida real:
    - Mover/estirar/achicar (`alPresionar`/`alMover`/`alSoltar`): mantiene clamp a `[0, duracion]` e invariante `inicio_s < fin_s`
    - Eliminar (`eliminarTramo(i)`): quita solo el tramo indicado, el resto intacto
    - Confirmar (`confirmar`): llama a `enviarSilencios` con tramos saneados e invoca `onEnviado` en éxito
    - Solo lectura (`editable=false` o `duracion<=0`): añadir/eliminar deshabilitados
    - Helpers puros `normalizarTramos` / `segmentosConservar`: recorte, orden ascendente, fusión de solapados/adyacentes e idempotencia de `normalizarTramos`
  - Escribir pruebas de propiedades (fast-check) para los helpers puros y pruebas de interacción (Testing Library) para mover/estirar/eliminar/confirmar/solo-lectura, capturando el comportamiento observado (Preservation Checking del diseño)
  - Property-based testing genera muchos casos automáticamente → garantías más fuertes de que el comportamiento no cambia
  - Ejecutar sobre el código SIN arreglar
  - **RESULTADO ESPERADO**: las pruebas PASAN (confirman la línea base a preservar)
  - Marcar la tarea como completa cuando las pruebas estén escritas, ejecutadas y pasando sobre el código sin arreglar
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Arreglar `anadirTramo` para crear un tramo nuevo en la posición del cursor

  - [ ] 3.1 Implementar el arreglo en `anadirTramo`
    - **Archivo**: `frontend/components/TimelineSilencios.tsx`, función `anadirTramo`
    - Leer `cursorS` y clampearlo: `inicioDeseado = clamp(cursorS, 0, duracion)`; añadir `cursorS` a las dependencias del `useCallback`
    - Calcular los huecos libres: `saneados = normalizarTramos(prev, duracion)` y su complemento en `[0, duracion]` (misma idea que `segmentosConservar`); cada hueco `[g0, g1]` con `g0 < g1`
    - Seleccionar el hueco objetivo: si `inicioDeseado` cae en el interior de un hueco → ese hueco; si cae dentro/en el borde de un tramo → primer hueco que empiece en/después del cursor (o el último si no hay); si no hay ningún hueco → devolver `prev` sin cambios
    - Colocar el tramo nuevo en el INTERIOR del hueco sin compartir borde con vecinos reales: `inicio = clamp(inicioDeseado, g0, g1)`, `fin = min(inicio + DURACION_TRAMO_NUEVO_S, g1)`; si `g1`/`g0` corresponden a un tramo real, garantizar `fin < g1` e `inicio > g0` estrictamente (evita la fusión por adyacencia `<=`); descartar si el hueco es demasiado pequeño (`fin <= inicio`)
    - Insertar y sanear: `return normalizarTramos([...prev, nuevo], duracion)`
    - NO modificar la firma pública, `data-testid`, `disabled` del botón ni `onClick={anadirTramo}`; NO tocar `normalizarTramos` ni `segmentosConservar`
    - _Bug_Condition: isBugCondition(input) donde accion="anadir_tramo", editable, duracion>0 y el cursor cae en el interior de un hueco libre (del diseño)_
    - _Expected_Behavior: expectedBehavior(input, resultado) del diseño — `|resultado| = |saneados| + 1`, `0 <= inicio_s < fin_s <= duracion`, duración `<= DURACION_TRAMO_NUEVO_S`, inicio en el cursor cuando cabe, tramos no solapados preservados y salida ordenada_
    - _Preservation: Preservation Requirements del diseño (mover/estirar/eliminar/confirmar/solo-lectura y semántica de `normalizarTramos`/`segmentosConservar`)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.2 Verificar que la prueba exploratoria de la condición del bug ahora PASA
    - **Property 1: Expected Behavior** - Añadir en zona libre incrementa el número de tramos
    - **IMPORTANTE**: Re-ejecutar la MISMA prueba de la tarea 1 — NO escribir una nueva
    - La prueba de la tarea 1 codifica el comportamiento esperado; al pasar, confirma que el bug está resuelto
    - **RESULTADO ESPERADO**: la prueba PASA (el número de tramos aumenta en 1 y el nuevo tramo respeta cursor/clamp/duración sin fusionarse)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 3.3 Verificar que las pruebas de preservación siguen PASANDO
    - **Property 2: Preservation** - Operaciones distintas de "Añadir" y helpers puros sin cambios
    - **IMPORTANTE**: Re-ejecutar las MISMAS pruebas de la tarea 2 — NO escribir nuevas
    - **RESULTADO ESPERADO**: las pruebas PASAN (sin regresiones en mover/estirar/eliminar/confirmar/solo-lectura ni en `normalizarTramos`/`segmentosConservar`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Ampliar pruebas unitarias del arreglo
  - Añadir con cursor en zona libre en distintas posiciones (principio, medio, final): comprobar `|tramos|`, clamp y posición del nuevo
  - Casos límite: cursor dentro de un tramo, cursor pegado a un borde, cursor en 0 y en `duracion`, hueco menor que `DURACION_TRAMO_NUEVO_S`, timeline lleno (sin huecos → sin cambios), `duracion <= 0` y `editable = false`
  - Confirmar que mover/estirar/achicar, eliminar y confirmar siguen funcionando (unitario)
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.3, 3.4_

- [ ] 5. Ampliar pruebas basadas en propiedades (fast-check)
  - **Property 3: Bug Condition** - Se conservan los tramos preexistentes que no solapan
    - Generar listas normalizadas y un cursor en el interior de un hueco; tras añadir, los tramos que no solapan aparecen sin cambios y la salida queda ordenada y sin solapes
    - _Requirements: 2.3_
  - **Property 2 (refuerzo)**: para toda entrada en zona libre, el nuevo tramo cumple `0 <= inicio_s < fin_s <= duracion` y duración `<= DURACION_TRAMO_NUEVO_S`, con inicio en el cursor cuando cabe en el hueco
    - _Requirements: 2.1, 2.2_
  - **Property 5: Preservation** - `normalizarTramos` / `segmentosConservar` intactos
    - Idempotencia `normalizarTramos(normalizarTramos(t,d),d) = normalizarTramos(t,d)` y semántica (recorte, orden, fusión de solapados/adyacentes) preservadas para entradas aleatorias
    - _Requirements: 3.2, 3.5_

- [ ] 6. Ampliar pruebas de integración (Testing Library)
  - Flujo completo: cargar timeline (mock de `obtenerFn`), mover el cursor con clic en la pista, pulsar "Añadir tramo" y ver el bloque nuevo en la pista con `timeline-num-tramos` incrementado
  - Añadir varios tramos en distintas posiciones y confirmar; comprobar que `enviarFn` recibe la lista saneada con todos los tramos y que se invoca `onEnviado`
  - Verificar que la previsualización recortada (`segmentosConservar`) refleja el tramo nuevo en vivo sin romperse
  - **Property 4: Preservation** - Las operaciones distintas de "Añadir" no cambian (mover/estirar/eliminar/confirmar/solo-lectura producen el mismo resultado que el original)
  - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 7. Checkpoint - Asegurar que todas las pruebas pasan
  - Ejecutar toda la suite (unitarias + PBT + integración) en modo de ejecución única (p. ej. `vitest --run`)
  - Confirmar que la prueba exploratoria (tarea 1) pasa tras el arreglo y que las de preservación (tareas 2, 5, 6) no presentan regresiones
  - Si surgen dudas o algún fallo inesperado, consultar al usuario antes de continuar

---

## Grafo de Dependencias de Tareas

```
Fase exploratoria (código SIN arreglar)
  1. Prueba de Bug Condition (debe FALLAR)  ──┐
  2. Pruebas de Preservación (deben PASAR)  ──┤
                                              │
Fase de implementación                        ▼
  3.1 Implementar arreglo en anadirTramo  ◄───┘  (depende de 1 y 2)
        │
        ├──► 3.2 Re-ejecutar prueba de tarea 1 (ahora PASA)
        └──► 3.3 Re-ejecutar pruebas de tarea 2 (siguen PASANDO)
                    │
Fase de validación ampliada                    ▼
  4. Unitarias        (depende de 3.1)
  5. PBT / fast-check (depende de 3.1)
  6. Integración      (depende de 3.1)
        │
        ▼
  7. Checkpoint  (depende de 4, 5, 6)
```

- La tarea **1** y la tarea **2** son independientes entre sí y se ejecutan primero, sobre el código sin arreglar.
- La tarea **3.1** depende de que 1 y 2 estén completas (bug demostrado y línea base capturada).
- Las tareas **3.2** y **3.3** dependen de 3.1 y reutilizan las pruebas de 1 y 2.
- Las tareas **4**, **5** y **6** dependen de 3.1 y pueden abordarse en paralelo.
- La tarea **7** cierra el flujo y depende de 4, 5 y 6.
