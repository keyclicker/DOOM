/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdio.h>
#include "doomstat.h"
#include "i_system.h"
#include "i_sound.h"
#include "s_sound.h"
#include "w_wad.h"
#include "z_zone.h"
#include <emscripten.h>

EM_JS(int, browser_sound, (int id, int ptr, int length,
                          int volume, int separation, int pitch), {
    return Doom.audio.sound(id, HEAPU8.subarray(ptr, ptr + length),
                            volume, separation, pitch);
});
EM_JS(int, browser_channel, (int command, int handle, int vol,
                            int sep, int pitch), {
    return Doom.audio.channel(command, handle, vol, sep, pitch);
});

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

/* The audio worklet owns music timing; game tics only send control messages. */
static void *song;
static int song_length;
EM_JS(void, browser_music, (int command, int value, int length), {
    if (command === 0) {
        Doom.audio.song('bank', HEAPU8.slice(value, value + length));
    } else if (command === 1) Doom.audio.song('volume', value);
    else if (command === 2) Doom.audio.song('pause', value);
    else Doom.audio.song('stop');
});
EM_JS(void, browser_play_song, (int ptr, int length, int looping), {
    Doom.audio.song('play', HEAPU8.slice(ptr, ptr + length), !!looping);
});

/* Initialization is deferred until Doom registers its first music lump. */
void I_InitMusic(void) {}
void I_ShutdownMusic(void) { browser_music(3, 0, 0); }
void I_SetMusicVolume(int volume) { browser_music(1, volume, 0); }
void I_PauseSong(int handle) { browser_music(2, 1, 0); }
void I_ResumeSong(int handle) { browser_music(2, 0, 0); }

/* Resolve the lump length through the engine's registered music entry. */
int I_RegisterSong(void *data)
{
    static int bank_loaded;
    int i;
    if (!bank_loaded) {
        int lump = W_GetNumForName("GENMIDI");
        if (W_LumpLength(lump) < 6308) I_Error("Invalid GENMIDI bank");
        browser_music(0, (int)W_CacheLumpNum(lump, PU_CACHE), 6308);
        bank_loaded = 1;
    }
    for (i = 1; i < NUMMUSIC; i++) {
        if (S_music[i].data == data) {
            song = data;
            song_length = W_LumpLength(S_music[i].lumpnum);
            return 1;
        }
    }
    I_Error("Unregistered music lump");
    return 0;
}
void I_PlaySong(int handle, int looping)
{
    browser_play_song((int)song, song_length, looping);
}
void I_StopSong(int handle) { browser_music(3, 0, 0); }
void I_UnRegisterSong(int handle) { song = NULL; song_length = 0; }
