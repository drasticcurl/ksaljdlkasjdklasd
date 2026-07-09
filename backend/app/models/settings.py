"""Modelos Pydantic de los ajustes de configuración del pipeline.

La ESTRUCTURA de los ajustes (tipos y valores por defecto) se definió en la
tarea 2.2. La TAREA 8 añade la **validación de rangos del motor** y la política
de reconciliación UI↔motor documentada por campo, sin romper la estructura
existente: los modelos siguen siendo permisivos en construcción y la validación
se expone como la función pura :func:`validar_ajustes` (que devuelve la lista de
campos inválidos) más el ayudante :func:`asegurar_ajustes_validos` (que lanza
:class:`AjustesInvalidosError`).

Política de reconciliación UI↔motor (Req 9.6 vs Req 3-8):
    La Interfaz valida contra el rango de UI (más amplio); el Backend aplica el
    **rango del motor** y, cuando un valor excede dicho rango, lo **rechaza**
    identificando el campo (Req 7.11, 5.5, 5.6, 4.4). La única excepción es
    ``subtitulos.max_palabras``: en lugar de rechazarse, se aplica el valor por
    defecto seguro ``4`` (Req 6.2), fallback implementado en
    :func:`app.engine.grouping.tamano_efectivo`; por eso ``max_palabras`` NO es
    un campo de rechazo aquí.

Referencias de requisitos: 7.11, 9.1, 9.6, 4.4, 5.5, 5.6, 6.2 (además de
1.2, 1.3, 10.3, 3.2, 3.5 de la estructura original).
"""

from __future__ import annotations

import re
from typing import Dict, FrozenSet, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from app import config

# Tipos enumerados de posición del subtítulo (Req 7.5, 7.6).
PosicionVertical = Literal["superior", "centro", "inferior"]
PosicionHorizontal = Literal["izquierda", "centro", "derecha"]


class ResolucionObjetivo(BaseModel):
    """Resolución vertical de salida (Req 3.2). Rangos validados en la tarea 8."""

    ancho: int = Field(default=config.DEFAULT_RESOLUCION_ANCHO)
    alto: int = Field(default=config.DEFAULT_RESOLUCION_ALTO)


class AjustesGenerales(BaseModel):
    """Ajustes generales: resolución objetivo y fps (Req 3.2, 3.5)."""

    resolucion: ResolucionObjetivo = Field(default_factory=ResolucionObjetivo)
    fps: int = Field(default=config.DEFAULT_FPS)


class AjustesSilencios(BaseModel):
    """Ajustes del corte de silencios (Req 4, 9.2).

    ``umbral_db`` y ``margen_ms`` se expresan en unidades de la UI; su conversión
    a las unidades del motor y la validación de rangos se realizan más adelante.
    """

    activado: bool = Field(default=config.DEFAULT_SILENCIO_ACTIVADO)
    umbral_db: float = Field(default=config.DEFAULT_SILENCIO_UMBRAL_DB)
    margen_ms: int = Field(default=config.DEFAULT_SILENCIO_MARGEN_MS)


class AjustesTranscripcion(BaseModel):
    """Ajustes de transcripción (Req 5, 9.3).

    La validación de ``idioma``/``modelo`` contra los conjuntos soportados por
    faster-whisper se implementa en la tarea 8.
    """

    idioma: str = Field(default=config.DEFAULT_IDIOMA)
    modelo: str = Field(default=config.DEFAULT_MODELO)


class AjustesSubtitulos(BaseModel):
    """Ajustes de subtítulos y su animación (Req 6, 7, 9.1).

    Los rangos numéricos se validan en la tarea 8; aquí solo se define la forma.
    """

    max_palabras: int = Field(default=config.DEFAULT_MAX_PALABRAS)
    # Si está activado, todo el texto de los subtítulos se muestra en minúscula.
    minusculas: bool = Field(default=config.DEFAULT_SUBTITULOS_MINUSCULAS)
    posicion_vertical: PosicionVertical = Field(default="inferior")
    posicion_horizontal: PosicionHorizontal = Field(default="centro")
    pos_vertical_pct: float = Field(default=85.0)
    pos_horizontal_pct: float = Field(default=50.0)
    margen_px: int = Field(default=60)
    fuente: str = Field(default=config.DEFAULT_FUENTE)
    tamano: int = Field(default=config.DEFAULT_TAMANO_FUENTE)
    color: str = Field(default=config.DEFAULT_COLOR)
    color_borde: str = Field(default=config.DEFAULT_COLOR_BORDE)
    grosor_borde: int = Field(default=config.DEFAULT_GROSOR_BORDE)
    negrita: bool = Field(default=True)
    anim_entrada_ms: int = Field(default=config.DEFAULT_ANIM_ENTRADA_MS)
    anim_salida_ms: int = Field(default=config.DEFAULT_ANIM_SALIDA_MS)
    slide_px: int = Field(default=config.DEFAULT_SLIDE_PX)


