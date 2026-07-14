/**
 * Cliente HTTP hacia el backend FastAPI (localhost:8000).
 *
 * Expone funciones tipadas para cada endpoint del contrato del backend:
 *   - POST /clips      (multipart, timeout 60 s — Req 1.7)
 *   - POST /musica     (multipart)
 *   - POST /procesar   (JSON)
 *   - GET  /progreso/{id}
 *   - GET  /descargar/{id}
 *
 * La URL base es configurable mediante `NEXT_PUBLIC_API_BASE_URL` y por defecto
 * apunta a `http://localhost:8000`.
 *
 * Requisitos: 1.1, 1.7, 8.1, 9.5, 10.1, 10.6, 11.2.
 */

import type {
  Ajustes,
  ApiErrorBody,
  ConfiguracionResponse,
  GrupoSubtitulo,
  JobProgress,
  MotorRender,
  ProcesarRequest,
  ProcesarResponse,
  RenderEleccion,
  SilenciosEdicion,
  SubirClipsResponse,
  SubirMusicaResponse,
  SubtitulosRevision,
  TextoExtra,
  TramoSilencio,
} from './types';

/** URL base del backend; configurable por variable de entorno pública. */
export const API_BASE_URL: string =
  (typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_API_BASE_URL) ||
  'http://localhost:8000';

/** Plazo de subida de clips: 60 s (Req 1.7). */
export const CLIP_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Error de API homogéneo. Envuelve el `code`/`message`/`details` del backend
 * cuando están disponibles, o describe fallos de red/timeout del cliente.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown> | null;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }
}

/** Códigos de error del lado del cliente (no provienen del backend). */
export const CLIENT_ERROR_CODES = {
  TIMEOUT: 'CLIENT_TIMEOUT',
  NETWORK: 'CLIENT_NETWORK_ERROR',
} as const;

/** Construye una URL absoluta a partir de una ruta relativa del backend. */
export function buildUrl(path: string, base: string = API_BASE_URL): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/** Indica si un valor tiene la forma del envoltorio de error del backend. */
function esApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/**
 * Procesa una respuesta HTTP: si es 2xx devuelve el JSON parseado; si no,
 * intenta extraer el envoltorio de error del backend y lanza :class:`ApiError`.
 */
async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  let body: unknown = null;
  const texto = await res.text();
  if (texto) {
    try {
      body = JSON.parse(texto);
    } catch {
      body = null;
    }
  }

  if (res.ok) {
    return body as T;
  }

  if (esApiErrorBody(body)) {
    const apiError = new ApiError(
      body.error.code,
      body.error.message,
      res.status,
      body.error.details ?? null,
    );
    console.error(
      `[api] Error de API (${apiError.status}) ${apiError.code}: ${apiError.message}`,
    );
    throw apiError;
  }

  const httpError = new ApiError(
    'HTTP_ERROR',
    `La petición falló con estado ${res.status}.`,
    res.status,
    null,
  );
  console.error(
    `[api] Error HTTP (${httpError.status}) ${httpError.code}: ${httpError.message}`,
  );
  throw httpError;
}

/**
 * Ejecuta `fetch` con un timeout opcional (usando AbortController) y traduce los
 * fallos de red/timeout a :class:`ApiError` con códigos del cliente.
 */
