// Emacs style mode select   -*- C++ -*- 
//-----------------------------------------------------------------------------
//
// $Id:$
//
// Copyright (C) 1993-1996 by id Software, Inc.
//
// This source is available for distribution and/or modification
// only under the terms of the DOOM Source Code License as
// published by id Software. All rights reserved.
//
// The source is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// FITNESS FOR A PARTICULAR PURPOSE. See the DOOM Source Code License
// for more details.
//
// $Log:$
//
// DESCRIPTION:
//	DOOM selection menu, options, episode etc.
//	Sliders and icons. Kinda widget stuff.
//
//-----------------------------------------------------------------------------

static const char
rcsid[] = "$Id: m_menu.c,v 1.7 1997/02/03 22:45:10 b1 Exp $";

#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdlib.h>
#include <ctype.h>


#include "doomdef.h"
#include "dstrings.h"

#include "d_main.h"

#include "i_system.h"
#include "i_video.h"
#include "z_zone.h"
#include "v_video.h"
#include "w_wad.h"

#include "r_local.h"


#include "hu_stuff.h"

#include "g_game.h"

#include "m_argv.h"
#include "m_swap.h"

#include "s_sound.h"

#include "doomstat.h"

// Data.
#include "sounds.h"

#include "m_menu.h"
#include "m_settings.h"
#include "v_view.h"



extern patch_t*		hu_font[HU_FONTSIZE];
extern boolean		message_dontfuckwithme;

extern boolean		chat_on;		// in heads-up code

//
// defaulted values
//
int			mouseSensitivity;       // has default

// Show messages has default, 0 = off, 1 = on
int			showMessages;
	

// Blocky mode, has default, 0 = high, 1 = normal
int			detailLevel;		
int			screenblocks;		// has default

// temp for screenblocks (0-9)
int			screenSize;		

// -1 = no quicksave slot picked!
int			quickSaveSlot;          

 // 1 = message to be printed
int			messageToPrint;
// ...and here is the message string!
char*			messageString;		

// message x & y
int			messx;			
int			messy;
int			messageLastMenuActive;

// timed message = no input from user
boolean			messageNeedsInput;     

void    (*messageRoutine)(int response);

#define SAVESTRINGSIZE 	24

char gammamsg[5][26] =
{
    GAMMALVL0,
    GAMMALVL1,
    GAMMALVL2,
    GAMMALVL3,
    GAMMALVL4
};

// we are going to be entering a savegame string
int			saveStringEnter;              
int             	saveSlot;	// which slot to save in
int			saveCharIndex;	// which char we're editing
// old save description before edit
char			saveOldString[SAVESTRINGSIZE];  

boolean			inhelpscreens;
boolean			menuactive;

#define SKULLXOFF		-32
#define LINEHEIGHT		16

extern boolean		sendpause;
char			savegamestrings[10][SAVESTRINGSIZE];



//
// MENU TYPEDEFS
//
typedef struct
{
    // 0 = no cursor here, 1 = ok, 2 = arrows ok
    short	status;
    
    char	name[10];
    
    // choice = menu item #.
    // if status = 2,
    //   choice=0:leftarrow,1:rightarrow
    void	(*routine)(int choice);
    
    // hotkey in menu
    char	alphaKey;			
} menuitem_t;



typedef struct menu_s
{
    short		numitems;	// # of menu items
    struct menu_s*	prevMenu;	// previous menu
    menuitem_t*		menuitems;	// menu items
    void		(*routine)();	// draw routine
    short		x;
    short		y;		// x,y of menu
    short		lastOn;		// last item user was on in menu
} menu_t;

short		itemOn;			// menu item skull is on
short		skullAnimCounter;	// skull animation counter
short		whichSkull;		// which skull to draw

// graphic name of skulls
// warning: initializer-string for array of chars is too long
char    skullName[2][/*8*/9] = {"M_SKULL1","M_SKULL2"};

// current menudef
menu_t*	currentMenu;                          

//
// PROTOTYPES
//
void M_NewGame(int choice);
void M_Episode(int choice);
void M_ChooseSkill(int choice);
void M_LoadGame(int choice);
void M_SaveGame(int choice);
void M_Options(int choice);
void M_EndGame(int choice);
void M_ReadThis(int choice);
void M_ReadThis2(int choice);

void M_ChangeMessages(int choice);
void M_ChangeSensitivity(int choice);
void M_SfxVol(int choice);
void M_MusicVol(int choice);
void M_ChangeDetail(int choice);
void M_SizeDisplay(int choice);
void M_StartGame(int choice);
void M_Sound(int choice);

void M_FinishReadThis(int choice);
void M_LoadSelect(int choice);
void M_SaveSelect(int choice);
void M_ReadSaveStrings(void);
void M_QuickSave(void);
void M_QuickLoad(void);

void M_DrawMainMenu(void);
void M_DrawReadThis1(void);
void M_DrawReadThis2(void);
void M_DrawNewGame(void);
void M_DrawEpisode(void);
void M_DrawOptions(void);
static void M_ExtraOptions(int choice);
void M_DrawSound(void);
void M_DrawLoad(void);
void M_DrawSave(void);

void M_DrawSaveLoadBorder(int x,int y);
void M_SetupNextMenu(menu_t *menudef);
void M_DrawThermo(int x,int y,int thermWidth,int thermDot);
void M_DrawEmptyCell(menu_t *menu,int item);
void M_DrawSelCell(menu_t *menu,int item);
void M_WriteText(int x, int y, char *string);
int  M_StringWidth(char *string);
int  M_StringHeight(char *string);
void M_StartControlPanel(void);
void M_StartMessage(char *string,void *routine,boolean input);
void M_StopMessage(void);
void M_ClearMenus (void);




//
// DOOM MENU
//
enum
{
    newgame = 0,
    options,
    extraoptions,
    loadgame,
    savegame,
    readthis,
    main_end
} main_e;

menuitem_t MainMenu[]=
{
    {1,"M_NGAME",M_NewGame,'n'},
    {1,"M_OPTION",M_Options,'o'},
    {1,"",M_ExtraOptions,'e'},
    {1,"M_LOADG",M_LoadGame,'l'},
    {1,"M_SAVEG",M_SaveGame,'s'},
    // Another hickup with Special edition.
    {1,"M_RDTHIS",M_ReadThis,'r'}
};

menu_t  MainDef =
{
    main_end,
    NULL,
    MainMenu,
    M_DrawMainMenu,
    97,64,
    0
};


//
// EPISODE SELECT
//
enum
{
    ep1,
    ep2,
    ep3,
    ep4,
    ep_end
} episodes_e;

menuitem_t EpisodeMenu[]=
{
    {1,"M_EPI1", M_Episode,'k'},
    {1,"M_EPI2", M_Episode,'t'},
    {1,"M_EPI3", M_Episode,'i'},
    {1,"M_EPI4", M_Episode,'t'}
};

menu_t  EpiDef =
{
    ep_end,		// # of menu items
    &MainDef,		// previous menu
    EpisodeMenu,	// menuitem_t ->
    M_DrawEpisode,	// drawing routine ->
    48,63,              // x,y
    ep1			// lastOn
};

//
// NEW GAME
//
enum
{
    killthings,
    toorough,
    hurtme,
    violence,
    nightmare,
    newg_end
} newgame_e;

menuitem_t NewGameMenu[]=
{
    {1,"M_JKILL",	M_ChooseSkill, 'i'},
    {1,"M_ROUGH",	M_ChooseSkill, 'h'},
    {1,"M_HURT",	M_ChooseSkill, 'h'},
    {1,"M_ULTRA",	M_ChooseSkill, 'u'},
    {1,"M_NMARE",	M_ChooseSkill, 'n'}
};

