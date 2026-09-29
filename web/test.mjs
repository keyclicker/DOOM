#!/usr/bin/env node
/** Exercise the built game in Chromium using only Node's standard library. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const wadPaths = process.argv.slice(2).map(p => resolve(p));
assert(wadPaths.length, 'Pass one or more original IWAD paths.');
let wadPath = wadPaths[0];

/** Serve the build and a private test fixture, with no external requests. */
const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  const files = {'/': join(root, 'index.html'),
    '/doom.wasm': join(root, 'doom.wasm'),
    '/music.wasm': join(root, 'music.wasm'), '/test.wad': wadPath};
  if (!files[path]) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', path.endsWith('.wasm')
    ? 'application/wasm' : path === '/' ? 'text/html' : 'application/octet-stream');
  response.end(await readFile(files[path]));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), 'doom-browser-'));
const browser = spawn(process.env.CHROMIUM || 'chromium', [
  '--headless', '--no-first-run', '--no-default-browser-check',
  '--disable-dev-shm-usage', '--remote-debugging-port=0',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, url,
], {stdio: 'ignore'});
let socket;

/** Wait for an asynchronous condition, with a bounded deadline. */
async function until(test, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await test(); if (result) return result; } catch {}
    await delay(50);
  }
  throw new Error('Timed out waiting for browser state');
}

