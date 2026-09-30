/* Separate triangle renderer; gameplay remains in p_*. GPL-2.0-only */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "doomstat.h"
#include "i_render.h"
#include "m_misc.h"
#include "m_settings.h"
#include "m_swap.h"
#include "p_local.h"
#include "r_local.h"
#include "r_sky.h"
#include "i_system.h"
#include "r_view.h"
#include "r_interp.h"
#include "r_gpu.h"
#include "w_wad.h"
#include "z_zone.h"

int r_hardware, r_hardware_frame, r_mapping;
float r_pitch;

/* Clip convex leaves once. Classic SSECTORS omit their implicit BSP edges. */
typedef struct { double x, y; } point_t;
typedef struct {
    int count;
    point_t *points;
    float x, y, radius;
} polygon_t;
static polygon_t *polygons;
static int polygon_count;

/* Materials are immutable for one IWAD; animations select another ID. */
typedef struct { int id, width, height; } material_t;
static material_t *walls, *flats, *patches;
static int next_material = 1;
static render_vertex_t *vertices;
static int vertex_count, vertex_capacity;
static render_camera_t camera;
/* Conservative sphere/frustum rejection works even at the pitch limits. */
static float yaw_cos, yaw_sin, pitch_cos, pitch_sin;
static float tan_x, tan_y, side_x, side_y;
extern int numtextures, numflats;

/* Re-upload lazily after the platform replaces a lost graphics context. */
void R_ResetMaterials(void)
{
    if (walls) {
        memset(walls, 0, numtextures * sizeof(*walls));
        memset(flats, 0, numflats * sizeof(*flats));
        memset(patches, 0, numspritelumps * sizeof(*patches));
    }
    next_material = 1;
}

/* Return world units without discarding sub-unit interpolation. */
static float units(fixed_t value) { return value / (float)FRACUNIT; }

/* Map coordinates are bounded, so a direct length cannot overflow float. */
static float length2(float x, float y) { return sqrtf(x * x + y * y); }

/* Clamp pitch independently of serialized player state and demo commands. */
int R_MouseLook(int movement)
{
    if (!r_hardware || !m_freelook) { r_pitch = 0; return 0; }
    if (!paused && !menuactive && !demoplayback) {
        r_pitch += movement * 0.0008f;
        if (r_pitch > 1.48353f) r_pitch = 1.48353f;
        if (r_pitch < -1.48353f) r_pitch = -1.48353f;
    }
    return 1;
}

/* Map geometry must not retain zone pointers across warps or save loads. */
void R_ResetGeometry(void)
{
    int i;
    for (i = 0; i < polygon_count; i++) free(polygons[i].points);
    free(polygons);
    polygons = NULL;
    polygon_count = 0;
    r_pitch = 0;
}

/* Keep the right half-plane (side zero), including points on the boundary. */
static polygon_t clip(const polygon_t *input, double x, double y,
    double dx, double dy)
{
    polygon_t out = {0, NULL};
    int i;
    point_t a, b;
    double da, db, t;
    if (!input->count) return out;
    out.points = M_Realloc(NULL, (input->count + 1) * sizeof(point_t));
    a = input->points[input->count - 1];
    da = dy * (a.x - x) - dx * (a.y - y);
    for (i = 0; i < input->count; i++) {
        b = input->points[i];
        db = dy * (b.x - x) - dx * (b.y - y);
        if ((da < 0) != (db < 0)) {
            t = da / (da - db);
            out.points[out.count++] = (point_t){
                a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t};
        }
        if (db >= 0) out.points[out.count++] = b;
        a = b;
        da = db;
    }
    return out;
}

/* Partition map bounds with the existing nodes, then close each leaf's segs. */
static void partition(int index, polygon_t poly)
{
    node_t *node;
    subsector_t *sub;
    seg_t *seg;
    polygon_t half;
    int i, leaf;
    if (index == -1 || (index & NF_SUBSECTOR)) {
        leaf = index == -1 ? 0 : index & ~NF_SUBSECTOR;
        sub = &subsectors[leaf];
        for (i = 0; i < sub->numlines; i++) {
            seg = &segs[sub->firstline + i];
            half = clip(&poly, units(seg->v1->x), units(seg->v1->y),
                units(seg->v2->x) - units(seg->v1->x),
                units(seg->v2->y) - units(seg->v1->y));
            free(poly.points);
            poly = half;
        }
        polygons[leaf] = poly;
        return;
    }
    node = &nodes[index];
    for (i = 0; i < 2; i++) {
        half = clip(&poly, units(node->x), units(node->y),
            units(node->dx) * (i ? -1 : 1),
            units(node->dy) * (i ? -1 : 1));
        partition(node->children[i], half);
    }
    free(poly.points);
}

