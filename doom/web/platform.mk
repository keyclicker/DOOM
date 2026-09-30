# Browser backend: supported. See README.md for build and test commands.
CC := $(EMCC)
COMMON += d_frame.c m_settings.c r_view.c r_interp.c v_view.c r_gpu.c
BACKEND += web/i_render.c
CPPFLAGS += -DHARDWARE_RENDER
CPPFLAGS += -DNORMALUNIX -DVARIABLE_VIDEO -DEXTENDED_MENU -DEXTERNAL_LOOP
CFLAGS += $(OPT) -flto -Wno-error=implicit-function-declaration \
    -Wno-error=incompatible-pointer-types
LDFLAGS += $(OPT) -flto --no-entry -sENVIRONMENT=web -sMODULARIZE=1 \
    -sEXPORT_NAME=createDoom -sFILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8 -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=536870912 \
    -sSTACK_SIZE=1048576 -sMALLOC=emmalloc -sASSERTIONS=0 -sINVOKE_RUN=0
TARGET := $(O)/index.html

MUSIC_OBJECTS := $(addprefix $(O)/,s_opl.o vendor/nuked-opl3/opl3.o \
    web/i_music.o)

# Grouped outputs ensure a deleted WASM file triggers relinking, too.
$(O)/doom.js $(O)/doom.wasm &: $(OBJECTS)
	$(CC) $(LDFLAGS) $^ -o $(O)/doom.js

# The OPL driver runs in its own worklet and uses C99, not the legacy dialect.
$(MUSIC_OBJECTS): CFLAGS := -std=c99 -O2 -flto -fwrapv
$(O)/music.wasm: $(MUSIC_OBJECTS)
	$(EMCC) $^ -O2 -flto -fwrapv --no-entry -sSTANDALONE_WASM=1 \
	    -sFILESYSTEM=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 -o $@

$(O)/index.html: $(O)/doom.js $(O)/doom.wasm $(O)/music.wasm \
    web/pack.py web/shell.html web/app.js web/audio.js web/settings.js web/render.js \
    web/music-worklet.js web/crt.js web/crt-presets.js web/pack_shaders.py \
    $(wildcard shaders/*/*)
	$(PYTHON) web/pack.py $(O)

-include $(MUSIC_OBJECTS:.o=.d)
