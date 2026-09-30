# CRT shaders

Pinned from [Libretro/glsl-shaders](https://github.com/libretro/glsl-shaders)
at `f8e23ff880668f0f0e837a05a316534d82a7f31b`.
`sources.json` records the upstream paths and SHA-256 digests.

- CRT-Lottes: Timothy Lottes, public domain.
- CRT-Pi: copyright 2015–2016 davej, GPL-2.0-or-later.
- CRT-Easymode: EasyMode, GPL (upstream notice).
- CRT-Royale and its blur helpers/masks: copyright 2014 TroggleMonkey,
  GPL-2.0-or-later. See `LICENSE.TXT` and the source notices.

The GLSL conversion contains repeated inline copies of shared headers. Here
those copies become local `#include`s; differing copies retain distinct names.
Public contact addresses are omitted, with copyright names, years and notices
retained. Trailing whitespace is trimmed. No game textures or WAD data are
included.

Run `python3 doom/vendor/crt/import.py` to reproduce this import. It downloads
only the pinned revision and verifies every upstream digest before writing.
Ordinary builds require no network access.

## WebGL adaptation

`web/pack_shaders.py` preprocesses each stage with `cpp`, using upstream static
settings. It changes the legacy GLSL interface to GLSL ES 3.00, restores constant
global initializers, makes numeric conversions explicit, and expresses a
uniform-derived global as a macro. The blur conversion's assignment-in-condition
typos are corrected to match the original Cg flag tests. Unreachable helper
functions are omitted from the shipped source.

Royale retains all 12 passes, sRGB intermediate attachments, scanline
reconstruction, mask resizing, real bloom, diffusion and final geometry/AA.
Doom supplies progressive frames, so interlace detection is disabled. The stock
manual-mask-resize mode is fixed at zero; its unused alternative large-LUT
branch is excluded before linking. The original small phosphor LUTs are bundled.
No large mask images or runtime parameter UI are needed for this preset.

These are ports of the upstream shaders, not names assigned to approximations
of their appearance. `Clean CRT` remains the separate original implementation
in `web/crt.js`. Shader data and LUTs are gzip-packed into the HTML and decoded
using browser APIs. Runtime rendering makes no external requests.
