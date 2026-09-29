#!/usr/bin/env node
/** Test the actual WASM synth with IWAD music and precise timing fixtures. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const module = await WebAssembly.compile(
  await readFile(new URL('./dist/music.wasm', import.meta.url)));
assert.equal(WebAssembly.Module.imports(module).length, 0);
const paths = process.argv.slice(2);
assert(paths.length, 'Pass at least one original IWAD path.');

/** Extract the unmodified instrument bank and all original MUS tracks. */
function lumps(wad) {
  const result = new Map();
  for (let i = 0; i < wad.readUInt32LE(4); i++) {
    const offset = wad.readUInt32LE(8) + 16 * i;
    const start = wad.readUInt32LE(offset);
    const length = wad.readUInt32LE(offset + 4);
    const name = wad.toString('ascii', offset + 8, offset + 16)
      .replace(/\0.*$/, '');
    result.set(name, wad.subarray(start, start + length));
  }
  return result;
}

/** Give each test isolated chip state and the WAD's real instruments. */
function synth(bank) {
  const e = new WebAssembly.Instance(module).exports;
  e._initialize();
  const bytes = new Uint8Array(e.memory.buffer);
  bytes.set(bank.subarray(0, 6308), e.music_bank());
  const output = new Float32Array(e.memory.buffer, e.music_render(0), 256);
  return {
    e, output,
    start(score, loop = false, rate = 44100) {
      bytes.set(score, e.music_score());
      return e.music_start(score.length, loop, rate);
    },
    render(frames) {
      let energy = 0;
      while (frames > 0) {
        const count = Math.min(128, frames);
        e.music_render(count);
        for (let i = 0; i < count; i++) energy += output[i] ** 2;
        frames -= count;
      }
      return energy;
    },
  };
}

/** Wrap an explicit MUS event stream with a minimal score header. */
function score(events) {
  const data = Buffer.alloc(16 + events.length);
  data.write('MUS\x1a');
  data.writeUInt16LE(events.length, 4);
  data.writeUInt16LE(16, 6);
  data.writeUInt16LE(1, 8);
  data.set(events, 16);
  return data;
}

let bank;
for (const path of paths) {
  const wad = lumps(await readFile(path));
  bank = wad.get('GENMIDI');
  const player = synth(bank);
  const songs = [...wad].filter(([, data]) =>
    data.length >= 16 && data.toString('ascii', 0, 4) === 'MUS\x1a');
  assert(songs.length > 0);
  const begin = performance.now();
  for (const [name, data] of songs) {
    assert(player.start(data, true), name + ' rejected');
    const energy = player.render(44100 * 5);
    assert(energy > 0.01, name + ' is silent');
    assert.equal(player.e.music_status(), 1, name + ' failed');
  }
  console.log(`PASS: ${songs.length} MUS tracks, five seconds each; `
    + `${((performance.now() - begin) / (songs.length * 5)).toFixed(2)} `
    + 'ms synthesis per audio second');
}

// Note on for 140 MUS tics, release for 140 tics, then end: exactly 2 s.
const phrase = score([0x90, 0xbc, 100, 0x81, 0x0c,
  0x80, 60, 0x81, 0x0c, 0x60]);
const player = synth(bank);
for (const rate of [44100, 48000]) {
  assert(player.start(phrase, false, rate));
  assert(player.render(rate) > 0.01);
  player.render(rate);
  assert.equal(player.e.music_status(), 1);
  player.render(1);
  assert.equal(player.e.music_status(), 0, 'MUS tempo drifted');
  assert.equal(player.render(128), 0, 'Ended song is not silent');
  assert(player.start(phrase, true, rate));
  player.render(rate * 2);
  assert(player.render(rate) > 0.01, 'Loop did not restart');
  assert.equal(player.e.music_status(), 1);

  // Single-tic delays must retain fractional frames at 48 kHz.
  const events = [0x90, 0xbc, 100, 1];
  for (let i = 1; i < 140; i++) events.push(0xc0, 3, 100, 1);
  events.push(0x60);
  assert(player.start(score(events), false, rate));
  player.render(rate);
  assert.equal(player.e.music_status(), 1);
  player.render(1);
  assert.equal(player.e.music_status(), 0, 'Fractional MUS timing drifted');
}

// Pausing must preserve the exact next PCM frame, not just stop new notes.
const reference = synth(bank);
player.start(phrase);
reference.start(phrase);
player.render(8192);
reference.render(8192);
player.e.music_pause(1);
assert.equal(player.render(44100), 0);
assert.equal(player.e.music_status(), 3);
player.e.music_pause(0);
player.render(128);
reference.render(128);
assert.deepEqual(player.output, reference.output, 'Pause advanced chip state');
player.e.music_stop();
assert.equal(player.render(44100), 0, 'Stop left stuck notes');
player.start(phrase);
reference.start(phrase);
player.render(128);
reference.render(128);
assert.deepEqual(player.output, reference.output, 'Restart retained old notes');

// Reject truncated headers/events and bound zero-duration loops.
assert.equal(player.start(Buffer.alloc(16)), 0);
for (const events of [[0x90, 0xbc], [0x50], [0x60],
  [0x90, 0xbc, 100, 255, 255, 255, 255, 255]]) {
  assert(player.start(score(events), true));
  player.render(128);
  assert.equal(player.e.music_status(), -1, 'Malformed score did not stop');
}
console.log('PASS: tempo, looping, pause, resume, stop, malformed scores');
