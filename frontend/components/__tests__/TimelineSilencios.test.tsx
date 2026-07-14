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
