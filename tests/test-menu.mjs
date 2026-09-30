/** Exercise Extra Options through native keys and capture every menu page. */
import {writeFile} from 'node:fs/promises';

/** Verify presets, disabled controls, map bindings and the menu stack. */
export async function testMenu(evaluate, send) {
  await evaluate(`(${function () {
    const e = Doom.engine;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const key = code => {
      e._web_key(code, 1); e._web_tick();
      e._web_key(code, 0); e._web_tick();
      Settings.flush(); e._web_render(65536);
    };
    const page = letter => { key(letter.charCodeAt(0)); key(13); };
    const close = () => {
      for (let i = 0; i < 8 && (e._web_state() & 16); i++) key(27);
      check(!(e._web_state() & 16), 'Menu stack did not close');
    };
    const extra = () => { close(); key(27); page('e'); };
    const values = () => Array.from({length: 7}, (_, i) => e._web_setting(i));
    const keys = () => Settings.defaults.map((_, i) => e._web_binding(i));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const defaults = [1, 0, 0, 0, 0, 0, 0];
    const emulation = [1, 0, 0, 0, 0, 0, 1];
    const modern = [0, 1, 1, 0, 1, 1, 0];

    Settings.value = Settings.validate(null);
    Settings.apply();

    // Start actual gameplay so map actions and the status bar can be checked.
    e._web_tick(); key(27); page('n');
    if (!e.FS.analyzePath('/doom2.wad').exists) key(13);
    key(13);
    for (let i = 0; i < 80; i++) e._web_tick();
    check((e._web_state() & 15) === 0, 'New Game no longer starts a level');
    // Compare menu patches with the original IWAD at their original positions.
    const commercial = e.FS.analyzePath('/doom2.wad').exists;
    const wad = e.FS.readFile('/' + e.FS.readdir('/')
      .find(name => name.endsWith('.wad')));
    const directory = new DataView(wad.buffer, wad.byteOffset);
    const lumps = new Map();
    for (let i = 0; i < directory.getInt32(4, true); i++) {
      const at = directory.getInt32(8, true) + i * 16;
      const name = new TextDecoder().decode(wad.subarray(at + 8, at + 16))
        .replace(/\0.*$/, '');
      lumps.set(name, directory.getInt32(at, true));
    }
    const patchMatches = (name, x, y) => {
      const at = lumps.get(name);
      check(at !== undefined, 'Missing menu patch ' + name);
      const width = directory.getInt16(at, true);
      x -= directory.getInt16(at + 4, true);
      y -= directory.getInt16(at + 6, true);
      const pixels = new Uint32Array(e.HEAPU8.buffer, e._web_pixels(), 64000);
      const palette = new Uint32Array(e.HEAPU8.buffer, e._web_palette(), 256);
      for (let col = 0; col < width; col++) {
        let post = at + directory.getInt32(at + 8 + col * 4, true);
        while (wad[post] !== 255) {
          for (let row = 0; row < wad[post + 1]; row++) {
            check(pixels[(y + wad[post] + row) * 320 + x + col]
              === palette[wad[post + 3 + row]],
              name + ' no longer uses its original artwork and position');
          }
          post += wad[post + 1] + 4;
        }
      }
    };
    const backdrop = new Uint32Array(e.HEAPU8.buffer,
      e._web_pixels(), 64000).slice();
    key(27);
    const mainY = commercial ? 72 : 64;
    // Neighboring shadows must reveal the world, not be painted black.
    const extraPixels = new Uint32Array(e.HEAPU8.buffer,
      e._web_pixels(), 64000);
    for (const [x, y] of [[15, 5], [15, 6], [15, 7], [15, 8], [15, 9],
      [32, 7], [32, 8], [71, 3], [71, 4]]) {
      const at = (mainY + 32 + y) * 320 + 97 + x;
      check(extraPixels[at] === backdrop[at],
        'Extra Options contains a neighboring glyph pixel');
    }
    patchMatches('M_DOOM', 94, 2);
    patchMatches('M_NGAME', 97, mainY);
    patchMatches('M_OPTION', 97, mainY + 16);
    patchMatches('M_OPTION', 177, mainY + 32);
    patchMatches('M_LOADG', 97, mainY + 48);
    patchMatches('M_SAVEG', 97, mainY + 64);
    if (!commercial) patchMatches('M_RDTHIS', 97, mainY + 80);
    page('o');
    patchMatches('M_OPTTTL', 108, 15);
    for (const [name, row] of [['M_ENDGAM', 0], ['M_MESSG', 1],
      ['M_DETAIL', 2], ['M_SCRNSZ', 3], ['M_MSENS', 5], ['M_SVOL', 7]]) {
      patchMatches(name, 60, 37 + row * 16);
    }
    patchMatches('M_GDHIGH', 235, 69);
    patchMatches('M_MSGON', 180, 53);
    patchMatches('M_THERML', 60, 101);
    patchMatches('M_THERML', 60, 133);
    close();
    key(196); // The removed F10 quit action must not open a confirmation.
    check(!(e._web_state() & 16), 'Quit shortcut is still active');

    // Old ten-action storage must survive adding the eleventh (map) action.
    const legacy = [...Settings.defaults.slice(0, 10)];
    legacy[0] = 119;
    check(same(Settings.validate({keys: legacy}).keys, [...legacy, 9]),
      'Existing custom bindings were lost during migration');
    check(Settings.validate({keys: [...legacy, 119]}).keys[0] === 173,
      'Duplicate map binding accepted from storage');

    extra(); page('k'); page('p');
    const wasd = keys();
    check(wasd[0] === 119 && wasd[7] === 101 && wasd[10] === 9,
      'Keyboard preset did not apply');
    key(27); key(112); key(174);
    check(same(values(), defaults) && same(keys(), Settings.defaults),
      'Global Default did not restore Original bindings');
    for (const expected of [emulation, modern, defaults]) {
      key(174);
      check(same(values(), expected), 'Presentation preset values differ');
      check(same(keys(), expected === modern ? wasd : Settings.defaults),
        'Global preset did not apply its keyboard preset');
      e._web_save_defaults();
      check(/screenblocks\s+10/.test(e.FS.readFile('/.doomrc', {encoding: 'utf8'})),
        'Preset did not preserve the full view with status bar');
    }
    key(172); check(same(values(), modern), 'Preset did not wrap left');
    key(174); check(same(values(), defaults), 'Preset did not wrap right');
    page('h'); key(174); key(27); key(112); key(174);
    check(same(values(), defaults), 'Custom did not return to Default');
    page('h'); key(174); key(27); key(112); key(172);
    check(same(values(), modern), 'Custom did not return to Modern');
    key(174);

    // Disabled rows must be skipped rather than swallowing navigation.
    page('c');
    key(175); key(174);
    check(e._web_setting(6) === 1, 'Down arrow focused a future CRT control');
    key(173); key(172);
    check(e._web_setting(6) === 0, 'Up arrow focused a future CRT control');
    key(27); page('h'); key(175); key(174);
    check(e._web_setting(3) === 1, 'Future HUD control received focus');
    key(173); key(172);
    check(e._web_setting(3) === 0, 'HUD navigation did not wrap');

    // Rebind the map through the UI, check conflict rejection and both edges.
    key(27); page('k'); page('a'); key(116); key(13); key(173);
    check(e._web_binding(10) === 9, 'Duplicate action key accepted');
    key(113);
    check(e._web_binding(10) === 113, 'Map capture failed');
    const stored = JSON.parse(localStorage.getItem('doom:settings'));
    check(stored.keys[10] === 113, 'Map key was not persisted');
    Settings.value = Settings.validate(stored); Settings.apply();
    check(e._web_binding(10) === 113, 'Map key did not restore');
    close();
    Settings.value.renderer = true; Settings.apply();
    e._web_render(65536);
    // web_world reports whether the game is drawing a level or an automap.
    key(9); check(e._web_world(), 'Old Tab binding still opens the map');
    key(113); check(!e._web_world(), 'New binding did not open the map');
    key(113); check(e._web_world(), 'New binding did not close the map');
    extra(); page('k'); page('p');
    check(same(keys(), Settings.defaults), 'Original keys did not restore');
    close(); key(9); check(!e._web_world(), 'Original Tab no longer opens map');
    key(9); check(e._web_world(), 'Original Tab no longer closes map');

    extra(); page('k'); page('a');
    for (let i = 0; i < 3; i++) {
      key(27); check(e._web_state() & 16, 'Escape skipped a parent');
    }
    key(27); check(!(e._web_state() & 16), 'Escape did not resume play');
    Doom.menuTest = {key, page, close, extra};
  }.toString()})()`);
  console.log('PASS: original menu artwork, presets, disabled rows, automap,'
    + ' key migration');

  if (!process.env.DOOM_SCREENSHOTS) return;
  const game = await evaluate(
    "Doom.engine.FS.analyzePath('/doom2.wad').exists ? 'doom2' : 'doom1'");
  for (const [name, width, height, dpr, native, renderer] of [
    ['classic', 960, 720, 1, false, false],
    ['retina', 1440, 900, 2, true, true],
    ['portrait', 720, 1280, 2, true, false],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile: false,
    });
    await evaluate(`Settings.value.scale = ${native ? 0 : 1};
      Settings.value.aspect = '${native ? 'browser' : 'classic'}';
      Settings.value.renderer = ${renderer}; Settings.apply()`);
    for (const page of ['main', 'options', 'extra', 'rendering', 'crt', 'hud',
      'keyboard', 'movement', 'actions']) {
      await evaluate(`(() => {
        const {key, page, close, extra} = Doom.menuTest;
        close(); key(27);
        if ('${page}' === 'options') page('o');
        else if ('${page}' !== 'main') {
          page('e');
          if ('${page}' === 'rendering') page('r');
          if ('${page}' === 'crt') page('c');
          if ('${page}' === 'hud') page('h');
          if (['keyboard', 'movement', 'actions'].includes('${page}')) page('k');
          if ('${page}' === 'movement') page('m');
          if ('${page}' === 'actions') page('a');
        }
        Doom.engine._web_render(65536); Doom.draw();
      })()`);
      const {data} = await send('Page.captureScreenshot', {format: 'png'});
      await writeFile(`${process.env.DOOM_SCREENSHOTS}-${game}-${name}-${page}.png`,
        Buffer.from(data, 'base64'));
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
}
