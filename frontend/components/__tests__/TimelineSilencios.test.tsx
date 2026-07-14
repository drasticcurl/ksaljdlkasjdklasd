/**
 * Pruebas de `TimelineSilencios` (tarea 10.2, spec `edicion-avanzada-shorts`).
 *
 * Combina dos enfoques complementarios:
 *
 *   1. PBT con `fast-check` sobre el helper PURO `normalizarTramos` (Req 19):
 *      para TODA lista de tramos y TODA duración positiva, el resultado
 *      (a) queda dentro de `[0, duración]` (clamp), (b) no contiene tramos de
 *      duración `<= 0`, (c) está ordenado ascendentemente por `inicio_s`, y
 *      (d) no presenta solapes ni adyacencias (tramos fusionados, de modo que
 *      `siguiente.inicio_s > actual.fin_s`). Se ejecutan >= 100 iteraciones.
 *
 *   2. Pruebas de componente con Testing Library (jsdom): carga inicial con
 *      `obtenerFn` inyectada, render de un bloque por tramo, y que "Confirmar"
 *      invoca `enviarFn` con los tramos SANEADOS (clamp + fusión + orden) y
 *      luego `onEnviado`.
 *
 * Validates: Requirements 3.1, 3.5, 3.6, 19
 *
 * El `<Player>` de `@remotion/player` no puede reproducir vídeo en jsdom, por lo
 * que se sustituye por un stub inofensivo; además, la mayoría de los tests de
 * componente usan `video_url: null` para no montar la previsualización (que es
 * un nice-to-have) y centrarse en la edición/confirmación de tramos.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';

// Stub de `@remotion/player`: en jsdom el Player real no puede reproducir vídeo.
// Se sustituye por un elemento inerte que expone el `videoSrc` para poder
// aseverar (si hiciera falta) que el fondo es el vídeo unido.
vi.mock('@remotion/player', () => ({
  Player: (props: { inputProps?: { videoSrc?: string } }) => (
    <div
      data-testid="player-mock"
      data-video-src={props.inputProps?.videoSrc ?? ''}
    />
  ),
}));

import TimelineSilencios, { normalizarTramos } from '../TimelineSilencios';
import type { SilenciosEdicion, TramoSilencio } from '@/lib/types';

// Número de iteraciones por propiedad (>= 100 exigido por Req 19.6).
const NUM_RUNS = 300;

// ===========================================================================
// Generadores (arbitraries)
// ===========================================================================

/** Tiempo en segundos: finito, incluyendo negativos y valores fuera de rango. */
const arbTiempo = fc.double({
  min: -50,
  max: 150,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Un tramo con `inicio_s`/`fin_s` independientes (puede quedar invertido). */
const arbTramo: fc.Arbitrary<TramoSilencio> = fc.record({
  inicio_s: arbTiempo,
  fin_s: arbTiempo,
});

/** Lista de tramos posiblemente desordenada, solapada o fuera de rango. */
const arbTramos = fc.array(arbTramo, { maxLength: 12 });

/** Duración estrictamente positiva del vídeo unido. */
const arbDuracion = fc.double({
  min: 0.001,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

// ===========================================================================
// PBT — normalizarTramos (Req 3.5, 3.6, 19)
// ===========================================================================

describe('normalizarTramos (PBT, Req 19)', () => {
  it('(a) todos los tramos quedan dentro de [0, duración] (clamp)', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        for (const t of normalizarTramos(tramos, duracion)) {
          expect(t.inicio_s).toBeGreaterThanOrEqual(0);
          expect(t.fin_s).toBeLessThanOrEqual(duracion);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(b) ningún tramo tiene duración <= 0', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        for (const t of normalizarTramos(tramos, duracion)) {
          expect(t.fin_s).toBeGreaterThan(t.inicio_s);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(c) la lista queda ordenada ascendentemente por inicio_s', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const r = normalizarTramos(tramos, duracion);
        for (let i = 1; i < r.length; i++) {
          expect(r[i].inicio_s).toBeGreaterThanOrEqual(r[i - 1].inicio_s);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('(d) no hay solapes ni adyacencias: siguiente.inicio_s > actual.fin_s', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const r = normalizarTramos(tramos, duracion);
        for (let i = 1; i < r.length; i++) {
          expect(r[i].inicio_s).toBeGreaterThan(r[i - 1].fin_s);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('es una función pura: no muta la lista de entrada', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const copiaProfunda = tramos.map((t) => ({ ...t }));
        normalizarTramos(tramos, duracion);
        expect(tramos).toEqual(copiaProfunda);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Casos borde explícitos (unit tests)
// ===========================================================================

describe('normalizarTramos (casos borde)', () => {
  it('duración <= 0 devuelve lista vacía', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: 1, fin_s: 2 }];
    expect(normalizarTramos(tramos, 0)).toEqual([]);
    expect(normalizarTramos(tramos, -5)).toEqual([]);
    expect(normalizarTramos(tramos, Number.NaN)).toEqual([]);
  });

  it('recorta (clamp) los tramos fuera de rango a [0, duración]', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: -3, fin_s: 20 }];
    expect(normalizarTramos(tramos, 10)).toEqual([{ inicio_s: 0, fin_s: 10 }]);
  });

  it('descarta tramos degenerados (fin <= inicio) tras el clamp', () => {
    const tramos: TramoSilencio[] = [
      { inicio_s: 5, fin_s: 5 }, // duración 0
      { inicio_s: 8, fin_s: 4 }, // invertido
      { inicio_s: 20, fin_s: 30 }, // fuera de rango -> clamp a [10,10] -> descartado
    ];
    expect(normalizarTramos(tramos, 10)).toEqual([]);
  });

  it('fusiona tramos solapados en uno solo', () => {
    const tramos: TramoSilencio[] = [
      { inicio_s: 1, fin_s: 4 },
      { inicio_s: 3, fin_s: 6 },
    ];
    expect(normalizarTramos(tramos, 10)).toEqual([{ inicio_s: 1, fin_s: 6 }]);
  });

  it('fusiona tramos adyacentes (que se tocan en el borde)', () => {
    const tramos: TramoSilencio[] = [
      { inicio_s: 1, fin_s: 3 },
      { inicio_s: 3, fin_s: 5 },
    ];
    expect(normalizarTramos(tramos, 10)).toEqual([{ inicio_s: 1, fin_s: 5 }]);
  });

  it('ordena tramos desordenados y conserva los separados', () => {
    const tramos: TramoSilencio[] = [
      { inicio_s: 6, fin_s: 8 },
      { inicio_s: 1, fin_s: 2 },
    ];
    expect(normalizarTramos(tramos, 10)).toEqual([
      { inicio_s: 1, fin_s: 2 },
      { inicio_s: 6, fin_s: 8 },
    ]);
  });
});

// ===========================================================================
// Pruebas de componente (Testing Library + jsdom)
// ===========================================================================

/** Construye una respuesta `SilenciosEdicion` de prueba. */
function datosSilencios(
  overrides: Partial<SilenciosEdicion> = {},
): SilenciosEdicion {
  return {
    job_id: 'job-123',
    estado: 'esperando_edicion_silencios',
    editable: true,
    video_url: null,
    video_nombre: null,
    duracion_s: 10,
    fps: 30,
    ancho: 1080,
    alto: 1920,
    tramos: [
      { inicio_s: 1, fin_s: 2 },
      { inicio_s: 5, fin_s: 6 },
    ],
    ...overrides,
  };
}

describe('TimelineSilencios (componente)', () => {
  it('carga con obtenerFn inyectada y renderiza un bloque por tramo', async () => {
    const datos = datosSilencios();
    const obtenerFn = vi.fn().mockResolvedValue(datos);

    render(<TimelineSilencios jobId="job-123" obtenerFn={obtenerFn} />);

    // La carga inicial se dispara con el jobId al montar.
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));
    expect(obtenerFn.mock.calls[0][0]).toBe('job-123');

    // Un bloque por tramo (los dos tramos separados no se fusionan).
    expect(await screen.findByTestId('timeline-bloque-0')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bloque-1')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-bloque-2')).toBeNull();
    expect(screen.getByTestId('timeline-num-tramos')).toHaveTextContent('2');
  });

  it('"Confirmar" envía los tramos SANEADOS y luego invoca onEnviado', async () => {
    // Tramos de entrada solapados y fuera de rango: al confirmar deben llegar
    // ya normalizados (clamp + fusión + orden) a enviarFn.
    const datos = datosSilencios({
      tramos: [
        { inicio_s: 5, fin_s: 7 },
        { inicio_s: 6, fin_s: 8 }, // se fusiona con el anterior -> [5, 8]
        { inicio_s: -2, fin_s: 3 }, // clamp -> [0, 3]
      ],
    });
    const obtenerFn = vi.fn().mockResolvedValue(datos);
    const enviarFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-123', estado: 'en_ejecucion' });
    const onEnviado = vi.fn();

    render(
      <TimelineSilencios
        jobId="job-123"
        obtenerFn={obtenerFn}
        enviarFn={enviarFn}
        onEnviado={onEnviado}
      />,
    );

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByTestId('timeline-confirmar'));

    await waitFor(() => expect(enviarFn).toHaveBeenCalledTimes(1));
    const [jobIdArg, tramosArg] = enviarFn.mock.calls[0];
    expect(jobIdArg).toBe('job-123');
    // Tramos saneados: ordenados, fusionados y recortados a [0, duración].
    expect(tramosArg).toEqual([
      { inicio_s: 0, fin_s: 3 },
      { inicio_s: 5, fin_s: 8 },
    ]);

    // En éxito (202) se notifica al padre para que siga el progreso.
    await waitFor(() => expect(onEnviado).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('timeline-error')).toBeNull();
  });

  it('cuando el Job no es editable, "Confirmar" queda deshabilitado', async () => {
    const datos = datosSilencios({ estado: 'completado', editable: false });
    const obtenerFn = vi.fn().mockResolvedValue(datos);
    const enviarFn = vi.fn();

    render(
      <TimelineSilencios
        jobId="job-123"
        obtenerFn={obtenerFn}
        enviarFn={enviarFn}
      />,
    );

    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));
    const confirmar = await screen.findByTestId('timeline-confirmar');
    expect(confirmar).toBeDisabled();

    fireEvent.click(confirmar);
    expect(enviarFn).not.toHaveBeenCalled();
  });
});