async function fetchConTimeout(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  // Si el llamador provee su propia señal, la respetamos; si además hay
  // timeout, creamos un controlador propio.
  const controller = new AbortController();
  const signalExterna = init.signal;
  if (signalExterna) {
    if (signalExterna.aborted) controller.abort();
    else
      signalExterna.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  // Diagnóstico: registra el método y la URL al iniciar la petición.
  const metodo = (init.method ?? 'GET').toUpperCase();
  console.info(`[api] ${metodo} ${url}`);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && timeoutMs && timeoutMs > 0) {
      const timeoutError = new ApiError(
        CLIENT_ERROR_CODES.TIMEOUT,
        `La petición excedió el tiempo límite de ${Math.round(
          timeoutMs / 1000,
        )} s.`,
        0,
        null,
      );
      console.error(
        `[api] Timeout ${timeoutError.code} en ${metodo} ${url}: ${timeoutError.message}`,
      );
      throw timeoutError;
    }
    const networkError = new ApiError(
      CLIENT_ERROR_CODES.NETWORK,
      err instanceof Error ? err.message : 'Error de red desconocido.',
      0,
      null,
    );
    console.error(
      `[api] Error de red ${networkError.code} en ${metodo} ${url}: ${networkError.message}`,
    );
    throw networkError;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// POST /clips — Subida de clips (multipart, timeout 60 s — Req 1.1, 1.7)
// ---------------------------------------------------------------------------

/**
 * Sube 1..50 clips de video al backend preservando el orden de la lista `files`.
 *
 * Impone un timeout de 60 s (Req 1.7): si se agota, lanza un :class:`ApiError`
 * con código {@link CLIENT_ERROR_CODES.TIMEOUT} para que la UI pueda conservar
 * la selección y ofrecer reintento.
 */
export async function subirClips(
  files: File[],
  opciones: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<SubirClipsResponse> {
  const form = new FormData();
  for (const file of files) {
    // El backend espera el campo repetido `files`; el orden de anexión define
    // el orden de recepción (Req 1.3).
    form.append('files', file, file.name);
  }

  const res = await fetchConTimeout(
    buildUrl('/clips', opciones.baseUrl),
    { method: 'POST', body: form },
    opciones.timeoutMs ?? CLIP_UPLOAD_TIMEOUT_MS,
  );
  return parseJsonOrThrow<SubirClipsResponse>(res);
}

// ---------------------------------------------------------------------------
// POST /musica — Subida de música WAV (Req 8.1)
// ---------------------------------------------------------------------------

/** Sube un archivo WAV de música de fondo al backend. */
export async function subirMusica(
  file: File,
  opciones: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<SubirMusicaResponse> {
  const form = new FormData();
  form.append('file', file, file.name);

  const res = await fetchConTimeout(
    buildUrl('/musica', opciones.baseUrl),
    { method: 'POST', body: form },
    opciones.timeoutMs,
  );
  return parseJsonOrThrow<SubirMusicaResponse>(res);
}

// ---------------------------------------------------------------------------
// POST /procesar — Iniciar Job (Req 9.5, 10.1)
// ---------------------------------------------------------------------------

/**
 * Inicia el procesamiento con el orden vigente + ajustes + música opcional.
 *
 * La clave de OpenAI (`openai_api_key`) es **transitoria** (spec
 * subtitulos-ia-remotion): NO forma parte de `Ajustes` ni se persiste con
 * {@link guardarConfiguracion}. Solo se incluye en el cuerpo cuando es una
 * cadena no vacía; si falta o está vacía, se omite del JSON enviado (de modo que
 * cuando la corrección con IA está desactivada, la clave nunca se transmite).
 */
export async function procesar(
  peticion: ProcesarRequest,
  opciones: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<ProcesarResponse> {
  const { openai_api_key, ...resto } = peticion;
  const cuerpo: Record<string, unknown> = { ...resto };
  if (typeof openai_api_key === 'string' && openai_api_key.length > 0) {
    cuerpo.openai_api_key = openai_api_key;
  }

  const res = await fetchConTimeout(
    buildUrl('/procesar', opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    },
    opciones.timeoutMs,
  );
  return parseJsonOrThrow<ProcesarResponse>(res);
}

// ---------------------------------------------------------------------------
// GET /progreso/{id} — Consulta puntual del progreso (polling) (Req 10.3)
// ---------------------------------------------------------------------------

/** Consulta puntual (polling) del progreso de un Job por su id. */
export async function obtenerProgreso(
  jobId: string,
  opciones: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<JobProgress> {
  const res = await fetchConTimeout(
    buildUrl(`/progreso/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    { method: 'GET', signal: opciones.signal },
  );
  return parseJsonOrThrow<JobProgress>(res);
}

// ---------------------------------------------------------------------------
// GET/POST /subtitulos/{id} — Revisión manual de subtítulos
// ---------------------------------------------------------------------------

/** Obtiene los grupos de subtítulo propuestos para revisar/editar. */
export async function obtenerSubtitulos(
  jobId: string,
  opciones: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<SubtitulosRevision> {
  const res = await fetchConTimeout(
    buildUrl(`/subtitulos/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    { method: 'GET', signal: opciones.signal },
  );
  return parseJsonOrThrow<SubtitulosRevision>(res);
}

/**
 * Envía el texto editado de los subtítulos y reanuda el pipeline (fase 2). Solo
 * se edita el texto; los tiempos los conserva el backend por índice.
 */
export async function enviarSubtitulos(
  jobId: string,
  grupos: Array<Pick<GrupoSubtitulo, 'texto'>>,
  opciones: { baseUrl?: string } = {},
): Promise<ProcesarResponse> {
  const res = await fetchConTimeout(
    buildUrl(`/subtitulos/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grupos: grupos.map((g) => ({ texto: g.texto })) }),
    },
  );
  return parseJsonOrThrow<ProcesarResponse>(res);
}

// ---------------------------------------------------------------------------
// GET/POST /silencios/{id} — Timeline de edición de silencios
// (spec edicion-avanzada-shorts, design §5.1, §5.2; Req 2.1, 5.1)
// ---------------------------------------------------------------------------

/**
 * Obtiene los tramos de silencio detectados (a BORRAR) junto con los datos del
 * vídeo UNIDO (pre-corte) para montar el timeline de edición (design §5.1).
 *
 * Es de solo lectura: si el Job no está en `esperando_edicion_silencios`, el
 * backend devuelve `editable=false` y los tramos disponibles (posiblemente
 * vacíos). Lanza :class:`ApiError` con `JOB_NOT_FOUND` (404) si el Job no
 * existe.
 */
export async function obtenerSilencios(
  jobId: string,
  opciones: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<SilenciosEdicion> {
  const res = await fetchConTimeout(
    buildUrl(`/silencios/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    { method: 'GET', signal: opciones.signal },
  );
  return parseJsonOrThrow<SilenciosEdicion>(res);
}

/**
 * Envía los tramos de silencio (a BORRAR) editados por el usuario y reanuda el
 * pipeline (aplica el corte y continúa a TRANSCRIBIR) (design §5.2).
 *
 * El cuerpo es `{ tramos }`, con cada tramo en SEGUNDOS (`inicio_s`/`fin_s`),
 * exactamente como el tipo {@link TramoSilencio} del frontend: no hay conversión
 * de unidades porque el contrato del timeline ya opera en segundos.
 *
 * Respuesta `202` con `{ job_id, estado: "en_ejecucion" }`. Errores del backend:
 * `404 JOB_NOT_FOUND`, `409 CONFLICT` (Job fuera de la pausa de silencios) o
 * `400 INVALID_REQUEST` (algún tramo con `fin_s <= inicio_s` o fuera de
 * `[0, duracion_unido_s]`).
 */
export async function enviarSilencios(
  jobId: string,
  tramos: TramoSilencio[],
  opciones: { baseUrl?: string } = {},
): Promise<ProcesarResponse> {
  const res = await fetchConTimeout(
    buildUrl(`/silencios/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // El backend espera los tramos en segundos, idénticos a `TramoSilencio`.
      body: JSON.stringify({
        tramos: tramos.map((t) => ({ inicio_s: t.inicio_s, fin_s: t.fin_s })),
      }),
    },
  );
  return parseJsonOrThrow<ProcesarResponse>(res);
}

// ---------------------------------------------------------------------------
// GET/POST /render/{id} — Elección manual del motor de render
// (spec subtitulos-ia-remotion, Req 6.2, 6.3, 7.1, 7.2)
// ---------------------------------------------------------------------------

/**
 * Obtiene los subtítulos ya corregidos (solo lectura) y la preselección de
 * motor de un Job en estado `esperando_eleccion_render`, para que el usuario
 * revise el texto antes de elegir el motor de render.
 */
export async function obtenerRender(
  jobId: string,
  opciones: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<RenderEleccion> {
  const res = await fetchConTimeout(
    buildUrl(`/render/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    { method: 'GET', signal: opciones.signal },
  );
  return parseJsonOrThrow<RenderEleccion>(res);
}

/**
 * Elige el motor de render (`ass` o `remotion`) y reanuda el pipeline. Ejecuta
 * exactamente el motor elegido (sin fallback automático).
 *
 * @deprecated En el flujo de `edicion-avanzada-shorts` el render es SIEMPRE
 * Remotion y la elección de motor se elimina de la interfaz; usa
 * {@link confirmarRenderFinal} para confirmar la etapa final con textos extra.
 * Se conserva por compatibilidad con las piezas todavía no migradas.
 */
export async function elegirRender(
  jobId: string,
  motor: MotorRender,
  opciones: { baseUrl?: string } = {},
): Promise<ProcesarResponse> {
  const res = await fetchConTimeout(
    buildUrl(`/render/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motor }),
    },
  );
  return parseJsonOrThrow<ProcesarResponse>(res);
}

/**
 * Forma en la que el backend (`POST /render/{id}`) espera cada texto extra:
 * SEGUNDOS (`inicio_s`/`fin_s`) y estilo en `snake_case` (design §5.6, §7.3).
 * Es el "espejo" del tipo {@link TextoExtra} del frontend, que usa milisegundos
 * (`inicioMs`/`finMs`) y estilo en `camelCase`.
 */
interface TextoExtraBackend {
  texto: string;
  inicio_s: number;
  fin_s: number;
  estilo: {
    fuente: string;
    tamano: number;
    color: string;
    color_borde: string;
    grosor_borde: number;
    negrita: boolean;
    pos_vertical_pct: number;
    pos_horizontal_pct: number;
  };
}

/**
 * Convierte un {@link TextoExtra} del frontend (camelCase + milisegundos) al
 * contrato del backend (snake_case + segundos) que consume `POST /render/{id}`.
 *
 * DECISIÓN SOBRE LA CONVERSIÓN DE UNIDADES (ms → s): el rango temporal se
 * expresa en el frontend en milisegundos **enteros** (`inicioMs`/`finMs`), por
 * lo que basta dividir entre 1000 para obtener los segundos del backend. La
 * división es EXACTA para este caso de uso (los ms provienen de controles en
 * segundos multiplicados por 1000) y NO requiere redondeo, a diferencia del
 * sentido inverso (segundos → ms) que sí usa banker's rounding
 * (`redondearMitadAPar`) para casar con `round()` de Python. El mapeo inverso
 * para la previsualización lo cubre la tarea 8.1 (`textosExtraBackendARemotion`).
 */
function textoExtraARemotionBackend(t: TextoExtra): TextoExtraBackend {
  return {
    texto: t.texto,
    inicio_s: t.inicioMs / 1000,
    fin_s: t.finMs / 1000,
    estilo: {
      fuente: t.estilo.fuente,
      tamano: t.estilo.tamano,
      color: t.estilo.color,
      // camelCase (frontend) → snake_case (backend).
      color_borde: t.estilo.colorBorde,
      grosor_borde: t.estilo.grosorBorde,
      negrita: t.estilo.negrita,
      pos_vertical_pct: t.estilo.posVerticalPct,
      pos_horizontal_pct: t.estilo.posHorizontalPct,
    },
  };
}

/**
 * Confirma la etapa final (`esperando_edicion_final`) enviando los textos extra
 * tipo "hook" y reanuda el render, que es **siempre Remotion** (design §5.6). No
 * se envía el campo `motor`: el backend usa `remotion` por defecto y la UI ya no
 * ofrece elección de motor (spec edicion-avanzada-shorts, Req 11).
 *
 * El cuerpo es `{ textos_extra: [...] }`, con cada texto ya convertido de
 * camelCase(ms) a snake_case(segundos) mediante {@link textoExtraARemotionBackend}.
 * Se admiten como máximo 2 textos (el backend valida el límite y los rangos).
 *
 * Respuesta `202`. Errores del backend: `404 JOB_NOT_FOUND`, `409 CONFLICT` (Job
 * fuera de `esperando_edicion_final`) o `400 INVALID_REQUEST` (más de 2 textos,
 * rango temporal inválido o estilo fuera de rango).
 */
export async function confirmarRenderFinal(
  jobId: string,
  textosExtra: TextoExtra[],
  opciones: { baseUrl?: string } = {},
): Promise<ProcesarResponse> {
  const res = await fetchConTimeout(
    buildUrl(`/render/${encodeURIComponent(jobId)}`, opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textos_extra: textosExtra.map(textoExtraARemotionBackend),
      }),
    },
  );
  return parseJsonOrThrow<ProcesarResponse>(res);
}

// ---------------------------------------------------------------------------
// /configuracion — Ajustes por defecto persistidos (JSON local del backend)
// ---------------------------------------------------------------------------

/** Obtiene los ajustes por defecto guardados (o `null` si no hay). */
export async function obtenerConfiguracion(
  opciones: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<ConfiguracionResponse> {
  const res = await fetchConTimeout(
    buildUrl('/configuracion', opciones.baseUrl),
    { method: 'GET', signal: opciones.signal },
  );
  return parseJsonOrThrow<ConfiguracionResponse>(res);
}

/** Guarda los ajustes actuales como predeterminados. */
export async function guardarConfiguracion(
  ajustes: Ajustes,
  opciones: { baseUrl?: string } = {},
): Promise<{ guardado: boolean; ajustes: Ajustes }> {
  const res = await fetchConTimeout(
    buildUrl('/configuracion', opciones.baseUrl),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ajustes }),
    },
  );
  return parseJsonOrThrow<{ guardado: boolean; ajustes: Ajustes }>(res);
}

/** Borra los ajustes por defecto guardados (restablece a fábrica). */
export async function borrarConfiguracion(
  opciones: { baseUrl?: string } = {},
): Promise<{ borrado: boolean }> {
  const res = await fetchConTimeout(buildUrl('/configuracion', opciones.baseUrl), {
    method: 'DELETE',
  });
  return parseJsonOrThrow<{ borrado: boolean }>(res);
}

// ---------------------------------------------------------------------------
// GET /descargar/{id} — Descarga del Video_Final (Req 11.2)
// ---------------------------------------------------------------------------

/**
 * Devuelve la URL de descarga del `Video_Final` de un Job. La UI la usa como
 * `href` de un enlace/botón o como `src` de la previsualización.
 */
export function urlDescarga(
  jobId: string,
  baseUrl: string = API_BASE_URL,
): string {
  return buildUrl(`/descargar/${encodeURIComponent(jobId)}`, baseUrl);
}

/**
 * Descarga el `Video_Final` como `Blob` (para casos en que se necesita el
 * contenido en memoria). Para descarga directa por el navegador es preferible
 * usar {@link urlDescarga} en un enlace.
 */
export async function descargarVideo(
  jobId: string,
  opciones: { baseUrl?: string } = {},
): Promise<Blob> {
  const res = await fetchConTimeout(urlDescarga(jobId, opciones.baseUrl), {
    method: 'GET',
  });
  if (!res.ok) {
    return parseJsonOrThrow<never>(res);
  }
  return res.blob();
}


// ---------------------------------------------------------------------------
// Persistencia local de la clave de OpenAI (spec edicion-avanzada-shorts, §9)
// ---------------------------------------------------------------------------

/**
 * Clave de `localStorage` bajo la que se persiste la API key de OpenAI.
 *
 * IMPLICACIÓN DE SEGURIDAD (design §9, S5): persistir la clave en `localStorage`
 * la deja legible por cualquier script del mismo origen (expuesta a XSS). Es una
 * decisión que el usuario asume explícitamente; `OpenAIKeyInput` muestra el
 * aviso visible y ofrece "Olvidar clave" ({@link olvidarApiKeyLocal}). La clave
 * NUNCA se registra en logs ni se persiste en el backend (solo vive en el mapa
 * transitorio en memoria mientras dura el Job).
 */
const CLAVE_LS_OPENAI = 'openai_api_key';

/**
 * Guarda la clave de OpenAI en `localStorage`. Es robusto ante entornos sin
 * `localStorage` (p. ej. SSR o modo privado): cualquier error se ignora en
 * silencio para no romper la UI.
 */
export function guardarApiKeyLocal(k: string): void {
  try {
    localStorage.setItem(CLAVE_LS_OPENAI, k);
  } catch {
    // Entorno sin `localStorage` disponible: se ignora (no bloquea la UI).
  }
}

/**
 * Lee la clave de OpenAI de `localStorage`. Devuelve cadena vacía si no hay
 * clave guardada o si `localStorage` no está disponible.
 */
export function leerApiKeyLocal(): string {
  try {
    return localStorage.getItem(CLAVE_LS_OPENAI) ?? '';
  } catch {
    // Entorno sin `localStorage`: se trata como "sin clave guardada".
    return '';
  }
}

/**
 * Borra la clave de OpenAI de `localStorage` (botón "Olvidar clave", design §9).
 * Robusto ante entornos sin `localStorage`.
 */
export function olvidarApiKeyLocal(): void {
  try {
    localStorage.removeItem(CLAVE_LS_OPENAI);
  } catch {
    // Entorno sin `localStorage`: nada que borrar.
  }
}
