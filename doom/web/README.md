# Doom in the browser

The original Linux Doom 1.10 engine and software renderer, compiled to
WebAssembly. Load a local IWAD and play with the original settings by default.
No framework, SDL, CDN, remote assets, or runtime package dependencies.

## Build and run

Requires GNU Make 4.3+, Python 3, a C preprocessor (`cpp`), and Emscripten
(`emcc` on PATH). Tested with Emscripten 6.0.9.

```sh
make -C doom PLATFORM=web
python3 -m http.server 8000 --directory doom/build/web
```

Open `http://localhost:8000`, choose or drop a Doom IWAD, then click the game
to capture the mouse and enter fullscreen. The page also requests fullscreen
when a user selects a file; browsers may require the additional click.

Deploy **`index.html`, `doom.wasm`, and `music.wasm`** from `doom/build/web` side by side
on any static HTTPS server. Localhost HTTP also works. Opening the HTML
directly with `file://` does not work because browsers restrict WASM fetching.
WADs are read locally and never uploaded or automatically fetched. The optional
private build below can embed an IWAD explicitly supplied at build time.

Tested IWADs: Doom shareware 1.9, Ultimate Doom, and Doom II 1.9. IWAD contents
determine the game mode, so filenames and filename capitalization do not
matter. PWAD overlays and newer source-port map formats are outside this port.

## Compressed single-file builds

In addition to the build tools above, install `terser` and `zopfli` on PATH.
Tested with Terser 5.51.2 and Zopfli 1.0.3. The build uses Python's `lzma`
module; no package installation or network access happens during packaging.

```sh
# Distributable: the player selects their own WAD.
make -C doom single

# Private: includes exactly this local IWAD. Do not redistribute game data.
make -C doom single-wad WAD=/absolute/path/to/DOOM.WAD
```

Outputs are `doom/build/web/single/DOOM.html` and
`doom/build/web/single-wad/DOOM.html`, respectively. Each directory also gets
`DOOM.html.gz`. Both targets preserve all renderers, CRT filters, music, saves,
and settings. Software rendering and the original settings remain the defaults.
The ordinary three-file build remains available through `make -C doom`.

Open **DOOM.html directly**, including offline with `file://`. The private build
shows **Play DOOM** instead of the WAD picker. A click starts audio and requests
fullscreen; browsers may require another click on the canvas to capture input.
Saves still use browser local storage; moving/renaming a local HTML can change
which storage the browser exposes. Keep a stable file location for saves.

The `.gz` companion is for downloading or serving with
`Content-Type: text/html; charset=utf-8` and `Content-Encoding: gzip`.
Decompress it before opening locally. Serve the plain HTML as UTF-8 without
transcoding or HTML minification: its Base122 attributes contain significant
control characters. Editing the generated file as text can corrupt the payload.

`pack_single.py` minifies JavaScript, then compresses the HTML, raw shader data,
both WASM modules, and optional WAD together with XZ. Six LZMA2 context choices
are tried at the extreme preset with a 16 MiB dictionary and a deep match
search; the smallest wins. Base122 adds about 14.3% instead of Base64's 33.3%.
Native gzip unpacks the embedded XZ decoder. Zopfli uses 100 iterations for that
decoder and the final gzip companion; this trades build time for file size.
All decoding happens once, before gameplay, with no asset requests. A small
length-prefixed archive avoids a general-purpose ZIP/tar library. Binary bytes
are verified after compression; XZ also checks CRC32 during browser startup.

The XZ decoder is pinned locally in
[`vendor/xz-decompress`](../vendor/xz-decompress/README.md). Its source and license
notices ship in the HTML. The generated artifacts and WADs are ignored by Git.
Never publish the `single-wad` output as a project release.

Run the existing gameplay/music/save tests against either local HTML:

```sh
DOOM_HTML=doom/build/web/single/DOOM.html \
  node doom/web/test.mjs /path/to/DOOM.WAD
DOOM_HTML=doom/build/web/single-wad/DOOM.html \
  node doom/web/test.mjs /path/to/the/same/DOOM.WAD
```

`DOOM_PRESETS_ONLY=1` selects the CRT suite instead. The harness drives the real
file input or Play button, verifies the IWAD hash, and rejects network requests.

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
| F5 | High / low detail |
| F11 | Original gamma control |

Remapped Ctrl–Alt–Command chords keep the underlying Doom bindings:
Control fires and Alt strafes. Releasing the chord releases those actions,
even when the remapper reports them together on a single key event.

