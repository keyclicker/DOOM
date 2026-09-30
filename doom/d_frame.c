/* SPDX-License-Identifier: GPL-2.0-only */
#include "doomstat.h"
#include "d_main.h"
#include "d_net.h"
#include "d_frame.h"
#include "g_game.h"
#include "i_video.h"
#include "m_menu.h"
#include "r_local.h"
#include "r_interp.h"
#include "v_view.h"
#include "s_sound.h"
#include "f_wipe.h"

/* Melt transitions suspend simulation across host frames. */
int d_wiping;

/* The host schedules exactly 35 game tics per second. */
void D_AdvanceFrame(int draw, int smooth)
{
    if (d_wiping) {
        d_wiping = !wipe_ScreenWipe(wipe_Melt, 0, 0, 320, 200, 1);
        M_Drawer();
        V_BlitView();
        I_FinishUpdate();
        if (!d_wiping) {
            extern int screenblocks, detailLevel;
            R_SetViewSize(screenblocks, detailLevel);
        }
        return;
    }

    if (smooth) R_Snapshot();
    D_ProcessEvents();
    G_BuildTiccmd(&netcmds[consoleplayer][maketic % BACKUPTICS]);
    if (advancedemo)
        D_DoAdvanceDemo();
    M_Ticker();
    G_Ticker();
    gametic++;
    maketic++;
    S_UpdateSounds(players[consoleplayer].mo);
    if (draw) {
        R_SetFraction(FRACUNIT);
        D_Display();
    }
}

/* Begin a nonblocking melt transition after D_Display captures its end. */
void D_BeginWipe(void) { d_wiping = 1; }

/* Present between tics without advancing simulation. */
void D_RenderFrame(int fraction)
{
    if (d_wiping) return;
    R_SetFraction(fraction);
    D_Display();
}
