/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef R_INTERP_H
#define R_INTERP_H
#include "d_player.h"

/* Snapshot only render state; interpolation never advances game simulation. */
void R_ResetInterpolation(void);
void R_Snapshot(void);
void R_SnapObject(mobj_t *object);
void R_InterpolateCamera(player_t *player);
void R_SetFraction(int fraction);
#ifdef HARDWARE_RENDER
/* Smooth camera-only pitch alongside the original interpolated yaw. */
float R_InterpolatePitch(float pitch);
#endif

/* Restore all interpolated inputs before the next simulation tic. */
void R_RenderInterpolatedView(player_t *player);

#endif
