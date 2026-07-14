/**
 * Tests de la condición "ocultar revisión manual cuando la IA está activada"
 * en el panel de subtítulos (`SubtitleSettings`).
 *
 * El backend omite la pausa de revisión manual cuando `revision_ia.activado`
 * es true; por eso, cuando la IA está activada, el toggle "revisar" se oculta y
 * se muestra una nota informativa en su lugar.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import SubtitleSettings from '../SubtitleSettings';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';

const base = AJUSTES_POR_DEFECTO.subtitulos;

describe('SubtitleSettings — revisión manual vs IA', () => {
  it('muestra el toggle "revisar" cuando la IA está desactivada', () => {
    render(<SubtitleSettings valor={base} onChange={() => {}} />);
    expect(
      screen.getByTestId('campo-subtitulos.revisar'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('revisar-ia-nota')).toBeNull();
  });

  it('oculta el toggle "revisar" y muestra la nota cuando la IA está activada', () => {
    render(
      <SubtitleSettings valor={base} onChange={() => {}} iaActivada />,
    );
    expect(screen.queryByTestId('campo-subtitulos.revisar')).toBeNull();
    const nota = screen.getByTestId('revisar-ia-nota');
    expect(nota).toBeInTheDocument();
    expect(nota).toHaveTextContent(/IA corrige/i);
  });

  it('muestra "Aprobar subtítulos a mano" incluso con la IA activada', () => {
    // A diferencia de `revisar`, el flag `aprobar_a_mano` debe seguir disponible
    // con la IA encendida (permite revisar a mano lo que hizo la IA).
    const { rerender } = render(
      <SubtitleSettings valor={base} onChange={() => {}} />,
    );
    expect(
      screen.getByTestId('campo-subtitulos.aprobar_a_mano'),
    ).toBeInTheDocument();

    rerender(<SubtitleSettings valor={base} onChange={() => {}} iaActivada />);
    expect(
      screen.getByTestId('campo-subtitulos.aprobar_a_mano'),
    ).toBeInTheDocument();
  });
});
