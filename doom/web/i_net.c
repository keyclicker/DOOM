/* SPDX-License-Identifier: GPL-2.0-only */
#include <stdlib.h>
#include "doomstat.h"
#include "d_net.h"
#include "i_system.h"
#include <emscripten.h>

/* Single-player transport: retain Doom's tic command and demo machinery. */
void I_InitNetwork(void)
{
    doomcom = calloc(1, sizeof(*doomcom));
    doomcom->id = DOOMCOM_ID;
    doomcom->ticdup = 1;
    doomcom->numplayers = doomcom->numnodes = 1;
    netgame = false;
}
void I_NetCmd(void) { I_Error("Network play is not available"); }
