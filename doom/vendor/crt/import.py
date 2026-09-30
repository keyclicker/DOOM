#!/usr/bin/env python3
"""Restore pinned upstream files and extract shared inline headers."""
import concurrent.futures
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    """Check upstream digests before making the documented source transformations."""
    manifest = json.loads((ROOT / 'sources.json').read_text())
    base = ('https://raw.githubusercontent.com/libretro/glsl-shaders/'
            + manifest['revision'] + '/')
    headers = {}

    def extract(text):
        """Share identical includes without changing their preprocessor order."""
        pattern = (r'/\*\*+ BEGIN ([\w.-]+) \*\*+/'
                   r'([\s\S]*?)/\*\*+ END \1 \*\*+/')
        while matches := list(re.finditer(pattern, text)):
            for match in reversed(matches):
                body, name = extract(match[2]), match[1]
                if name in headers and headers[name] != body:
                    digest = hashlib.sha256(body.encode()).hexdigest()[:8]
                    name = Path(name).stem + '-' + digest + Path(name).suffix
                headers[name] = body
                text = (text[:match.start()] + '\n#include "' + name + '"\n'
                        + text[match.end():])
        return text

    def fetch(item):
        """Check each downloaded file against its pinned upstream digest."""
        name, entry = item
        data = urllib.request.urlopen(base + entry['path']).read()
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Upstream digest mismatch: ' + name)
        return name, data

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for name, data in pool.map(fetch, manifest['files'].items()):
            if name.endswith('.glsl'):
                data = extract(data.decode()).encode()
            (ROOT / name).write_bytes(data)
    for name, data in headers.items():
        (ROOT / name).write_text(data)
    # Omit contact addresses; retain author names, dates and license notices.
    for path in ROOT.iterdir():
        if path.suffix in ['.glsl', '.glslp', '.h', '.TXT']:
            text = re.sub(r'\s*<[\w.+-]+@[\w.-]+>', '', path.read_text())
            lines = (line.rstrip() for line in text.splitlines())
            path.write_text('\n'.join(lines).rstrip() + '\n')


if __name__ == '__main__':
    main()