class AjustesMusica(BaseModel):
    """Ajustes de la música de fondo y el ducking (Req 8)."""

    volumen_base_pct: int = Field(default=config.DEFAULT_VOLUMEN_MUSICA_PCT)
    reduccion_db: float = Field(default=config.DEFAULT_REDUCCION_DB)
    umbral_voz_dbfs: float = Field(default=config.DEFAULT_UMBRAL_VOZ_DBFS)
    ataque_ms: int = Field(default=config.DEFAULT_ATAQUE_MS)
    liberacion_ms: int = Field(default=config.DEFAULT_LIBERACION_MS)


class Ajustes(BaseModel):
    """Conjunto completo de ajustes enviado en `POST /procesar`.

    La música es opcional: si no se proporciona un WAV válido, el paso 5 se omite.
    """

    generales: AjustesGenerales = Field(default_factory=AjustesGenerales)
    silencios: AjustesSilencios = Field(default_factory=AjustesSilencios)
    transcripcion: AjustesTranscripcion = Field(default_factory=AjustesTranscripcion)
    subtitulos: AjustesSubtitulos = Field(default_factory=AjustesSubtitulos)
    musica: Optional[AjustesMusica] = Field(default=None)


# ---------------------------------------------------------------------------
# Modelos de subtítulos derivados de la transcripción (Req 5.1, 6.4)
# ---------------------------------------------------------------------------
class Palabra(BaseModel):
    """Palabra transcrita con timestamps por palabra (Req 5.1).

    ``inicio_s``/``fin_s`` pueden ser ``None`` cuando faltan timestamps válidos;
    el tratamiento robusto se implementa en la agrupación (tarea 4, Req 6.5).
    """

    texto: str
    inicio_s: Optional[float] = Field(default=None)
    fin_s: Optional[float] = Field(default=None)


class GrupoSubtitulo(BaseModel):
    """Grupo de palabras mostrado como una línea de subtítulo (Req 6.4)."""

    texto: str
    inicio_s: float
    fin_s: float


# ===========================================================================
# TAREA 8 — Validación de rangos del motor y de idioma/modelo (Req 7.11, 9.1,
# 9.6, 4.4, 5.5, 5.6, 6.2)
# ===========================================================================

# ---------------------------------------------------------------------------
# Conjuntos soportados por faster-whisper (validación previa a transcribir,
# Req 5.5, 5.6). El rechazo ocurre ANTES de iniciar la transcripción.
# ---------------------------------------------------------------------------
# Valor especial de idioma que activa la detección automática (Req 5.2, 5.4).
IDIOMA_AUTO: str = "auto"

# Modelos soportados por faster-whisper (incluye variantes .en y destiladas).
SUPPORTED_WHISPER_MODELS: FrozenSet[str] = frozenset(
    {
        "tiny",
        "tiny.en",
        "base",
        "base.en",
        "small",
        "small.en",
        "medium",
        "medium.en",
        "large-v1",
        "large-v2",
        "large-v3",
        "large",
        "large-v3-turbo",
        "turbo",
        "distil-small.en",
        "distil-medium.en",
        "distil-large-v2",
        "distil-large-v3",
    }
)

# Idiomas soportados por Whisper/faster-whisper (códigos ISO 639-1/2). El valor
# "auto" se admite adicionalmente para la detección automática (Req 5.4).
SUPPORTED_WHISPER_LANGUAGES: FrozenSet[str] = frozenset(
    {
        "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca",
        "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms",
        "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la",
        "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
        "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
        "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be",
        "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn",
        "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha",
        "ba", "jw", "su", "yue",
    }
)


