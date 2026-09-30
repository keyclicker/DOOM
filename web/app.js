/* SPDX-License-Identifier: GPL-2.0-only */

/** Validate the directory before passing a local IWAD to the legacy engine. */
function inspectWad(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const decoder = new TextDecoder('ascii');
  if (bytes.length < 12 || decoder.decode(bytes.subarray(0, 4)) !== 'IWAD') {
    throw new Error('Choose a Doom IWAD, not a patch WAD.');
  }
  const count = view.getUint32(4, true);
  const offset = view.getUint32(8, true);
  if (!count || count > 65536 || offset + count * 16 > bytes.length) {
    throw new Error('Invalid WAD directory.');
  }
  const names = new Set();
  for (let i = 0; i < count; i++) {
    const at = offset + i * 16;
    const start = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (start + size > bytes.length) throw new Error('Truncated WAD lump.');
    names.add(decoder.decode(bytes.subarray(at + 8, at + 16))
      .replace(/\0.*$/, '').toUpperCase());
  }
  for (const name of ['PLAYPAL', 'COLORMAP', 'TEXTURE1', 'PNAMES']) {
    if (!names.has(name)) throw new Error(`Missing Doom data: ${name}.`);
  }
  if (names.has('MAP01')) return 'doom2.wad';
  if (names.has('E4M1')) return 'doomu.wad';
  if (names.has('E2M1')) return 'doom.wad';
  if (names.has('E1M1')) return 'doom1.wad';
  throw new Error('This IWAD contains no Doom maps.');
}