Some browsers reserve function keys. Save/load are also in Doom's menu.
The game suspends when the tab loses focus. Saves and preferences persist in
browser local storage, separately for each IWAD's SHA-256. Clearing site data
removes them. Reload the page to choose another WAD after quitting.

## In-game settings

Open **Options → Settings** in Doom's menu. Video, Performance, and Keyboard
pages use the game's font, skull cursor, sounds, and keyboard navigation.
Use arrows to select or change an option, Enter to open a page or capture a
binding, Escape or Backspace to go back one page. Escape at the main menu
resumes play. Changes apply immediately.
Options and settings use a compact font and cursor, with sliders and values
aligned beside their labels. The default view fills the screen while keeping
the status bar visible.

- **Video:** render resolution at 320×200, 640×400, 960×600, or
  1280×800, 1600×1000, or 1920×1200. **Native** follows the displayed canvas's
  size multiplied by `devicePixelRatio`, including Retina screens and changes
  in browser zoom or display density. Native buffers use square pixels;
  fixed modes retain Doom's original pixel correction.
  Original 4:3 remains the default. Browser aspect adapts the render
  width to the window, expanding the horizontal field of view on wide
  displays. HUD/menu artwork stays proportional, with the original backdrop
  tiled beside the status bar. Buffers are bounded to 8192 pixels per side
  and 32 Mi pixels total; larger displays scale down proportionally. WebGL
  also respects the device's texture/renderbuffer dimension limit.
  **Renderer** selects **Software** (default) or **WebGL**. **Free look** is
  off by default and available only with WebGL: mouse Y pitches the camera
  instead of moving the player. Mouse X still turns, and Doom's original
  auto-aim remains unchanged. Disabling WebGL disables free look and centers
  the camera. Pitch is capped at ±85 degrees, interpolated with unlocked FPS,
  and reset on level/load changes. Recorded demos retain their original view.
  **CRT filter** cycles through **Off** (default), **Clean CRT**, **Lottes**,
  **CRT-Pi**, **Easymode**, and **Royale** with left/right arrows. All work with
  either renderer and filter the complete image, including HUD and menus.
  Output follows display density even at 320×200; the game still renders at
  the selected resolution. Royale has the highest GPU cost.
- **Performance:** optional rendering at the display refresh rate, with
  interpolated camera, objects, moving floors/ceilings, and weapon motion.
  Simulation remains 35 Hz. Disabling it restores the original 35 FPS.
  The optional counter measures presented frames, not simulation ticks.
- **Keyboard:** edit movement, turning, strafing, fire, use, and run bindings.
  Original and WASD presets are available. Duplicate assignments are rejected;
  left/right modifiers share one action. Menu/function keys, weapon numbers,
  automap, view-size controls, and pause retain their original shortcuts.
  Mouse controls retain their original behavior unless free look is enabled.

These settings persist across WADs in local storage. Native saves remain
compatible. Automap, menu art, intermissions, and melt transitions retain their
original pixel detail. WebGL 2 is required for WebGL rendering or any CRT
filter. Unavailable or lost contexts fall back to software without ending the
game. A rejected shader disables the filter and preserves the chosen world
renderer. Select the renderer or filter again to retry.

## CRT filters

Clean CRT is our original, comfortable single-pass filter in
[`shaders/clean-crt`](../shaders/clean-crt). The other
four choices run the human-authored shaders below, using their stock settings:

