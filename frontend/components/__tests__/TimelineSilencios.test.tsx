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
// aseverar (si hiciera falta) que el fondo es el vídeo unido. Se usa
// `forwardRef` porque el timeline pasa un `ref` al Player (para el scrubbing);
// el ref se ignora en el stub (queda `null`, y los efectos lo comprueban).
vi.mock('@remotion/player', async () => {
  const React = await import('react');
  return {
    Player: React.forwardRef(
      (props: { inputProps?: { videoSrc?: string } }, _ref: unknown) => (
        <div
          data-testid="player-mock"
          data-video-src={props.inputProps?.videoSrc ?? ''}
        />
      ),
    ),
  };
});

import TimelineSilencios, {
  cutFrameATiempoOriginal,
  normalizarTramos,
  segmentosConservar,
  tiempoOriginalACutFrame,
} from '../TimelineSilencios';
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
// segmentosConservar — complemento de los tramos (preview recortada, Req 4.1)
// ===========================================================================

describe('segmentosConservar (complemento de tramos a borrar)', () => {
  it('sin tramos: conserva todo el vídeo en un único segmento', () => {
    expect(segmentosConservar([], 10)).toEqual([{ inicioS: 0, finS: 10 }]);
  });

  it('un tramo central produce dos segmentos (antes y después)', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: 4, fin_s: 6 }];
    expect(segmentosConservar(tramos, 10)).toEqual([
      { inicioS: 0, finS: 4 },
      { inicioS: 6, finS: 10 },
    ]);
  });

  it('borrar todo el metraje deja la lista vacía', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: 0, fin_s: 10 }];
    expect(segmentosConservar(tramos, 10)).toEqual([]);
  });

  it('dos tramos separados producen tres segmentos', () => {
    const tramos: TramoSilencio[] = [
      { inicio_s: 2, fin_s: 3 },
      { inicio_s: 6, fin_s: 7 },
    ];
    expect(segmentosConservar(tramos, 10)).toEqual([
      { inicioS: 0, finS: 2 },
      { inicioS: 3, finS: 6 },
      { inicioS: 7, finS: 10 },
    ]);
  });

  it('un tramo pegado al inicio deja solo la cola', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: 0, fin_s: 4 }];
    expect(segmentosConservar(tramos, 10)).toEqual([{ inicioS: 4, finS: 10 }]);
  });

  it('sanea (fusiona/ordena) los tramos antes de calcular el complemento', () => {
    // Tramos desordenados y solapados: se normalizan a [2,6] antes de complementar.
    const tramos: TramoSilencio[] = [
      { inicio_s: 4, fin_s: 6 },
      { inicio_s: 2, fin_s: 5 },
    ];
    expect(segmentosConservar(tramos, 10)).toEqual([
      { inicioS: 0, finS: 2 },
      { inicioS: 6, finS: 10 },
    ]);
  });

  it('duración no positiva devuelve lista vacía', () => {
    expect(segmentosConservar([{ inicio_s: 1, fin_s: 2 }], 0)).toEqual([]);
    expect(segmentosConservar([], -3)).toEqual([]);
  });

  it('es una función pura: no muta la lista de entrada', () => {
    const tramos: TramoSilencio[] = [{ inicio_s: 4, fin_s: 6 }];
    const copia = tramos.map((t) => ({ ...t }));
    segmentosConservar(tramos, 10);
    expect(tramos).toEqual(copia);
  });

  it('PBT: la duración total conservada + borrada == duración (Req 19)', () => {
    fc.assert(
      fc.property(arbTramos, arbDuracion, (tramos, duracion) => {
        const conservar = segmentosConservar(tramos, duracion);
        const borrar = normalizarTramos(tramos, duracion);
        const sum = (pares: { a: number; b: number }[]) =>
          pares.reduce((acc, p) => acc + (p.b - p.a), 0);
        const totalConservar = sum(
          conservar.map((s) => ({ a: s.inicioS, b: s.finS })),
        );
        const totalBorrar = sum(
          borrar.map((t) => ({ a: t.inicio_s, b: t.fin_s })),
        );
        // El complemento cubre exactamente lo que no se borra (salvo epsilon fp).
        expect(totalConservar + totalBorrar).toBeCloseTo(duracion, 6);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Mapeo cut-time <-> tiempo original (cursor y seek de la preview, Req 4.1)
// ===========================================================================

describe('cutFrameATiempoOriginal / tiempoOriginalACutFrame', () => {
  // Vídeo de 10 s a 30 fps con un tramo rojo central [4, 6]:
  // segmentos a conservar = [0,4] (120 frames) y [6,10] (120 frames).
  const fps = 30;
  const segmentos = segmentosConservar([{ inicio_s: 4, fin_s: 6 }], 10);

  it('mapea el cut-frame al tiempo original saltando el tramo rojo', () => {
    // Inicio del cut-time -> inicio original.
    expect(cutFrameATiempoOriginal(0, segmentos, fps)).toBeCloseTo(0, 6);
    // Frame 60 (2 s de cut) cae en el primer segmento [0,4] -> 2 s original.
    expect(cutFrameATiempoOriginal(60, segmentos, fps)).toBeCloseTo(2, 6);
    // Frame 120 = fin del primer segmento -> inicio del segundo (6 s original).
    expect(cutFrameATiempoOriginal(120, segmentos, fps)).toBeCloseTo(6, 6);
    // Frame 150 (1 s dentro del segundo segmento) -> 7 s original.
    expect(cutFrameATiempoOriginal(150, segmentos, fps)).toBeCloseTo(7, 6);
  });

  it('un tiempo original dentro del tramo rojo salta al inicio del siguiente segmento (cut-frame)', () => {
    // 5 s original está en el tramo rojo [4,6]: se ancla al inicio del segundo
    // segmento, cuyo cut-frame es 120.
    expect(tiempoOriginalACutFrame(5, segmentos, fps)).toBe(120);
  });

  it('ida y vuelta coherente en tiempos que caen dentro de un segmento', () => {
    // 7 s original -> cut-frame 150 -> de vuelta 7 s.
    const cut = tiempoOriginalACutFrame(7, segmentos, fps);
    expect(cut).toBe(150);
    expect(cutFrameATiempoOriginal(cut, segmentos, fps)).toBeCloseTo(7, 6);
  });

  it('sin segmentos devuelve 0 en ambos sentidos', () => {
    expect(cutFrameATiempoOriginal(10, [], fps)).toBe(0);
    expect(tiempoOriginalACutFrame(3, [], fps)).toBe(0);
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

  it('con video_url y segmentos, monta la preview recortada y la barra de posición', async () => {
    const datos = datosSilencios({
      video_url: 'http://127.0.0.1:8000/workfile/job-123/unido.mp4',
      // Tramo central: quedan segmentos [0,1] y [2,10] a conservar.
      tramos: [{ inicio_s: 1, fin_s: 2 }],
    });
    const obtenerFn = vi.fn().mockResolvedValue(datos);

    render(<TimelineSilencios jobId="job-123" obtenerFn={obtenerFn} />);

    // Se monta la preview (con el vídeo unido) y la barra de posición.
    expect(await screen.findByTestId('timeline-preview')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-barra-progreso')).toBeInTheDocument();
    const player = screen.getByTestId('player-mock');
    expect(player).toHaveAttribute('data-video-src', datos.video_url);
    // No hay estado vacío mientras queden segmentos.
    expect(screen.queryByTestId('timeline-preview-vacia')).toBeNull();
  });

  it('si se marca todo el metraje para borrar, muestra el estado vacío (sin Player)', async () => {
    const datos = datosSilencios({
      video_url: 'http://127.0.0.1:8000/workfile/job-123/unido.mp4',
      // Un único tramo que cubre TODO el vídeo => no queda nada que conservar.
      tramos: [{ inicio_s: 0, fin_s: 10 }],
    });
    const obtenerFn = vi.fn().mockResolvedValue(datos);

    render(<TimelineSilencios jobId="job-123" obtenerFn={obtenerFn} />);

    // Estado vacío en lugar del Player/preview.
    expect(
      await screen.findByTestId('timeline-preview-vacia'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-preview')).toBeNull();
    expect(screen.queryByTestId('player-mock')).toBeNull();
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
