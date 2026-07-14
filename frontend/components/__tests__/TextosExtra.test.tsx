/**
 * Pruebas del componente `TextosExtra` y de sus helpers puros exportados
 * (tarea 10.5 de la spec `edicion-avanzada-shorts`).
 *
 * Enfoque elegido: el repositorio dispone de `vitest` + `jsdom` +
 * `@testing-library/react`, de modo que se testea TANTO la lógica pura
 * (`validarRangoTextoExtra`, `textosExtraTodosValidos`, `msASegundos`,
 * `segundosAMs`) COMO el comportamiento del componente controlado mediante RTL
 * (límite de 2 textos, deshabilitado del botón, eliminación, mensaje de error y
 * `onValidezChange`).
 *
 * Requisitos cubiertos: 9.1, 9.2, 9.6, 19.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import TextosExtra, {
  MAX_TEXTOS_EXTRA,
  msASegundos,
  segundosAMs,
  validarRangoTextoExtra,
  textosExtraTodosValidos,
} from '../TextosExtra';
import { ESTILO_TEXTO_EXTRA_POR_DEFECTO } from '../EstiloTextoExtra';
import type { TextoExtra } from '@/lib/types';

/**
 * Crea un `TextoExtra` de prueba a partir de tiempos EN SEGUNDOS, convertidos a
 * milisegundos con la misma regla que la UI (`segundosAMs`).
 */
function crearTexto(inicioS: number, finS: number, texto = 'hola'): TextoExtra {
  return {
    texto,
    inicioMs: segundosAMs(inicioS),
    finMs: segundosAMs(finS),
    estilo: { ...ESTILO_TEXTO_EXTRA_POR_DEFECTO },
  };
}

// ---------------------------------------------------------------------------
// Conversión de unidades (segundos <-> milisegundos)
// ---------------------------------------------------------------------------

