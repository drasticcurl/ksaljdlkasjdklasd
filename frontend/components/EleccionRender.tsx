'use client';

/**
 * EleccionRender — Elección manual del motor de render de subtítulos.
 *
 * Se muestra cuando un Job está en estado `esperando_eleccion_render`: obtiene
 * los subtítulos ya corregidos (`GET /render/{id}`) y los presenta en SOLO
 * LECTURA, junto con dos botones —"Editar con Remotion" y "ffmpeg"— para que el
 * usuario elija el motor. Al pulsar, llama a `POST /render/{id}` con el motor
 * elegido para reanudar el pipeline; se ejecuta exactamente ese motor (sin
 * fallback automático).
 *
 * `motor_preferido` (que llega en la respuesta) se usa ÚNICAMENTE para resaltar
 * visualmente el botón sugerido; no fuerza la elección.
 *
 * Además (spec previsualizacion-video-real-remotion) almacena los datos del
 * vídeo real de fondo que ahora expone `GET /render/{id}` (`video_url`,
 * `video_nombre`, `fps`, `ancho`, `alto`, `duracion_s`) y ofrece un toggle
 * "Previsualizar con vídeo real (Remotion)", desactivado por defecto y
 * deshabilitado cuando no hay vídeo de fondo disponible (`video_url === null`).
 *
 * Cuando el toggle está activo Y hay `video_url` (y ya se cargaron los grupos),
 * monta `PreviewRemotionReal` con los datos del vídeo real; al desactivar el
 * toggle, la previsualización se desmonta (liberando el reproductor) (tarea 6.2,
 * Req 2.3, 2.4). La confirmación del render desde la preview
 * (`onRenderConfirmado`) se cablea a `onElegido('remotion')`, de modo que
 * confirmar en la preview equivale a elegir el motor Remotion (Req 6.3).
 *
 * El flujo `ffmpeg` (los dos botones y `POST /render {motor:"ass"}`) permanece
 * INTACTO: no monta el Player ni consulta `/workfile`. La preview solo se monta
 * cuando el usuario activa explícitamente el toggle (Req 7.1, 7.2, 7.3).
 *
 * Requisitos: 6.2, 6.3, 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 9.2.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, elegirRender, obtenerRender } from '@/lib/api';
import type { GrupoSubtituloConPalabras, MotorRender } from '@/lib/types';
import PreviewRemotionReal from '@/components/PreviewRemotionReal';

export interface EleccionRenderProps {
  /** Id del Job pausado esperando la elección de motor. */
  jobId: string;
  baseUrl?: string;
  /** Se invoca cuando el motor se elige correctamente (reanudación). */
  onElegido?: (motor: MotorRender) => void;
  /** Inyección opcional (tests). */
  obtenerFn?: typeof obtenerRender;
  elegirFn?: typeof elegirRender;
}

/** Formatea segundos como `m:ss.d` para mostrar el rango de cada línea. */
function fmtTiempo(s: number): string {
  const min = Math.floor(s / 60);
  const seg = (s % 60).toFixed(1).padStart(4, '0');
  return `${min}:${seg}`;
}

