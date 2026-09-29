# Doom in three files

The original Linux Doom 1.10 engine and software renderer, compiled to
WebAssembly. Load a local IWAD; everything after that is the original game.
No framework, SDL, CDN, remote assets, or runtime package dependencies.

## Build and run

Requires Python 3 and Emscripten (`emcc` on PATH). Tested with Emscripten 6.0.9.

```sh
python3 web/build.py
python3 -m http.server 8000 --directory web/dist
```

Open `http://localhost:8000`, choose or drop a Doom IWAD, then click the game
to capture the mouse and enter fullscreen. The page also requests fullscreen
when a user selects a file; browsers may require the additional click.

Deploy **`index.html`, `doom.wasm`, and `music.wasm`** from `web/dist` side by side
on any static HTTPS server. Localhost HTTP also works. Opening the HTML
directly with `file://` does not work because browsers restrict WASM fetching.
WADs are read locally and never uploaded, bundled, or automatically fetched.

Tested IWADs: Doom shareware 1.9, Ultimate Doom, and Doom II 1.9. IWAD contents
determine the game mode, so filenames and filename capitalization do not
matter. PWAD overlays and newer source-port map formats are outside this port.

## Controls

Original bindings apply:

| Input | Action |
| --- | --- |
| Arrow keys | Move / turn |
| Ctrl / left mouse | Fire |
| Space | Use |
| Shift | Run |
| Alt / middle mouse | Strafe modifier |
| Comma / period | Strafe left / right |
| Mouse X / Y | Turn / move forward and backward |
| Right mouse | Move forward |
| 1–7 | Weapon |
| Tab | Automap |
| Escape | Menu / release browser pointer lock |
| F2 / F3 | Save / load |
| F6 / F9 | Quicksave / quickload |
| Pause | Pause |
| F11 | Original gamma control |

Some browsers reserve function keys. Save/load are also in Doom's menu.
The game suspends when the tab loses focus. Saves and preferences persist in
browser local storage, separately for each IWAD's SHA-256. Clearing site data
removes them. Reload the page to choose another WAD after quitting.

## Port boundary

- `platform.c` replaces the five OS-specific `i_*.c` files with browser
  input, RGBA output, Web Audio sound effects, and single-player transport.
- `app.js` loads the WAD into Emscripten's memory filesystem, schedules the
  original 35 Hz simulation, presents the 320×200 framebuffer at 4:3, and
  persists Doom's native save files. A long frame catches up at most 250 ms.
- `audio.js` caches decoded 8-bit PCM samples and lets Web Audio mix them.
  Doom still chooses sounds, volume, stereo position, and pitch. Both volume
  sliders use the engine's 0–15 scale; music volume goes to the OPL driver,
  where it changes operator levels using DMX's nonlinear curve.
- `music.c` reads MUS events at 140 Hz and programs the IWAD's `GENMIDI`
  instruments into a vendored Nuked OPL3 synthesizer. `music-worklet.js`
  runs it on the audio thread, so rendering stalls do not interrupt music.
  The worklet source is inlined in the HTML; `music.wasm` has no imports.
- `d_main.c` yields control to the browser and advances the original melt
  wipe over successive frames. `d_net.c` leaves tic creation to `web_tick`.
- `doomdef.h` disables the external Unix sound server for the web build.
  `w_wad.c` makes its uppercase helper private to avoid a libc name collision.
- `st_stuff.c` fixes an upstream Doom II warp-cheat bug: it assigned episode
  zero, then rejected every episode below one. Doom II uses episode one.
- `g_game.c` accepts version 109 demos from the original 1.9 IWADs, in addition
  to this source release's version 110. Their tic command layout is identical.

Map loading, menus, fixed-point arithmetic, and the software renderer
remain the original code. The build uses 32-bit pointers, wrapping
signed arithmetic, and disabled strict aliasing for the legacy engine.

Music matches Chocolate Doom's default **OPL (AdLib/SB)** driver for Doom
1.9: nine OPL2 voices, mono routing, the IWAD's instruments, and DMX's voice
allocation, pitch, controller, and volume rules. The browser's slider maps
0–15 to the driver's 0–120 scale. OPL2 ignores pan and sustain controllers.
Pausing stops score time and releases melodic keys; percussion can keep
ringing. Losing browser focus suspends the entire audio context.

