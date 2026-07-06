/**
 * Tests unitarios del flujo de UI (Tarea 20.5).
 *
 * Cubren el disparo del procesamiento, el seguimiento de progreso y el
 * resultado, verificando:
 *   - Envío del `Orden_de_Clips` vigente a `POST /procesar` (Req 2.3).
 *   - Envío con todos los ajustes válidos (Req 9.5).
 *   - Bloqueo del envío señalando el campo inválido, conservando ajustes (Req 9.6).
 *   - Fallo de `POST /procesar`: mensaje de error conservando ajustes (Req 9.8).
 *   - Refresco del progreso por paso/porcentaje vía suscripción (Req 10.6).
 *   - Estado fallido con paso y motivo (Req 10.7).
 *   - Previsualización reproducible y descarga del Video_Final (Req 11.1, 11.2).
 *   - Fallback cuando la previsualización no carga (Req 11.5).
 *
 * Se mockea `api.procesar` y `progress.suscribirProgreso` conservando el resto
 * de cada módulo mediante `importActual`.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  type Mock,
} from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ProcessButton from '../ProcessButton';
import ProgressPanel from '../ProgressPanel';
import ResultPreview from '../ResultPreview';
import { ApiError, procesar } from '@/lib/api';
import { suscribirProgreso, type SuscribirProgresoOpciones } from '@/lib/progress';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import type { Ajustes, JobProgress } from '@/lib/types';

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, procesar: vi.fn() };
});

vi.mock('@/lib/progress', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/progress')>();
  return { ...actual, suscribirProgreso: vi.fn() };
});

const procesarMock = procesar as unknown as Mock;
const suscribirMock = suscribirProgreso as unknown as Mock;

/** Ajustes válidos (por defecto) usados como base en las pruebas. */
const AJUSTES_VALIDOS: Ajustes = AJUSTES_POR_DEFECTO;

/** Progreso de ejemplo en ejecución. */
function progresoEnEjecucion(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    job_id: 'job_1',
    estado: 'en_ejecucion',
    paso_actual: 'TRANSCRIBIR',
    indice_paso: 3,
    total_pasos: 5,
    porcentaje: 55,
    mensaje: 'Transcribiendo audio…',
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  procesarMock.mockReset();
  suscribirMock.mockReset();
});

describe('ProcessButton — envío del orden vigente y ajustes (Req 2.3, 9.5)', () => {
  it('envía el Orden_de_Clips vigente + ajustes + musica_id a POST /procesar', async () => {
    procesarMock.mockResolvedValueOnce({ job_id: 'job_42', estado: 'en_cola' });
    const onJobIniciado = vi.fn();

    render(
      <ProcessButton
        ordenClips={['c1', 'c2', 'c3']}
        ajustes={AJUSTES_VALIDOS}
        musicaId="mus_1"
        onJobIniciado={onJobIniciado}
      />,
    );

    fireEvent.click(screen.getByTestId('procesar'));

    await waitFor(() => expect(onJobIniciado).toHaveBeenCalledWith('job_42'));

    expect(procesarMock).toHaveBeenCalledTimes(1);
    const peticion = procesarMock.mock.calls[0][0];
    // Req 2.3: el orden enviado es exactamente el orden vigente.
    expect(peticion.orden_clips).toEqual(['c1', 'c2', 'c3']);
    // Req 9.5: ajustes completos + música incluidos.
    expect(peticion.ajustes).toEqual(AJUSTES_VALIDOS);
    expect(peticion.musica_id).toBe('mus_1');
  });

  it('preserva el orden distinto que recibe (no lo reordena)', async () => {
    procesarMock.mockResolvedValueOnce({ job_id: 'j', estado: 'en_cola' });

    render(
      <ProcessButton
        ordenClips={['z', 'a', 'm']}
        ajustes={AJUSTES_VALIDOS}
        musicaId={null}
      />,
    );

    fireEvent.click(screen.getByTestId('procesar'));
    await waitFor(() => expect(procesarMock).toHaveBeenCalledTimes(1));
    expect(procesarMock.mock.calls[0][0].orden_clips).toEqual(['z', 'a', 'm']);
  });
});

describe('ProcessButton — validación global previa (Req 9.6)', () => {
  it('bloquea el envío sin clips e identifica el campo inválido', () => {
    render(
      <ProcessButton ordenClips={[]} ajustes={AJUSTES_VALIDOS} musicaId={null} />,
    );

    fireEvent.click(screen.getByTestId('procesar'));

    const error = screen.getByTestId('error-validacion');
    expect(error).toHaveAttribute('data-campo', 'orden_clips');
    expect(procesarMock).not.toHaveBeenCalled();
  });

  it('bloquea el envío con un ajuste fuera de rango señalando el campo', () => {
    const ajustesInvalidos: Ajustes = {
      ...AJUSTES_VALIDOS,
      generales: { ...AJUSTES_VALIDOS.generales, fps: 9999 },
    };

    render(
      <ProcessButton
        ordenClips={['c1']}
        ajustes={ajustesInvalidos}
        musicaId={null}
      />,
    );

    fireEvent.click(screen.getByTestId('procesar'));

    expect(screen.getByTestId('error-validacion')).toHaveAttribute(
      'data-campo',
      'generales.fps',
    );
    expect(procesarMock).not.toHaveBeenCalled();
  });
});