/** A canvas, a file picker, and the original game. */
const Doom = {
  audio: new DoomAudio(),
  engine: null,
  running: false,
  suspended: false,
  held: new Map(),
  buttons: 0,
  mouseX: 0,
  mouseY: 0,
  lastFrame: 0,
  elapsed: 0,
  storageKey: '',
  canvas: document.querySelector('#screen'),
  loader: document.querySelector('#load'),
  message: document.querySelector('#message'),

  /** Restore only native saves and preferences for this exact IWAD. */
  restore() {
    try {
      const files = JSON.parse(localStorage.getItem(this.storageKey) || '{}');
      for (const [name, data] of Object.entries(files)) {
        if (!/^(doomsav[0-5]\.dsg|\.doomrc)$/.test(name)) continue;
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        this.engine.FS.writeFile('/' + name, bytes);
      }
    } catch (error) { console.warn('Could not restore saves:', error); }
  },

  /** Save small files only; the selected WAD never enters browser storage. */
  persist() {
    if (!this.engine || !this.storageKey) return;
    try {
      this.engine._web_save_defaults();
      const files = {};
      for (const name of this.engine.FS.readdir('/')) {
        if (!/^(doomsav[0-5]\.dsg|\.doomrc)$/.test(name)) continue;
        const bytes = this.engine.FS.readFile('/' + name);
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        files[name] = btoa(binary);
      }
      localStorage.setItem(this.storageKey, JSON.stringify(files));
    } catch (error) { console.warn('Could not persist saves:', error); }
  },

  /** Load bundled or adjacent WASM with a local or embedded IWAD. */
  async load(file) {
    if (this.running || this.loading || !file) return;
    this.loading = true;
    try {
      if (navigator.userActivation?.isActive) {
        document.documentElement.requestFullscreen?.().catch(console.warn);
      }
      // Autoplay restrictions must not hold game startup behind audio.resume().
      this.audio.resume().catch(console.warn);
      this.message.textContent = 'Loading…';
      await this.audio.initMusic();
      await DoomRetroCRT.init();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = inspectWad(bytes);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      this.storageKey = 'doom:' + Array.from(new Uint8Array(hash),
        b => b.toString(16).padStart(2, '0')).join('');
      this.engine = await createDoom({
        wasmBinary: globalThis.doomBundle?.engine,
        locateFile: () => new URL('doom.wasm', location.href).href,
        print: text => console.log(text),
        printErr: text => console.error(text),
      });
      this.engine.FS.chdir('/');
      this.engine.FS.writeFile('/' + name, bytes);
      this.restore();
      this.engine._web_init();
      this.context = this.canvas.getContext('2d', {alpha: false});
      Settings.apply();
      this.running = true;
      delete globalThis.doomBundle;
      this.loader.querySelectorAll('[data-game]')
        .forEach(button => button.remove());
      this.loader.hidden = true;
      this.lastFrame = performance.now();
      requestAnimationFrame(time => this.frame(time));
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading = false;
    }
  },

  /** Preserve 35 Hz simulation on every display refresh rate. */
  frame(time) {
    if (!this.running) return;
    try {
      if (!this.suspended) {
        this.elapsed += Math.min(time - this.lastFrame, 250);
        const resized = Settings.flush();
        let changed = resized;
        while (this.elapsed >= 1000 / 35) {
          this.engine._web_mouse(this.buttons,
            Math.round(this.mouseX), Math.round(this.mouseY));
          this.mouseX = this.mouseY = 0;
          if (Settings.value.unlocked) this.engine._web_advance();
          else this.engine._web_tick();
          this.elapsed -= 1000 / 35;
          changed = true;
        }
        if (Settings.value.unlocked || resized) {
          this.engine._web_render(Settings.value.unlocked
            ? Math.round(this.elapsed * 35 / 1000 * 65536) : 65536);
        }
        if (changed || Settings.value.unlocked) {
          this.draw();
          Settings.presented(time);
        }
      }
      this.lastFrame = time;
      requestAnimationFrame(next => this.frame(next));
    } catch (error) { this.fail(error); }
  },

  /** Keep the software context intact when switching the visible canvas. */
  renderer(enabled, crt = 0) {
    this.softwareCanvas ??= this.canvas;
    let failed = false;
    this.crtFailed = false;
    if (this.graphics?.lost || this.graphics?.failed) {
      if (this.hardware) {
        enabled = false;
        this.crtFailed = crt;
        crt = false;
        failed = true;
      } else if (enabled) {
        this.graphics.gl.getExtension('WEBGL_lose_context')?.loseContext();
        this.graphics.canvas.remove();
        this.graphics = null;
      }
    }
    if (enabled && !this.graphics) {
      const canvas = document.createElement('canvas');
      try {
        this.graphics = new DoomRenderer(canvas, this.engine);
        this.engine._web_reset_materials();
        canvas.onclick = () => this.capture();
        this.loader.before(canvas);
      } catch (error) {
        console.warn('Using software rendering:', error);
        canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
          ?.loseContext();
        enabled = false;
        failed = true;
      }
    }
    if (crt && enabled) {
      try {
        this.graphics.crt ??= new DoomCRT(this.graphics.canvas, this.graphics.gl);
        this.graphics.crt.select(Number(crt));
      } catch (error) {
        console.warn('Disabling CRT:', error);
        crt = false;
        this.crtFailed = true;
      }
    } else if (crt) {
      if (this.crtDisplay?.lost || this.crtDisplay?.failed) {
        if (this.crtEnabled && !this.hardware) {
          crt = false;
          this.crtFailed = true;
        } else {
          this.crtDisplay.gl.getExtension('WEBGL_lose_context')?.loseContext();
          this.crtDisplay.canvas.remove();
          this.crtDisplay = null;
        }
      }
      if (crt && !this.crtDisplay) {
        const canvas = document.createElement('canvas');
        try {
          this.crtDisplay = new DoomCRT(canvas);
          canvas.onclick = () => this.capture();
          this.loader.before(canvas);
        } catch (error) {
          console.warn('Disabling CRT:', error);
          canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')
            ?.loseContext();
          crt = false;
          this.crtFailed = true;
        }
      }
    }
    if (crt && !enabled) {
      try { this.crtDisplay.select(Number(crt)); }
      catch (error) {
        console.warn('Disabling CRT:', error);
        crt = 0;
        this.crtFailed = true;
      }
    }
    if (this.graphics?.crt && !(crt && enabled)) this.graphics.crt.select(0);
    if (this.crtDisplay && !(crt && !enabled)) this.crtDisplay.select(0);
    if (this.graphics) this.graphics.crtEnabled = crt && enabled;
    this.crtEnabled = crt;
    const canvas = enabled ? this.graphics.canvas
      : crt ? this.crtDisplay.canvas : this.softwareCanvas;
    if (this.canvas !== canvas) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.release();
      this.canvas.hidden = true;
      this.canvas.removeAttribute('id');
      this.canvas = canvas;
      canvas.id = 'screen';
      canvas.hidden = false;
      this.image = null;
    }
    this.hardware = enabled;
    return failed;
  },

  /** Reuse a view over WASM memory; rebuild it only after memory growth. */
  draw() {
    const buffer = this.engine.HEAPU8.buffer;
    if (this.image?.data.buffer !== buffer) {
      this.image = new ImageData(new Uint8ClampedArray(buffer,
        this.engine._web_pixels(), this.width * this.height * 4),
        this.width, this.height);
    }
    // CSS displays the original non-square pixels at the CRT's 4:3 aspect.
    if (this.hardware) {
      try {
        this.graphics.present(this.image.data, this.engine._web_world());
      } catch (error) {
        console.warn('Using software rendering:', error);
        this.graphics.failed = true;
        Settings.dirty = true;
      }
    } else if (this.crtEnabled) {
      try {
        this.crtDisplay.software(this.image.data, this.width, this.height);
      } catch (error) {
        console.warn('Disabling CRT:', error);
        this.crtDisplay.failed = true;
        Settings.dirty = true;
      }
    } else this.context.putImageData(this.image, 0, 0);
  },

  /** Fullscreen and pointer lock require a click after loading. */
  capture() {
    if (!this.running) return;
    this.audio.resume().catch(console.warn);
    // Fullscreen consumes user activation; pointer lock must be requested first.
    this.canvas.requestPointerLock?.()?.catch(console.warn);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(console.warn);
    }
  },

  /** Release input when focus changes, so movement cannot stick. */
  release() {
    if (!this.engine) return;
    for (const key of new Set(this.held.values())) this.engine._web_key(key, 0);
    this.held.clear();
    this.buttons = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.engine._web_mouse(0, 0, 0);
  },

  /** Stop at the game's own Quit command. Reload to select another IWAD. */
  quit() {
    this.persist();
    this.running = false;
    this.audio.suspend();
    document.exitPointerLock?.();
    if (document.fullscreenElement) document.exitFullscreen();
    this.loader.hidden = false;
    this.message.textContent = 'Game closed. Reload to play again.';
    this.loader.querySelectorAll('button')
      .forEach(button => button.hidden = true);
  },

  /** Display a recoverable load error without adding game chrome. */
  fail(error) {
    console.error(error);
    this.running = false;
    this.audio.suspend();
    this.loader.hidden = false;
    this.message.textContent = error.message || String(error);
  },
};

