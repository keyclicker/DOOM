#!/usr/bin/env python3
"""Compile Doom and inline browser code into a two-file distribution."""

import gzip
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
        '-I' + str(ROOT / 'linuxdoom-1.10'), '-DNORMALUNIX', '-DWEB',
        '-std=gnu89', '-Wno-error=implicit-function-declaration',
        '-Wno-error=incompatible-pointer-types', '-fwrapv',
        '-fno-strict-aliasing', '-flto', os.getenv('OPT', '-Oz'),
        '--no-entry', '-sENVIRONMENT=web', '-sMODULARIZE=1',
        '-sEXPORT_NAME=createDoom', '-sFILESYSTEM=1',
        '-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8',
        '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
        '-sMAXIMUM_MEMORY=134217728', '-sSTACK_SIZE=1048576',
        '-sMALLOC=emmalloc', '-sASSERTIONS=0', '-sINVOKE_RUN=0',
        '-o', str(OUT / 'doom.js'),
    ]
    subprocess.run(command, check=True)
    html = (ROOT / 'web/shell.html').read_text()
    scripts = ['audio.js', 'app.js']
    code = '\n'.join((ROOT / 'web' / p).read_text() for p in scripts)
    html = html.replace('/* BROWSER_CODE */', code)
    html = html.replace('/* ENGINE_CODE */', (OUT / 'doom.js').read_text())
    (OUT / 'index.html').write_text(html)
    (OUT / 'doom.js').unlink()
    for name in ['index.html', 'doom.wasm']:
        data = (OUT / name).read_bytes()
        print(f'{name}: {len(data):,} bytes; gzip {len(gzip.compress(data)):,}')


if __name__ == '__main__':
    main()
