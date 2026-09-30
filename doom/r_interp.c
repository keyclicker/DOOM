/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "doomstat.h"
#include "r_gpu.h"
#include "m_misc.h"
#include "p_local.h"
#include "r_local.h"
#include "r_interp.h"


static int fraction = FRACUNIT;

/* Camera history lives outside player_t, retaining native save compatibility. */
static struct {
    int valid;
    mobj_t *object;
    fixed_t x, y, z;
    angle_t angle;
    float pitch;
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
void R_ResetInterpolation(void)
{
    camera.valid = 0;
    object_count = sector_count = 0;
}

/* Capture the last completed tic before simulation changes anything. */
void R_Snapshot(void)
{
    int i;
    thinker_t *thinker;
    player_t *player = &players[displayplayer];
    mobj_t *object;
    R_ResetInterpolation();
    if (gamestate != GS_LEVEL || !player->mo) return;
    camera.valid = 1;
    camera.object = player->mo;
    camera.x = player->mo->x;
    camera.y = player->mo->y;
    camera.z = player->viewz;
    camera.angle = player->mo->angle;
    camera.pitch = r_pitch;
    memcpy(camera.weapon, player->psprites, sizeof(camera.weapon));
    if (numsectors > sector_capacity) {
        sector_capacity = numsectors;
        sector_frames = M_Realloc(sector_frames,
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
            object_frames = M_Realloc(object_frames,
                object_capacity * sizeof(*object_frames));
        }
        object = (mobj_t *)thinker;
        object_frames[object_count++] = (object_frame_t){
            object, object->x, object->y, object->z, 0, 0, 0, object->angle, 0};
    }
}

/* Reset both endpoints at teleport destinations, even for short teleports. */
void R_SnapObject(mobj_t *object)
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
void R_InterpolateCamera(player_t *player)
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

/* Pitch shares the camera's snapshot and resets with map/renderer changes. */
float R_InterpolatePitch(float pitch)
{
    return camera.valid && !paused
        ? camera.pitch + (pitch - camera.pitch) * fraction / FRACUNIT : pitch;
}

/* Select the fraction of the 35 Hz interval to present on this display frame. */
void R_SetFraction(int value)
{
    fraction = value < 0 ? 0 : value > FRACUNIT ? FRACUNIT : value;
}

/* Temporarily interpolate render inputs, then restore them before any tic. */
void R_RenderInterpolatedView(player_t *player)
{
    int i, j = 0, interpolate;
    thinker_t *thinker;
    mobj_t *object;
    object_frame_t *frame;
    pspdef_t weapons[NUMPSPRITES];
    interpolate = fraction != FRACUNIT && camera.valid && !paused;
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
    if (r_hardware_frame) R_RenderGeometry(player);
    else
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
}
