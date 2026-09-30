#!/usr/bin/env python3
"""Build an offline HTML from local modules; optionally embed private IWADs."""

import argparse
import gzip
import hashlib
import json
import lzma
from pathlib import Path
import struct
import subprocess
import tempfile

from pack import WEB, page

# Base122 avoids bytes HTML normalizes or interprets in a quoted attribute.
ILLEGAL = (0, 10, 13, 34, 38, 92)
DECODER_SHA256 = (
    'd83649874b6198df07340a88377613ccd2267aebb9f18b3be26c6904a81bac52')


def base122(data):
    """Encode bytes using seven-bit symbols and two-byte UTF-8 escapes."""
    output = bytearray()
    pending = bits = 0
    escaped = None

    def push(value):
        """Pair an unsafe symbol with its successor in one UTF-8 character."""
        nonlocal escaped
        if escaped is not None:
            output.extend(chr(0x80 | escaped << 8 | value).encode('utf-8'))
            escaped = None
        elif value in ILLEGAL:
            escaped = ILLEGAL.index(value)
        else:
            output.append(value)

    for byte in data:
        pending = pending << 8 | byte
        bits += 8
        while bits >= 7:
            bits -= 7
            push(pending >> bits & 127)
        pending &= (1 << bits) - 1
    if bits:
        push(pending << (7 - bits))
    if escaped is not None:
        output.extend(chr(0x780 | ILLEGAL[escaped]).encode('utf-8'))
    return bytes(output)


def zopfli(data):
    """Spend build time on gzip; browsers use their native, fast decoder."""
    with tempfile.TemporaryDirectory(prefix='doom-gzip-') as directory:
        source = Path(directory) / 'input'
        source.write_bytes(data)
        result = subprocess.run(
            ['zopfli', '--gzip', '--i100', '-c', str(source)],
            capture_output=True, check=True).stdout
    if gzip.decompress(result) != data:
        raise ValueError('Gzip verification failed')
    return result


def compress(data):
    """Try LZMA2 contexts for mixed code/art, retaining the smallest stream."""
    # Grow the shared match window with the collection, capped for browsers.
    dictionary = 1 << min(26, max(24, (len(data) - 1).bit_length()))
    best = None
    for lc in (3, 4):
        for pb in (0, 1, 2):
            filters = [{'id': lzma.FILTER_LZMA2,
                        'preset': 9 | lzma.PRESET_EXTREME,
                        'dict_size': dictionary, 'lc': lc, 'lp': 0, 'pb': pb,
                        'nice_len': 273, 'depth': 1000000}]
            candidate = lzma.compress(data, check=lzma.CHECK_CRC32,
                                      filters=filters)
            print(f'  XZ lc={lc} pb={pb}: {len(candidate):,} bytes', flush=True)
            if best is None or len(candidate) < len(best):
                best = candidate
    if lzma.decompress(best) != data:
        raise ValueError('XZ verification failed')
    return best


def element(name, data):
    """Use a quoted attribute: Base122 may contain raw script closing tags."""
    prefix = f'<div hidden id="{name}" data-size="{len(data)}" data-packed="'
    return prefix.encode() + base122(data) + b'"></div>'


def read_wad(path):
    """Reject missing/truncated IWADs before an expensive private build."""
    data = path.read_bytes()
    if len(data) < 12 or data[:4] != b'IWAD':
        raise ValueError('Expected a Doom IWAD')
    count, offset = struct.unpack_from('<II', data, 4)
    if not 0 < count <= 65536 or offset + count * 16 > len(data):
        raise ValueError('Invalid WAD directory')
    for i in range(count):
        start, size = struct.unpack_from('<II', data, offset + i * 16)
        if start + size > len(data):
            raise ValueError('Truncated WAD lump')
    return data


def main():
    """Pack one named HTML and its deterministic gzip companion."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build', type=Path, help='directory with built WASM/JS')
    parser.add_argument('--output', type=Path, required=True,
                        help='destination HTML, outside tracked sources')
    parser.add_argument('--wad', type=Path, action='append', default=[],
                        help='embed a local IWAD; repeat for a collection')
    args = parser.parse_args()
    wads = [read_wad(path) for path in args.wad]
    titles = {'doom': 'DOOM', 'doom1': 'DOOM', 'doom2': 'DOOM II'}
    names = [titles.get(path.stem.lower(), path.stem) for path in args.wad]
    library = WEB.parent / 'lib/xz-decompress'
    decoder = (library / 'xz-decompress.min.js').read_bytes()
    if hashlib.sha256(decoder).hexdigest() != DECODER_SHA256:
        raise ValueError('Vendored XZ decoder does not match its pinned hash')
    decoder += b'\n/*\n' + (library / 'LICENSE').read_bytes() + b'\n*/'

    parts = [page(args.build, compact=True).encode('utf-8'),
             (args.build / 'doom.wasm').read_bytes(),
             (args.build / 'music.wasm').read_bytes(),
             json.dumps(names, ensure_ascii=False).encode('utf-8'), *wads]
    payload = b'DPK2' + struct.pack('<I', len(parts))
    payload += struct.pack(f'<{len(parts)}I', *(len(part) for part in parts))
    payload += b''.join(parts)
    print(f'Payload: {len(payload):,} bytes; '
          f'WADs: {sum(map(len, wads)):,}', flush=True)
    packed = compress(payload)
    bootstrap = subprocess.run(
        ['terser', str(WEB / 'unpack.js'), '--compress', 'passes=3', '--mangle'],
        capture_output=True, check=True).stdout
    html = (b'<!doctype html><html lang="en"><meta charset="utf-8">'
            b'<meta name="viewport" content="width=device-width,initial-scale=1">'
            b'<title>DOOM</title><style>body{margin:0;height:100vh;display:grid;'
            b'place-items:center;background:#0e0e0e;color:#555;'
            b'font:14px ui-monospace,Menlo,Consolas,monospace}</style>'
            b'<body>unpacking DOOM.html...'
            + element('decoder', zopfli(decoder))
            + element('payload', packed)
            + b'<script>' + bootstrap + b'</script></html>')
    out = args.output
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(html)
    print(f'{out}: {len(html):,} bytes '
          f'({len(html) / 1048576:.3f} MiB)', flush=True)
    gzipped = zopfli(html)
    gzip_out = out.with_suffix(out.suffix + '.gz')
    gzip_out.write_bytes(gzipped)
    print(f'{gzip_out}: {len(gzipped):,} bytes '
          f'({len(gzipped) / 1048576:.3f} MiB)', flush=True)


if __name__ == '__main__':
    main()