def idioma_valido(idioma: str) -> bool:
    """Indica si ``idioma`` es "auto" o pertenece al conjunto soportado (Req 5.5)."""
    return idioma == IDIOMA_AUTO or idioma in SUPPORTED_WHISPER_LANGUAGES


def modelo_valido(modelo: str) -> bool:
    """Indica si ``modelo`` pertenece a los modelos soportados (Req 5.6)."""
    return modelo in SUPPORTED_WHISPER_MODELS


# ---------------------------------------------------------------------------
# Formato de color de subtítulo: `#RRGGBB` (Req 7.8). Se convierte a ASS más
# adelante; aquí solo se valida la forma.
# ---------------------------------------------------------------------------
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def color_valido(color: str) -> bool:
    """Indica si ``color`` tiene la forma hexadecimal `#RRGGBB` (Req 7.8)."""
    return bool(_HEX_COLOR_RE.match(color))


# ---------------------------------------------------------------------------
# Rangos del motor por campo (mínimo, máximo, ambos inclusivos). Fuente única de
# verdad usada tanto por :func:`validar_ajustes` como por los tests. Cada rango
# documenta la política de reconciliación UI↔motor del diseño.
# ---------------------------------------------------------------------------
# Cada entrada mapea la ruta con puntos del campo a (mínimo, máximo).
RANGOS_MOTOR: Dict[str, Tuple[float, float]] = {
    # Generales — Resolución objetivo 2..7680 px por eje (Req 3.2).
    "generales.resolucion.ancho": (2, 7680),
    "generales.resolucion.alto": (2, 7680),
    # Cuadros por segundo objetivo 1..120 (Req 3.5).
    "generales.fps": (1, 120),
    # Silencios — unidades de UI (se convierten en util/units.py):
    #   umbral -60..0 dB, margen 0..5000 ms (Req 9.2, 4.4).
    "silencios.umbral_db": (-60.0, 0.0),
    "silencios.margen_ms": (0, 5000),
    # Subtítulos — rangos del motor (Req 7.x); más estrictos que la UI (Req 9.1).
    "subtitulos.pos_vertical_pct": (0.0, 100.0),   # 0..100 % de la altura (Req 9.1)
    "subtitulos.pos_horizontal_pct": (0.0, 100.0),  # 0..100 % del ancho (Req 9.1)
    "subtitulos.margen_px": (0, 500),               # 0..500 px (Req 7.7)
    "subtitulos.tamano": (12, 200),                 # motor 12..200 pt (Req 7.8)
    "subtitulos.grosor_borde": (0, 20),             # motor 0..20 px (Req 7.8)
    "subtitulos.anim_entrada_ms": (100, 2000),      # motor 100..2000 ms (Req 7.3)
    "subtitulos.anim_salida_ms": (100, 2000),       # motor 100..2000 ms (Req 7.3)
    "subtitulos.slide_px": (1, 500),                # motor 1..500 px (Req 7.4)
    # Música / ducking (Req 8.4, 8.5, 8.6).
    "musica.volumen_base_pct": (0, 100),            # 0..100 % (Req 8.4)
    "musica.reduccion_db": (12.0, 60.0),            # >= 12 dB de reducción (Req 8.5)
    "musica.umbral_voz_dbfs": (-60.0, 0.0),         # umbral de voz en dBFS (Req 8.5)
    "musica.ataque_ms": (0, 250),                   # <= 250 ms de ataque (Req 8.5)
    "musica.liberacion_ms": (0, 500),               # <= 500 ms de liberación (Req 8.6)
}

# Campos con conjunto/formato permitido (no numéricos por rango). Se validan de
# forma explícita en :func:`validar_ajustes`.
CAMPOS_CONJUNTO: Tuple[str, ...] = (
    "transcripcion.idioma",   # "auto" o idioma soportado (Req 5.5)
    "transcripcion.modelo",   # modelo soportado por faster-whisper (Req 5.6)
    "subtitulos.color",       # #RRGGBB (Req 7.8)
    "subtitulos.color_borde",  # #RRGGBB (Req 7.8)
)


def obtener_por_ruta(ajustes: "Ajustes", ruta: str):
    """Devuelve el valor de un campo anidado a partir de su ruta con puntos.

    Ejemplo: ``obtener_por_ruta(ajustes, "generales.resolucion.ancho")``.
    """
    actual: object = ajustes
    for parte in ruta.split("."):
        actual = getattr(actual, parte)
    return actual


