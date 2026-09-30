"""Adapt pinned Libretro GLSL and presets for the WebGL 2 presentation host."""
import base64
import gzip
import json
import re
import subprocess
from pathlib import Path

SHADERS = Path(__file__).resolve().parent.parent / 'shaders'


def shader(path, stage):
    """Resolve compile-time defaults and restore constant globals for GLSL ES."""
    source = path.read_text()
    source = re.sub(r'^\s*#(?:version|pragma)[^\n]*', '', source, flags=re.M)
    result = subprocess.run(['cpp', '-P', '-undef', '-D__VERSION__=300',
        '-DGL_ES=1', '-DGL_FRAGMENT_PRECISION_HIGH=1', '-D' + stage,
        '-I' + str(path.parent)], input=source, text=True, capture_output=True,
        check=True).stdout
    # Doom supplies progressive frames, including its 400/600-line modes.
    result = result.replace('bool interlace_detect = true;',
                            'bool interlace_detect = false;')
    # The legacy Cg conversion erases const everywhere; ES needs constant
    # initializers at global scope. Locals retain the upstream semantics.
    result = re.sub(r'\bconst\s+', '', result)
    depth = 0
    lines = []
    for line in result.splitlines():
        if depth == 0 and re.match(
            r'\s*(?:(?:lowp|mediump|highp)\s+)?'
            r'(?:float|bool|int|[bim]?vec[234]|mat[234])\s+\w+\s*=', line):
            line = 'const ' + line.strip()
        depth += line.count('{') - line.count('}')
        lines.append(line.strip())
    result = '\n'.join(lines)
    # crt-pi predates the shared compatibility macros.
    result = re.sub(r'\battribute\b', 'in', result)
    result = re.sub(r'\bvarying\b', 'out' if stage == 'VERTEX' else 'in', result)
    result = re.sub(r'\btexture2D\b', 'texture', result)
    if 'gl_FragColor' in result:
        result = ('out vec4 FragColor;\n'
                  + result.replace('gl_FragColor', 'FragColor'))
    result = re.sub(r'(textureLod\(tex, tex_coords(?:\.xy)?, )texel_off',
                    r'\1float(texel_off)', result)
    result = re.sub(r'\bFrameCount\b', 'float(FrameCount)', result)
    result = result.replace('int float(FrameCount)', 'int FrameCount')
    result = result.replace('float float(FrameCount)', 'float FrameCount')
    # GLSL ES forbids this legacy uniform-derived global initializer.
    result = re.sub(
        r'const (?:mediump )?float bloom_approx_scale_x = '
        r'(OutputSize\.[xy] / TextureSize\.y);',
        r'#define bloom_approx_scale_x (\1)', result)
    # Correct the GLSL blur port's assignment typos; the Cg source tests flags.
    result = re.sub(
        r'if\((linearize_input|gamma_encode_output|assume_opaque_alpha) = true\)',
        r'if(\1)', result)
    result = re.sub(r', samples, (true|false)\)',
                    r', float(samples), \1)', result)
    result = re.sub(r'\b([ij]) \* (uv_offset_step_[xy])',
                    r'float(\1) * \2', result)
    # This preset fixes manual mask resizing at zero. Exclude the inactive
    # alternative LUT branch before linking, avoiding three 512x512 assets.
    if 'if(sample_orig_luts)' in result:
        assert 'const float mask_sample_mode_static = 0.0;' in result
        result = result.replace('if(sample_orig_luts)', 'if(false)')
    return reachable(result)


def reachable(source):
    """Remove unused upstream helper functions before shipping shader text."""
    functions = []
    pattern = re.compile(
        r'\b(?:void|bool|int|float|[bim]?vec[234]|mat[234](?:x[234])?)'
        r'\s+(\w+)\s*\([^;{}]*\)\s*\{')
    position = 0
    while match := pattern.search(source, position):
        depth, end = 1, match.end()
        while depth:
            depth += (source[end] == '{') - (source[end] == '}')
            end += 1
        functions.append((match.start(), end, match[1]))
        position = end
    names = {'main'}
    while True:
        previous = names.copy()
        for start, end, name in functions:
            if name in names:
                names.update(re.findall(r'\b(\w+)\s*\(', source[start:end]))
        if previous == names:
            break
    for start, end, name in reversed(functions):
        if name not in names:
            source = source[:start] + source[end:]
    return re.sub(r'\n+', '\n', source)


def bundle(compressed=True):
    """Inline compact stages and only the LUTs used by Royale's stock preset."""
    directories = ['crt-lottes', 'crt-pi', 'crt-easymode', 'crt-royale']
    presets = [[{'file': name + '.glsl', 'linear': name == 'crt-pi'}]
               for name in directories[:-1]]
    royale_dir = SHADERS / 'crt-royale'
    values = dict(re.findall(r'^([\w]+)\s*=\s*"([^"]*)"',
                            (royale_dir / 'crt-royale.glslp').read_text(), re.M))
    royale = []
    for i in range(int(values['shaders'])):
        def value(key, default=None):
            """Read a per-pass setting from the original preset."""
            return values.get(key + str(i), default)
        royale.append({'file': Path(value('shader')).name,
            'linear': value('filter_linear') == 'true',
            'srgb': value('srgb_framebuffer') == 'true',
            'alias': value('alias'),
            'x': [value('scale_type_x', value('scale_type', 'source')),
                  float(value('scale_x', value('scale', '1')))],
            'y': [value('scale_type_y', value('scale_type', 'source')),
                  float(value('scale_y', value('scale', '1')))]})
    presets.append(royale)
    for directory, preset in zip(directories, presets):
        for item in preset:
            path = SHADERS / directory / item['file']
            item['vertex'] = shader(path, 'VERTEX')
            item['fragment'] = shader(path, 'FRAGMENT')
    masks = {key: base64.b64encode(
                 (royale_dir / Path(path).name).read_bytes()).decode()
             for key, path in values.items() if key.endswith('_small')}
    data = json.dumps({'presets': presets, 'masks': masks}, separators=(',', ':'))
    if not compressed:
        return data
    packed = gzip.compress(data.encode(), mtime=0)
    return json.dumps(base64.b64encode(packed).decode())
