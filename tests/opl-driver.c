/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#ifdef OPL_REFERENCE
#include "opl3.h"
#else
#include "lib/nuked-opl3/opl3.h"
#endif

/* Capture ordered writes from either driver without changing the emulator. */
static uint32_t trace[65536];
static int trace_count;
static void trace_write(opl3_chip *chip, uint16_t address, uint8_t value)
{
    if (trace_count == 65536) abort();
    trace[trace_count++] = (address << 8) | value;
    OPL3_WriteRegBuffered(chip, address, value);
}

/* JS drains the trace after each group of simultaneous music events. */
EMSCRIPTEN_KEEPALIVE uint32_t *test_trace(void) { return trace; }
EMSCRIPTEN_KEEPALIVE int test_count(void)
{
    int count = trace_count;
    trace_count = 0;
    return count;
}

#ifdef OPL_REFERENCE
/* Compile the actual upstream driver; unused OS/MIDI-file code is discarded. */
#include "i_oplmusic.c"
#include "opl-init.inc"
static opl3_chip reference_chip;
static uint8_t bank[6308];
static float output[256];

/* Replace only the hardware transport; use Chocolate Doom's own chip code. */
void OPL_WriteRegister(int address, int value)
{
    trace_write(&reference_chip, address, value);
}

/* Pausing callbacks belongs to the test scheduler, not the OPL emulator. */
void OPL_SetPaused(int paused) { (void) paused; }

/* Expose upstream instrument memory without a WAD filesystem dependency. */
EMSCRIPTEN_KEEPALIVE uint8_t *music_bank(void) { return bank; }

/* Reset a reference instance to Chocolate Doom's default Doom 1.9 OPL2. */
EMSCRIPTEN_KEEPALIVE void reference_init(int volume, int rate)
{
    OPL3_Reset(&reference_chip, rate);
    OPL_InitRegisters(0);
    main_instrs = (genmidi_instr_t *)(bank + 8);
    percussion_instrs = main_instrs + 128;
    num_opl_voices = 9;
    opl_drv_ver = opl_doom_1_9;
    opl_opl3mode = 0;
    current_music_volume = start_music_volume = volume * 8;
    music_initialized = 1;
    memset(voices, 0, sizeof(voices));
    InitVoices();
    for (int i = 0; i < 16; i++) InitChannel(&channels[i]);
}

/* Looping resets controllers while preserving the chip and active voices. */
EMSCRIPTEN_KEEPALIVE void reference_restart(void)
{
    start_music_volume = current_music_volume;
    for (int i = 0; i < 16; i++) InitChannel(&channels[i]);
}

/* Dispatch MIDI messages exactly where Chocolate Doom's scheduler does. */
EMSCRIPTEN_KEEPALIVE void reference_event(int type, int channel, int a, int b)
{
    midi_event_t event = {0};
    event.event_type = type;
    event.data.channel.channel = channel;
    event.data.channel.param1 = a;
    event.data.channel.param2 = b;
    switch (type) {
        case MIDI_EVENT_NOTE_ON: KeyOnEvent(NULL, &event); break;
        case MIDI_EVENT_NOTE_OFF: KeyOffEvent(NULL, &event); break;
        case MIDI_EVENT_PROGRAM_CHANGE: ProgramChangeEvent(NULL, &event); break;
        case MIDI_EVENT_CONTROLLER: ControllerEvent(NULL, &event); break;
        case MIDI_EVENT_PITCH_BEND: PitchBendEvent(NULL, &event); break;
        default: abort();
    }
}

/* Exercise the upstream volume and pause implementations unchanged. */
EMSCRIPTEN_KEEPALIVE void music_set_volume(int volume)
{
    I_OPL_SetMusicVolume(volume * 8);
}
EMSCRIPTEN_KEEPALIVE void music_pause(int paused)
{
    if (paused) I_OPL_PauseSong();
    else I_OPL_ResumeSong();
}

/* Match the port's planar float ABI for sample-by-sample comparisons. */
EMSCRIPTEN_KEEPALIVE float *music_render(int count)
{
    int16_t sample[2];
    for (int i = 0; i < count; i++) {
        OPL3_GenerateResampled(&reference_chip, sample);
        output[i] = sample[0] / 32768.0f;
        output[128 + i] = sample[1] / 32768.0f;
    }
    return output;
}
#else
/* Instrument the real port, including its MUS parser and voice lifecycle. */
#define OPL3_WriteRegBuffered trace_write
#include "s_opl.c"
#include "i_music.c"
#endif

#ifndef OPL_REFERENCE
/* Inspect complete scores without spending CPU synthesizing their silence. */
EMSCRIPTEN_KEEPALIVE void test_events(void)
{
    remaining = 0;
    music_render(1);
}
#endif
