#!/usr/bin/env node
/** Compare our MUS driver with a pinned, unmodified Chocolate Doom driver. */
import assert from 'node:assert/strict';
import {WASI} from 'node:wasi';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const [source, ...wadPaths] = process.argv.slice(2);
assert(source && wadPaths.length,
  'Usage: node doom/web/test-opl.mjs CHOCOLATE_DOOM_SOURCE IWAD [...]');
const web = fileURLToPath(new URL('.', import.meta.url));
const upstream = resolve(source);
const temporary = await mkdtemp(join(tmpdir(), 'doom-opl-'));

/** Build each driver with its own chip code and test-only trace exports. */
async function build(reference) {
  const path = join(temporary, reference ? 'reference.wasm' : 'port.wasm');
  execFileSync('emcc', [join(web, 'tests/opl-driver.c'),
    reference ? join(upstream, 'opl/opl3.c')
      : join(web, '../vendor/nuked-opl3/opl3.c'),
    '-I' + web, '-I' + join(web, '..'), '-I' + temporary, '-I' + join(upstream, 'src'),
    '-I' + join(upstream, 'opl'), ...(reference ? ['-DOPL_REFERENCE'] : []),
    '-O2', '-flto', '-fwrapv', '--no-entry', '-sSTANDALONE_WASM=1',
    '-sFILESYSTEM=0', '-sINITIAL_MEMORY=2097152', '-sSTACK_SIZE=65536',
    '-o', path], {stdio: 'inherit'});
  return WebAssembly.compile(await readFile(path));
}

/** Extract test data from user-owned IWADs. */
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

/** Expose fixed WASM buffers and drain an ordered register trace. */
function instance(module, bank) {
  const wasi = new WASI({version: 'preview1', args: [], env: {}});
  const instance = new WebAssembly.Instance(module, wasi.getImportObject());
  wasi.initialize(instance);
  const e = instance.exports;
  const bytes = new Uint8Array(e.memory.buffer);
  bytes.set(bank.subarray(0, 6308), e.music_bank());
  const pcm = new Float32Array(e.memory.buffer, e.music_render(0), 256);
  return {e, bytes, pcm, trace() {
    return Array.from(new Uint32Array(e.memory.buffer,
      e.test_trace(), e.test_count()));
  }};
}

/** Decode MUS independently, following mus2mid's channel assignment. */
function decode(data) {
  const events = [];
  const map = new Map(), velocities = new Array(16).fill(127);
  const controls = [0, 32, 1, 7, 10, 11, 91, 93, 64, 67,
    120, 123, 126, 127, 121];
  let cursor = data.readUInt16LE(6), tick = 0, next = 0;
  while (cursor < data.length) {
    const event = data[cursor++], source = event & 15, type = event >> 4 & 7;
    let channel = 9;
    if (source !== 15) {
      if (!map.has(source)) {
        if (next === 9) next++;
        map.set(source, next++);
        events.push({tick, midi: [0xb0, map.get(source), 123, 0]});
      }
      channel = map.get(source);
    }
    let a = 0, b = 0, midi;
    if (type === 0) midi = [0x80, channel, data[cursor++] & 127, 0];
    else if (type === 1) {
      a = data[cursor++];
      if (a & 128) velocities[channel] = data[cursor++] & 127;
      midi = [0x90, channel, a & 127, velocities[channel]];
    } else if (type === 2) {
      a = data[cursor++] * 64;
      midi = [0xe0, channel, a & 127, a >> 7];
    } else if (type === 3) midi = [0xb0, channel, controls[data[cursor++]], 0];
    else if (type === 4) {
      a = data[cursor++]; b = data[cursor++];
      midi = a === 0 ? [0xc0, channel, b & 127, 0]
        : [0xb0, channel, controls[a], Math.min(127, b)];
    } else if (type === 6) return {events, endTick: tick};
    else throw Error('Invalid test score');
    events.push({tick, midi});
    if (event & 128) {
      let delay = 0;
      do { b = data[cursor++]; delay = delay * 128 + (b & 127); }
      while (b & 128);
      tick += delay;
    }
  }
  throw Error('Missing end of score');
}

