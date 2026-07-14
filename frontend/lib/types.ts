/**
 * Tipos compartidos de la Interfaz, alineados con los contratos del backend
 * (FastAPI en localhost:8000). Ver `.kiro/specs/vertical-shorts-editor/design.md`
 * ("Backend: contratos de API" y "Modelo completo de ajustes de configuración").
 *
 * Requisitos: 1.1 (clips), 8.1 (música), 9.5 (ajustes), 10.6 (progreso),
 * 11.2 (descarga).
 */

// ---------------------------------------------------------------------------
// Clips (POST /clips) — Req 1.2, 1.3
// ---------------------------------------------------------------------------

/** Un clip de video almacenado por el backend, tal como lo devuelve `POST /clips`. */
export interface Clip {
  /** Identificador único del clip (Req 1.2). */
  id: string;
  /** Nombre del archivo original subido por el usuario. */
  nombre_original: string;
  /** Posición 1..n en el orden de recepción/edición (Req 1.3). */
  posicion: number;
  /** Tamaño del archivo en bytes. */
  tamano_bytes: number;
  /** Duración en segundos, si el backend la conoce. */
  duracion_s: number | null;
}

/** Respuesta de `POST /clips`. */
export interface SubirClipsResponse {
  clips: Clip[];
}

// ---------------------------------------------------------------------------
// Música (POST /musica) — Req 8.1, 8.2
// ---------------------------------------------------------------------------

/** Respuesta de `POST /musica`. */
export interface SubirMusicaResponse {
  musica_id: string;
  nombre_original: string;
  duracion_s: number | null;
}

// ---------------------------------------------------------------------------
// Ajustes (secciones alineadas con backend/app/models/settings.py)
// ---------------------------------------------------------------------------

/** Posición vertical del subtítulo (Req 7.5). */
export type PosicionVertical = 'superior' | 'centro' | 'inferior';

/** Posición horizontal del subtítulo (Req 7.6). */
export type PosicionHorizontal = 'izquierda' | 'centro' | 'derecha';

/** Resolución vertical objetivo (Req 3.2). */
export interface ResolucionObjetivo {
  /** Ancho en píxeles: 2..7680, def 1080. */
  ancho: number;
  /** Alto en píxeles: 2..7680, def 1920. */
  alto: number;
}

/** Ajustes generales: resolución y fps (Req 3.2, 3.5). */
export interface AjustesGenerales {
  resolucion: ResolucionObjetivo;
  /** Cuadros por segundo: 1..120, def 30. */
  fps: number;
}

/** Método de corte de silencios: por umbral de dB o por voz (IA/VAD). */
export type ModoSilencio = 'db' | 'voz';

/** Ajustes del corte de silencios en unidades de la UI (Req 4, 9.2). */
export interface AjustesSilencios {
  /** Activa/desactiva el paso de corte de silencios (Req 4.3). */
  activado: boolean;
  /** Método: "db" (umbral) o "voz" (detección de voz con IA/VAD). */
  modo: ModoSilencio;
  /** Umbral de silencio en dB (UI): -60..0. */
  umbral_db: number;
  /** Margen en milisegundos (UI): 0..5000. */
  margen_ms: number;
}

/** Ajustes de eliminación de risas (jaja/jeje/...) por transcripción. */
export interface AjustesRisas {
  /** Si es `true`, se recortan los segmentos de risa del video. */
  activado: boolean;
  /** Margen (ms) recortado a cada lado de cada risa: 0..2000. */
  margen_ms: number;
}

/** Tipo de transición entre clips (Paso 1, UNIR). */
export type TipoTransicion =
  | 'ninguna'
  | 'disolucion'
  | 'fundido_negro'
  | 'deslizar_izq'
  | 'deslizar_arriba';

