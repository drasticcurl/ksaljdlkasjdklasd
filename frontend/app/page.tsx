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

import { useCallback, useState } from 'react';
import ClipUploader from '@/components/ClipUploader';
import ClipList from '@/components/ClipList';
import MusicUploader from '@/components/MusicUploader';
import GeneralSettings from '@/components/settings/GeneralSettings';
import SilenceSettings from '@/components/settings/SilenceSettings';
import TranscriptionSettings from '@/components/settings/TranscriptionSettings';
import SubtitleSettings from '@/components/settings/SubtitleSettings';
import ProcessButton from '@/components/ProcessButton';
import ProgressPanel from '@/components/ProgressPanel';
import ResultPreview from '@/components/ResultPreview';
import type { Clip, JobProgress } from '@/lib/types';
import { AJUSTES_POR_DEFECTO, MUSICA_POR_DEFECTO } from '@/lib/defaults';

export default function EditorPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [ajustes, setAjustes] = useState(AJUSTES_POR_DEFECTO);
  const [musicaId, setMusicaId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [completado, setCompletado] = useState(false);

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
  }, []);

  /** Marca el Job como completado para mostrar la previsualización (Req 11.1). */
  const manejarCompletado = useCallback((_p: JobProgress) => {
    setCompletado(true);
  }, []);

  const ordenClips = clips.map((clip) => clip.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
      <header className="border-b border-editor-border pb-4">
        <h1 className="text-2xl font-semibold text-white">
          Editor de Shorts Verticales
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Une clips, corta silencios, transcribe, subtitula y mezcla música para
          producir un video vertical 9:16 listo para publicar.
        </p>
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
          />

          <SilenceSettings
            valor={ajustes.silencios}
            onChange={(silencios) => setAjustes((p) => ({ ...p, silencios }))}
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
          onJobIniciado={manejarJobIniciado}
        />

        {jobId && (
          <ProgressPanel jobId={jobId} onCompletado={manejarCompletado} />
        )}

        {jobId && completado && <ResultPreview jobId={jobId} />}
      </section>
    </main>
  );
}
