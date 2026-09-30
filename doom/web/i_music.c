/* SPDX-License-Identifier: GPL-2.0-only */
#include "s_opl.h"
#include <emscripten.h>

/* Access the 6308-byte GENMIDI bank buffer. */
EMSCRIPTEN_KEEPALIVE uint8_t *music_bank(void)
{
    return S_OPLBank();
}

/* Access the MUS score buffer (131072 bytes maximum). */
EMSCRIPTEN_KEEPALIVE uint8_t *music_score(void)
{
    return S_OPLScore();
}

/* Validate a loaded score and reset the synth at the requested sample rate. */
EMSCRIPTEN_KEEPALIVE int music_start(int length, int loop, int sample_rate)
{
    return S_OPLStart(length, loop, sample_rate);
}

/* Pause score time and release melodic keys, or resume playback. */
EMSCRIPTEN_KEEPALIVE void music_pause(int value)
{
    S_OPLPause(value);
}

/* Set the Doom menu volume (0 to 15). */
EMSCRIPTEN_KEEPALIVE void music_set_volume(int value)
{
    S_OPLSetVolume(value);
}

/* Stop score playback. */
EMSCRIPTEN_KEEPALIVE void music_stop(void)
{
    S_OPLStop();
}

/* Return playing (bit 0), paused (bit 1), or -1 for a malformed score. */
EMSCRIPTEN_KEEPALIVE int music_status(void)
{
    return S_OPLStatus();
}

/* Render 0 to 128 stereo frames into planar float buffers at offsets 0/128. */
EMSCRIPTEN_KEEPALIVE float *music_render(int count)
{
    return S_OPLRender(count);
}
