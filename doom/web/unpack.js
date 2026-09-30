/* SPDX-License-Identifier: GPL-2.0-only */

/** Recover packed bytes from a UTF-8, double-quoted HTML attribute. */
function decodeBase122(element) {
  const illegal = [0, 10, 13, 34, 38, 92];
  const output = new Uint8Array(Number(element.dataset.size));
  const text = element.getAttribute('data-packed');
  let pending = 0, bits = 0, offset = 0;

  /** Consume seven bits, keeping at most one incomplete output byte. */
  function push(value) {
    pending = (pending << 7) | value;
    bits += 7;
    if (bits >= 8) {
      bits -= 8;
      if (offset >= output.length) throw Error('Invalid packed length');
      output[offset++] = pending >>> bits;
      pending &= (1 << bits) - 1;
    }
  }

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      const index = (code >>> 8) & 7;
      if (index === 6) throw Error('Invalid Base122 escape');
      if (index !== 7) push(illegal[index]);
    }
    push(code & 127);
  }
  if (offset !== output.length) throw Error('Truncated packed data');
  element.remove();
  return output;
}

/** Unpack entirely in memory; file:// never needs to fetch a sibling asset. */
(async () => {
  try {
    const decoder = decodeBase122(document.querySelector('#decoder'));
    const script = document.createElement('script');
    script.textContent = await new Response(new Blob([decoder]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).text();
    document.head.append(script);

    const packed = decodeBase122(document.querySelector('#payload'));
    const stream = new globalThis['xz-decompress'].XzReadableStream(
      new Blob([packed]).stream());
    const buffer = await new Response(stream).arrayBuffer();
    const header = new DataView(buffer);
    if (buffer.byteLength < 20 || header.getUint32(0) !== 0x44504b31) {
      throw Error('Invalid DOOM bundle');
    }
    let offset = 20;
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const size = header.getUint32(4 + i * 4, true);
      if (offset + size > buffer.byteLength) throw Error('Truncated DOOM bundle');
      parts.push(new Uint8Array(buffer, offset, size));
      offset += size;
    }
    if (offset !== buffer.byteLength) throw Error('Invalid DOOM bundle length');

    // Copy small modules so they do not retain the entire unpacked archive.
    globalThis.doomBundle = {
      engine: parts[1].slice(), music: parts[2].slice(),
      wad: parts[3].length ? new Blob([parts[3]]) : null,
    };
    const html = new TextDecoder().decode(parts[0]);
    delete globalThis['xz-decompress'];
    document.open();
    document.write(html);
    document.close();
  } catch (error) {
    document.body.textContent = 'Could not unpack DOOM: ' + error.message;
    console.error(error);
  }
})();
