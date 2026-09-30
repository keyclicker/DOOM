/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef S_OPL_H
#define S_OPL_H
#include <stdint.h>

/* Access the 6308-byte GENMIDI bank buffer. */
uint8_t *S_OPLBank(void);
/* Access the MUS score buffer (131072 bytes maximum). */
uint8_t *S_OPLScore(void);
/* Validate a loaded score and reset the synth at the requested sample rate. */
int S_OPLStart(int length, int loop, int sample_rate);
/* Pause score time and release melodic keys, or resume playback. */
void S_OPLPause(int value);
/* Set the Doom menu volume (0 to 15). */
void S_OPLSetVolume(int value);
/* Stop score playback. */
void S_OPLStop(void);
/* Return playing (bit 0), paused (bit 1), or -1 for a malformed score. */
int S_OPLStatus(void);
/* Render 0 to 128 stereo frames into planar float buffers at offsets 0/128. */
float *S_OPLRender(int count);

#endif
