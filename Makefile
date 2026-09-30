.DEFAULT_GOAL := all

O := build
PYTHON ?= python3
EMCC ?= emcc
OPT ?= -Oz
DOOM1_WAD ?= $(O)/wads/DOOM.WAD
DOOM2_WAD ?= $(O)/wads/DOOM2.WAD
HTML := doom-engine.html doom.html doom1.html doom2.html
PACK_SOURCES := tools/pack_single.py tools/pack.py tools/pack_shaders.py \
 web/unpack.js lib/xz-decompress/xz-decompress.min.js lib/xz-decompress/LICENSE

SOURCES := doomdef.c doomstat.c dstrings.c tables.c \
 f_finale.c f_wipe.c d_main.c d_net.c d_items.c d_frame.c g_game.c \
 m_menu.c m_misc.c m_argv.c m_bbox.c m_fixed.c m_swap.c m_settings.c \
 m_cheat.c m_random.c am_map.c \
 p_ceilng.c p_doors.c p_enemy.c p_floor.c p_inter.c p_lights.c \
 p_map.c p_maputl.c p_plats.c p_pspr.c p_setup.c p_sight.c \
 p_spec.c p_switch.c p_mobj.c p_telept.c p_tick.c p_saveg.c p_user.c \
 r_bsp.c r_data.c r_draw.c r_main.c r_plane.c r_segs.c r_sky.c r_things.c \
 r_view.c r_interp.c r_gpu.c \
 w_wad.c wi_stuff.c v_video.c v_view.c st_lib.c st_stuff.c hu_stuff.c hu_lib.c \
 s_sound.c z_zone.c info.c sounds.c \
 i_main.c i_system.c i_video.c i_sound.c i_net.c i_render.c

CPPFLAGS += -I. -Idoom
CFLAGS += -std=gnu89 -fwrapv -fno-strict-aliasing -fcommon \
 $(OPT) -flto -Wno-error=implicit-function-declaration \
 -Wno-error=incompatible-pointer-types
LDFLAGS += $(OPT) -flto --no-entry -sENVIRONMENT=web -sMODULARIZE=1 \
 -sEXPORT_NAME=createDoom -sFILESYSTEM=1 \
 -sINCOMING_MODULE_JS_API=locateFile,wasmBinary,print,printErr \
 -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8 -sALLOW_MEMORY_GROWTH=1 \
 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=536870912 \
 -sSTACK_SIZE=1048576 -sMALLOC=emmalloc -sASSERTIONS=0 -sINVOKE_RUN=0

OBJECTS := $(addprefix $(O)/doom/,$(SOURCES:.c=.o))
MUSIC_OBJECTS := $(addprefix $(O)/,doom/s_opl.o doom/i_music.o \
 lib/nuked-opl3/opl3.o)

.PHONY: all preview clean $(HTML)
all: doom-engine.html
preview: $(HTML)

$(HTML): %: $(O)/% $(O)/%.gz

$(O)/%.o: %.c Makefile
	mkdir -p $(@D)
	$(EMCC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

$(O)/doom.js $(O)/doom.wasm &: $(OBJECTS)
	$(EMCC) $(LDFLAGS) $^ -o $(O)/doom.js

# Synthesis runs in the audio worklet, with its own WASM memory and entry point.
$(MUSIC_OBJECTS): CFLAGS := -std=c99 -O2 -flto -fwrapv
$(O)/music.wasm: $(MUSIC_OBJECTS)
	$(EMCC) $^ -O2 -flto -fwrapv --no-entry -sSTANDALONE_WASM=1 \
	  -sFILESYSTEM=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 -o $@

$(O)/index.html: $(O)/doom.js $(O)/doom.wasm $(O)/music.wasm \
 tools/pack.py tools/pack_shaders.py web/shell.html \
 web/launcher.js web/app.js web/audio.js web/settings.js web/render.js \
 web/music-worklet.js web/crt.js web/crt-presets.js $(wildcard shaders/*/*)
	$(PYTHON) tools/pack.py $(O)

$(O)/doom-engine.html $(O)/doom-engine.html.gz &: $(O)/index.html $(PACK_SOURCES)
	$(PYTHON) tools/pack_single.py $(O) --output $(O)/doom-engine.html

$(O)/doom1.html $(O)/doom1.html.gz &: $(O)/index.html $(PACK_SOURCES) $(DOOM1_WAD)
	$(PYTHON) tools/pack_single.py $(O) --output $(O)/doom1.html \
	  --wad "$(DOOM1_WAD)"

$(O)/doom2.html $(O)/doom2.html.gz &: $(O)/index.html $(PACK_SOURCES) $(DOOM2_WAD)
	$(PYTHON) tools/pack_single.py $(O) --output $(O)/doom2.html \
	  --wad "$(DOOM2_WAD)"

$(O)/doom.html $(O)/doom.html.gz &: $(O)/index.html $(PACK_SOURCES) \
 $(DOOM1_WAD) $(DOOM2_WAD)
	$(PYTHON) tools/pack_single.py $(O) --output $(O)/doom.html \
	  --wad "$(DOOM1_WAD)" --wad "$(DOOM2_WAD)"

$(DOOM1_WAD) $(DOOM2_WAD):
	@echo 'Missing $@. Supply your local IWAD before building previews.'
	@exit 1

# Keep private input WADs and any unrelated local files in build/.
clean:
	rm -rf $(O)/doom $(O)/lib
	rm -f $(addprefix $(O)/,doom.js doom.wasm music.wasm index.html \
	  $(HTML) $(HTML:=.gz))

-include $(OBJECTS:.o=.d) $(MUSIC_OBJECTS:.o=.d)