/* Reject a bounding cylinder only when its sphere is wholly off screen. */
static int visible(float x, float y, float bottom, float top, float radius)
{
    float forward, right, up, depth, z;
    x -= camera.x;
    y -= camera.y;
    z = (bottom + top) * 0.5f - camera.z;
    radius = length2(radius, (top - bottom) * 0.5f);
    forward = x * yaw_cos + y * yaw_sin;
    right = x * yaw_sin - y * yaw_cos;
    up = z * pitch_cos - forward * pitch_sin;
    depth = forward * pitch_cos + z * pitch_sin;
    return depth + radius >= 0.5f
        && fabsf(right) <= depth * tan_x + radius * side_x
        && fabsf(up) <= depth * tan_y + radius * side_y;
}

/* Allocate shared caches lazily: software-only play pays no geometry cost. */
static void prepare(void)
{
    polygon_t bounds;
    int i;
    double left = 32768, right = -32768, bottom = 32768, top = -32768;
    if (!walls) {
        walls = calloc(numtextures, sizeof(*walls));
        flats = calloc(numflats, sizeof(*flats));
        patches = calloc(numspritelumps, sizeof(*patches));
        if (!walls || !flats || !patches) I_Error("GPU material allocation");
    }
    if (polygons) return;
    for (i = 0; i < numvertexes; i++) {
        double x = units(vertexes[i].x), y = units(vertexes[i].y);
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < bottom) bottom = y;
        if (y > top) top = y;
    }
    polygons = calloc(numsubsectors, sizeof(*polygons));
    if (!polygons) I_Error("GPU polygon allocation");
    polygon_count = numsubsectors;
    bounds.count = 4;
    bounds.points = M_Realloc(NULL, 4 * sizeof(point_t));
    bounds.points[0] = (point_t){left, bottom};
    bounds.points[1] = (point_t){right, bottom};
    bounds.points[2] = (point_t){right, top};
    bounds.points[3] = (point_t){left, top};
    partition(numnodes - 1, bounds);
    for (i = 0; i < polygon_count; i++) {
        polygon_t *poly = &polygons[i];
        int j;
        if (!poly->count) continue;
        left = right = poly->points[0].x;
        bottom = top = poly->points[0].y;
        for (j = 1; j < poly->count; j++) {
            point_t p = poly->points[j];
            if (p.x < left) left = p.x;
            if (p.x > right) right = p.x;
            if (p.y < bottom) bottom = p.y;
            if (p.y > top) top = p.y;
        }
        poly->x = (left + right) * 0.5;
        poly->y = (bottom + top) * 0.5;
        poly->radius = length2(right - left, top - bottom) * 0.5;
    }
}

/* Expand a sprite's posts with explicit coverage, retaining palette index 0. */
static byte *patch_pixels(patch_t *patch)
{
    int x, y, i, width = SHORT(patch->width), height = SHORT(patch->height);
    column_t *post;
    byte *data = calloc(width * height, 2);
    if (!data) I_Error("GPU patch allocation");
    for (x = 0; x < width; x++) {
        post = (column_t *)((byte *)patch + LONG(patch->columnofs[x]));
        while (post->topdelta != 255) {
            for (i = 0; i < post->length; i++) {
                y = post->topdelta + i;
                if (y >= height) continue;
                data[(y * width + x) * 2] = ((byte *)post)[i + 3];
                data[(y * width + x) * 2 + 1] = 255;
            }
            post = (column_t *)((byte *)post + post->length + 4);
        }
    }
    return data;
}

/* Upload once; the platform packs materials without changing texture UVs. */
static void upload(material_t *mat, byte *data)
{
    mat->id = next_material++;
    I_RenderTexture(mat->id, mat->width, mat->height, data);
    free(data);
}

/* Resolve animated wall textures through the same translation as software. */
static material_t *wall_material(int texture)
{
    material_t *mat = &walls[texture];
    if (!mat->id)
        upload(mat, R_TexturePixels(texture, &mat->width, &mat->height));
    return mat;
}

