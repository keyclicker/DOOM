/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include "doomstat.h"
#include "i_system.h"
#include "i_sound.h"
#include "m_misc.h"
#include <emscripten.h>

static ticcmd_t emptycmd;

/* The host applies changed settings after input processing returns. */
EM_JS(void, browser_settings_changed, (), { Settings.dirty = true; });
void I_SettingsChanged(void) { browser_settings_changed(); }

/* Release browser input capture and stop its frame scheduler. */
EM_JS(void, browser_quit, (), { Doom.quit(); });

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
