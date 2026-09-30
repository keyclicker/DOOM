<div align="center">

# DOOM.html

### Doom. In one HTML file. 230 KB.

**Double-click. Drop in a WAD. Rip and tear.**

No server. No install. No internet.

[![License: GPL-2.0](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE.TXT)
![Engine: 230 KB](https://img.shields.io/badge/engine-230_KB-brightgreen)
![Runtime deps: 0](https://img.shields.io/badge/runtime_deps-0-brightgreen)

</div>

---

That's the real Linux Doom source id released in 1997, compiled to
WebAssembly: software renderer, OPL music, saves, demos, all of it.
The whole engine fits on a floppy disk six times over. It runs from
`file://`, a USB stick, or a plane with no Wi-Fi, and your WAD never
leaves your machine.

Want the game inside too? DOOM + DOOM II is 25.8 MB of WADs.
Packed with the engine: **one 6.7 MB file**.

## What you get

- **The real engine.** id's gameplay code and fixed-point math run as
  shipped. The original 1.9 demos still play, and all 77 maps load and
  save.
- **The real renderer, and a new one.** Doom's software renderer is the
  default. Flip to WebGL for free look, native Retina resolution,
  widescreen, and unlocked FPS with interpolation over the 35 Hz sim.
- **The real music.** MUS tracks drive a Nuked OPL3 chip on the audio
  thread, register-for-register with Chocolate Doom's default OPL driver.
- **Five CRT filters.** Our own Clean CRT, plus Lottes, CRT-Pi,
  Easymode, and the full 12-pass CRT-Royale. Pick one from the menu.
- **Settings inside Doom.** No HTML overlay. *Extra Options* lives in the
  main menu, with Doom's font and skull cursor, and three presets:
  Default, Emulation, and Modern.
- **Saves that stick.** Doom's native save files persist in the browser,
  kept apart per IWAD by SHA-256.
- **Nothing to fetch.** No SDL, no framework, no CDN, no npm. Every byte
  the game needs is already in the page.

## Quick start

You need GNU Make 4.3+, Emscripten, Python 3, `cpp`, Terser, and Zopfli.

```sh
make    # build/doom-engine.html, open it in any browser
```

Pick a WAD, click the game to grab the mouse and go fullscreen. That's it.
Shareware Doom 1.9, Ultimate Doom, and Doom II 1.9 are tested.

## Builds

| Command | Output in `build/` | Starts with | Size |
| --- | --- | --- | ---: |
| `make` | `doom-engine.html` | WAD picker | 230 KB |
| `make doom1.html` | `doom1.html` | DOOM, immediately | 3.8 MB |
| `make doom2.html` | `doom2.html` | DOOM II, immediately | 5.4 MB |
| `make doom.html` | `doom.html` | DOOM / DOOM II menu | 6.7 MB |

Sizes from a local build with the DOOM 1.9 and DOOM II 1.9 IWADs.

`doom-engine.html` is the one to share. The other three embed game data:
put your IWADs at `build/wads/DOOM.WAD` and `build/wads/DOOM2.WAD`, run
`make -j4 preview`, and keep the results to yourself. Override the paths
with `DOOM1_WAD=...` or `DOOM2_WAD=...`. Every HTML also gets a `.gz`
twin, and `make clean` leaves your WADs alone.

Any mix of IWADs can go into one file:

```sh
python3 tools/pack_single.py build --output build/collection.html \
  --wad doom1.wad --wad doom.wad --wad doom2.wad
```

Everything, engine included, shares one XZ stream, so levels that reuse
textures compress against each other. The result is Base122-encoded
(~14% overhead instead of Base64's 33%) and unpacked once at startup.

### Development build

Skip the packing when iterating. This one needs only Make, Emscripten,
Python, and `cpp`:

```sh
make build/index.html
python3 -m http.server 8000 --directory build
```

Deploy `index.html`, `doom.wasm`, and `music.wasm` side by side. The
engine builds with `-Oz` and LTO; run `make clean` before trying another
`OPT`, e.g. `make OPT=-O2`.

## How it works

```text
doom/       engine C sources; i_*.c is the browser port
web/        JS glue, audio worklet, launcher, HTML shell
shaders/    CRT filters, each pinned to its upstream source
lib/        vendored Nuked OPL3 and XZ decoder
tools/      Python build and packaging scripts
tests/      browser tests and C fixtures
docs/       id's original release notes
```

The port keeps Doom's own seams. Browser input, video, sound, and
networking live behind the original `i_*` interfaces, so gameplay,
rendering, menus, settings, and music sequencing stay in C. JavaScript
runs the launcher, schedules frames, talks to WebGL and Web Audio, and
stores files.
The Linux backend, IPX and serial drivers, and sound server are gone.

The deep dive into renderers, shaders, music, and performance numbers is
in [web/README.md](web/README.md), along with the full controls.

## Tests

Node 22+ and Chromium, driven over the DevTools Protocol. No npm install.

```sh
node tests/test.mjs /path/to/DOOM.WAD
node tests/test-music.mjs /path/to/DOOM.WAD
DOOM_GPU_ONLY=1 node tests/test.mjs /path/to/DOOM.WAD
DOOM_PRESETS_ONLY=1 node tests/test.mjs /path/to/DOOM.WAD
```

The suite plays through menus, fights, saves, reloads, warps to every map,
runs the attract demos for 6,000 tics, and fails on any network request.

## License

The engine is GPL-2.0, see [LICENSE.TXT](LICENSE.TXT). Third-party code is
pinned and credited in [lib/README.md](lib/README.md) and
[shaders/README.md](shaders/README.md). The original id release notes
live in [docs/README.TXT](docs/README.TXT).

Game data is not included and is not ours to give. Bring your own WAD.
