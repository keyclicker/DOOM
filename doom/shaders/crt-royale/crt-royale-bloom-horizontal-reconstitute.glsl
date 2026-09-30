#version 130

/////////////////////////////  GPL LICENSE NOTICE  /////////////////////////////

//  crt-royale: A full-featured CRT shader, with cheese.
//  Copyright (C) 2014 TroggleMonkey
//
//  This program is free software; you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the Free
//  Software Foundation; either version 2 of the License, or any later version.
//
//  This program is distributed in the hope that it will be useful, but WITHOUT
//  ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
//  FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
//  more details.
//
//  You should have received a copy of the GNU General Public License along with
//  this program; if not, write to the Free Software Foundation, Inc., 59 Temple
//  Place, Suite 330, Boston, MA 02111-1307 USA

// compatibility macros for transparently converting HLSLisms into GLSLisms
#define mul(a,b) (b*a)
#define lerp(a,b,c) mix(a,b,c)
#define saturate(c) clamp(c, 0.0, 1.0)
#define frac(x) (fract(x))
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define bool2 bvec2
#define bool3 bvec3
#define bool4 bvec4
#define float2x2 mat2x2
#define float3x3 mat3x3
#define float4x4 mat4x4
#define float4x3 mat4x3
#define float2x4 mat2x4
#define IN params
#define texture_size TextureSize.xy
#define video_size InputSize.xy
#define output_size OutputSize.xy
#define frame_count FrameCount
#define static
#define inline
#define const
#define fmod(x,y) mod(x,y)
#define ddx(c) dFdx(c)
#define ddy(c) dFdy(c)
#define atan2(x,y) atan(y,x)
#define rsqrt(c) inversesqrt(c)

#define MASKED_SCANLINEStexture PassPrev3Texture
#define MASKED_SCANLINEStexture_size PassPrev3TextureSize
#define MASKED_SCANLINESvideo_size PassPrev3InputSize
#define HALATION_BLURtexture PassPrev6Texture
#define HALATION_BLURtexture_size PassPrev6TextureSize
#define HALATION_BLURvideo_size PassPrev6InputSize
#define BRIGHTPASStexture PassPrev2Texture
#define BRIGHTPASStexture_size PassPrev2TextureSize
#define BRIGHTPASSvideo_size PassPrev2InputSize

#if defined(GL_ES)
	#define COMPAT_PRECISION mediump
#else
	#define COMPAT_PRECISION
#endif

#if __VERSION__ >= 130
	#define COMPAT_TEXTURE texture
#else
	#define COMPAT_TEXTURE texture2D
#endif

/////////////////////////////  SETTINGS MANAGEMENT  ////////////////////////////

//#include "../include/user-settings.h"

#include "user-settings.h"


//#include "../include/derived-settings-and-constants.h"

#include "derived-settings-and-constants.h"


//#include "../include/bind-shader-params.h"

#include "bind-shader-params-004b0e20.h"



///////////////////////////////  VERTEX INCLUDES  //////////////////////////////

//#include "../include/gamma-management.h"

#include "gamma-management.h"


//#include "../include/phosphor-mask-resizing.h"

#include "phosphor-mask-resizing.h"


//#include "../include/scanline-functions.h"

#include "scanline-functions.h"



//////////////////////////////  END VERTEX-INCLUDES  //////////////////////////////

#undef COMPAT_PRECISION
#undef COMPAT_TEXTURE

#if defined(VERTEX)

#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#define COMPAT_TEXTURE texture
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#define COMPAT_TEXTURE texture2D
#endif

#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 COLOR;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 COL0;
COMPAT_VARYING vec4 TEX0;
COMPAT_VARYING vec2 video_uv;
COMPAT_VARYING vec2 scanline_tex_uv;
COMPAT_VARYING vec2 halation_tex_uv;
COMPAT_VARYING vec2 brightpass_tex_uv;
COMPAT_VARYING vec2 bloom_tex_uv;
COMPAT_VARYING vec2 bloom_dxdy;
COMPAT_VARYING float bloom_sigma_runtime;

vec4 _oPosition1;
uniform mat4 MVPMatrix;
uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform COMPAT_PRECISION vec2 HALATION_BLURtexture_size;
uniform COMPAT_PRECISION vec2 HALATION_BLURvideo_size;
uniform COMPAT_PRECISION vec2 MASKED_SCANLINEStexture_size;
uniform COMPAT_PRECISION vec2 MASKED_SCANLINESvideo_size;
uniform COMPAT_PRECISION vec2 BRIGHTPASStexture_size;
uniform COMPAT_PRECISION vec2 BRIGHTPASSvideo_size;

// compatibility #defines
#define vTexCoord TEX0.xy
#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize
#define OutSize vec4(OutputSize, 1.0 / OutputSize)

float bloom_approx_scale_x = OutputSize.x / TextureSize.y;
const float max_viewport_size_x = 1080.0*1024.0*(4.0/3.0);
const float bloom_diff_thresh_ = 1.0/256.0;

// copied from bloom-functions.h
inline float get_min_sigma_to_blur_triad(const float triad_size,
    const float thresh)
{
    //  Requires:   1.) triad_size is the final phosphor triad size in pixels
    //              2.) thresh is the max desired pixel difference in the
    //                  blurred triad (e.g. 1.0/256.0).
    //  Returns:    Return the minimum sigma that will fully blur a phosphor
    //              triad on the screen to an even color, within thresh.
    //              This closed-form function was found by curve-fitting data.
    //  Estimate: max error = ~0.086036, mean sq. error = ~0.0013387:
    return -0.05168 + 0.6113*triad_size -
        1.122*triad_size*sqrt(0.000416 + thresh);
    //  Estimate: max error = ~0.16486, mean sq. error = ~0.0041041:
    //return 0.5985*triad_size - triad_size*sqrt(thresh)
}

