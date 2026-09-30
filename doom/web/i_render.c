/* WebGL transport; geometry and materials belong to r_*. GPL-2.0-only */
#include "i_render.h"
#include "r_state.h"
#include <emscripten.h>

/* WebGL consumes views of WASM memory, never JSON or per-vertex JS objects. */
EM_JS(void, web_texture, (int id, int width, int height, const byte *pixels), {
    if (Doom.graphics.failed || Doom.graphics.lost) return;
    try {
        Doom.graphics.texture(id, width, height,
            HEAPU8.subarray(pixels, pixels + width * height * 2));
    } catch (error) {
        console.warn('Using software rendering:', error);
        Doom.graphics.failed = Settings.dirty = true;
    }
});

EM_JS(void, web_world_geometry, (const render_vertex_t *vertices, int count,
    int shadows, int weapons, const render_camera_t *camera), {
    if (Doom.graphics.failed || Doom.graphics.lost) return;
    try {
        Doom.graphics.world(new Float32Array(HEAPU8.buffer,
            vertices, (count + shadows + weapons) * 7), count, shadows, weapons,
            new Float32Array(HEAPU8.buffer, camera, 14));
    } catch (error) {
        console.warn('Using software rendering:', error);
        Doom.graphics.failed = Settings.dirty = true;
    }
});

/* Readback is restricted to screen transitions, never the normal frame loop. */
EM_JS(void, web_capture, (byte *pixels), {
    if (Doom.graphics)
        Doom.graphics.capture(HEAPU8.subarray(pixels, pixels + 64000));
});

/* COLORMAP is immutable and shared by all GPU materials. */
EMSCRIPTEN_KEEPALIVE byte *web_colormaps(void) { return colormaps; }

/* Keep imported JavaScript functions private to the platform translation unit. */
void I_RenderTexture(int id, int width, int height, const byte *pixels)
{
    web_texture(id, width, height, pixels);
}

/* Pass the contiguous batch and camera packet without copying WASM memory. */
void I_RenderWorld(const render_vertex_t *vertices, int count, int shadows,
    int weapons, const render_camera_t *camera)
{
    web_world_geometry(vertices, count, shadows, weapons, camera);
}

/* Preserve the native wipe input on a geometry-rendered frame. */
void I_RenderCapture(byte *pixels) { web_capture(pixels); }
