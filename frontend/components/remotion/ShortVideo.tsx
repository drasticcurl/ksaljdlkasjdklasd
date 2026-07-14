// COPIA para el navegador de remotion/src/ShortVideo.tsx.
//
// IMPORTANTE: mantener EN SINCRONÍA con `remotion/src/ShortVideo.tsx` del
// subproyecto Node. Se duplica aquí para que @remotion/player pueda renderizar
// la misma composición dentro del navegador (React + hooks de `remotion`). La
// lógica debe ser IDÉNTICA a la del subproyecto, salvo el subcomponente
// `FondoVideo` (ver nota de sincronia mas abajo).
//
// Composicion ShortVideo: fondo (video o blanco) + capa de subtitulos por grupo.
//
// Fondo:
//  - Si `videoSrc` es una cadena no vacia => <FondoVideo src={videoSrc} />
//    que en esta copia del navegador usa <Video> de remotion (reproduccion en
//    vivo con @remotion/player).
//  - Si `videoSrc` es "" o null => fondo blanco (modo playground).
//
// IMPORTANTE (sincronia de copias): `FondoVideo` es el UNICO componente que
// difiere entre esta copia del navegador (`frontend/components/remotion`) y la
// copia SSR (`remotion/src`). Aqui usa <Video>; en SSR usa <OffthreadVideo>
// (mas estable al renderizar frames con ffmpeg fuera del navegador). El resto
// de la logica (fondo blanco cuando videoSrc esta vacio y la capa <Captions/>)
// debe permanecer IDENTICO en ambas copias, y el contrato `ShortVideoProps` NO
// cambia.
//
// Encima se superpone la capa <Captions/> que muestra un grupo (frase) a la vez.
import React from 'react';
import {AbsoluteFill, Video} from 'remotion';
import {Captions} from './Captions';
import {TextosExtraLayer} from './TextosExtraLayer';
import type {ShortVideoProps} from './types';

/**
 * Fondo de video real. Es el unico punto que difiere entre la copia SSR y la
 * del navegador: en el navegador se usa <Video> de remotion, mas adecuado para
 * la reproduccion en vivo con @remotion/player que <OffthreadVideo>.
 */
const FondoVideo: React.FC<{src: string}> = ({src}) => {
  return <Video src={src} />;
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  videoSrc,
  grupos,
  estilo,
  textosExtra,
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

      {/*
        Capa de textos extra tipo "hook" POR ENCIMA de los subtitulos: al
        montarse DESPUES que <Captions/>, sus overlays de texto plano quedan
        visibles sobre el video y sobre los subtitulos (§7.4). `textosExtra` es
        opcional en el contrato => se normaliza a [] para que la capa reciba
        siempre un array (retrocompatibilidad: props sin este campo => sin
        overlays).
      */}
      <TextosExtraLayer textosExtra={textosExtra ?? []} />
    </AbsoluteFill>
  );
};
