/** Validate CRT reconstruction, native settings and both presentation paths. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

/** Exercise the actual GLSL with synthetic signals and a running IWAD. */
export async function testCRT(evaluate, send) {
  const signals = await evaluate(`(${function () {
    const check = (value, message) => { if (!value) throw Error(message); };
    check(!Doom.graphics && !Doom.crtDisplay && !Settings.value.crt,
      'Default software play allocated WebGL');
    check(!Settings.validate({crt: 'true'}).crt, 'Invalid stored CRT value');
    const canvas = document.createElement('canvas');
    const filter = new DoomCRT(canvas), gl = filter.gl;
    const read = () => {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height,
        gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(!gl.getError(), 'CRT GL error');
      return pixels;
    };
    const source = new Uint8Array(16 * 16 * 4);
    const fill = value => {
      for (let i = 0; i < source.length; i += 4) {
        source.fill(value, i, i + 3); source[i + 3] = 255;
      }
    };
    const results = [];
    for (const height of [16, 23, 32, 53, 96]) {
      canvas.width = 73; canvas.height = height;
      for (const value of [0, 16, 128, 255]) {
        fill(value); filter.software(source, 16, 16);
        const pixels = read();
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          check(pixels[i] === pixels[i + 1] && pixels[i] === pixels[i + 2],
            'Neutral signal acquired colored fringes');
          check(pixels[i] <= value && pixels[i] >= value * 0.93 - 1,
            'Excessive darkening, overshoot or lifted blacks');
          sum += pixels[i];
        }
        const mean = sum / (pixels.length / 4);
        check(mean >= value * 0.96 - 1, 'Mean brightness fell more than 4%');
        results.push({height, value, mean});
        filter.software(source, 16, 16);
        check(read().every((v, i) => v === pixels[i]), 'Static image flickers');
      }
    }
    // A hard black/white edge must become a monotonic, light-aware transition.
    canvas.width = 128; canvas.height = 96;
    fill(0);
    for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++)
      source.fill(255, (y * 16 + x) * 4, (y * 16 + x) * 4 + 3);
    filter.software(source, 16, 16);
    const edge = read();
    const row = Array.from({length: 128}, (_, x) => edge[(3 * 128 + x) * 4]);
    check(row.every((v, x) => !x || v >= row[x - 1]), 'Ringing around edge');
    check(row[63] > 150 && row[63] < 210, 'Missing light-space reconstruction');
    check(row.filter(v => v > 10 && v < 240).length > 8,
      'CRT remained nearest-neighbor');
    // Software is top-down; framebuffer textures are bottom-up.
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const at = (y * 16 + x) * 4;
      source[at] = y < 8 ? 255 : 0;
      source[at + 1] = 0; source[at + 2] = y < 8 ? 0 : 255;
    }
    filter.software(source, 16, 16);
    const upright = read();
    check(upright[2] > 240 && upright[(95 * 128) * 4] > 240,
      'Software CRT image upside down');
    const flipped = new Uint8Array(source.length);
    for (let y = 0; y < 16; y++)
      flipped.set(source.subarray(y * 64, (y + 1) * 64), (15 - y) * 64);
    filter.software(flipped, 16, 16);
    filter.present(filter.texture, 16, 16);
    check(read().every((v, i) => Math.abs(v - upright[i]) <= 1),
      'Hardware and software CRT orientation disagree');
    gl.getExtension('WEBGL_lose_context').loseContext();
    return results;
  }} )()`);
  console.log('PASS: CRT signal reconstruction, brightness and stability', signals);

  await evaluate(`(${function () {
    const e = Doom.engine;
    const check = (value, message) => { if (!value) throw Error(message); };
    const tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        e._web_tick(); if (Settings.flush()) e._web_render(65536);
      }
    };
    const key = code => {
      e._web_key(code, 1); tick(); e._web_key(code, 0); tick();
    };
    const close = () => {
      for (let i = 0; i < 8 && (e._web_state() & 16); i++) key(27);
    };
    const video = () => {
      close(); key(27); key(101); key(13);
      key(99); key(13);
    };
    const render = () => { e._web_render(65536); Doom.draw(); };
    tick(3); key(13); key(13);
    if (!e.FS.analyzePath('/doom2.wad').exists) key(13);
    key(13); tick(80);
    video(); key(99); key(174);
    check(e._web_setting(6) && Doom.crtEnabled && !Doom.hardware,
      'Native CRT option changed world renderer');
    check(!Doom.graphics, 'Software CRT allocated geometry resources');
    check(JSON.parse(localStorage.getItem('doom:settings')).crt,
      'CRT choice not persisted');
    const stored = Settings.validate(JSON.parse(localStorage.getItem('doom:settings')));
    Settings.value = Settings.validate(null); Settings.apply();
    Settings.value = stored; Settings.apply();
    check(Doom.crtEnabled, 'CRT preference not restored');
    key(27); check(e._web_state() & 16, 'CRT menu Escape skipped parent');
    close(); render();
    const original = e.HEAPU8.slice(e._web_pixels(), e._web_pixels() + 256000);
    Settings.value.crt = false; Settings.apply(); render();
    check(original.every((v, i) => v === e.HEAPU8[e._web_pixels() + i]),
      'CRT changed engine pixels');
    Settings.value.crt = true; Settings.apply(); render();
    Doom.crtTest = {check, key, close, video, render};
  }} )()`);
  console.log('PASS: CRT native menu, persistence and software round trip');

  for (const renderer of [false, true]) {
    for (const [width, height, density, scale, aspect] of [
      [960, 600, 1, 1, 'classic'], [887, 553, 2, 1, 'browser'],
      [600, 900, 1, 2, 'classic'], [960, 600, 2, 0, 'browser'],
      [1280, 720, 3, 1, 'browser'],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: density, mobile: false,
      });
      const result = await evaluate(`(() => {
        const {check, render} = Doom.crtTest;
        Settings.value.renderer = ${renderer}; Settings.value.crt = true;
        Settings.value.scale = ${scale}; Settings.value.aspect = '${aspect}';
        Settings.apply(); render();
        const canvas = Doom.canvas, rect = canvas.getBoundingClientRect();
        check(canvas.width === Math.round(rect.width * devicePixelRatio)
          && canvas.height === Math.round(rect.height * devicePixelRatio),
          'CRT output not at display density');
        check(Doom.image.width === Doom.width && Doom.image.height === Doom.height,
          'CRT output size leaked into engine image');
        const display = Doom.hardware ? Doom.graphics : Doom.crtDisplay;
        const gl = display.gl;
        const read = () => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height,
            gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels;
        };
        const pixels = read();
        check(pixels.some((v, i) => i % 4 !== 3 && v > 50), 'Black CRT frame');
        const upload = gl.texSubImage2D, readPixels = gl.readPixels;
        const uploads = [];
        gl.texSubImage2D = function(...args) {
          uploads.push(args[8].byteLength);
          return upload.apply(this, args);
        };
        gl.readPixels = () => { throw Error('CRT performed CPU readback'); };
        try { render(); } finally {
          gl.texSubImage2D = upload; gl.readPixels = readPixels;
        }
        if (Doom.hardware) check(uploads.length === 1 && uploads[0] === 1024000,
          'Hardware CRT uploaded a screen-sized CPU image');
        check(read().every((v, i) => v === pixels[i]),
          'CRT changed scene texture bindings between frames');
        check(!gl.getError() && !display.failed, 'CRT resize failed');
        return {renderer: Doom.hardware, source: [Doom.width, Doom.height],
          display: [canvas.width, canvas.height]};
      })()`);
      console.log('PASS: CRT viewport', result);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 960, height: 600, deviceScaleFactor: 1, mobile: false,
  });
  if (process.env.DOOM_SCREENSHOTS) {
    for (const renderer of [false, true]) for (const crt of [false, true]) {
      await evaluate(`Settings.value.renderer = ${renderer};
        Settings.value.crt = ${crt}; Settings.value.scale = 1;
        Settings.value.aspect = 'classic'; Settings.apply(); Doom.crtTest.render()`);
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      await writeFile(process.env.DOOM_SCREENSHOTS
        + '-crt-' + (renderer ? 'gpu' : 'software') + '-' + crt + '.png',
      Buffer.from(data, 'base64'));
    }
    await evaluate('Doom.crtTest.video(); Doom.draw()');
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-crt-menu.png',
      Buffer.from(data, 'base64'));
  }
  for (const renderer of [false, true]) {
    await evaluate(`Settings.value.renderer = ${renderer};
      Settings.value.crt = true; Settings.apply(); Doom.crtTest.render();
      (Doom.hardware ? Doom.graphics : Doom.crtDisplay).gl
        .getExtension('WEBGL_lose_context').loseContext()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(await evaluate(`(() => {
      Settings.flush(); Doom.crtTest.render();
      return Doom.running && !Doom.hardware && !Doom.crtEnabled
        && !Doom.engine._web_setting(6);
    })()`), 'Lost CRT context did not fall back');
    assert(await evaluate(`(() => {
      Settings.value.renderer = ${renderer}; Settings.value.crt = true;
      Settings.apply(); Doom.crtTest.render();
      return Doom.crtEnabled && !Doom.crtFailed;
    })()`), 'CRT retry failed after context loss');
  }
  console.log('PASS: CRT context loss and recovery on both renderers');

  await evaluate(`Settings.value.renderer = false; Settings.value.crt = true;
    Settings.value.scale = 1; Settings.value.aspect = 'classic'; Settings.apply()`);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 960, height: 600, deviceScaleFactor: 2, mobile: false,
  });
  assert.deepEqual(await evaluate(`(() => {
    Settings.videoDirty = false;
    Settings.flush(); Doom.crtTest.render();
    return [Doom.width, Doom.height, Doom.canvas.width, Doom.canvas.height];
  })()`), [320, 200, 1600, 1200], 'CRT missed density-only change in fixed mode');

  assert(await evaluate(`(() => {
    Settings.value.crt = false; Settings.apply();
    const display = Doom.crtDisplay;
    Doom.crtDisplay = null;
    const getContext = HTMLCanvasElement.prototype.getContext;
    try {
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...args);
      };
      Settings.value.crt = true; Settings.apply(); Doom.crtTest.render();
      return Doom.running && !Doom.crtEnabled && !Doom.engine._web_setting(6)
        && Doom.crtFailed && Doom.canvas === Doom.softwareCanvas;
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext;
      Doom.crtDisplay = display;
    }
  })()`), 'Unavailable WebGL did not preserve plain software play');
  await evaluate(`(() => {
    Settings.value.crt = true; Settings.apply();
    const {video, key, check, render} = Doom.crtTest;
    video(); key(27); key(112); key(172); render();
    check(!Doom.crtEnabled && !Doom.engine._web_setting(6),
      'Default preset left CRT enabled');
  })()`);
  console.log('PASS: CRT density-only resize, unavailable WebGL and defaults');
}