menu_t  NewDef =
{
    newg_end,		// # of menu items
    &EpiDef,		// previous menu
    NewGameMenu,	// menuitem_t ->
    M_DrawNewGame,	// drawing routine ->
    48,63,              // x,y
    hurtme		// lastOn
};



//
// OPTIONS MENU
//
enum
{
    endgame,
    messages,
    detail,
    scrnsize,
    option_empty1,
    mousesens,
    option_empty2,
    soundvol,
    opt_end
} options_e;

menuitem_t OptionsMenu[]=
{
    {1,"M_ENDGAM",	M_EndGame,'e'},
    {1,"M_MESSG",	M_ChangeMessages,'m'},
    {1,"M_DETAIL",	M_ChangeDetail,'g'},
    {2,"M_SCRNSZ",	M_SizeDisplay,'s'},
    {-1,"",0},
    {2,"M_MSENS",	M_ChangeSensitivity,'m'},
    {-1,"",0},
    {1,"M_SVOL",	M_Sound,'s'}
};

menu_t  OptionsDef =
{
    opt_end,
    &MainDef,
    OptionsMenu,
    M_DrawOptions,
    60,37,
    0
};

//
// Read This! MENU 1 & 2
//
enum
{
    rdthsempty1,
    read1_end
} read_e;

menuitem_t ReadMenu1[] =
{
    {1,"",M_ReadThis2,0}
};

menu_t  ReadDef1 =
{
    read1_end,
    &MainDef,
    ReadMenu1,
    M_DrawReadThis1,
    280,185,
    0
};

enum
{
    rdthsempty2,
    read2_end
} read_e2;

menuitem_t ReadMenu2[]=
{
    {1,"",M_FinishReadThis,0}
};

menu_t  ReadDef2 =
{
    read2_end,
    &ReadDef1,
    ReadMenu2,
    M_DrawReadThis2,
    330,175,
    0
};

//
// SOUND VOLUME MENU
//
enum
{
    sfx_vol,
    sfx_empty1,
    music_vol,
    sfx_empty2,
    sound_end
} sound_e;

menuitem_t SoundMenu[]=
{
    {2,"M_SFXVOL",M_SfxVol,'s'},
    {-1,"",0},
    {2,"M_MUSVOL",M_MusicVol,'m'},
    {-1,"",0}
};

menu_t  SoundDef =
{
    sound_end,
    &OptionsDef,
    SoundMenu,
    M_DrawSound,
    80,64,
    0
};

//
// LOAD GAME MENU
//
enum
{
    load1,
    load2,
    load3,
    load4,
    load5,
    load6,
    load_end
} load_e;

menuitem_t LoadMenu[]=
{
    {1,"", M_LoadSelect,'1'},
    {1,"", M_LoadSelect,'2'},
    {1,"", M_LoadSelect,'3'},
    {1,"", M_LoadSelect,'4'},
    {1,"", M_LoadSelect,'5'},
    {1,"", M_LoadSelect,'6'}
};

menu_t  LoadDef =
{
    load_end,
    &MainDef,
    LoadMenu,
    M_DrawLoad,
    80,54,
    0
};

//
// SAVE GAME MENU
//
menuitem_t SaveMenu[]=
{
    {1,"", M_SaveSelect,'1'},
    {1,"", M_SaveSelect,'2'},
    {1,"", M_SaveSelect,'3'},
    {1,"", M_SaveSelect,'4'},
    {1,"", M_SaveSelect,'5'},
    {1,"", M_SaveSelect,'6'}
};

menu_t  SaveDef =
{
    load_end,
    &MainDef,
    SaveMenu,
    M_DrawSave,
    80,54,
    0
};


//
// M_ReadSaveStrings
//  read the strings from the savegame files
//
void M_ReadSaveStrings(void)
{
    int             handle;
    int             count;
    int             i;
    char    name[256];
	
    for (i = 0;i < load_end;i++)
    {
	if (M_CheckParm("-cdrom"))
	    sprintf(name,"c:\\doomdata\\"SAVEGAMENAME"%d.dsg",i);
	else
	    sprintf(name,SAVEGAMENAME"%d.dsg",i);

	handle = open (name, O_RDONLY | 0, 0666);
	if (handle == -1)
	{
	    strcpy(&savegamestrings[i][0],EMPTYSTRING);
	    LoadMenu[i].status = 0;
	    continue;
	}
	count = read (handle, &savegamestrings[i], SAVESTRINGSIZE);
	close (handle);
	LoadMenu[i].status = 1;
    }
}


//
// M_LoadGame & Cie.
//
void M_DrawLoad(void)
{
    int             i;
	
    V_DrawPatchDirect (72,28,0,W_CacheLumpName("M_LOADG",PU_CACHE));
    for (i = 0;i < load_end; i++)
    {
	M_DrawSaveLoadBorder(LoadDef.x,LoadDef.y+LINEHEIGHT*i);
	M_WriteText(LoadDef.x,LoadDef.y+LINEHEIGHT*i,savegamestrings[i]);
    }
}



//
// Draw border for the savegame description
//
void M_DrawSaveLoadBorder(int x,int y)
{
    int             i;
	
    V_DrawPatchDirect (x-8,y+7,0,W_CacheLumpName("M_LSLEFT",PU_CACHE));
	
    for (i = 0;i < 24;i++)
    {
	V_DrawPatchDirect (x,y+7,0,W_CacheLumpName("M_LSCNTR",PU_CACHE));
	x += 8;
    }

    V_DrawPatchDirect (x,y+7,0,W_CacheLumpName("M_LSRGHT",PU_CACHE));
}



//
// User wants to load this game
//
void M_LoadSelect(int choice)
{
    char    name[256];
	
    if (M_CheckParm("-cdrom"))
	sprintf(name,"c:\\doomdata\\"SAVEGAMENAME"%d.dsg",choice);
    else
	sprintf(name,SAVEGAMENAME"%d.dsg",choice);
    G_LoadGame (name);
    M_ClearMenus ();
}

//
// Selected from DOOM menu
//
void M_LoadGame (int choice)
{
    if (netgame)
    {
	M_StartMessage(LOADNET,NULL,false);
	return;
    }
	
    M_SetupNextMenu(&LoadDef);
    M_ReadSaveStrings();
}


//
//  M_SaveGame & Cie.
//
void M_DrawSave(void)
{
    int             i;
	
    V_DrawPatchDirect (72,28,0,W_CacheLumpName("M_SAVEG",PU_CACHE));
    for (i = 0;i < load_end; i++)
    {
	M_DrawSaveLoadBorder(LoadDef.x,LoadDef.y+LINEHEIGHT*i);
	M_WriteText(LoadDef.x,LoadDef.y+LINEHEIGHT*i,savegamestrings[i]);
    }
	
    if (saveStringEnter)
    {
	i = M_StringWidth(savegamestrings[saveSlot]);
	M_WriteText(LoadDef.x + i,LoadDef.y+LINEHEIGHT*saveSlot,"_");
    }
}

//
// M_Responder calls this when user is finished
//
void M_DoSave(int slot)
{
    G_SaveGame (slot,savegamestrings[slot]);
    M_ClearMenus ();

    // PICK QUICKSAVE SLOT YET?
    if (quickSaveSlot == -2)
	quickSaveSlot = slot;
}

//
// User wants to save. Start string input for M_Responder
//
void M_SaveSelect(int choice)
{
    // we are going to be intercepting all chars
    saveStringEnter = 1;
    
    saveSlot = choice;
    strcpy(saveOldString,savegamestrings[choice]);
    if (!strcmp(savegamestrings[choice],EMPTYSTRING))
	savegamestrings[choice][0] = 0;
    saveCharIndex = strlen(savegamestrings[choice]);
}

