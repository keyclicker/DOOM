/* SPDX-License-Identifier: GPL-2.0-only */

/** Persist native menu choices and apply browser video changes between frames. */
const Settings = {
  defaults: [173, 175, 172, 174, 44, 46, 157, 32, 184, 182],
  dirty: false,
  videoDirty: false,
  frames: 0,
  sampleTime: 0,

  /** Accept native action keys while reserving Doom's global shortcuts. */
  allowedKey(key) {
    return Number.isInteger(key) && !(key >= 49 && key <= 55)
      && key !== 45 && key !== 61
      && ((key >= 32 && key <= 126)
        || [13, 127, 172, 173, 174, 175, 157, 182, 184].includes(key));
  },

  /** Validate storage, including physical key names saved by the earlier UI. */
  validate(input) {
    const result = {scale: [0, 1, 2, 3, 4, 5, 6].includes(input?.scale)
      ? input.scale : 1,
      aspect: input?.aspect === 'browser' ? 'browser' : 'classic',
      unlocked: input?.unlocked === true, fps: input?.fps === true,
      renderer: input?.renderer === true,
      crt: input?.crt === true ? 1
        : [0, 1, 2, 3, 4, 5].includes(input?.crt) ? input.crt : 0,
      freelook: input?.renderer === true && input?.freelook === true,
      keys: [...this.defaults]};
    const keys = Array.isArray(input?.keys) ? input.keys.map(key =>
      typeof key === 'string' ? doomKey({code: key}) : key) : null;
    if (Array.isArray(keys) && keys.length === 10
      && keys.every(key => this.allowedKey(key)) && new Set(keys).size === 10) {
      result.keys = keys;
    }
    return result;
  },

  /** Storage is optional; the game still starts when it is unavailable. */
  init() {
    this.value = this.validate(null);
    try {
      this.value = this.validate(JSON.parse(localStorage.getItem('doom:settings')));
    } catch (error) { console.warn('Could not restore settings:', error); }
    window.addEventListener('resize', () => { this.videoDirty = true; });
  },

  /** Choose real render dimensions, keeping Doom's 1:1.2 pixel correction. */
  video() {
    this.pixelRatio = devicePixelRatio;
    const native = this.value.scale === 0;
    const browser = this.value.aspect === 'browser';
    Doom.canvas.classList.toggle('browser-aspect', browser);
    let height = native ? Math.round((browser ? innerHeight
      : Math.min(innerHeight, innerWidth * 3 / 4)) * devicePixelRatio)
      : 200 * this.value.scale;
    let width = native ? Math.round((browser ? innerWidth
      : Math.min(innerWidth, innerHeight * 4 / 3)) * devicePixelRatio)
      : browser ? Math.round(height * innerWidth / innerHeight * 1.2 / 2) * 2
        : 320 * this.value.scale;
    // Bound storage while preserving aspect on displays beyond the engine limit.
    const display = Doom.hardware ? Doom.graphics
      : Doom.crtEnabled ? Doom.crtDisplay : null;
    const limit = display ? Math.min(8192, display.maxSize) : 8192;
    const fit = Math.min(1, limit / width, limit / height,
      Math.sqrt(33554432 / (width * height)));
    width = Math.max(16, Math.floor(width * fit));
    height = Math.max(16, Math.floor(height * fit));
    const changed = Doom.width !== width || Doom.height !== height
      || this.native !== native || !Doom.image;
    if (changed) {
      Doom.engine._web_video(width, height, native);
      this.native = native;
      Doom.width = width;
      Doom.height = height;
      Doom.image = null;
    }
    if (Doom.hardware) Doom.graphics.renderSize = [width, height];
    let displayWidth = width, displayHeight = height;
    if (Doom.crtEnabled) {
      const bounds = Doom.canvas.getBoundingClientRect();
      displayWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
      displayHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
      const displayFit = Math.min(1, limit / displayWidth, limit / displayHeight,
        Math.sqrt(33554432 / (displayWidth * displayHeight)));
      displayWidth = Math.max(1, Math.floor(displayWidth * displayFit));
      displayHeight = Math.max(1, Math.floor(displayHeight * displayFit));
    }
    const resized = Doom.canvas.width !== displayWidth
      || Doom.canvas.height !== displayHeight;
    if (resized) {
      Doom.canvas.width = displayWidth;
      Doom.canvas.height = displayHeight;
    }
    return changed || resized;
  },

  /** Validate backend availability before enabling native geometry rendering. */
  renderer() {
    const failed = Doom.renderer(this.value.renderer, this.value.crt);
    this.value.crt = Number(Doom.crtEnabled);
    Doom.engine._web_crt(this.value.crt, Doom.crtFailed);
    this.value.renderer = !!Doom.hardware;
    this.value.freelook = this.value.renderer && this.value.freelook;
    if (this.activeRenderer !== this.value.renderer
      || this.activeLook !== this.value.freelook || failed) {
      Doom.engine._web_renderer(this.value.renderer, this.value.freelook, failed);
      this.activeRenderer = this.value.renderer;
      this.activeLook = this.value.freelook;
    }
  },

  /** Seed the native settings once the WAD and saved Doom defaults are loaded. */
  apply() {
    Doom.release();
    Doom.engine._web_settings(this.value.scale,
      this.value.aspect === 'browser', this.value.unlocked, this.value.fps);
    this.value.keys.forEach((key, index) => Doom.engine._web_bind(index, key));
    this.renderer();
    this.video();
    this.frames = this.sampleTime = Doom.elapsed = 0;
    this.dirty = this.videoDirty = false;
  },

  /** Never resize or reenter WASM from inside its native menu responder. */
  flush() {
    if ((this.value.scale === 0 || this.value.crt)
      && this.pixelRatio !== devicePixelRatio)
      this.videoDirty = true;
    if (!this.dirty && !this.videoDirty) return false;
    if (this.dirty) {
      const e = Doom.engine;
      this.value = {scale: e._web_setting(0),
        aspect: e._web_setting(1) ? 'browser' : 'classic',
        unlocked: !!e._web_setting(2), fps: !!e._web_setting(3),
        renderer: !!e._web_setting(4), freelook: !!e._web_setting(5),
        crt: e._web_setting(6),
        keys: this.defaults.map((_, i) => e._web_binding(i))};
      Doom.release();
      this.renderer();
      try { localStorage.setItem('doom:settings', JSON.stringify(this.value)); }
      catch (error) { console.warn('Could not save settings:', error); }
      this.frames = this.sampleTime = 0;
    }
    this.dirty = this.videoDirty = false;
    return this.video();
  },

  /** Count presented frames, then let Doom draw the number in its own font. */
  presented(time) {
    if (!this.value.fps) return;
    if (!this.sampleTime) { this.sampleTime = time; return; }
    this.frames++;
    if (time - this.sampleTime < 500) return;
    Doom.engine._web_fps(Math.round(this.frames * 1000
      / (time - this.sampleTime)));
    this.frames = 0;
    this.sampleTime = time;
  },
};
Settings.init();
