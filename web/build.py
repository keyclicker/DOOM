#!/usr/bin/env python3
"""Compile Doom and its audio-thread synthesizer, then inline browser code."""

import gzip
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'dist'


def main():
    """Build with Emscripten; no downloaded ports or runtime dependencies."""
    OUT.mkdir(exist_ok=True)
    sources = sorted((ROOT / 'linuxdoom-1.10').glob('*.c'))
    sources = [p for p in sources if not p.name.startswith('i_')]
    command = [
        'emcc', *map(str, sources), str(ROOT / 'web/platform.c'),
        str(ROOT / 'web/render.c'),
        '-I' + str(ROOT / 'linuxdoom-1.10'), '-I' + str(ROOT / 'web'),
        '-DNORMALUNIX', '-DWEB',
        '-std=gnu89', '-Wno-error=implicit-function-declaration',
        '-Wno-error=incompatible-pointer-types', '-fwrapv',
        '-fno-strict-aliasing', '-flto', os.getenv('OPT', '-Oz'),
        '--no-entry', '-sENVIRONMENT=web', '-sMODULARIZE=1',
        '-sEXPORT_NAME=createDoom', '-sFILESYSTEM=1',
        '-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8',
        '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
        '-sMAXIMUM_MEMORY=536870912', '-sSTACK_SIZE=1048576',
        '-sMALLOC=emmalloc', '-sASSERTIONS=0', '-sINVOKE_RUN=0',
        '-o', str(OUT / 'doom.js'),
    ]
    subprocess.run(command, check=True)
    subprocess.run([
        'emcc', str(ROOT / 'web/music.c'),
        str(ROOT / 'web/vendor/nuked-opl3/opl3.c'),
        '-O2', '-flto', '-fwrapv', '--no-entry', '-sSTANDALONE_WASM=1',
        '-sFILESYSTEM=0', '-sINITIAL_MEMORY=1048576', '-sSTACK_SIZE=65536',
        '-o', str(OUT / 'music.wasm'),
    ], check=True)
    html = (ROOT / 'web/shell.html').read_text()
    scripts = ['audio.js', 'app.js', 'settings.js']
    code = '\n'.join((ROOT / 'web' / p).read_text() for p in scripts)
    worklet = (ROOT / 'web/music-worklet.js').read_text()
    code = code.replace('/* MUSIC_WORKLET */', json.dumps(worklet))
    html = html.replace('/* BROWSER_CODE */', code)
    html = html.replace('/* ENGINE_CODE */', (OUT / 'doom.js').read_text())
    (OUT / 'index.html').write_text(html)
    (OUT / 'doom.js').unlink()
    for name in ['index.html', 'doom.wasm', 'music.wasm']:
        data = (OUT / name).read_bytes()
        print(f'{name}: {len(data):,} bytes; gzip {len(gzip.compress(data)):,}')


if __name__ == '__main__':
    main()