//
// Selected from DOOM menu
//
void M_SaveGame (int choice)
{
    if (!usergame)
    {
	M_StartMessage(SAVEDEAD,NULL,false);
	return;
    }
	
    if (gamestate != GS_LEVEL)
	return;
	
    M_SetupNextMenu(&SaveDef);
    M_ReadSaveStrings();
}



//
//      M_QuickSave
//
char    tempstring[80];

void M_QuickSaveResponse(int ch)
{
    if (ch == 'y')
    {
	M_DoSave(quickSaveSlot);
	S_StartSound(NULL,sfx_swtchx);
    }
}

void M_QuickSave(void)
{
    if (!usergame)
    {
	S_StartSound(NULL,sfx_oof);
	return;
    }

    if (gamestate != GS_LEVEL)
	return;
	
    if (quickSaveSlot < 0)
    {
	M_StartControlPanel();
	M_ReadSaveStrings();
	M_SetupNextMenu(&SaveDef);
	quickSaveSlot = -2;	// means to pick a slot now
	return;
    }
    sprintf(tempstring,QSPROMPT,savegamestrings[quickSaveSlot]);
    M_StartMessage(tempstring,M_QuickSaveResponse,true);
}



//
// M_QuickLoad
//
void M_QuickLoadResponse(int ch)
{
    if (ch == 'y')
    {
	M_LoadSelect(quickSaveSlot);
	S_StartSound(NULL,sfx_swtchx);
    }
}


void M_QuickLoad(void)
{
    if (netgame)
    {
	M_StartMessage(QLOADNET,NULL,false);
	return;
    }
	
    if (quickSaveSlot < 0)
    {
	M_StartMessage(QSAVESPOT,NULL,false);
	return;
    }
    sprintf(tempstring,QLPROMPT,savegamestrings[quickSaveSlot]);
    M_StartMessage(tempstring,M_QuickLoadResponse,true);
}




//
// Read This Menus
// Had a "quick hack to fix romero bug"
//
void M_DrawReadThis1(void)
{
    inhelpscreens = true;
    switch ( gamemode )
    {
      case commercial:
	V_DrawPatchDirect (0,0,0,W_CacheLumpName("HELP",PU_CACHE));
	break;
      case shareware:
      case registered:
      case retail:
	V_DrawPatchDirect (0,0,0,W_CacheLumpName("HELP1",PU_CACHE));
	break;
      default:
	break;
    }
    return;
}



//
// Read This Menus - optional second page.
//
void M_DrawReadThis2(void)
{
    inhelpscreens = true;
    switch ( gamemode )
    {
      case retail:
      case commercial:
	// This hack keeps us from having to change menus.
	V_DrawPatchDirect (0,0,0,W_CacheLumpName("CREDIT",PU_CACHE));
	break;
      case shareware:
      case registered:
	V_DrawPatchDirect (0,0,0,W_CacheLumpName("HELP2",PU_CACHE));
	break;
      default:
	break;
    }
    return;
}


//
// Change Sfx & Music volumes
//
void M_DrawSound(void)
{
    V_DrawPatchDirect (60,38,0,W_CacheLumpName("M_SVOL",PU_CACHE));

    M_DrawThermo(SoundDef.x,SoundDef.y+LINEHEIGHT*(sfx_vol+1),
		 16,snd_SfxVolume);

    M_DrawThermo(SoundDef.x,SoundDef.y+LINEHEIGHT*(music_vol+1),
		 16,snd_MusicVolume);
}

void M_Sound(int choice)
{
    M_SetupNextMenu(&SoundDef);
}

void M_SfxVol(int choice)
{
    switch(choice)
    {
      case 0:
	if (snd_SfxVolume)
	    snd_SfxVolume--;
	break;
      case 1:
	if (snd_SfxVolume < 15)
	    snd_SfxVolume++;
	break;
    }
	
    S_SetSfxVolume(snd_SfxVolume /* *8 */);
}

void M_MusicVol(int choice)
{
    switch(choice)
    {
      case 0:
	if (snd_MusicVolume)
	    snd_MusicVolume--;
	break;
      case 1:
	if (snd_MusicVolume < 15)
	    snd_MusicVolume++;
	break;
    }
	
    S_SetMusicVolume(snd_MusicVolume /* *8 */);
}




//
// M_DrawMainMenu
//
void M_DrawMainMenu(void)
{
    static char *labels[] = {"NEW GAME", "OPTIONS", "EXTRA OPTIONS",
        "LOAD GAME", "SAVE GAME", "READ THIS!"};
    int i, width = 0;

    V_DrawPatchDirect(94, 2, 0, W_CacheLumpName("M_DOOM", PU_CACHE));
    for (i = 0; i < MainDef.numitems; i++)
        if (M_StringWidth(labels[i]) > width) width = M_StringWidth(labels[i]);
    MainDef.x = (320 - width) / 2;
    for (i = 0; i < MainDef.numitems; i++)
        M_WriteText(MainDef.x, MainDef.y + i * LINEHEIGHT, labels[i]);
}




//
// M_NewGame
//
void M_DrawNewGame(void)
{
    V_DrawPatchDirect (96,14,0,W_CacheLumpName("M_NEWG",PU_CACHE));
    V_DrawPatchDirect (54,38,0,W_CacheLumpName("M_SKILL",PU_CACHE));
}

void M_NewGame(int choice)
{
    if (netgame && !demoplayback)
    {
	M_StartMessage(NEWGAME,NULL,false);
	return;
    }
	
    if ( gamemode == commercial )
	M_SetupNextMenu(&NewDef);
    else
	M_SetupNextMenu(&EpiDef);
}


//
//      M_Episode
//
int     epi;

void M_DrawEpisode(void)
{
    V_DrawPatchDirect (54,38,0,W_CacheLumpName("M_EPISOD",PU_CACHE));
}

void M_VerifyNightmare(int ch)
{
    if (ch != 'y')
	return;
		
    G_DeferedInitNew(nightmare,epi+1,1);
    M_ClearMenus ();
}

void M_ChooseSkill(int choice)
{
    if (choice == nightmare)
    {
	M_StartMessage(NIGHTMARE,M_VerifyNightmare,true);
	return;
    }
	
    G_DeferedInitNew(choice,epi+1,1);
    M_ClearMenus ();
}

void M_Episode(int choice)
{
    if ( (gamemode == shareware)
	 && choice)
    {
	M_StartMessage(SWSTRING,NULL,false);
	M_SetupNextMenu(&ReadDef1);
	return;
    }

    // Yet another hack...
    if ( (gamemode == registered)
	 && (choice > 2))
    {
      fprintf( stderr,
	       "M_Episode: 4th episode requires UltimateDOOM\n");
      choice = 0;
    }
	 
    epi = choice;
    M_SetupNextMenu(&NewDef);
}



//
// M_Options
//
char    detailNames[2][9]	= {"M_GDHIGH","M_GDLOW"};
char	msgNames[2][9]		= {"M_MSGOFF","M_MSGON"};


/* Collapse the two legacy slider spacer rows in the compact Options page. */
static int M_SettingsOptionY(int item)
{
    return 44 + LINEHEIGHT * (item - (item > option_empty1)
        - (item > option_empty2));
}

