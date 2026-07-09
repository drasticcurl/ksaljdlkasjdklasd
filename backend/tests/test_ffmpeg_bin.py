"""Tests de ffmpeg/ffprobe configurables (VSE_FFMPEG_BIN / VSE_FFPROBE_BIN).

Cubre:

* Que los **constructores de comando** del motor usen el binario configurado en
  ``config.FFMPEG_BIN`` / ``config.FFPROBE_BIN`` (referenciado en tiempo de
  construcción, de modo que el monkeypatch sea visible) en lugar del literal
  ``"ffmpeg"`` / ``"ffprobe"``. Se cubren: subtítulos, silencedetect, recorte,
  obtener_duracion, normalización/unión, inspección con ffprobe, música y
  extracción de audio de la transcripción.
* ``filtro_ass_disponible``: detecta el filtro ``ass`` (libass) en la salida de
  ``ffmpeg -filters`` mediante un runner mock; tolerante a fallos.
* Verificación de dependencias con el binario configurado por **ruta absoluta**:
  existente + ejecutable => disponible; inexistente => no disponible.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import List, Sequence

from app import config
from app.deps.checker import (
    DEP_FFMPEG,
    comprobar_ejecutable,
    filtro_ass_disponible,
    verificar_dependencias,
)
from app.engine import ffprobe as ffprobe_mod
from app.engine import music as music_mod
from app.engine import normalize as normalize_mod
from app.engine import silence as silence_mod
from app.engine import subtitles as subtitles_mod
from app.engine import transcribe as transcribe_mod
from app.engine.proc import ResultadoComando
from app.models.settings import AjustesMusica

FFMPEG_FALSO = "/opt/mi/ffmpeg"
FFPROBE_FALSO = "/opt/mi/ffprobe"


class _RunnerGrabador:
    """Runner mock que graba los comandos y devuelve una salida configurable."""

    def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode
        self.comandos: List[List[str]] = []

    def __call__(self, args: Sequence[str]) -> ResultadoComando:
        args = list(args)
        self.comandos.append(args)
        return ResultadoComando(
            returncode=self.returncode,
            stdout=self.stdout,
            stderr=self.stderr,
            args=args,
        )


# ---------------------------------------------------------------------------
# Constructores de comando puros (argv[0] == binario configurado)
# ---------------------------------------------------------------------------
def test_subtitulos_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = subtitles_mod.comando_quemar_subtitulos("in.mp4", "/tmp/s.ass", "out.mp4")
    assert comando[0] == FFMPEG_FALSO


def test_silencedetect_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = silence_mod.comando_silencedetect("in.mp4", -30.0, 0.5)
    assert comando[0] == FFMPEG_FALSO


def test_recorte_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = silence_mod.comando_recorte_ffmpeg("in.mp4", "out.mp4", "FILTRO")
    assert comando[0] == FFMPEG_FALSO


def test_obtener_duracion_usa_ffprobe_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFPROBE_BIN", FFPROBE_FALSO)
    runner = _RunnerGrabador(stdout="12.5")
    duracion = silence_mod.obtener_duracion("in.mp4", runner=runner)
    assert duracion == 12.5
    assert runner.comandos[0][0] == FFPROBE_FALSO


def test_normalizar_clip_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = normalize_mod.comando_normalizar_clip(
        "in.mp4", "out.mp4", "FILTRO", 30, tiene_audio=True
    )
    assert comando[0] == FFMPEG_FALSO


def test_concatenar_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = normalize_mod.comando_concatenar("/tmp/concat.txt", "out.mp4")
    assert comando[0] == FFMPEG_FALSO


def test_ffprobe_inspect_usa_ffprobe_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFPROBE_BIN", FFPROBE_FALSO)
    comando = ffprobe_mod.construir_comando_ffprobe("in.mp4")
    assert comando[0] == FFPROBE_FALSO


def test_musica_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = music_mod.comando_mezclar_musica("v.mp4", "m.wav", "out.mp4", "FILTRO")
    assert comando[0] == FFMPEG_FALSO


def test_transcribe_extraer_audio_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    comando = transcribe_mod.comando_extraer_audio("v.mp4", "a.wav")
    assert comando[0] == FFMPEG_FALSO


# ---------------------------------------------------------------------------
# Integración: el runner recibe el binario configurado como argv[0]
# ---------------------------------------------------------------------------
def test_mezclar_musica_ejecuta_con_ffmpeg_configurado(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    runner = _RunnerGrabador(returncode=0)
    music_mod.mezclar_musica(
        tmp_path / "v.mp4",
        tmp_path / "m.wav",
        AjustesMusica(),
        tmp_path / "out.mp4",
        runner=runner,
    )
    assert runner.comandos[0][0] == FFMPEG_FALSO


def test_cortar_silencios_ffmpeg_usa_binarios_configurados(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    monkeypatch.setattr(config, "FFPROBE_BIN", FFPROBE_FALSO)

    def runner(args: Sequence[str]) -> ResultadoComando:
        args = list(args)
        if args[0] == FFPROBE_FALSO:
            return ResultadoComando(returncode=0, stdout="10.0", args=args)
        if "silencedetect" in " ".join(args):
            return ResultadoComando(returncode=0, stderr="", args=args)
        return ResultadoComando(returncode=0, args=args)

    grabados: List[List[str]] = []

    def runner_grabador(args: Sequence[str]) -> ResultadoComando:
        grabados.append(list(args))
        return runner(args)

    silence_mod.cortar_silencios_ffmpeg(
        tmp_path / "unido.mp4",
        tmp_path / "cortado.mp4",
        -30.0,
        200,
        runner=runner_grabador,
    )
    binarios = {c[0] for c in grabados}
    assert FFMPEG_FALSO in binarios
    assert FFPROBE_FALSO in binarios


# ---------------------------------------------------------------------------
# filtro_ass_disponible
# ---------------------------------------------------------------------------
_SALIDA_FILTERS_CON_ASS = (
    "Filters:\n"
    "  T.. = Timeline support\n"
    "  .S. = Slice threading\n"
    "  ... afade            A->A       Fade in/out input audio.\n"
    "  ..C ass              V->V       Render ASS subtitles onto video (libass).\n"
    "  ... scale            V->V       Scale the input video size.\n"
)

_SALIDA_FILTERS_SIN_ASS = (
    "Filters:\n"
    "  ... afade            A->A       Fade in/out input audio.\n"
    "  ... scale            V->V       Scale the input video size.\n"
    "  ... subtitles        V->V       Render text subtitles (needs libass).\n"
)


def test_filtro_ass_disponible_true_cuando_esta() -> None:
    runner = _RunnerGrabador(stdout=_SALIDA_FILTERS_CON_ASS)
    assert filtro_ass_disponible(runner=runner) is True
    # Ejecuta ffmpeg -filters.
    assert "-filters" in runner.comandos[0]


def test_filtro_ass_disponible_false_cuando_no_esta() -> None:
    runner = _RunnerGrabador(stdout=_SALIDA_FILTERS_SIN_ASS)
    assert filtro_ass_disponible(runner=runner) is False


def test_filtro_ass_disponible_false_si_runner_lanza() -> None:
    def runner(_args: Sequence[str]) -> ResultadoComando:
        raise FileNotFoundError("ffmpeg no está instalado")

    assert filtro_ass_disponible(runner=runner) is False


def test_filtro_ass_usa_ffmpeg_configurado(monkeypatch) -> None:
    monkeypatch.setattr(config, "FFMPEG_BIN", FFMPEG_FALSO)
    runner = _RunnerGrabador(stdout=_SALIDA_FILTERS_CON_ASS)
    filtro_ass_disponible(runner=runner)
    assert runner.comandos[0][0] == FFMPEG_FALSO


# ---------------------------------------------------------------------------
# Verificación de dependencias con binario configurado por ruta absoluta
# ---------------------------------------------------------------------------
def test_comprobar_ejecutable_ruta_absoluta_existente(tmp_path: Path) -> None:
    binario = tmp_path / "ffmpeg"
    binario.write_text("#!/bin/sh\n")
    os.chmod(binario, binario.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    comprobar = comprobar_ejecutable(str(binario))
    assert comprobar(0.0) is True


def test_comprobar_ejecutable_ruta_absoluta_no_ejecutable(tmp_path: Path) -> None:
    binario = tmp_path / "ffmpeg"
    binario.write_text("#!/bin/sh\n")
    # Sin bits de ejecución.
    os.chmod(binario, binario.stat().st_mode & ~(stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))

    comprobar = comprobar_ejecutable(str(binario))
    assert comprobar(0.0) is False


def test_comprobar_ejecutable_ruta_absoluta_inexistente(tmp_path: Path) -> None:
    comprobar = comprobar_ejecutable(str(tmp_path / "no-existe" / "ffmpeg"))
    assert comprobar(0.0) is False


def test_comprobar_ejecutable_nombre_usa_which(monkeypatch) -> None:
    monkeypatch.setattr("app.deps.checker.shutil.which", lambda cmd: f"/usr/bin/{cmd}")
    assert comprobar_ejecutable("ffmpeg")(0.0) is True
    monkeypatch.setattr("app.deps.checker.shutil.which", lambda cmd: None)
    assert comprobar_ejecutable("ffmpeg")(0.0) is False


def test_verificacion_con_ffmpeg_ruta_absoluta_existente(tmp_path: Path, monkeypatch) -> None:
    """Con FFMPEG_BIN apuntando a un binario existente+ejecutable, ffmpeg queda
    disponible en la verificación por defecto."""
    binario = tmp_path / "ffmpeg-estatico"
    binario.write_text("#!/bin/sh\n")
    os.chmod(binario, binario.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setattr(config, "FFMPEG_BIN", str(binario))

    resultado = verificar_dependencias()
    ffmpeg = next(r for r in resultado.resultados if r.nombre == DEP_FFMPEG)
    assert ffmpeg.disponible is True


def test_verificacion_con_ffmpeg_ruta_absoluta_inexistente(tmp_path: Path, monkeypatch) -> None:
    """Con FFMPEG_BIN apuntando a un binario inexistente, ffmpeg no está disponible."""
    monkeypatch.setattr(config, "FFMPEG_BIN", str(tmp_path / "no-existe-ffmpeg"))

    resultado = verificar_dependencias()
    assert DEP_FFMPEG in resultado.faltantes
