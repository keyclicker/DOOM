/* MUS sequencer and GENMIDI. SPDX-License-Identifier: GPL-2.0-only
 * Adapted from Chocolate Doom's Doom 1.9 OPL driver and MUS converter.
 * Copyright (C) 1993-1996 Id Software, Inc.; 2005-2014 Simon Howard;
 * 2006 Ben Ryves. Source revisions: vendor/README.md.
 */
#include <stdint.h>
#include <string.h>
#include <emscripten.h>
#include "vendor/nuked-opl3/opl3.h"
#include "music-tables.h"

/* Fixed buffers keep the audio callback allocation-free. */
static uint8_t bank[8 + 175 * 36];
static uint8_t score[131072];
static float output[256];
static opl3_chip chip;
static int rate, cursor, start, end, looping, playing, paused, failed;
static uint64_t remaining;
static unsigned remainder;
static int restarting;

/* Doom 1.9 uses nine OPL2 voices, even on an OPL3-capable card. */
enum { VOICE_COUNT = 9 };

/* Keep base volume for slider changes; DMX clips it at song-start volume. */
typedef struct {
    int program, volume, volume_base, velocity, bend;
} channel_t;
static channel_t channels[16];
static int channel_map[16], next_channel;
static int music_volume = 120, start_volume;

/* Cache operator levels and patches exactly as the DMX driver does. */
typedef struct {
    int channel, key, velocity, instrument, layer, frequency;
    int carrier_level, modulator_level;
} voice_t;
static voice_t voices[VOICE_COUNT];
static int free_voices[VOICE_COUNT], allocated[VOICE_COUNT];
static int free_count, allocated_count;
static const int operators[VOICE_COUNT] = {0, 1, 2, 8, 9, 10, 16, 17, 18};

/* Read packed little-endian fields without alignment assumptions. */
static int word(const uint8_t *data) { return data[0] | data[1] << 8; }

/* Preserve register order: the emulator models the chip's write delay. */
static void reg(int address, int value)
{
    OPL3_WriteRegBuffered(&chip, address, value);
}

/* Find the 16-byte operator pair for this instrument layer. */
static const uint8_t *patch(int voice)
{
    return bank + 8 + voices[voice].instrument * 36 + 4
        + voices[voice].layer * 16;
}

/* Key-off keeps the envelope alive until the voice is reused. */
static void key_off(int voice)
{
    reg(0xb0 + voice, voices[voice].frequency >> 8);
}

/* Append released voices to the FIFO free list, preserving patch caches. */
static void release(int index)
{
    int voice = allocated[index];
    key_off(voice);
    voices[voice].channel = -1;
    memmove(allocated + index, allocated + index + 1,
        (--allocated_count - index) * sizeof(*allocated));
    free_voices[free_count++] = voice;
}

/* Apply DMX's nonlinear volume curve to the operators, not the PCM mix. */
static void volume(int voice)
{
    const uint8_t *data = patch(voice);
    voice_t *v = &voices[voice];
    int level = 63 - ((volume_mapping_table[v->velocity]
        * 2 * (volume_mapping_table[channels[v->channel].volume] + 1)) >> 9);
    int op = operators[voice];
    if (level == (v->carrier_level & 63)) return;
    v->carrier_level = (v->carrier_level & 0xc0) | level;
    reg(0x40 + op + 3, v->carrier_level);
    if ((data[6] & 1) && data[5] != 63) {
        if (level < data[5]) level = data[5];
        level |= v->modulator_level & 0xc0;
        if (level != v->modulator_level) {
            v->modulator_level = level;
            reg(0x40 + op, level | (data[4] & 0xc0));
        }
    }
}

/* Match DMX pitch tables, fixed percussion notes, offsets, and detuning. */
static void frequency(int voice)
{
    voice_t *v = &voices[voice];
    const uint8_t *instrument = bank + 8 + v->instrument * 36;
    int note = v->channel == 15 ? 60 : v->key;
    int index, octave, value;
    if (instrument[0] & 1) note = instrument[3];
    else note += (int16_t)word(patch(voice) + 14);
    while (note < 0) note += 12;
    while (note > 95) note -= 12;
    index = 64 + 32 * note + channels[v->channel].bend;
    if (v->layer) index += instrument[2] / 2 - 64;
    if (index < 0) index = 0;
    if (index < 284) value = frequency_curve[index];
    else {
        octave = (index - 284) / 384;
        if (octave > 7) octave = 7;
        value = frequency_curve[284 + (index - 284) % 384] | octave << 10;
    }
    if (value == v->frequency) return;
    v->frequency = value;
    reg(0xa0 + voice, value & 255);
    reg(0xb0 + voice, (value >> 8) | 0x20);
}