/* Keep every option and its slider above the status bar, in one font. */
void M_DrawOptions(void)
{
    static char *labels[] = {"END GAME", "MESSAGES", "GRAPHIC DETAIL",
        "SCREEN SIZE", "", "MOUSE SENSITIVITY", "", "SOUND VOLUME"};
    char *value;
    int i;

    V_DrawPatchDirect(108, 15, 0, W_CacheLumpName("M_OPTTTL", PU_CACHE));
    for (i = 0; i < opt_end; i++)
        if (OptionsMenu[i].status != -1)
            M_WriteText(54, M_SettingsOptionY(i), labels[i]);
    value = showMessages ? "ON" : "OFF";
    M_WriteText(280 - M_StringWidth(value), M_SettingsOptionY(messages), value);
    value = detailLevel ? "LOW" : "HIGH";
    M_WriteText(280 - M_StringWidth(value), M_SettingsOptionY(detail), value);
    M_DrawThermo(184, M_SettingsOptionY(mousesens) - 2, 10, mouseSensitivity);
    M_DrawThermo(184, M_SettingsOptionY(scrnsize) - 2, 9, screenSize);
    M_WriteText(54, 156, "ESC: BACK");
}

void M_Options(int choice)
{
    M_SetupNextMenu(&OptionsDef);
}



//
//      Toggle messages on/off
//
void M_ChangeMessages(int choice)
{
    // warning: unused parameter `int choice'
    choice = 0;
    showMessages = 1 - showMessages;
	
    if (!showMessages)
	players[consoleplayer].message = MSGOFF;
    else
	players[consoleplayer].message = MSGON ;

    message_dontfuckwithme = true;
}


//
// M_EndGame
//
void M_EndGameResponse(int ch)
{
    if (ch != 'y')
	return;
		
    currentMenu->lastOn = itemOn;
    M_ClearMenus ();
    D_StartTitle ();
}

void M_EndGame(int choice)
{
    choice = 0;
    if (!usergame)
    {
	S_StartSound(NULL,sfx_oof);
	return;
    }
	
    if (netgame)
    {
	M_StartMessage(NETEND,NULL,false);
	return;
    }
	
    M_StartMessage(ENDGAME,M_EndGameResponse,true);
}




//
// M_ReadThis
//
void M_ReadThis(int choice)
{
    choice = 0;
    M_SetupNextMenu(&ReadDef1);
}

void M_ReadThis2(int choice)
{
    choice = 0;
    M_SetupNextMenu(&ReadDef2);
}

void M_FinishReadThis(int choice)
{
    choice = 0;
    M_SetupNextMenu(&MainDef);
}




void M_ChangeSensitivity(int choice)
{
    switch(choice)
    {
      case 0:
	if (mouseSensitivity)
	    mouseSensitivity--;
	break;
      case 1:
	if (mouseSensitivity < 9)
	    mouseSensitivity++;
	break;
    }
}




void M_ChangeDetail(int choice)
{
    choice = 0;
    detailLevel = 1 - detailLevel;

    R_SetViewSize(screenblocks, detailLevel);
    players[consoleplayer].message = detailLevel ? DETAILLO : DETAILHI;

}




void M_SizeDisplay(int choice)
{
    switch(choice)
    {
      case 0:
	if (screenSize > 0)
	{
	    screenblocks--;
	    screenSize--;
	}
	break;
      case 1:
	if (screenSize < 8)
	{
	    screenblocks++;
	    screenSize++;
	}
	break;
    }
	

    R_SetViewSize (screenblocks, detailLevel);
}




//
//      Menu Functions
//
void
M_DrawThermo
( int	x,
  int	y,
  int	thermWidth,
  int	thermDot )
{
    int		xx;
    int		i;

    xx = x;
    V_DrawPatchDirect (xx,y,0,W_CacheLumpName("M_THERML",PU_CACHE));
    xx += 8;
    for (i=0;i<thermWidth;i++)
    {
	V_DrawPatchDirect (xx,y,0,W_CacheLumpName("M_THERMM",PU_CACHE));
	xx += 8;
    }
    V_DrawPatchDirect (xx,y,0,W_CacheLumpName("M_THERMR",PU_CACHE));

    V_DrawPatchDirect ((x+8) + thermDot*8,y,
		       0,W_CacheLumpName("M_THERMO",PU_CACHE));
}



void
M_DrawEmptyCell
( menu_t*	menu,
  int		item )
{
    V_DrawPatchDirect (menu->x - 10,        menu->y+item*LINEHEIGHT - 1, 0,
		       W_CacheLumpName("M_CELL1",PU_CACHE));
}

void
M_DrawSelCell
( menu_t*	menu,
  int		item )
{
    V_DrawPatchDirect (menu->x - 10,        menu->y+item*LINEHEIGHT - 1, 0,
		       W_CacheLumpName("M_CELL2",PU_CACHE));
}


void
M_StartMessage
( char*		string,
  void*		routine,
  boolean	input )
{
    messageLastMenuActive = menuactive;
    messageToPrint = 1;
    messageString = string;
    messageRoutine = routine;
    messageNeedsInput = input;
    menuactive = true;
    return;
}



void M_StopMessage(void)
{
    menuactive = messageLastMenuActive;
    messageToPrint = 0;
}



//
// Find string width from hu_font chars
//
int M_StringWidth(char* string)
{
    int             i;
    int             w = 0;
    int             c;
	
    for (i = 0;i < strlen(string);i++)
    {
	c = toupper(string[i]) - HU_FONTSTART;
	if (c < 0 || c >= HU_FONTSIZE)
	    w += 4;
	else
	    w += SHORT (hu_font[c]->width);
    }
		
    return w;
}



//
//      Find string height from hu_font chars
//
int M_StringHeight(char* string)
{
    int             i;
    int             h;
    int             height = SHORT(hu_font[0]->height);
	
    h = height;
    for (i = 0;i < strlen(string);i++)
	if (string[i] == '\n')
	    h += height;
		
    return h;
}


//
//      Write a string using the hu_font
//
void
M_WriteText
( int		x,
  int		y,
  char*		string)
{
    int		w;
    char*	ch;
    int		c;
    int		cx;
    int		cy;
		

    ch = string;
    cx = x;
    cy = y;
	
    while(1)
    {
	c = *ch++;
	if (!c)
	    break;
	if (c == '\n')
	{
	    cx = x;
	    cy += 12;
	    continue;
	}
		
	c = toupper(c) - HU_FONTSTART;
	if (c < 0 || c>= HU_FONTSIZE)
	{
	    cx += 4;
	    continue;
	}
		
	w = SHORT (hu_font[c]->width);
	if (cx+w > SCREENWIDTH)
	    break;
	V_DrawPatchDirect(cx, cy, 0, hu_font[c]);
	cx+=w;
    }
}




/* Extra options use Doom's navigation, font, cursor, and sounds. */
static void M_SettingsPage(int choice);
static void M_SettingsDraw(void);
static void M_SettingsRendering(int choice);
static void M_SettingsCRT(int choice);
static void M_SettingsHUD(int choice);
static void M_SettingsPreset(int choice);
static void M_SettingsKeyPreset(int choice);
static void M_SettingsBind(int choice);

