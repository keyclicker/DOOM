/* GPU submission boundary. SPDX-License-Identifier: GPL-2.0-only */
#ifndef I_RENDER_H
#define I_RENDER_H
#include "doomtype.h"

/* World position/UVs, material/light, sprite floor and one-based sector ID.
 * Zero sector marks walls, ceilings and weapon artwork.
 */
typedef struct {
    float x, y, z, u, v, material, light, floor, sector;
} render_vertex_t;

/* Float-only camera packet keeps the host ABI independent of engine structs. */
typedef struct {
    float x, y, z, yaw, pitch;
    float focal_x, focal_y;
    float viewport_x, viewport_y, width, height;
    float colormap, time, sky;
} render_camera_t;

/* Copy an indexed/coverage texture into the backend's material cache. */
void I_RenderTexture(int id, int width, int height, const byte *pixels);
/* Submit world, solid-wall silhouettes, sprites, shadows, then weapons. */
void I_RenderWorld(const render_vertex_t *vertices, int count, int occluders,
    int sprites, int shadows, int weapons, const render_camera_t *camera);
/* Capture the last presented frame only when a classic melt needs it. */
void I_RenderCapture(byte *pixels);
#endif