/** Compare all register writes and PCM at the same exact 140 Hz timestamps. */
function compare(portModule, refModule, bank, data, name,
  rate, seconds, volume) {
  const port = instance(portModule, bank), ref = instance(refModule, bank);
  const {events, endTick} = decode(data);
  port.e.music_set_volume(volume);
  port.bytes.set(data, port.e.music_score());
  assert(port.e.music_start(data.length, false, rate));
  ref.e.reference_init(volume, rate);
  assert.deepEqual(port.trace(), ref.trace(), name + ': chip initialization');
  const limit = Math.min(Math.floor(endTick * rate / 140), rate * seconds);
  let frame = 0, eventIndex = 0, writes = 0;
  while (frame < limit) {
    // Include menu volume changes while voices are sounding.
    if (frame === Math.floor(rate / 2)) {
      port.e.music_set_volume(4); ref.e.music_set_volume(4);
    }
    if (frame === rate) {
      port.e.music_set_volume(15); ref.e.music_set_volume(15);
    }
    while (eventIndex < events.length
      && Math.floor(events[eventIndex].tick * rate / 140) <= frame) {
      ref.e.reference_event(...events[eventIndex++].midi);
    }
    let next = eventIndex < events.length
      ? Math.floor(events[eventIndex].tick * rate / 140) : limit;
    for (const boundary of [Math.floor(rate / 2), rate])
      if (boundary > frame) next = Math.min(next, boundary);
    const count = Math.min(128, limit - frame, next - frame);
    assert(count > 0);
    port.e.music_render(count); ref.e.music_render(count);
    const actual = port.trace(), expected = ref.trace();
    assert.deepEqual(actual, expected, `${name}: registers at frame ${frame}`);
    writes += actual.length;
    assert.deepEqual(port.pcm.subarray(0, count), ref.pcm.subarray(0, count),
      `${name}: left PCM at frame ${frame}`);
    assert.deepEqual(port.pcm.subarray(128, 128 + count),
      ref.pcm.subarray(128, 128 + count),
      `${name}: right PCM at frame ${frame}`);
    frame += count;
  }
  // Pause while active: release melodic keys but keep synthesizing tails.
  port.e.music_pause(1); ref.e.music_pause(1);
  assert.deepEqual(port.trace(), ref.trace(), name + ': pause key-offs');
  for (let i = 0; i < 10; i++) {
    port.e.music_render(128); ref.e.music_render(128);
    assert.deepEqual(port.pcm, ref.pcm, name + ': pause PCM');
  }
  port.e.music_pause(0); ref.e.music_pause(0);
  assert.deepEqual(port.trace(), ref.trace(), name + ': resume');
  return writes;
}

/** Check complete scores and their loop transition without rendering PCM. */
function compareScore(portModule, refModule, bank, data, name) {
  const port = instance(portModule, bank), ref = instance(refModule, bank);
  port.bytes.set(data, port.e.music_score());
  port.e.music_set_volume(8);
  port.e.music_start(data.length, true, 44100);
  ref.e.reference_init(8, 44100);
  assert.deepEqual(port.trace(), ref.trace());
  const {events, endTick} = decode(data);
  let writes = 0;
  for (let loop = 0; loop < 2; loop++) {
    if (loop) ref.e.reference_restart();
    let index = 0, lastTick = -1;
    while (index < events.length) {
      lastTick = events[index].tick;
      do { ref.e.reference_event(...events[index++].midi); }
      while (index < events.length && events[index].tick === lastTick);
      port.e.test_events();
      const actual = port.trace();
      assert.deepEqual(actual, ref.trace(), `${name}: score tick ${lastTick}`);
      writes += actual.length;
    }
    // End-of-track may have introduced a channel (mus2mid's all-notes-off).
    if (lastTick !== endTick) {
      port.e.test_events();
      assert.deepEqual(port.trace(), [], name + ': unexpected final writes');
    }
    assert.equal(port.e.music_status(), 1, name + ': looping stopped');
  }
  return writes;
}

