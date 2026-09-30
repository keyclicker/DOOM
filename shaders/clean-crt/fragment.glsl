/* SPDX-License-Identifier: GPL-2.0-only */

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
}