describe('conversión de unidades msASegundos / segundosAMs', () => {
  it('segundosAMs redondea a milisegundos enteros', () => {
    expect(segundosAMs(0)).toBe(0);
    expect(segundosAMs(3)).toBe(3000);
    expect(segundosAMs(1.5)).toBe(1500);
    // Redondeo al ms más cercano (evita deriva de coma flotante).
    expect(segundosAMs(0.0004)).toBe(0);
    expect(segundosAMs(0.0006)).toBe(1);
    expect(Number.isInteger(segundosAMs(12.3456))).toBe(true);
  });

  it('msASegundos es la operación inversa exacta (dividir entre 1000)', () => {
    expect(msASegundos(0)).toBe(0);
    expect(msASegundos(3000)).toBe(3);
    expect(msASegundos(1500)).toBe(1.5);
  });

  it('el ida y vuelta segundos->ms->segundos es estable para 3 decimales', () => {
    const valores = [0, 0.001, 0.123, 1.5, 3, 12.345, 59.999];
    for (const s of valores) {
      expect(msASegundos(segundosAMs(s))).toBeCloseTo(s, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Validación de rango: 0 <= in < out <= duracionS  (Req 9.6)
// ---------------------------------------------------------------------------

describe('validarRangoTextoExtra', () => {
  const duracionS = 10;

  it('acepta un rango estrictamente dentro de los límites', () => {
    expect(validarRangoTextoExtra(crearTexto(1, 5), duracionS)).toBeNull();
  });

  it('acepta los límites exactos in=0 y out=duracion', () => {
    expect(validarRangoTextoExtra(crearTexto(0, duracionS), duracionS)).toBeNull();
  });

  it('rechaza in negativo', () => {
    const t = crearTexto(1, 5);
    t.inicioMs = -1;
    expect(validarRangoTextoExtra(t, duracionS)).not.toBeNull();
  });

  it('rechaza in >= out (igual)', () => {
    expect(validarRangoTextoExtra(crearTexto(5, 5), duracionS)).not.toBeNull();
  });

  it('rechaza in > out', () => {
    expect(validarRangoTextoExtra(crearTexto(6, 5), duracionS)).not.toBeNull();
  });

  it('rechaza out > duracion', () => {
    expect(validarRangoTextoExtra(crearTexto(1, 11), duracionS)).not.toBeNull();
  });

  it('rechaza tiempos no finitos', () => {
    const t = crearTexto(1, 5);
    t.finMs = Number.NaN;
    expect(validarRangoTextoExtra(t, duracionS)).not.toBeNull();
  });
});

describe('textosExtraTodosValidos', () => {
  const duracionS = 10;

  it('devuelve true para una lista vacía', () => {
    expect(textosExtraTodosValidos([], duracionS)).toBe(true);
  });

  it('devuelve true cuando todos los textos son válidos', () => {
    const lista = [crearTexto(0, 3), crearTexto(4, 10)];
    expect(textosExtraTodosValidos(lista, duracionS)).toBe(true);
  });

  it('devuelve false ante una lista mixta (válido + inválido)', () => {
    const lista = [crearTexto(0, 3), crearTexto(6, 5)];
    expect(textosExtraTodosValidos(lista, duracionS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Componente controlado (RTL): límite de 2, eliminar, error y validez global
// ---------------------------------------------------------------------------

describe('TextosExtra (componente controlado, RTL)', () => {
  const duracionS = 30;

  it('MAX_TEXTOS_EXTRA es 2 (Req 9.1)', () => {
    expect(MAX_TEXTOS_EXTRA).toBe(2);
  });

  it('"Agregar texto" añade un texto y no está deshabilitado con menos de 2', () => {
    const onChange = vi.fn();
    render(
      <TextosExtra textos={[]} duracionS={duracionS} onChange={onChange} />,
    );

    const boton = screen.getByTestId('textos-extra-agregar');
    expect(boton).not.toBeDisabled();

    fireEvent.click(boton);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it('deshabilita "Agregar texto" al alcanzar el máximo de 2 (Req 9.2)', () => {
    const onChange = vi.fn();
    const lista = [crearTexto(0, 3), crearTexto(4, 8)];
    render(
      <TextosExtra
        textos={lista}
        duracionS={duracionS}
        onChange={onChange}
      />,
    );

    const boton = screen.getByTestId('textos-extra-agregar');
    expect(boton).toBeDisabled();

    // Aun pulsándolo, no debe emitir cambios (guardado por `alcanzadoMaximo`).
    fireEvent.click(boton);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('permite eliminar un texto y emite la lista sin ese elemento', () => {
    const onChange = vi.fn();
    const lista = [crearTexto(0, 3, 'a'), crearTexto(4, 8, 'b')];
    render(
      <TextosExtra
        textos={lista}
        duracionS={duracionS}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId('texto-extra-eliminar-0'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const nuevaLista = onChange.mock.calls[0][0] as TextoExtra[];
    expect(nuevaLista).toHaveLength(1);
    expect(nuevaLista[0].texto).toBe('b');
  });

  it('muestra el mensaje de error para un rango inválido (Req 9.6)', () => {
    const onChange = vi.fn();
    // out > duracion => rango inválido.
    const lista = [crearTexto(1, 40)];
    render(
      <TextosExtra textos={lista} duracionS={duracionS} onChange={onChange} />,
    );

    const error = screen.getByTestId('texto-extra-error-0');
    expect(error).toBeInTheDocument();
    expect(error).toHaveAttribute('role', 'alert');
  });

  it('no muestra error cuando el rango es válido', () => {
    render(
      <TextosExtra
        textos={[crearTexto(1, 5)]}
        duracionS={duracionS}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('texto-extra-error-0')).toBeNull();
  });

  it('onValidezChange refleja la validez global (true) al montar con textos válidos', () => {
    const onValidezChange = vi.fn();
    render(
      <TextosExtra
        textos={[crearTexto(0, 3), crearTexto(4, 10)]}
        duracionS={duracionS}
        onChange={() => {}}
        onValidezChange={onValidezChange}
      />,
    );
    expect(onValidezChange).toHaveBeenLastCalledWith(true);
  });

  it('onValidezChange refleja la validez global (false) con un texto inválido', () => {
    const onValidezChange = vi.fn();
    render(
      <TextosExtra
        textos={[crearTexto(0, 3), crearTexto(9, 8)]}
        duracionS={duracionS}
        onChange={() => {}}
        onValidezChange={onValidezChange}
      />,
    );
    expect(onValidezChange).toHaveBeenLastCalledWith(false);
  });
});