/** Force crowded voices, all melodic patches, drums, bends, and controllers. */
function pressureScore() {
  const events = [];
  const order = [14, 3, 9, 0, 12, 7, 1, 11, 8, 2, 13, 6, 10, 4, 5];
  for (let program = 0; program < 128; program++) {
    const channel = order[program % order.length];
    const key = 36 + program % 60;
    events.push(0x40 | channel, 0, program);
    events.push(0x10 | channel, key | 128, 50 + program % 78);
    events.push(0x10 | channel, key + 7);
    events.push(0x20 | channel, program * 2);
    events.push(0x40 | channel, 3, program % 3 ? 100 : 255);
    // OPL2 ignores pan, sustain, soft pedal, all-sounds-off and reset.
    for (const id of [4, 8, 9]) events.push(0x40 | channel, id, 127);
    for (const id of [10, 12, 13, 14]) events.push(0x30 | channel, id);
    if (program % 7 === 0) events.push(0x30 | channel, 11);
    if (program < 47) events.push(0x1f, (35 + program) | 128, 100);
    events.push(0x80 | channel, key, 3);
  }
  events.push(0xc0, 3, 100, 140 >> 7 | 128, 140 & 127, 0x60);
  const data = Buffer.alloc(16 + events.length);
  data.write('MUS\x1a');
  data.writeUInt16LE(events.length, 4);
  data.writeUInt16LE(16, 6);
  data.set(events, 16);
  return data;
}

try {
  // Pin the oracle: upstream changes must be reviewed, not silently accepted.
  for (const [path, hash] of Object.entries({
    'src/i_oplmusic.c':
      '3e0f161fda6f17ed104f3381d0b1eb9c8b060797e8393cb2c00649d53bedbb7a',
    'opl/opl.c':
      'f6b798d16a65d2a20cd6eeefd5b214fe919ad709976511ed90e8a4e1cf1c78ea',
    'opl/opl3.c':
      'd37ec0095dcf2d9b10d83100277f0f33e3b1fc8b41d74ad07e7a88e948fa5fa5',
    'opl/opl3.h':
      '769ce960dc64b3d369608e6ffe777e3eb5a7e3f6b1e1e95cb4ed638f6407d289',
    'opl/wf_rom.h':
      '13b289c71911775cc312f63cb92eb39100c416b07626bf71248e312fdff5de8a',
  })) {
    const bytes = await readFile(join(upstream, path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash,
      'Unexpected Chocolate Doom revision: ' + path);
  }
  // Minimal build configuration: the oracle uses no SDL or operating system.
  await writeFile(join(temporary, 'config.h'),
    '#define HAVE_DECL_STRCASECMP 1\n#define HAVE_DECL_STRNCASECMP 1\n');
  await writeFile(join(temporary, 'SDL_endian.h'),
    '#define SDL_SwapLE16(x) (x)\n#define SDL_SwapLE32(x) (x)\n'
    + '#define SDL_BYTEORDER 1234\n#define SDL_BIG_ENDIAN 4321\n');
  const opl = await readFile(join(upstream, 'opl/opl.c'), 'utf8');
  const start = opl.indexOf('void OPL_InitRegisters(int opl3)');
  assert(start >= 0);
  await writeFile(join(temporary, 'opl-init.inc'),
    opl.slice(start, opl.indexOf('\n}', start) + 2));
  const portModule = await build(false), refModule = await build(true);
  let songs = 0, writes = 0;
  for (const path of wadPaths) {
    const wad = lumps(await readFile(path)), bank = wad.get('GENMIDI');
    for (const [name, data] of wad) {
      if (data.toString('ascii', 0, 4) !== 'MUS\x1a') continue;
      writes += compareScore(portModule, refModule, bank, data, name);
      for (const rate of [44100, 48000]) {
        writes += compare(portModule, refModule, bank, data, name, rate, 10, 8);
      }
      songs++;
    }
    for (const volume of [0, 8, 15])
      writes += compare(portModule, refModule, bank, pressureScore(),
        'voice pressure', 44100, 10, volume);
    console.log(`PASS: ${path.split('/').pop()}, register and PCM agreement`);
  }
  console.log(`PASS: ${songs} complete scores; ${writes} matching writes; `
    + '10 seconds PCM per track at 44.1/48 kHz');
} finally { await rm(temporary, {recursive: true, force: true}); }
