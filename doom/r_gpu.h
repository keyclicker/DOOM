/* Optional geometry renderer. SPDX-License-Identifier: GPL-2.0-only */
#ifndef R_GPU_H
#define R_GPU_H
#include "d_player.h"

/* Active backend, current frame path, and visibility-only BSP traversal. */
extern int r_hardware, r_hardware_frame, r_mapping;
extern float r_pitch;

/* Discard map geometry before level allocations are freed. */
void R_ResetGeometry(void);
/* Invalidate material IDs after a backend/context replacement. */
void R_ResetMaterials(void);
/* Build/draw real walls, BSP-clipped floors, ceilings, sprites and weapons. */
void R_RenderGeometry(player_t *player);
/* Consume vertical mouse motion only while free look is enabled. */
int R_MouseLook(int movement);
#endif
