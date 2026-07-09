/**
 * Tests de los componentes nuevos:
 *   - TransitionSettings: selección de tipo de transición + duración.
 *   - SettingsActions: guardar/restablecer la configuración por defecto.
 *   - SubtitleReview: carga, edición de texto y envío de subtítulos.
 *
 * Los componentes aceptan inyección de funciones (guardarFn/borrarFn,
 * obtenerFn/enviarFn), por lo que se prueban sin mockear el módulo de API.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import TransitionSettings from '../settings/TransitionSettings';
import SettingsActions from '../settings/SettingsActions';
import SubtitleReview from '../SubtitleReview';
import { AJUSTES_POR_DEFECTO } from '@/lib/defaults';
import type { AjustesTransiciones, SubtitulosRevision } from '@/lib/types';

// ---------------------------------------------------------------------------
// TransitionSettings
// ---------------------------------------------------------------------------
describe('TransitionSettings', () => {
  const base: AjustesTransiciones = { tipo: 'ninguna', duracion_ms: 400 };

  it('con "ninguna" no muestra el campo de duración', () => {
    render(<TransitionSettings valor={base} onChange={() => {}} />);
    expect(screen.queryByTestId('campo-transiciones.duracion_ms')).toBeNull();
  });

  it('muestra la duración cuando hay un efecto activo', () => {
    render(
      <TransitionSettings
        valor={{ tipo: 'disolucion', duracion_ms: 400 }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId('campo-transiciones.duracion_ms'),
    ).toBeInTheDocument();
  });

  it('emite onChange al elegir un tipo de transición', () => {
    const onChange = vi.fn();
    render(<TransitionSettings valor={base} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('campo-transiciones.tipo'), {
      target: { value: 'disolucion' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'disolucion' }),
    );
  });
});

// ---------------------------------------------------------------------------
// SettingsActions
// ---------------------------------------------------------------------------
describe('SettingsActions', () => {
  it('guarda la configuración y muestra confirmación', async () => {
    const guardarFn = vi.fn().mockResolvedValue({
      guardado: true,
      ajustes: AJUSTES_POR_DEFECTO,
    });
    render(
      <SettingsActions
        ajustes={AJUSTES_POR_DEFECTO}
        onRestablecer={() => {}}
        guardarFn={guardarFn}
      />,
    );
    fireEvent.click(screen.getByTestId('guardar-config'));
    await waitFor(() => expect(guardarFn).toHaveBeenCalledWith(AJUSTES_POR_DEFECTO));
    expect(screen.getByTestId('config-mensaje')).toHaveTextContent(/guardad/i);
  });

  it('restablece: borra y notifica al contenedor', async () => {
    const borrarFn = vi.fn().mockResolvedValue({ borrado: true });
    const onRestablecer = vi.fn();
    render(
      <SettingsActions
        ajustes={AJUSTES_POR_DEFECTO}
        onRestablecer={onRestablecer}
        borrarFn={borrarFn}
      />,
    );
    fireEvent.click(screen.getByTestId('restablecer-config'));
    await waitFor(() => expect(borrarFn).toHaveBeenCalledTimes(1));
    expect(onRestablecer).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SubtitleReview
// ---------------------------------------------------------------------------
describe('SubtitleReview', () => {
  const revision: SubtitulosRevision = {
    job_id: 'job-1',
    estado: 'esperando_revision',
    editable: true,
    grupos: [
      { texto: 'ola mundo', inicio_s: 0, fin_s: 1 },
      { texto: 'segunda linia', inicio_s: 1, fin_s: 2 },
    ],
  };

  it('carga los grupos y permite editar y enviar el texto', async () => {
    const obtenerFn = vi.fn().mockResolvedValue(revision);
    const enviarFn = vi
      .fn()
      .mockResolvedValue({ job_id: 'job-1', estado: 'en_ejecucion' });
    const onEnviado = vi.fn();

    render(
      <SubtitleReview
        jobId="job-1"
        obtenerFn={obtenerFn}
        enviarFn={enviarFn}
        onEnviado={onEnviado}
      />,
    );

    // Espera a que carguen las líneas.
    const linea0 = (await screen.findByTestId('review-linea-0')) as HTMLInputElement;
    expect(linea0.value).toBe('ola mundo');

    // Corrige el texto de la primera línea.
    fireEvent.change(linea0, { target: { value: 'Hola mundo' } });

    fireEvent.click(screen.getByTestId('review-aceptar'));

    await waitFor(() => expect(enviarFn).toHaveBeenCalledTimes(1));
    // Se envían los textos editados (primera línea corregida).
    expect(enviarFn).toHaveBeenCalledWith(
      'job-1',
      [{ texto: 'Hola mundo' }, { texto: 'segunda linia' }],
      expect.anything(),
    );
    expect(onEnviado).toHaveBeenCalledTimes(1);
  });

  it('muestra un error si la carga falla', async () => {
    const obtenerFn = vi.fn().mockRejectedValue(new Error('boom'));
    render(<SubtitleReview jobId="job-1" obtenerFn={obtenerFn} />);
    await screen.findByTestId('review-error');
  });
});
