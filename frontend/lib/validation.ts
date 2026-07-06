/**
 * Validación de archivos de clips en la Interfaz (lógica pura).
 *
 * Reglas (Req 1.4, 1.5):
 *   - Se acepta un archivo si y solo si su formato está entre los formatos de
 *     video soportados Y su tamaño es <= 500 MB.
 *   - Cada archivo rechazado lleva asociado un motivo que lo identifica
 *     (nombre + causa del rechazo).
 *   - Si la selección contiene más de 50 archivos, se rechaza la selección
 *     completa y se indica el límite máximo por adición.
 *
 * Estas funciones son puras (sin efectos ni red) para poder testearlas con
 * property-based testing (ver `lib/__tests__/validation.test.ts`, Propiedad 3)
 * y reutilizarlas desde `components/ClipUploader.tsx` (Tarea 17.2).
 *
 * Los límites y formatos se mantienen alineados con el backend
 * (`backend/app/config.py`: MAX_CLIP_SIZE_BYTES, MAX_CLIPS_PER_UPLOAD,
 * SUPPORTED_VIDEO_EXTENSIONS).
 *
 * Requisitos: 1.4, 1.5.
 */

// ---------------------------------------------------------------------------
// Límites y formatos soportados (alineados con backend/app/config.py)
// ---------------------------------------------------------------------------

/** 1 MB en bytes. */
const MB = 1024 * 1024;

/** Tamaño máximo por clip de video: 500 MB (Req 1.4). */
export const MAX_CLIP_SIZE_BYTES = 500 * MB;

/** Máximo de archivos por adición en una misma acción (Req 1.5). */
export const MAX_CLIPS_PER_UPLOAD = 50;

/** Extensiones de video soportadas, en minúsculas y con punto inicial (Req 1.4). */
export const SUPPORTED_VIDEO_EXTENSIONS: readonly string[] = [
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
];

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Estructura mínima validable. `File` del navegador la satisface
 * (`name`, `size`), lo que permite validar tanto objetos `File` reales como
 * objetos ligeros generados en pruebas.
 */
export interface ArchivoValidable {
  /** Nombre del archivo, incluyendo su extensión. */
  name: string;
  /** Tamaño en bytes. */
  size: number;
}

/** Motivo por el que un archivo fue rechazado (Req 1.4). */
export type MotivoRechazo = 'FORMATO_NO_SOPORTADO' | 'TAMANO_EXCEDIDO';

/** Descripción de un archivo rechazado con la causa que lo identifica. */
export interface RechazoClip<T extends ArchivoValidable = ArchivoValidable> {
  /** El archivo rechazado. */
  archivo: T;
  /** Motivo estructurado del rechazo. */
  motivo: MotivoRechazo;
  /** Mensaje legible que identifica el archivo y la causa (Req 1.4). */
  mensaje: string;
}

/** Resultado de validar una lista de archivos (sin considerar el límite de 50). */
export interface ResultadoValidacion<T extends ArchivoValidable = ArchivoValidable> {
  /** Archivos aceptados, en el mismo orden de entrada. */
  aceptados: T[];
  /** Archivos rechazados con su motivo, en el mismo orden de entrada. */
  rechazados: RechazoClip<T>[];
}

/** Resultado de validar la selección completa (incluye el límite de 50). */
export interface ResultadoSeleccion<T extends ArchivoValidable = ArchivoValidable>
  extends ResultadoValidacion<T> {
  /** `true` si la selección excede el máximo permitido (Req 1.5). */
  limiteExcedido: boolean;
  /** Máximo de archivos por adición aplicado. */
  limite: number;
  /** Número de archivos en la selección. */
  cantidad: number;
  /** Mensaje del límite cuando `limiteExcedido` es `true`; si no, `null`. */
  mensajeLimite: string | null;
}

// ---------------------------------------------------------------------------
// Predicados puros
// ---------------------------------------------------------------------------

/**
 * Devuelve la extensión (en minúsculas, con punto) del nombre de archivo, o
 * cadena vacía si no tiene extensión reconocible.
 */
export function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf('.');
  // Sin punto, o punto inicial (archivo oculto sin extensión real).
  if (punto <= 0) return '';
  return nombre.slice(punto).toLowerCase();
}