Tracks use exact 140 Hz MUS timing and a 5 ms gap when looping. Tests compare
register writes against Chocolate Doom's unchanged driver and PCM against
its own Nuked OPL implementation at identical event timestamps. This checks
synthesis fidelity, not SDL callback rounding or hardware analog output.
The browser still resets the chip for each new song and silences it on stop
or non-looping completion. Only MUS music and Doom 1.9 OPL behavior are
supported; older DMX versions and optional OPL3 stereo are outside this port.
Network multiplayer, hardware rendering, and free look are not implemented.
The original engine's map/rendering limits still apply.

## Size and performance

The default is `-Oz` with link-time optimization and `emmalloc`. Override with
`OPT=-O2 python3 web/build.py` to favor execution speed. There is no Asyncify,
thread pool, GL compatibility layer, or packaged game data. The small music
module always uses `-O2` because it runs in the audio callback.

Representative builds with Emscripten 6.0.9:

| File | Raw | Gzip |
| --- | ---: | ---: |
| `index.html` | 78 KB | 23 KB |
| `doom.wasm` | 293 KB | 138 KB |
| `music.wasm` | 26 KB | 10 KB |
| Total | 398 KB | 171 KB |

The build prints exact raw and gzip sizes; compressed sizes require HTTP
compression by the hosting server. Music adds about 11 KB compressed,
including the worklet and browser integration.

Chromium tests on a Linux VM measured a median **0.3 ms** for `-Oz` versus
**0.2 ms** for `-O2` per warmed game tick plus Canvas submission. This includes
software rendering and pixel expansion, but excludes browser compositing and
display latency. Both leave substantial headroom in the 28.6 ms tick budget.
Music synthesis measured 54 ms of CPU per audio second, roughly 5% of one
core, with 1 MiB of separate WASM memory. The audio callback allocates no
buffers. These are local measurements, not a claim about all devices.

WASM memory starts at 32 MiB and can grow to 128 MiB. The tested games remained
at 32 MiB. Canvas views are reused until WASM memory grows; sample buffers are
decoded once. GPU usage is limited to whatever the browser uses to display
Canvas 2D; there is no hardware level renderer.

## Verify

Requires Node 22+ and Chromium on PATH (`CHROMIUM` can override its path).
The browser test uses the Chrome DevTools Protocol directly, without npm
packages. Game data is supplied by the caller and never committed.

```sh
node web/test.mjs /path/to/doom1.wad /path/to/doomu.wad /path/to/doom2.wad
node web/test-music.mjs /path/to/doom1.wad /path/to/doomu.wad /path/to/doom2.wad
```

Tests start a game through its menus, move, fire, use the automap, pause,
save/load, reload the page and restore saves, then warp to and save every map.
Each IWAD also runs 6,000 ticks of its original attract-mode demo loop.
They reject unexpected browser exceptions and external network requests,
and report frame timings and memory usage. `-O2` and `-Oz` produced identical
framebuffer hashes at the checked starting and movement positions.

Music tests synthesize the first five seconds of all 80 music lumps in these
IWADs and check tempo at 44.1/48 kHz, looping, DMX pause/release behavior,
stop/restart, and malformed scores. Browser tests measure actual worklet
output for title/level music, the volume menu, and suspension, and verify
pause/resume command delivery.

The fidelity test needs an external Chocolate Doom source checkout at
`895f581c5d91497bdda0516612da803fe5843e28`. It verifies source hashes and
compiles the unchanged OPL driver and chip into a temporary test module;
none of that test code ships in the game. No SDL installation is needed.

```sh
node web/test-opl.mjs /path/to/chocolate-doom /path/to/doom1.wad \
  /path/to/doomu.wad /path/to/doom2.wad
```

This compares every register write across two loops of all 80 MUS scores, plus
the first ten seconds of PCM per track at 44.1/48 kHz. Crowded-note fixtures
cover all 128 melodic instruments, all 47 percussion patches, channel
mapping, layered voices, pitch bends, ignored controllers, and volume
changes. Pause key-offs and release samples are compared as well.

The port is GPL-2.0; see [LICENSE.TXT](../LICENSE.TXT). Nuked OPL3 is
LGPL-2.1-or-later; source revisions and notices are in
[vendor/README.md](vendor/README.md). Game data is separate.
