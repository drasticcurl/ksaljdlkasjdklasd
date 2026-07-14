'use client';

/**
 * PreviewRecorte — composición Remotion SOLO para el navegador (preview en vivo
 * del timeline de silencios). NO tiene copia SSR y NO participa en el render
 * final: el render definitivo lo hace el backend con ffmpeg sobre el vídeo ya
 * cortado y luego la composición `ShortVideo` sobre ese vídeo.
 *
 * Su único cometido es MOSTRAR, dentro de `@remotion/player`, el resultado del
 * corte de silencios YA APLICADO: reproduce el vídeo unido pero SIN los tramos
 * rojos (a borrar). Para ello concatena, uno tras otro, los "segmentos a
 * conservar" (el complemento de los tramos dentro de `[0, duración]`).
 *
 * Cada segmento `[inicioS, finS]` se renderiza como un `<Video>` de `remotion`
 * recortado con `trimBefore`/`trimAfter` (en FRAMES; API de Remotion 4.0.x, que
 * reemplaza a los antiguos `startFrom`/`endAt`), colocado dentro de un
 * `<Sequence from=…>` que empieza justo donde acaba el segmento anterior. Así la
 * línea de tiempo de la composición representa el "tiempo comprimido" (cut-time)
 * del vídeo ya recortado, y la reproducción salta por encima de las partes
 * rojas.
 *
 * La duración total en frames es la SUMA de las duraciones de cada segmento en
 * frames (ver {@link framesDeSegmento} y {@link framesTotalesSegmentos}); el
 * contenedor `TimelineSilencios` debe pasar esa misma cifra como
 * `durationInFrames` al `<Player>` para que ambos coincidan exactamente.
 */

import React from 'react';
import { AbsoluteFill, Sequence, Video } from 'remotion';

/**
 * Un segmento del vídeo unido que se CONSERVA (no se borra), en segundos.
 * Es el complemento de los tramos de silencio dentro de `[0, duración]`.
 */
export interface SegmentoConservar {
  /** Instante de inicio del segmento a conservar, en segundos (>= 0). */
  inicioS: number;
  /** Instante de fin del segmento a conservar, en segundos (> inicioS). */
  finS: number;
}

/**
 * Props de la composición `PreviewRecorte` (contrato de la preview recortada).
 *
 * Se declara como `type` (no `interface`) A PROPÓSITO: `@remotion/player` exige
 * que las props de la composición sean asignables a `Record<string, unknown>`,
 * y en TypeScript un alias de tipo con propiedades conocidas lo cumple mientras
 * que una `interface` (que puede ampliarse por fusión) NO. Mismo criterio que
 * `ShortVideoProps`.
 */
export type PreviewRecorteProps = {
  /** URL HTTP del vídeo UNIDO (pre-corte) que se va a recortar en vivo. */
  videoSrc: string;
  /** Cuadros por segundo de la composición (mismos fps del vídeo unido). */
  fps: number;
  /** Ancho del lienzo en píxeles. */
  width: number;
  /** Alto del lienzo en píxeles. */
  height: number;
  /** Segmentos a CONSERVAR (complemento de los tramos), en segundos. */
  segmentos: SegmentoConservar[];
};

/**
 * Duración en FRAMES de un segmento a conservar, calculada de forma coherente
 * con el recorte del `<Video>`: `trimAfter - trimBefore`, con ambos extremos
 * redondeados a frame (`Math.round`). Nunca menos de 1 frame para no producir
 * secuencias vacías. Es una función PURA (exportada para poder reutilizarla al
 * derivar `durationInFrames` en el contenedor y en las pruebas).
 */
export function framesDeSegmento(seg: SegmentoConservar, fps: number): number {
  const inicioFrame = Math.round(seg.inicioS * fps);
  const finFrame = Math.round(seg.finS * fps);
  return Math.max(1, finFrame - inicioFrame);
}

/**
 * Suma de las duraciones (en frames) de todos los segmentos a conservar. Es la
 * `durationInFrames` que debe usar la composición de la preview recortada. Como
 * mínimo devuelve 1 frame (Remotion exige `durationInFrames >= 1`), aunque el
 * contenedor decide mostrar un estado vacío cuando no hay segmentos. Función
 * PURA.
 */
export function framesTotalesSegmentos(
  segmentos: readonly SegmentoConservar[],
  fps: number,
): number {
  const total = segmentos.reduce(
    (acc, seg) => acc + framesDeSegmento(seg, fps),
    0,
  );
  return Math.max(1, total);
}

/**
 * Composición de la preview recortada en vivo. Coloca cada segmento a conservar
 * como un `<Video>` recortado dentro de un `<Sequence>` consecutivo, de modo que
 * la reproducción muestre el vídeo unido con las partes rojas ya eliminadas.
 */
export const PreviewRecorte: React.FC<PreviewRecorteProps> = ({
  videoSrc,
  fps,
  segmentos,
}) => {
  // Offset acumulado (en frames) donde arranca cada segmento en el cut-time.
  let offsetFrames = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {segmentos.map((seg, indice) => {
        const inicioFrame = Math.round(seg.inicioS * fps);
        const finFrame = Math.round(seg.finS * fps);
        const duracionFrames = framesDeSegmento(seg, fps);
        const from = offsetFrames;
        offsetFrames += duracionFrames;

        return (
          <Sequence
            key={indice}
            from={from}
            durationInFrames={duracionFrames}
            // Nombre útil para depurar en el timeline de Remotion Studio.
            name={`Segmento ${indice + 1}`}
          >
            {/*
              `trimBefore`/`trimAfter` recortan el vídeo por la izquierda/derecha
              en FRAMES (API de Remotion 4.0.x). Así este <Video> reproduce solo
              la ventana [inicioFrame, finFrame] del vídeo unido, es decir el
              segmento a conservar; la parte roja anterior/posterior queda fuera.
            */}
            <Video
              src={videoSrc}
              trimBefore={inicioFrame}
              trimAfter={finFrame}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
