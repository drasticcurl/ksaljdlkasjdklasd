// COPIA para el navegador de remotion/src/ShortVideo.tsx.
//
// IMPORTANTE: mantener EN SINCRONÍA con `remotion/src/ShortVideo.tsx` del
// subproyecto Node. Se duplica aquí para que @remotion/player pueda renderizar
// la misma composición dentro del navegador (React + hooks de `remotion`). La
// lógica debe ser IDÉNTICA a la del subproyecto.
//
// Composicion ShortVideo: fondo (video o blanco) + capa de subtitulos por grupo.
//
// Fondo:
//  - Si `videoSrc` es una cadena no vacia => <OffthreadVideo src={videoSrc} />
//    (extrae los frames con ffmpeg fuera del navegador, mas estable para render).
//  - Si `videoSrc` es "" o null => fondo blanco (modo playground).
//
// Encima se superpone la capa <Captions/> que muestra un grupo (frase) a la vez.
import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import {Captions} from './Captions';
import type {ShortVideoProps} from './types';

export const ShortVideo: React.FC<ShortVideoProps> = ({
  videoSrc,
  grupos,
  estilo,
}) => {
  // Solo hay video de fondo si videoSrc es una cadena con contenido.
  const tieneVideo = typeof videoSrc === 'string' && videoSrc.length > 0;

  return (
    <AbsoluteFill>
      {tieneVideo ? (
        // Video de fondo real.
        <OffthreadVideo src={videoSrc} />
      ) : (
        // Fondo blanco para el playground (sin videoSrc).
        <AbsoluteFill style={{backgroundColor: 'white'}} />
      )}

      {/* Capa de subtitulos por encima del fondo. */}
      <Captions grupos={grupos} estilo={estilo} />
    </AbsoluteFill>
  );
};
