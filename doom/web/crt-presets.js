/* SPDX-License-Identifier: GPL-2.0-only */
/* CRT_LICENSE */

/** Host the pinned Libretro shaders without adding runtime downloads. */
class DoomRetroCRT {
  /** Decode bundled source and mask images once, before the game starts. */
  static async init() {
    if (this.data) return;
    const bytes = Uint8Array.from(atob(/* CRT_SHADERS */), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    this.data = JSON.parse(await new Response(stream).text());
    this.masks = await Promise.all(Object.entries(this.data.masks)
      .map(async ([name, encoded]) => {
        const png = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([png], {type: 'image/png'}),
          {premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
        return [name, bitmap];
      }));
  }

  /** Compile only the selected preset; retain no inactive multipass targets. */
  constructor(gl, mode) {
    this.gl = gl;
    this.passes = [];
    this.masks = {};
    this.samplers = [];
    this.buffers = [];
    try {
      for (const [linear, repeat] of [[false, false], [true, false], [true, true]]) {
        const sampler = gl.createSampler();
        gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER,
          linear ? gl.LINEAR : gl.NEAREST);
        gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER,
          linear ? gl.LINEAR : gl.NEAREST);
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S,
          repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T,
          repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        this.samplers.push(sampler);
      }
      for (const flip of [false, true]) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1, -1, 0, 1, 0, flip ? 1 : 0,
           1, -1, 0, 1, 1, flip ? 1 : 0,
          -1,  1, 0, 1, 0, flip ? 0 : 1,
           1,  1, 0, 1, 1, flip ? 0 : 1,
        ]), gl.STATIC_DRAW);
        this.buffers.push(buffer);
      }
      const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 1]);
      for (const definition of DoomRetroCRT.data.presets[mode - 2]) {
        const pass = {...definition, uniforms: [], vaos: []};
        this.passes.push(pass);
        try { pass.program = doomGLProgram(gl, pass.vertex, pass.fragment); }
        catch (error) { throw Error(pass.file + ': ' + error.message); }
        gl.useProgram(pass.program);
        gl.uniformMatrix4fv(gl.getUniformLocation(pass.program, 'MVPMatrix'),
          false, identity);
        for (let i = 0; i < gl.getProgramParameter(pass.program,
          gl.ACTIVE_UNIFORMS); i++) {
          const uniform = gl.getActiveUniform(pass.program, i);
          pass.uniforms.push({name: uniform.name, type: uniform.type,
            location: gl.getUniformLocation(pass.program, uniform.name)});
        }
        for (const buffer of this.buffers) {
          const vao = gl.createVertexArray();
          pass.vaos.push(vao);
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          for (const [name, size, offset] of [['VertexCoord', 4, 0],
            ['TexCoord', 2, 16]]) {
            const at = gl.getAttribLocation(pass.program, name);
            if (at < 0) continue;
            gl.enableVertexAttribArray(at);
            gl.vertexAttribPointer(at, size, gl.FLOAT, false, 24, offset);
          }
        }
      }
      if (mode === 5) for (const [name, bitmap] of DoomRetroCRT.masks) {
        const target = this.target(bitmap.width, bitmap.height, false, bitmap);
        this.masks[name] = target;
      }
    } catch (error) { this.dispose(); throw error; }
  }

  /** Allocate a complete color target; sRGB attachments encode Royale's light. */
  target(width, height, srgb, image) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 11);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, internal,
      gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
      throw Error('CRT framebuffer unavailable');
    }
    return {texture, framebuffer, width, height};
  }

  /** Size each original pass relative to its input or the final viewport. */
  resize(width, height, outputWidth, outputHeight) {
    const key = [width, height, outputWidth, outputHeight].join(':');
    if (key === this.size) return;
    this.size = key;
    const dimension = (setting, input, output) => {
      const [type, scale] = setting || ['viewport', 1];
      return Math.max(1, Math.round(scale
        * (type === 'absolute' ? 1 : type === 'source' ? input : output)));
    };
    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      this.deleteTarget(pass.target);
      const last = i === this.passes.length - 1;
      width = last ? outputWidth : dimension(pass.x, width, outputWidth);
      height = last ? outputHeight : dimension(pass.y, height, outputHeight);
      pass.target = last ? {width, height, framebuffer: null}
        : this.target(width, height, pass.srgb);
    }
  }

  /** Bind Libretro's source, prior-pass aliases and sizes on reserved units. */
  present(texture, width, height, canvas, flip) {
    const gl = this.gl;
    this.resize(width, height, canvas.width, canvas.height);
    const outputs = [], aliases = {...this.masks};
    let input = {texture, width, height};
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    try {
      for (let i = 0; i < this.passes.length; i++) {
        const pass = this.passes[i], target = pass.target;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(pass.program);
        gl.bindVertexArray(pass.vaos[Number(i === 0 && flip)]);
        let unit = 11;
        for (const {name, type, location} of pass.uniforms) {
          if (name === 'MVPMatrix') continue;
          const previous = /^PassPrev(\d+)(?:Texture|InputSize|TextureSize)$/.exec(name);
          const alias = name.replace(/(?:texture_size|video_size|texture)$/, '');
          const source = previous ? outputs[i - Number(previous[1])]
            : ['Texture', 'TextureSize', 'InputSize'].includes(name) ? input
              : aliases[name] || aliases[alias];
          if (type === gl.SAMPLER_2D) {
            if (unit >= 16) throw Error('CRT exceeds reserved texture units');
            if (!source?.texture) throw Error('Missing CRT texture: ' + name);
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, source.texture);
            gl.bindSampler(unit, this.samplers[name.startsWith('mask_') ? 2
              : Number(pass.linear)]);
            gl.uniform1i(location, unit++);
          } else if (type === gl.FLOAT_VEC2) {
            const size = name === 'OutputSize' ? target : source;
            if (!size) throw Error('Missing CRT size: ' + name);
            gl.uniform2f(location, size.width, size.height);
          } else if (type === gl.INT) {
            gl.uniform1i(location, name === 'FrameDirection' ? 1 : 0);
          } else throw Error('Unsupported CRT uniform: ' + name);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        outputs.push(target);
        if (pass.alias) aliases[pass.alias] = target;
        input = target;
      }
    } finally {
      for (let unit = 11; unit < 16; unit++) gl.bindSampler(unit, null);
      gl.bindVertexArray(null);
    }
  }

  /** Release targets on resize or when leaving an expensive preset. */
  deleteTarget(target) {
    if (!target) return;
    this.gl.deleteTexture(target.texture);
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  /** Release only resources owned by this preset, keeping the game context. */
  dispose() {
    for (const pass of this.passes) {
      this.deleteTarget(pass.target);
      this.gl.deleteProgram(pass.program);
      for (const vao of pass.vaos) this.gl.deleteVertexArray(vao);
    }
    for (const target of Object.values(this.masks)) this.deleteTarget(target);
    for (const buffer of this.buffers) this.gl.deleteBuffer(buffer);
    for (const sampler of this.samplers) this.gl.deleteSampler(sampler);
  }
}
