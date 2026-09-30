/** Invisible map actors must stay out of both WebGL sprite passes. */
export async function testHiddenActors(evaluate) {
  const result = await evaluate(`(${function () {
    const e = Doom.engine, g = Doom.graphics;
    const {key, tick, close, check} = Doom.gpuTest;
    if (!e.FS.analyzePath('/doom2.wad').exists) return 'Doom II fixture only';
    close();
    for (const c of 'idclev02') key(c.charCodeAt(0));
    tick(80);
    key(188); key(13);
    if (!e.FS.analyzePath('/doomsav0.dsg').exists)
      for (const c of 'HIDDEN') key(c.toLowerCase().charCodeAt(0));
    key(13); tick(2);
    const save = e.FS.readFile('/doomsav0.dsg');
    const player = new DataView(save.buffer, save.byteOffset).getUint32(52, true);
    const memory = new DataView(e.HEAPU8.buffer);
    const read = at => memory.getInt32(at, true);
    const write = (at, value) => memory.setInt32(at, value, true);
    // Native wasm32 mobj layout: thinker function +8, flags +104.
    const noSector = 8, shadowFlag = 0x40000;
    const hidden = [];
    let object = player, visited = 0;
    do {
      check(++visited < 20000, 'Thinker list did not close');
      if (read(object + 8) === read(player + 8) && (read(object + 104) & noSector))
        hidden.push([object, read(object + 104), read(object + 8)]);
      object = read(object + 4);
    } while (object !== player);
    check(hidden.length === 1, 'MAP02 teleport destination fixture changed');
    const marker = hidden[0][0], angle = read(player + 32), world = g.world;
    let geometry;
    g.world = (vertices, count, occluders, sprites, shadows) => {
      geometry = Array.from(vertices.slice((count + occluders) * 9,
        (count + occluders + sprites + shadows) * 9));
    };
    const capture = () => { e._web_render(65536); return geometry; };
    try {
      const yaw = Math.atan2(read(marker + 16) - read(player + 16),
        read(marker + 12) - read(player + 12));
      write(player + 32, yaw * 0x100000000 / (2 * Math.PI));
      e._web_renderer(1, 1, 0);
      // Removing thinkers supplies the reference without trusting visibility flags.
      for (const [at] of hidden) write(at + 8, 0);
      const reference = capture();
      for (const [at, flags, fn] of hidden) write(at + 8, fn);
      for (const shadow of [0, shadowFlag]) {
        for (const [at, flags] of hidden) write(at + 104, flags | shadow);
        check(JSON.stringify(capture()) === JSON.stringify(reference),
          'Invisible teleport destination emitted WebGL sprite geometry');
        // Keep MF_NOBLOCKMAP: visible effects with that flag must still render.
        for (const [at, flags] of hidden)
          write(at + 104, (flags & ~noSector) | shadow);
        check(capture().length > reference.length,
          'Teleport sprite negative control was not visible');
      }
      return {hiddenActors: hidden.length, passes: 2};
    } finally {
      for (const [at, flags, fn] of hidden) {
        write(at + 104, flags); write(at + 8, fn);
      }
      write(player + 32, angle);
      g.world = world;
      e._web_renderer(1, 1, 0); e._web_render(65536);
    }
  }.toString()})()`);
  console.log('PASS: invisible actors excluded from WebGL', result);
}