/** Ajustes de la transición entre clips (mismo efecto entre todos los clips). */
export interface AjustesTransiciones {
  /** Tipo de transición; `ninguna` es el corte duro (sin recodificar). */
  tipo: TipoTransicion;
  /** Duración del efecto en ms: 100..2000, def 400. */
  duracion_ms: number;
}

/** Ajustes de transcripción (Req 5, 9.3). */
export interface AjustesTranscripcion {
  /** Idioma soportado por faster-whisper, o "auto" para detección. Def "es". */
  idioma: string;
  /** Nombre de modelo soportado por faster-whisper. Def "small". */
  modelo: string;
}

/** Preset de estilo de subtítulo. */
export type PresetSubtitulo = 'clasico' | 'resaltado' | 'bold_pop';

/** Ajustes de subtítulos y su animación (Req 6, 7, 9.1). */
export interface AjustesSubtitulos {
  /** Máximo de palabras por grupo: UI 1..20 / motor 1..10, def 4. */
  max_palabras: number;
  /** Si es `true`, el pipeline se pausa tras transcribir para revisar el texto. */
  revisar: boolean;
  /** Si es `true`, todo el texto de los subtítulos se muestra en minúscula. */
  minusculas: boolean;
  /** Preset de estilo: `clasico` (línea) o `resaltado`/`bold_pop` (karaoke). */
  preset: PresetSubtitulo;
  /** Color de acento `#RRGGBB` de la palabra activa (presets de karaoke). */
  color_resaltado: string;
  posicion_vertical: PosicionVertical;
  posicion_horizontal: PosicionHorizontal;
  /** Posición vertical como % de la altura: 0..100. */
  pos_vertical_pct: number;
  /** Posición horizontal como % del ancho: 0..100. */
  pos_horizontal_pct: number;
  /** Margen en píxeles: 0..500. */
  margen_px: number;
  fuente: string;
  /** Tamaño de fuente: motor 12..200, def 72. */
  tamano: number;
  /** Color primario `#RRGGBB`. */
  color: string;
  /** Color del borde `#RRGGBB`. */
  color_borde: string;
  /** Grosor del borde: motor 0..20, def 5. */
  grosor_borde: number;
  negrita: boolean;
  /** Duración de la animación de entrada (ms): motor 100..2000, def 300. */
  anim_entrada_ms: number;
  /** Duración de la animación de salida (ms): motor 100..2000, def 300. */
  anim_salida_ms: number;
  /** Píxeles de deslizamiento (slide-up): motor 1..500, def 50. */
  slide_px: number;
}

/**
 * Motor de render del paso de subtítulos (spec subtitulos-ia-remotion).
 *
 * `ass` = quemado con ffmpeg/libass (clásico); `remotion` = vídeo programático
 * (React) con subtítulos animados de mayor calidad. La elección la hace el
 * usuario en tiempo de ejecución mediante dos botones; no es automática.
 */
export type MotorRender = 'ass' | 'remotion';

/**
 * Ajustes de la corrección de subtítulos con IA (OpenAI GPT-4.1 mini), opt-in.
 *
 * Es la primera dependencia de red externa del sistema, por eso `activado` es
 * `false` por defecto. La clave de API NO se declara aquí: es transitoria y no
 * debe persistirse nunca (viaja como campo aparte en `POST /procesar`).
 * Espejo de `AjustesRevisionIA` en `backend/app/models/settings.py`.
 */
export interface AjustesRevisionIA {
  /** OPT-IN: desactivado por defecto (Req 1.1). */
  activado: boolean;
  /** Modelo de OpenAI (por defecto `gpt-4.1-mini`). */
  modelo: string;
  /** Timeout de la llamada a OpenAI en segundos: 1..120, def 20. */
  timeout_s: number;
  /** Reintentos ante 429: 0..5, def 1. */
  max_reintentos: number;
}

/**
 * Ajustes del render de subtítulos (Paso 4c).
 *
 * NO existe `fallback_ass`: el motor lo elige el usuario en tiempo de ejecución
 * (dos botones). `motor_preferido` es SOLO una preselección de UI (qué botón se
 * resalta); no fuerza la ejecución. Espejo de `AjustesRender` en el backend.
 */
