/* Native menu/platform settings boundary. SPDX-License-Identifier: GPL-2.0-only */
#ifndef M_SETTINGS_H
#define M_SETTINGS_H

/* Selected options are independent of the current framebuffer dimensions. */
extern int m_resolution, m_aspect, m_unlocked, m_show_fps;
extern int m_fps_value;
/* Hardware and camera enhancements are opt-in; availability is host-owned. */
extern int m_renderer, m_freelook, m_gpu_failed;
/* Optional display filtering leaves the selected world renderer unchanged. */
extern int m_crt, m_crt_failed;

/* Append new actions to preserve saved binding order. */
#define M_BINDING_COUNT 11
extern int key_map;

/* Share native action bindings with the menu and host persistence. */
int *M_Binding(int action);

/* Draw the optional counter with the game's own font and framebuffer. */
void M_DrawFPS(void);

#endif
