# Doom

A browser-only port of id Software's Linux Doom 1.10 engine. Load a local
IWAD and play. The original software renderer is the default; WebGL geometry,
free look, higher resolutions, unlocked FPS, and CRT filters are optional.
No runtime dependencies or remote game assets.

## Source layout

```text
Makefile              build and package from the repository root
doom/                 engine C sources and headers, including browser i_*.c
web/                  browser JavaScript, audio worklet, and HTML shell
shaders/<name>/       GLSL, presets, textures, and pinned source references
lib/                  third-party OPL emulator and XZ decoder
tools/                Python build and packaging scripts
tests/                browser tests and C fixtures
docs/                 original release notes and historical documentation
build/                generated files (ignored)
```

`doom/` keeps the original flat module layout: `d_*` for startup and frame
stepping, `p_*` for simulation, `r_*` for rendering, `m_*` for menus and
utilities, `s_*` for sound, and `i_*` for browser services. C headers live
beside their implementations. There is one engine and one browser target.
The Linux backend, IPX/serial utilities, and external sound server are removed.

The browser boundary still uses Doom's `i_*` interfaces. `i_render.c` submits
geometry to WebGL through `web/render.js`; `i_music.c` exposes synthesis to
`web/music-worklet.js` in a separate WASM module. Gameplay, rendering logic,
settings, and music sequencing stay in C. Vendored C stays in `lib/`.

## Build and run

Requires GNU Make 4.3+, Emscripten, Python 3, and `cpp` on PATH.

```sh
make
python3 -m http.server 8000 --directory build
```

Open `http://localhost:8000` and select a local IWAD. Deploy `index.html`,
`doom.wasm`, and `music.wasm` from `build/` together on a static HTTPS server.
`doom.js` and object files are build intermediates.

The default engine optimization is `-Oz` with LTO; the audio module uses
`-O2`. Run `make clean` before changing compiler flags, such as `make OPT=-O2`.
Header dependencies are tracked; `make clean` removes all generated outputs.

For a compressed HTML that opens directly, including offline with `file://`,
install Terser and Zopfli, then use:

```sh
# Distributable: player supplies their own WAD.
make single

# Private: embed a local IWAD. Do not redistribute game data.
make single-wad WAD=/absolute/path/to/DOOM.WAD
```

Outputs are `build/single/DOOM.html` and `build/single-wad/DOOM.html`, each
with a gzip companion. Both retain all renderers, filters, music, saves, and
settings. WADs and build artifacts stay out of Git.

See [browser instructions](web/README.md) for controls, settings, compression,
and tests. Tests use Node 22+ and Chromium, without npm dependencies:

```sh
node tests/test.mjs /path/to/DOOM.WAD
node tests/test-music.mjs /path/to/DOOM.WAD
DOOM_GPU_ONLY=1 node tests/test.mjs /path/to/DOOM.WAD
DOOM_PRESETS_ONLY=1 node tests/test.mjs /path/to/DOOM.WAD
```

Original release notes are archived in [docs/README.TXT](docs/README.TXT).
The engine is GPL-2.0; see [LICENSE.TXT](LICENSE.TXT). Third-party licenses
and pinned revisions are in [lib/README.md](lib/README.md) and
[shaders/README.md](shaders/README.md). Game data is separate.
