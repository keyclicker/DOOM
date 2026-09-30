<div align="center">

# DOOM.html

### Doom. In one HTML file. 230 KB.

**Double-click. Drop in a WAD. Rip and tear.**

No server. No install. No internet.

<a href="https://keyclicker.dev/DOOM.html/">
  <img alt="Play in your browser" src="https://img.shields.io/badge/%E2%96%B6%20PLAY%20IN%20YOUR%20BROWSER-keyclicker.dev%2FDOOM.html-8b0000?style=for-the-badge&labelColor=b22222">
</a>

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

## Why it's cool

### It's just a file

The engine, the music synth, five CRT shaders, and the launcher all live
in one `.html`. No server, no CDN, no SDL, no framework. Mail it, carry
it on a USB stick, open it over `file://` on a plane. Your WAD is read
locally and goes nowhere. Saves live in the browser, kept separate for
each IWAD.

### Compressed to the bone

`gzip -9` gets DOOM and DOOM II down to 11.1 MB. DOOM.html fits both
games *and the engine* in 6.7 MB, and the result is still an HTML file.

- Engine, shaders, and every WAD share **one XZ stream**, so DOOM II
  compresses against art DOOM already shipped.
- The packer tries six LZMA2 tunings at `-9e` and keeps the winner.
- **Base122** carries the binary inside HTML at ~14% overhead, instead
  of Base64's 33%.
- The XZ decoder itself rides along Zopfli-gzipped and unpacks through
  the browser's built-in `DecompressionStream`. Everything decodes once
  at startup and gets CRC-checked.

### Plays like 1993 out of the box

Defaults are id's defaults: 320×200, 4:3, the software renderer, 35 FPS,
the original keys and menus.

- id's gameplay code and fixed-point math run as shipped. The original
  1.9 demos still play, and all 77 maps load and save.
- Music runs a Nuked OPL3 chip on the audio thread and matches Chocolate
  Doom's OPL driver register for register. That's the AdLib sound you
  remember, not a General MIDI approximation.

### Modern when you want it

Everything below is opt-in, from *Extra Options* in Doom's own main
menu. Doom's font, skull cursor, and sounds; no HTML overlay.

- **WebGL renderer.** The GPU draws the level; the HUD and menus stay
  pixel-exact.
- **Free look.** Mouse Y tilts the camera up to ±85°. Auto-aim stays
  vanilla. Needs WebGL.
- **Any resolution.** 320×200 up to 1920×1200, or *Native*, which
  follows your display pixel for pixel, Retina included.
- **Widescreen.** *Browser* aspect widens the field of view instead of
  stretching the picture.
- **Unlocked FPS.** Renders at your display's refresh rate and
  interpolates camera, monsters, lifts, and weapon bob. The simulation
  stays at 35 Hz.
- **Five CRT filters.** Our own Clean CRT, plus Lottes, CRT-Pi,
  Easymode, and the full 12-pass CRT-Royale. They work with both
  renderers.
- **Rebindable keys**, with a WASD preset, and an FPS counter.
- **Presets.** *Default*, *Emulation* (stock plus Clean CRT), and
  *Modern* (WebGL, native resolution, widescreen, free look, unlocked
  FPS, WASD). Flip between them from one menu row.

## Quick start

No build needed to try it: open
**[keyclicker.dev/DOOM.html](https://keyclicker.dev/DOOM.html/)** and drop in
a WAD. To build your own copy:

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
