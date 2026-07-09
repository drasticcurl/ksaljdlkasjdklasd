/**
 * Tests del componente SubtitleReview y de los nuevos ajustes:
 *   - Duración mínima de silencio (SilenceSettings).
 *   - Checkbox "Revisar subtítulos antes de renderizar" (SubtitleSettings).
 *
 * SubtitleReview:
 *   - Renderiza una línea por grupo con su rango de tiempo y texto editable.
 *   - Permite editar el texto y, al confirmar, llama a la API con los textos
 *     editados.
 *   - Refleja errores de carga y de envío.
 *
 * Las llamadas a la API se inyectan mediante props (obtenerFn/confirmarFn).
 */

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';

import SubtitleReview from '../SubtitleReview';
import SilenceSettings from '../settings/SilenceSettings';
import SubtitleSettings from '../settings/SubtitleSettings';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import type { AjustesSilencios, AjustesSubtitulos, GrupoSubtitulo } from '@/lib/types';

function gruposEjemplo(): GrupoSubtitulo[] {
  return [
    { indice: 0, texto: 'hola mundo', inicio_s: 0, fin_s: 1.2 },
    { indice: 1, texto: 'segunda linea', inicio_s: 1.2, fin_s: 2.5 },
  ];
}

describe('SubtitleReview — carga y edición', () => {
  let obtenerFn: Mock;
  let confirmarFn: Mock;

  beforeEach(() => {
    obtenerFn = vi.fn();
    confirmarFn = vi.fn();
  });

  it('obtiene los subtítulos y renderiza una línea editable por grupo', async () => {
    obtenerFn.mockResolvedValueOnce({ grupos: gruposEjemplo() });

    render(
      <SubtitleReview
        jobId="job_1"
        obtenerFn={obtenerFn as never}
        confirmarFn={confirmarFn as never}
      />,
    );

    await screen.findByTestId('review-lista');
    expect(obtenerFn).toHaveBeenCalledWith('job_1', expect.anything());

    // Una línea por grupo, con texto editable y rango de tiempo visible.
    expect(screen.getByTestId('review-texto-0')).toHaveValue('hola mundo');
    expect(screen.getByTestId('review-texto-1')).toHaveValue('segunda linea');
    expect(screen.getByTestId('review-tiempo-0')).toBeInTheDocument();
  });

  it('permite editar el texto y confirma llamando a la API con lo editado', async () => {
    obtenerFn.mockResolvedValueOnce({ grupos: gruposEjemplo() });
    confirmarFn.mockResolvedValueOnce({ job_id: 'job_1', estado: 'en_ejecucion' });
    const onConfirmado = vi.fn();

    render(
      <SubtitleReview
        jobId="job_1"
        obtenerFn={obtenerFn as never}
        confirmarFn={confirmarFn as never}
        onConfirmado={onConfirmado}
      />,
    );

    await screen.findByTestId('review-lista');

    // El usuario corrige la primera línea.
    fireEvent.change(screen.getByTestId('review-texto-0'), {
      target: { value: 'HOLA MUNDO corregido' },
    });

    fireEvent.click(screen.getByTestId('review-confirmar'));

    await waitFor(() => expect(confirmarFn).toHaveBeenCalledTimes(1));
    const [jobIdArg, gruposArg] = confirmarFn.mock.calls[0];
    expect(jobIdArg).toBe('job_1');
    expect(gruposArg[0].texto).toBe('HOLA MUNDO corregido');
    // Los tiempos se conservan.
    expect(gruposArg[0].inicio_s).toBe(0);
    expect(gruposArg[0].fin_s).toBe(1.2);
    await waitFor(() => expect(onConfirmado).toHaveBeenCalledTimes(1));
  });

  it('muestra un error si la carga de subtítulos falla', async () => {
    obtenerFn.mockRejectedValueOnce(new Error('backend caído'));

    render(
      <SubtitleReview
        jobId="job_1"
        obtenerFn={obtenerFn as never}
        confirmarFn={confirmarFn as never}
      />,
    );

    expect(await screen.findByTestId('review-error-carga')).toBeInTheDocument();
  });

  it('muestra un error de envío si la confirmación falla', async () => {
    obtenerFn.mockResolvedValueOnce({ grupos: gruposEjemplo() });
    confirmarFn.mockRejectedValueOnce(new Error('no se pudo'));

    render(
      <SubtitleReview
        jobId="job_1"
        obtenerFn={obtenerFn as never}
        confirmarFn={confirmarFn as never}
      />,
    );

    await screen.findByTestId('review-lista');
    fireEvent.click(screen.getByTestId('review-confirmar'));

    expect(await screen.findByTestId('review-error-envio')).toBeInTheDocument();
  });
});

describe('SilenceSettings — duración mínima de silencio', () => {
  function base(): AjustesSilencios {
    return { activado: true, umbral_db: -30, margen_ms: 200, min_silencio_ms: 300 };
  }

  it('renderiza el campo y emite onChange al editarlo', () => {
    const onChange = vi.fn();
    render(<SilenceSettings valor={base()} onChange={onChange} />);

    const campo = screen.getByTestId('campo-silencios.min_silencio_ms');
    expect(campo).toBeInTheDocument();
    fireEvent.change(campo, { target: { value: '500' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ min_silencio_ms: 500 }),
    );
  });

  it('señala la duración mínima fuera del rango 0..5000 ms', () => {
    render(
      <SilenceSettings valor={{ ...base(), min_silencio_ms: 6000 }} onChange={() => {}} />,
    );
    expect(
      screen.getByTestId('error-silencios.min_silencio_ms'),
    ).toBeInTheDocument();
  });
});

describe('SubtitleSettings — revisar antes de renderizar', () => {
  function base(): AjustesSubtitulos {
    return { ...AJUSTES_POR_DEFECTO.subtitulos };
  }

  it('muestra el checkbox marcado por defecto y emite onChange al alternarlo', () => {
    const onChange = vi.fn();
    render(<SubtitleSettings valor={base()} onChange={onChange} />);

    const check = screen.getByTestId(
      'campo-subtitulos.revisar_antes_de_renderizar',
    ) as HTMLInputElement;
    expect(check.checked).toBe(true);

    fireEvent.click(check);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ revisar_antes_de_renderizar: false }),
    );
  });
});