export interface AjustesRender {
  /** Preselección de UI del botón resaltado (Req 6.3). Def `ass`. */
  motor_preferido: MotorRender;
  /** Ventana de agrupación de tokens estilo TikTok (ms): 0..5000, def 1200. */
  combine_tokens_ms: number;
}

/** Ajustes de música de fondo y ducking (Req 8). */
export interface AjustesMusica {
  /** Volumen base de la música: 0..100 %, def 30. */
  volumen_base_pct: number;
  /** Reducción por ducking: >= 12 dB. */
  reduccion_db: number;
  /** Umbral de voz en dBFS: -30. */
  umbral_voz_dbfs: number;
  /** Ataque del ducking (ms): <= 250. */
  ataque_ms: number;
  /** Liberación del ducking (ms): <= 500. */
  liberacion_ms: number;
}

/** Conjunto completo de ajustes enviado en `POST /procesar`. */
export interface Ajustes {
  generales: AjustesGenerales;
  silencios: AjustesSilencios;
  transiciones: AjustesTransiciones;
  risas: AjustesRisas;
  transcripcion: AjustesTranscripcion;
  subtitulos: AjustesSubtitulos;
  /** Música opcional: `null` si no se agregó WAV (el paso 5 se omite). */
  musica: AjustesMusica | null;
  /** Corrección de subtítulos con IA (opt-in, spec subtitulos-ia-remotion). */
  revision_ia: AjustesRevisionIA;
  /** Ajustes del motor de render de subtítulos (spec subtitulos-ia-remotion). */
  render: AjustesRender;
}

/** Alias en inglés usado por parte de la UI; equivalente a `Ajustes`. */
export type Settings = Ajustes;

// ---------------------------------------------------------------------------
// Procesamiento (POST /procesar) — Req 9.5, 10.1, 10.2
// ---------------------------------------------------------------------------

/** Cuerpo de la petición `POST /procesar`. */
export interface ProcesarRequest {
  /** Orden de clips vigente (1..500 ids). */
  orden_clips: string[];
  /** Id de música opcional. */
  musica_id: string | null;
  /** Ajustes completos configurados en la UI. */
  ajustes: Ajustes;
  /**
   * Clave de API de OpenAI transitoria (spec subtitulos-ia-remotion). NO forma
   * parte de `Ajustes` ni se persiste con `guardarConfiguracion`: viaja solo en
   * esta petición y el backend la mantiene en memoria mientras dura el Job. Se
   * omite del cuerpo si es `null`/`undefined`/vacía.
   */
  openai_api_key?: string | null;
}

/** Respuesta de `POST /procesar` (202). */
export interface ProcesarResponse {
  job_id: string;
  estado: JobStatus;
}

// ---------------------------------------------------------------------------
// Progreso (GET /progreso/{id}) — Req 10.3, 10.6, 10.7
// ---------------------------------------------------------------------------

/** Estados posibles de un Job (Req 10.3). */
export type JobStatus =
  | 'en_cola'
  | 'en_ejecucion'
  | 'esperando_revision'
  | 'esperando_eleccion_render'
  | 'completado'
  | 'fallido';

/** Un grupo de subtítulo (línea) con su texto y tiempos (revisión manual). */
export interface GrupoSubtitulo {
  texto: string;
  inicio_s: number;
  fin_s: number;
}

/**
 * Palabra transcrita con tiempos en segundos (para el karaoke de la preview).
 *
 * Los tiempos pueden ser `null` cuando la transcripción no aporta timing por
 * palabra; en ese caso la palabra hereda los tiempos del grupo (mismo criterio
 * que `backend/app/engine/remotion.py`).
 */
export interface PalabraSubtitulo {
  texto: string;
  inicio_s: number | null;
  fin_s: number | null;
}