/** Indica si el archivo tiene un formato de video soportado (Req 1.4). */
export function formatoSoportado(archivo: ArchivoValidable): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.includes(extensionDe(archivo.name));
}

/** Indica si el tamaño del archivo está dentro del límite de 500 MB (Req 1.4). */
export function tamanoValido(archivo: ArchivoValidable): boolean {
  return (
    Number.isFinite(archivo.size) &&
    archivo.size >= 0 &&
    archivo.size <= MAX_CLIP_SIZE_BYTES
  );
}

/**
 * Indica si un archivo es válido: formato soportado Y tamaño <= 500 MB.
 * Esta es la condición exacta de aceptación de la Propiedad 3.
 */
export function esArchivoValido(archivo: ArchivoValidable): boolean {
  return formatoSoportado(archivo) && tamanoValido(archivo);
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/** Construye el mensaje legible de rechazo para un archivo. */
function mensajeDeRechazo(nombre: string, motivo: MotivoRechazo): string {
  switch (motivo) {
    case 'FORMATO_NO_SOPORTADO':
      return `"${nombre}": formato no soportado. Formatos permitidos: ${SUPPORTED_VIDEO_EXTENSIONS.join(
        ', ',
      )}.`;
    case 'TAMANO_EXCEDIDO':
      return `"${nombre}": excede el tamaño máximo de ${
        MAX_CLIP_SIZE_BYTES / MB
      } MB por archivo.`;
  }
}

/**
 * Valida una lista de archivos separando los aceptados de los rechazados.
 *
 * Un archivo se acepta si y solo si {@link esArchivoValido} es `true`. Cada
 * rechazo incluye un motivo que identifica el archivo (Req 1.4). El orden de
 * entrada se preserva en ambas listas.
 *
 * Nota: esta función NO aplica el límite de 50 archivos; para la validación de
 * la selección completa usar {@link validarSeleccion}.
 */
export function validarClips<T extends ArchivoValidable>(
  files: readonly T[],
): ResultadoValidacion<T> {
  const aceptados: T[] = [];
  const rechazados: RechazoClip<T>[] = [];

  for (const archivo of files) {
    if (esArchivoValido(archivo)) {
      aceptados.push(archivo);
      continue;
    }

    // Se prioriza el formato como motivo cuando ambas condiciones fallan; en
    // cualquier caso el archivo es inválido y queda identificado.
    const motivo: MotivoRechazo = !formatoSoportado(archivo)
      ? 'FORMATO_NO_SOPORTADO'
      : 'TAMANO_EXCEDIDO';

    rechazados.push({
      archivo,
      motivo,
      mensaje: mensajeDeRechazo(archivo.name, motivo),
    });
  }

  return { aceptados, rechazados };
}

/**
 * Indica si la selección excede el máximo permitido por adición (Req 1.5).
 */
export function excedeLimiteSeleccion(
  files: readonly unknown[],
  limite: number = MAX_CLIPS_PER_UPLOAD,
): boolean {
  return files.length > limite;
}

/** Construye el mensaje del límite de selección (Req 1.5). */
export function mensajeLimiteSeleccion(
  cantidad: number,
  limite: number = MAX_CLIPS_PER_UPLOAD,
): string {
  return `Se seleccionaron ${cantidad} archivos, pero el máximo por adición es ${limite}. Selecciona ${limite} o menos.`;
}

/**
 * Valida la selección completa aplicando primero el límite de 50 (Req 1.5) y,
 * si no se excede, la validación por archivo (Req 1.4).
 *
 * Si el límite se excede, se rechaza la selección completa: `aceptados` y
 * `rechazados` quedan vacíos y se expone `mensajeLimite` (Req 1.5).
 */
export function validarSeleccion<T extends ArchivoValidable>(
  files: readonly T[],
  limite: number = MAX_CLIPS_PER_UPLOAD,
): ResultadoSeleccion<T> {
  const cantidad = files.length;

  if (excedeLimiteSeleccion(files, limite)) {
    return {
      aceptados: [],
      rechazados: [],
      limiteExcedido: true,
      limite,
      cantidad,
      mensajeLimite: mensajeLimiteSeleccion(cantidad, limite),
    };
  }

  const { aceptados, rechazados } = validarClips(files);
  return {
    aceptados,
    rechazados,
    limiteExcedido: false,
    limite,
    cantidad,
    mensajeLimite: null,
  };
}
