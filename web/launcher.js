/* SPDX-License-Identifier: GPL-2.0-only */

/** Plain text for the About screen. */
const LAUNCHER_ABOUT = `Doom in one offline HTML file.
The WAD is read locally and never uploaded.
Saves are kept per IWAD in this browser.

Engine GPL-2.0. Music: Nuked OPL3.`;

/**
 * The screen around the game: WAD picker, game list, load status, errors.
 * Keyboard first: arrows, Enter, and the hotkey shown on each row.
 */
const Launcher = {
  screen: 'picker',          // picker | select | loading | error | closed
  about: false,
  dragging: 0,
  cursor: 0,
  status: {message: '', hint: ''},
  fraction: 0,
  box: document.querySelector('#load'),
  menu: document.querySelector('#menu'),
  message: document.querySelector('#message'),
  hint: document.querySelector('#hint'),
  progress: document.querySelector('#progress'),

  /** Start a sole embedded IWAD, list a collection, or offer the picker. */
  init() {
    const games = this.games();
    if (games.length === 1) {
      queueMicrotask(() => Doom.load(games[0].file, games[0].title));
    }
    this.show(games.length ? 'select' : 'picker');

    this.menu.onmouseover = event => {
      const row = event.target.closest('[data-i]');
      if (row) this.highlight(Number(row.dataset.i));
    };
    this.menu.onclick = event => {
      const row = event.target.closest('[data-i]');
      if (row) this.items()[row.dataset.i]?.action();
    };

    // Count enter/leave pairs so crossing child elements cannot flicker.
    document.ondragenter = event => {
      event.preventDefault();
      if (!Doom.running && this.dragging++ === 0) this.render();
    };
    document.ondragleave = () => {
      if (this.dragging && --this.dragging === 0) this.render();
    };
    document.ondragover = event => event.preventDefault();
    document.ondrop = event => {
      event.preventDefault();
      this.dragging = 0;
      this.render();
      Doom.load(event.dataTransfer.files[0]);
    };
    document.querySelector('#file').onchange =
      event => Doom.load(event.target.files[0]);
  },

  /** Embedded IWADs, until the game starts and releases them. */
  games() {
    return globalThis.doomBundle?.wads || [];
  },

  /** Rows for the current screen: `{label, note, key, action}`. */
  items() {
    if (this.about) {
      return [{label: 'Back', key: 'esc', action: () => this.showAbout(false)}];
    }
    const about = {label: 'About', key: 'a', action: () => this.showAbout(true)};
    const games = this.games();
    const home = games.length
      ? games.map((game, i) => ({label: game.title, game: i,
        key: i < 9 ? String(i + 1) : '',
        action: () => Doom.load(game.file, game.title)}))
      : [{label: 'Load WAD…', key: 'l', id: 'choose',
        action: () => this.pick()}];
    switch (this.screen) {
      case 'picker':
      case 'select':
      case 'error':
        return [...home, about];
      case 'closed':
        return [{label: 'Play again', key: 'r',
          action: () => location.reload()}];
      default:
        return [];
    }
  },

  /** The file dialog; audio may resume on this same user gesture. */
  pick() {
    Doom.audio.resume().catch(console.warn);
    document.querySelector('#file').click();
  },

  /** Switch screens; the text depends on the screen, set by the caller. */
  show(screen, message = '', hint = '') {
    this.screen = screen;
    this.about = false;
    this.cursor = 0;
    this.status = {message, hint};
    this.fraction = 0;
    this.box.hidden = false;
    this.render();
  },

  /** Doom.load() starts: name the game, then report each stage. */
  loading(name) {
    this.show('loading', 'loading ' + name);
  },

  /** A load stage and its share of the work, 0 to 1. */
  stage(label, fraction) {
    this.status.hint = label;
    this.fraction = fraction;
    this.render();
  },

  error(message) {
    this.show('error', message);
  },

  closed() {
    this.show('closed', 'game closed. saves are kept.');
  },

  /** The game is running; drop the rows so no stale buttons remain. */
  hide() {
    this.box.hidden = true;
    this.menu.replaceChildren();
  },

  showAbout(open) {
    this.about = open;
    this.cursor = 0;
    this.render();
  },

  render() {
    const dragging = this.dragging > 0 && !Doom.running;
    const hints = {picker: 'or drop a .wad anywhere.',
      select: 'saves are kept per game.'};

    this.box.classList.toggle('drag', dragging);
    this.message.className = this.screen === 'error' ? 'error'
      : this.about ? '' : 'bright';
    this.message.textContent = dragging ? 'release to load'
      : this.about ? LAUNCHER_ABOUT : this.status.message;
    this.hint.textContent = dragging || this.about ? ''
      : this.status.hint || hints[this.screen] || '';
    this.progress.style.width = this.screen === 'loading'
      ? this.fraction * 100 + '%' : 0;

    const rows = dragging ? [] : this.items().map((item, i) => {
      const row = document.createElement('button');
      const label = document.createElement('span');
      const key = document.createElement('span');
      row.tabIndex = -1;
      row.dataset.i = i;
      if (item.id) row.id = item.id;
      if (item.game !== undefined) row.dataset.game = item.game;
      label.textContent = item.label;
      key.textContent = item.key.toUpperCase();
      row.append(label, key);
      return row;
    });
    this.menu.replaceChildren(...rows);
    this.highlight(this.cursor);
  },

  /** Move the cursor without rebuilding rows under the mouse. */
  highlight(index) {
    this.cursor = index;
    [...this.menu.children].forEach((row, i) =>
      row.classList.toggle('on', i === index));
  },

  /** Arrows, Enter, Esc, and row hotkeys; true when the key was used. */
  key(event) {
    const items = this.items();
    if (this.box.hidden || !items.length) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;

    if (event.key === 'Escape' || event.key === 'Backspace') {
      if (!this.about) return false;
      this.showAbout(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.highlight((this.cursor + step + items.length) % items.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      items[this.cursor].action();
    } else {
      const item = items.find(row => row.key === event.key.toLowerCase());
      if (!item) return false;
      item.action();
    }
    return true;
  },
};
