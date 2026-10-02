# Preview builds

- Keep supplied IWADs in ignored `build/wads/DOOM.WAD` and
  `build/wads/DOOM2.WAD`. Preserve a copy in the main checkout's ignored
  `build/wads/` before removing a worktree; copy those inputs into new
  feature worktrees. Do not delete the only local copies.
- After changing the game or packaging, run `make -j4 preview` to build
  `doom-engine.html`, `doom.html`, `doom1.html`, and `doom2.html`.
  Provide private preview links to all four. Do not silently omit either
  game; ask for the missing input if a supplied WAD cannot be found.
- `make` builds only the distributable WAD-less `doom-engine.html`.
  Embedded-WAD builds are private previews, never release artifacts.
- Keep WADs and generated HTML/gzip files out of Git. `make clean` must
  preserve `build/wads/`.
- Collections are generic: accept any number of local IWADs and compress
  them together in one XZ stream. The named builds are presets, not a
  special two-WAD archive format.

# Project direction

- Browser-only. Keep the engine C sources flat in `doom/`, close to
  original Linux Doom structure. Do not reintroduce native backends.
- Keep browser code in `web/`, build scripts in `tools/`, third-party
  libraries in `lib/`, and each CRT filter in `shaders/<name>/`.
- Single-file builds must work offline through `file://`, with no
  runtime downloads or external dependencies.
- Performance and compressed size matter. Report material regressions.

# Engine and rendering

- Preserve vanilla gameplay, fixed-point behavior and demo compatibility.
  Simulation stays at 35 Hz even when rendering FPS is unlocked.
- Software rendering is the default. WebGL and free look are opt-in;
  free look requires WebGL.
- C/WASM selects actors and builds geometry (`doom/r_gpu.c`).
  JavaScript submits it to WebGL (`web/render.js`); GLSL runs on the GPU.
- Fix rendering problems without changing simulation to compensate.
  Compare both renderers at the same game state.
- Honor Doom's visibility semantics. In particular, `MF_NOSECTOR`
  actors are invisible even when found in the thinker list.
- Native resolution follows the rendered viewport and devicePixelRatio.
  Browser aspect must widen the view rather than stretch the image.

# Interface

- Settings belong inside the game, using Doom's artwork, fonts, cursor
  and sounds. HTML is only for loading/selecting WADs and browser setup.
- Preserve original main-menu and Options artwork. Extra Options should
  match that style.
- Escape goes back one submenu level.
- Default and Emulation presets use original arrow-key bindings.
  Modern uses WASD.
- Verify menu layout visually, including long values, nested screens
  and the visible status bar.

# Dependencies and audio

- Third-party sources are checked in and pinned. Keep source links,
  revisions and licenses in their READMEs; builds use local copies.
- Shader choices are the actual named implementations, not presets
  pretending to be Lottes, CRT-Pi, Easymode or Royale.
- Preserve the Chocolate Doom-style OPL music path; do not substitute
  a generic MIDI synth.

# Development and verification

- Iterate with `make -j4 build/index.html`; run full preview packaging
  after source changes are settled.
- Browser tests use Node and Chromium without npm dependencies.
  `.mjs` files under `tests/` are tests, not shipped game code.
- For rendering changes:
  `DOOM_GPU_ONLY=1 node tests/test.mjs build/wads/DOOM.WAD build/wads/DOOM2.WAD`
- Test packed HTML through `file://` when changing packaging or startup.
- When practical, demonstrate that a regression test fails before the
  fix and passes afterward.