| Shader / author | Style and useful ideas |
| --- | --- |
| [CRT-Lottes / Timothy Lottes](https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/crt-lottes.glsl) | RGB arcade monitor; reconstruct neighboring samples in light space, with shaped beams and a shadow mask. |
| [CRT-Pi / davej](https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/crt-pi.glsl) | Lightweight CRT for small GPUs; horizontal blending, brightness-dependent beam width, and attention to scanline moiré. |
| [CRT-Easymode / EasyMode](https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/crt-easymode.glsl) | Flat aperture-grille look; separate horizontal/vertical sharpness and suppress scanlines on high-resolution input. |
| [CRT-Royale / TroggleMonkey](https://docs.libretro.com/shader/crt_royale/) | Detailed multipass simulation with selectable phosphor masks, bloom, halation, convergence and screen geometry. |

These are longstanding community choices, not a ranked benchmark. See the
[Libretro shader guide](https://docs.libretro.com/shader/crt/) and the
[community's favorite-shader discussion](https://forums.libretro.com/t/what-is-your-favorite-crt-shader/2426).
The upstream GLSL, Royale preset and phosphor masks are pinned in
[`shaders/<shader-name>`](../shaders/README.md), with authors, licenses and
source links pinned to an upstream commit. `pack_shaders.py` adapts their
legacy GLSL to WebGL 2 at build time, removes unused helper functions, and
embeds compressed source and masks in the HTML. Browser APIs decode them
locally; no CDN or runtime assets are used.

`crt-presets.js` compiles only the selected shader. Lottes, CRT-Pi and Easymode
each use one pass. Royale runs its full 12-pass pipeline: scanline reconstruction,
mask resizing, bloom, diffusion and geometry/AA, with sRGB intermediate targets.
Its original small phosphor masks are included. Doom frames are progressive, so
interlace detection is disabled. Leaving a shader releases its programs and
intermediate textures. Native/Retina Royale can be expensive; select Clean CRT
or CRT-Pi when frame rate matters more than tube detail.

Clean CRT prioritizes readable pixel art over reproducing every tube artifact:

- A positive four-tap cubic B-spline blends each row horizontally without
  ringing. Two rows blend with a smooth vertical transition, keeping lettering
  and thin horizontal features clearer than an isotropic blur.
- Colors are squared before blending and square-rooted afterward: a cheap
  gamma-2 approximation to light-space reconstruction. Doom's palette, gamma
  setting, flashes and power-up colors are applied before the filter.
- Subtle scanline gaps narrow with brightness. Their contrast fades out between
  3 and 1.5 output pixels per source row, avoiding unresolved patterns on native
  and fractional scales. Black stays black; neutral colors stay neutral.
  Uniform-field tests limit average brightness loss to 4%.
- No curvature, vignette, phosphor mask, flicker, persistence, color fringing,
  bloom buffers or time-dependent noise. Scanlines follow actual rendered rows,
  rather than imposing a 200-line grid on native-resolution geometry.

Clean CRT uses eight texture fetches per output pixel and no intermediate
image. All filters receive the hardware renderer's composed color texture
directly, replacing the final blit without CPU readback or framebuffer upload.
Software CRT uploads the software frame without allocating the geometry
renderer or its material atlas. Presentation uses the canvas's CSS size times
`devicePixelRatio`, independently of the engine framebuffer. Turning it off
restores the unfiltered path. Default software startup still creates no GL
context. The cost scales with display pixels; physical GPU performance needs
measurement on the target device, not the test VM's SwiftShader.

## Port boundary

- `web/i_*.c` implements the same platform interfaces as `linux/i_*.c` for browser
  input, RGBA output, Web Audio sound effects, and single-player transport.
- `app.js` loads the WAD into Emscripten's memory filesystem, schedules the
  original 35 Hz simulation, presents the selected framebuffer, and
  persists Doom's native save files. A long frame catches up at most 250 ms.
- `m_menu.c` owns the native settings pages, action capture, and FPS text.
- `settings.js` validates and persists preferences, applies viewport changes
  between engine calls, and counts presented frames. There is no HTML menu.
- `v_view.c` and `r_view.c` separate the world framebuffer from the 320×200 UI.
  They cache projection tables per video/view change and mirror UI writes
  without losing patch transparency. `r_interp.c` keeps snapshots outside serialized
  game structures. Render inputs are restored before the next simulation tic.
- `r_gpu.c` builds convex floor/ceiling polygons by clipping map bounds through
  the existing BSP and subsector segs. It streams visible wall/plane/sprite
  triangles with current sector heights, texture animations and lighting.
  Materials are uploaded once per context as palette indices plus coverage.
  Frustum rejection works at arbitrary pitch; BSP ordering reduces overdraw.
  A visibility-only pass retains the original automap discovery rules.
  Sprites carry their interpolated sector floor height. Their shader tests
  below-floor artwork at that floor's depth, preserving the original artwork
  position instead of lifting actors. A depth-only solid-wall silhouette pass
  keeps hidden feet behind walls and closed doors. Higher floors still occlude
  sprites; weapons and ordinary world depth testing are unchanged.
- `web/i_render.c` implements `i_render.h`; `render.js` submits triangles
  directly to WebGL 2. Indexed texture and COLORMAP lookups retain the WAD's
  palette, gamma, damage flashes and power-up colors. The native status bar,
  menus and text stay in four 320×200 indexed layers (center, bottom, top,
  and view border). Paint-order tags preserve overlapping artwork; the GPU
  scales and composites it, including status-bar gutters. Normal world frames
  never expand the HUD into a screen-sized CPU RGBA buffer.
  Fuzz uses a GPU scene copy only when needed. Wipes capture the last frame
  once; normal gameplay performs no GPU readback. `crt.js` optionally filters
  this composed texture during presentation.
- `r_*.c` use bounded larger work arrays, 16-bit visplane row coordinates,
  variable column stride, and resolution-independent lighting. Low-detail
  routines draw pixel pairs without mutating the caller's column index or
  overrunning spans. Native-resolution rendering separates horizontal and
  vertical projection and widens raster edges before clipping. The viewed
  player's sprite is excluded even when interpolation trails its position.
- `audio.js` caches decoded 8-bit PCM samples and lets Web Audio mix them.
  Doom still chooses sounds, volume, stereo position, and pitch. Both volume
  sliders use the engine's 0–15 scale; music volume goes to the OPL driver,
  where it changes operator levels using DMX's nonlinear curve.
- `s_opl.c` reads MUS events at 140 Hz and programs the IWAD's `GENMIDI`
  instruments into a vendored Nuked OPL3 synthesizer. `music-worklet.js`
  runs it on the audio thread, so rendering stalls do not interrupt music.
  The worklet source is inlined in the HTML; `music.wasm` has no imports.
- `d_frame.c` advances simulation and the original melt wipe over host frames.
  `EXTERNAL_LOOP` makes `d_main.c` return to its host and leaves tic creation
  to `D_AdvanceFrame`.
- `platform.mk` selects engine features and builds both WASM modules;
  `pack.py` only inlines the scripts. The Unix sound server is Linux-only.
  `w_wad.c` makes its uppercase helper private to avoid a libc name collision.
- `st_stuff.c` fixes an upstream Doom II warp-cheat bug: it assigned episode
  zero, then rejected every episode below one. Doom II uses episode one.
- `g_game.c` accepts version 109 demos from the original 1.9 IWADs, in addition
  to this source release's version 110. Their tic command layout is identical.

Map loading, menus, and fixed-point gameplay remain the original code.
Higher resolutions extend the original software renderer. The build uses 32-bit pointers, wrapping
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
Network multiplayer is not implemented. WebGL uses perspective triangles
and depth testing, so its pixels are not identical to the software renderer.
Its distance shading and fuzz approximate the original effects. Beyond the
original sky artwork, the sky fades into averaged edge colors at the poles. F5's low-detail
pixel pairs affect only the software renderer.
World coordinates and map formats retain their original limits. Renderer
storage has bounded headroom for wider views; allocation checks precede writes.

## Size and performance

The default is `-Oz` with link-time optimization and `emmalloc`. Override with
`make -C doom PLATFORM=web OPT=-O2` after cleaning that target to favor
execution speed. There is no Asyncify,
thread pool, GL compatibility layer, or packaged game data. The small music
module always uses `-O2` because it runs in the audio callback.

Representative builds with Emscripten 6.0.9:

| File | Raw | Gzip |
| --- | ---: | ---: |
| `index.html` | 199 KB | 84 KB |
| `doom.wasm` | 319 KB | 151 KB |
| `music.wasm` | 26 KB | 10 KB |
| Total | 545 KB | 244 KB |

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

WASM memory starts at 32 MiB and can grow to 512 MiB. The tested games remained
at 32 MiB with default settings. Switching through higher resolutions and
widescreen modes grows memory as needed. Canvas views are reused until the
resolution or WASM memory changes; sample buffers are
decoded once. Software startup creates no WebGL context. Enabling WebGL
allocates a bounded RG8 material atlas (up to 32 MiB), a reusable vertex
buffer, color/depth targets at the selected resolution, and a fixed 1,024,000-byte
artwork texture. Sprite occlusion uses one additional depth target at the selected
resolution, written and sampled entirely on the GPU. A screen-sized RGBA upload
is needed only for software frames
(automap, full-screen art, and wipes). Materials and buffers are reused across
frames and renderer toggles. The GPU handles the level geometry and artwork
scaling; the engine still runs gameplay and logical UI drawing.

At 3456×2234, keeping artwork logical reduced its per-frame upload from
30.9 MB to 1.0 MB. A warmed E1M1 benchmark on the Linux VM measured engine
rendering CPU time dropping from 17.4 ms to 0.2 ms, with GPU submission disabled
to isolate geometry generation and HUD work. At 3840×2160 it fell from 19.2 ms
to 0.2 ms. These timings exclude GPU execution, browser compositing, and display
latency; they are not end-to-end FPS measurements. The GPU test reports isolated
CPU timing and checks that artwork uploads stay fixed as resolution increases.

The GPU regression suite uses Chromium/SwiftShader on the test VM. It checks
WebGL correctness, including 4K and Retina modes, but does not measure physical
GPU performance. Hardware timings depend on the browser and device.

At 1280×800, sampled scenes took about 7–8 ms per software frame plus Canvas
submission on the same VM, versus 0.3–0.7 ms at 320×200. These measurements exclude
browser compositing and display latency. Higher resolution and unlocked FPS
multiply CPU work; both are opt-in.

## Verify

Requires Node 22+ and Chromium on PATH (`CHROMIUM` can override its path).
The browser test uses the Chrome DevTools Protocol directly, without npm
packages. Game data is supplied by the caller and never committed.

```sh
node doom/web/test.mjs /path/to/doom1.wad /path/to/doomu.wad /path/to/doom2.wad
node doom/web/test-music.mjs /path/to/doom1.wad /path/to/doomu.wad /path/to/doom2.wad
DOOM_GPU_ONLY=1 node doom/web/test.mjs /path/to/doom1.wad \
  /path/to/doomu.wad /path/to/doom2.wad
DOOM_CRT_ONLY=1 node doom/web/test.mjs /path/to/doom1.wad \
  /path/to/doomu.wad /path/to/doom2.wad
DOOM_PRESETS_ONLY=1 node doom/web/test.mjs /path/to/doom1.wad \
  /path/to/doomu.wad /path/to/doom2.wad
```

`test-crt.mjs` checks the shader with flat fields and hard edges: brightness,
neutral colors, black level, monotonic transitions, temporal stability and
texture orientation. It also checks native menu persistence, unchanged engine
pixels, both renderers at fractional/Retina/4K sizes, context failure/recovery,
and fixed-size artwork uploads. `DOOM_SCREENSHOTS=/tmp/doom-check` writes
before/after screenshots and the native video menu during the CRT suite.

`test-crt-presets.mjs` compiles all five shaders, checks distinct nonempty output
and temporal stability, cycles the native menu, migrates old Clean CRT
preferences, and verifies persistence. Both renderers are checked at fixed,
native and Retina sizes, including automap, constant HUD upload size, no CPU
readback, released intermediate textures, Royale context recovery and shader
compilation failure. `DOOM_SCREENSHOTS` also captures every filter and its menu.

Input regressions check all six Ctrl–Alt–Command press orders, movement
while the chord is held, combined modifier releases, independent left/right
Control keys, and ordinary Command shortcuts. Ammo counts verify one round
per short tap and the original continuous fire while Control remains held.

`test-settings.mjs` also exercises the native menu hierarchy, defaults,
key capture/conflicts, rebinding, six fixed resolutions, portrait/ultrawide
resizing, and native mode at 1×/2×/3× pixel density. Regressions check that
running never exposes the player's own sprite, menus leave no status-bar
residue, square-pixel projection preserves weapon artwork, and interpolation
leaves live object positions intact.
A simulated 100 Hz display verifies the same game-tic count in capped and
unlocked modes, while only unlocked presentation reaches 100 Hz. All 77 maps
are exercised at 1706×800. Set `DOOM_SCREENSHOTS=/tmp/doom-check` to write UI
and gameplay screenshots during the test.

`test-renderer.mjs` checks the opt-in menu, camera-only pitch, interpolation,
exact status-bar colors/coverage, software round trips, automap, four headings
and extreme pitch on all 77 maps, native/Retina modes through 4K, every view
size, unavailable-WebGL fallback, and context loss/recovery. Artwork is compared
against the software renderer at native, Retina, portrait, and fractional sizes,
including reduced-view borders and overlapping full-screen help art.
Original demos also run through WebGL to
exercise moving sectors, combat and transitions. Chromium's explicit
SwiftShader flag is for testing only; the shipped page uses the browser's
normal WebGL device selection.

`test-sprites.mjs` checks sprite floor-height interpolation without simulation
changes, and compares visible artwork pixels with/without a supporting floor.
It covers different floor heights, pitch, solid-wall silhouettes, higher-floor
occlusion, airborne sprites and spectre fuzz. The old world shader is a negative
control that reproduces the original floor clipping.

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
node doom/web/test-opl.mjs /path/to/chocolate-doom /path/to/doom1.wad \
  /path/to/doomu.wad /path/to/doom2.wad
```

This compares every register write across two loops of all 80 MUS scores, plus
the first ten seconds of PCM per track at 44.1/48 kHz. Crowded-note fixtures
cover all 128 melodic instruments, all 47 percussion patches, channel
mapping, layered voices, pitch bends, ignored controllers, and volume
changes. Pause key-offs and release samples are compared as well.

The port is GPL-2.0; see [LICENSE.TXT](../../LICENSE.TXT). Nuked OPL3 is
LGPL-2.1-or-later; source revisions and notices are in
[vendor/README.md](../vendor/README.md). CRT shader licenses and revisions are
in [shaders/README.md](../shaders/README.md). Game data is separate.
