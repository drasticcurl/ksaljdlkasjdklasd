/**
 * Tests unitarios de los paneles de ajustes y del `MusicUploader`.
 *
 * Cubren:
 *   - Rango del corte de silencios: umbral (-60..0 dB) y margen (0..5000 ms)
 *     (Req 9.2).
 *   - Selección de idioma y modelo de transcripción de valores admitidos y
 *     señalización de valores fuera de conjunto (Req 9.3).
 *   - Rango del volumen base de música (0..100 %) (Req 9.4).
 *   - Rechazo de música que no es WAV, indicando el formato requerido (Req 9.7).
 *
 * Se usa @testing-library/react y se mockea `api.subirMusica`.
 */

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import SilenceSettings from '../SilenceSettings';
import TranscriptionSettings from '../TranscriptionSettings';
import MusicUploader from '../../MusicUploader';
import { subirMusica } from '@/lib/api';
import type {
  AjustesSilencios,
  AjustesTranscripcion,
  ResolucionObjetivo,
} from '@/lib/types';

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, subirMusica: vi.fn() };
});

const subirMusicaMock = subirMusica as unknown as Mock;

beforeEach(() => {
  subirMusicaMock.mockReset();
});

// ---------------------------------------------------------------------------
// SilenceSettings — rangos de silencios (Req 9.2)
// ---------------------------------------------------------------------------

function silenciosBase(): AjustesSilencios {
  return { activado: true, modo: 'db', umbral_db: -30, margen_ms: 200 };
}

