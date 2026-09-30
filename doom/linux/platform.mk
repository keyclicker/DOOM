# Linux backend: NOT READY. Preserved for future porting work.
# Preserve the original 32-bit engine ABI and X11/Unix sound backend.
CPPFLAGS += -DNORMALUNIX -DLINUX -DSNDSERV
CFLAGS += -m32 -O2 -g -Wno-error=implicit-function-declaration \
    -Wno-error=incompatible-pointer-types -Wno-error=int-conversion
LDFLAGS += -m32
LDLIBS += -lXext -lX11 -lm
TARGET := $(O)/linuxxdoom

$(O)/linuxxdoom: $(OBJECTS)
	$(CC) $(LDFLAGS) $^ $(LDLIBS) -o $@