/* Flats tile at their original 64 world units per repeat. */
static material_t *flat_material(int flat)
{
    int i;
    byte *data, *source;
    material_t *mat = &flats[flat];
    if (!mat->id) {
        data = M_Realloc(NULL, 64 * 64 * 2);
        source = W_CacheLumpNum(firstflat + flat, PU_CACHE);
        for (i = 0; i < 64 * 64; i++) {
            data[i * 2] = source[i];
            data[i * 2 + 1] = 255;
        }
        mat->width = mat->height = 64;
        upload(mat, data);
    }
    return mat;
}

/* Sprites and player weapons share the original sprite-frame lookup. */
static material_t *patch_material(int lump)
{
    patch_t *patch;
    material_t *mat = &patches[lump];
    if (!mat->id) {
        patch = W_CacheLumpNum(firstspritelump + lump, PU_CACHE);
        mat->width = SHORT(patch->width);
        mat->height = SHORT(patch->height);
        upload(mat, patch_pixels(patch));
    }
    return mat;
}

/* Reuse a growing streaming buffer, avoiding per-frame heap allocations. */
static void vertex(float x, float y, float z, float u, float v,
    int material, float light)
{
    if (vertex_count == vertex_capacity) {
        vertex_capacity = vertex_capacity ? vertex_capacity * 2 : 16384;
        vertices = M_Realloc(vertices, vertex_capacity * sizeof(*vertices));
    }
    vertices[vertex_count++] = (render_vertex_t){x, y, z, u, v, material, light};
}

/* Two triangles with pixel UVs; depth testing also clips masked midtextures. */
static void quad(float x1, float y1, float x2, float y2, float bottom,
    float top, float u1, float u2, float v1, float v2, int mat, float light)
{
    vertex(x1, y1, top, u1, v1, mat, light);
    vertex(x1, y1, bottom, u1, v2, mat, light);
    vertex(x2, y2, top, u2, v1, mat, light);
    vertex(x2, y2, top, u2, v1, mat, light);
    vertex(x1, y1, bottom, u1, v2, mat, light);
    vertex(x2, y2, bottom, u2, v2, mat, light);
}

/* Emit only front-facing wall tiers, with Doom's pegging and row offsets. */
static void wall(seg_t *seg)
{
    sector_t *front = seg->frontsector, *back = seg->backsector;
    side_t *side = seg->sidedef;
    material_t *mat;
    float x1 = units(seg->v1->x), y1 = units(seg->v1->y);
    float x2 = units(seg->v2->x), y2 = units(seg->v2->y);
    float floor = units(front->floorheight), ceiling = units(front->ceilingheight);
    float low, high, anchor, u, end, light, row = units(side->rowoffset);
    int flags = seg->linedef->flags, texture, tier;
    if ((x2 - x1) * (camera.y - y1) - (y2 - y1) * (camera.x - x1) > 0)
        return;
    u = units(seg->offset) + units(side->textureoffset);
    end = u + length2(x2 - x1, y2 - y1);
    light = (front->lightlevel >> 4) + extralight;
    if (y1 == y2) light--;
    else if (x1 == x2) light++;
    for (tier = 0; tier < 3; tier++) {
        texture = 0;
        low = floor;
        high = ceiling;
        anchor = ceiling;
        if (!back) {
            if (tier) break;
            texture = side->midtexture;
            if (flags & ML_DONTPEGBOTTOM)
                anchor = floor + units(textureheight[texture]);
        } else if (tier == 0) {
            if (front->ceilingpic == skyflatnum
                && back->ceilingpic == skyflatnum) continue;
            low = units(back->ceilingheight);
            texture = side->toptexture;
            if (!(flags & ML_DONTPEGTOP))
                anchor = low + units(textureheight[texture]);
        } else if (tier == 1) {
            high = units(back->floorheight);
            texture = side->bottomtexture;
            anchor = flags & ML_DONTPEGBOTTOM ? ceiling : high;
        } else {
            texture = side->midtexture;
            low = fmaxf(floor, units(back->floorheight));
            high = fminf(ceiling, units(back->ceilingheight));
            anchor = flags & ML_DONTPEGBOTTOM
                ? low + units(textureheight[texture]) : high;
            /* Midtextures do not repeat vertically across the opening. */
            high = fminf(high, anchor + row);
            low = fmaxf(low, anchor + row - units(textureheight[texture]));
        }
        high = fminf(high, ceiling);
        low = fmaxf(low, floor);
        if (!texture || high <= low) continue;
        mat = wall_material(texturetranslation[texture]);
        quad(x1, y1, x2, y2, low, high, u, end,
            anchor + row - high, anchor + row - low, mat->id, light);
    }
    /* Sky walls seal outdoor boundaries at arbitrary pitch. Shared sky
       sectors remain open, matching the software renderer's sky merging. */
    if (front->ceilingpic == skyflatnum
        && (!back || back->ceilingpic != skyflatnum))
        quad(x1, y1, x2, y2, ceiling, 32768, 0, 0, 0, 0,
            wall_material(skytexture)->id, -1);
    if (front->floorpic == skyflatnum
        && (!back || back->floorpic != skyflatnum))
        quad(x1, y1, x2, y2, -32768, floor, 0, 0, 0, 0,
            wall_material(skytexture)->id, -1);
}

