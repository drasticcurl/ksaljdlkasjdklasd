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
  ApiErrorBody,
  JobProgress,
  ProcesarRequest,
  ProcesarResponse,
  SubirClipsResponse,
  SubirMusicaResponse,
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
    throw new ApiError(
      body.error.code,
      body.error.message,
      res.status,
      body.error.details ?? null,
    );
  }

  throw new ApiError(
    'HTTP_ERROR',
    `La petición falló con estado ${res.status}.`,
    res.status,
    null,
  );
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

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && timeoutMs && timeoutMs > 0) {
      throw new ApiError(
        CLIENT_ERROR_CODES.TIMEOUT,
        `La petición excedió el tiempo límite de ${Math.round(
          timeoutMs / 1000,
        )} s.`,
        0,
        null,
      );
    }
    throw new ApiError(
      CLIENT_ERROR_CODES.NETWORK,
      err instanceof Error ? err.message : 'Error de red desconocido.',
      0,
      null,
    );
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

/** Inicia el procesamiento con el orden vigente + ajustes + música opcional. */
export async function procesar(
  peticion: ProcesarRequest,
  opciones: { baseUrl?: string; timeoutMs?: number } = {},
): Promise<ProcesarResponse> {
  const res = await fetchConTimeout(
    buildUrl('/procesar', opciones.baseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peticion),
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
