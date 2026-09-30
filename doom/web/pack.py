#!/usr/bin/env python3
"""Inline browser scripts and Emscripten glue into the single HTML page."""

import gzip
import json
from pathlib import Path
import sys

WEB = Path(__file__).resolve().parent


def main():
    """Pack already-built modules; compilation belongs to the Makefile."""
    out = Path(sys.argv[1])
    html = (WEB / 'shell.html').read_text()
    scripts = ['audio.js', 'app.js', 'settings.js']
    code = '\n'.join((WEB / name).read_text() for name in scripts)
    worklet = (WEB / 'music-worklet.js').read_text()
    code = code.replace('/* MUSIC_WORKLET */', json.dumps(worklet))
    html = html.replace('/* BROWSER_CODE */', code)
    html = html.replace('/* ENGINE_CODE */', (out / 'doom.js').read_text())
    (out / 'index.html').write_text(html)
    for name in ['index.html', 'doom.wasm', 'music.wasm']:
        data = (out / name).read_bytes()
        print(f'{name}: {len(data):,} bytes; gzip {len(gzip.compress(data)):,}')


if __name__ == '__main__':
    main()
