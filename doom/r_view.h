/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef R_VIEW_H
#define R_VIEW_H
#include "r_local.h"
#include "v_view.h"

/* Projection and lighting retain the original 320x200 reference scale. */
extern fixed_t projectiony;
extern int r_light_width;
#define R_LIGHT_WIDTH r_light_width
#define R_LIGHT_SCALE(x) ((int)((int64_t)(x) * 200 / vid_height))

/* Fit the world viewport and cache its projection independently of UI. */
void R_SizeView(void);
void R_SaveView(void);
fixed_t R_Projection(void);
fixed_t R_VerticalScale(fixed_t scale);
fixed_t R_VerticalInverse(fixed_t scale);
void R_InitViewBuffer(int width, int height, byte **rows, int *columns);
void R_RenderView(player_t *player);
/* Return the legacy view height used by the status bar and wipes. */
int R_LogicalHeight(void);

#endif
