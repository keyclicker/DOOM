/* Variable-resolution software video. SPDX-License-Identifier: GPL-2.0-only */
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "doomstat.h"
#include "i_system.h"
#include "m_swap.h"
#include "p_local.h"
#include "r_state.h"
#include "v_video.h"
#include "render.h"
#include <emscripten.h>

/* Allocate pixels only for the selected mode; the default uses screens[0]. */
int web_width = 320, web_height = 200, web_scale = 1;
int web_light_width = 320;
int web_ui_anchor;
byte *web_screen;
unsigned int *web_rgba;

/* Keep UI geometry separate from the cached world projection. */
static int logical_width, logical_height, logical_x, logical_y;
static int render_width, render_height, render_x, render_y;
static int ui_width = 320, ui_height = 200, ui_x, ui_y;
static int fraction = FRACUNIT;
extern int screenblocks, detailLevel;

/* Fail cleanly instead of publishing an invalid framebuffer pointer. */
static void *resize_buffer(void *pointer, size_t size)
{
    void *result = realloc(pointer, size);
    if (!result) I_Error("Not enough memory for video buffers");
    return result;
}

/* Apply bounded dimensions between frames, preserving all gameplay state. */
EMSCRIPTEN_KEEPALIVE void web_video(int width, int scale)
{
    if (scale < 1 || scale > 4 || width < 16 || width > R_MAXWIDTH)
        return;
    width &= ~1;
    web_width = width;
    web_scale = scale;
    web_height = 200 * scale;
    web_screen = resize_buffer(web_screen, width * web_height);
    web_rgba = resize_buffer(web_rgba, width * web_height * 4);
    memset(web_screen, 0, width * web_height);
    ui_width = width < 320 * scale ? width : 320 * scale;
    ui_height = ui_width * 200 / 320;
    ui_x = (width - ui_width) / 2;
    ui_y = (web_height - ui_height) / 2;
    Web_BlitScreen();
    R_SetViewSize(screenblocks, detailLevel);
}

/* Expand horizontal field of view while retaining Doom's vertical framing. */
void Web_SizeView(void)
{
    logical_width = scaledviewwidth;
    logical_height = viewheight;
    web_light_width = logical_width;
    scaledviewwidth = (web_width * logical_width / 320) & ~1;
    viewheight = logical_height == 200 ? web_height
        : logical_height * (web_height - 32 * ui_height / 200) / 168;
}

/* Scale projection by resolution, independently of browser aspect ratio. */
fixed_t Web_Projection(void)
{
    return (logical_width * web_scale >> detailshift) * FRACUNIT / 2;
}

/* Point columns at the selected framebuffer without changing the UI buffer. */
void Web_InitBuffer(int width, int height, byte **rows, int *columns)
{
    int i;
    byte *target = web_width == 320 && web_height == 200
        ? screens[0] : web_screen;
    viewwindowx = (web_width - width) / 2;
    viewwindowy = width == web_width ? 0
        : (web_height - 32 * ui_height / 200 - height) / 2;
    for (i = 0; i < width; i++) columns[i] = viewwindowx + i;
    for (i = 0; i < height; i++)
        rows[i] = target + (i + viewwindowy) * web_width;
}

/* Expose original coordinates to the status bar, menus, and border code. */
void Web_SaveView(void)
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

/* Paint one logical pixel without filtering original artwork. */
static void ui_pixel(int x, int y, byte color)
{
    int left, right, top, bottom, row;
    if ((unsigned)x >= 320 || (unsigned)y >= 200) return;
    left = ui_x + x * ui_width / 320;
    right = ui_x + (x + 1) * ui_width / 320;
    row = web_ui_anchor == WEB_UI_BOTTOM ? web_height - ui_height
        : web_ui_anchor == WEB_UI_TOP ? 0 : ui_y;
    top = row + y * ui_height / 200;
    bottom = row + (y + 1) * ui_height / 200;
    for (row = top; row < bottom; row++)
        memset(web_screen + row * web_width + left, color, right - left);
}

