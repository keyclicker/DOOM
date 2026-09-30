# Vendored sources

## Music synthesis

`nuked-opl3/opl3.c` and `opl3.h` are unmodified Nuked OPL3 1.8 sources,
vendored from [nukeykt/Nuked-OPL3](https://github.com/nukeykt/Nuked-OPL3)
at commit `765ec962e473aeb767e4cba74ffdc8f588ffbfe8`.
Copyright 2013–2020 Nuke.YKT; LGPL-2.1-or-later. The full license is in
`nuked-opl3/LICENSE`.

`../s_opltables.h` contains the DMX frequency and volume tables from
[Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom),
`src/i_oplmusic.c` at commit `895f581c5d91497bdda0516612da803fe5843e28`.
Copyright 1993–1996 Id Software, Inc. and 2005–2014 Simon Howard;
GPL-2.0-or-later. `../s_opl.c` adapts that revision's Doom 1.9 OPL2 voice
allocation, instrument caching, pitch, volume, controller, and pause rules
from `src/i_oplmusic.c`, register initialization from `opl/opl.c`, and
channel mapping from `src/mus2mid.c` (also copyright 2006 Ben Ryves).
See the root `LICENSE.TXT`.

`../web/test-opl.mjs` compiles the unchanged upstream driver and its own chip
from a caller-supplied source checkout at that revision. It checks source
hashes before comparing register writes and PCM. The reference build is
only a test dependency; it is not copied into the production build.

Both are built locally. There are no runtime package or asset downloads.
Instrument data comes from the user's WAD, not from these sources.

## CRT filters

The four selectable upstream filters and Royale masks are documented in
[crt/README.md](crt/README.md), including authors, licenses, pinned source
hashes and WebGL adaptations. They are bundled locally into the HTML.
