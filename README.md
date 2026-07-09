# Vertical Shorts Editor

Aplicación **100% local** para macOS que convierte varios clips de video en un
short vertical **9:16** listo para publicar. No usa servicios externos, no
requiere claves de API y no necesita autenticación: todo el cómputo (incluida la
transcripción con `faster-whisper` en CPU) ocurre en tu propia máquina.

- **Interfaz (Frontend):** Next.js (App Router) + TypeScript + Tailwind en
  `localhost:3000`.
- **Backend (FastAPI):** API REST en `localhost:8000` que envuelve el **Motor de
  Procesamiento**.

## El pipeline (Motor de Procesamiento)

El backend procesa cada Job encadenando 5 pasos deterministas en orden estricto:

1. **UNIR** — Normaliza cada clip a 9:16 (escala + relleno centrado, sin
   deformación), homogeneiza resolución/fps/códec y concatena los clips en el
   orden definido por el usuario.
2. **CORTAR SILENCIOS** — Usa `auto-editor` para recortar los silencios (paso
   opcional).
3. **TRANSCRIBIR** — Extrae el audio y lo transcribe localmente con
   `faster-whisper` (CPU) con timestamps por palabra.
4. **SUBTÍTULOS** — Agrupa las palabras, genera un archivo `.ass` con animación
   *slide-up* y lo quema con `ffmpeg`.
5. **MÚSICA** — Mezcla una pista WAV opcional con *ducking*
   (`sidechaincompress`) para que baje de volumen cuando hay voz.

El resultado es un `Video_Final` MP4 vertical que puedes previsualizar y
descargar desde la Interfaz.

## Requisitos previos

- **macOS**
- **Homebrew** (para instalar `ffmpeg`)
- **Python 3.10+**
- **Node.js 18+** y **npm**

## Instalación en macOS

Sigue estos **tres pasos en orden**:

### (a) Instalar ffmpeg

`ffmpeg` (y `ffprobe`) son binarios del sistema que el Motor de Procesamiento
necesita. Instálalos con Homebrew:

```bash
brew install ffmpeg
```

### (b) Crear un entorno virtual e instalar las dependencias de Python

Desde la raíz del proyecto, crea y activa un entorno virtual e instala las
dependencias declaradas en `requirements.txt`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> El `requirements.txt` de la raíz referencia a `backend/requirements.txt`
> (la fuente de verdad de las dependencias de Python), por lo que
> `pip install -r requirements.txt` o `pip install -r backend/requirements.txt`
> instalan exactamente lo mismo: `fastapi`, `uvicorn`, `auto-editor`,
> `faster-whisper`, `python-multipart` y las librerías de test.

### (c) Instalar las dependencias del frontend

```bash
cd frontend
npm install
cd ..
```

## Cómo levantar el proyecto

Necesitas **dos terminales**: una para el backend y otra para la Interfaz.

### Backend en `localhost:8000`

Con el entorno virtual activado:

```bash
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000
```

Al arrancar, el backend verifica que `ffmpeg`, `ffprobe`, `auto-editor` y
`faster-whisper` estén disponibles; si falta alguno, el arranque se detiene con
un mensaje indicando qué dependencia falta.

### Interfaz en `localhost:3000`

En otra terminal:

```bash
cd frontend
npm run dev
```

Luego abre `http://localhost:3000` en el navegador.

## Scripts de arranque

Para comodidad, hay scripts documentados en `scripts/` que arrancan cada
componente y **detectan conflictos de puerto** antes de lanzar el proceso:

```bash
# Arranca el backend en localhost:8000
./scripts/start-backend.sh

# Arranca la Interfaz en localhost:3000
./scripts/start-frontend.sh
```

- `scripts/start-backend.sh` lanza `uvicorn` en el puerto **8000**. Si el puerto
  8000 ya está en uso, finaliza el arranque con un mensaje de error de conflicto
  de puerto y **no deja procesos parciales activos**.
- `scripts/start-frontend.sh` lanza Next.js (`npm run dev`) en el puerto
  **3000** con la misma detección de conflicto de puerto.

Si necesitas activar el entorno virtual antes de arrancar el backend, hazlo en
la misma terminal antes de ejecutar el script (por ejemplo
`source .venv/bin/activate`).

## Arranque con doble clic (macOS)