/* Silence carriers/additive modulators before programming their envelopes. */
static int operator_data(int op, const uint8_t *data, int silent)
{
    int level = data[4] | (silent ? 63 : data[5]);
    reg(0x40 + op, level);
    reg(0x20 + op, data[0]);
    reg(0x60 + op, data[1]);
    reg(0x80 + op, data[2]);
    reg(0xe0 + op, data[3]);
    return level;
}

/* Program a free voice; secondary layers never steal another note. */
static void voice_on(int channel, int key, int instrument, int layer)
{
    int slot;
    voice_t *v;
    const uint8_t *data;
    if (!free_count) return;
    slot = free_voices[0];
    memmove(free_voices, free_voices + 1, --free_count * sizeof(*free_voices));
    allocated[allocated_count++] = slot;
    v = &voices[slot];
    v->channel = channel;
    v->key = key;
    v->velocity = channels[channel].velocity;
    if (v->instrument != instrument || v->layer != layer) {
        v->instrument = instrument;
        v->layer = layer;
        data = patch(slot);
        v->carrier_level = operator_data(operators[slot] + 3, data + 7, 1);
        v->modulator_level = operator_data(operators[slot], data, data[6] & 1);
        reg(0xc0 + slot, data[6] | 0x30);
    }
    volume(slot);
    v->frequency = 0;
    frequency(slot);
}

/* Release every matching layer in allocation order; DMX ignores sustain. */
static void note_off(int channel, int key)
{
    int i;
    for (i = 0; i < allocated_count; i++) {
        voice_t *v = &voices[allocated[i]];
        if (v->channel == channel && (key < 0 || v->key == key)) release(i--);
    }
}

/* Doom 1.9 steals by channel priority and secondary layer, not note age. */
static void note_on(int channel, int key)
{
    int i, victim = 0;
    int instrument = channel == 15 ? key + 93 : channels[channel].program;
    if (!channels[channel].velocity) { note_off(channel, key); return; }
    if (channel == 15 && (key < 35 || key > 81)) return;
    if (!free_count) {
        for (i = 0; i < allocated_count; i++) {
            voice_t *v = &voices[allocated[i]];
            if (v->layer || v->channel >= voices[allocated[victim]].channel)
                victim = i;
        }
        release(victim);
    }
    voice_on(channel, key, instrument, 0);
    if (bank[8 + instrument * 36] & 4) voice_on(channel, key, instrument, 1);
}

/* Pitch bends also move affected voices to the end of DMX's active list. */
static void pitch_bend(int channel, int value)
{
    int i, count = 0, updated_count = 0;
    int updated[VOICE_COUNT];
    channels[channel].bend = value / 2 - 64;
    for (i = 0; i < allocated_count; i++) {
        int voice = allocated[i];
        if (voices[voice].channel == channel) {
            frequency(voice);
            updated[updated_count++] = voice;
        } else allocated[count++] = voice;
    }
    memcpy(allocated + count, updated, updated_count * sizeof(*updated));
}

/* Retain the requested level so later slider changes can restore it. */
static void channel_volume(int channel, int value, int clip_start)
{
    int i;
    channels[channel].volume_base = value;
    if (value > music_volume) value = music_volume;
    if (clip_start && value > start_volume) value = start_volume;
    channels[channel].volume = value;
    for (i = 0; i < VOICE_COUNT; i++)
        if (voices[i].channel == channel) volume(i);
}

/* Initialize controllers without releasing notes at a loop boundary. */
static void reset_channels(void)
{
    int i;
    start_volume = music_volume;
    next_channel = 0;
    for (i = 0; i < 16; i++) {
        channels[i] = (channel_t){0, music_volume < 100 ? music_volume : 100,
            100, 127, 0};
        channel_map[i] = -1;
    }
}

/* Match mus2mid's first-use mapping, including its channel 9/15 swap. */
static int map_channel(int source)
{
    int channel;
    if (source == 15) return 15;
    if (channel_map[source] < 0) {
        channel = next_channel++;
        if (channel == 9) channel = next_channel++;
        if (channel == 15) channel = 9;
        channel_map[source] = channel;
        note_off(channel, -1);
    }
    return channel_map[source];
}

/* Only volume and all-notes-off affect the default OPL2 driver. */
static void control(int channel, int id, int value)
{
    if (id == 0) channels[channel].program = value & 127;
    else if (id == 3) channel_volume(channel, value > 127 ? 127 : value, 1);
    else if (id == 11) note_off(channel, -1);
}

/* Bound every score read; malformed input stops instead of overrunning. */
static int byte(void)
{
    if (cursor < end) return score[cursor++];
    failed = 1;
    playing = 0;
    return 0;
}

