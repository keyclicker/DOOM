/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef V_VIEW_H
#define V_VIEW_H
#include <stdint.h>
#include "doomtype.h"
#include "v_video.h"

/* The world buffer and logical artwork use separate dimensions. */
extern int vid_width, vid_height, vid_square_pixels;
extern byte *vid_screen;
#ifdef HARDWARE_RENDER
extern byte *vid_alpha;
#endif
extern int v_ui_height;
#define VID_WIDTH vid_width
#define VID_HEIGHT vid_height

/* Anchor original artwork within the expanded viewport. */
enum { V_UI_CENTER, V_UI_BOTTOM, V_UI_TOP };
extern int v_ui_anchor;

/* Validate and allocate a mode; reject dimensions outside renderer limits. */
boolean V_SetMode(int width, int height, int square_pixels);

/* Composite legacy patches and copied spans into the variable framebuffer. */
void V_DrawViewPatch(int x, int y, patch_t *patch, int flipped);
void V_DrawHalfPatch(int x, int y, patch_t *patch);
void V_CopyViewPixels(int offset, int count);
void V_CopyViewBorder(int offset, int count);
void V_BlitView(void);
void V_FillStatusSides(void);

#endif
