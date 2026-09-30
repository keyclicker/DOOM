/* Native menu/platform settings boundary. SPDX-License-Identifier: GPL-2.0-only */
#ifndef WEB_SETTINGS_H
#define WEB_SETTINGS_H

/* Selected options are independent of the current framebuffer dimensions. */
extern int web_resolution, web_aspect, web_unlocked, web_show_fps;
extern int web_fps_value;

/* Share native action bindings with the menu and browser persistence. */
int *Web_Binding(int action);
void Web_SettingsChanged(void);

/* Draw the optional counter with the game's own font and framebuffer. */
void Web_DrawFPS(void);

#endif
