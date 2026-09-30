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