export default function EleccionRender({
  jobId,
  baseUrl,
  onElegido,
  obtenerFn = obtenerRender,
  elegirFn = elegirRender,
}: EleccionRenderProps) {
  // Grupos con palabras opcionales (respuesta ampliada), para poder pasarlos
  // luego a la previsualización con karaoke (tarea 6.2).
  const [grupos, setGrupos] = useState<GrupoSubtituloConPalabras[] | null>(null);
  const [motorPreferido, setMotorPreferido] = useState<MotorRender>('ass');
  // Datos del vídeo real de fondo expuestos por `GET /render/{id}` (spec
  // previsualizacion-video-real-remotion). Se almacenan para montar la preview.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoNombre, setVideoNombre] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(30);
  const [ancho, setAncho] = useState<number>(1080);
  const [alto, setAlto] = useState<number>(1920);
  const [duracionS, setDuracionS] = useState<number | null>(null);
  // Toggle de previsualización con vídeo real; DESACTIVADO por defecto (Req 2.5).
  const [previewActivo, setPreviewActivo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    obtenerFn(jobId, { baseUrl })
      .then((res) => {
        if (cancelado) return;
        setGrupos(res.grupos);
        setMotorPreferido(res.motor_preferido);
        // Almacenar los datos del vídeo real de fondo (respuesta ampliada).
        setVideoUrl(res.video_url);
        setVideoNombre(res.video_nombre);
        setFps(res.fps);
        setAncho(res.ancho);
        setAlto(res.alto);
        setDuracionS(res.duracion_s);
      })
      .catch((err) => {
        if (cancelado) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudieron cargar los subtítulos para elegir el motor.',
        );
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, baseUrl, obtenerFn]);

  const elegir = useCallback(
    async (motor: MotorRender) => {
      if (enviando || grupos === null) return;
      setEnviando(true);
      setError(null);
      try {
        await elegirFn(jobId, motor, { baseUrl });
        onElegido?.(motor);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo iniciar el render con el motor elegido.',
        );
        setEnviando(false);
      }
    },
    [enviando, grupos, jobId, baseUrl, elegirFn, onElegido],
  );

  // Clases del botón: se resalta el `motor_preferido` (solo sugerencia visual).
  const claseBoton = (motor: MotorRender): string => {
    const base =
      'rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50';
    return motor === motorPreferido
      ? `${base} bg-blue-600 ring-2 ring-blue-400`
      : `${base} bg-gray-700`;
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-editor-border bg-editor-panel p-4"
      data-testid="eleccion-render"
    >
      <div>
        <h3 className="text-lg font-medium text-white">Elegir motor de render</h3>
        <p className="mt-1 text-sm text-gray-400">
          Estos son los subtítulos ya corregidos. Elige con qué motor quieres
          generar el video: Remotion (subtítulos animados de mayor calidad) o
          ffmpeg (quemado clásico). Se ejecutará exactamente el motor que elijas.
        </p>
      </div>

      {cargando && (
        <p data-testid="eleccion-cargando" className="text-sm text-gray-300">
          Cargando subtítulos…
        </p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="eleccion-error"
          className="text-sm text-red-400"
        >
          {error}
        </p>
      )}

      {grupos && grupos.length > 0 && (
        <ul
          className="flex flex-col gap-2"
          data-testid="eleccion-subtitulos"
        >
          {grupos.map((g, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">
                {fmtTiempo(g.inicio_s)} – {fmtTiempo(g.fin_s)}
              </span>
              {/* Solo lectura: en esta fase el texto ya está corregido. */}
              <p
                data-testid={`eleccion-linea-${i}`}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-white"
              >
                {g.texto}
              </p>
            </li>
          ))}
        </ul>
      )}

      {grupos && grupos.length === 0 && !cargando && (
        <p className="text-sm text-gray-400">
          No se detectaron subtítulos.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => elegir('remotion')}
          disabled={enviando || cargando || grupos === null}
          data-testid="eleccion-motor-remotion"
          className={claseBoton('remotion')}
        >
          Editar con Remotion
        </button>
        <button
          type="button"
          onClick={() => elegir('ass')}
          disabled={enviando || cargando || grupos === null}
          data-testid="eleccion-motor-ass"
          className={claseBoton('ass')}
        >
          ffmpeg
        </button>
      </div>

      {/*
        Toggle de previsualización con vídeo real (Remotion). Está DESACTIVADO
        por defecto (Req 2.5) y se DESHABILITA cuando no hay vídeo de fondo
        disponible (`video_url === null`), mostrando entonces un aviso
        (Req 2.2, 9.2). El montaje de la previsualización se hace en la tarea 6.2.
      */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={previewActivo}
            disabled={cargando || grupos === null || videoUrl === null}
            onChange={(e) => setPreviewActivo(e.target.checked)}
            data-testid="toggle-preview-remotion"
            className="h-4 w-4 disabled:opacity-50"
          />
          Previsualizar con vídeo real (Remotion)
        </label>

        {!cargando && grupos !== null && videoUrl === null && (
          <p
            role="note"
            data-testid="preview-no-disponible"
            className="text-xs text-gray-400"
          >
            La previsualización del vídeo no está disponible; puedes renderizar
            directamente.
          </p>
        )}
      </div>

      {/*
        Montaje/desmontaje de la previsualización con vídeo real (tarea 6.2).

        Se monta `PreviewRemotionReal` SOLO cuando el toggle está activo
        (`previewActivo`) Y hay vídeo de fondo (`videoUrl !== null`) Y los grupos
        ya se cargaron (`grupos !== null`). Al desactivar el toggle, esta rama deja
        de renderizarse y React DESMONTA el componente, liberando el `<Player>`
        (Req 2.3, 2.4).

        Reutilizamos la inyección `elegirFn` de este componente para la preview,
        de modo que confirmar el render en la preview use el mismo camino (y sea
        igual de testeable). `onRenderConfirmado` se cablea a
        `onElegido?.('remotion')`: confirmar desde la preview equivale a elegir el
        motor Remotion (Req 6.3).

        El flujo `ffmpeg` NO se ve afectado: esta preview no se monta salvo que el
        usuario active el toggle, así que elegir "ffmpeg" nunca monta el Player ni
        consulta `/workfile` (Req 7.1, 7.2, 7.3).
      */}
      {previewActivo && grupos !== null && videoUrl !== null && (
        <PreviewRemotionReal
          jobId={jobId}
          grupos={grupos}
          videoUrl={videoUrl}
          width={ancho}
          height={alto}
          fps={fps}
          duracionS={duracionS ?? 0}
          baseUrl={baseUrl}
          onRenderConfirmado={() => onElegido?.('remotion')}
          elegirFn={elegirFn}
        />
      )}

      {enviando && (
        <p data-testid="eleccion-enviando" className="text-sm text-gray-300">
          Iniciando el render…
        </p>
      )}
    </div>
  );
}
