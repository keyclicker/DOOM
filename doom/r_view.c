/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdint.h>
#include "doomstat.h"
#include "r_view.h"
#include "r_interp.h"
#include "r_gpu.h"
#include "v_view.h"

/* Cache world coordinates while legacy UI code sees its original space. */
static int logical_width, logical_height, logical_x, logical_y;
static int render_width, render_height, render_x, render_y;
fixed_t projectiony;
int r_light_width = 320;

/* Report the logical view height to the artwork compositor. */
int R_LogicalHeight(void) { return logical_height; }

/* Expand horizontal field of view while retaining Doom's vertical framing. */
void R_SizeView(void)
{
    logical_width = scaledviewwidth;
    logical_height = viewheight;
    r_light_width = logical_width;
    scaledviewwidth = (vid_width * logical_width / 320) & ~1;
    viewheight = logical_height == 200 ? vid_height
        : logical_height * (vid_height - 32 * v_ui_height / 200) / 168;
}

/* Scale projection by resolution, independently of display aspect ratio. */
fixed_t R_Projection(void)
{
    fixed_t horizontal = (int64_t)logical_width * vid_height * FRACUNIT
        / (vid_square_pixels ? 480 : 400) >> detailshift;
    projectiony = R_VerticalScale(horizontal);
    return horizontal;
}

/* Correct vertical projection once, keeping legacy fixed modes unchanged. */
fixed_t R_VerticalScale(fixed_t scale)
{
    return vid_square_pixels ? (int64_t)scale * 6 / 5 : scale;
}

/* Texture stepping is the reciprocal of the corrected vertical scale. */
fixed_t R_VerticalInverse(fixed_t scale)
{
    return vid_square_pixels ? (int64_t)scale * 5 / 6 : scale;
}

/* Point columns at the selected framebuffer without changing the UI buffer. */
void R_InitViewBuffer(int width, int height, byte **rows, int *columns)
{
    int i;
    byte *target = vid_width == 320 && vid_height == 200 && !vid_square_pixels
        ? screens[0] : vid_screen;
    viewwindowx = (vid_width - width) / 2;
    viewwindowy = width == vid_width ? 0
        : (vid_height - 32 * v_ui_height / 200 - height) / 2;
    for (i = 0; i < width; i++) columns[i] = viewwindowx + i;
    for (i = 0; i < height; i++)
        rows[i] = target + (i + viewwindowy) * vid_width;
}

/* Expose original coordinates to the status bar, menus, and border code. */
void R_SaveView(void)
{
    render_width = scaledviewwidth;
    render_height = viewheight;
    render_x = viewwindowx;
    render_y = viewwindowy;
    scaledviewwidth = logical_width;
    viewwidth = logical_width >> detailshift;
    viewheight = logical_height;
    viewwindowx = logical_x = (320 - logical_width) / 2;
    viewwindowy = logical_y = logical_width == 320 ? 0
        : (168 - logical_height) / 2;
}

/* Render the world, then restore logical pixels for wipes and UI erasing. */
void R_RenderView(player_t *player)
{
    int x, y;
    scaledviewwidth = render_width;
    viewwidth = render_width >> detailshift;
    viewheight = render_height;
    viewwindowx = render_x;
    viewwindowy = render_y;
    R_RenderInterpolatedView(player);
    R_SaveView();
    if (r_hardware_frame) return;
    /* Preserve a logical view for wipes and the original background eraser. */
    if (vid_width != 320 || vid_height != 200 || vid_square_pixels) {
        for (y = 0; y < logical_height; y++)
            for (x = 0; x < logical_width; x++)
                screens[0][(y + logical_y) * 320 + x + logical_x] =
                    vid_screen[(render_y + y * render_height / logical_height)
                        * vid_width + render_x
                        + x * render_width / logical_width];
    }
}
