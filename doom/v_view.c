/* SPDX-License-Identifier: GPL-2.0-only */
#include <string.h>
#include "doomstat.h"
#include "m_misc.h"
#include "m_swap.h"
#include "r_view.h"
#include "v_view.h"
#include "w_wad.h"
#include "z_zone.h"

/* World pixels and artwork use independent dimensions. */
int vid_width = 320, vid_height = 200;
int vid_square_pixels, v_ui_anchor;
byte *vid_screen;
int v_ui_height = 200;
static int ui_width = 320, ui_x, ui_y;
extern int screenblocks, detailLevel;

/* Apply bounded dimensions between frames, preserving all gameplay state. */
boolean V_SetMode(int width, int height, int square_pixels)
{
    if (height < 16 || height > R_MAXHEIGHT || width < 16 || width > R_MAXWIDTH
        || (int64_t)width * height > 33554432)
        return false;
    vid_width = width;
    vid_height = height;
    vid_square_pixels = !!square_pixels;
    vid_screen = M_Realloc(vid_screen, width * vid_height);
    memset(vid_screen, 0, width * vid_height);
    ui_width = height * (vid_square_pixels ? 4 : 8) / (vid_square_pixels ? 3 : 5);
    if (ui_width > width) ui_width = width;
    v_ui_height = ui_width * (vid_square_pixels ? 3 : 5)
        / (vid_square_pixels ? 4 : 8);
    ui_x = (width - ui_width) / 2;
    ui_y = (vid_height - v_ui_height) / 2;
    V_BlitView();
    R_SetViewSize(screenblocks, detailLevel);
    return true;
}

/* Paint one logical pixel without filtering original artwork. */
static void ui_pixel(int x, int y, byte color)
{
    int left, right, top, bottom, row;
    if ((unsigned)x >= 320 || (unsigned)y >= 200) return;
    left = ui_x + x * ui_width / 320;
    right = ui_x + (x + 1) * ui_width / 320;
    row = v_ui_anchor == V_UI_BOTTOM ? vid_height - v_ui_height
        : v_ui_anchor == V_UI_TOP ? 0 : ui_y;
    top = row + y * v_ui_height / 200;
    bottom = row + (y + 1) * v_ui_height / 200;
    for (row = top; row < bottom; row++)
        memset(vid_screen + row * vid_width + left, color, right - left);
}

/* Preserve patch transparency over high-resolution world pixels. */
void V_DrawViewPatch(int x, int y, patch_t *patch, int flipped)
{
    int col, i, width;
    column_t *post;
    byte *source;
    if (!vid_screen || (vid_width == 320 && vid_height == 200
        && !vid_square_pixels)) return;
    x -= SHORT(patch->leftoffset);
    y -= SHORT(patch->topoffset);
    width = SHORT(patch->width);
    for (col = 0; col < width; col++) {
        i = flipped ? width - 1 - col : col;
        post = (column_t *)((byte *)patch + LONG(patch->columnofs[i]));
        while (post->topdelta != 255) {
            source = (byte *)post + 3;
            for (i = 0; i < post->length; i++)
                ui_pixel(x + col, y + post->topdelta + i, source[i]);
            post = (column_t *)((byte *)post + post->length + 4);
        }
    }
}

/* Sample the original skull at half size, preserving transparent pixels. */
void V_DrawHalfPatch(int x, int y, patch_t *patch)
{
    int col, i, px, py, source_y;
    byte color;
    column_t *post;
    x -= SHORT(patch->leftoffset) / 2;
    y -= SHORT(patch->topoffset) / 2;
    for (col = 0; col < SHORT(patch->width); col += 2) {
        px = x + col / 2;
        if ((unsigned)px >= 320) continue;
        post = (column_t *)((byte *)patch + LONG(patch->columnofs[col]));
        while (post->topdelta != 255) {
            for (i = post->topdelta & 1; i < post->length; i += 2) {
                source_y = post->topdelta + i;
                py = y + source_y / 2;
                if ((unsigned)py >= 200) continue;
                color = ((byte *)post)[3 + i];
                screens[0][py * 320 + px] = color;
                if (vid_screen) ui_pixel(px, py, color);
            }
            post = (column_t *)((byte *)post + post->length + 4);
        }
    }
}

/* Mirror copied status-bar and border spans after the logical buffer changes. */
void V_CopyViewPixels(int offset, int count)
{
    int i;
    if (!vid_screen || (vid_width == 320 && vid_height == 200
        && !vid_square_pixels)) return;
    for (i = offset; i < offset + count && i < 64000; i++)
        if (i >= 0) ui_pixel(i % 320, i / 320, screens[0][i]);
}

/* Let view borders span the window; HUD and menu art keep their own aspect. */
void V_CopyViewBorder(int offset, int count)
{
    int i, x, y, left, right, row;
    if (!vid_screen || (vid_width == 320 && vid_height == 200
        && !vid_square_pixels)) return;
    for (i = offset; i < offset + count && i < 64000; i++) {
        x = i % 320;
        y = i / 320;
        left = x * vid_width / 320;
        right = (x + 1) * vid_width / 320;
        for (row = y * (vid_height - 32 * v_ui_height / 200) / 168;
             row < (y + 1) * (vid_height - 32 * v_ui_height / 200) / 168
                && row < vid_height; row++)
            memset(vid_screen + row * vid_width + left, screens[0][i],
                right - left);
    }
}

/* Tile the original backdrop beside the centered status bar on wide views. */
void V_FillStatusSides(void)
{
    int x, y, first;
    byte *flat;
    if (!vid_screen || !ui_x || R_LogicalHeight() == 200) return;
    flat = W_CacheLumpName(gamemode == commercial ? "GRNROCK" : "FLOOR7_2",
        PU_CACHE);
    first = vid_height - 32 * v_ui_height / 200;
    for (y = first; y < vid_height; y++) {
        for (x = 0; x < vid_width; x++) {
            if (x >= ui_x && x < ui_x + ui_width) continue;
            vid_screen[y * vid_width + x] =
                flat[((y * 200 / vid_height) & 63) * 64
                    + ((x * (vid_square_pixels ? 240 : 200) / vid_height) & 63)];
        }
    }
}

/* Full-screen art, automap, and the original melt retain their native pixels. */
void V_BlitView(void)
{
    if (!vid_screen || !screens[0]) return;
    memset(vid_screen, 0, vid_width * vid_height);
    V_CopyViewPixels(0, gamestate == GS_LEVEL && R_LogicalHeight() != 200
        ? 168 * 320 : 64000);
    if (gamestate == GS_LEVEL && R_LogicalHeight() != 200) {
        V_FillStatusSides();
        v_ui_anchor = V_UI_BOTTOM;
        V_CopyViewPixels(168 * 320, 32 * 320);
        v_ui_anchor = V_UI_CENTER;
    }
}