describe('SilenceSettings — rangos (Req 9.2)', () => {
  it('no muestra errores con valores dentro de rango', () => {
    render(<SilenceSettings valor={silenciosBase()} onChange={() => {}} />);
    expect(screen.queryByTestId('error-silencios.umbral_db')).toBeNull();
    expect(screen.queryByTestId('error-silencios.margen_ms')).toBeNull();
  });

  it('señala el umbral fuera del rango -60..0 dB', () => {
    render(
      <SilenceSettings
        valor={{ ...silenciosBase(), umbral_db: 5 }}
        onChange={() => {}}
      />,
    );
    const error = screen.getByTestId('error-silencios.umbral_db');
    expect(error).toBeInTheDocument();
    expect(screen.getByTestId('campo-silencios.umbral_db')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('señala el margen fuera del rango 0..5000 ms', () => {
    render(
      <SilenceSettings
        valor={{ ...silenciosBase(), margen_ms: 6000 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('error-silencios.margen_ms')).toBeInTheDocument();
  });

  it('emite onChange al editar el umbral', () => {
    const onChange = vi.fn();
    render(<SilenceSettings valor={silenciosBase()} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('campo-silencios.umbral_db'), {
      target: { value: '-20' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ umbral_db: -20 }),
    );
  });

  it('emite onChange al alternar la activación', () => {
    const onChange = vi.fn();
    render(<SilenceSettings valor={silenciosBase()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('campo-silencios.activado'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ activado: false }),
    );
  });
});

// ---------------------------------------------------------------------------
// TranscriptionSettings — idioma y modelo (Req 9.3)
// ---------------------------------------------------------------------------

function transcripcionBase(): AjustesTranscripcion {
  return { idioma: 'es', modelo: 'small' };
}
function resolucionBase(): ResolucionObjetivo {
  return { ancho: 1080, alto: 1920 };
}

function renderTranscripcion(valor: AjustesTranscripcion, onChange = vi.fn()) {
  render(
    <TranscriptionSettings
      valor={valor}
      onChange={onChange}
      resolucion={resolucionBase()}
      onResolucionChange={() => {}}
    />,
  );
  return onChange;
}

describe('TranscriptionSettings — idioma/modelo (Req 9.3)', () => {
  it('no señala error con idioma y modelo admitidos', () => {
    renderTranscripcion(transcripcionBase());
    expect(screen.queryByTestId('error-transcripcion.idioma')).toBeNull();
    expect(screen.queryByTestId('error-transcripcion.modelo')).toBeNull();
  });

  it('admite "auto" como idioma válido', () => {
    renderTranscripcion({ idioma: 'auto', modelo: 'small' });
    expect(screen.queryByTestId('error-transcripcion.idioma')).toBeNull();
  });

  it('señala un idioma fuera del conjunto admitido', () => {
    renderTranscripcion({ idioma: 'klingon', modelo: 'small' });
    expect(
      screen.getByTestId('error-transcripcion.idioma'),
    ).toBeInTheDocument();
  });

  it('señala un modelo fuera del conjunto admitido', () => {
    renderTranscripcion({ idioma: 'es', modelo: 'gigantic' });
    expect(
      screen.getByTestId('error-transcripcion.modelo'),
    ).toBeInTheDocument();
  });

  it('emite onChange al seleccionar otro modelo de la lista admitida', () => {
    const onChange = renderTranscripcion(transcripcionBase());
    fireEvent.change(screen.getByTestId('campo-transcripcion.modelo'), {
      target: { value: 'medium' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ modelo: 'medium' }),
    );
  });

  it('emite onChange al seleccionar otro idioma de la lista admitida', () => {
    const onChange = renderTranscripcion(transcripcionBase());
    fireEvent.change(screen.getByTestId('campo-transcripcion.idioma'), {
      target: { value: 'en' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ idioma: 'en' }),
    );
  });
});

// ---------------------------------------------------------------------------
// MusicUploader — volumen (Req 9.4) y rechazo de no-WAV (Req 9.7)
// ---------------------------------------------------------------------------

function audio(nombre = 'fondo.wav', type = 'audio/wav'): File {
  return new File(['RIFF'], nombre, { type });
}
function noAudio(nombre = 'notas.txt'): File {
  return new File(['x'], nombre, { type: 'text/plain' });
}

function seleccionarMusica(file: File): void {
  const input = screen.getByTestId('music-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('MusicUploader — rechazo de formatos no de audio (Req 9.7)', () => {
  it('rechaza un archivo no de audio indicando los formatos aceptados y no sube', () => {
    const onMusicaChange = vi.fn();
    render(<MusicUploader onMusicaChange={onMusicaChange} />);

    seleccionarMusica(noAudio('notas.txt'));

    const error = screen.getByTestId('error-formato');
    expect(error).toHaveTextContent(/audio/i);
    expect(subirMusicaMock).not.toHaveBeenCalled();
    // Se notifica que no hay música válida cargada.
    expect(onMusicaChange).toHaveBeenCalledWith(
      expect.objectContaining({ musicaId: null }),
    );
  });

  it('acepta un WAV, lo sube y notifica el musica_id', async () => {
    subirMusicaMock.mockResolvedValueOnce({
      musica_id: 'mus_1',
      nombre_original: 'fondo.wav',
      duracion_s: 12.5,
    });
    const onMusicaChange = vi.fn();
    render(<MusicUploader onMusicaChange={onMusicaChange} />);

    seleccionarMusica(audio('fondo.wav'));

    await waitFor(() => expect(subirMusicaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('error-formato')).toBeNull();
    await screen.findByTestId('musica-cargada');
    expect(onMusicaChange).toHaveBeenCalledWith(
      expect.objectContaining({ musicaId: 'mus_1' }),
    );
  });

  it('acepta un MP3, lo sube y notifica el musica_id (formato de audio común)', async () => {
    subirMusicaMock.mockResolvedValueOnce({
      musica_id: 'mus_2',
      nombre_original: 'cancion.mp3',
      duracion_s: 30,
    });
    const onMusicaChange = vi.fn();
    render(<MusicUploader onMusicaChange={onMusicaChange} />);

    seleccionarMusica(audio('cancion.mp3', 'audio/mpeg'));

    await waitFor(() => expect(subirMusicaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('error-formato')).toBeNull();
    await screen.findByTestId('musica-cargada');
    expect(onMusicaChange).toHaveBeenCalledWith(
      expect.objectContaining({ musicaId: 'mus_2' }),
    );
  });
});

describe('MusicUploader — volumen base (Req 9.4)', () => {
  it('no señala error con volumen dentro de 0..100 %', () => {
    render(<MusicUploader volumenInicial={30} />);
    expect(screen.queryByTestId('error-volumen')).toBeNull();
    expect(screen.getByTestId('valor-volumen')).toHaveTextContent('30%');
  });

  it('señala el volumen fuera del rango 0..100 %', () => {
    render(<MusicUploader volumenInicial={150} />);
    expect(screen.getByTestId('error-volumen')).toBeInTheDocument();
    expect(screen.getByTestId('campo-volumen')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('emite onMusicaChange con el volumen al ajustar el control', () => {
    const onMusicaChange = vi.fn();
    render(<MusicUploader onMusicaChange={onMusicaChange} volumenInicial={30} />);
    fireEvent.change(screen.getByTestId('campo-volumen'), {
      target: { value: '60' },
    });
    expect(onMusicaChange).toHaveBeenCalledWith(
      expect.objectContaining({ volumenBasePct: 60 }),
    );
  });
});