void main()
{
    gl_Position = MVPMatrix * VertexCoord;
    TEX0.xy = TexCoord.xy;
	float2 tex_uv = TEX0.xy;

    //  Our various input textures use different coords:
    const float2 video_uv = tex_uv * texture_size/video_size;
//    video_uv = video_uv;
    scanline_tex_uv = video_uv * MASKED_SCANLINESvideo_size /
        MASKED_SCANLINEStexture_size;
    halation_tex_uv = video_uv * HALATION_BLURvideo_size /
        HALATION_BLURtexture_size;
    brightpass_tex_uv = video_uv * BRIGHTPASSvideo_size /
        BRIGHTPASStexture_size;
    bloom_tex_uv = tex_uv;

    //  We're horizontally blurring the bloom input (vertically blurred
    //  brightpass).  Get the uv distance between output pixels / input texels
    //  in the horizontal direction (this pass must NOT resize):
    bloom_dxdy = float2(1.0/texture_size.x, 0.0);

    //  Calculate a runtime bloom_sigma in case it's needed:
    const float mask_tile_size_x = get_resized_mask_tile_size(
        output_size, output_size * mask_resize_viewport_scale, false).x;
    bloom_sigma_runtime = get_min_sigma_to_blur_triad(
        mask_tile_size_x / mask_triads_per_tile, bloom_diff_thresh_);
}

#elif defined(FRAGMENT)

#ifdef GL_ES
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

#if __VERSION__ >= 130
#define COMPAT_VARYING in
#define COMPAT_TEXTURE texture
out COMPAT_PRECISION vec4 FragColor;
#else
#define COMPAT_VARYING varying
#define FragColor gl_FragColor
#define COMPAT_TEXTURE texture2D
#endif

uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform COMPAT_PRECISION vec2 HALATION_BLURtexture_size;
uniform COMPAT_PRECISION vec2 HALATION_BLURvideo_size;
uniform COMPAT_PRECISION vec2 MASKED_SCANLINEStexture_size;
uniform COMPAT_PRECISION vec2 MASKED_SCANLINESvideo_size;
uniform COMPAT_PRECISION vec2 BRIGHTPASStexture_size;
uniform COMPAT_PRECISION vec2 BRIGHTPASSvideo_size;
uniform sampler2D Texture;
#define bloom_texture Texture
uniform sampler2D MASKED_SCANLINEStexture;
uniform sampler2D HALATION_BLURtexture;
uniform sampler2D BRIGHTPASStexture;
COMPAT_VARYING vec4 TEX0;
COMPAT_VARYING vec2 video_uv;
COMPAT_VARYING vec2 scanline_tex_uv;
COMPAT_VARYING vec2 halation_tex_uv;
COMPAT_VARYING vec2 brightpass_tex_uv;
COMPAT_VARYING vec2 bloom_tex_uv;
COMPAT_VARYING vec2 bloom_dxdy;
COMPAT_VARYING float bloom_sigma_runtime;

// compatibility #defines
#define Source Texture
#define vTexCoord TEX0.xy

#define SourceSize vec4(TextureSize, 1.0 / TextureSize) //either TextureSize or InputSize
#define OutSize vec4(OutputSize, 1.0 / OutputSize)

float bloom_approx_scale_x = OutputSize.x / TextureSize.y;
const float max_viewport_size_x = 1080.0*1024.0*(4.0/3.0);
const float bloom_diff_thresh_ = 1.0/256.0;

///////////////////////////  BEGIN FRAGMENT-INCLUDES  ///////////////////////////

//#include "../include/bloom-functions.h"

#include "bloom-functions-16ab1654.h"



///////////////////////////  END FRAGMENT-INCLUDES  //////////////////////////

void main()
{
    //  Blur the vertically blurred brightpass horizontally by 9/17/25/43x:
    const float bloom_sigma = get_final_bloom_sigma(bloom_sigma_runtime);
    const float3 blurred_brightpass = tex2DblurNfast(bloom_texture,
        bloom_tex_uv, bloom_dxdy, bloom_sigma);

    //  Sample the masked scanlines.  Alpha contains the auto-dim factor:
    const float3 intensity_dim =
        tex2D_linearize(MASKED_SCANLINEStexture, scanline_tex_uv).rgb;
    const float auto_dim_factor = levels_autodim_temp;
    const float undim_factor = 1.0/auto_dim_factor;

    //  Calculate the mask dimpass, add it to the blurred brightpass, and
    //  undim (from scanline auto-dim) and amplify (from mask dim) the result:
    const float mask_amplify = get_mask_amplify();
    const float3 brightpass = tex2D_linearize(BRIGHTPASStexture,
        brightpass_tex_uv).rgb;
    const float3 dimpass = intensity_dim - brightpass;
    const float3 phosphor_bloom = (dimpass + blurred_brightpass) *
        mask_amplify * undim_factor * levels_contrast;

    //  Sample the halation texture, and let some light bleed into refractive
    //  diffusion.  Conceptually this occurs before the phosphor bloom, but
    //  adding it in earlier passes causes black crush in the diffusion colors.
    const float3 diffusion_color = levels_contrast * tex2D_linearize(
        HALATION_BLURtexture, halation_tex_uv).rgb;
    const float3 final_bloom = lerp(phosphor_bloom,
        diffusion_color, diffusion_weight);

    //  Encode and output the bloomed image:
    FragColor = encode_output(float4(final_bloom, 1.0));
}
#endif