Si prefieres no usar la terminal, en la **raíz del proyecto** hay scripts
`.command` que puedes ejecutar con **doble clic desde Finder**.

> **Por qué `.command` y no `.sh`:** en macOS, los archivos `.sh` **no** son
> doble-clickeables (Finder los abre en un editor de texto). Los archivos
> **`.command`** sí se ejecutan con doble clic: Finder los corre en Terminal.app.
> Los scripts `.sh` de `scripts/` se mantienen para quienes prefieran la
> terminal (ver la sección anterior).

### Scripts disponibles

- **`Instalar.command`** — Ejecútalo **la primera vez**. Comprueba que Homebrew
  esté instalado, instala `ffmpeg` (si falta), crea el entorno virtual `.venv`
  e instala las dependencias de Python (`requirements.txt`) y del frontend
  (`npm install`). Al terminar deja la ventana abierta para que veas el
  resultado.
- **`Iniciar Backend.command`** — Arranca el backend FastAPI en
  `localhost:8000`. Detecta si el puerto 8000 está ocupado (y aborta sin dejar
  procesos parciales) y activa el `.venv` automáticamente si existe.
- **`Iniciar Frontend.command`** — Arranca la Interfaz Next.js en
  `localhost:3000`, con la misma detección de conflicto de puerto.
- **`Iniciar Editor.command`** — Conveniencia: abre **ambos** (backend y
  frontend) en dos ventanas de Terminal separadas. Espera unos segundos a que
  arranquen y luego abre `http://localhost:3000` en tu navegador.

Flujo típico: doble clic en `Instalar.command` una sola vez y, a partir de
entonces, doble clic en `Iniciar Editor.command` cada vez que quieras usar la
aplicación.

### Aviso sobre Gatekeeper

La primera vez que abras un `.command` descargado, macOS (Gatekeeper) puede
bloquearlo con un mensaje del tipo "no se puede abrir porque proviene de un
desarrollador no identificado". Para permitirlo:

- **Clic derecho** (o Control + clic) sobre el script → **Abrir**, y confirma en
  el diálogo; o
- ve a **Ajustes del Sistema → Privacidad y seguridad** y pulsa
  **"Abrir de todos modos"**.

Solo hace falta hacerlo una vez por script.

## Solución de problemas

### El backend aborta con "faltan dependencias"

Si al arrancar el backend ves un mensaje indicando que faltan `ffmpeg`,
`ffprobe`, `auto-editor` o `faster-whisper`, instala lo que corresponda:

- **`ffmpeg` / `ffprobe`**: son binarios del sistema. Instálalos con Homebrew:

  ```bash
  brew install ffmpeg
  ```

- **`auto-editor` / `faster-whisper`**: son dependencias de Python. Instálalas
  (dentro de tu entorno virtual) desde `requirements.txt`:

  ```bash
  pip install -r requirements.txt
  ```

  (`requirements.txt` ya incluye `auto-editor` y `faster-whisper`.)

### El PATH de Homebrew al arrancar con doble clic

Al arrancar desde Finder (doble clic en un `.command`) o desde algunos entornos
virtuales, el `PATH` puede no incluir las rutas de Homebrew
(`/opt/homebrew/bin` en Apple Silicon, `/usr/local/bin` en Intel), y entonces
`ffmpeg`/`ffprobe` no se encontrarían aunque estén instalados. El backend
**añade automáticamente** esas rutas al `PATH` al arrancar, así que no necesitas
configurar nada manualmente; solo asegúrate de que los binarios estén realmente
instalados.

### "Failed to fetch" en el navegador

Si la Interfaz muestra el error **"Failed to fetch"**, casi siempre significa
una de dos cosas:

1. **El backend no está arrancado** (o se detuvo por dependencias faltantes).
   Revisa la terminal del backend y arráncalo en `localhost:8000`.
2. Un **problema de CORS** entre el frontend (`:3000`) y el backend (`:8000`).
   El backend ya habilita CORS para `http://localhost:3000` y
   `http://127.0.0.1:3000` (configurable con la variable de entorno
   `VSE_CORS_ORIGINS`, orígenes separados por comas), por lo que esto no debería
   ocurrir con la configuración por defecto.

### Comprobar que el backend está vivo