/* Triangulate each convex leaf as a fan; holes stay separated by BSP edges. */
static void plane(int index, int ceiling)
{
    sector_t *sector = subsectors[index].sector;
    polygon_t *poly = &polygons[index];
    int i, j, pic = ceiling ? sector->ceilingpic : sector->floorpic;
    float z = units(ceiling ? sector->ceilingheight : sector->floorheight);
    float light = (sector->lightlevel >> 4) + extralight;
    material_t *mat;
    point_t p;
    if (pic == skyflatnum) {
        mat = wall_material(skytexture);
        light = -1;
        z = ceiling ? 32768 : -32768;
    } else {
        if (ceiling ? camera.z > z : camera.z < z) return;
        mat = flat_material(flattranslation[pic]);
    }
    for (i = 1; i + 1 < poly->count; i++) {
        for (j = 0; j < 3; j++) {
            p = poly->points[j == 0 ? 0 : j == 1 ? i : i + 1];
            vertex(p.x, p.y, z, p.x, -p.y, mat->id, light);
        }
    }
}

/* Traverse front to back to let depth rejection reduce GPU overdraw. */
static void world(int index)
{
    int i, side;
    node_t *node;
    subsector_t *sub;
    if (index == -1 || (index & NF_SUBSECTOR)) {
        i = index == -1 ? 0 : index & ~NF_SUBSECTOR;
        sub = &subsectors[i];
        if (polygons[i].count && !visible(polygons[i].x, polygons[i].y,
            sub->sector->floorpic == skyflatnum ? -32768
                : units(sub->sector->floorheight),
            sub->sector->ceilingpic == skyflatnum ? 32768
                : units(sub->sector->ceilingheight), polygons[i].radius)) return;
        plane(i, 0);
        plane(i, 1);
        for (i = 0; i < sub->numlines; i++) wall(&segs[sub->firstline + i]);
        return;
    }
    node = &nodes[index];
    side = R_PointOnSide(viewx, viewy, node);
    world(node->children[side]);
    world(node->children[side ^ 1]);
}

/* Upright billboards preserve sprite rotations while the camera can pitch. */
static void sprite(mobj_t *thing)
{
    spriteframe_t *frame;
    material_t *mat;
    int rotation = 0, lump, flip;
    float left, right, top, x, y, light, sine, cosine;
    if (thing == viewplayer->mo) return;
    frame = &sprites[thing->sprite].spriteframes[thing->frame & FF_FRAMEMASK];
    if (frame->rotate)
        rotation = (R_PointToAngle(thing->x, thing->y) - thing->angle
            + (unsigned)(ANG45 / 2) * 9) >> 29;
    lump = frame->lump[rotation];
    flip = frame->flip[rotation];
    mat = patch_material(lump);
    left = -units(spriteoffset[lump]);
    right = left + mat->width;
    top = units(thing->z + spritetopoffset[lump]);
    if (!visible(units(thing->x), units(thing->y), top - mat->height, top,
        fmaxf(fabsf(left), fabsf(right)))) return;
    x = units(thing->x);
    y = units(thing->y);
    sine = units(viewsin);
    cosine = units(viewcos);
    light = thing->frame & FF_FULLBRIGHT ? 256
        : (thing->subsector->sector->lightlevel >> 4) + extralight;
    if (thing->flags & MF_SHADOW) light = -2;
    quad(x + sine * left, y - cosine * left,
        x + sine * right, y - cosine * right, top - mat->height, top,
        flip ? mat->width : 0, flip ? 0 : mat->width, 0, mat->height,
        mat->id, light);
}