/** Map physical keys to Doom's original keyboard codes. */
function doomKey(event) {
  const special = {
    ArrowLeft: 0xac, ArrowUp: 0xad, ArrowRight: 0xae, ArrowDown: 0xaf,
    Escape: 27, Enter: 13, Tab: 9, Backspace: 127, Pause: 0xff,
    ControlLeft: 0x9d, ControlRight: 0x9d,
    ShiftLeft: 0xb6, ShiftRight: 0xb6, AltLeft: 0xb8, AltRight: 0xb8,
    Space: 32, Minus: 45, Equal: 61, Comma: 44, Period: 46,
    BracketLeft: 91, BracketRight: 93, Backslash: 92, IntlBackslash: 92,
    Semicolon: 59, Quote: 39, Slash: 47, Backquote: 96, NumpadEnter: 13,
    F1: 0xbb, F2: 0xbc, F3: 0xbd, F4: 0xbe, F5: 0xbf,
    F6: 0xc0, F7: 0xc1, F8: 0xc2, F9: 0xc3, F10: 0xc4,
    F11: 0xd7, F12: 0xd8,
  };
  if (event.code in special) return special[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3) + 32;
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  return 0;
}

/** Modifier flags describe both sides, even when a remapper omits keyup. */
const doomModifiers = {Control: 0x9d, Shift: 0xb6, Alt: 0xb8};