static menuitem_t SettingsItems[] = {
    {2, "", M_SettingsPreset, 'p'},
    {1, "", M_SettingsPage, 'r'},
    {1, "", M_SettingsPage, 'c'},
    {1, "", M_SettingsPage, 'h'},
    {1, "", M_SettingsPage, 'k'}
};
static menu_t SettingsMenu = {
    5, &MainDef, SettingsItems, M_SettingsDraw, 54, 64, 0
};
static menuitem_t SettingsRenderingItems[] = {
    {2, "", M_SettingsRendering, 'r'}, {2, "", M_SettingsRendering, 'a'},
    {2, "", M_SettingsRendering, 'e'}, {2, "", M_SettingsRendering, 'f'},
    {2, "", M_SettingsRendering, 'u'}
};
static menu_t SettingsRenderingMenu = {
    5, &SettingsMenu, SettingsRenderingItems, M_SettingsDraw, 54, 64, 0
};
/* Future controls remain visible but cannot receive focus or change state. */
static menuitem_t SettingsCRTItems[] = {
    {2, "", M_SettingsCRT, 'c'}, {-1, "", NULL, 0}, {-1, "", NULL, 0}
};
static menu_t SettingsCRTMenu = {
    3, &SettingsMenu, SettingsCRTItems, M_SettingsDraw, 54, 64, 0
};
static menuitem_t SettingsHUDItems[] = {
    {2, "", M_SettingsHUD, 'f'}, {-1, "", NULL, 0}
};
static menu_t SettingsHUDMenu = {
    2, &SettingsMenu, SettingsHUDItems, M_SettingsDraw, 54, 64, 0
};
static menuitem_t SettingsKeyboardItems[] = {
    {2, "", M_SettingsKeyPreset, 'p'},
    {1, "", M_SettingsPage, 'm'}, {1, "", M_SettingsPage, 'a'}
};
static menu_t SettingsKeyboardMenu = {
    3, &SettingsMenu, SettingsKeyboardItems, M_SettingsDraw, 54, 64, 0
};
static menuitem_t SettingsMovementItems[] = {
    {1, "", M_SettingsBind, 'f'}, {1, "", M_SettingsBind, 'b'},
    {1, "", M_SettingsBind, 'l'}, {1, "", M_SettingsBind, 'r'},
    {1, "", M_SettingsBind, 's'}, {1, "", M_SettingsBind, 's'}
};
static menu_t SettingsMovementMenu = {
    6, &SettingsKeyboardMenu, SettingsMovementItems, M_SettingsDraw, 54, 64, 0
};
static menuitem_t SettingsActionItems[] = {
    {1, "", M_SettingsBind, 'f'}, {1, "", M_SettingsBind, 'u'},
    {1, "", M_SettingsBind, 's'}, {1, "", M_SettingsBind, 'r'},
    {1, "", M_SettingsBind, 't'}
};
static menu_t SettingsActionMenu = {
    5, &SettingsKeyboardMenu, SettingsActionItems, M_SettingsDraw, 54, 64, 0
};

/* Original and WASD bindings also belong to the global presets. */
static int settings_keys[2][M_BINDING_COUNT] = {
    {KEY_UPARROW, KEY_DOWNARROW, KEY_LEFTARROW, KEY_RIGHTARROW,
     ',', '.', KEY_RCTRL, ' ', KEY_RALT, KEY_RSHIFT, KEY_TAB},
    {'w', 's', KEY_LEFTARROW, KEY_RIGHTARROW,
     'a', 'd', KEY_RCTRL, 'e', KEY_RALT, KEY_RSHIFT, KEY_TAB}
};
static int settings_capture = -1;
static char *settings_binding_hint = "ENTER: CHANGE KEY  ESC: BACK";

/* Match the actual values so individual edits and restored storage show Custom. */
static int M_SettingsKeyPresetIndex(void)
{
    int preset, action;
    for (preset = 0; preset < 2; preset++) {
        for (action = 0; action < M_BINDING_COUNT; action++)
            if (*M_Binding(action) != settings_keys[preset][action]) break;
        if (action == M_BINDING_COUNT) return preset;
    }
    return 2;
}

/* Default and Emulation differ only in their CRT shader. */
static int M_SettingsPresetIndex(void)
{
    int keys = M_SettingsKeyPresetIndex();
    if (m_show_fps || screenblocks != 10) return 3;
    if (m_resolution == 1 && !m_aspect && !m_renderer && !m_freelook
        && !m_unlocked && !keys && (m_crt == 0 || m_crt == 1)) return m_crt;
    if (!m_resolution && m_aspect && m_renderer && m_freelook
        && m_unlocked && !m_crt && keys == 1) return 2;
    return 3;
}

/* Show engine key names without introducing font or browser dependencies. */
static char *M_SettingsKeyName(int key)
{
    static char name[2];
    switch (key) {
    case KEY_UPARROW: return "UP";
    case KEY_DOWNARROW: return "DOWN";
    case KEY_LEFTARROW: return "LEFT";
    case KEY_RIGHTARROW: return "RIGHT";
    case KEY_RCTRL: return "CTRL";
    case KEY_RALT: return "ALT";
    case KEY_RSHIFT: return "SHIFT";
    case KEY_TAB: return "TAB";
    case KEY_ENTER: return "ENTER";
    case KEY_BACKSPACE: return "BACKSPACE";
    case ' ': return "SPACE";
    default: name[0] = toupper(key); name[1] = 0; return name;
    }
}

/* Center a stable-width group, reserving room for its longest possible value. */
static int settings_value_x;
static void M_SettingsLayout(char **labels, int count, char *widest_value)
{
    int i, width = 0;
    for (i = 0; i < count; i++) {
        int label_width = M_StringWidth(labels[i]);
        if (label_width > width) width = label_width;
    }
    if (widest_value) width += 24 + M_StringWidth(widest_value);
    currentMenu->x = (320 - width) / 2;
    settings_value_x = currentMenu->x + width;
}

/* Keep paired labels and values inside the original 320-pixel menu area. */
static void M_SettingsRow(int row, char *label, char *value)
{
    int y = 64 + row * LINEHEIGHT;
    M_WriteText(currentMenu->x, y, label);
    if (value) M_WriteText(settings_value_x - M_StringWidth(value), y, value);
}

