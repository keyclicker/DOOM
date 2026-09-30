/** Verify the original Libretro filters through the real browser GL compiler. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

/** Compile every pass and compare distinct outputs on a synthetic CRT signal. */
export async function testCRTPresets(evaluate, send) {
  const result = await evaluate(`(${function () {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const filter = new DoomCRT(canvas), gl = filter.gl;
    const bytes = new Uint8Array(320 * 200 * 4);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const at = (y * 320 + x) * 4;
      bytes[at] = x < 160 ? 210 : 40;
      bytes[at + 1] = y < 100 ? 180 : 50;
      bytes[at + 2] = (x % 8 < 4) ? 170 : 60;
      bytes[at + 3] = 255;
    }
    const results = [];
    for (const mode of [1, 2, 3, 4, 5, 1]) {
      filter.select(mode);
      filter.software(bytes, 320, 200);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height,
        gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error) throw Error('Mode ' + mode + ': GL error ' + error);
      results.push({mode, passes: filter.preset?.passes.length || 1,
        hash: pixels.reduce((h, b) => Math.imul(h ^ b, 16777619), 2166136261) >>> 0,
        mean: pixels.reduce((sum, b, i) => sum + (i % 4 < 3 ? b : 0), 0)
          / (canvas.width * canvas.height * 3)});
    }
    gl.getExtension('WEBGL_lose_context').loseContext();
    return results;
  }})()`);
  console.log(result);
  assert.equal(new Set(result.slice(0, 5).map(r => r.hash)).size, 5);
  assert(result.every(r => r.mean > 20 && r.mean < 220));
  assert.equal(result[4].passes, 12);
  assert.equal(result[0].hash, result[5].hash);
  console.log('PASS: all five CRT shaders compile and produce distinct images');
  await evaluate(`(${function () {
    const e = Doom.engine;
    const check = (v, message) => { if (!v) throw Error(message); };
    const key = code => {
      e._web_key(code, 1); e._web_tick(); e._web_key(code, 0); e._web_tick();
      Settings.flush();
    };
    const render = () => { e._web_render(65536); Doom.draw(); };
    const close = () => {
      for (let i = 0; i < 8 && (e._web_state() & 16); i++) key(27);
    };
    const video = () => {
      close(); key(27); key(101); key(13);
      key(99); key(13); key(99);
    };
    for (const value of [null, -1, 6, 1.5, '2', {}, false])
      check(Settings.validate({crt: value}).crt === 0, 'Invalid CRT preference');
    check(Settings.validate({crt: true}).crt === 1, 'Old Clean CRT choice lost');
    for (let mode = 0; mode < 6; mode++)
      check(Settings.validate({crt: mode}).crt === mode, 'Valid CRT choice lost');
    e._web_tick(); key(13); key(13);
    if (!e.FS.analyzePath('/doom2.wad').exists) key(13);
    key(13);
    for (let i = 0; i < 80; i++) e._web_tick();
    video();
    for (let mode = 1; mode <= 6; mode++) {
      key(174); render();
      check(e._web_setting(6) === mode % 6, 'Right-arrow CRT cycle failed');
      check(Settings.value.crt === mode % 6, 'CRT selection failed to apply');
      check(JSON.parse(localStorage.getItem('doom:settings')).crt === mode % 6,
        'Selected shader not persisted');
    }
    key(172); render();
    check(Settings.value.crt === 5, 'Left-arrow wrap did not select Royale');
    key(27); check(e._web_state() & 16, 'Escape skipped the parent menu');
    video(); render();
    Doom.presetTest = {key, check, render, close, video};
  }})()`);
  console.log('PASS: native shader selector, wraparound and preference migration');
  if (process.env.DOOM_SCREENSHOTS) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-preset-menu.png',
      Buffer.from(data, 'base64'));
  }
  await evaluate('Doom.presetTest.close(); Doom.presetTest.render()');

  for (const renderer of [false, true]) {
    for (const [width, height, density, scale] of [
      [800, 600, 1, 1], [887, 553, 2, 1], [640, 480, 1, 0],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: density, mobile: false,
      });
      for (let mode = 1; mode <= 5; mode++) {
        const state = await evaluate(`(() => {
          const {check, render, key} = Doom.presetTest;
          Settings.value.renderer = ${renderer}; Settings.value.crt = ${mode};
          Settings.value.scale = ${scale}; Settings.value.aspect = 'browser';
          Settings.apply(); render();
          check(Doom.crtEnabled === ${mode}, 'Preset silently fell back');
          const display = Doom.hardware ? Doom.graphics.crt : Doom.crtDisplay;
          const gl = display.gl, canvas = Doom.canvas;
          const read = () => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height,
              gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return pixels;
          };
          const pixels = read();
          check(pixels.some((v, i) => i % 4 < 3 && v > 80), 'Empty shader output');
          const upload = gl.texSubImage2D, readPixels = gl.readPixels;
          const uploads = [];
          gl.texSubImage2D = function(...args) {
            uploads.push(args[8]?.byteLength || 0);
            return upload.apply(this, args);
          };
          gl.readPixels = () => { throw Error('Preset performed CPU readback'); };
          try { render(); } finally {
            gl.texSubImage2D = upload; gl.readPixels = readPixels;
          }
          check(read().every((v, i) => v === pixels[i]), 'Unstable shader frame');
          if (Doom.hardware) check(uploads.length === 1 && uploads[0] === 1024000,
            'Preset expanded the native HUD on the CPU');
          key(9); render(); key(9); render();
          check(!gl.getError(), 'GL state leaked between shader and world');
          const targets = display.preset?.passes.map(pass => pass.target) || [];
          Settings.value.crt = 0; Settings.apply(); render();
          check(targets.every(t => !t.texture || !gl.isTexture(t.texture)),
            'Leaving Royale retained intermediate textures');
          Settings.value.crt = ${mode}; Settings.apply(); render();
          return {renderer: Doom.hardware, mode: Doom.crtEnabled,
            source: [Doom.width, Doom.height], output: [canvas.width, canvas.height]};
        })()`);
        console.log('PASS: shader switching, display size and automap', state);
        if (process.env.DOOM_SCREENSHOTS && width === 800) {
          const {data} = await send('Page.captureScreenshot', {format: 'png'});
          await writeFile(process.env.DOOM_SCREENSHOTS
            + '-preset-' + Number(renderer) + '-' + mode + '.png',
          Buffer.from(data, 'base64'));
        }
      }
    }
  }
  for (const renderer of [false, true]) {
    await evaluate(`Settings.value.renderer = ${renderer};
      Settings.value.crt = 5; Settings.apply(); Doom.presetTest.render();
      (Doom.hardware ? Doom.graphics : Doom.crtDisplay).gl
        .getExtension('WEBGL_lose_context').loseContext()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(await evaluate(`(() => {
      Settings.flush(); Doom.presetTest.render();
      return Doom.running && !Doom.hardware && !Doom.crtEnabled
        && !Doom.engine._web_setting(6);
    })()`), 'Lost Royale context did not fall back');
    assert(await evaluate(`(() => {
      Settings.value.renderer = ${renderer}; Settings.value.crt = 5;
      Settings.apply(); Doom.presetTest.render();
      return Doom.crtEnabled === 5 && !Doom.crtFailed
        && Doom.hardware === ${renderer};
    })()`), 'Royale retry failed after context loss');
    assert(await evaluate(`(() => {
      const pass = DoomRetroCRT.data.presets[0][0], source = pass.fragment;
      try {
        pass.fragment = 'invalid shader';
        Settings.value.crt = 2; Settings.apply(); Doom.presetTest.render();
        return Doom.running && !Doom.crtEnabled && Doom.crtFailed
          && !Doom.engine._web_setting(6) && Doom.hardware === ${renderer};
      } finally { pass.fragment = source; }
    })()`), 'Driver shader rejection did not preserve play');
    await evaluate(`Settings.value.crt = 2;
      Settings.apply(); Doom.presetTest.render();
      Doom.presetTest.check(Doom.crtEnabled === 2, 'Shader retry failed')`);
  }
  console.log('PASS: Royale context recovery and shader rejection on both renderers');
  await evaluate(`Settings.value.renderer = false; Settings.value.crt = 0;
    Settings.apply(); localStorage.clear()`);
}
