# One engine, with the original i_* platform boundaries.
.DEFAULT_GOAL := all
PLATFORM ?= web
O := build/$(PLATFORM)
PYTHON ?= python3
EMCC ?= emcc
OPT ?= -Oz

# Keep the engine list explicit: adding an i_* backend must not change it.
COMMON := doomdef.c doomstat.c dstrings.c tables.c \
    f_finale.c f_wipe.c d_main.c d_net.c d_items.c g_game.c \
    m_menu.c m_misc.c m_argv.c m_bbox.c m_fixed.c m_swap.c \
    m_cheat.c m_random.c am_map.c \
    p_ceilng.c p_doors.c p_enemy.c p_floor.c p_inter.c p_lights.c \
    p_map.c p_maputl.c p_plats.c p_pspr.c p_setup.c p_sight.c \
    p_spec.c p_switch.c p_mobj.c p_telept.c p_tick.c p_saveg.c p_user.c \
    r_bsp.c r_data.c r_draw.c r_main.c r_plane.c r_segs.c r_sky.c r_things.c \
    w_wad.c wi_stuff.c v_video.c st_lib.c st_stuff.c hu_stuff.c hu_lib.c \
    s_sound.c z_zone.c info.c sounds.c
BACKEND := $(addprefix $(PLATFORM)/,i_main.c i_system.c i_video.c i_sound.c \
    i_net.c)
CPPFLAGS += -I.
# The 1997 engine relies on wrapping arithmetic, aliasing, and common symbols.
CFLAGS += -std=gnu89 -fwrapv -fno-strict-aliasing -fcommon

OBJECTS = $(addprefix $(O)/,$(COMMON:.c=.o) $(BACKEND:.c=.o))

include $(PLATFORM)/platform.mk

.PHONY: all clean
all: $(TARGET)

$(O)/%.o: %.c Makefile $(PLATFORM)/platform.mk
	@mkdir -p $(@D)
	$(CC) $(CPPFLAGS) $(CFLAGS) -MMD -MP -c $< -o $@

# Source files live in linux/ and web/; remove only this target's outputs.
clean:
	rm -rf $(O)

-include $(OBJECTS:.o=.d)
