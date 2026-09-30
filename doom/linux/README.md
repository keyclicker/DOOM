# Linux backend — not ready

This is the original Linux Doom 1.10 X11/Unix backend, kept alongside the
browser backend to preserve the platform boundary. It is not a supported
modern Linux port. A successful compile does not change that status.

It still assumes a 32-bit process, an 8-bit PseudoColor X11 display, and the
legacy Unix sound server/OSS interfaces. Native music is still a stub.
Browser resolution, interpolation, FPS, and extended settings are not enabled.

With GNU Make 4.3+, a 32-bit C toolchain, and 32-bit X11/Xext development
libraries installed:

```sh
make -C doom PLATFORM=linux
```

The binary is `doom/build/linux/linuxxdoom`. Use `CC` to select an alternate
32-bit compiler. The same common engine sources are compiled for both targets;
Linux does not depend on Emscripten, Python, or any browser files.

Readiness work remains: modern display/input and audio backends, a deliberate
64-bit/save-format portability pass if desired, and runtime regression testing.
This consolidation only updates build plumbing and obsolete errno declarations.
The preserved backend is a reference for the original interfaces, not a promise
of desktop compatibility.