Abre en el navegador (o con `curl`) el endpoint de salud:

```
http://localhost:8000/salud
```

Debe responder `{"estado": "ok"}`. Si no responde, el backend no está arrancado.

### Render de subtítulos y corte de silencios (macOS / ffmpeg 8.x)

- **Subtítulos con `ass=filename=`:** el quemado de subtítulos invoca `ffmpeg`
  con el filtro en la forma de opción nombrada `ass=filename=<ruta>` (con la
  ruta escapada para el filtergraph). Esto es necesario porque `ffmpeg` 8.x
  rechaza la ruta como argumento posicional (`No option name near '...ass'`). Si
  tu `ffmpeg` **no incluye libass** (o el filtro de subtítulos no está
  disponible), el paso falla con un mensaje accionable: reinstala un `ffmpeg`
  con libass, por ejemplo `brew reinstall ffmpeg`.

- **Corte de silencios con `ffmpeg` por defecto:** el paso de silencios usa el
  motor nativo de `ffmpeg` (`silencedetect` + recorte con `select`/`aselect`),
  que **no depende de `auto-editor`** (cuyo binario macOS puede terminar con
  `Killed: 9`/SIGKILL). Controla el motor con la variable de entorno
  `VSE_SILENCE_ENGINE`: `ffmpeg` (por defecto) o `auto-editor`.

- **Continuar sin subtítulos si el quemado falla:** con `VSE_SUBTITLES_FAILSOFT=1`
  el pipeline continúa sin subtítulos (usa el video de entrada del paso) en lugar
  de marcar el Job como fallido cuando el quemado de subtítulos falla. Está
  desactivado por defecto.

### ffmpeg y libass

El **quemado de subtítulos** requiere un `ffmpeg` compilado con **libass** (el
filtro `ass`). Algunos builds —incluido el `ffmpeg` de Homebrew en ciertas
versiones— **no incluyen libass**, por lo que el filtro `ass` no existe
(`No such filter: 'ass'`) y no se pueden quemar los subtítulos. Reinstalar ese
mismo build no ayuda si no trae libass.

**Cómo verificar si tu `ffmpeg` incluye libass:**

```
ffmpeg -hide_banner -filters | grep -w ass   # si no aparece la línea, falta libass
ffmpeg -buildconf | grep -i libass           # busca --enable-libass en la config
```

Al arrancar, el backend también avisa con un **WARNING no fatal** si el `ffmpeg`
configurado no incluye el filtro `ass`.

**Si tu `ffmpeg` no trae libass**, tienes tres opciones:

1. **Instalar/usar un `ffmpeg` con libass** en el sistema.
2. **Descargar un build estático** de `ffmpeg` con libass (por ejemplo desde
   [evermeet.cx](https://evermeet.cx/ffmpeg/) en macOS) y apuntar la app a él con
   `VSE_FFMPEG_BIN=/ruta/a/ffmpeg` (y opcionalmente
   `VSE_FFPROBE_BIN=/ruta/a/ffprobe`).
3. **Desbloqueo temporal:** arrancar con `VSE_SUBTITLES_FAILSOFT=1` para generar
   el video **sin** subtítulos mientras resuelves lo anterior.

**Binarios de ffmpeg/ffprobe configurables:**

- `VSE_FFMPEG_BIN`: ejecutable de `ffmpeg` a usar. Puede ser un **nombre** en el
  `PATH` (p. ej. `ffmpeg`) o una **ruta absoluta** (p. ej.
  `/opt/ffmpeg/bin/ffmpeg`). Por defecto: `ffmpeg`.
- `VSE_FFPROBE_BIN`: ejecutable de `ffprobe` a usar (nombre en el `PATH` o ruta
  absoluta). Por defecto: `ffprobe`.

La verificación de dependencias al arrancar comprueba el binario **configurado**:
si es una ruta absoluta, verifica que exista y sea ejecutable; si es un nombre,
lo busca en el `PATH`.

## Notas

- No se establece ninguna conexión de red saliente hacia servicios externos ni
  se requieren claves de API: la aplicación opera de forma totalmente local.
- El backend opera **sin autenticación**.
- Los archivos temporales de cada Job se crean dentro del directorio de trabajo
  del Job y se limpian automáticamente al finalizar (éxito, error o
  cancelación).