// ===========================================================================
// Bugfix `anadir-tramo-silencio-fix`
// ---------------------------------------------------------------------------
// El botón "Añadir tramo" debe crear un tramo NUEVO en la posición del cursor
// (`cursorS`), sin agrandar (fusionar) el último tramo existente. Las pruebas
// siguientes cubren la metodología del bugfix:
//   - Condición del bug (tarea 1): FALLA sobre el código sin arreglar.
//   - Preservación (tarea 2): PASA sobre el código sin arreglar.
//   - Unitarias / PBT / integración del arreglo (tareas 4-6).
// ===========================================================================

import { act, cleanup } from '@testing-library/react';

/**
 * Dispara un evento de puntero con `clientX` real. En jsdom los eventos de
 * puntero sintéticos de Testing Library no arrastran `clientX`, por lo que se
 * usa `MouseEvent` (que sí lo implementa) con el tipo de puntero deseado. Los
 * manejadores del timeline leen `clientX` tanto del evento sintético de React
 * (pointerdown en la pista/bloques) como de los listeners nativos de `window`
 * (pointermove/pointerup del arrastre en curso).
 */
function dispararPuntero(
  target: EventTarget,
  tipo: 'pointerdown' | 'pointermove' | 'pointerup',
  clientX: number,
): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(tipo, {
        clientX,
        clientY: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** Ancho ficticio (px) de la pista para mapear píxeles ⇄ segundos en jsdom. */
const ANCHO_PISTA_PX = 1000;

/**
 * En jsdom `getBoundingClientRect` devuelve todo a 0, por lo que el scrubbing
 * (que convierte px→segundos con el ancho real de la pista) no podría mover el
 * cursor. Se parchea el rect de la pista para simular un ancho conocido y así
 * poder posicionar `cursorS` haciendo clic en la coordenada X equivalente.
 */
function parchearAnchoPista(pista: HTMLElement, ancho = ANCHO_PISTA_PX): void {
  pista.getBoundingClientRect = () =>
    ({
      width: ancho,
      height: 64,
      left: 0,
      top: 0,
      right: ancho,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Fija el cursor de scrubbing en `cursorS` segundos (clic en la pista). */
function fijarCursor(
  pista: HTMLElement,
  cursorS: number,
  duracion: number,
): void {
  const clientX = (Math.max(0, Math.min(cursorS, duracion)) / duracion) *
    ANCHO_PISTA_PX;
  dispararPuntero(pista, 'pointerdown', clientX);
}

/** Lee el número de tramos mostrado en el contador `timeline-num-tramos`. */
function leerNumTramos(): number {
  const txt = screen.getByTestId('timeline-num-tramos').textContent ?? '';
  return Number(txt.replace(/\D/g, ''));
}

/**
 * Reconstruye los tramos actuales leyendo la posición/anchura de cada bloque de
 * la pista (`left%`/`width%` relativos a `duracion`). Devuelve la lista ordenada.
 */
function leerTramosDOM(duracion: number): TramoSilencio[] {
  const bloques = screen.queryAllByTestId(/^timeline-bloque-\d+$/);
  const tramos = bloques.map((b) => {
    const izquierdaPct = parseFloat((b as HTMLElement).style.left) || 0;
    const anchoPct = parseFloat((b as HTMLElement).style.width) || 0;
    const inicio_s = (izquierdaPct / 100) * duracion;
    const fin_s = inicio_s + (anchoPct / 100) * duracion;
    return { inicio_s, fin_s };
  });
  return tramos.sort((a, b) => a.inicio_s - b.inicio_s);
}

/** Datos de prueba con valores por defecto editables y sin preview de vídeo. */
function datosSilenciosBug(
  overrides: Partial<SilenciosEdicion> = {},
): SilenciosEdicion {
  return {
    job_id: 'job-bug',
    estado: 'esperando_edicion_silencios',
    editable: true,
    video_url: null,
    video_nombre: null,
    duracion_s: 10,
    fps: 30,
    ancho: 1080,
    alto: 1920,
    tramos: [],
    ...overrides,
  };
}

/**
 * Renderiza el timeline con los datos dados, fija el cursor y pulsa "Añadir
 * tramo". Devuelve el número de tramos resultante y los tramos leídos del DOM.
 */
async function anadirEnCursor(caso: {
  duracion: number;
  tramos: TramoSilencio[];
  cursorS: number;
}): Promise<{ num: number; tramos: TramoSilencio[] }> {
  const datos = datosSilenciosBug({
    duracion_s: caso.duracion,
    tramos: caso.tramos,
  });
  const obtenerFn = vi.fn().mockResolvedValue(datos);
  render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
  await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

  const pista = await screen.findByTestId('timeline-pista');
  parchearAnchoPista(pista);
  fijarCursor(pista, caso.cursorS, caso.duracion);

  fireEvent.click(screen.getByTestId('timeline-anadir'));

  return { num: leerNumTramos(), tramos: leerTramosDOM(caso.duracion) };
}

// ---------------------------------------------------------------------------
// Tarea 1 — Prueba exploratoria de la CONDICIÓN DEL BUG (debe FALLAR sin arreglo)
// ---------------------------------------------------------------------------
// Property 1: Bug Condition — Añadir en zona libre incrementa el número de tramos.
// Validates: Requirements 1.1, 1.2, 1.3, 2.1
describe('anadirTramo — Bug Condition (Property 1)', () => {
  /**
   * Casos deterministas del diseño (zona libre): tras pulsar "Añadir tramo",
   * el número de tramos DEBE aumentar en 1 y el nuevo tramo NO debe compartir
   * borde con los vecinos (por eso `normalizarTramos` no lo fusiona).
   */
  const casosZonaLibre = [
    { duracion: 10, tramos: [{ inicio_s: 2, fin_s: 4 }], cursorS: 7 },
    { duracion: 20, tramos: [{ inicio_s: 0, fin_s: 3 }], cursorS: 12 },
    { duracion: 3, tramos: [{ inicio_s: 0, fin_s: 2.5 }], cursorS: 1 },
  ];

  it('al añadir con el cursor en zona libre, el número de tramos aumenta en 1', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...casosZonaLibre), async (caso) => {
        try {
          const base = normalizarTramos(caso.tramos, caso.duracion);
          const { num, tramos } = await anadirEnCursor(caso);

          // (Bug Condition) El conteo aumenta exactamente en 1 (no se fusiona).
          expect(num).toBe(base.length + 1);

          // El nuevo tramo aparece cerca del cursor (no pegado al último tramo).
          const cursor = Math.max(0, Math.min(caso.cursorS, caso.duracion));
          const hayTramoEnCursor = tramos.some(
            (t) => t.inicio_s <= cursor + 1e-6 && cursor <= t.fin_s + 1e-6,
          );
          expect(hayTramoEnCursor).toBe(true);
        } finally {
          cleanup();
        }
      }),
      { numRuns: casosZonaLibre.length },
    );
  });
});


// ---------------------------------------------------------------------------
// Tarea 2 — Pruebas de PRESERVACIÓN (deben PASAR sobre el código sin arreglar)
// ---------------------------------------------------------------------------
// Property 4 y 5: Preservación — operaciones distintas de "Añadir" y helpers
// puros permanecen sin cambios.
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5

/**
 * Simula un arrastre de puntero: presiona sobre `handle`, mueve el puntero por
 * `window` (donde el componente registra los listeners globales) y suelta.
 */
function arrastrar(
  handle: HTMLElement,
  xInicial: number,
  xFinal: number,
): void {
  dispararPuntero(handle, 'pointerdown', xInicial);
  dispararPuntero(window, 'pointermove', xFinal);
  dispararPuntero(window, 'pointerup', xFinal);
}

describe('Preservación — operaciones distintas de "Añadir" (Property 4)', () => {
  it('mover un bloque conserva la duración y aplica clamp a [0, duración]', async () => {
    const duracion = 10;
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        duracion_s: duracion,
        tramos: [{ inicio_s: 5, fin_s: 6 }],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const pista = await screen.findByTestId('timeline-pista');
    parchearAnchoPista(pista);

    // Mover el cuerpo +1 s (100 px sobre 1000 px = 0.1 de 10 s = 1 s).
    const bloque = screen.getByTestId('timeline-bloque-0');
    arrastrar(bloque, 500, 600);

    let tramos = leerTramosDOM(duracion);
    expect(tramos).toHaveLength(1);
    expect(tramos[0].inicio_s).toBeCloseTo(6, 5);
    expect(tramos[0].fin_s).toBeCloseTo(7, 5);
    // Duración conservada.
    expect(tramos[0].fin_s - tramos[0].inicio_s).toBeCloseTo(1, 5);

    // Mover muy a la derecha: clamp para no salir de [0, duración].
    const bloque2 = screen.getByTestId('timeline-bloque-0');
    arrastrar(bloque2, 600, 5000);
    tramos = leerTramosDOM(duracion);
    expect(tramos[0].fin_s).toBeLessThanOrEqual(duracion + 1e-6);
    expect(tramos[0].inicio_s).toBeGreaterThanOrEqual(0);
    expect(tramos[0].fin_s - tramos[0].inicio_s).toBeCloseTo(1, 5);
  });

  it('estirar por el borde derecho mantiene inicio_s < fin_s y clamp', async () => {
    const duracion = 10;
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        duracion_s: duracion,
        tramos: [{ inicio_s: 3, fin_s: 5 }],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const pista = await screen.findByTestId('timeline-pista');
    parchearAnchoPista(pista);

    // Arrastrar el borde derecho +2 s → fin 7.
    const bordeFin = screen.getByTestId('timeline-borde-fin-0');
    arrastrar(bordeFin, 500, 700);

    const tramos = leerTramosDOM(duracion);
    expect(tramos[0].inicio_s).toBeCloseTo(3, 5);
    expect(tramos[0].fin_s).toBeCloseTo(7, 5);
    expect(tramos[0].fin_s).toBeGreaterThan(tramos[0].inicio_s);
  });

  it('eliminar un tramo quita solo el indicado, el resto intacto', async () => {
    const duracion = 10;
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        duracion_s: duracion,
        tramos: [
          { inicio_s: 1, fin_s: 2 },
          { inicio_s: 4, fin_s: 5 },
          { inicio_s: 7, fin_s: 8 },
        ],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));
    await screen.findByTestId('timeline-bloque-0');

    // Eliminar el del medio (índice 1).
    fireEvent.click(screen.getByTestId('timeline-eliminar-1'));

    const tramos = leerTramosDOM(duracion);
    expect(tramos).toHaveLength(2);
    expect(tramos[0]).toMatchObject({ inicio_s: 1 });
    expect(tramos[1].inicio_s).toBeCloseTo(7, 5);
  });

  it('en solo-lectura (editable=false) añadir queda deshabilitado y no hay botón eliminar', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        estado: 'completado',
        editable: false,
        tramos: [{ inicio_s: 1, fin_s: 2 }],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));
    await screen.findByTestId('timeline-bloque-0');

    expect(screen.getByTestId('timeline-anadir')).toBeDisabled();
    expect(screen.queryByTestId('timeline-eliminar-0')).toBeNull();
  });
});

