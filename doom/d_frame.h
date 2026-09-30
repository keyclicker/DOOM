/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef D_FRAME_H
#define D_FRAME_H

/* State shared by host-driven presentation and the engine's melt transition. */
extern int d_wiping;

/* Advance one 35 Hz tic, optionally snapshotting and presenting it. */
void D_AdvanceFrame(int draw, int smooth);
/* Present an interpolated frame; fraction is in [0, FRACUNIT]. */
void D_RenderFrame(int fraction);
/* Suspend simulation while the next host ticks complete the melt. */
void D_BeginWipe(void);

#endif