/* Draw the selected page entirely inside the 320x168 area above the HUD. */
static void M_SettingsDraw(void)
{
    static char *root[] = {"PRESET", "RENDERING", "CRT EMULATION", "HUD",
        "KEYBOARD"};
    static char *presets[] = {"DEFAULT", "EMULATION", "MODERN", "CUSTOM"};
    static char *actions[] = {"FORWARD", "BACKWARD", "TURN LEFT",
        "TURN RIGHT", "STRAFE LEFT", "STRAFE RIGHT", "FIRE", "USE / OPEN",
        "STRAFE MODIFIER", "RUN", "TOGGLE AUTOMAP"};
    static char *resolutions[] = {"NATIVE", "320X200", "640X400", "960X600",
        "1280X800", "1600X1000", "1920X1200"};
    static char *keys[] = {"ORIGINAL", "WASD", "CUSTOM"};
    static char *rendering[] = {"RESOLUTION", "ASPECT RATIO", "RENDERER",
        "FREE LOOK", "UNLOCK FPS"};
    static char *crt[] = {"OFF", "CLEAN CRT", "LOTTES", "CRT-PI",
        "EASYMODE", "ROYALE"};
    static char *crt_labels[] = {"CRT SHADER", "BLACK LEVEL", "ADDITIONAL BLOOM"};
    static char *crt_help[] = {"ORIGINAL PIXELS", "GENTLE BLENDING",
        "RGB ARCADE MONITOR", "LIGHTWEIGHT SCANLINES",
        "FLAT APERTURE GRILLE", "DETAILED TUBE - HIGH GPU COST"};
    static char *hud[] = {"FPS COUNTER", "STATUS BAR HEIGHT"};
    static char *keyboard[] = {"PRESET", "MOVEMENT", "ACTIONS"};
    char dimensions[32];
    char *title = "EXTRA OPTIONS";
    char *hint = "LEFT/RIGHT: CHANGE  ESC: BACK";
    char *description = NULL;
    int i, first;

    V_DrawPatchDirect(108, 15, 0, W_CacheLumpName("M_OPTTTL", PU_CACHE));
    if (currentMenu == &SettingsMenu) {
        M_SettingsLayout(root, 5, "EMULATION");
        M_SettingsRow(0, root[0], presets[M_SettingsPresetIndex()]);
        for (i = 1; i < 5; i++) M_SettingsRow(i, root[i], NULL);
        hint = itemOn ? "ENTER: OPEN  ESC: BACK" : hint;
    } else if (currentMenu == &SettingsRenderingMenu) {
        title = "RENDERING";
        M_SettingsLayout(rendering, 5, "1920X1200");
        M_SettingsRow(0, rendering[0], resolutions[m_resolution]);
        M_SettingsRow(1, rendering[1], m_aspect ? "BROWSER" : "4:3");
        M_SettingsRow(2, rendering[2], m_renderer ? "WEBGL" : "SOFTWARE");
        M_SettingsRow(3, rendering[3], !m_renderer ? "N/A"
            : m_freelook ? "ON" : "OFF");
        M_SettingsRow(4, rendering[4], m_unlocked ? "ON" : "OFF");
        sprintf(dimensions, "%d X %d", vid_width, vid_height);
        M_WriteText((320 - M_StringWidth(dimensions)) / 2, 136, dimensions);
        if (m_gpu_failed) description = "WEBGL UNAVAILABLE";
        else if (itemOn == 3 && !m_renderer) description = "REQUIRES WEBGL";
    } else if (currentMenu == &SettingsCRTMenu) {
        title = "CRT EMULATION";
        M_SettingsLayout(crt_labels, 3, "CLEAN CRT");
        M_SettingsRow(0, crt_labels[0], crt[m_crt]);
        M_SettingsRow(1, crt_labels[1], "SOON");
        M_SettingsRow(2, crt_labels[2], "SOON");
        M_WriteText((320 - M_StringWidth("SOON: NOT AVAILABLE YET")) / 2,
            120, "SOON: NOT AVAILABLE YET");
        description = m_crt_failed ? "WEBGL UNAVAILABLE" : crt_help[m_crt];
    } else if (currentMenu == &SettingsHUDMenu) {
        title = "HUD";
        M_SettingsLayout(hud, 2, "SOON");
        M_SettingsRow(0, hud[0], m_show_fps ? "ON" : "OFF");
        M_SettingsRow(1, hud[1], "SOON");
        description = "SOON: NOT AVAILABLE YET";
    } else if (currentMenu == &SettingsKeyboardMenu) {
        title = "KEYBOARD";
        M_SettingsLayout(keyboard, 3, "ORIGINAL");
        M_SettingsRow(0, keyboard[0], keys[M_SettingsKeyPresetIndex()]);
        M_SettingsRow(1, keyboard[1], NULL);
        M_SettingsRow(2, keyboard[2], NULL);
        hint = itemOn ? "ENTER: OPEN  ESC: BACK" : hint;
    } else {
        first = currentMenu == &SettingsMovementMenu ? 0 : 6;
        title = first ? "ACTIONS" : "MOVEMENT";
        M_SettingsLayout(actions + first, currentMenu->numitems, "BACKSPACE");
        for (i = 0; i < currentMenu->numitems; i++)
            M_SettingsRow(i, actions[first + i], settings_capture == first + i
                ? "?" : M_SettingsKeyName(*M_Binding(first + i)));
        hint = settings_binding_hint;
    }
    if (description)
        M_WriteText((320 - M_StringWidth(description)) / 2, 146, description);
    M_WriteText((320 - M_StringWidth(title)) / 2, 38, title);
    M_WriteText((320 - M_StringWidth(hint)) / 2, 156, hint);
}

/* Enter Extra Options directly from the main menu. */
static void M_ExtraOptions(int choice)
{
    M_SetupNextMenu(&SettingsMenu);
}

/* Keep category routing and each page's previous-menu pointer together. */
static void M_SettingsPage(int choice)
{
    if (currentMenu == &SettingsMenu) {
        switch (choice) {
        case 1: M_SetupNextMenu(&SettingsRenderingMenu); break;
        case 2: M_SetupNextMenu(&SettingsCRTMenu); break;
        case 3: M_SetupNextMenu(&SettingsHUDMenu); break;
        case 4: M_SetupNextMenu(&SettingsKeyboardMenu); break;
        }
    } else {
        settings_binding_hint = "ENTER: CHANGE KEY  ESC: BACK";
        M_SetupNextMenu(choice == 1 ? &SettingsMovementMenu : &SettingsActionMenu);
    }
}

/* Resize and switch backends only after the engine returns to JavaScript. */
static void M_SettingsRendering(int choice)
{
    if (itemOn == 0)
        m_resolution = (m_resolution + (choice ? 1 : 6)) % 7;
    else if (itemOn == 1) m_aspect = !m_aspect;
    else if (itemOn == 2) {
        m_renderer = !m_renderer;
        if (!m_renderer) m_freelook = 0;
    } else if (itemOn == 3 && m_renderer) m_freelook = !m_freelook;
    else if (itemOn == 4) {
        m_unlocked = !m_unlocked;
        R_SetViewSize(screenblocks, detailLevel);
    }
    I_SettingsChanged();
}

/* Change the display filter independently of world rendering. */
static void M_SettingsCRT(int choice)
{
    m_crt = (m_crt + (choice ? 1 : 5)) % 6;
    I_SettingsChanged();
}

/* Count presented frames; the simulation remains at 35 Hz. */
static void M_SettingsHUD(int choice)
{
    m_show_fps = !m_show_fps;
    I_SettingsChanged();
}

/* Apply presentation and keyboard presets without changing sound or game state. */
static void M_SettingsPreset(int choice)
{
    int i, preset = M_SettingsPresetIndex();
    preset = preset == 3 ? (choice ? 0 : 2)
        : (preset + (choice ? 1 : 2)) % 3;
    m_resolution = preset == 2 ? 0 : 1;
    m_aspect = m_renderer = m_freelook = m_unlocked = preset == 2;
    m_show_fps = m_gpu_failed = m_crt_failed = 0;
    m_crt = preset == 1;
    for (i = 0; i < M_BINDING_COUNT; i++)
        *M_Binding(i) = settings_keys[preset == 2][i];
    screenblocks = 10;
    screenSize = 7;
    R_SetViewSize(screenblocks, detailLevel);
    I_SettingsChanged();
}

/* Cycle keyboard presets, including the map toggle. */
static void M_SettingsKeyPreset(int choice)
{
    int i, preset = M_SettingsKeyPresetIndex();
    preset = preset == 2 ? (choice ? 0 : 1) : !preset;
    for (i = 0; i < M_BINDING_COUNT; i++)
        *M_Binding(i) = settings_keys[preset][i];
    I_SettingsChanged();
}

/* Capture one action while normal menu navigation is temporarily suspended. */
static void M_SettingsBind(int choice)
{
    settings_capture = choice + (currentMenu == &SettingsActionMenu ? 6 : 0);
    settings_binding_hint = "PRESS KEY. ESC: CANCEL";
}

/* Preserve menu, pause, and weapon shortcuts when rebinding actions. */
static boolean M_SettingsCapture(event_t *ev)
{
    int i, key = ev->data1;
    if (ev->type != ev_keydown) return ev->type != ev_keyup;
    if (key == KEY_ESCAPE) {
        settings_capture = -1;
        settings_binding_hint = "ENTER: CHANGE KEY  ESC: BACK";
        return true;
    }
    if (!((key >= 32 && key <= 126) || key == KEY_ENTER
        || key == KEY_TAB || key == KEY_BACKSPACE || key == KEY_UPARROW
        || key == KEY_DOWNARROW || key == KEY_LEFTARROW || key == KEY_RIGHTARROW
        || key == KEY_RCTRL || key == KEY_RALT || key == KEY_RSHIFT)
        || (key >= '1' && key <= '7') || key == '-' || key == '=') {
        settings_binding_hint = "RESERVED KEY. TRY ANOTHER";
        return true;
    }
    for (i = 0; i < M_BINDING_COUNT; i++) {
        if (i != settings_capture && *M_Binding(i) == key) {
            settings_binding_hint = "KEY IN USE. TRY ANOTHER";
            return true;
        }
    }
    *M_Binding(settings_capture) = key;
    settings_capture = -1;
    settings_binding_hint = "ENTER: CHANGE KEY  ESC: BACK";
    S_StartSound(NULL, sfx_pistol);
    I_SettingsChanged();
    return true;
}

