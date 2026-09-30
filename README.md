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

Requires GNU Make 4.3+, Emscripten, Python 3, `cpp`, Terser, and Zopfli.
Run `make` to build `build/doom-engine.html`, then open it directly in your
browser and select a local IWAD. It works offline, including via `file://`.

Four self-contained HTML targets are available:

| Command | Output in `build/` | Startup |
| --- | --- | --- |
| `make doom-engine.html` | `doom-engine.html` | Local WAD picker; distributable |
| `make doom.html` | `doom.html` | DOOM / DOOM II selector; private |
| `make doom1.html` | `doom1.html` | Starts DOOM automatically; private |
| `make doom2.html` | `doom2.html` | Starts DOOM II automatically; private |

Store your IWADs at `build/wads/DOOM.WAD` and `build/wads/DOOM2.WAD`, then
run `make -j4 preview` to build all four. Override `DOOM1_WAD` or `DOOM2_WAD`
to use other paths. Each HTML also gets a `.gz` companion. Inputs and
outputs stay out of Git; `make clean` preserves the WADs.

Single-game builds start without a picker or Play button. Click the game to
activate audio, capture the mouse, and enter fullscreen. A keypress can also
activate audio. Both games retain separate saves based on their IWAD hashes.

The collection packer accepts any number of local IWADs, in selector order:

```sh
python3 tools/pack_single.py build --output build/collection.html \
  --wad /path/to/first.wad --wad /path/to/second.wad --wad /path/to/third.wad
```

All WADs, engine modules, and browser code share one XZ stream, allowing
matches across the collection. The selector uses WAD filenames as labels.
All targets retain both renderers, CRT filters, music, saves, and settings.
Embedded game data is for private use; do not redistribute it.

For the uncompressed development build, use `make build/index.html` and
`python3 -m http.server 8000 --directory build`. This target only requires
Make, Emscripten, Python, and `cpp`. Deploy `index.html`, `doom.wasm`, and
`music.wasm` together; `doom.js` and objects are intermediate files.

The engine uses `-Oz` with LTO; the audio module uses `-O2`. Run `make clean`
before changing compiler flags, such as `make OPT=-O2`.

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
