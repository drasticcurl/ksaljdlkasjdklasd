// Capa de subtitulos animados estilo TikTok con @remotion/captions (Req 10.3).
//
// Flujo:
//  1. Se agrupan los captions en "paginas" con createTikTokStyleCaptions,
//     usando combineTokensWithinMilliseconds = combineMs (ventana de agrupacion).
//  2. Se calcula el tiempo actual en ms a partir del frame y del fps.
//  3. Se selecciona la pagina cuyo intervalo [startMs, startMs+durationMs)
//     contiene el instante actual.
//  4. Se pinta cada token; el token activo (ms dentro de [fromMs, toMs)) se
//     resalta con `colorResaltado`, el resto usa `color`.
//  5. Se aplica una animacion de entrada (fundido + desplazamiento) de duracion
//     `animEntradaMs` al inicio de cada pagina, y se posiciona el bloque segun
//     `posVerticalPct`.
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {createTikTokStyleCaptions, type Caption} from '@remotion/captions';
import type {Estilo} from './types';

type CaptionsProps = {
  captions: Caption[];
  estilo: Estilo;
  combineMs: number;
};

export const Captions: React.FC<CaptionsProps> = ({captions, estilo, combineMs}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Sin captions no se pinta nada.
  if (!captions || captions.length === 0) {
    return null;
  }

  // Tiempo actual del render en milisegundos.
  const ms = (frame / fps) * 1000;

  // (1) Agrupacion en paginas estilo TikTok. combineMs alto => mas palabras por
  // pagina; combineMs bajo => animacion palabra a palabra.
  const {pages} = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: combineMs,
  });

  // (3) Pagina activa segun el tiempo actual.
  const page = pages.find((p) => ms >= p.startMs && ms < p.startMs + p.durationMs);
  if (!page) {
    return null;
  }

  // (5) Animacion de entrada relativa al inicio de la pagina.
  const anim = estilo.animEntradaMs > 0 ? estilo.animEntradaMs : 1;
  const opacidad = interpolate(ms, [page.startMs, page.startMs + anim], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const desplazamientoY = interpolate(
    ms,
    [page.startMs, page.startMs + anim],
    [24, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Posicion vertical: posVerticalPct (0 arriba, 100 abajo) marca el centro del bloque.
  const topPct = Math.min(Math.max(estilo.posVerticalPct, 0), 100);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: `${topPct}%`,
          left: 0,
          right: 0,
          transform: `translateY(-50%) translateY(${desplazamientoY}px)`,
          opacity: opacidad,
          // whiteSpace: 'pre' preserva los espacios iniciales de cada token
          // (requisito de whitespace de createTikTokStyleCaptions).
          whiteSpace: 'pre',
          textAlign: 'center',
          padding: '0 5%',
          fontFamily: estilo.fuente,
          fontSize: estilo.tamano,
          fontWeight: 700,
          lineHeight: 1.2,
          textShadow: '0 2px 8px rgba(0,0,0,0.6)',
        }}
      >
        {page.tokens.map((token, i) => {
          // (4) Token activo => color de resaltado.
          const activo = ms >= token.fromMs && ms < token.toMs;
          return (
            <span
              key={i}
              style={{color: activo ? estilo.colorResaltado : estilo.color}}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
