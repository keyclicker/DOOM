/* SPDX-License-Identifier: GPL-2.0-only */

/** Editable engine actions, in the same order as web_bind's native table. */
const keyActions = [
  ['Forward', 'ArrowUp'], ['Backward', 'ArrowDown'],
  ['Turn left', 'ArrowLeft'], ['Turn right', 'ArrowRight'],
  ['Strafe left', 'Comma'], ['Strafe right', 'Period'],
  ['Fire', 'ControlLeft'], ['Use / open', 'Space'],
  ['Strafe modifier', 'AltLeft'], ['Run', 'ShiftLeft'],
];

/** Browser preferences are independent of each IWAD's native save files. */
const Settings = {
  value: {scale: 1, aspect: 'classic', unlocked: false, fps: false,
    keys: keyActions.map(([, code]) => code)},
  dialog: document.querySelector('#settings'),
  counter: document.querySelector('#fps'),
  captureIndex: -1,
  frames: 0,
  sampleTime: 0,

  /** Accept known values only, including when storage was manually edited. */
  validate(input) {
    const result = {scale: [1, 2, 3, 4].includes(input?.scale) ? input.scale : 1,
      aspect: input?.aspect === 'browser' ? 'browser' : 'classic',
      unlocked: input?.unlocked === true, fps: input?.fps === true,
      keys: keyActions.map(([, code]) => code)};
    if (Array.isArray(input?.keys) && input.keys.length === keyActions.length
      && input.keys.every(code => this.allowedKey(code))
      && new Set(input.keys.map(code => doomKey({code}))).size === 10) {
      result.keys = input.keys;
    }
    return result;
  },

  /** Reserve browser settings, Doom menus, map, pause, and weapon shortcuts. */
  allowedKey(code) {
    return typeof code === 'string' && doomKey({code}) !== 0
      && !/^(Escape|Tab|Pause|F\d+|Digit[1-7])$/.test(code);
  },

  /** Read preferences without preventing play when browser storage is denied. */
  init() {
    try {
      this.value = this.validate(JSON.parse(localStorage.getItem('doom:settings')));
    } catch (error) { console.warn('Could not restore browser settings:', error); }
    document.querySelector('#open-settings').onclick = () => this.open();
    document.querySelector('#close-settings').onclick = () => this.close();
    this.dialog.oncancel = event => { event.preventDefault(); this.close(); };
    document.querySelector('#apply-settings').onclick = () => {
      this.value = this.validate(this.draft);
      try { localStorage.setItem('doom:settings', JSON.stringify(this.value)); }
      catch (error) { console.warn('Could not save browser settings:', error); }
      this.apply();
      this.close();
    };
    document.querySelector('#reset-settings').onclick = () => {
      this.draft = this.validate(null);
      this.populate();
    };
    for (const button of this.dialog.querySelectorAll('[role=tab]')) {
      button.onclick = () => this.tab(button);
      button.onkeydown = event => {
        const tabs = [...this.dialog.querySelectorAll('[role=tab]')];
        const direction = event.code === 'ArrowRight' ? 1
          : event.code === 'ArrowLeft' ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        const next = tabs[(tabs.indexOf(button) + direction + tabs.length)
          % tabs.length];
        this.tab(next);
        next.focus();
      };
    }
    document.querySelector('#resolution').onchange = event => {
      this.draft.scale = Number(event.target.value);
    };
    document.querySelector('#aspect').onchange = event => {
      this.draft.aspect = event.target.value;
    };
    for (const name of ['unlocked', 'fps']) {
      document.querySelector('#setting-' + name).onchange = event => {
        this.draft[name] = event.target.checked;
      };
    }
    document.querySelector('#key-preset').onchange = event => {
      if (event.target.value === 'custom') return;
      this.draft.keys = keyActions.map(([, code]) => code);
      if (event.target.value === 'wasd') {
        Object.assign(this.draft.keys,
          {0: 'KeyW', 1: 'KeyS', 4: 'KeyA', 5: 'KeyD', 7: 'KeyE'});
      }
      this.renderKeys();
    };
    this.counter.hidden = !this.value.fps;
    window.addEventListener('resize', () => {
      if (this.value.aspect === 'browser' && Doom.running) this.video();
    });
  },

  /** Pause at the browser boundary, releasing keys before opening the modal. */
  open() {
    if (this.dialog.open) return;
    Doom.release();
    Doom.suspended = true;
    Doom.elapsed = 0;
    Doom.audio.suspend();
    document.exitPointerLock?.();
    this.draft = structuredClone(this.value);
    this.populate();
    this.dialog.showModal();
  },

  /** Resume only when the page is visible; pointer capture requires a click. */
  close() {
    this.captureIndex = -1;
    this.dialog.close();
    Doom.suspended = document.hidden || !document.hasFocus();
    Doom.lastFrame = performance.now();
    Doom.elapsed = 0;
    this.frames = 0;
    this.sampleTime = 0;
    if (Doom.running && !Doom.suspended) Doom.audio.resume().catch(console.warn);
  },

  /** Switch accessible tab panels without rebuilding the entire overlay. */
  tab(selected) {
    this.captureIndex = -1;
    for (const tab of this.dialog.querySelectorAll('[role=tab]')) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    this.renderKeys();
  },

  /** Copy the draft to controls; Cancel leaves the active game untouched. */
  populate() {
    this.captureIndex = -1;
    document.querySelector('#resolution').value = this.draft.scale;
    document.querySelector('#aspect').value = this.draft.aspect;
    for (const name of ['unlocked', 'fps']) {
      document.querySelector('#setting-' + name).checked = this.draft[name];
    }
    this.renderKeys();
  },

  /** Display physical key names; left/right modifiers share a Doom binding. */
  keyName(code) {
    return code.replace(/^Key|^Digit/, '').replace(/^Arrow/, '')
      .replace(/(Control|Shift|Alt)(Left|Right)/, '$1')
      .replace('Comma', ',').replace('Period', '.');
  },

  /** Build action buttons and show conflicts instead of silently stealing keys. */
  renderKeys() {
    const container = document.querySelector('#bindings');
    container.replaceChildren();
    keyActions.forEach(([name], index) => {
      const label = document.createElement('span');
      label.textContent = name;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = this.captureIndex === index ? 'Press a key…'
        : this.keyName(this.draft.keys[index]);
      button.setAttribute('aria-label', name + ': ' + button.textContent);
      button.onclick = () => {
        this.captureIndex = index;
        this.renderKeys();
        document.querySelector('#binding-message').textContent =
          'Press a key. Escape cancels.';
        container.querySelectorAll('button')[index].focus();
      };
      container.append(label, button);
    });
    const wasd = {0: 'KeyW', 1: 'KeyS', 4: 'KeyA', 5: 'KeyD', 7: 'KeyE'};
    document.querySelector('#key-preset').value = this.draft.keys.every(
      (code, i) => code === keyActions[i][1]) ? 'classic'
      : this.draft.keys.every((code, i) => code === (wasd[i] || keyActions[i][1]))
        ? 'wasd' : 'custom';
    document.querySelector('#binding-message').textContent = '';
  },

  /** Consume modal keys before they can reach the game or browser shortcuts. */
  key(event) {
    if (!this.dialog.open) return false;
    if (this.captureIndex < 0) return true;
    event.preventDefault();
    if (event.code === 'Escape') {
      this.captureIndex = -1;
      this.renderKeys();
      return true;
    }
    const index = this.captureIndex;
    const duplicate = this.draft.keys.findIndex((code, i) => i !== index
      && doomKey({code}) === doomKey(event));
    if (!this.allowedKey(event.code) || event.metaKey || duplicate >= 0) {
      document.querySelector('#binding-message').textContent = duplicate >= 0
        ? 'Already bound to ' + keyActions[duplicate][0] + '.'
        : 'That key is reserved or unavailable. Choose another.';
      return true;
    }
    this.draft.keys[index] = event.code;
    this.captureIndex = -1;
    this.renderKeys();
    document.querySelector('#bindings').querySelectorAll('button')[index].focus();
    return true;
  },

  /** Choose real render dimensions, keeping Doom's 1:1.2 pixel correction. */
  video() {
    const height = 200 * this.value.scale;
    const width = this.value.aspect === 'browser'
      ? Math.max(16, Math.min(4096,
        Math.round(height * innerWidth / innerHeight * 1.2 / 2) * 2))
      : 320 * this.value.scale;
    Doom.canvas.classList.toggle('browser-aspect', this.value.aspect === 'browser');
    if (!Doom.engine) return;
    if (Doom.canvas.width === width && Doom.canvas.height === height
      && Doom.image) return;
    Doom.engine._web_video(width, this.value.scale);
    Doom.canvas.width = width;
    Doom.canvas.height = height;
    Doom.image = null;
  },

  /** Apply video and native action codes after initialization or user changes. */
  apply() {
    Doom.release();
    this.video();
    if (Doom.engine) {
      this.value.keys.forEach((code, index) => {
        Doom.engine._web_bind(index, doomKey({code}));
      });
    }
    this.counter.hidden = !this.value.fps;
    this.counter.textContent = '— FPS';
    this.frames = 0;
    this.sampleTime = 0;
    Doom.elapsed = 0;
  },

  /** Count presented frames rather than simulation tics or idle rAF callbacks. */
  presented(time) {
    if (!this.value.fps) return;
    if (!this.sampleTime) this.sampleTime = time;
    this.frames++;
    if (time - this.sampleTime < 500) return;
    this.counter.textContent = Math.round(this.frames * 1000
      / (time - this.sampleTime)) + ' FPS';
    this.frames = 0;
    this.sampleTime = time;
  },
};
Settings.init();
