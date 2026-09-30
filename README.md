# Doom

One engine derived from id Software's Linux Doom 1.10 release, with platform
backends at the original `i_*` boundary. The browser port runs the original
software renderer by default, with optional WebGL geometry and free look.
Game data comes from a local IWAD; there are no runtime dependencies.

| Platform | Status | Build |
| --- | --- | --- |
| Web | Supported | `make -C doom PLATFORM=web` |
| Linux | **Not ready** — preserved legacy backend | `make -C doom PLATFORM=linux` |

The default target is Web. See [browser instructions](doom/web/README.md)
for controls, settings, deployment, and tests. See [Linux status](doom/linux/README.md)
before trying the native target.

## Source layout

```text
doom/
  d_*.c/h, g_game.*    startup, frame stepping, gameplay
  p_*.c/h             world simulation
  r_*.c/h             software/geometry renderers and interpolation
  v_*.c/h             indexed pixels and artwork composition
  m_*.c/h             menus, settings, bindings, utilities
  s_*.c/h             sound selection and OPL synthesis
  i_*.h               platform service interfaces
  linux/              legacy X11/Unix i_* implementations (not ready)
  web/                browser i_* implementations, JS, HTML, integration tests
  shaders/<name>/     each display filter's GLSL, includes, presets and textures
  vendor/             unmodified OPL emulator and license
  Makefile            shared source list and compilation rules
  build/<platform>/   ignored outputs and dependency files
```

`doom/` replaces the platform-named `linuxdoom-1.10/` directory. There is no
second engine under `web/`. Both backends compile the same game sources;
their small `platform.mk` files select tools, engine features, libraries,
and final packaging.

The original module boundaries still apply:

- `i_main.c`: process entry or host-callable entry points.
- `i_system.c`: memory, clock, termination, and settings notification.
- `i_video.c`: input events, palette, and display output.
- `i_sound.c`: sound/music delivery to the host.
- `i_net.c`: transport, including the browser's single-player implementation.
- `i_render.c` (optional): indexed materials and GPU triangle submission.

Resolution and artwork composition live in `r_view`/`v_view`, interpolation
in `r_interp`, frame stepping in `d_frame`, settings state in `m_settings`,
the geometry renderer in `r_gpu`, and the MUS/OPL driver in `s_opl`. These
modules contain no Emscripten or JavaScript calls. Browser exports are thin wrappers in `web/i_*.c`.
The audio worklet has a separate `web/i_music.c` entry point so its synthesis
can stay off the main thread.

## Adding a platform

Add `doom/<platform>/` with the five `i_*.c` implementations and a
`platform.mk`. That file selects `CC`, flags, `TARGET`, and its link or
packaging rule. The common Makefile supplies engine objects and dependency
tracking. Run it with `make -C doom PLATFORM=<platform>`; no engine copy or
new top-level build system is needed.

Keep host APIs inside that directory. Reuse the engine modules rather than
putting simulation, rendering, or music sequencing into an `i_*` file.

The current build options preserve each backend's existing behavior:

| Engine option | Purpose | Currently selected by |
| --- | --- | --- |
| `VARIABLE_VIDEO` | Variable framebuffer, wider raster storage, interpolation | Web |
| `EXTENDED_MENU` | Resolution/FPS/binding pages and FPS counter | Web |
| `HARDWARE_RENDER` | Optional geometry renderer and camera pitch | Web |
| `EXTERNAL_LOOP` | Return to the host and advance through `D_AdvanceFrame`/`D_RenderFrame` | Web |
| `SNDSERV` | Original external Unix sound server | Linux |

The extended menu and host-driven frame loop currently use the variable-video
modules. A backend enabling them must link `m_settings`, `d_frame`, `r_view`,
`r_interp`, and `v_view` as appropriate. It must apply settings changes between
engine calls and implement `I_SettingsChanged`. Web's build fragment is the
working example. Linux retains its blocking loop, fixed renderer, and original
menus; new browser features are not silently enabled there.

A GPU backend additionally compiles `r_gpu` with `HARDWARE_RENDER` and
implements `i_render.h`. The engine owns BSP polygons, wall pegging, sprite
selection and interpolated positions. The backend owns textures, shaders and
submission. Web's implementation uses WebGL 2 directly, without a GL shim.

Both current targets retain a 32-bit engine ABI. A new 64-bit native target
will need an explicit portability pass over pointer arithmetic and save data.
The shared OPL module is independent of that legacy ABI.

## Building

GNU Make 4.3+ is required. Web also needs Emscripten and Python 3; Linux needs
a 32-bit C toolchain and 32-bit X11/Xext development libraries.

Outputs are isolated per platform. Header dependencies are tracked, and
`make -C doom PLATFORM=<platform> clean` removes only that target's outputs.
Clean that target when changing compiler flags, such as `OPT=-O2` for Web.

Deploy only `index.html`, `doom.wasm`, and `music.wasm` from `doom/build/web/`.
`doom.js` and the object files are build intermediates, not runtime assets.
WADs and build outputs are never part of the source distribution.

For one compressed HTML that opens offline, run `make -C doom single`.
To embed a local IWAD for personal use, run
`make -C doom single-wad WAD=/absolute/path/to/DOOM.WAD`.
These targets also need Terser and Zopfli. See the
[single-file instructions](doom/web/README.md#compressed-single-file-builds)
for output paths, compression, and deployment. Only the WAD-less build may be
included in project releases.

Historical release notes remain in [README.TXT](README.TXT) and `doom/README.*`.
The engine is GPL-2.0; see [LICENSE.TXT](LICENSE.TXT). Third-party provenance
and licensing are in [doom/vendor/README.md](doom/vendor/README.md).