class AjustesInvalidosError(ValueError):
    """Error de validación que identifica por nombre los campos fuera de rango."""

    def __init__(self, campos_invalidos: List[str]) -> None:
        self.campos_invalidos = list(campos_invalidos)
        super().__init__(
            "Ajustes inválidos; campos fuera de rango o de conjunto permitido: "
            + ", ".join(self.campos_invalidos)
        )


def validar_ajustes(ajustes: "Ajustes") -> List[str]:
    """Valida los ajustes contra los rangos del motor y los conjuntos permitidos.

    Devuelve la lista (posiblemente vacía) de rutas de campo inválidas. El
    conjunto de ajustes se **acepta si y solo si** la lista devuelta está vacía,
    es decir, si y solo si todos los campos están dentro de su rango/conjunto
    permitido (Propiedad 20; Req 7.11, 9.1, 9.6, 5.5, 5.6, 4.4).

    Nota de política (Req 6.2): ``subtitulos.max_palabras`` NO se incluye como
    campo de rechazo; los valores fuera de ``1..10`` se corrigen con el valor por
    defecto ``4`` en :func:`app.engine.grouping.tamano_efectivo`.

    Si ``ajustes.musica`` es ``None`` (sin música), los campos de música se
    omiten de la validación (el paso 5 se omitirá en el pipeline).
    """
    invalidos: List[str] = []

    for ruta, (minimo, maximo) in RANGOS_MOTOR.items():
        # Los campos de música solo se validan cuando hay ajustes de música.
        if ruta.startswith("musica.") and ajustes.musica is None:
            continue
        valor = obtener_por_ruta(ajustes, ruta)
        # Un valor no numérico (o booleano, que no es un número válido aquí) es
        # inválido; de lo contrario se comprueba la inclusión en el rango.
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            invalidos.append(ruta)
        elif not (minimo <= valor <= maximo):
            invalidos.append(ruta)

    # Idioma / modelo (Req 5.5, 5.6): rechazo antes de transcribir.
    if not idioma_valido(ajustes.transcripcion.idioma):
        invalidos.append("transcripcion.idioma")
    if not modelo_valido(ajustes.transcripcion.modelo):
        invalidos.append("transcripcion.modelo")

    # Colores de subtítulo (Req 7.8): forma `#RRGGBB`.
    if not color_valido(ajustes.subtitulos.color):
        invalidos.append("subtitulos.color")
    if not color_valido(ajustes.subtitulos.color_borde):
        invalidos.append("subtitulos.color_borde")

    return invalidos


def ajustes_validos(ajustes: "Ajustes") -> bool:
    """Devuelve ``True`` si y solo si todos los campos están en rango (Propiedad 20)."""
    return not validar_ajustes(ajustes)


def asegurar_ajustes_validos(ajustes: "Ajustes") -> "Ajustes":
    """Devuelve ``ajustes`` si son válidos; si no, lanza :class:`AjustesInvalidosError`.

    Punto de entrada conveniente para el rechazo temprano en la capa API
    (`POST /procesar`) y antes de quemar subtítulos/transcribir (Req 7.11, 5.5,
    5.6). El error identifica por nombre cada campo inválido (Req 9.6).
    """
    invalidos = validar_ajustes(ajustes)
    if invalidos:
        raise AjustesInvalidosError(invalidos)
    return ajustes


__all__: List[str] = [
    "PosicionVertical",
    "PosicionHorizontal",
    "ResolucionObjetivo",
    "AjustesGenerales",
    "AjustesSilencios",
    "AjustesTranscripcion",
    "AjustesSubtitulos",
    "AjustesMusica",
    "Ajustes",
    "Palabra",
    "GrupoSubtitulo",
    # Validación (Tarea 8)
    "IDIOMA_AUTO",
    "SUPPORTED_WHISPER_MODELS",
    "SUPPORTED_WHISPER_LANGUAGES",
    "RANGOS_MOTOR",
    "CAMPOS_CONJUNTO",
    "idioma_valido",
    "modelo_valido",
    "color_valido",
    "obtener_por_ruta",
    "validar_ajustes",
    "ajustes_validos",
    "asegurar_ajustes_validos",
    "AjustesInvalidosError",
]
