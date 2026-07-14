// Composicion ShortVideo: fondo (video o blanco) + capa de subtitulos por grupo.
//
// Fondo:
//  - Si `videoSrc` es una cadena no vacia => <FondoVideo src={videoSrc} />
//    que en esta copia SSR usa <OffthreadVideo> (extrae los frames con ffmpeg
//    fuera del navegador, mas estable para el render).
//  - Si `videoSrc` es "" o null => fondo blanco (modo playground).
//
// IMPORTANTE (sincronia de copias): `FondoVideo` es el UNICO componente que
// difiere entre esta copia SSR (`remotion/src`) y la copia del navegador
// (`frontend/components/remotion`). Aqui usa <OffthreadVideo>; en el navegador
// usa <Video> de remotion (mas adecuado para @remotion/player). El resto de la
// logica (fondo blanco cuando videoSrc esta vacio y la capa <Captions/>) debe
// permanecer IDENTICO en ambas copias, y el contrato `ShortVideoProps` NO cambia.
//
// Encima se superpone la capa <Captions/> que muestra un grupo (frase) a la vez.
import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import {Captions} from './Captions';
import type {ShortVideoProps} from './types';

/**
 * Fondo de video real. Es el unico punto que difiere entre la copia SSR y la
 * del navegador: en SSR se usa <OffthreadVideo> por estabilidad al renderizar
 * frames con ffmpeg fuera del navegador.
 */
const FondoVideo: React.FC<{src: string}> = ({src}) => {
  return <OffthreadVideo src={src} />;
};

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
        // Video de fondo real (motor de video segun la copia: SSR vs navegador).
        <FondoVideo src={videoSrc} />
      ) : (
        // Fondo blanco para el playground (sin videoSrc).
        <AbsoluteFill style={{backgroundColor: 'white'}} />
      )}

      {/* Capa de subtitulos por encima del fondo. */}
      <Captions grupos={grupos} estilo={estilo} />
    </AbsoluteFill>
  );
};
