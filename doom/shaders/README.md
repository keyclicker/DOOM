# Display shaders

Each filter owns its GLSL and related assets in one directory:

```text
shaders/
  clean-crt/       original vertex and fragment stages
  crt-lottes/      upstream single-pass shader
  crt-pi/          upstream single-pass shader
  crt-easymode/    upstream single-pass shader
  crt-royale/      passes, local headers, preset, masks and license
```

WebGL programs, framebuffers and texture management live in `web/crt.js`
and `web/crt-presets.js`. The build embeds shader sources into the HTML;
these directories add no runtime asset requests.

The four upstream filters are pinned from
[Libretro/glsl-shaders](https://github.com/libretro/glsl-shaders)
at `f8e23ff880668f0f0e837a05a316534d82a7f31b`.
Sources are checked in; builds use these local copies. Source links below
point to that exact commit:

| Local filter | Upstream source |
| --- | --- |
| `crt-lottes/` | [CRT-Lottes](https://github.com/libretro/glsl-shaders/blob/f8e23ff880668f0f0e837a05a316534d82a7f31b/crt/shaders/crt-lottes.glsl) |
| `crt-pi/` | [CRT-Pi](https://github.com/libretro/glsl-shaders/blob/f8e23ff880668f0f0e837a05a316534d82a7f31b/crt/shaders/crt-pi.glsl) |
| `crt-easymode/` | [CRT-Easymode](https://github.com/libretro/glsl-shaders/blob/f8e23ff880668f0f0e837a05a316534d82a7f31b/crt/shaders/crt-easymode.glsl) |
| `crt-royale/` | [Preset](https://github.com/libretro/glsl-shaders/blob/f8e23ff880668f0f0e837a05a316534d82a7f31b/crt/crt-royale.glslp), [passes, masks and license](https://github.com/libretro/glsl-shaders/tree/f8e23ff880668f0f0e837a05a316534d82a7f31b/crt/shaders/crt-royale), [blur helpers](https://github.com/libretro/glsl-shaders/tree/f8e23ff880668f0f0e837a05a316534d82a7f31b/blurs/shaders/royale) |

- Clean CRT: original project shader, GPL-2.0-only.
- CRT-Lottes: Timothy Lottes, public domain.
- CRT-Pi: copyright 2015–2016 davej, GPL-2.0-or-later.
- CRT-Easymode: EasyMode, GPL (upstream notice).
- CRT-Royale and its blur helpers/masks: copyright 2014 TroggleMonkey,
  GPL-2.0-or-later. See `crt-royale/LICENSE.TXT` and the source notices.

The GLSL conversion contains repeated inline copies of shared headers. Here
those copies become local `#include`s within each filter's directory;
differing copies retain distinct names. Filters do not include each other's
private headers.
Public contact addresses are omitted, with copyright names, years and notices
retained. Trailing whitespace is trimmed. No game textures or WAD data are
included.

Update the checked-in sources and the pinned links together when changing
upstream revisions. Builds require no network access.

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
in `clean-crt/`. Upstream shader data and LUTs are gzip-packed into the HTML
and decoded using browser APIs. Runtime rendering makes no external requests.
