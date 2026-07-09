/**
 * Tests de los controles nuevos: preset de subtítulos (karaoke), método de
 * silencios (voz/dB) y quitar risas.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SubtitleSettings from '../SubtitleSettings';
import SilenceSettings from '../SilenceSettings';
import RisasSettings from '../RisasSettings';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import type { AjustesRisas, AjustesSilencios } from '@/lib/types';

describe('SubtitleSettings — preset y color de acento', () => {
  it('muestra el color de acento con un preset de karaoke y lo oculta en clasico', () => {
    const sub = { ...AJUSTES_POR_DEFECTO.subtitulos, preset: 'bold_pop' as const };
    const { rerender } = render(
      <SubtitleSettings valor={sub} onChange={() => {}} />,
    );
    expect(
      screen.getByTestId('campo-subtitulos.color_resaltado'),
    ).toBeInTheDocument();

    rerender(
      <SubtitleSettings
        valor={{ ...sub, preset: 'clasico' }}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('campo-subtitulos.color_resaltado')).toBeNull();
  });

  it('emite onChange al cambiar el preset', () => {
    const onChange = vi.fn();
    render(
      <SubtitleSettings
        valor={AJUSTES_POR_DEFECTO.subtitulos}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId('campo-subtitulos.preset'), {
      target: { value: 'clasico' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'clasico' }),
    );
  });
});

describe('SilenceSettings — método voz/dB', () => {
  function base(modo: 'db' | 'voz'): AjustesSilencios {
    return { activado: true, modo, umbral_db: -30, margen_ms: 200 };
  }

  it('oculta el umbral en modo voz y lo muestra en modo dB', () => {
    const { rerender } = render(
      <SilenceSettings valor={base('voz')} onChange={() => {}} />,
    );
    expect(screen.queryByTestId('campo-silencios.umbral_db')).toBeNull();

    rerender(<SilenceSettings valor={base('db')} onChange={() => {}} />);
    expect(
      screen.getByTestId('campo-silencios.umbral_db'),
    ).toBeInTheDocument();
  });

  it('emite onChange al cambiar el método', () => {
    const onChange = vi.fn();
    render(<SilenceSettings valor={base('db')} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('campo-silencios.modo'), {
      target: { value: 'voz' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ modo: 'voz' }),
    );
  });
});

describe('RisasSettings', () => {
  it('muestra el margen solo cuando está activado y emite onChange', () => {
    const onChange = vi.fn();
    const valor: AjustesRisas = { activado: true, margen_ms: 100 };
    const { rerender } = render(
      <RisasSettings valor={valor} onChange={onChange} />,
    );
    expect(screen.getByTestId('campo-risas.margen_ms')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campo-risas.activado'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ activado: false }),
    );

    rerender(
      <RisasSettings valor={{ ...valor, activado: false }} onChange={() => {}} />,
    );
    expect(screen.queryByTestId('campo-risas.margen_ms')).toBeNull();
  });
});
