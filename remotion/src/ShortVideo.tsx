// Composicion ShortVideo: video de fondo + capa de subtitulos animados.
//
// El video de fondo usa <OffthreadVideo> (extrae los frames con ffmpeg fuera del
// navegador, mas estable y rapido para render). Encima se superpone la capa
// <Captions/> con el resaltado token a token estilo TikTok.
import React from 'react';
import {AbsoluteFill, OffthreadVideo} from 'remotion';
import {Captions} from './Captions';
import type {ShortVideoProps} from './types';

export const ShortVideo: React.FC<ShortVideoProps> = ({
  videoSrc,
  captions,
  estilo,
  combineTokensWithinMs,
}) => {
  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      {/* Video de fondo (Req 9.1): se renderiza solo si hay una fuente valida. */}
      {videoSrc ? <OffthreadVideo src={videoSrc} /> : null}

      {/* Capa de subtitulos por encima del video. */}
      <Captions
        captions={captions}
        estilo={estilo}
        combineMs={combineTokensWithinMs}
      />
    </AbsoluteFill>
  );
};
