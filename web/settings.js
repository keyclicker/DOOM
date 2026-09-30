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
    const fit = Math.min(1, 8192 / width, 8192 / height,
      Math.sqrt(33554432 / (width * height)));
    width = Math.max(16, Math.floor(width * fit));
    height = Math.max(16, Math.floor(height * fit));
    if (Doom.canvas.width === width && Doom.canvas.height === height
      && this.native === native && Doom.image) return false;
    Doom.engine._web_video(width, height, native);
    this.native = native;
    Doom.canvas.width = width;
    Doom.canvas.height = height;
    Doom.image = null;
    return true;
  },

  /** Seed the native settings once the WAD and saved Doom defaults are loaded. */
  apply() {
    Doom.release();
    Doom.engine._web_settings(this.value.scale,
      this.value.aspect === 'browser', this.value.unlocked, this.value.fps);
    this.value.keys.forEach((key, index) => Doom.engine._web_bind(index, key));
    this.video();
    this.frames = this.sampleTime = Doom.elapsed = 0;
    this.dirty = this.videoDirty = false;
  },

  /** Never resize or reenter WASM from inside its native menu responder. */
  flush() {
    if (this.value.scale === 0 && this.pixelRatio !== devicePixelRatio)
      this.videoDirty = true;
    if (!this.dirty && !this.videoDirty) return false;
    if (this.dirty) {
      const e = Doom.engine;
      this.value = {scale: e._web_setting(0),
        aspect: e._web_setting(1) ? 'browser' : 'classic',
        unlocked: !!e._web_setting(2), fps: !!e._web_setting(3),
        keys: this.defaults.map((_, i) => e._web_binding(i))};
      Doom.release();
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
