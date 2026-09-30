/** Check sprite/floor depth with deterministic geometry through real WebGL. */
export async function testSprites(evaluate) {
  const moving = await evaluate(`(${function () {
    const e = Doom.engine, g = Doom.graphics;
    const {key, tick, check} = Doom.gpuTest;
    key(188); key(13);
    if (!e.FS.analyzePath('/doomsav0.dsg').exists)
      for (const c of 'FLOORS') key(c.toLowerCase().charCodeAt(0));
    key(13); tick(2);
    const save = e.FS.readFile('/doomsav0.dsg');
    const player = new DataView(save.buffer, save.byteOffset).getUint32(52, true);
    const memory = new DataView(e.HEAPU8.buffer);
    const read = offset => memory.getInt32(offset, true);
    const floors = new Map();
    // Walk the native 32-bit thinker list; mobj subsector is at byte 52.
    let object = player, count = 0;
    do {
      check(++count < 20000, 'Thinker list did not close');
      if (read(object + 8) === read(player + 8)) {
        const sector = read(read(object + 52));
        floors.set(sector, read(sector));
      }
      object = read(object + 4);
    } while (object !== player);
    e._web_advance(); // Snapshot the unchanged floors before moving them.
    const world = g.world, delta = 13.5 * 65536;
    let supports;
    g.world = (vertices, count, occluders, sprites, shadows) => {
      supports = [];
      const end = count + occluders + sprites + shadows;
      for (let i = count + occluders; i < end; i++)
        supports.push(vertices[i * 8 + 7]);
    };
    try {
      for (const [sector, z] of floors) memory.setInt32(sector, z + delta, true);
      for (const fraction of [0, 32768, 65536]) {
        const expected = new Set([...floors.values()]
          .map(z => (z + delta * fraction / 65536) / 65536));
        e._web_render(fraction);
        check(supports.length > 0, 'No visible sprites in the floor fixture');
        check(supports.every(z => expected.has(z)),
          'Sprite depth used a stale floor during interpolation');
        for (const [sector, z] of floors)
          check(read(sector) === z + delta, 'Rendering changed a live floor');
      }
      return {sectors: floors.size, vertices: supports.length};
    } finally {
      for (const [sector, z] of floors) memory.setInt32(sector, z, true);
      g.world = world;
      e._web_renderer(1, 1, 0); e._web_render(65536);
    }
  }.toString()})()`);
  console.log('PASS: sprite floor interpolation without simulation changes',
    moving);

  const result = await evaluate(`(${function () {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 200;
    const g = new DoomRenderer(canvas, Doom.engine);
    const gl = g.gl;
    const check = (value, message) => { if (!value) throw Error(message); };
    // Distinct, full-bright floor and sprite colors, including opaque feet.
    g.texture(0, 1, 1, new Uint8Array([100, 255]));
    g.texture(1, 1, 1, new Uint8Array([176, 255]));
    g.updatePalette();
    const red = g.paletteBytes.slice(g.mapBytes[176] * 4,
      g.mapBytes[176] * 4 + 3);
    const camera = [0, 0, 41, 0, 0, 160, 160, 0, 0, 320, 200, 0, 0, 0];
    const quad = (points, material, floor = 0) => [0, 1, 2, 2, 1, 3]
      .flatMap(i => [...points[i], 0, 0, material, 256, floor]);
    const floor = z => quad([[1, -256, z], [512, -256, z],
      [1, 256, z], [512, 256, z]], 0);
    const sprite = (bottom, top, support) => quad([[128, 24, top],
      [128, 24, bottom], [128, -24, top], [128, -24, bottom]], 1, support);
    const wall = quad([[120, 128, 128], [120, 128, -32],
      [120, -128, 128], [120, -128, -32]], 0);
    const solid = quad([[120, 128, 32768], [120, 128, -32768],
      [120, -128, 32768], [120, -128, -32768]], 0);
    const draw = (world, art, shadow = false, occluders = []) => {
      g.world(new Float32Array([...world, ...occluders, ...art]), world.length / 8,
        occluders.length / 8,
        shadow ? 0 : art.length / 8, shadow ? art.length / 8 : 0, 0, camera);
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer);
      const pixels = new Uint8Array(320 * 200 * 4);
      gl.readPixels(0, 0, 320, 200, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      check(gl.getError() === 0, 'Sprite depth fixture produced a GL error');
      return pixels;
    };
    const isSprite = (pixels, p) => red.every((value, c) => pixels[p + c] === value);
    let restored = 0, samples = 0, wallLeaks = 0;
    try {
      for (const support of [-24, 0, 16]) {
        for (const pitch of [-0.6, 0, 0.2]) {
          camera[4] = pitch;
          const art = sprite(support - 12, support + 44, support);
          const reference = draw([], art);
          const visible = draw(floor(support), art);
          // Negative control: the old world shader must reproduce the cutoff.
          const shader = g.sprites;
          g.sprites = g.scene;
          const clipped = draw(floor(support), art);
          g.sprites = shader;
          const occluded = draw([...floor(support), ...wall], art, false, solid);
          const leaking = draw([...floor(support), ...wall], art);
          let covered = 0;
          for (let p = 0; p < reference.length; p += 4) {
            if (!isSprite(reference, p)) continue;
            covered++;
            if (!isSprite(visible, p))
              throw Error('Sector floor cut off sprite artwork at '
                + [support, pitch, p / 4 % 320, Math.floor(p / 1280)]);
            check(!isSprite(occluded, p), 'Sprite leaked through a nearer wall');
            if (isSprite(leaking, p)) wallLeaks++;
            if (!isSprite(clipped, p)) restored++;
          }
          check(covered > 100, 'Sprite fixture fell outside the view');
          samples += covered;
        }
      }
      camera[4] = 0;
      const art = sprite(-12, 44, 0);
      const flat = draw(floor(0), art);
      const raised = draw([...floor(0), ...floor(24)], art);
      let hidden = 0;
      for (let p = 0; p < flat.length; p += 4)
        if (isSprite(flat, p) && !isSprite(raised, p)) hidden++;
      check(hidden > 100, 'A higher floor failed to occlude the sprite');

      // An airborne billboard must retain its position and exact visible pixels.
      const airborne = sprite(16, 60, 0);
      const reference = draw([], airborne);
      const floating = draw(floor(0), airborne);
      for (let p = 0; p < reference.length; p += 4)
        if (isSprite(reference, p))
          check(isSprite(floating, p), 'Airborne sprite changed position');

      // Spectres use the same depth rule in their separate fuzz draw.
      const shadow = [...art];
      for (let i = 6; i < shadow.length; i += 8) shadow[i] = -2;
      const ground = draw(floor(0), []);
      const fuzz = draw(floor(0), shadow, true);
      const shader = g.sprites;
      g.sprites = g.scene;
      const oldFuzz = draw(floor(0), shadow, true);
      g.sprites = shader;
      let fuzzyFeet = 0;
      for (let p = 0; p < ground.length; p += 4)
        if (fuzz[p] !== ground[p] && oldFuzz[p] === ground[p]) fuzzyFeet++;
      check(fuzzyFeet > 20, 'Floor still clipped a spectre');
      check(restored > 100, 'Negative control did not reproduce floor clipping');
      check(wallLeaks > 100, 'Negative control did not reproduce hidden feet');
      return {samples, restored, hidden, fuzzyFeet, wallLeaks};
    } finally {
      gl.getExtension('WEBGL_lose_context').loseContext();
    }
  }.toString()})()`);
  console.log('PASS: sprite feet, floor heights, pitch, occlusion and fuzz', result);
}
