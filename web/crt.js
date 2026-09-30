/* SPDX-License-Identifier: GPL-2.0-only */

/** Present Clean CRT or an upstream preset on either world renderer. */
class DoomCRT {
  constructor(canvas, context) {
    this.canvas = canvas;
    this.mode = 1;
    const gl = this.gl = context || canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.program = doomGLProgram(gl,
      /* CLEAN_CRT_VERTEX */, /* CLEAN_CRT_FRAGMENT */);
    this.locations = Object.fromEntries(['source', 'size', 'scanStrength', 'flip']
      .map(name => [name, gl.getUniformLocation(this.program, name)]));
    // The geometry renderer owns its own loss handler when sharing a context.
    if (!context) canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      Settings.dirty = true;
    });
  }

  /** Replace the active preset, releasing its intermediate GPU resources. */
  select(mode) {
    if (mode === this.mode) return;
    this.preset?.dispose();
    this.preset = null;
    this.mode = 1;
    if (mode > 1) this.preset = new DoomRetroCRT(this.gl, mode);
    this.mode = mode;
  }

  /** Upload software output only; hardware passes its existing color texture. */
  software(bytes, width, height) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.texture) {
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.width !== width || this.height !== height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.width = width;
      this.height = height;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height,
      gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    this.present(this.texture, width, height, true);
  }

  /** Reconstruct at display density; do not add a source-sized blur buffer. */
  present(texture, width, height, flip = false) {
    const gl = this.gl;
    if (this.preset) {
      this.preset.present(texture, width, height, this.canvas, flip);
      return;
    }
    const u = this.locations;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    gl.useProgram(this.program);
    // Reserve a unit so presentation never overwrites the renderer's bindings.
    gl.activeTexture(gl.TEXTURE0 + 11);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.source, 11);
    gl.uniform2f(u.size, width, height);
    gl.uniform1i(u.flip, flip);
    // Fade out before scanlines approach the output's sampling limit.
    const fade = Math.max(0, Math.min(1, (this.canvas.height / height - 1.5) / 1.5));
    gl.uniform1f(u.scanStrength, 0.12 * fade * fade * (3 - 2 * fade));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