/* Use the same psprite offsets and projection, independent of camera pitch. */
static void weapons(player_t *player)
{
    int i, lump, flip, j;
    pspdef_t *psp;
    spriteframe_t *frame;
    material_t *mat;
    float left, right, top, bottom, sx, sy, light;
    for (i = 0; i < NUMPSPRITES; i++) {
        psp = &player->psprites[i];
        if (!psp->state) continue;
        frame = &sprites[psp->state->sprite].spriteframes[
            psp->state->frame & FF_FRAMEMASK];
        lump = frame->lump[0];
        flip = frame->flip[0];
        mat = patch_material(lump);
        sx = units(projection) * (1 << detailshift) / 160;
        sy = units(projectiony) * (1 << detailshift) / 160;
        left = scaledviewwidth / 2 + (units(psp->sx) - 160
            - units(spriteoffset[lump])) * sx;
        right = left + mat->width * sx;
        top = viewheight / 2 - (100 - units(psp->sy)
            + units(spritetopoffset[lump])) * sy;
        bottom = top + mat->height * sy;
        light = psp->state->frame & FF_FULLBRIGHT ? 256
            : (player->mo->subsector->sector->lightlevel >> 4) + extralight;
        if (player->powers[pw_invisibility] > 4 * 32
            || (player->powers[pw_invisibility] & 8)) light = -2;
        j = vertex_count;
        quad(left, 0, right, 0, bottom, top, flip ? mat->width : 0,
            flip ? 0 : mat->width, 0, mat->height, mat->id, light);
        /* Weapon vertices carry pixel x/y in x/z; no world projection. */
        for (; j < vertex_count; j++) {
            vertices[j].y = vertices[j].z;
            vertices[j].z = 0;
        }
    }
}

/* Submit geometry while the interpolation wrapper owns the render snapshot. */
void R_RenderGeometry(player_t *player)
{
    int count, shadows;
    thinker_t *thinker;
    R_SetupFrame(player);
    prepare();
    camera.x = units(viewx);
    camera.y = units(viewy);
    camera.z = units(viewz);
    camera.yaw = viewangle * (6.283185307179586 / 4294967296.0);
    camera.pitch = m_freelook && !demoplayback ? R_InterpolatePitch(r_pitch) : 0;
    camera.focal_x = units(projection) * (1 << detailshift);
    camera.focal_y = units(projectiony) * (1 << detailshift);
    camera.viewport_x = viewwindowx;
    camera.viewport_y = viewwindowy;
    camera.width = scaledviewwidth;
    camera.height = viewheight;
    camera.colormap = player->fixedcolormap;
    camera.time = gametic;
    camera.sky = wall_material(skytexture)->id;
    yaw_cos = cosf(camera.yaw);
    yaw_sin = sinf(camera.yaw);
    pitch_cos = cosf(camera.pitch);
    pitch_sin = sinf(camera.pitch);
    tan_x = camera.width / (2 * camera.focal_x);
    tan_y = camera.height / (2 * camera.focal_y);
    side_x = length2(1, tan_x);
    side_y = length2(1, tan_y);
    vertex_count = 0;
    world(numnodes - 1);
    for (thinker = thinkercap.next; thinker != &thinkercap;
         thinker = thinker->next)
        if (thinker->function.acp1 == (actionf_p1)P_MobjThinker
            && !(((mobj_t *)thinker)->flags & MF_SHADOW))
            sprite((mobj_t *)thinker);
    count = vertex_count;
    for (thinker = thinkercap.next; thinker != &thinkercap;
         thinker = thinker->next)
        if (thinker->function.acp1 == (actionf_p1)P_MobjThinker
            && (((mobj_t *)thinker)->flags & MF_SHADOW))
            sprite((mobj_t *)thinker);
    shadows = vertex_count - count;
    weapons(player);
    I_RenderWorld(vertices, count, shadows,
        vertex_count - count - shadows, &camera);
    /* Keep automap discovery's original occlusion rules; no software pixels. */
    r_mapping = 1;
    R_ClearClipSegs();
    R_RenderBSPNode(numnodes - 1);
    r_mapping = 0;
}
