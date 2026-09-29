/* Browser platform for Linux Doom. SPDX-License-Identifier: GPL-2.0-only */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "doomstat.h"
#include "d_main.h"
#include "d_net.h"
#include "d_event.h"
#include "g_game.h"
#include "i_system.h"
#include "i_video.h"
#include "i_sound.h"
#include "m_argv.h"
#include "m_menu.h"
#include "m_misc.h"
#include "r_local.h"
#include "s_sound.h"
#include "v_video.h"
#include "w_wad.h"
#include "z_zone.h"
#include "f_wipe.h"
#include <emscripten.h>

/* Pixels are expanded once per frame, using a palette lookup table. */
static unsigned int rgba[SCREENWIDTH * SCREENHEIGHT];
static unsigned int colors[256];
static byte palette[768];
static int wiping;
static ticcmd_t emptycmd;

void D_ProcessEvents(void);
void D_DoAdvanceDemo(void);
void D_Display(void);
extern boolean advancedemo;

/* Keep browser-specific calls at the platform boundary. */
EM_JS(void, browser_quit, (), { Doom.quit(); });
EM_JS(int, browser_sound, (int id, int ptr, int length,
                          int volume, int separation, int pitch), {
    return Doom.audio.sound(id, HEAPU8.subarray(ptr, ptr + length),
                            volume, separation, pitch);
});
EM_JS(int, browser_channel, (int command, int handle, int vol,
                            int sep, int pitch), {
    return Doom.audio.channel(command, handle, vol, sep, pitch);
});

/* The browser schedules exactly 35 game tics per second. */
EMSCRIPTEN_KEEPALIVE void web_tick(void)
{
    if (wiping) {
        wiping = !wipe_ScreenWipe(wipe_Melt, 0, 0, 320, 200, 1);
        M_Drawer();
        I_FinishUpdate();
        return;
    }

    D_ProcessEvents();
    G_BuildTiccmd(&netcmds[consoleplayer][maketic % BACKUPTICS]);
    if (advancedemo)
        D_DoAdvanceDemo();
    M_Ticker();
    G_Ticker();
    gametic++;
    maketic++;
    S_UpdateSounds(players[consoleplayer].mo);
    D_Display();
}

/* Suspend gameplay during the original melt transition, without spinning. */
void Web_BeginWipe(void) { wiping = 1; }

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
EMSCRIPTEN_KEEPALIVE unsigned int *web_pixels(void) { return rgba; }

/* Return state for input capture, diagnostics, and renderer selection. */
EMSCRIPTEN_KEEPALIVE int web_state(void)
{
    return gamestate | (menuactive << 4) | (paused << 5)
        | (demoplayback << 6) | (wiping << 7);
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
    for (i = 0; i < 64000; i++)
        rgba[i] = colors[screens[0][i]];
}

/* Allocate a modest zone; the original 6 MiB is tight for larger IWADs. */
byte *I_ZoneBase(int *size)
{
    *size = 16 * 1024 * 1024;
    return malloc(*size);
}
int I_GetTime(void) { return gametic; }
ticcmd_t *I_BaseTiccmd(void) { return &emptycmd; }
byte *I_AllocLow(int size) { return calloc(1, size); }
void I_Init(void) { I_InitSound(); }
void I_WaitVBL(int count) {}
void I_BeginRead(void) {}
void I_EndRead(void) {}
void I_Tactile(int on, int off, int total) {}
void I_Quit(void) { M_SaveDefaults(); browser_quit(); }

/* Surface engine errors through the loader instead of trapping silently. */
void I_Error(char *format, ...)
{
    char message[1024];
    va_list args;
    va_start(args, format);
    vsnprintf(message, sizeof(message), format, args);
    va_end(args);
    EM_ASM({ throw new Error(UTF8ToString($0)); }, message);
    abort();
}

/* Single-player transport: retain Doom's tic command and demo machinery. */
void I_InitNetwork(void)
{
    doomcom = calloc(1, sizeof(*doomcom));
    doomcom->id = DOOMCOM_ID;
    doomcom->ticdup = 1;
    doomcom->numplayers = doomcom->numnodes = 1;
    netgame = false;
}
void I_NetCmd(void) { I_Error("Network play is not available"); }

/* Web Audio owns sample playback; Doom still selects and spatializes sounds. */
void I_InitSound(void) {}
void I_ShutdownSound(void) {}
void I_UpdateSound(void) {}
void I_SubmitSound(void) {}
void I_SetChannels(void) {}
int I_GetSfxLumpNum(sfxinfo_t *sfx)
{
    char name[9];
    snprintf(name, sizeof(name), "ds%s", sfx->name);
    return W_GetNumForName(name);
}
int I_StartSound(int id, int vol, int sep, int pitch, int priority)
{
    sfxinfo_t *sfx = &S_sfx[id];
    int lump = I_GetSfxLumpNum(sfx->link ? sfx->link : sfx);
    byte *data = W_CacheLumpNum(lump, PU_CACHE);
    return browser_sound(id, (int)data, W_LumpLength(lump), vol, sep, pitch);
}
void I_StopSound(int handle) { browser_channel(0, handle, 0, 0, 0); }
int I_SoundIsPlaying(int handle)
{
    return browser_channel(1, handle, 0, 0, 0);
}
void I_UpdateSoundParams(int handle, int vol, int sep, int pitch)
{
    browser_channel(2, handle, vol, sep, pitch);
}

/* Linux Doom 1.10 has no music backend. Preserve that in the minimal port. */
void I_InitMusic(void) {}
void I_ShutdownMusic(void) {}
void I_SetMusicVolume(int volume) {}
void I_PauseSong(int handle) {}
void I_ResumeSong(int handle) {}
int I_RegisterSong(void *data) { return 1; }
void I_PlaySong(int handle, int looping) {}
void I_StopSong(int handle) {}
void I_UnRegisterSong(int handle) {}
