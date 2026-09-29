/* MUS sequencer and GENMIDI. SPDX-License-Identifier: GPL-2.0-only */
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
static unsigned remainder, serial;

/* MUS keeps the last velocity on each channel; channel 15 is percussion. */
typedef struct {
    int program, volume, velocity, bend, pan, sustain;
} channel_t;
static channel_t channels[16];

/* An OPL3 voice is a pair of operators; GENMIDI may layer two voices. */
typedef struct {
    int channel, key, velocity, instrument, layer, frequency, held;
    unsigned age;
} voice_t;
static voice_t voices[18];
static const int operators[9] = {0, 1, 2, 8, 9, 10, 16, 17, 18};

/* Read packed little-endian fields without alignment assumptions. */
static int word(const uint8_t *data) { return data[0] | data[1] << 8; }

/* Address either bank of nine OPL channels. */
static void reg(int voice, int address, int value)
{
    OPL3_WriteRegBuffered(&chip, address | (voice / 9 << 8), value);
}

/* Find the 16-byte operator pair for this instrument layer. */
static const uint8_t *patch(int voice)
{
    return bank + 8 + voices[voice].instrument * 36 + 4
        + voices[voice].layer * 16;
}

/* Release the key while allowing the OPL envelope to decay. */
static void release(int voice)
{
    reg(voice, 0xb0 + voice % 9, voices[voice].frequency >> 8);
    voices[voice].channel = -1;
    voices[voice].age = ++serial;
}

/* Apply DMX's nonlinear velocity curve, including additive instruments. */
static void volume(int voice)
{
    const uint8_t *data = patch(voice);
    voice_t *v = &voices[voice];
    int level = 63 - ((volume_mapping_table[v->velocity]
        * 2 * (volume_mapping_table[channels[v->channel].volume] + 1)) >> 9);
    int op = operators[voice % 9];
    reg(voice, 0x40 + op + 3, (data[11] & 0xc0) | level);
    if (data[6] & 1) {
        if (level < data[5]) level = data[5];
        reg(voice, 0x40 + op, (data[4] & 0xc0) | level);
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
    v->frequency = value;
    reg(voice, 0xa0 + voice % 9, value & 255);
    reg(voice, 0xb0 + voice % 9, (value >> 8) | 0x20);
}

/* OPL3 supports left, right, or both outputs, as on a Sound Blaster. */
static void pan(int voice)
{
    int value = channels[voices[voice].channel].pan;
    int mask = value < 48 ? 0x10 : value > 96 ? 0x20 : 0x30;
    reg(voice, 0xc0 + voice % 9, patch(voice)[6] | mask);
}

/* Program one operator's envelope, waveform, and modulation settings. */
static void operator_data(int voice, int op, const uint8_t *data)
{
    reg(voice, 0x20 + op, data[0]);
    reg(voice, 0x40 + op, data[4] | data[5]);
    reg(voice, 0x60 + op, data[1]);
    reg(voice, 0x80 + op, data[2]);
    reg(voice, 0xe0 + op, data[3]);
}

/* Reuse the longest-idle voice; steal an old layer before a primary note. */
static void note_on(int channel, int key, int instrument, int layer)
{
    int i, slot = -1;
    voice_t *v;
    const uint8_t *data;
    for (i = 0; i < 18; i++) {
        if (voices[i].channel < 0
            && (slot < 0 || voices[i].age < voices[slot].age)) slot = i;
    }
    if (slot < 0) {
        if (layer) return;
        slot = 0;
        for (i = 1; i < 18; i++) {
            if (voices[i].layer > voices[slot].layer
                || (voices[i].layer == voices[slot].layer
                    && voices[i].age < voices[slot].age)) slot = i;
        }
        release(slot);
    }
    v = &voices[slot];
    *v = (voice_t){channel, key, channels[channel].velocity,
        instrument, layer, 0, 1, ++serial};
    data = patch(slot);
    operator_data(slot, operators[slot % 9] + 3, data + 7);
    operator_data(slot, operators[slot % 9], data);
    volume(slot);
    pan(slot);
    frequency(slot);
}

/* Release matching notes, respecting the MUS sustain pedal. */
static void note_off(int channel, int key)
{
    int i;
    for (i = 0; i < 18; i++) {
        if (voices[i].channel != channel || voices[i].key != key) continue;
        voices[i].held = 0;
        if (!channels[channel].sustain) release(i);
    }
}

/* Reset score state at song start and loop boundaries. */
static void reset_channels(void)
{
    int i;
    for (i = 0; i < 18; i++) release(i);
    for (i = 0; i < 16; i++)
        channels[i] = (channel_t){0, 100, 127, 0, 64, 0};
}

/* Handle MUS controller IDs directly, without a MIDI conversion buffer. */
static void control(int channel, int id, int value)
{
    int i;
    channel_t *c = &channels[channel];
    if (id == 0) c->program = value;
    if (id == 3) c->volume = value;
    if (id == 4) c->pan = value;
    if (id == 8) c->sustain = value >= 64;
    if (id == 14) { c->bend = 0; c->sustain = 0; }
    for (i = 0; i < 18; i++) {
        if (voices[i].channel != channel) continue;
        if (id == 10 || id == 11 || id == 12 || id == 13
            || ((id == 8 || id == 14) && !c->sustain && !voices[i].held))
            release(i);
        else if (id == 3) volume(i);
        else if (id == 4) pan(i);
        else if (id == 14) frequency(i);
    }
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
        int event = byte(), channel = event & 15, type = (event >> 4) & 7;
        int key, value, instrument, i;
        unsigned delay = 0;
        if (type == 0) note_off(channel, byte() & 127);
        else if (type == 1) {
            key = byte();
            if (key & 128) channels[channel].velocity = byte() & 127;
            key &= 127;
            instrument = channel == 15 ? key + 93 : channels[channel].program;
            if (!channels[channel].velocity) note_off(channel, key);
            else if (channel != 15 || (key >= 35 && key <= 81)) {
                note_on(channel, key, instrument, 0);
                if (bank[8 + instrument * 36] & 4)
                    note_on(channel, key, instrument, 1);
            }
        } else if (type == 2) {
            channels[channel].bend = byte() / 2 - 64;
            for (i = 0; i < 18; i++)
                if (voices[i].channel == channel) frequency(i);
        } else if (type == 3) control(channel, byte(), 0);
        else if (type == 4) {
            key = byte();
            control(channel, key, byte() & 127);
        } else if (type == 6) {
            reset_channels();
            if (looping) cursor = start;
            else playing = 0;
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
    remaining = remainder = serial = 0;
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
    OPL3_WriteReg(&chip, 0x105, 1);
    OPL3_WriteReg(&chip, 1, 0x20);
    memset(voices, 0, sizeof(voices));
    reset_channels();
    playing = 1;
    return 1;
}

/* Freeze sequencer and envelope state together when the game is paused. */
EMSCRIPTEN_KEEPALIVE void music_pause(int value) { paused = value; }

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
    if (paused) return output;
    for (i = 0; i < count; i++) {
        if (playing && !remaining) events();
        if (!playing) break;
        OPL3_GenerateResampled(&chip, sample);
        output[i] = sample[0] / 32768.0f;
        output[128 + i] = sample[1] / 32768.0f;
        if (remaining) remaining--;
    }
    return output;
}
