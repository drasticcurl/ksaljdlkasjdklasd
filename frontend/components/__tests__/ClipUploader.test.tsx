/**
 * Tests unitarios de `components/ClipUploader.tsx`.
 *
 * Cubren los casos límite del componente de selección de clips:
 *   - Límite de 50 archivos por adición (Req 1.5).
 *   - Mensaje de timeout/error de red con conservación de la selección para
 *     reintento (Req 1.7).
 *
 * Se mockea `api.subirClips` conservando el resto del módulo (ApiError y los
 * códigos de error del cliente) mediante `importActual`.
 */

import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClipUploader from '../ClipUploader';
import { ApiError, CLIENT_ERROR_CODES, subirClips } from '@/lib/api';

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, subirClips: vi.fn() };
});

const subirMock = subirClips as unknown as Mock;

/** Construye un objeto tipo FileList a partir de un arreglo de `File`. */
function comoFileList(files: File[]): FileList {
  const list: Record<string, unknown> = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
  };
  files.forEach((f, i) => {
    list[i] = f;
  });
  return list as unknown as FileList;
}

/** Crea un `File` de video pequeño (tamaño ~1 byte, formato soportado). */
function clipMp4(nombre: string): File {
  return new File(['x'], nombre, { type: 'video/mp4' });
}

function seleccionar(files: File[]): void {
  const input = screen.getByTestId('clip-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: comoFileList(files) } });
}

beforeEach(() => {
  subirMock.mockReset();
});

describe('ClipUploader — límite de 50 archivos (Req 1.5)', () => {
  it('rechaza la selección completa cuando se eligen más de 50 archivos', () => {
    render(<ClipUploader />);

    const files = Array.from({ length: 51 }, (_, i) => clipMp4(`clip${i}.mp4`));
    seleccionar(files);

    const alerta = screen.getByTestId('error-limite');
    expect(alerta).toHaveTextContent('50');
    // No se admite ninguna selección: el botón de subir queda deshabilitado.
    expect(screen.getByTestId('subir-clips')).toBeDisabled();
    // No se intentó subir nada.
    expect(subirMock).not.toHaveBeenCalled();
  });

  it('admite exactamente 50 archivos válidos', () => {
    render(<ClipUploader />);

    const files = Array.from({ length: 50 }, (_, i) => clipMp4(`clip${i}.mp4`));
    seleccionar(files);

    expect(screen.queryByTestId('error-limite')).toBeNull();
    expect(screen.getByTestId('seleccion').children).toHaveLength(50);
    expect(screen.getByTestId('subir-clips')).not.toBeDisabled();
  });
});

describe('ClipUploader — timeout / reintento (Req 1.7)', () => {
  it('muestra mensaje de timeout y conserva la selección para reintentar', async () => {
    subirMock.mockRejectedValueOnce(
      new ApiError(CLIENT_ERROR_CODES.TIMEOUT, 'timeout 60s', 0, null),
    );

    render(<ClipUploader />);
    seleccionar([clipMp4('toma1.mp4')]);

    fireEvent.click(screen.getByTestId('subir-clips'));

    // Aparece el mensaje de carga incompleta por timeout.
    const error = await screen.findByTestId('error-envio');
    expect(error).toHaveTextContent(/tiempo de espera/i);

    // La selección se conserva y el botón ofrece reintentar (Req 1.7).
    expect(screen.getByTestId('seleccion').children).toHaveLength(1);
    expect(screen.getByTestId('subir-clips')).toHaveTextContent(
      /reintentar/i,
    );
    expect(subirMock).toHaveBeenCalledTimes(1);
    expect(subirMock).toHaveBeenCalledWith([expect.any(File)]);
  });

  it('muestra mensaje de error de red y permite reintentar', async () => {
    subirMock.mockRejectedValueOnce(
      new ApiError(CLIENT_ERROR_CODES.NETWORK, 'sin red', 0, null),
    );

    render(<ClipUploader />);
    seleccionar([clipMp4('toma1.mp4')]);
    fireEvent.click(screen.getByTestId('subir-clips'));

    const error = await screen.findByTestId('error-envio');
    expect(error).toHaveTextContent(/error de red/i);
    expect(screen.getByTestId('seleccion').children).toHaveLength(1);
  });

  it('un reintento exitoso limpia la selección y notifica los clips', async () => {
    subirMock
      .mockRejectedValueOnce(
        new ApiError(CLIENT_ERROR_CODES.TIMEOUT, 'timeout', 0, null),
      )
      .mockResolvedValueOnce({
        clips: [
          {
            id: 'clip_1',
            nombre_original: 'toma1.mp4',
            posicion: 1,
            tamano_bytes: 1,
            duracion_s: null,
          },
        ],
      });

    const onClipsSubidos = vi.fn();
    render(<ClipUploader onClipsSubidos={onClipsSubidos} />);
    seleccionar([clipMp4('toma1.mp4')]);

    // Primer intento: falla por timeout.
    fireEvent.click(screen.getByTestId('subir-clips'));
    await screen.findByTestId('error-envio');

    // Reintento: éxito.
    fireEvent.click(screen.getByTestId('subir-clips'));
    await waitFor(() => expect(onClipsSubidos).toHaveBeenCalledTimes(1));

    expect(onClipsSubidos).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'clip_1' }),
    ]);
    // La selección se limpió tras el éxito.
    expect(screen.queryByTestId('seleccion')).toBeNull();
    expect(subirMock).toHaveBeenCalledTimes(2);
  });
});

describe('ClipUploader — validación por archivo (Req 1.4)', () => {
  it('muestra un motivo por cada archivo rechazado y conserva los válidos', () => {
    render(<ClipUploader />);

    seleccionar([
      clipMp4('bueno.mp4'),
      new File(['x'], 'malo.txt', { type: 'text/plain' }),
    ]);

    expect(screen.getByTestId('rechazos').children).toHaveLength(1);
    expect(screen.getByTestId('rechazos')).toHaveTextContent('malo.txt');
    expect(screen.getByTestId('seleccion').children).toHaveLength(1);
    expect(screen.getByTestId('seleccion')).toHaveTextContent('bueno.mp4');
  });
});
