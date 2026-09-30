#!/usr/bin/env python3
"""Inline browser scripts and Emscripten glue into the single HTML page."""

import gzip
import json
from pathlib import Path
import subprocess
import sys
from pack_shaders import SHADERS, bundle

WEB = Path(__file__).resolve().parent.parent / 'web'


def page(out, compact=False):
    """Assemble either the ordinary page or source for the single-file packer."""
    html = (WEB / 'shell.html').read_text()
    scripts = ['audio.js', 'render.js', 'crt.js', 'crt-presets.js',
               'app.js', 'settings.js']
    code = '\n'.join((WEB / name).read_text() for name in scripts)
    worklet = (WEB / 'music-worklet.js').read_text()
    code = code.replace('/* MUSIC_WORKLET */', json.dumps(worklet))
    for stage in ['vertex', 'fragment']:
        source = (SHADERS / 'clean-crt' / (stage + '.glsl')).read_text()
        code = code.replace('/* CLEAN_CRT_' + stage.upper() + ' */',
                            json.dumps(source))
    code = code.replace('/* CRT_SHADERS */', bundle(compressed=not compact))
    notices = ('CRT-Lottes: Timothy Lottes, public domain.\n'
        'CRT-Pi: Copyright 2015-2016 davej, GPL-2.0-or-later.\n'
        'CRT-Easymode: EasyMode, GPL.\n'
        'CRT-Royale: Copyright 2014 TroggleMonkey, GPL-2.0-or-later.\n'
        'WebGL adaptations: 2026. Source and notices: '
        'https://github.com/keyclicker/DOOM\n')
    code = code.replace('/* CRT_LICENSE */', '/*!\n' + notices
        + (SHADERS / 'crt-royale/LICENSE.TXT').read_text() + '\n*/')
    code = (out / 'doom.js').read_text() + '\n' + code
    if compact:
        code = subprocess.run(['terser', '--compress', 'passes=3', '--mangle'],
                              input=code, text=True, capture_output=True,
                              check=True).stdout
    return html.replace('/* BROWSER_CODE */', code)


def main():
    """Pack already-built modules; compilation belongs to the Makefile."""
    out = Path(sys.argv[1])
    html = page(out)
    (out / 'index.html').write_text(html)
    for name in ['index.html', 'doom.wasm', 'music.wasm']:
        data = (out / name).read_bytes()
        print(f'{name}: {len(data):,} bytes; gzip {len(gzip.compress(data)):,}')


if __name__ == '__main__':
    main()
