/* Software video extensions. SPDX-License-Identifier: GPL-2.0-only */
#ifndef WEB_RENDER_H
#define WEB_RENDER_H

#include <stdint.h>
#include "r_local.h"
#include "d_player.h"

/* The world uses a variable buffer; game logic and UI retain 320x200. */
extern int web_width, web_height, web_light_width;
/* Anchor native artwork independently of the expanded world viewport. */
enum { WEB_UI_CENTER, WEB_UI_BOTTOM, WEB_UI_TOP };
extern int web_ui_anchor;
extern byte *web_screen;
extern unsigned int *web_rgba;
#define WEB_WIDTH web_width
#define WEB_HEIGHT web_height
#define WEB_LIGHT_WIDTH web_light_width
#define WEB_LIGHT_SCALE(x) ((int)((int64_t)(x) * 200 / web_height))

/* Native buffers use square pixels; fixed modes retain the CRT pixel ratio. */
extern fixed_t web_yprojection;
extern int web_square_pixels;
fixed_t Web_VerticalScale(fixed_t scale);
fixed_t Web_VerticalInverse(fixed_t scale);

/* Configure cached projection tables, then restore logical UI coordinates. */
void Web_SizeView(void);
void Web_SaveView(void);
fixed_t Web_Projection(void);
void Web_InitBuffer(int width, int height, byte **rows, int *columns);
void Web_RenderView(player_t *player);

/* Composite legacy patches and copied spans into the variable framebuffer. */
void Web_DrawPatch(int x, int y, patch_t *patch, int flipped);
void Web_CopyPixels(int offset, int count);
void Web_CopyBorder(int offset, int count);
void Web_BlitScreen(void);
void Web_FillStatusSides(void);

/* Snapshot only render state; interpolation never advances game simulation. */
void Web_ResetInterpolation(void);
void Web_Snapshot(void);
void Web_SnapObject(mobj_t *object);
void Web_InterpolateCamera(player_t *player);
void Web_SetFraction(int fraction);

#endif