/**
 * Grupo de subtítulo con palabras opcionales (respuesta ampliada de
 * `GET /render/{id}`, spec previsualizacion-video-real-remotion).
 *
 * Es retrocompatible con `GrupoSubtitulo`: añade únicamente `palabras`, que
 * puede faltar o ser `null` cuando el grupo no tiene timing por palabra.
 */
export interface GrupoSubtituloConPalabras {
  texto: string;
  inicio_s: number;
  fin_s: number;
  /** Palabras con tiempos; puede faltar (grupos sin timing por palabra). */
  palabras?: PalabraSubtitulo[] | null;
}

/** Respuesta de `GET /subtitulos/{id}`. */
export interface SubtitulosRevision {
  job_id: string;
  estado: JobStatus;
  editable: boolean;
  grupos: GrupoSubtitulo[];
}

/**
 * Respuesta de `GET /render/{id}` (spec subtitulos-ia-remotion, ampliada por
 * spec previsualizacion-video-real-remotion).
 *
 * Se consulta cuando el Job está en `esperando_eleccion_render`: expone los
 * grupos de subtítulo ya corregidos (solo lectura) y la preselección de motor
 * para resaltar el botón sugerido. La ampliación añade los datos del vídeo real
 * de fondo (URL, dimensiones, fps y duración) necesarios para montar la
 * previsualización con `@remotion/player`. Los campos nuevos son aditivos y no
 * rompen los usos actuales del contrato.
 */
export interface RenderEleccion {
  job_id: string;
  estado: JobStatus;
  /** Si los grupos aún pueden editarse (en esta fase suele ser `false`). */
  editable: boolean;
  /** Preselección de UI del botón a resaltar. */
  motor_preferido: MotorRender;
  /**
   * Subtítulos corregidos, en solo lectura, para revisar antes de elegir motor.
   * Cada grupo puede incluir `palabras` con tiempos (para el karaoke); el tipo
   * es retrocompatible con `GrupoSubtitulo`.
   */
  grupos: GrupoSubtituloConPalabras[];
  /** URL HTTP del vídeo de fondo ya cortado; `null` si no hay `cortado_path`. */
  video_url: string | null;
  /** Nombre de archivo del vídeo cortado; `null` si no hay `cortado_path`. */
  video_nombre: string | null;
  /** Cuadros por segundo del render, tomado de `ajustes.generales`. */
  fps: number;
  /** Ancho en píxeles del render, tomado de `ajustes.generales`. */
  ancho: number;
  /** Alto en píxeles del render, tomado de `ajustes.generales`. */
  alto: number;
  /** Duración inspeccionada del vídeo cortado (best-effort); `null` si falla. */
  duracion_s: number | null;
}

/** Respuesta de `GET`/`PUT` `/configuracion`. */
export interface ConfiguracionResponse {
  ajustes: Ajustes | null;
}

/** Pasos del pipeline, en orden estricto. */
export type PipelineStep =
  | 'UNIR'
  | 'CORTAR_SILENCIOS'
  | 'TRANSCRIBIR'
  | 'SUBTITULOS'
  | 'MUSICA';

/** Detalle del error de un Job fallido (Req 10.7). */
export interface JobError {
  paso: string;
  motivo: string;
}

/** Estado de progreso devuelto por `GET /progreso/{id}` (Req 10.3). */
export interface JobProgress {
  job_id: string;
  estado: JobStatus;
  paso_actual: PipelineStep | null;
  indice_paso: number;
  total_pasos: number;
  /** Porcentaje 0..100. */
  porcentaje: number;
  mensaje: string;
  /** `{ paso, motivo }` cuando el estado es `fallido` (Req 10.7); si no, null. */
  error: JobError | null;
}

// ---------------------------------------------------------------------------
// Errores homogéneos del backend
// ---------------------------------------------------------------------------

/** Cuerpo de error homogéneo `{ error: { code, message, details } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
  };
}