/* Render the counter with the game's own font, inside the framebuffer. */
void M_DrawFPS(void)
{
    char text[24];
    if (!m_show_fps) return;
    sprintf(text, "%d FPS", m_fps_value);
    v_ui_anchor = V_UI_TOP;
    M_WriteText(318 - M_StringWidth(text), 2, text);
    v_ui_anchor = V_UI_CENTER;
}

//
// CONTROL PANEL
//

//
// M_Responder
//
boolean M_Responder (event_t* ev)
{
    int             ch;
    int             i;
    static  int     joywait = 0;
    static  int     mousewait = 0;
    static  int     mousey = 0;
    static  int     lasty = 0;
    static  int     mousex = 0;
    static  int     lastx = 0;
	
    ch = -1;
    if (settings_capture >= 0) return M_SettingsCapture(ev);
	
    if (ev->type == ev_joystick && joywait < I_GetTime())
    {
	if (ev->data3 == -1)
	{
	    ch = KEY_UPARROW;
	    joywait = I_GetTime() + 5;
	}
	else if (ev->data3 == 1)
	{
	    ch = KEY_DOWNARROW;
	    joywait = I_GetTime() + 5;
	}
		
	if (ev->data2 == -1)
	{
	    ch = KEY_LEFTARROW;
	    joywait = I_GetTime() + 2;
	}
	else if (ev->data2 == 1)
	{
	    ch = KEY_RIGHTARROW;
	    joywait = I_GetTime() + 2;
	}
		
	if (ev->data1&1)
	{
	    ch = KEY_ENTER;
	    joywait = I_GetTime() + 5;
	}
	if (ev->data1&2)
	{
	    ch = KEY_BACKSPACE;
	    joywait = I_GetTime() + 5;
	}
    }
    else
    {
	if (ev->type == ev_mouse && mousewait < I_GetTime())
	{
	    mousey += ev->data3;
	    if (mousey < lasty-30)
	    {
		ch = KEY_DOWNARROW;
		mousewait = I_GetTime() + 5;
		mousey = lasty -= 30;
	    }
	    else if (mousey > lasty+30)
	    {
		ch = KEY_UPARROW;
		mousewait = I_GetTime() + 5;
		mousey = lasty += 30;
	    }
		
	    mousex += ev->data2;
	    if (mousex < lastx-30)
	    {
		ch = KEY_LEFTARROW;
		mousewait = I_GetTime() + 5;
		mousex = lastx -= 30;
	    }
	    else if (mousex > lastx+30)
	    {
		ch = KEY_RIGHTARROW;
		mousewait = I_GetTime() + 5;
		mousex = lastx += 30;
	    }
		
	    if (ev->data1&1)
	    {
		ch = KEY_ENTER;
		mousewait = I_GetTime() + 15;
	    }
			
	    if (ev->data1&2)
	    {
		ch = KEY_BACKSPACE;
		mousewait = I_GetTime() + 15;
	    }
	}
	else
	    if (ev->type == ev_keydown)
	    {
		ch = ev->data1;
	    }
    }
    
    if (ch == -1)
	return false;

    
    // Save Game string input
    if (saveStringEnter)
    {
	switch(ch)
	{
	  case KEY_BACKSPACE:
	    if (saveCharIndex > 0)
	    {
		saveCharIndex--;
		savegamestrings[saveSlot][saveCharIndex] = 0;
	    }
	    break;
				
	  case KEY_ESCAPE:
	    saveStringEnter = 0;
	    strcpy(&savegamestrings[saveSlot][0],saveOldString);
	    break;
				
	  case KEY_ENTER:
	    saveStringEnter = 0;
	    if (savegamestrings[saveSlot][0])
		M_DoSave(saveSlot);
	    break;
				
	  default:
	    ch = toupper(ch);
	    if (ch != 32)
		if (ch-HU_FONTSTART < 0 || ch-HU_FONTSTART >= HU_FONTSIZE)
		    break;
	    if (ch >= 32 && ch <= 127 &&
		saveCharIndex < SAVESTRINGSIZE-1 &&
		M_StringWidth(savegamestrings[saveSlot]) <
		(SAVESTRINGSIZE-2)*8)
	    {
		savegamestrings[saveSlot][saveCharIndex++] = ch;
		savegamestrings[saveSlot][saveCharIndex] = 0;
	    }
	    break;
	}
	return true;
    }
    
    // Take care of any messages that need input
    if (messageToPrint)
    {
	if (messageNeedsInput == true &&
	    !(ch == ' ' || ch == 'n' || ch == 'y' || ch == KEY_ESCAPE))
	    return false;
		
	menuactive = messageLastMenuActive;
	messageToPrint = 0;
	if (messageRoutine)
	    messageRoutine(ch);
			
	menuactive = false;
	S_StartSound(NULL,sfx_swtchx);
	return true;
    }
	
    if (devparm && ch == KEY_F1)
    {
	G_ScreenShot ();
	return true;
    }
		
    
    // F-Keys
    if (!menuactive)
	switch(ch)
	{
	  case KEY_MINUS:         // Screen size down
	    if (automapactive || chat_on)
		return false;
	    M_SizeDisplay(0);
	    S_StartSound(NULL,sfx_stnmov);
	    return true;
				
	  case KEY_EQUALS:        // Screen size up
	    if (automapactive || chat_on)
		return false;
	    M_SizeDisplay(1);
	    S_StartSound(NULL,sfx_stnmov);
	    return true;
				
	  case KEY_F1:            // Help key
	    M_StartControlPanel ();

	    if ( gamemode == retail )
	      currentMenu = &ReadDef2;
	    else
	      currentMenu = &ReadDef1;
	    
	    itemOn = 0;
	    S_StartSound(NULL,sfx_swtchn);
	    return true;
				
	  case KEY_F2:            // Save
	    M_StartControlPanel();
	    S_StartSound(NULL,sfx_swtchn);
	    M_SaveGame(0);
	    return true;
				
	  case KEY_F3:            // Load
	    M_StartControlPanel();
	    S_StartSound(NULL,sfx_swtchn);
	    M_LoadGame(0);
	    return true;
				
	  case KEY_F4:            // Sound Volume
	    M_StartControlPanel ();
	    currentMenu = &SoundDef;
	    itemOn = sfx_vol;
	    S_StartSound(NULL,sfx_swtchn);
	    return true;
				
	  case KEY_F5:            // Detail toggle
	    M_ChangeDetail(0);
	    S_StartSound(NULL,sfx_swtchn);
	    return true;
				
	  case KEY_F6:            // Quicksave
	    S_StartSound(NULL,sfx_swtchn);
	    M_QuickSave();
	    return true;
				
	  case KEY_F7:            // End game
	    S_StartSound(NULL,sfx_swtchn);
	    M_EndGame(0);
	    return true;
				
	  case KEY_F8:            // Toggle messages
	    M_ChangeMessages(0);
	    S_StartSound(NULL,sfx_swtchn);
	    return true;
				
	  case KEY_F9:            // Quickload
	    S_StartSound(NULL,sfx_swtchn);
	    M_QuickLoad();
	    return true;
				
	  case KEY_F11:           // gamma toggle
	    usegamma++;
	    if (usegamma > 4)
		usegamma = 0;
	    players[consoleplayer].message = gammamsg[usegamma];
	    I_SetPalette (W_CacheLumpName ("PLAYPAL",PU_CACHE));
	    return true;
				
	}

    
    // Pop-up menu?
    if (!menuactive)
    {
	if (ch == KEY_ESCAPE)
	{
	    M_StartControlPanel ();
	    S_StartSound(NULL,sfx_swtchn);
	    return true;
	}
	return false;
    }

    
    // Keys usable within menu
    switch (ch)
    {
      case KEY_DOWNARROW:
	do
	{
	    if (itemOn+1 > currentMenu->numitems-1)
		itemOn = 0;
	    else itemOn++;
	    S_StartSound(NULL,sfx_pstop);
	} while(currentMenu->menuitems[itemOn].status==-1);
	return true;
		
      case KEY_UPARROW:
	do
	{
	    if (!itemOn)
		itemOn = currentMenu->numitems-1;
	    else itemOn--;
	    S_StartSound(NULL,sfx_pstop);
	} while(currentMenu->menuitems[itemOn].status==-1);
	return true;

      case KEY_LEFTARROW:
	if (currentMenu->menuitems[itemOn].routine &&
	    currentMenu->menuitems[itemOn].status == 2)
	{
	    S_StartSound(NULL,sfx_stnmov);
	    currentMenu->menuitems[itemOn].routine(0);
	}
	return true;
		
      case KEY_RIGHTARROW:
	if (currentMenu->menuitems[itemOn].routine &&
	    currentMenu->menuitems[itemOn].status == 2)
	{
	    S_StartSound(NULL,sfx_stnmov);
	    currentMenu->menuitems[itemOn].routine(1);
	}
	return true;

      case KEY_ENTER:
	if (currentMenu->menuitems[itemOn].routine &&
	    currentMenu->menuitems[itemOn].status)
	{
	    currentMenu->lastOn = itemOn;
	    if (currentMenu->menuitems[itemOn].status == 2)
	    {
		currentMenu->menuitems[itemOn].routine(1);      // right arrow
		S_StartSound(NULL,sfx_stnmov);
	    }
	    else
	    {
		currentMenu->menuitems[itemOn].routine(itemOn);
		S_StartSound(NULL,sfx_pistol);
	    }
	}
	return true;
		
      case KEY_ESCAPE:
        if (currentMenu->prevMenu) {
            currentMenu->lastOn = itemOn;
            M_SetupNextMenu(currentMenu->prevMenu);
            S_StartSound(NULL, sfx_swtchn);
            return true;
        }
	currentMenu->lastOn = itemOn;
	M_ClearMenus ();
	S_StartSound(NULL,sfx_swtchx);
	return true;
		
      case KEY_BACKSPACE:
	currentMenu->lastOn = itemOn;
	if (currentMenu->prevMenu)
	{
	    currentMenu = currentMenu->prevMenu;
	    itemOn = currentMenu->lastOn;
	    S_StartSound(NULL,sfx_swtchn);
	}
	return true;
	
      default:
	for (i = itemOn+1;i < currentMenu->numitems;i++)
	    if (currentMenu->menuitems[i].alphaKey == ch)
	    {
		itemOn = i;
		S_StartSound(NULL,sfx_pstop);
		return true;
	    }
	for (i = 0;i <= itemOn;i++)
	    if (currentMenu->menuitems[i].alphaKey == ch)
	    {
		itemOn = i;
		S_StartSound(NULL,sfx_pstop);
		return true;
	    }
	break;
	
    }

    return false;
}



