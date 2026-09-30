/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef V_VIEW_H
#define V_VIEW_H
#include <stdint.h>
#include "doomtype.h"
#include "v_video.h"

/* The world buffer and logical artwork use separate dimensions. */
extern int vid_width, vid_height, vid_square_pixels;
extern byte *vid_screen;
extern int v_ui_height;
#define VID_WIDTH vid_width
#define VID_HEIGHT vid_height

/* Anchor original artwork within the expanded viewport. */
enum { V_UI_CENTER, V_UI_BOTTOM, V_UI_TOP };
extern int v_ui_anchor;

/* Four indexed artwork layers: low byte = color, upper bits = paint order. */
enum { V_UI_BORDER = 3, V_UI_LAYERS };
extern uint32_t v_overlay[V_UI_LAYERS][320 * 200];
/* Artwork rectangle, status-side coverage, and pixel aspect for composition. */
typedef struct {
    int x, y, width, height, status_sides, square_pixels;
} v_overlay_layout_t;
extern v_overlay_layout_t v_overlay_layout;
/* Clear logical coverage and paint order before an accelerated frame. */
void V_BeginOverlay(void);

/* Original tiled backdrop shared by software and accelerated composition. */
byte *V_BackgroundFlat(void);

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