try {
  const port = await until(async () =>
    (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, {once: true}));
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  const requests = [];
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.id) {
      const {resolve, reject} = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails);
    }
    if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url);
    }
  };

  /** Send one Chrome DevTools Protocol command and await its reply. */
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
    });
  }

  /** Evaluate assertions in the actual browser, propagating JS exceptions. */
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }

  await send('Runtime.enable');
  await send('Network.enable');
  for (wadPath of wadPaths) {
    await send('Page.navigate', {url});
    await until(() => evaluate('typeof Doom !== "undefined"'));
    await evaluate(`(async () => {
      localStorage.clear();
      const bytes = await (await fetch('/test.wad')).arrayBuffer();
      await Doom.load(new File([bytes], 'test.wad'));
      Doom.suspended = true;
    })()`);
    assert(await evaluate('Doom.running'), await evaluate('Doom.message.textContent'));

    // Measure the worklet's actual output, independently of sound effects.
    await evaluate(`(() => {
      const song = Doom.audio.song.bind(Doom.audio);
      Doom.audio.song = (command, data, looping) => {
        Doom.lastMusicCommand = [command, typeof data === 'number' ? data : null];
        song(command, data, looping);
      };
      Doom.musicMeter = Doom.audio.context.createAnalyser();
      Doom.musicMeter.fftSize = 2048;
      Doom.audio.music.connect(Doom.musicMeter);
      Doom.musicEnergy = () => {
        const pcm = new Float32Array(2048);
        Doom.musicMeter.getFloatTimeDomainData(pcm);
        return pcm.reduce((sum, value) => sum + value * value, 0);
      };
      for (let i = 0; i < 3; i++) Doom.engine._web_tick();
    })()`);
    await until(() => evaluate('Doom.musicEnergy() > 0.001'));

    const result = await evaluate(`(() => {
      const e = Doom.engine;
      const tick = (count = 1) => {
        for (let i = 0; i < count; i++) e._web_tick();
      };
      const key = code => {
        document.onkeydown(new KeyboardEvent('keydown', {code}));
        tick();
        document.onkeyup(new KeyboardEvent('keyup', {code}));
        tick();
      };
      const hash = () => {
        let h = 2166136261;
        for (const b of e.HEAPU8.subarray(e._web_pixels(),
          e._web_pixels() + 256000)) h = Math.imul(h ^ b, 16777619);
        return h >>> 0;
      };
      tick(3);
      key('Enter'); key('Enter');
      if (!e.FS.analyzePath('/doom2.wad').exists) key('Enter');
      key('Enter'); tick(80);
      if ((e._web_state() & 15) !== 0) throw Error('New game did not start');
      const startHash = hash();
      document.onkeydown(new KeyboardEvent('keydown', {code: 'ArrowUp'}));
      tick(25);
      Doom.release(); tick();
      const movedHash = hash();
      if (startHash === movedHash) throw Error('Movement did not change the view');
      key('F2'); key('Enter');
      for (const code of ['KeyT', 'KeyE', 'KeyS', 'KeyT']) key(code);
      key('Enter'); tick(10);
      Doom.persist();
      const save = e.FS.readFile('/doomsav0.dsg');
      if (save.length < 1000) throw Error('Save file is missing or too short');
      // A remapped Ctrl–Alt–Command key may omit individual modifier keyups.
      // Native saves contain 32-bit player_t at 52; ammo[] starts at 156.
      const bullets = bytes => new DataView(bytes.buffer, bytes.byteOffset)
        .getInt32(52 + 156, true);
      const baselineAmmo = bullets(save);
      const modifier = {ControlLeft: 'ctrlKey', AltLeft: 'altKey',
        MetaLeft: 'metaKey'};
      const orders = [
        ['ControlLeft', 'AltLeft', 'MetaLeft'],
        ['ControlLeft', 'MetaLeft', 'AltLeft'],
        ['AltLeft', 'ControlLeft', 'MetaLeft'],
        ['AltLeft', 'MetaLeft', 'ControlLeft'],
        ['MetaLeft', 'ControlLeft', 'AltLeft'],
        ['MetaLeft', 'AltLeft', 'ControlLeft'],
      ];
      for (const order of orders) {
        e.FS.writeFile('/doomsav0.dsg', save);
        key('F3'); key('Enter'); tick(80);
        const flags = {};
        for (const code of order) {
          flags[modifier[code]] = true;
          document.dispatchEvent(new KeyboardEvent('keydown', {code, ...flags}));
        }
        document.dispatchEvent(new KeyboardEvent('keydown',
          {code: 'ArrowDown', ...flags}));
        if (!Doom.held.has('ArrowDown')) throw Error('Chord blocked movement');
        tick(5);
        // The remapper reports the complete released state on just one keyup.
        document.dispatchEvent(new KeyboardEvent('keyup', {code: 'MetaLeft'}));
        tick(70);
        document.dispatchEvent(new KeyboardEvent('keyup', {code: 'ArrowDown'}));
        if (Doom.held.size) throw Error('Chord left a key held');
        key('F2'); key('Enter'); key('Enter'); tick(5);
        if (bullets(e.FS.readFile('/doomsav0.dsg')) !== baselineAmmo - 1) {
          throw Error('Short chord press did not fire exactly one round');
        }
      }
      e.FS.writeFile('/doomsav0.dsg', save);
      key('F3'); key('Enter'); tick(80);
      document.onkeydown(new KeyboardEvent('keydown',
        {code: 'ControlLeft', ctrlKey: true}));
      document.onkeydown(new KeyboardEvent('keydown',
        {code: 'ControlRight', ctrlKey: true}));
      document.onkeyup(new KeyboardEvent('keyup',
        {code: 'ControlLeft', ctrlKey: true}));
      tick(40);
      document.onkeyup(new KeyboardEvent('keyup', {code: 'ControlRight'}));
      tick(70);
      key('F2'); key('Enter'); key('Enter'); tick(5);
      if (bullets(e.FS.readFile('/doomsav0.dsg')) !== baselineAmmo - 3) {
        throw Error('Releasing one Control key interrupted the other');
      }
      const shortcut = new KeyboardEvent('keydown',
        {code: 'KeyR', metaKey: true, cancelable: true});
      document.dispatchEvent(shortcut);
      if (shortcut.defaultPrevented || Doom.held.has('KeyR')) {
        throw Error('Game swallowed a plain Command shortcut');
      }
      Doom.release(); tick();
      e.FS.writeFile('/doomsav0.dsg', save);
      key('F3'); key('Enter'); tick(80);
      key('Tab'); tick(5); key('Tab');
      key('Pause'); tick(5);
      if (!(e._web_state() & 32)) throw Error('Pause key did not pause');
      key('Pause');
      const times = [];
      for (let i = 0; i < 1000; i++) {
        const start = performance.now(); tick(); Doom.draw();
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const stored = JSON.parse(localStorage.getItem(Doom.storageKey));
      if (!stored['doomsav0.dsg']) throw Error('Save not persisted');
      e.FS.unlink('/doomsav0.dsg'); Doom.restore();
      if (e.FS.readFile('/doomsav0.dsg').length !== save.length) {
        throw Error('Save not restored');
      }
      return {startHash, movedHash, saveBytes: save.length,
        memoryBytes: e.HEAPU8.length, sampleCount: Doom.audio.samples.size,
        frameMs: {median: times[500], p95: times[950], max: times[999]}};
    })()`);
    assert(result.sampleCount > 0, 'No sound effects reached Web Audio');
    console.log(JSON.stringify({wad: wadPath.split('/').pop(), ...result}));

    await until(() => evaluate('Doom.musicEnergy() > 0.001'));
    await evaluate(`(() => {
      Doom.testKey = code => {
        Doom.engine._web_key(code, 1); Doom.engine._web_tick();
        Doom.engine._web_key(code, 0); Doom.engine._web_tick();
      };
      Doom.testKey(255);
    })()`);
    assert.deepEqual(await evaluate('Doom.lastMusicCommand'), ['pause', 1]);
    // DMX leaves percussion ringing during pause; silence is not guaranteed.
    assert(await evaluate('(Doom.engine._web_state() & 32) !== 0'));
    await evaluate('Doom.testKey(255)');
    assert.deepEqual(await evaluate('Doom.lastMusicCommand'), ['pause', 0]);
    await until(() => evaluate('Doom.musicEnergy() > 0.001'));

    // F4 opens Sound Volume. One down-arrow skips the SFX thermometer.
    await evaluate(`(() => {
      Doom.testKey(190); Doom.testKey(175);
      for (let i = 0; i < 15; i++) Doom.testKey(172);
    })()`);
    // Attenuation belongs to the synth; OPL minimum level is not digital zero.
    assert.deepEqual(await evaluate('Doom.lastMusicCommand'), ['volume', 0]);
    await until(() => evaluate('Doom.musicEnergy() < 0.001'));
    await evaluate(`(() => {
      for (let i = 0; i < 15; i++) Doom.testKey(174);
      Doom.testKey(27);
    })()`);
    assert.deepEqual(await evaluate('Doom.lastMusicCommand'), ['volume', 15]);
    await until(() => evaluate('Doom.musicEnergy() > 0.001'));
    await evaluate('Doom.audio.suspend()');
    await until(() => evaluate('Doom.audio.context.state === "suspended"'));
    await evaluate('Doom.audio.resume()');
    await until(() => evaluate('Doom.musicEnergy() > 0.001'));
    console.log('PASS: audible title/level music, pause, volume menu, focus audio');

    // A fresh runtime must restore the saved game, not just the MEMFS instance.
    await send('Page.navigate', {url});
    await until(() => evaluate('typeof Doom !== "undefined" && !Doom.engine'));
    const restored = await evaluate(`(async () => {
      const bytes = await (await fetch('/test.wad')).arrayBuffer();
      await Doom.load(new File([bytes], 'test.wad'));
      Doom.suspended = true;
      return Doom.engine.FS.readFile('/doomsav0.dsg').length;
    })()`);
    assert.equal(restored, result.saveBytes);

    const maps = await evaluate(`(() => {
      const e = Doom.engine;
      const tick = (n = 1) => { for (let i = 0; i < n; i++) e._web_tick(); };
      const key = code => {
        e._web_key(code, 1); tick(); e._web_key(code, 0); tick();
      };
      tick(3); key(189); key(13); tick(80);
      const name = e.FS.readdir('/').find(n => n.endsWith('.wad'));
      const wad = e.FS.readFile('/' + name);
      const view = new DataView(wad.buffer);
      const offset = view.getUint32(8, true);
      const names = [];
      for (let i = 0; i < view.getUint32(4, true); i++) {
        const start = offset + i * 16 + 8;
        const name = new TextDecoder().decode(wad.subarray(start, start + 8))
          .replace(/\\0.*$/, '');
        if (/^(E[1-4]M[1-9]|MAP[0-9][0-9])$/.test(name)) names.push(name);
      }
      for (const map of names) {
        const digits = map.startsWith('MAP') ? map.slice(3) : map[1] + map[3];
        for (const char of 'idclev' + digits) key(char.charCodeAt(0));
        tick(80);
        if ((e._web_state() & 15) !== 0) throw Error('Failed to enter ' + map);
        key(188); key(13); key(13); tick(5);
        const save = e.FS.readFile('/doomsav0.dsg');
        if (save[42] !== Number(map.startsWith('MAP') ? digits : digits[1])
          || (!map.startsWith('MAP') && save[41] !== Number(digits[0]))) {
          throw Error('Warp/save did not reach ' + map);
        }
      }
      return names.length;
    })()`);
    console.log(`PASS: rendered and saved all ${maps} maps`);

    await send('Page.navigate', {url});
    await until(() => evaluate('typeof Doom !== "undefined" && !Doom.engine'));
    const demoFrames = await evaluate(`(async () => {
      const bytes = await (await fetch('/test.wad')).arrayBuffer();
      await Doom.load(new File([bytes], 'test.wad'));
      Doom.suspended = true;
      let frames = 0;
      for (let i = 0; i < 6000; i++) {
        Doom.engine._web_tick();
        if (Doom.engine._web_state() & 64) frames++;
      }
      return frames;
    })()`);
    assert(demoFrames > 1000, 'The original IWAD demos did not play');
    console.log(`PASS: ${demoFrames} demo frames`);
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert(requests.every(request => request.startsWith(url)
    || request.startsWith('blob:' + url)),
    'The game made an external network request');
  console.log('PASS: gameplay, input, menus, sound, saves, reload, local assets');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(done => browser.once('exit', done));
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(profile, {recursive: true, force: true, maxRetries: 5});
}