describe('Preservación — helpers puros intactos (Property 5)', () => {
  it('normalizarTramos es idempotente', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const una = normalizarTramos(tramos, duracion);
        const dos = normalizarTramos(una, duracion);
        expect(dos).toEqual(una);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('segmentosConservar es idempotente respecto a normalizarTramos de entrada', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const directo = segmentosConservar(tramos, duracion);
        const desdeSaneado = segmentosConservar(
          normalizarTramos(tramos, duracion),
          duracion,
        );
        expect(desdeSaneado).toEqual(directo);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});


// ---------------------------------------------------------------------------
// Tarea 4 — Pruebas UNITARIAS del arreglo (casos concretos y límite)
// ---------------------------------------------------------------------------
// Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.3, 3.4

/** Encuentra el tramo "nuevo" de `resultado` que no coincide con la base. */
function tramoNuevoRespectoA(
  base: TramoSilencio[],
  resultado: TramoSilencio[],
  tol = 1e-4,
): TramoSilencio | undefined {
  return resultado.find(
    (r) =>
      !base.some(
        (b) =>
          Math.abs(b.inicio_s - r.inicio_s) < tol &&
          Math.abs(b.fin_s - r.fin_s) < tol,
      ),
  );
}

describe('anadirTramo — unitarias del arreglo (Expected Behavior)', () => {
  it('timeline vacío: coloca el tramo en el cursor (principio, medio, final)', async () => {
    // Principio (cursor 0).
    let r = await anadirEnCursor({ duracion: 10, tramos: [], cursorS: 0 });
    expect(r.num).toBe(1);
    expect(r.tramos[0].inicio_s).toBeCloseTo(0, 5);
    expect(r.tramos[0].fin_s).toBeCloseTo(1, 5);
    cleanup();

    // Medio (cursor 5).
    r = await anadirEnCursor({ duracion: 10, tramos: [], cursorS: 5 });
    expect(r.num).toBe(1);
    expect(r.tramos[0].inicio_s).toBeCloseTo(5, 5);
    expect(r.tramos[0].fin_s).toBeCloseTo(6, 5);
    cleanup();

    // Final (cursor = duración): se retrocede para caber dentro de [0, d].
    r = await anadirEnCursor({ duracion: 10, tramos: [], cursorS: 10 });
    expect(r.num).toBe(1);
    expect(r.tramos[0].fin_s).toBeCloseTo(10, 5);
    expect(r.tramos[0].inicio_s).toBeCloseTo(9, 5);
  });

  it('cursor dentro de un tramo: usa el hueco libre más cercano sin agrandarlo', async () => {
    const base = normalizarTramos([{ inicio_s: 3, fin_s: 6 }], 10);
    const r = await anadirEnCursor({
      duracion: 10,
      tramos: [{ inicio_s: 3, fin_s: 6 }],
      cursorS: 4, // dentro del tramo [3,6]
    });
    expect(r.num).toBe(2);
    // El tramo [3,6] se conserva sin cambios.
    expect(r.tramos.some((t) => Math.abs(t.inicio_s - 3) < 1e-4 && Math.abs(t.fin_s - 6) < 1e-4)).toBe(true);
    // El nuevo tramo cae en el hueco posterior [6,10], sin tocar el borde 6.
    const nuevo = tramoNuevoRespectoA(base, r.tramos)!;
    expect(nuevo.inicio_s).toBeGreaterThan(6);
    expect(nuevo.fin_s).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('cursor pegado al borde de un tramo: no se fusiona (queda estrictamente dentro del hueco)', async () => {
    const base = normalizarTramos([{ inicio_s: 2, fin_s: 4 }], 10);
    const r = await anadirEnCursor({
      duracion: 10,
      tramos: [{ inicio_s: 2, fin_s: 4 }],
      cursorS: 4, // justo en el borde derecho del tramo
    });
    expect(r.num).toBe(2);
    const nuevo = tramoNuevoRespectoA(base, r.tramos)!;
    expect(nuevo.inicio_s).toBeGreaterThan(4);
  });

  it('hueco más pequeño que la duración por defecto: el tramo se ajusta al hueco', async () => {
    const r = await anadirEnCursor({
      duracion: 3,
      tramos: [{ inicio_s: 0, fin_s: 2.5 }],
      cursorS: 2.75, // dentro del hueco [2.5, 3]
    });
    expect(r.num).toBe(2);
    const nuevo = tramoNuevoRespectoA(
      normalizarTramos([{ inicio_s: 0, fin_s: 2.5 }], 3),
      r.tramos,
    )!;
    expect(nuevo.inicio_s).toBeCloseTo(2.75, 5);
    expect(nuevo.fin_s).toBeCloseTo(3, 5);
    expect(nuevo.fin_s - nuevo.inicio_s).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('timeline lleno (sin huecos): no añade nada (devuelve la lista igual)', async () => {
    const r = await anadirEnCursor({
      duracion: 5,
      tramos: [{ inicio_s: 0, fin_s: 5 }],
      cursorS: 2,
    });
    expect(r.num).toBe(1);
    expect(r.tramos[0].inicio_s).toBeCloseTo(0, 5);
    expect(r.tramos[0].fin_s).toBeCloseTo(5, 5);
  });

  it('con duración no positiva, "Añadir tramo" queda deshabilitado', async () => {
    const obtenerFn = vi
      .fn()
      .mockResolvedValue(datosSilenciosBug({ duracion_s: 0, tramos: [] }));
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('timeline-anadir')).toBeDisabled();
  });
});


// ---------------------------------------------------------------------------
// Tarea 5 — Pruebas BASADAS EN PROPIEDADES del arreglo (fast-check)
// ---------------------------------------------------------------------------
// Property 3 (conservación de tramos no solapados), Property 2 (refuerzo:
// clamp/duración/cursor) y Property 5 (helpers puros intactos).
// Validates: Requirements 2.1, 2.2, 2.3, 3.2, 3.5

/** Iteraciones para las PBT que renderizan el componente (más costosas). */
const NUM_RUNS_COMPONENTE = 40;

/**
 * Genera un escenario en ZONA LIBRE: una lista de tramos ya normalizada
 * (disjuntos con huecos >= 2 s entre ellos), su duración y un cursor situado
 * en el CENTRO de uno de los huecos (estrictamente interior, a >= 1 s de los
 * bordes). Construido con anchos enteros para evitar epsilons de coma flotante.
 */
const arbEscenarioZonaLibre = fc
  .record({
    anchosTramos: fc.array(fc.integer({ min: 1, max: 3 }), {
      minLength: 0,
      maxLength: 3,
    }),
    anchosGaps: fc.array(fc.integer({ min: 2, max: 4 }), {
      minLength: 1,
      maxLength: 4,
    }),
    gapElegido: fc.nat(),
  })
  .map(({ anchosTramos, anchosGaps, gapElegido }) => {
    const n = anchosTramos.length;
    // Se necesitan n+1 huecos (antes/entre/después de los tramos).
    const gaps: number[] = [];
    for (let i = 0; i <= n; i++) gaps.push(anchosGaps[i % anchosGaps.length]);

    const tramos: TramoSilencio[] = [];
    let x = 0;
    for (let i = 0; i < n; i++) {
      x += gaps[i]; // hueco antes del tramo i
      tramos.push({ inicio_s: x, fin_s: x + anchosTramos[i] });
      x += anchosTramos[i];
    }
    x += gaps[n]; // hueco final
    const duracion = x;

    const idx = gapElegido % (n + 1);
    let gapStart = 0;
    for (let i = 0; i < idx; i++) gapStart += gaps[i] + anchosTramos[i];
    const cursor = gapStart + gaps[idx] / 2;

    return { duracion, tramos, cursor };
  });

describe('anadirTramo — PBT del arreglo (Properties 2 y 3)', () => {
  it('Property 3: conserva los tramos no solapados y la salida queda ordenada y sin solapes', async () => {
    await fc.assert(
      fc.asyncProperty(arbEscenarioZonaLibre, async (esc) => {
        try {
          const base = normalizarTramos(esc.tramos, esc.duracion);
          const { num, tramos } = await anadirEnCursor({
            duracion: esc.duracion,
            tramos: esc.tramos,
            cursorS: esc.cursor,
          });

          // El número de tramos aumenta en 1.
          expect(num).toBe(base.length + 1);

          // Todos los tramos originales siguen presentes (sin cambios).
          for (const b of base) {
            expect(
              tramos.some(
                (t) =>
                  Math.abs(t.inicio_s - b.inicio_s) < 1e-4 &&
                  Math.abs(t.fin_s - b.fin_s) < 1e-4,
              ),
            ).toBe(true);
          }

          // Ordenada ascendentemente y sin solapes.
          for (let i = 1; i < tramos.length; i++) {
            expect(tramos[i].inicio_s).toBeGreaterThan(
              tramos[i - 1].fin_s - 1e-6,
            );
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS_COMPONENTE },
    );
  });

  it('Property 2: el nuevo tramo cumple 0 <= inicio < fin <= d, dur <= 1 s e inicio en el cursor cuando cabe', async () => {
    await fc.assert(
      fc.asyncProperty(arbEscenarioZonaLibre, async (esc) => {
        try {
          const base = normalizarTramos(esc.tramos, esc.duracion);
          const { tramos } = await anadirEnCursor({
            duracion: esc.duracion,
            tramos: esc.tramos,
            cursorS: esc.cursor,
          });
          const nuevo = tramoNuevoRespectoA(base, tramos)!;
          expect(nuevo).toBeDefined();

          // Clamp válido e invariante inicio < fin.
          expect(nuevo.inicio_s).toBeGreaterThanOrEqual(-1e-6);
          expect(nuevo.fin_s).toBeLessThanOrEqual(esc.duracion + 1e-6);
          expect(nuevo.fin_s).toBeGreaterThan(nuevo.inicio_s);

          // Duración como máximo la por defecto (1 s).
          expect(nuevo.fin_s - nuevo.inicio_s).toBeLessThanOrEqual(1 + 1e-6);

          // El cursor cae en el interior del hueco con holgura => inicio == cursor.
          expect(nuevo.inicio_s).toBeCloseTo(esc.cursor, 4);
        } finally {
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS_COMPONENTE },
    );
  });
});

describe('Property 5 (PBT) — normalizarTramos / segmentosConservar intactos', () => {
  it('segmentosConservar devuelve segmentos ordenados, sin solapes y dentro de [0, d]', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const segs = segmentosConservar(tramos, duracion);
        for (const s of segs) {
          expect(s.inicioS).toBeGreaterThanOrEqual(0);
          expect(s.finS).toBeLessThanOrEqual(duracion);
          expect(s.finS).toBeGreaterThan(s.inicioS);
        }
        for (let i = 1; i < segs.length; i++) {
          expect(segs[i].inicioS).toBeGreaterThanOrEqual(segs[i - 1].finS);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('normalizarTramos preserva la unión temporal (idempotencia + estabilidad de la medida)', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const una = normalizarTramos(tramos, duracion);
        const dos = normalizarTramos(una, duracion);
        expect(dos).toEqual(una);
        // La medida total (suma de longitudes) no cambia al re-normalizar.
        const medida = (ts: TramoSilencio[]) =>
          ts.reduce((acc, t) => acc + (t.fin_s - t.inicio_s), 0);
        expect(medida(dos)).toBeCloseTo(medida(una), 6);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});


// ---------------------------------------------------------------------------
// Tarea 6 — Pruebas de INTEGRACIÓN (Testing Library)
// ---------------------------------------------------------------------------
// Flujo completo de "Añadir tramo" + confirmar, y preservación de la preview.
// Property 4: las operaciones distintas de "Añadir" no cambian.
// Validates: Requirements 2.1, 3.1, 3.2, 3.3, 3.4, 3.5

describe('TimelineSilencios — integración del arreglo', () => {
  it('mover el cursor con clic en la pista y añadir crea un bloque nuevo (contador +1)', async () => {
    const duracion = 20;
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        duracion_s: duracion,
        tramos: [{ inicio_s: 2, fin_s: 4 }],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const pista = await screen.findByTestId('timeline-pista');
    parchearAnchoPista(pista);

    expect(screen.getByTestId('timeline-num-tramos')).toHaveTextContent('1');
    expect(screen.queryByTestId('timeline-bloque-1')).toBeNull();

    // Clic en la pista para llevar el cursor a 12 s (zona libre) y añadir.
    fijarCursor(pista, 12, duracion);
    fireEvent.click(screen.getByTestId('timeline-anadir'));

    expect(screen.getByTestId('timeline-num-tramos')).toHaveTextContent('2');
    expect(screen.getByTestId('timeline-bloque-1')).toBeInTheDocument();

    // El nuevo bloque aparece alrededor del cursor (12 s), no pegado a [2,4].
    const tramos = leerTramosDOM(duracion);
    expect(tramos.some((t) => Math.abs(t.inicio_s - 12) < 1e-3)).toBe(true);
  });

  it('añadir varios tramos y confirmar envía la lista saneada e invoca onEnviado', async () => {
    const duracion = 20;
    const obtenerFn = vi
      .fn()
      .mockResolvedValue(datosSilenciosBug({ duracion_s: duracion, tramos: [] }));
    const enviarFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-bug', estado: 'en_ejecucion' });
    const onEnviado = vi.fn();

    render(
      <TimelineSilencios
        jobId="job-bug"
        obtenerFn={obtenerFn}
        enviarFn={enviarFn}
        onEnviado={onEnviado}
      />,
    );
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    const pista = await screen.findByTestId('timeline-pista');
    parchearAnchoPista(pista);

    // Añadir en 3 s y en 10 s (dos zonas libres distintas).
    fijarCursor(pista, 3, duracion);
    fireEvent.click(screen.getByTestId('timeline-anadir'));
    fijarCursor(pista, 10, duracion);
    fireEvent.click(screen.getByTestId('timeline-anadir'));

    expect(screen.getByTestId('timeline-num-tramos')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('timeline-confirmar'));
    await waitFor(() => expect(enviarFn).toHaveBeenCalledTimes(1));

    const [jobIdArg, tramosArg] = enviarFn.mock.calls[0];
    expect(jobIdArg).toBe('job-bug');
    expect(tramosArg).toEqual([
      { inicio_s: 3, fin_s: 4 },
      { inicio_s: 10, fin_s: 11 },
    ]);
    await waitFor(() => expect(onEnviado).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('timeline-error')).toBeNull();
  });

  it('la previsualización recortada sigue montada tras añadir un tramo (sin romperse)', async () => {
    const duracion = 10;
    const obtenerFn = vi.fn().mockResolvedValue(
      datosSilenciosBug({
        duracion_s: duracion,
        video_url: 'http://127.0.0.1:8000/workfile/job-bug/unido.mp4',
        tramos: [{ inicio_s: 1, fin_s: 2 }],
      }),
    );
    render(<TimelineSilencios jobId="job-bug" obtenerFn={obtenerFn} />);
    await waitFor(() => expect(obtenerFn).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId('timeline-preview')).toBeInTheDocument();

    const pista = await screen.findByTestId('timeline-pista');
    parchearAnchoPista(pista);

    // Añadir un tramo en zona libre (cursor 6 s) y comprobar que la preview
    // (que depende de segmentosConservar) se recalcula sin romperse.
    fijarCursor(pista, 6, duracion);
    fireEvent.click(screen.getByTestId('timeline-anadir'));

    expect(screen.getByTestId('timeline-num-tramos')).toHaveTextContent('2');
    expect(screen.getByTestId('timeline-preview')).toBeInTheDocument();
    expect(screen.getByTestId('player-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-error')).toBeNull();
  });
});
