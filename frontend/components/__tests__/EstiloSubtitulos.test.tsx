/**
 * Tests del componente reutilizable `EstiloSubtitulos`.
 *
 * Verifican que:
 *   - Renderiza todos los controles de estilo con sus `data-testid` esperados
 *     (los mismos que usa el playground, para no romper sus tests).
 *   - Refleja el `estilo` recibido (componente controlado).
 *   - Emite `onChange` con una copia inmutable y el campo actualizado, sin
 *     mutar el estilo original.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EstiloSubtitulos from '../EstiloSubtitulos';
import type { Estilo } from '@/components/remotion/types';

/** Estilo base de prueba con valores conocidos y distinguibles. */
const ESTILO_BASE: Estilo = {
  fuente: 'Poppins',
  tamano: 80,
  color: '#ffffff',
  colorResaltado: '#00ff00',
  posVerticalPct: 50,
  animEntradaMs: 300,
  colorBorde: '#000000',
  grosorBorde: 6,
  negrita: true,
};

describe('EstiloSubtitulos', () => {
  it('renderiza todos los controles con sus data-testid y valores actuales', () => {
    render(<EstiloSubtitulos estilo={ESTILO_BASE} onChange={() => {}} />);

    expect((screen.getByTestId('estilo-color') as HTMLInputElement).value).toBe(
      '#ffffff',
    );
    expect(
      (screen.getByTestId('estilo-color-resaltado') as HTMLInputElement).value,
    ).toBe('#00ff00');
    expect(
      (screen.getByTestId('estilo-tamano') as HTMLInputElement).value,
    ).toBe('80');
    expect(
      (screen.getByTestId('estilo-fuente') as HTMLSelectElement).value,
    ).toBe('Poppins');
    expect(
      (screen.getByTestId('estilo-pos-vertical') as HTMLInputElement).value,
    ).toBe('50');
    expect(
      (screen.getByTestId('estilo-anim-entrada') as HTMLInputElement).value,
    ).toBe('300');
    expect(
      (screen.getByTestId('estilo-color-borde') as HTMLInputElement).value,
    ).toBe('#000000');
    expect(
      (screen.getByTestId('estilo-grosor-borde') as HTMLInputElement).value,
    ).toBe('6');
    expect(
      (screen.getByTestId('estilo-negrita') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('emite onChange con el tamaño actualizado sin mutar el estilo original', () => {
    const onChange = vi.fn();
    render(<EstiloSubtitulos estilo={ESTILO_BASE} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('estilo-tamano'), {
      target: { value: '120' },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ ...ESTILO_BASE, tamano: 120 }),
    );
    // El estilo original no debe mutarse (componente puro).
    expect(ESTILO_BASE.tamano).toBe(80);
  });

  it('emite onChange al cambiar color, fuente y negrita', () => {
    const onChange = vi.fn();
    render(<EstiloSubtitulos estilo={ESTILO_BASE} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('estilo-color'), {
      target: { value: '#ff0000' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: '#ff0000' }),
    );

    fireEvent.change(screen.getByTestId('estilo-fuente'), {
      target: { value: 'Arial' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ fuente: 'Arial' }),
    );

    fireEvent.click(screen.getByTestId('estilo-negrita'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ negrita: false }),
    );
  });
});
