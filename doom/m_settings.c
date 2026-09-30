/* SPDX-License-Identifier: GPL-2.0-only */
#include <stddef.h>
#include "m_settings.h"

/* Settings are independent of the platform's current video dimensions. */
int m_resolution = 1, m_aspect, m_unlocked, m_show_fps;
int m_fps_value;
int m_renderer, m_freelook, m_gpu_failed;
int m_crt, m_crt_failed;

/* Access the same action variables used by G_BuildTiccmd. */
int *M_Binding(int action)
{
    extern int key_up, key_down, key_left, key_right;
    extern int key_strafeleft, key_straferight, key_fire, key_use;
    extern int key_strafe, key_speed;
    int *bindings[] = {&key_up, &key_down, &key_left, &key_right,
        &key_strafeleft, &key_straferight, &key_fire, &key_use,
        &key_strafe, &key_speed};
    return action >= 0 && action < 10 ? bindings[action] : NULL;
}
