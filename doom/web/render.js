/* SPDX-License-Identifier: GPL-2.0-only */

/** Compile a WebGL 2 program; report driver errors to the caller. */
function doomGLProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, '#version 300 es\nprecision highp float;\n'
      + 'precision highp int;\n' + text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  return program;
}

/** Real WebGL 2 geometry, indexed textures and Doom's palette lighting. */
class DoomRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    const gl = this.gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    this.limit = Math.min(4096, this.maxSize);
    this.atlasX = this.atlasY = this.atlasRow = 0;
    this.materials = 0;
    this.edges = new Map();
    this.bufferBytes = 0;
    this.paletteBytes = new Uint8Array(1024);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.atlas = this.texture2D(0, gl.RG8, this.limit, this.limit, gl.RG);
    this.rects = this.texture2D(1, gl.RGBA32F, 2048, 1, gl.RGBA, gl.FLOAT);
    this.palette = this.texture2D(2, gl.RGBA8, 256, 1, gl.RGBA);
    this.colormap = this.texture2D(3, gl.R8, 256, 34, gl.RED);
    const maps = engine._web_colormaps();
    this.mapBytes = engine.HEAPU8.slice(maps, maps + 8704);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 34, gl.RED,
      gl.UNSIGNED_BYTE, engine.HEAPU8.subarray(maps, maps + 8704));
    this.overlay = this.texture2D(4, gl.R32UI, 320, 800,
      gl.RED_INTEGER, gl.UNSIGNED_INT);
    this.color = this.texture2D(5, gl.RGBA8, 1, 1, gl.RGBA);
    this.background = this.texture2D(7, gl.RGBA8, 1, 1, gl.RGBA);
    this.backdrop = this.texture2D(8, gl.R8, 64, 64, gl.RED);
    const flat = engine._web_backdrop();
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED,
      gl.UNSIGNED_BYTE, engine.HEAPU8.subarray(flat, flat + 4096));
    this.software = this.texture2D(9, gl.RGBA8, 1, 1, gl.RGBA);
    this.occlusionDepth = this.texture2D(10, gl.DEPTH_COMPONENT24, 1, 1,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    this.occlusionBuffer = gl.createFramebuffer();
    this.framebuffer = gl.createFramebuffer();
    this.depth = gl.createRenderbuffer();
    this.vertices = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    for (const [index, size, offset] of [[0, 3, 0], [1, 2, 12], [2, 3, 20]]) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 32, offset);
    }
    const vertex = `
      layout(location=0) in vec3 position;
      layout(location=1) in vec2 uv;
      layout(location=2) in vec3 surface;
      uniform vec3 eye;
      uniform vec4 direction;
      uniform vec4 projection;
      uniform bool weapon;
      out vec2 texcoord;
      out float distance;
      flat out int material;
      flat out float light;
      #ifdef SPRITE
      flat out float floorHeight;
      #endif
      void main() {
        texcoord = uv;
        material = int(surface.x);
        light = surface.y;
        #ifdef SPRITE
        floorHeight = surface.z;
        #endif
        if (weapon) {
          gl_Position = vec4(position.x * 2.0 / projection.z - 1.0,
            1.0 - position.y * 2.0 / projection.w, 0.0, 1.0);
          distance = 1.0;
        } else {
          vec3 d = position - eye;
          float forward = dot(d.xy, direction.xy);
          float right = dot(d.xy, vec2(direction.y, -direction.x));
          float up = d.z * direction.z - forward * direction.w;
          float depth = forward * direction.z + d.z * direction.w;
          gl_Position = vec4(right * 2.0 * projection.x / projection.z,
            up * 2.0 * projection.y / projection.w,
            depth * 1.00000763 - 1.00000381, depth);
          distance = max(forward, 1.0);
        }
      }`;
    const fragment = `
      uniform sampler2D atlas;
      uniform sampler2D rects;
      uniform sampler2D palette;
      uniform sampler2D colormap;
      uniform sampler2D background;
      uniform vec4 direction;
      uniform vec4 projection;
      uniform vec2 origin;
      uniform int fixedmap;
      uniform float time;
      uniform vec3 skyTop;
      uniform vec3 skyBottom;
      in vec2 texcoord;
      in float distance;
      flat in int material;
      flat in float light;
      #ifdef SPRITE
      uniform vec3 eye;
      uniform float subpixel;
      uniform highp sampler2D occlusion;
      flat in float floorHeight;
      #endif
      out vec4 color;
      void main() {
        vec4 rect = texelFetch(rects, ivec2(material, 0), 0);
        vec2 uv = texcoord;
        float cap = 0.0;
        if (light == -1.0) {
          vec2 p = (gl_FragCoord.xy - origin - projection.zw * 0.5)
            / projection.xy;
          float f = direction.z - p.y * direction.w;
          vec3 ray = vec3(direction.x * f + direction.y * p.x,
            direction.y * f - direction.x * p.x,
            direction.w + p.y * direction.z);
          float v = 100.0 - ray.z / max(length(ray.xy), 0.0001) * 160.0;
          cap = v < 0.0 ? -min(1.0, -v / 64.0)
            : max(0.0, min(1.0, (v - rect.w + 1.0) / 64.0));
          uv = vec2(atan(ray.y, ray.x) * 162.974662,
            clamp(v, 0.0, rect.w - 1.0));
        }
        ivec2 at = ivec2(rect.xy + mod(floor(uv), rect.zw));
        vec2 texel = texelFetch(atlas, at, 0).rg;
        if (texel.g < 0.5) discard;
        #ifdef SPRITE
        gl_FragDepth = gl_FragCoord.z;
        float rayZ = direction.w + direction.z
          * (gl_FragCoord.y - origin.y - projection.w * 0.5) / projection.y;
        if (eye.z > floorHeight && rayZ < 0.0) {
          // Match the floor despite raster subpixel and D24 rounding.
          float depth = (floorHeight - eye.z) / rayZ;
          float floorDepth = 1.000003815 - 0.500001905 / depth;
          // Never expose a hidden actor's feet at a solid wall or closed door.
          if (gl_FragCoord.z > floorDepth && gl_FragCoord.z
            > texelFetch(occlusion, ivec2(gl_FragCoord.xy), 0).r) discard;
          float slope = abs(0.500001905 * direction.z
            / (projection.y * (floorHeight - eye.z)));
          float bias = slope * subpixel + 2.0 / 16777216.0;
          gl_FragDepth = min(gl_FragDepth, floorDepth - bias);
        }
        #endif
        int index = int(texel.r * 255.0 + 0.5);
        int shade = int(clamp((15.0 - clamp(light, 0.0, 15.0)) * 4.0
          - min(48.0, 2560.0 / distance) * 0.5, 0.0, 31.0));
        if (light == -1.0 || light == 256.0) shade = 0;
        if (fixedmap > 0 && fixedmap < 34) shade = fixedmap;
        if (light == -2.0) {
          float noise = fract(sin(dot(floor(gl_FragCoord.xy),
            vec2(12.9898, 78.233)) + time) * 43758.5453);
          vec2 size = vec2(textureSize(background, 0));
          vec2 offset = vec2(0.0, noise < 0.5 ? -1.0 : 1.0);
          color = vec4(texture(background,
            (gl_FragCoord.xy + offset) / size).rgb * 0.7, 1.0);
          return;
        }
        index = int(texelFetch(colormap, ivec2(index, shade), 0).r
          * 255.0 + 0.5);
        color = texelFetch(palette, ivec2(index, 0), 0);
        if (cap != 0.0)
          color.rgb = mix(color.rgb, cap < 0.0 ? skyTop : skyBottom, abs(cap));
      }`;
    this.scene = this.program(vertex, fragment);
    // Keep explicit fragment depth out of the world's early-depth-test path.
    this.sprites = this.program('#define SPRITE\n' + vertex,
      '#define SPRITE\n' + fragment);
    this.occlusion = this.program(vertex, 'void main() {}');
    this.ui = this.program(`
      out vec2 uv;
      void main() {
        vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        uv = vec2(p.x, 1.0 - p.y);
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`, `
      uniform highp usampler2D overlay;
      uniform sampler2D software;
      uniform sampler2D palette;
      uniform sampler2D backdrop;
      uniform bool world;
      uniform ivec2 screen;
      uniform ivec4 art;
      uniform ivec2 sides;
      in vec2 uv;
      out vec4 color;
      // Match the engine's floor-rounded destination rectangle boundaries.
      ivec2 sourcePixel(ivec2 p, ivec2 source, ivec2 target) {
        return ((p + 1) * source - 1) / target;
      }
      uint layer(int index, ivec2 p, ivec2 size) {
        if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size)))
          return 0u;
        ivec2 at = sourcePixel(p, ivec2(320, 200), size);
        return texelFetch(overlay, at + ivec2(0, index * 200), 0).r;
      }
      void main() {
        if (!world) {
          color = texture(software, uv);
          return;
        }
        ivec2 p = ivec2(gl_FragCoord.x, float(screen.y) - gl_FragCoord.y);
        uint pixel = layer(0, p - art.xy, art.zw);
        pixel = max(pixel, layer(1, p - ivec2(art.x, screen.y - art.w),
          art.zw));
        pixel = max(pixel, layer(2, p - ivec2(art.x, 0), art.zw));
        int status = screen.y - 32 * art.w / 200;
        ivec2 border = sourcePixel(p, ivec2(320, 168),
          ivec2(screen.x, status));
        if (border.y < 200)
          pixel = max(pixel, texelFetch(overlay,
            border + ivec2(0, 600), 0).r);
        if (pixel != 0u) {
          color = texelFetch(palette, ivec2(int(pixel & 255u), 0), 0);
        } else if (sides.x != 0 && p.y >= status
          && (p.x < art.x || p.x >= art.x + art.z)) {
          ivec2 at = p * ivec2(sides.y != 0 ? 240 : 200, 200) / screen.y;
          int index = int(texelFetch(backdrop, at & 63, 0).r * 255.0 + 0.5);
          color = texelFetch(palette, ivec2(index, 0), 0);
        } else discard;
      }`);
    for (const program of [this.scene, this.sprites]) {
      gl.useProgram(program);
      for (const [name, unit] of [['atlas', 0], ['rects', 1], ['palette', 2],
        ['colormap', 3], ['background', 7]])
        gl.uniform1i(this.uniform(program, name), unit);
    }
    gl.uniform1f(this.uniform(this.sprites, 'subpixel'),
      2 ** -gl.getParameter(gl.SUBPIXEL_BITS));
    gl.uniform1i(this.uniform(this.sprites, 'occlusion'), 10);
    gl.useProgram(this.ui);
    for (const [name, unit] of [['overlay', 4], ['palette', 2],
      ['backdrop', 8], ['software', 9]])
      gl.uniform1i(this.uniform(this.ui, name), unit);
    // Loss is recoverable: the game switches to software on the next frame.
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      Settings.dirty = true;
    });
  }

  /** Allocate nearest-filtered textures, with no atlas-edge interpolation. */
  texture2D(unit, internal, width, height, format, type = this.gl.UNSIGNED_BYTE) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
    return texture;
  }

  /** Compile scene programs through the shared WebGL boundary. */
  program(vertex, fragment) {
    return doomGLProgram(this.gl, vertex, fragment);
  }

  /** Cache uniform locations outside the hot rendering loop. */
  uniform(program, name) {
    this.uniforms ??= new Map();
    let locations = this.uniforms.get(program);
    if (!locations) this.uniforms.set(program, locations = new Map());
    if (!locations.has(name))
      locations.set(name, this.gl.getUniformLocation(program, name));
    return locations.get(name);
  }

  /** Shelf-pack immutable WAD materials; no external assets or GPU mipmaps. */
  texture(id, width, height, bytes) {
    const gl = this.gl;
    if (this.atlasX + width > this.limit) {
      this.atlasX = 0;
      this.atlasY += this.atlasRow;
      this.atlasRow = 0;
    }
    if (id >= 2048 || width > this.limit || this.atlasY + height > this.limit)
      throw new Error('WAD exceeds the WebGL material cache');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.atlasX, this.atlasY,
      width, height, gl.RG, gl.UNSIGNED_BYTE, bytes);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rects);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, id, 0, 1, 1, gl.RGBA, gl.FLOAT,
      new Float32Array([this.atlasX, this.atlasY, width, height]));
    this.atlasX += width;
    this.atlasRow = Math.max(this.atlasRow, height);
    this.materials++;
    // Retain only edge indices for smooth sky caps beyond the 128-pixel art.
    this.edges.set(id, [bytes.slice(0, width * 2),
      bytes.slice((height - 1) * width * 2)]);
  }

  /** Keep an explicit framebuffer for depth and transition-only readback. */
  resize() {
    const gl = this.gl;
    const [width, height] = this.renderSize
      || [this.canvas.width, this.canvas.height];
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.occlusionDepth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.occlusionBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D, this.occlusionDepth, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('WebGL sprite occlusion buffer unavailable');
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER, this.depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('WebGL framebuffer unavailable');
    // Full-screen software frames are needed only for automap/art/transitions.
    this.softwareWidth = 0;
    // Allocate the scene copy only if fuzz is actually visible.
    this.backgroundWidth = 0;
    this.presented = false;
  }

  /** Refresh the 1 KiB palette only when its gamma/flash actually changes. */
  updatePalette() {
    const e = this.engine;
    const bytes = e.HEAPU8.subarray(e._web_palette(), e._web_palette() + 1024);
    if (bytes.every((value, i) => value === this.paletteBytes[i])) return;
    this.paletteBytes.set(bytes);
    this.paletteVersion = (this.paletteVersion || 0) + 1;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  /** Share camera/lighting state between world and floor-aware sprite shaders. */
  useScene(program, camera) {
    const gl = this.gl;
    const [x, y, z, yaw, pitch, fx, fy, vx, vy, vw, vh, fixed, time] = camera;
    const uniform = name => this.uniform(program, name);
    gl.useProgram(program);
    gl.uniform3f(uniform('eye'), x, y, z);
    gl.uniform4f(uniform('direction'), Math.cos(yaw), Math.sin(yaw),
      Math.cos(pitch), Math.sin(pitch));
    gl.uniform4f(uniform('projection'), fx, fy, vw, vh);
    gl.uniform2f(uniform('origin'), vx, this.height - vy - vh);
    gl.uniform1i(uniform('fixedmap'), fixed);
    gl.uniform1f(uniform('time'), time);
    gl.uniform3fv(uniform('skyTop'), this.skyColors[0]);
    gl.uniform3fv(uniform('skyBottom'), this.skyColors[1]);
    gl.uniform1i(uniform('weapon'), 0);
  }

  /** Stream one triangle buffer, with separate world, sprite and weapon draws. */
  world(vertices, count, occluders, sprites, shadows, weapons, camera) {
    if (this.lost) return;
    this.resize();
    this.updatePalette();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    const clear = this.paletteBytes;
    gl.clearColor(clear[0] / 255, clear[1] / 255, clear[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const [, , , , pitch, , , vx, vy, vw, vh, fixed, , sky] = camera;
    gl.viewport(vx, this.height - vy - vh, vw, vh);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
    if (vertices.byteLength > this.bufferBytes) {
      this.bufferBytes = Math.ceil(vertices.byteLength / 65536) * 65536;
      gl.bufferData(gl.ARRAY_BUFFER, this.bufferBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
    if (this.sky !== sky || this.skyMap !== fixed
      || this.skyPalette !== this.paletteVersion) {
      this.sky = sky;
      this.skyMap = fixed;
      this.skyPalette = this.paletteVersion;
      this.skyColors = this.edges.get(sky).map(edge => {
        const color = [0, 0, 0];
        for (let x = 0; x < edge.length; x += 2) {
          const row = Math.max(0, Math.min(33, fixed));
          const index = this.mapBytes[edge[x] + row * 256];
          for (let c = 0; c < 3; c++) color[c] += this.paletteBytes[index * 4 + c];
        }
        return color.map(value => value / (edge.length / 2 * 255));
      });
    }
    // Solid-wall silhouettes also cover artwork projected below the floor.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.occlusionBuffer);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.useScene(this.occlusion, camera);
    gl.drawArrays(gl.TRIANGLES, count, occluders);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    this.useScene(this.scene, camera);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    this.useScene(this.sprites, camera);
    gl.drawArrays(gl.TRIANGLES, count + occluders, sprites);
    const opaque = count + occluders + sprites;
    if (shadows || (weapons && vertices[(opaque + shadows) * 8 + 6] === -2)) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.background);
      if (this.backgroundWidth !== this.width) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.backgroundWidth = this.width;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, opaque, shadows);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.scene);
    gl.uniform1i(this.uniform(this.scene, 'weapon'), 1);
    gl.drawArrays(gl.TRIANGLES, opaque + shadows, weapons);
    this.triangles = (opaque + shadows + weapons) / 3;
    this.pitch = pitch;
    this.lastCamera = Array.from(camera);
  }

  /** Composite native art over geometry, or display a complete software frame. */
  present(bytes, world) {
    if (this.lost) return;
    this.resize();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.useProgram(this.ui);
    gl.uniform1i(this.uniform(this.ui, 'world'), !!world);
    if (world) {
      this.updatePalette();
      const e = this.engine;
      const layout = new Int32Array(e.HEAPU8.buffer, e._web_overlay_layout(), 6);
      gl.uniform2i(this.uniform(this.ui, 'screen'), this.width, this.height);
      gl.uniform4iv(this.uniform(this.ui, 'art'), layout.subarray(0, 4));
      gl.uniform2iv(this.uniform(this.ui, 'sides'), layout.subarray(4));
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.overlay);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 320, 800,
        gl.RED_INTEGER, gl.UNSIGNED_INT,
        new Uint32Array(e.HEAPU8.buffer, e._web_overlay(), 320 * 800));
    } else {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, this.software);
      if (this.softwareWidth !== this.width) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.softwareWidth = this.width;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height,
        gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.cleanCRT) {
      this.crt.present(this.color, this.width, this.height);
    } else {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.width, this.height,
        0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    this.presented = true;
    this.worldPresented = !!world;
  }

  /** Downsample once at a transition and recover the exact palette indices. */
  capture(target) {
    if (!this.presented || !this.worldPresented || this.lost) return;
    const gl = this.gl;
    if (!this.captureBuffer) {
      this.captureTexture = this.texture2D(6, gl.RGBA8, 320, 200, gl.RGBA);
      this.captureBuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.captureBuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, this.captureTexture, 0);
      this.capturePixels = new Uint8Array(320 * 200 * 4);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.captureBuffer);
    gl.blitFramebuffer(0, 0, this.width, this.height,
      0, 0, 320, 200, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.captureBuffer);
    gl.readPixels(0, 0, 320, 200, gl.RGBA, gl.UNSIGNED_BYTE, this.capturePixels);
    const palette = new Uint32Array(this.paletteBytes.buffer);
    const lookup = new Map(Array.from(palette, (color, i) => [color, i]));
    const pixels = new Uint32Array(this.capturePixels.buffer);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const color = pixels[(199 - y) * 320 + x];
      let index = lookup.get(color);
      if (index === undefined) {
        // Sky caps and fuzz may blend colors: quantize only during the wipe.
        let best = Infinity;
        for (let i = 0; i < 256; i++) {
          const r = (color & 255) - (palette[i] & 255);
          const g = (color >> 8 & 255) - (palette[i] >> 8 & 255);
          const b = (color >> 16 & 255) - (palette[i] >> 16 & 255);
          const distance = r * r + g * g + b * b;
          if (distance < best) { best = distance; index = i; }
        }
        lookup.set(color, index);
      }
      target[y * 320 + x] = index;
    }
  }
}