describe('ProcessButton — fallo del envío conserva ajustes (Req 9.8)', () => {
  it('muestra error de envío y no notifica job, conservando los ajustes', async () => {
    procesarMock.mockRejectedValueOnce(
      new ApiError('INTERNAL', 'backend caído', 500, null),
    );
    const onJobIniciado = vi.fn();

    render(
      <ProcessButton
        ordenClips={['c1', 'c2']}
        ajustes={AJUSTES_VALIDOS}
        musicaId={null}
        onJobIniciado={onJobIniciado}
      />,
    );

    fireEvent.click(screen.getByTestId('procesar'));

    const error = await screen.findByTestId('error-envio');
    expect(error).toHaveTextContent(/no se pudo iniciar/i);
    // No se inició ningún Job.
    expect(onJobIniciado).not.toHaveBeenCalled();
    // Los ajustes enviados siguen intactos (no se mutaron).
    expect(procesarMock.mock.calls[0][0].ajustes).toEqual(AJUSTES_VALIDOS);
  });
});

describe('ProgressPanel — refresco de progreso (Req 10.6, 10.7)', () => {
  it('muestra el paso actual y el porcentaje al recibir actualizaciones', () => {
    let opciones: SuscribirProgresoOpciones | undefined;
    suscribirMock.mockImplementation(
      (_jobId: string, opts: SuscribirProgresoOpciones) => {
        opciones = opts;
        return () => {};
      },
    );

    render(<ProgressPanel jobId="job_1" />);

    // La suscripción se abre al montar.
    expect(suscribirMock).toHaveBeenCalledTimes(1);

    // Simula una actualización de progreso entregada por la suscripción.
    act(() => opciones?.onProgress(progresoEnEjecucion()));

    expect(screen.getByTestId('progress-porcentaje')).toHaveTextContent('55%');
    expect(screen.getByTestId('progress-paso')).toHaveTextContent('Paso 3 de 5');
    expect(screen.getByTestId('progress-paso')).toHaveTextContent(
      /transcribir/i,
    );
    expect(screen.getByTestId('progress-estado')).toHaveTextContent(
      /procesando/i,
    );
  });

  it('refleja el estado fallido con su paso y motivo (Req 10.7)', () => {
    let opciones: SuscribirProgresoOpciones | undefined;
    suscribirMock.mockImplementation(
      (_jobId: string, opts: SuscribirProgresoOpciones) => {
        opciones = opts;
        return () => {};
      },
    );

    render(<ProgressPanel jobId="job_1" />);

    act(() =>
      opciones?.onProgress(
        progresoEnEjecucion({
          estado: 'fallido',
          error: { paso: 'TRANSCRIBIR', motivo: 'audio ilegible' },
        }),
      ),
    );

    const error = screen.getByTestId('progress-error');
    expect(error).toHaveTextContent(/TRANSCRIBIR/);
    expect(error).toHaveTextContent(/audio ilegible/);
  });

  it('cancela la suscripción al desmontar', () => {
    const cancelar = vi.fn();
    suscribirMock.mockReturnValue(cancelar);

    const { unmount } = render(<ProgressPanel jobId="job_1" />);
    unmount();

    expect(cancelar).toHaveBeenCalledTimes(1);
  });

  it('notifica onCompletado cuando el Job finaliza', () => {
    let opciones: SuscribirProgresoOpciones | undefined;
    suscribirMock.mockImplementation(
      (_jobId: string, opts: SuscribirProgresoOpciones) => {
        opciones = opts;
        return () => {};
      },
    );
    const onCompletado = vi.fn();

    render(<ProgressPanel jobId="job_1" onCompletado={onCompletado} />);

    act(() =>
      opciones?.onDone?.(
        progresoEnEjecucion({ estado: 'completado', porcentaje: 100 }),
      ),
    );

    expect(onCompletado).toHaveBeenCalledTimes(1);
  });
});

describe('ResultPreview — previsualización y descarga (Req 11.1, 11.2, 11.5)', () => {
  it('muestra el video con src de /descargar/{id} y un enlace de descarga', () => {
    render(<ResultPreview jobId="job_1" />);

    const video = screen.getByTestId('result-video');
    expect(video).toHaveAttribute('src', expect.stringContaining('/descargar/job_1'));

    const descargar = screen.getByTestId('result-descargar');
    expect(descargar).toHaveAttribute(
      'href',
      expect.stringContaining('/descargar/job_1'),
    );
    expect(descargar).toHaveAttribute('download');
  });

  it('muestra el fallback con opción de descarga si la previsualización falla', () => {
    render(<ResultPreview jobId="job_1" />);

    // Simula que el video no puede cargarse (Req 11.5).
    fireEvent.error(screen.getByTestId('result-video'));

    // El reproductor se oculta y aparece el mensaje de previsualización no
    // disponible, conservando la opción de descarga.
    expect(screen.queryByTestId('result-video')).toBeNull();
    expect(screen.getByTestId('result-preview-error')).toBeInTheDocument();
    expect(screen.getByTestId('result-descargar')).toHaveAttribute(
      'href',
      expect.stringContaining('/descargar/job_1'),
    );
  });
});
