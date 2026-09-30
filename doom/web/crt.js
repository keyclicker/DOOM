/* SPDX-License-Identifier: GPL-2.0-only */

/** Reconstruct a comfortable CRT image in one pass; see README.md for sources. */
class DoomCRT {
  constructor(canvas, context) {
    this.canvas = canvas;
    const gl = this.gl = context || canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.program = doomGLProgram(gl, `
      out vec2 uv;
      void main() {
        uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`, `
      uniform sampler2D source;
      uniform vec2 size;
      uniform float scanStrength;
      uniform bool flip;
      in vec2 uv;
      out vec4 color;

      // Gamma 2 approximates light energy cheaply; clamp at the image edges.
      vec3 sampleLight(ivec2 p) {
        vec3 c = texelFetch(source, clamp(p, ivec2(0), ivec2(size) - 1), 0).rgb;
        return c * c;
      }

      // A positive cubic B-spline softens horizontal pixels without ringing.
      vec3 beam(ivec2 p, vec4 w) {
        return sampleLight(p + ivec2(-1, 0)) * w.x
          + sampleLight(p) * w.y
          + sampleLight(p + ivec2(1, 0)) * w.z
          + sampleLight(p + ivec2(2, 0)) * w.w;
      }

      void main() {
        vec2 at = vec2(uv.x, flip ? 1.0 - uv.y : uv.y) * size;
        vec2 f = fract(at - 0.5);
        ivec2 p = ivec2(floor(at - 0.5));
        float x = f.x, x2 = x * x, x3 = x2 * x;
        vec4 w = vec4(1.0 - 3.0*x + 3.0*x2 - x3,
          4.0 - 6.0*x2 + 3.0*x3, 1.0 + 3.0*x + 3.0*x2 - 3.0*x3,
          x3) / 6.0;
        vec3 light = mix(beam(p, w), beam(p + ivec2(0, 1), w),
          smoothstep(0.0, 1.0, f.y));
        // Bright beams fill more of the gap. No mask, flicker or lifted blacks.
        float luma = dot(light, vec3(0.2126, 0.7152, 0.0722));
        float gap = 0.5 + 0.5 * cos(6.28318530718 * at.y);
        light *= 1.0 - scanStrength * (1.0 - 0.5*luma) * gap;
        color = vec4(sqrt(light), 1.0);
      }`);
    this.locations = Object.fromEntries(['source', 'size', 'scanStrength', 'flip']
      .map(name => [name, gl.getUniformLocation(this.program, name)]));
    // The geometry renderer owns its own loss handler when sharing a context.
    if (!context) canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      Settings.dirty = true;
    });
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
