# Music synthesis sources

`nuked-opl3/opl3.c` and `opl3.h` are unmodified Nuked OPL3 1.8 sources,
vendored from [nukeykt/Nuked-OPL3](https://github.com/nukeykt/Nuked-OPL3)
at commit `765ec962e473aeb767e4cba74ffdc8f588ffbfe8`.
Copyright 2013–2020 Nuke.YKT; LGPL-2.1-or-later. The full license is in
`nuked-opl3/LICENSE`.

`../music-tables.h` contains the DMX frequency and volume tables from
[Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom),
`src/i_oplmusic.c` at commit `895f581c5d91497bdda0516612da803fe5843e28`.
Copyright 1993–1996 Id Software, Inc. and 2005–2014 Simon Howard;
GPL-2.0-or-later. The GENMIDI interpretation and volume/pitch formulas in
`../music.c` follow that implementation. See the root `LICENSE.TXT`.

Both are built locally. There are no runtime package or asset downloads.
Instrument data comes from the user's WAD, not from these sources.