/** Reconcile modifier state on every keyboard event, including Command. */
function syncModifiers(event) {
  for (const name in doomModifiers) {
    const down = event.getModifierState(name);
    if (down === Doom.held.has(name)) continue;
    const key = doomModifiers[name];
    if (down) Doom.held.set(name, key);
    else Doom.held.delete(name);
    Doom.engine._web_key(key, Number(down));
  }
}

/** Offer a picker or collection; start a sole embedded IWAD automatically. */
function setupLoader() {
  const choose = document.querySelector('#choose');
  choose.onclick = () => {
    Doom.audio.resume().catch(console.warn);
    document.querySelector('#file').click();
  };
  const games = globalThis.doomBundle?.wads || [];
  if (!games.length) return;
  choose.hidden = true;
  Doom.message.textContent = games.length === 1 ? 'Loading…' : 'Choose a game';
  if (games.length === 1) {
    queueMicrotask(() => Doom.load(games[0].file));
    return;
  }
  for (const [index, game] of games.entries()) {
    const button = document.createElement('button');
    button.dataset.game = index;
    button.textContent = game.title;
    button.onclick = () => Doom.load(game.file);
    Doom.message.before(button);
  }
}
setupLoader();
document.querySelector('#file').onchange = event => Doom.load(event.target.files[0]);
document.ondragover = event => event.preventDefault();
document.ondrop = event => {
  event.preventDefault();
  Doom.load(event.dataTransfer.files[0]);
};
Doom.canvas.onclick = () => Doom.capture();
document.oncontextmenu = event => event.preventDefault();
document.onkeydown = event => {
  if (!Doom.running) return;
  if (Doom.audio.context?.state === 'suspended') {
    Doom.audio.resume().catch(console.warn);
  }
  syncModifiers(event);
  // Keep Command shortcuts, but allow movement with a Ctrl–Alt–Command chord.
  if (event.metaKey && !(event.ctrlKey && event.altKey)) return;
  const key = doomKey(event);
  if (!key) return;
  event.preventDefault();
  if (/^(Control|Shift|Alt)(Left|Right)$/.test(event.code)) return;
  if (event.repeat || Doom.held.has(event.code)) return;
  Doom.held.set(event.code, key);
  Doom.engine._web_key(key, 1);
};
document.onkeyup = event => {
  if (!Doom.running) return;
  syncModifiers(event);
  const key = Doom.held.get(event.code);
  if (!key) return;
  event.preventDefault();
  Doom.held.delete(event.code);
  if (![...Doom.held.values()].includes(key)) Doom.engine._web_key(key, 0);
};
document.onmousemove = event => {
  if (document.pointerLockElement === Doom.canvas) {
    Doom.mouseX += event.movementX;
    Doom.mouseY += event.movementY;
  }
};
document.onmousedown = document.onmouseup = event => {
  if (document.pointerLockElement !== Doom.canvas) return;
  const mask = [1, 2, 4][event.button] || 0;
  if (event.type === 'mousedown') Doom.buttons |= mask;
  else Doom.buttons &= ~mask;
};
document.onpointerlockchange = () => {
  if (!document.pointerLockElement) Doom.release();
};
window.onblur = () => {
  Doom.release();
  Doom.suspended = true;
  Doom.elapsed = 0;
  Settings.frames = 0;
  Settings.sampleTime = 0;
  Doom.audio.suspend();
  Doom.persist();
};
window.onfocus = () => {
  Doom.suspended = false;
  Doom.lastFrame = performance.now();
  if (Doom.running && !Doom.suspended) Doom.audio.resume().catch(console.warn);
};
document.onvisibilitychange = () => {
  if (document.hidden) window.onblur();
  else window.onfocus();
};
window.addEventListener('pagehide', () => Doom.persist());
setInterval(() => { if (Doom.running) Doom.persist(); }, 5000);