//
// M_StartControlPanel
//
void M_StartControlPanel (void)
{
    // intro might call this repeatedly
    if (menuactive)
	return;
    
    menuactive = 1;
    currentMenu = &MainDef;         // JDC
    itemOn = currentMenu->lastOn;   // JDC
}


//
// M_Drawer
// Called after the view has been rendered,
// but before it has been blitted.
//
void M_Drawer (void)
{
    static short	x;
    static short	y;
    short		i;
    short		max;
    char		string[40];
    int			start;

    inhelpscreens = false;

    
    // Horiz. & Vertically center string and print it.
    if (messageToPrint)
    {
	start = 0;
	y = 100 - M_StringHeight(messageString)/2;
	while(*(messageString+start))
	{
	    for (i = 0;i < strlen(messageString+start);i++)
		if (*(messageString+start+i) == '\n')
		{
		    memset(string,0,40);
		    strncpy(string,messageString+start,i);
		    start += i+1;
		    break;
		}
				
	    if (i == strlen(messageString+start))
	    {
		strcpy(string,messageString+start);
		start += i;
	    }
				
	    x = 160 - M_StringWidth(string)/2;
	    M_WriteText(x,y,string);
	    y += SHORT(hu_font[0]->height);
	}
	return;
    }

    if (!menuactive)
	return;

    if (currentMenu->routine)
	currentMenu->routine();         // call Draw routine
    
    /* The compact font needs a matching cursor, aligned with its actual rows. */
    if (currentMenu == &MainDef || currentMenu == &OptionsDef
        || currentMenu->routine == M_SettingsDraw) {
        x = currentMenu == &OptionsDef ? 54 : currentMenu->x;
        y = currentMenu == &OptionsDef ? M_SettingsOptionY(itemOn)
            : currentMenu->y + itemOn * LINEHEIGHT;
        V_DrawHalfPatch(x - 20, y - 1,
            W_CacheLumpName(skullName[whichSkull], PU_CACHE));
        return;
    }
    // DRAW MENU
    x = currentMenu->x;
    y = currentMenu->y;
    max = currentMenu->numitems;

    for (i=0;i<max;i++)
    {
	if (currentMenu->menuitems[i].name[0])
	    V_DrawPatchDirect (x,y,0,
			       W_CacheLumpName(currentMenu->menuitems[i].name ,PU_CACHE));
	y += LINEHEIGHT;
    }

    
    // DRAW SKULL
    V_DrawPatchDirect(x + SKULLXOFF,currentMenu->y - 5 + itemOn*LINEHEIGHT, 0,
		      W_CacheLumpName(skullName[whichSkull],PU_CACHE));

}


//
// M_ClearMenus
//
void M_ClearMenus (void)
{
    menuactive = 0;
    // if (!netgame && usergame && paused)
    //       sendpause = true;
}




//
// M_SetupNextMenu
//
void M_SetupNextMenu(menu_t *menudef)
{
    currentMenu = menudef;
    itemOn = currentMenu->lastOn;
}


//
// M_Ticker
//
void M_Ticker (void)
{
    if (--skullAnimCounter <= 0)
    {
	whichSkull ^= 1;
	skullAnimCounter = 8;
    }
}


//
// M_Init
//
void M_Init (void)
{
    currentMenu = &MainDef;
    menuactive = 0;
    itemOn = currentMenu->lastOn;
    whichSkull = 0;
    skullAnimCounter = 10;
    screenSize = screenblocks - 3;
    messageToPrint = 0;
    messageString = NULL;
    messageLastMenuActive = menuactive;
    quickSaveSlot = -1;

    // Here we could catch other version dependencies,
    //  like HELP1/2, and four episodes.

  
    switch ( gamemode )
    {
      case commercial:
	// This is used because DOOM 2 had only one HELP
        //  page. I use CREDIT as second page now, but
	//  kept this hack for educational purposes.
	MainDef.numitems--;
	MainDef.y += 8;
	NewDef.prevMenu = &MainDef;
	ReadDef1.routine = M_DrawReadThis1;
	ReadDef1.x = 330;
	ReadDef1.y = 165;
	ReadMenu1[0].routine = M_FinishReadThis;
	break;
      case shareware:
	// Episode 2 and 3 are handled,
	//  branching to an ad screen.
      case registered:
	// We need to remove the fourth episode.
	EpiDef.numitems--;
	break;
      case retail:
	// We are fine.
      default:
	break;
    }
    
}

