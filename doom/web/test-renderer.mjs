/** Exercise opt-in geometry rendering through Chromium's real WebGL API. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

/** Check rendering, native options, pitch, transitions and context recovery. */
export async function testRenderer(evaluate, send) {
  const setup = await evaluate(`(${function () {
    const e = Doom.engine;
    const check = (value, message) => { if (!value) throw Error(message); };
    const tick = (count = 1) => {
      for (let i = 0; i < count; i++) {
        e._web_tick();
        if (Settings.flush()) e._web_render(65536);
      }
    };
    const key = code => {
      e._web_key(code, 1); tick(); e._web_key(code, 0); tick();
    };
    const close = () => {
      for (let i = 0; i < 8 && (e._web_state() & 16); i++) key(27);
    };
    const video = () => {
      close(); key(27); key(111); key(13); key(116); key(13);
      key(118); key(13);
    };
    const read = () => {
      Doom.draw();
      const g = Doom.graphics, gl = g.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
      const bytes = new Uint8Array(g.width * g.height * 4);
      gl.readPixels(0, 0, g.width, g.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      check(gl.getError() === 0, 'WebGL error');
      return bytes;
    };
    const hash = bytes => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619),
      2166136261) >>> 0;
    const render = () => { e._web_render(65536); return hash(read()); };
    check(!Settings.value.renderer && !Settings.value.freelook,
      'Enhancements enabled by default');
    check(!Doom.graphics, 'Software startup created a graphics context');
    tick(3); key(13); key(13);
    if (!e.FS.analyzePath('/doom2.wad').exists) key(13);
    key(13); tick(80);
    video(); key(102); key(174);
    check(e._web_setting(5) === 0, 'Free look enabled in software');
    key(101); key(174);
    check(Doom.hardware && e._web_setting(4), 'Native renderer option failed');
    check(!e._web_setting(5), 'Renderer implicitly enabled free look');
    key(102); key(174); close(); tick(2);
    check(e._web_setting(5), 'Native free look option failed');
    const center = render();
    const camera = [...Doom.graphics.lastCamera];
    e._web_mouse(0, 0, -150); tick();
    const up = render();
    check(Doom.graphics.pitch > 0.4, 'Mouse did not pitch upward');
    check(camera[0] === Doom.graphics.lastCamera[0]
      && camera[1] === Doom.graphics.lastCamera[1], 'Look moved the player');
    e._web_mouse(0, 0, 300); tick();
    const down = render();
    check(Doom.graphics.pitch < -0.4 && center !== up && up !== down,
      'Pitch did not change perspective');
    for (const dy of [-10000, 10000]) {
      e._web_mouse(0, 0, dy); tick(); render();
      check(Math.abs(Doom.graphics.pitch) < 1.484, 'Pitch limit failed');
    }
    // Restore neutral pitch, then verify interpolation without simulation drift.
    e._web_renderer(1, 1, 0);
    e._web_advance(); e._web_mouse(0, 0, -100); e._web_advance();
    const pitches = [];
    for (const fraction of [0, 32768, 65536]) {
      e._web_render(fraction); pitches.push(Doom.graphics.pitch);
    }
    check(pitches[0] < pitches[1] && pitches[1] < pitches[2],
      'Unlocked pitch does not interpolate');
    e._web_renderer(1, 1, 0);
    const software = () => {
      e._web_render(65536);
      return hash(e.HEAPU8.subarray(e._web_pixels(), e._web_pixels() + 256000));
    };
    Settings.value.renderer = false; Settings.apply();
    const before = software();
    Settings.value.renderer = true; Settings.apply(); render();
    Settings.value.renderer = false; Settings.apply();
    check(before === software(), 'Renderer switching changed software pixels');
    Settings.value.renderer = true; Settings.value.freelook = true;
    Settings.apply(); render();
    check(JSON.parse(localStorage.getItem('doom:settings')).renderer,
      'Renderer menu choice not persisted');
    key(9); tick(); render();
    check(!e._web_world(), 'Automap used the world renderer');
    key(9); tick(); render();
    check(e._web_world(), 'Returning from automap lost the renderer');
    // Freeze face animation and compare the exact native status bar pixels.
    const gpu = read();
    Settings.value.renderer = false; Settings.apply(); software();
    const overlay = e.HEAPU8.slice(e._web_pixels(), e._web_pixels() + 256000);
    for (let y = 168; y < 200; y++) for (let x = 0; x < 320; x++) {
      const at = (y * 320 + x) * 4, flipped = ((199 - y) * 320 + x) * 4;
      check(overlay[at + 3] === 255, 'Status bar lost alpha coverage');
      for (let c = 0; c < 3; c++)
        check(gpu[flipped + c] === overlay[at + c], 'Status bar colors differ');
    }
    Settings.value.renderer = true; Settings.apply(); render();
    Doom.gpuTest = {tick, key, close, video, read, hash, render, check};
    return {center, up, down, pitches, triangles: Doom.graphics.triangles};
  }.toString()})()`);
  console.log('PASS: GPU options, pitch, interpolation, HUD, switching', setup);

  if (process.env.DOOM_SCREENSHOTS) {
    await evaluate('Doom.gpuTest.video(); Doom.gpuTest.render()');
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-gpu-menu.png',
      Buffer.from(data, 'base64'));
    await evaluate('Doom.gpuTest.close(); Doom.gpuTest.render()');
  }

  const maps = await evaluate(`(${function () {
    const e = Doom.engine;
    const {key, tick, render, check, read} = Doom.gpuTest;
    const wad = e.FS.readFile('/' + e.FS.readdir('/').find(n => n.endsWith('.wad')));
    const view = new DataView(wad.buffer, wad.byteOffset);
    const offset = view.getUint32(8, true), names = [];
    for (let i = 0; i < view.getUint32(4, true); i++) {
      const name = new TextDecoder().decode(wad.subarray(offset + i * 16 + 8,
        offset + i * 16 + 16)).replace(/\0.*$/, '');
      if (/^(E[1-4]M[1-9]|MAP[0-9][0-9])$/.test(name)) names.push(name);
    }
    const results = [];
    for (const map of names) {
      const digits = map.startsWith('MAP') ? map.slice(3) : map[1] + map[3];
      for (const char of 'idclev' + digits) key(char.charCodeAt(0));
      tick(80);
      check((e._web_state() & 15) === 0, 'Could not enter ' + map);
      render();
      key(188); key(13);
      if (!e.FS.analyzePath('/doomsav0.dsg').exists)
        for (const c of 'GPU') key(c.toLowerCase().charCodeAt(0));
      key(13); tick(5);
      const save = e.FS.readFile('/doomsav0.dsg');
      check(save[42] === Number(map.startsWith('MAP') ? digits : digits[1]),
        'Wrong map after warp');
      const object = new DataView(save.buffer, save.byteOffset).getUint32(52, true);
      const memory = new DataView(e.HEAPU8.buffer);
      const angle = memory.getUint32(object + 32, true);
      for (let rotation = 0; rotation < 4; rotation++) {
        memory.setUint32(object + 32, angle + rotation * 0x40000000, true);
        for (const look of [0, -10000, 20000]) {
          if (look) { e._web_mouse(0, 0, look); tick(); }
          render();
          check(Doom.hardware && !Doom.graphics.failed, 'GPU failed in ' + map);
          const pixels = read();
          let visible = 0;
          // Exclude HUD: a broken viewport must not pass on status-bar colors.
          for (let p = 32 * 320 * 4; p < pixels.length; p += 4)
            if (pixels[p] || pixels[p + 1] || pixels[p + 2]) visible++;
          check(visible > 320 * 168 * 0.6, 'Missing geometry in ' + map
            + ' at rotation ' + rotation + ': ' + visible);
        }
        e._web_renderer(1, 1, 0);
      }
      memory.setUint32(object + 32, angle, true);
      results.push({map, triangles: Doom.graphics.triangles});
    }
    return {results, materials: Doom.graphics.materials,
      atlasHeight: Doom.graphics.atlasY + Doom.graphics.atlasRow};
  }.toString()})()`);
  console.log('PASS: all maps, four headings and extreme pitch', maps);

  // Exercise real canvas resizing, Retina dimensions and the reduced view.
  const sizes = [];
  for (const [width, height, dpr] of [[640, 480, 1], [1280, 720, 2],
    [1920, 1080, 2], [480, 800, 2], [887, 553, 2]]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    const result = await evaluate(`(() => {
      Settings.value.scale = 0; Settings.value.aspect = 'browser';
      Settings.apply();
      const e = Doom.engine;
      e._web_render(65536); Doom.draw();
      const gl = Doom.graphics.gl;
      const upload = gl.texSubImage2D;
      const uploads = [];
      gl.texSubImage2D = function(...args) {
        uploads.push(args[8].byteLength);
        return upload.apply(this, args);
      };
      try { Doom.draw(); } finally { gl.texSubImage2D = upload; }
      Doom.gpuTest.check(uploads.length === 1 && uploads[0] === 1024000,
        'World presentation uploaded a screen-sized CPU framebuffer');
      gl.finish();
      const start = performance.now();
      for (let i = 0; i < 5; i++) { e._web_render(65536); Doom.draw(); }
      gl.finish();
      const frameMs = (performance.now() - start) / 5;
      if (gl.getError()) throw Error('WebGL resize failed');
      // Isolate engine CPU work from the VM's software GPU implementation.
      const world = Doom.graphics.world;
      const cpu = [];
      Doom.graphics.world = () => {};
      try {
        for (let i = 0; i < 45; i++) {
          const begin = performance.now(); e._web_render(65536);
          if (i >= 5) cpu.push(performance.now() - begin);
        }
      } finally { Doom.graphics.world = world; }
      cpu.sort((a, b) => a - b);
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {size: [Doom.canvas.width, Doom.canvas.height],
        frameMs, cpuMedianMs: cpu[20],
        uploadBytes: uploads[0],
        device: info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)};
    })()`);
    assert.deepEqual(result.size, [width * dpr, height * dpr]);
    sizes.push(result);

    // Freeze simulation and compare GPU artwork to the actual software path.
    // Reduced views cover borders; help art covers overlapping anchor layers.
    await evaluate(`(${function () {
      const e = Doom.engine;
      const {key, read, check, close} = Doom.gpuTest;
      const compare = help => {
        e._web_render(65536);
        const gpu = read();
        const [vx, vy, vw, vh] = Doom.graphics.lastCamera.slice(7, 11);
        const [ax, ay, aw, ah] = new Int32Array(e.HEAPU8.buffer,
          e._web_overlay_layout(), 4);
        const {width, height} = Doom.canvas;
        Settings.value.renderer = false; Settings.apply();
        e._web_render(65536);
        const cpu = e.HEAPU8.subarray(e._web_pixels(),
          e._web_pixels() + width * height * 4);
        let compared = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const artwork = help && x >= ax && x < ax + aw
            && y >= ay && y < ay + ah;
          if (!artwork && x >= vx && x < vx + vw && y >= vy && y < vy + vh)
            continue;
          const at = (y * width + x) * 4;
          const flipped = ((height - 1 - y) * width + x) * 4;
          for (let c = 0; c < 3; c++)
            if (gpu[flipped + c] !== cpu[at + c])
              throw Error('Artwork differs at ' + x + ',' + y + ', help=' + help
                + ': GPU ' + gpu.slice(flipped, flipped + 3)
                + ', CPU ' + cpu.slice(at, at + 3));
          compared++;
        }
        check(compared > width * height / 100, 'Artwork comparison too small');
        Settings.value.renderer = true; Settings.apply();
      };
      compare(false);
      for (let i = 0; i < 5; i++) key(45);
      compare(false);
      key(187); compare(true); close();
      for (let i = 0; i < 5; i++) key(61);
    }.toString()})()`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`(() => {
    Settings.value.scale = 1; Settings.value.aspect = 'classic'; Settings.apply();
    const {key, render, check} = Doom.gpuTest;
    for (let i = 0; i < 8; i++) { key(45); render(); }
    for (let i = 0; i < 8; i++) { key(61); render(); }
    key(45); render();
    check(!Doom.graphics.failed, 'Reduced view corrupted GPU state');
  })()`);
  console.log('PASS: GPU native/Retina resizing and view sizes', sizes);

  // Context loss must resume software play, then permit explicit re-enabling.
  await evaluate(`Doom.graphics.gl.getExtension('WEBGL_lose_context').loseContext()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await evaluate(`(() => {
    Settings.flush(); Doom.engine._web_render(65536); Doom.draw();
    return Doom.running && !Doom.hardware && !Settings.value.freelook;
  })()`), 'Context loss did not fall back to software');
  assert(await evaluate(`(() => {
    Settings.value.renderer = true; Settings.apply();
    Doom.gpuTest.render();
    return Doom.hardware && Doom.graphics.materials > 0;
  })()`), 'Could not re-enable WebGL after context loss');
  console.log('PASS: context loss fallback and explicit recovery');
  assert(await evaluate(`(() => {
    Settings.value.renderer = false; Settings.apply();
    const graphics = Doom.graphics;
    Doom.graphics = null;
    const getContext = HTMLCanvasElement.prototype.getContext;
    try {
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === 'webgl2' ? null : getContext.call(this, type, ...args);
      };
      Settings.value.renderer = true; Settings.apply();
      Doom.engine._web_render(65536); Doom.draw();
      return Doom.running && !Doom.hardware && !Doom.engine._web_setting(4);
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext;
      Doom.graphics = graphics;
    }
  })()`), 'Unavailable WebGL did not preserve software play');
  console.log('PASS: unavailable WebGL fallback');
}
