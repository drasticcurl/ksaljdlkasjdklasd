'use client';

/**
 * Pantalla principal del editor de shorts verticales (Tarea 20.4).
 *
 * Cablea el flujo completo del editor manteniendo el estado en React:
 *   - `clips` (y su orden vigente) — alimentado por `ClipUploader` y reordenado
 *     por `ClipList` (Req 2.3).
 *   - `ajustes` — editados por los paneles `settings/*` y el volumen de música;
 *     se conservan por defecto coherentes con el backend (`lib/defaults.ts`).
 *   - `musicaId` — establecido por `MusicUploader` (null si no hay WAV).
 *   - `jobId` — devuelto por `ProcessButton` al iniciar el procesamiento; dispara
 *     el `ProgressPanel` (Req 10.6) y, al completar, la previsualización con
 *     `ResultPreview` (Req 11.1).
 *
 * Requisitos: 2.3, 9.5, 10.6, 11.1.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ClipUploader from '@/components/ClipUploader';
import ClipList from '@/components/ClipList';
import MusicUploader from '@/components/MusicUploader';
import GeneralSettings from '@/components/settings/GeneralSettings';
import SilenceSettings from '@/components/settings/SilenceSettings';
import TransitionSettings from '@/components/settings/TransitionSettings';
import RisasSettings from '@/components/settings/RisasSettings';
import TranscriptionSettings from '@/components/settings/TranscriptionSettings';
import SubtitleSettings from '@/components/settings/SubtitleSettings';
import AjustesRevisionIA from '@/components/settings/AjustesRevisionIA';
import OpenAIKeyInput from '@/components/settings/OpenAIKeyInput';
import SettingsActions from '@/components/settings/SettingsActions';
import ProcessButton from '@/components/ProcessButton';
import ProgressPanel from '@/components/ProgressPanel';
import ResultPreview from '@/components/ResultPreview';
import SubtitleReview from '@/components/SubtitleReview';
import TimelineSilencios from '@/components/TimelineSilencios';
import PreviewFinal from '@/components/PreviewFinal';
import EleccionRender from '@/components/EleccionRender';
import type { Clip, JobProgress, RenderEleccion } from '@/lib/types';
import { AJUSTES_POR_DEFECTO, MUSICA_POR_DEFECTO } from '@/lib/defaults';
import { leerApiKeyLocal, obtenerConfiguracion, obtenerRender } from '@/lib/api';

export default function EditorPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ajustes, setAjustes] = useState(AJUSTES_POR_DEFECTO);
  const [musicaId, setMusicaId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Clave de API de OpenAI. Vive en el estado de React (se pasa a
  // `OpenAIKeyInput` y a `procesar`) y, en esta feature, ADEMÁS se persiste en
  // `localStorage` para no reintroducirla en cada sesión: `OpenAIKeyInput`
  // guarda/olvida la clave y esta página la PRECARGA al montar con
  // `leerApiKeyLocal()` (Req 12.2). Ver aviso de seguridad en `OpenAIKeyInput`.
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [completado, setCompletado] = useState(false);
  const [progresoActual, setProgresoActual] = useState<JobProgress | null>(null);
  // Datos de la etapa de edición final (`GET /render/{id}`) con los que se
  // alimenta `PreviewFinal` cuando el Job entra en `esperando_edicion_final`.
  const [datosEdicionFinal, setDatosEdicionFinal] =
    useState<RenderEleccion | null>(null);
  // Error de carga de los datos de edición final (no bloquea el resto de la UI).
  const [errorEdicionFinal, setErrorEdicionFinal] = useState<string | null>(
    null,
  );

  // Al abrir la app, cargar los ajustes por defecto guardados (JSON local del
  // backend). Si no hay o falla, se conservan los valores de fábrica.
  useEffect(() => {
    let cancelado = false;
    obtenerConfiguracion()
      .then((res) => {
        if (!cancelado && res.ajustes) setAjustes(res.ajustes);
      })
      .catch(() => {
        // Silencioso: sin configuración guardada se usan los de fábrica.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // Al montar, PRECARGAR la clave de OpenAI persistida en `localStorage`
  // (Req 12.2). Se hace en un efecto (no en el inicializador de estado) para
  // evitar desajustes de hidratación SSR/cliente: en el servidor no hay
  // `localStorage`. Si no hay clave guardada, `leerApiKeyLocal()` devuelve "".
  useEffect(() => {
    const clave = leerApiKeyLocal();
    if (clave) setOpenaiApiKey(clave);
  }, []);

  // Cuando el Job entra en `esperando_edicion_final`, cargar los datos del
  // vídeo cortado + subtítulos + textos extra persistidos (`GET /render/{id}`)
  // para alimentar `PreviewFinal`. La dependencia es el ESTADO (string), por lo
  // que el efecto solo se dispara al ENTRAR en la etapa (no en cada tick del
  // polling). Ante error se muestra el mensaje sin romper el resto de la UI.
  const estadoActual = progresoActual?.estado;
  useEffect(() => {
    if (!jobId || estadoActual !== 'esperando_edicion_final') return;
    let cancelado = false;
    setErrorEdicionFinal(null);
    obtenerRender(jobId)
      .then((res) => {
        if (!cancelado) setDatosEdicionFinal(res);
      })
      .catch(() => {
        if (!cancelado)
          setErrorEdicionFinal(
            'No se pudieron cargar los datos de la edición final.',
          );
      });
    return () => {
      cancelado = true;
    };
  }, [jobId, estadoActual]);

  /** Reindexa la lista de clips para que `posicion` sea 1..n. */
  const reindexar = useCallback(
    (lista: Clip[]): Clip[] =>
      lista.map((clip, i) => ({ ...clip, posicion: i + 1 })),
    [],
  );

  /** Añade los clips recién subidos al final del orden actual (Req 1.3, 2.3). */
  const manejarClipsSubidos = useCallback(
    (nuevos: Clip[]) => {
      setClips((previos) => reindexar([...previos, ...nuevos]));
    },
    [reindexar],
  );

  /** Actualiza el orden vigente tras un reordenamiento válido (Req 2.2, 2.3). */
  const manejarOrdenCambiado = useCallback(
    (nuevoOrden: Clip[]) => {
      setClips(reindexar(nuevoOrden));
    },
    [reindexar],
  );

  /** Sincroniza `musica_id` y el volumen base con los ajustes (Req 8.1, 9.4). */
  const manejarMusicaChange = useCallback(
    (info: { musicaId: string | null; volumenBasePct: number }) => {
      setMusicaId(info.musicaId);
      setAjustes((prev) => ({
        ...prev,
        musica:
          info.musicaId === null
            ? null
            : {
                ...(prev.musica ?? MUSICA_POR_DEFECTO),
                volumen_base_pct: info.volumenBasePct,
              },
      }));
    },
    [],
  );

  /** Inicia el seguimiento de progreso del Job recién creado (Req 10.6). */
  const manejarJobIniciado = useCallback((nuevoJobId: string) => {
    setJobId(nuevoJobId);
    setCompletado(false);
    setProgresoActual(null);
    // Limpia cualquier dato de edición final de un Job anterior.
    setDatosEdicionFinal(null);
    setErrorEdicionFinal(null);
  }, []);

  /**
   * Tras enviar/confirmar en cualquiera de las pausas (silencios, revisión de
   * subtítulos o edición final), el Job vuelve a `en_ejecucion` y el polling del
   * `ProgressPanel` (activo mientras exista `jobId`) sigue reflejando el
   * progreso automáticamente. Aquí solo se limpian los datos transitorios de la
   * edición final para que se recarguen si se volviera a esa etapa.
   */
  const manejarPausaReanudada = useCallback(() => {
    setDatosEdicionFinal(null);
    setErrorEdicionFinal(null);
  }, []);

  /** Restablece los ajustes a los valores de fábrica (tras borrar el guardado). */
  const manejarRestablecer = useCallback(() => {
    setAjustes(AJUSTES_POR_DEFECTO);
  }, []);

  /** Marca el Job como completado para mostrar la previsualización (Req 11.1). */
  const manejarCompletado = useCallback((_p: JobProgress) => {
    setCompletado(true);
  }, []);

  const ordenClips = clips.map((clip) => clip.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between border-b border-editor-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Editor de Shorts Verticales
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Une clips, corta silencios, transcribe, subtitula y mezcla música
            para producir un video vertical 9:16 listo para publicar.
          </p>
        </div>
        {/* Enlace al banco de pruebas visual de subtítulos (Remotion). */}
        <Link
          href="/playground"
          className="shrink-0 rounded border border-editor-border px-3 py-2 text-sm text-gray-200 hover:bg-editor-panel"
        >
          Abrir Playground de subtítulos
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Columna izquierda: clips + orden (Tareas 17, 18). */}
        <section
          aria-label="Clips y orden"
          className="flex flex-col gap-4 rounded-lg border border-editor-border bg-editor-panel p-4 lg:col-span-2"
        >
          <div>
            <h2 className="mb-2 text-lg font-medium text-white">1. Clips</h2>
            <ClipUploader onClipsSubidos={manejarClipsSubidos} />
          </div>

          <div>
            <h2 className="mb-2 text-lg font-medium text-white">2. Orden</h2>
            <ClipList clips={clips} onOrdenCambiado={manejarOrdenCambiado} />
          </div>
        </section>

        {/* Columna derecha: ajustes + música (Tarea 19). */}
        <aside
          aria-label="Ajustes"
          className="flex flex-col gap-4 rounded-lg border border-editor-border bg-editor-panel p-4"
        >
          <h2 className="text-lg font-medium text-white">3. Ajustes</h2>

          <GeneralSettings
            valor={ajustes.generales}
            onChange={(generales) => setAjustes((p) => ({ ...p, generales }))}
          />

          <SubtitleSettings
            valor={ajustes.subtitulos}
            onChange={(subtitulos) => setAjustes((p) => ({ ...p, subtitulos }))}
            iaActivada={ajustes.revision_ia.activado}
          />

          <AjustesRevisionIA
            valor={ajustes.revision_ia}
            onChange={(revision_ia) =>
              setAjustes((p) => ({
                ...p,
                revision_ia,
                // Al activar la IA, se fuerza `revisar=false`: el backend omite
                // la pausa de revisión manual cuando la IA está activada.
                subtitulos: revision_ia.activado
                  ? { ...p.subtitulos, revisar: false }
                  : p.subtitulos,
              }))
            }
          />

          {/* La clave solo se pide cuando la corrección con IA está activada. */}
          {ajustes.revision_ia.activado && (
            <OpenAIKeyInput
              value={openaiApiKey}
              onChange={setOpenaiApiKey}
            />
          )}

          <SilenceSettings
            valor={ajustes.silencios}
            onChange={(silencios) => setAjustes((p) => ({ ...p, silencios }))}
          />

          <TransitionSettings
            valor={ajustes.transiciones}
            onChange={(transiciones) =>
              setAjustes((p) => ({ ...p, transiciones }))
            }
          />

          <RisasSettings
            valor={ajustes.risas}
            onChange={(risas) => setAjustes((p) => ({ ...p, risas }))}
          />

          <TranscriptionSettings
            valor={ajustes.transcripcion}
            onChange={(transcripcion) =>
              setAjustes((p) => ({ ...p, transcripcion }))
            }
            resolucion={ajustes.generales.resolucion}
            onResolucionChange={(resolucion) =>
              setAjustes((p) => ({
                ...p,
                generales: { ...p.generales, resolucion },
              }))
            }
          />

          <div>
            <h2 className="mb-2 text-lg font-medium text-white">4. Música</h2>
            <MusicUploader
              onMusicaChange={manejarMusicaChange}
              volumenInicial={MUSICA_POR_DEFECTO.volumen_base_pct}
            />
          </div>

          <div className="border-t border-editor-border pt-3">
            <SettingsActions
              ajustes={ajustes}
              onRestablecer={manejarRestablecer}
            />
          </div>
        </aside>
      </div>

      {/* Fila inferior: procesar + progreso + resultado (Tarea 20). */}
      <section
        aria-label="Procesamiento y resultado"
        className="flex flex-col gap-4 rounded-lg border border-editor-border bg-editor-panel p-4"
      >
        <h2 className="text-lg font-medium text-white">5. Procesar</h2>

        <ProcessButton
          ordenClips={ordenClips}
          ajustes={ajustes}
          musicaId={musicaId}
          openaiApiKey={openaiApiKey}
          onJobIniciado={manejarJobIniciado}
        />

        {jobId && (
          <ProgressPanel
            jobId={jobId}
            onCompletado={manejarCompletado}
            onProgreso={setProgresoActual}
          />
        )}

        {/* Pausa 1 — Edición de silencios (Req 1.5): el Job se detiene tras
            detectar los silencios sobre el vídeo unido; el usuario ajusta a mano
            los tramos a borrar y confirma. Al enviar, el pipeline reanuda. */}
        {jobId && progresoActual?.estado === 'esperando_edicion_silencios' && (
          <TimelineSilencios jobId={jobId} onEnviado={manejarPausaReanudada} />
        )}

        {/* Pausa 2 — Revisión de subtítulos de SOLO TEXTO (Req 6.1): se editan
            los textos de cada línea (sin tiempos ni split/merge) y se confirman. */}
        {jobId && progresoActual?.estado === 'esperando_revision' && (
          <SubtitleReview jobId={jobId} onEnviado={manejarPausaReanudada} />
        )}

        {/* Pausa 3 — Edición final (Req 8.1, 11.1): preview del vídeo cortado
            con subtítulos, gestión de hasta 2 textos extra y confirmación del
            render, que es SIEMPRE Remotion (sin elección de motor). Se alimenta
            con los datos de `GET /render/{id}` cargados en el efecto de arriba. */}
        {jobId && progresoActual?.estado === 'esperando_edicion_final' && (
          <>
            {errorEdicionFinal && (
              <p
                role="alert"
                data-testid="edicion-final-error"
                className="text-sm text-red-400"
              >
                {errorEdicionFinal}
              </p>
            )}

            {!datosEdicionFinal && !errorEdicionFinal && (
              <p className="text-sm text-gray-300">
                Cargando la edición final…
              </p>
            )}

            {datosEdicionFinal && datosEdicionFinal.video_url && (
              <PreviewFinal
                jobId={jobId}
                grupos={datosEdicionFinal.grupos}
                videoUrl={datosEdicionFinal.video_url}
                width={datosEdicionFinal.ancho}
                height={datosEdicionFinal.alto}
                fps={datosEdicionFinal.fps}
                duracionS={datosEdicionFinal.duracion_s ?? 0}
                textosExtraIniciales={datosEdicionFinal.textos_extra ?? []}
                onRenderConfirmado={manejarPausaReanudada}
              />
            )}

            {datosEdicionFinal && !datosEdicionFinal.video_url && (
              <p
                role="alert"
                data-testid="edicion-final-sin-video"
                className="text-sm text-yellow-400"
              >
                No hay vídeo cortado disponible para la previsualización final.
              </p>
            )}
          </>
        )}

        {/* Compatibilidad con el flujo ANTIGUO de elección de motor: en la
            feature actual el render es siempre Remotion y esta etapa se sustituye
            por `esperando_edicion_final` (arriba). Se mantiene el manejo antiguo
            por si un Job heredado reporta todavía `esperando_eleccion_render`. */}
        {jobId && progresoActual?.estado === 'esperando_eleccion_render' && (
          <EleccionRender jobId={jobId} />
        )}

        {jobId && completado && <ResultPreview jobId={jobId} />}
      </section>
    </main>
  );
}
