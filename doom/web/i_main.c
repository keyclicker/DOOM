/* SPDX-License-Identifier: GPL-2.0-only */
#include "doomstat.h"
#include "d_main.h"
#include "d_frame.h"
#include "m_argv.h"
#include "m_misc.h"
#include "m_settings.h"
#include "r_local.h"
#include <emscripten.h>

/* Preserve the browser ABI while the engine owns simulation and rendering. */
EMSCRIPTEN_KEEPALIVE void web_tick(void) { D_AdvanceFrame(1, 0); }
EMSCRIPTEN_KEEPALIVE void web_advance(void) { D_AdvanceFrame(0, 1); }
EMSCRIPTEN_KEEPALIVE void web_render(int fraction) { D_RenderFrame(fraction); }

/* Restore validated preferences before the first frame. */
EMSCRIPTEN_KEEPALIVE void web_settings(int scale, int aspect, int fps, int show)
{
    if (scale < 0 || scale > 6) return;
    m_resolution = scale;
    m_aspect = !!aspect;
    m_unlocked = !!fps;
    m_show_fps = !!show;
}

/* Read native settings after the menu changes them. */
EMSCRIPTEN_KEEPALIVE int web_setting(int index)
{
    switch (index) {
    case 0: return m_resolution;
    case 1: return m_aspect;
    case 2: return m_unlocked;
    case 3: return m_show_fps;
    default: return 0;
    }
}

/* Update the presentation counter without advancing game time. */
EMSCRIPTEN_KEEPALIVE void web_fps(int value) { m_fps_value = value; }

/* Restore native action codes; menu navigation stays independent. */
EMSCRIPTEN_KEEPALIVE void web_bind(int action, int key)
{
    int *binding = M_Binding(action);
    if (binding && key > 0 && key < 256) *binding = key;
}

/* Serialize numeric key codes without exposing engine pointers to JavaScript. */
EMSCRIPTEN_KEEPALIVE int web_binding(int action)
{
    int *binding = M_Binding(action);
    return binding ? *binding : 0;
}

/* Return state for input capture, diagnostics, and renderer selection. */
EMSCRIPTEN_KEEPALIVE int web_state(void)
{
    return gamestate | (menuactive << 4) | (paused << 5)
        | (demoplayback << 6) | (d_wiping << 7);
}

/* Persist preferences alongside the game's native save files. */
EMSCRIPTEN_KEEPALIVE void web_save_defaults(void) { M_SaveDefaults(); }

/* Initialize after JavaScript mounts the selected IWAD in MEMFS. */
EMSCRIPTEN_KEEPALIVE void web_init(void)
{
    static char *args[] = {"doom", "-config", "/.doomrc", NULL};
    myargc = 3;
    myargv = args;
    singletics = true;
    D_DoomMain();
    {
        extern int screenblocks, screenSize, detailLevel;
        screenblocks = 10;
        screenSize = 7;
        R_SetViewSize(screenblocks, detailLevel);
    }
}