/* Consume a group of simultaneous events and schedule its 140 Hz delay. */
static void events(void)
{
    int budget = 4096;
    while (playing && !remaining && --budget) {
        int event = byte(), channel = map_channel(event & 15);
        int type = (event >> 4) & 7;
        int key, value, i;
        unsigned delay = 0;
        if (type == 0) note_off(channel, byte() & 127);
        else if (type == 1) {
            key = byte();
            if (key & 128) channels[channel].velocity = byte() & 127;
            key &= 127;
            note_on(channel, key);
        } else if (type == 2) pitch_bend(channel, byte());
        else if (type == 3) {
            key = byte();
            if (key < 10 || key > 14) { failed = 1; playing = 0; }
            else control(channel, key, 0);
        }
        else if (type == 4) {
            key = byte();
            value = byte();
            if (key > 9) { failed = 1; playing = 0; }
            else control(channel, key, value);
        } else if (type == 6) {
            if (looping) {
                restarting = 1;
                /* Chocolate Doom yields for 5 ms before restarting. */
                remaining = (rate + 199) / 200;
            } else playing = 0;
            continue;
        } else { failed = 1; playing = 0; }
        if ((event & 128) && playing) {
            i = 0;
            do {
                value = byte();
                delay = (delay << 7) | (value & 127);
                if (++i > 4) { failed = 1; playing = 0; break; }
            } while ((value & 128) && playing);
            remaining = ((uint64_t)delay * rate + remainder) / 140;
            remainder = ((uint64_t)delay * rate + remainder) % 140;
        }
    }
    if (!budget) { failed = 1; playing = 0; }
}

/* Expose fixed input buffers to the worklet; no allocator crosses the ABI. */
EMSCRIPTEN_KEEPALIVE uint8_t *music_bank(void) { return bank; }
EMSCRIPTEN_KEEPALIVE uint8_t *music_score(void) { return score; }

/* Validate the MUS header and reset the chip at the actual output rate. */
EMSCRIPTEN_KEEPALIVE int music_start(int length, int loop, int sample_rate)
{
    playing = failed = paused = 0;
    remaining = remainder = restarting = 0;
    if (length < 16 || length > sizeof(score)
        || memcmp(score, "MUS\x1a", 4) || memcmp(bank, "#OPL_II#", 8)
        || sample_rate < 8000 || sample_rate > 192000) return 0;
    start = word(score + 6);
    end = start + word(score + 4);
    if (start < 16 || end > length || end <= start) return 0;
    cursor = start;
    looping = loop;
    rate = sample_rate;
    OPL3_Reset(&chip, rate);
    /* OPL2 waveform enable and note-select match OPL_InitRegisters(0). */
    for (int r = 0x40; r <= 0x55; r++) reg(r, 63);
    for (int r = 0x60; r <= 0xf5; r++) reg(r, 0);
    for (int r = 1; r < 0x40; r++) reg(r, 0);
    reg(4, 0x60);
    reg(4, 0x80);
    reg(1, 0x20);
    reg(8, 0x40);
    memset(voices, 0, sizeof(voices));
    free_count = VOICE_COUNT;
    allocated_count = 0;
    for (int i = 0; i < VOICE_COUNT; i++) {
        voices[i].channel = voices[i].instrument = -1;
        free_voices[i] = i;
    }
    reset_channels();
    playing = 1;
    return 1;
}

/* DMX pauses events and releases melodic keys; percussion keeps decaying. */
EMSCRIPTEN_KEEPALIVE void music_pause(int value)
{
    paused = value;
    if (paused) {
        for (int i = 0; i < VOICE_COUNT; i++)
            if (voices[i].channel >= 0 && voices[i].instrument < 128)
                key_off(i);
    }
}

/* Accept Doom's 0..15 slider, scaled to the original driver's 0..120. */
EMSCRIPTEN_KEEPALIVE void music_set_volume(int value)
{
    if (value < 0) value = 0;
    if (value > 15) value = 15;
    value *= 8;
    if (value == music_volume) return;
    music_volume = value;
    if (!rate) return;
    for (int i = 0; i < 16; i++)
        channel_volume(i, i == 15 ? value : channels[i].volume_base, 0);
}

/* Stop immediately when changing tracks or quitting. */
EMSCRIPTEN_KEEPALIVE void music_stop(void) { playing = 0; }

/* Report malformed data separately from normal song completion. */
EMSCRIPTEN_KEEPALIVE int music_status(void)
{
    return failed ? -1 : playing | (paused << 1);
}

/* Render up to one worklet quantum as two planar float channels. */
EMSCRIPTEN_KEEPALIVE float *music_render(int count)
{
    int i;
    int16_t sample[2];
    if (count < 0 || count > 128) return output;
    memset(output, 0, sizeof(output));
    for (i = 0; i < count; i++) {
        if (playing && !paused && !remaining) {
            if (restarting) {
                restarting = 0;
                cursor = start;
                reset_channels();
            }
            events();
        }
        if (!playing) break;
        OPL3_GenerateResampled(&chip, sample);
        output[i] = sample[0] / 32768.0f;
        output[128 + i] = sample[1] / 32768.0f;
        if (remaining && !paused) remaining--;
    }
    return output;
}
