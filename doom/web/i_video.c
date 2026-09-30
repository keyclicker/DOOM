/* SPDX-License-Identifier: GPL-2.0-only */
#include <string.h>
#include "doomstat.h"
#ifdef HARDWARE_RENDER
#include "r_gpu.h"
#endif
#include "d_main.h"
#include "d_frame.h"
#include "i_video.h"
#include "m_misc.h"
#include "v_video.h"
#include "v_view.h"
#include <emscripten.h>

/* Only the platform converts indexed Doom pixels to packed browser RGBA. */
static unsigned int colors[256];
static byte palette[768];
static unsigned int *web_rgba;

/* Apply dimensions between frames, after validating the shared video mode. */
EMSCRIPTEN_KEEPALIVE void web_video(int width, int height, int native)
{
    if (V_SetMode(width, height, native))
        web_rgba = M_Realloc(web_rgba, width * height * sizeof(*web_rgba));
}

/* Post the same events used by the original platform drivers. */
EMSCRIPTEN_KEEPALIVE void web_key(int key, int down)
{
    event_t event = {down ? ev_keydown : ev_keyup, key, 0, 0};
    D_PostEvent(&event);
}

/* Preserve the original mouse axes: turn horizontally, move vertically. */
EMSCRIPTEN_KEEPALIVE void web_mouse(int buttons, int x, int y)
{
    event_t event = {ev_mouse, buttons, x * 4, -y * 4};
    D_PostEvent(&event);
}

/* Expose the packed RGBA framebuffer without copying it across the ABI. */
EMSCRIPTEN_KEEPALIVE unsigned int *web_pixels(void) { return web_rgba; }

/* Supply the exact current palette, including gamma, damage and pickups. */
EMSCRIPTEN_KEEPALIVE unsigned int *web_palette(void) { return colors; }
EMSCRIPTEN_KEEPALIVE int web_world(void)
{
    return r_hardware_frame && !d_wiping;
}

/* Browser video needs no OS resources. */
void I_InitGraphics(void) {}
void I_ShutdownGraphics(void) {}
void I_StartFrame(void) {}
void I_StartTic(void) {}
void I_UpdateNoBlit(void) {}
void I_ReadScreen(byte *dest) { memcpy(dest, screens[0], 64000); }

/* Apply the original gamma table, including damage and pickup palettes. */
void I_SetPalette(byte *source)
{
    int i;
    memcpy(palette, source, sizeof(palette));
    for (i = 0; i < 256; i++)
        colors[i] = gammatable[usegamma][palette[i * 3]]
            | (gammatable[usegamma][palette[i * 3 + 1]] << 8)
            | (gammatable[usegamma][palette[i * 3 + 2]] << 16)
            | 0xff000000u;
}

/* The software renderer remains the default and produces exact Doom pixels. */
void I_FinishUpdate(void)
{
    int i;
    byte *source = screens[0];
    if (vid_width != 320 || vid_height != 200 || vid_square_pixels) {
        if (gamestate != GS_LEVEL || automapactive || d_wiping)
            V_BlitView();
        source = vid_screen;
    }
#ifdef HARDWARE_RENDER
    if (r_hardware_frame && !d_wiping) {
        source = vid_screen;
        for (i = 0; i < vid_width * vid_height; i++)
            web_rgba[i] = (colors[source[i]] & 0xffffffu)
                | ((unsigned int)vid_alpha[i] << 24);
        return;
    }
#endif
    for (i = 0; i < vid_width * vid_height; i++)
        web_rgba[i] = colors[source[i]];
}