/* Preserve patch transparency over high-resolution world pixels. */
void Web_DrawPatch(int x, int y, patch_t *patch, int flipped)
{
    int col, i, width;
    column_t *post;
    byte *source;
    if (!web_screen || (web_width == 320 && web_height == 200)) return;
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

/* Mirror copied status-bar and border spans after the logical buffer changes. */
void Web_CopyPixels(int offset, int count)
{
    int i;
    if (!web_screen || (web_width == 320 && web_height == 200)) return;
    for (i = offset; i < offset + count && i < 64000; i++)
        if (i >= 0) ui_pixel(i % 320, i / 320, screens[0][i]);
}

/* Let view borders span the window; HUD and menu art keep their own aspect. */
void Web_CopyBorder(int offset, int count)
{
    int i, x, y, left, right, row;
    if (!web_screen || (web_width == 320 && web_height == 200)) return;
    for (i = offset; i < offset + count && i < 64000; i++) {
        x = i % 320;
        y = i / 320;
        left = x * web_width / 320;
        right = (x + 1) * web_width / 320;
        for (row = y * (web_height - 32 * ui_height / 200) / 168;
             row < (y + 1) * (web_height - 32 * ui_height / 200) / 168
                && row < web_height; row++)
            memset(web_screen + row * web_width + left, screens[0][i],
                right - left);
    }
}

/* Full-screen art, automap, and the original melt retain their native pixels. */
void Web_BlitScreen(void)
{
    if (!web_screen || !screens[0]) return;
    memset(web_screen, 0, web_width * web_height);
    Web_CopyPixels(0, gamestate == GS_LEVEL && logical_height != 200
        ? 168 * 320 : 64000);
    if (gamestate == GS_LEVEL && logical_height != 200) {
        web_ui_anchor = WEB_UI_BOTTOM;
        Web_CopyPixels(168 * 320, 32 * 320);
        web_ui_anchor = WEB_UI_CENTER;
    }
}

/* Camera history lives outside player_t, retaining native save compatibility. */
static struct {
    int valid;
    mobj_t *object;
    fixed_t x, y, z;
    angle_t angle;
    pspdef_t weapon[NUMPSPRITES];
} camera;

/* Snapshot moving sectors without adding fields to serialized engine types. */
typedef struct {
    fixed_t floor, ceiling, current_floor, current_ceiling;
} sector_frame_t;
static sector_frame_t *sector_frames;
static int sector_capacity, sector_count;

/* Store both endpoints outside objects; the thinker list provides stable order. */
typedef struct {
    mobj_t *object;
    fixed_t x, y, z, current_x, current_y, current_z;
    angle_t angle, current_angle;
} object_frame_t;
static object_frame_t *object_frames;
static int object_count, object_capacity;

/* Discard pointers before a new level or save replaces the zone allocations. */
void Web_ResetInterpolation(void)
{
    camera.valid = 0;
    object_count = sector_count = 0;
}

/* Capture the last completed tic before simulation changes anything. */
void Web_Snapshot(void)
{
    int i;
    thinker_t *thinker;
    player_t *player = &players[displayplayer];
    mobj_t *object;
    Web_ResetInterpolation();
    if (gamestate != GS_LEVEL || !player->mo) return;
    camera.valid = 1;
    camera.object = player->mo;
    camera.x = player->mo->x;
    camera.y = player->mo->y;
    camera.z = player->viewz;
    camera.angle = player->mo->angle;
    memcpy(camera.weapon, player->psprites, sizeof(camera.weapon));
    if (numsectors > sector_capacity) {
        sector_capacity = numsectors;
        sector_frames = resize_buffer(sector_frames,
            sector_capacity * sizeof(*sector_frames));
    }
    sector_count = numsectors;
    for (i = 0; i < sector_count; i++) {
        sector_frames[i].floor = sectors[i].floorheight;
        sector_frames[i].ceiling = sectors[i].ceilingheight;
    }
    for (thinker = thinkercap.next; thinker != &thinkercap;
         thinker = thinker->next) {
        if (thinker->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        if (object_count == object_capacity) {
            object_capacity = object_capacity ? object_capacity * 2 : 256;
            object_frames = resize_buffer(object_frames,
                object_capacity * sizeof(*object_frames));
        }
        object = (mobj_t *)thinker;
        object_frames[object_count++] = (object_frame_t){
            object, object->x, object->y, object->z, 0, 0, 0, object->angle, 0};
    }
}

/* Reset both endpoints at teleport destinations, even for short teleports. */
void Web_SnapObject(mobj_t *object)
{
    int i;
    for (i = 0; i < object_count; i++) {
        if (object_frames[i].object != object) continue;
        object_frames[i].x = object->x;
        object_frames[i].y = object->y;
        object_frames[i].z = object->z;
        object_frames[i].angle = object->angle;
        break;
    }
    if (camera.object == object) camera.valid = 0;
}

/* Use 64-bit differences for large maps and shortest-path angular motion. */
static fixed_t blend(fixed_t previous, fixed_t current)
{
    return previous + ((int64_t)current - previous) * fraction / FRACUNIT;
}

/* Snap teleports instead of interpolating through walls. */
static int continuous(fixed_t x, fixed_t y, fixed_t next_x, fixed_t next_y)
{
    return llabs((int64_t)next_x - x) < 128 * FRACUNIT
        && llabs((int64_t)next_y - y) < 128 * FRACUNIT;
}

/* Interpolate only the renderer's camera, never the player's simulation data. */
void Web_InterpolateCamera(player_t *player)
{
    if (fraction == FRACUNIT || !camera.valid || paused
        || camera.object != player->mo
        || !continuous(camera.x, camera.y, viewx, viewy)) return;
    viewx = blend(camera.x, viewx);
    viewy = blend(camera.y, viewy);
    viewz = blend(camera.z, viewz);
    viewangle = camera.angle + viewangleoffset
        + (int64_t)(int32_t)(player->mo->angle - camera.angle)
        * fraction / FRACUNIT;
}

/* Select the fraction of the 35 Hz interval to present on this display frame. */
void Web_SetFraction(int value)
{
    fraction = value < 0 ? 0 : value > FRACUNIT ? FRACUNIT : value;
}

/* Temporarily interpolate render inputs, then restore them before any tic. */
void Web_RenderView(player_t *player)
{
    int i, x, y, j = 0, interpolate;
    thinker_t *thinker;
    mobj_t *object;
    object_frame_t *frame;
    pspdef_t weapons[NUMPSPRITES];
    interpolate = fraction != FRACUNIT && camera.valid && !paused;
    scaledviewwidth = render_width;
    viewwidth = render_width >> detailshift;
    viewheight = render_height;
    viewwindowx = render_x;
    viewwindowy = render_y;
    if (interpolate) {
        for (i = 0; i < sector_count; i++) {
            sector_frames[i].current_floor = sectors[i].floorheight;
            sector_frames[i].current_ceiling = sectors[i].ceilingheight;
            sectors[i].floorheight = blend(sector_frames[i].floor,
                sectors[i].floorheight);
            sectors[i].ceilingheight = blend(sector_frames[i].ceiling,
                sectors[i].ceilingheight);
        }
        /* Removed thinkers remain until the following tic. New ones append. */
        for (thinker = thinkercap.next; thinker != &thinkercap;
             thinker = thinker->next) {
            if (j == object_count) break;
            frame = &object_frames[j];
            if ((void *)thinker != (void *)frame->object) continue;
            j++;
            object = frame->object;
            frame->current_x = object->x;
            frame->current_y = object->y;
            frame->current_z = object->z;
            frame->current_angle = object->angle;
            if (object == player->mo
                || !continuous(frame->x, frame->y, object->x, object->y))
                continue;
            object->x = blend(frame->x, object->x);
            object->y = blend(frame->y, object->y);
            object->z = blend(frame->z, object->z);
            object->angle = frame->angle
                + (int64_t)(int32_t)(object->angle - frame->angle)
                * fraction / FRACUNIT;
        }
        memcpy(weapons, player->psprites, sizeof(weapons));
        for (i = 0; i < NUMPSPRITES; i++) {
            /* Discrete firing/raising states must not smear across frames. */
            if (weapons[i].state != camera.weapon[i].state) continue;
            player->psprites[i].sx = blend(camera.weapon[i].sx, weapons[i].sx);
            player->psprites[i].sy = blend(camera.weapon[i].sy, weapons[i].sy);
        }
    }
    R_RenderPlayerView(player);
    if (interpolate) {
        for (i = 0; i < sector_count; i++) {
            sectors[i].floorheight = sector_frames[i].current_floor;
            sectors[i].ceilingheight = sector_frames[i].current_ceiling;
        }
        for (i = 0; i < j; i++) {
            frame = &object_frames[i];
            object = frame->object;
            object->x = frame->current_x;
            object->y = frame->current_y;
            object->z = frame->current_z;
            object->angle = frame->current_angle;
        }
        memcpy(player->psprites, weapons, sizeof(weapons));
    }
    Web_SaveView();
    /* Preserve a logical view for wipes and the original background eraser. */
    if (web_width != 320 || web_height != 200) {
        for (y = 0; y < logical_height; y++)
            for (x = 0; x < logical_width; x++)
                screens[0][(y + logical_y) * 320 + x + logical_x] =
                    web_screen[(render_y + y * render_height / logical_height)
                        * web_width + render_x
                        + x * render_width / logical_width];
    }
}
