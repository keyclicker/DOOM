/** Verify settings through native menus and the real software renderer. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

/** Run after the baseline game suite has created a native save. */
export async function testSettings(evaluate, send) {
  const results = await evaluate(`(() => {
    const e = Doom.engine;
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        e._web_tick();
        if (Settings.flush()) e._web_render(65536);
      }
    };
    const key = code => {
      e._web_key(code, 1); tick(); e._web_key(code, 0); tick();
    };
    const hash = () => {
      let result = 2166136261;
      const pixels = e.HEAPU8.subarray(e._web_pixels(), e._web_pixels()
        + Doom.canvas.width * Doom.canvas.height * 4);
      for (const byte of pixels) result = Math.imul(result ^ byte, 16777619);
      return result >>> 0;
    };
    const closeMenus = () => {
      for (let depth = 0; (e._web_state() & 16) && depth < 8; depth++) key(27);
      check(!(e._web_state() & 16), 'Menu stack did not close');
    };
    Doom.testCloseMenus = closeMenus;
    closeMenus();
    key(189); key(13); tick(80);
    const settings = () => {
      key(27); key(101); key(13);
    };
    const page = letter => { key(letter.charCodeAt(0)); key(13); };
    check(!document.querySelector('dialog'), 'Settings still use HTML');
    e._web_save_defaults();
    check(/screenblocks\\s+10/.test(e.FS.readFile('/.doomrc', {encoding: 'utf8'})),
      'Default view must fill the screen with the status bar visible');
    // Escape returns one level, and cancels capture without leaving its page.
    settings(); page('r'); key(27);
    check(e._web_state() & 16, 'Escape closed the settings stack');
    page('r'); key(117); key(174);
    check(e._web_setting(2) === 1, 'Escape did not return to Settings');
    key(174); key(27); page('k'); page('m');
    key(13); key(27); key(13); key(119);
    check(e._web_binding(0) === 119, 'Escape left the key-capture page');
    key(13); key(173);
    check(e._web_binding(0) === 173, 'Could not restore the captured binding');
    for (let level = 0; level < 3; level++) {
      key(27);
      check(e._web_state() & 16, 'Escape skipped a parent menu');
    }
    key(27);
    check(!(e._web_state() & 16), 'Main menu Escape did not resume play');

    settings(); page('r'); key(114);

    const frames = [];
    for (const scale of [1, 2, 3, 4, 5, 6]) {
      if (scale > 1) key(174);
      check(e._web_setting(0) === scale, 'Native resolution menu failed');
      closeMenus();
      tick(3); Doom.draw();
      check(Doom.canvas.width === 320 * scale
        && Doom.canvas.height === 200 * scale, 'Resolution did not change');
      check(Doom.image.width === Doom.canvas.width, 'Stale ImageData dimensions');
      const start = performance.now();
      for (let i = 0; i < 20; i++) { e._web_render(65536); Doom.draw(); }
      frames.push({scale, hash: hash(), frameMs: (performance.now() - start) / 20});
      // A real high-resolution view contains detail inside scaled pixel blocks.
      if (scale > 1) {
        const pixels = new Uint32Array(e.HEAPU8.buffer, e._web_pixels(),
          Doom.canvas.width * Doom.canvas.height);
        let detail = 0;
        for (let y = 40 * scale; y < 120 * scale; y += scale) {
          for (let x = 60 * scale; x < 260 * scale; x += scale) {
            const at = y * Doom.canvas.width + x;
            if (pixels[at] !== pixels[at + 1]) detail++;
          }
        }
        check(detail > 20, 'Resolution only scaled the original image');
      }
      settings(); page('r');
    }
    key(97); key(174);
    check(e._web_setting(1) === 1, 'Native aspect menu failed');
    closeMenus(); tick(3); Doom.draw();
    check(Doom.canvas.classList.contains('browser-aspect'), 'Aspect not applied');
    const aspect = Doom.canvas.getBoundingClientRect();
    check(aspect.width === innerWidth && aspect.height === innerHeight,
      'Native aspect did not fill the browser');

    // Camera movement must change sub-tic images without modifying game state.
    e._web_key(172, 1);
    for (let i = 0; i < 5; i++) e._web_advance();
    e._web_render(0); const previous = hash();
    e._web_render(32768); const between = hash();
    e._web_render(65536); const current = hash();
    check(previous !== between && between !== current,
      'Unlocked rendering did not interpolate movement');
    e._web_render(32768); e._web_render(65536);
    check(hash() === current, 'Interpolation accumulated into simulation');
    e._web_key(172, 0); tick();

    // Rendered intermediates must leave every live object's coordinates intact.
    key(188); key(13); key(13); tick(5);
    const saveNow = e.FS.readFile('/doomsav0.dsg');
    const playerObject = new DataView(saveNow.buffer, saveNow.byteOffset)
      .getUint32(52, true);
    // Changing the viewed player's uniform must never affect its own camera.
    // At running speed, the interpolated camera trails more than MINZ behind.
    const memory = new DataView(e.HEAPU8.buffer);
    const flagsAt = playerObject + 104;
    const originalFlags = memory.getInt32(flagsAt, true);
    let movedFar = false;
    e._web_key(173, 1); e._web_key(182, 1);
    for (let step = 0; step < 16; step++) {
      const x = memory.getInt32(playerObject + 12, true);
      const y = memory.getInt32(playerObject + 16, true);
      e._web_advance();
      movedFar ||= Math.hypot(memory.getInt32(playerObject + 12, true) - x,
        memory.getInt32(playerObject + 16, true) - y) > 4 * 65536;
      e._web_render(0); const normal = hash();
      memory.setInt32(flagsAt, originalFlags ^ (1 << 26), true);
      e._web_render(0);
      check(hash() === normal, 'Viewed player sprite leaked into the camera');
      memory.setInt32(flagsAt, originalFlags, true);
    }
    e._web_key(173, 0); e._web_key(182, 0); tick();
    check(movedFar, 'Player-sprite regression did not reach running speed');

    const positions = () => {
      const memory = new DataView(e.HEAPU8.buffer);
      const thinkerFunction = memory.getUint32(playerObject + 8, true);
      const result = [];
      let next = playerObject;
      do {
        if (memory.getUint32(next + 8, true) === thinkerFunction) {
          result.push([12, 16, 20, 32].map(at => memory.getInt32(next + at, true)));
        }
        next = memory.getUint32(next + 4, true);
        check(result.length < 10000, 'Invalid thinker list');
      } while (next !== playerObject);
      return JSON.stringify(result);
    };
    e._web_advance();
    const positionsBefore = positions();
    for (const part of [0, 10000, 32768, 50000, 65536]) e._web_render(part);
    check(positions() === positionsBefore, 'Rendering changed object positions');

    // Native square pixels must preserve weapon artwork and scene proportions.
    e._web_video(640, 400, 0); e._web_render(65536);
    const crtPixels = new Uint32Array(e.HEAPU8.buffer, e._web_pixels(),
      640 * 400).slice();
    e._web_video(640, 480, 1); e._web_render(65536);
    const nativePixels = new Uint32Array(e.HEAPU8.buffer, e._web_pixels(),
      640 * 480);
    let same = 0, compared = 0;
    for (let y = 245; y < 333; y++) {
      for (let x = 280; x < 360; x++) {
        if (crtPixels[y * 640 + x]
          === nativePixels[Math.round(y * 1.2) * 640 + x]) same++;
        compared++;
      }
    }
    check(same / compared > 0.7,
      'Native resolution distorted the weapon: ' + same / compared);
    Doom.image = null; Settings.video(); tick();

    // Both frame modes advance 35 Hz; only presentation follows display rate.
    const requestFrame = window.requestAnimationFrame;
    const nativeTick = e._web_tick;
    const nativeAdvance = e._web_advance;
    const nativeRender = e._web_render;
    const rates = [];
    Settings.value.scale = 1; Settings.value.aspect = 'classic'; Settings.apply();
    try {
      window.requestAnimationFrame = () => 0;
      for (const unlocked of [false, true]) {
        let tics = 0, draws = 0;
        Settings.value.unlocked = unlocked;
        e._web_tick = () => { tics++; draws++; nativeTick(); };
        e._web_advance = () => { tics++; nativeAdvance(); };
        e._web_render = part => { draws++; nativeRender(part); };
        Doom.lastFrame = 0; Doom.elapsed = 0; Doom.suspended = false;
        for (let frame = 1; frame <= 200; frame++) Doom.frame(frame * 10);
        rates.push({tics, draws});
        check(tics >= 69 && tics <= 70, 'Game speed changed with frame rate');
        check(draws === (unlocked ? 200 : tics), 'Wrong presentation rate');
      }
    } finally {
      window.requestAnimationFrame = requestFrame;
      e._web_tick = nativeTick; e._web_advance = nativeAdvance;
      e._web_render = nativeRender;
      Doom.suspended = true;
      Doom.lastFrame = performance.now();
      Settings.value.unlocked = false;
      Settings.value.scale = 4; Settings.value.aspect = 'browser';
      Settings.apply(); tick(3);
    }

    // Exercise Doom's own detail toggle and every view size in the large buffer.
    key(191); tick(3);
    const lowPixels = new Uint32Array(e.HEAPU8.buffer, e._web_pixels(),
      Doom.canvas.width * Doom.canvas.height);
    const margin = (Doom.canvas.width
      - Doom.canvas.width) / 2;
    for (let y = 200; y < 400; y += 11) {
      for (let x = margin + 100; x < Doom.canvas.width - margin - 100; x += 2) {
        const at = y * Doom.canvas.width + x;
        check(lowPixels[at] === lowPixels[at + 1], 'Low detail broke pixel pairs');
      }
    }
    key(191);
    for (let i = 0; i < 8; i++) key(45);
    for (let i = 0; i < 8; i++) { tick(2); key(61); }
    key(45); tick(3);

    // Rebinding must affect native gameplay while leaving menu arrows intact.
    settings(); page('k'); page('m');
    key(102); key(13); key(119);
    check(e._web_binding(0) === 119, 'Native key capture failed');
    key(98); key(13); key(119);
    check(e._web_binding(1) === 175, 'Duplicate binding accepted');
    key(9);
    check(e._web_binding(1) === 175, 'Reserved binding accepted');
    key(27); closeMenus();
    tick(80);
    // Save the same position, then compare movement from each key after reload.
    key(188); key(13); key(13); tick(5);
    const base = e.FS.readFile('/doomsav0.dsg');
    const moved = code => {
      e.FS.writeFile('/doomsav0.dsg', base);
      key(189); key(13); tick(80);
      document.dispatchEvent(new KeyboardEvent('keydown', {code}));
      tick(20);
      document.dispatchEvent(new KeyboardEvent('keyup', {code}));
      key(188); key(13); key(13); tick(5);
      return [...e.FS.readFile('/doomsav0.dsg').subarray(52, 90)];
    };
    // player_t bob/momentum is in the saved player data; viewz changes when moving.
    check(JSON.stringify(moved('KeyW')) !== JSON.stringify(moved('ArrowUp')),
      'Rebinding did not change the movement action');
    check(JSON.parse(localStorage.getItem('doom:settings')).keys[0] === 119,
      'Bindings not persisted');

    settings(); page('r');
    key(117); key(174); key(27); page('h'); key(102); key(174);
    check(Settings.value.unlocked && Settings.value.fps,
      'Rendering/HUD settings not applied');
    Settings.frames = 0; Settings.sampleTime = 1000;
    for (let i = 1; i <= 60; i++) Settings.presented(1000 + i * 1000 / 60);
    closeMenus();
    e._web_render(65536); const withCounter = hash();
    e._web_fps(99); e._web_render(65536);
    check(hash() !== withCounter, 'FPS counter is not in the framebuffer');
    // Keep the status bar and side gutters identical when menus close.
    const bar = () => {
      const width = Doom.canvas.width, height = Doom.canvas.height;
      const bytes = e.HEAPU8.subarray(e._web_pixels()
        + width * Math.floor(height * 168 / 200) * 4,
        e._web_pixels() + width * height * 4);
      // Face expressions keep animating while the single-player menu is open.
      const first = (width - 320 * 4) / 2;
      return [...bytes].filter((_, i) => {
        const x = Math.floor(i / 4) % width;
        return x < first + 143 * 4 || x >= first + 177 * 4;
      }).join(',');
    };
    e._web_render(65536); const cleanBar = bar();
    settings(); page('k'); page('m'); closeMenus();
    e._web_render(65536);
    check(bar() === cleanBar, 'Menu left pixels on the status bar');
    settings(); page('k'); page('m'); Doom.draw();
    return {frames, rates, interpolation: [previous, between, current],
      memoryBytes: e.HEAPU8.length};
  })()`);
  if (process.env.DOOM_SCREENSHOTS) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-settings.png',
      Buffer.from(data, 'base64'));
    await evaluate('Doom.testCloseMenus(); Doom.draw()');
    const screenshot = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-game.png',
      Buffer.from(screenshot.data, 'base64'));

    for (const page of ['main', 'options', 'root', 'rendering', 'crt', 'hud',
      'keyboard', 'actions']) {
      await evaluate(`(() => {
        Doom.testCloseMenus();
        const e = Doom.engine;
        const key = code => {
          e._web_key(code, 1); e._web_tick();
          e._web_key(code, 0); e._web_tick();
        };
        key(27);
        if ('${page}' === 'options') { key(111); key(13); }
        else if ('${page}' !== 'main') { key(101); key(13); }
        if ('${page}' === 'rendering') { key(114); key(13); }
        if ('${page}' === 'crt') { key(99); key(13); }
        if ('${page}' === 'hud') { key(104); key(13); }
        if ('${page}' === 'keyboard') { key(107); key(13); }
        if ('${page}' === 'actions') {
          key(107); key(13); key(97); key(13);
        }
        Doom.draw();
      })()`);
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      await writeFile(process.env.DOOM_SCREENSHOTS + '-' + page + '.png',
        Buffer.from(data, 'base64'));
    }
    await evaluate('Doom.testCloseMenus()');
  }
  // A real viewport resize exercises cached projection and buffer recreation.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const dimensions = await evaluate(`(() => {
    Doom.suspended = true; Settings.flush();
    for (let i = 0; i < 3; i++) Doom.engine._web_tick();
    Doom.draw();
    return [Doom.canvas.width, Doom.canvas.height];
  })()`);
  assert.deepEqual(dimensions, [1706, 800]);
  if (process.env.DOOM_SCREENSHOTS) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-wide.png',
      Buffer.from(data, 'base64'));
  }
  for (const [width, height] of [[720, 1280], [2560, 720]]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const size = await evaluate(`(() => {
      Settings.flush();
      for (let i = 0; i < 3; i++) Doom.engine._web_tick();
      Doom.draw();
      return [Doom.image.width, Doom.image.height];
    })()`);
    assert.equal(size[0], Math.round(800 * width / height * 1.2 / 2) * 2);
    assert.equal(size[1], 800);
    if (process.env.DOOM_SCREENSHOTS) {
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      await writeFile(process.env.DOOM_SCREENSHOTS + '-' + width + '.png',
        Buffer.from(data, 'base64'));
    }
  }
  // Native mode uses actual display pixels, including DPR changes alone.
  await evaluate(`(() => {
    const e = Doom.engine;
    const key = code => {
      e._web_key(code, 1); e._web_tick();
      e._web_key(code, 0); e._web_tick(); Settings.flush();
    };
    Doom.testCloseMenus();
    key(27); key(101); key(13); key(114); key(13);
    key(114);
    while (e._web_setting(0) !== 0) key(174);
    Doom.testCloseMenus();
  })()`);
  for (const [width, height, dpr] of [[1280, 720, 1], [1280, 720, 2],
    [1440, 900, 2], [1920, 1080, 2], [1024, 768, 3], [720, 1280, 2]]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile: false,
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const size = await evaluate(`(() => {
      Settings.flush();
      Doom.engine._web_render(65536); Doom.draw();
      return [Doom.canvas.width, Doom.canvas.height];
    })()`);
    assert.deepEqual(size, [width * dpr, height * dpr]);
  }
  if (process.env.DOOM_SCREENSHOTS) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(process.env.DOOM_SCREENSHOTS + '-retina.png',
      Buffer.from(data, 'base64'));
  }
  // Classic aspect at native resolution fills the fitted 4:3 canvas.
  const classic = await evaluate(`(() => {
    Settings.value.aspect = 'classic'; Settings.apply();
    Doom.engine._web_render(65536); Doom.draw();
    return [Doom.canvas.width, Doom.canvas.height];
  })()`);
  assert.deepEqual(classic, [1440, 1080]);
  await send('Emulation.clearDeviceMetricsOverride');
  await evaluate(`(() => {
    const e = Doom.engine;
    const key = code => {
      e._web_key(code, 1); e._web_tick();
      e._web_key(code, 0); e._web_tick(); Settings.flush();
    };
    // Escape closes any page left open for a screenshot, then select the global Default preset.
    Doom.testCloseMenus();
    key(27); key(101); key(13); key(112); key(174);
    Doom.testCloseMenus();
    Doom.suspended = true;
    Doom.engine._web_tick(); Doom.draw();
    if (Settings.value.scale !== 1 || Settings.value.unlocked
      || Settings.value.fps || Settings.value.aspect !== 'classic') {
      throw Error('Default preset failed');
    }
  })()`);
  console.log('PASS: settings, resolution detail, aspect, interpolation, bindings',
    JSON.stringify(results));
}
