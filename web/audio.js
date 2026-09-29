/* SPDX-License-Identifier: GPL-2.0-only */

/** Play Doom's unsigned 8-bit PCM samples through the browser mixer. */
class DoomAudio {
  constructor() {
    this.context = null;
    this.samples = new Map();
    this.channels = new Map();
    this.nextHandle = 1;
  }

  /** Audio starts only in response to a user gesture. */
  async resume() {
    this.context ??= new AudioContext({latencyHint: 'interactive'});
    await this.context.resume();
  }

  /** Decode each lump once; retain its original sample rate and pitch. */
  sound(id, data, volume, separation, pitch) {
    if (!this.context || data.length < 8 || data[0] !== 3) return 0;
    let sample = this.samples.get(id);
    if (!sample) {
      const view = new DataView(data.buffer, data.byteOffset, data.length);
      const rate = view.getUint16(2, true);
      const length = Math.min(view.getUint32(4, true), data.length - 8);
      if (!rate || length <= 0) return 0;
      sample = this.context.createBuffer(1, length, rate);
      const pcm = sample.getChannelData(0);
      for (let i = 0; i < length; i++) pcm[i] = (data[i + 8] - 128) / 128;
      this.samples.set(id, sample);
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    source.buffer = sample;
    source.connect(gain).connect(pan).connect(this.context.destination);
    const handle = this.nextHandle++;
    this.channels.set(handle, {source, gain, pan});
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
      this.channels.delete(handle);
    };
    this.channel(2, handle, volume, separation, pitch);
    source.start();
    return handle;
  }

  /** Match the platform's stop/query/update sound channel interface. */
  channel(command, handle, volume, separation, pitch) {
    const channel = this.channels.get(handle);
    if (!channel) return 0;
    if (command === 0) {
      channel.source.stop();
      this.channels.delete(handle);
    } else if (command === 2) {
      channel.gain.gain.value = volume / 127;
      channel.pan.pan.value = Math.max(-1, Math.min(1, (separation - 128) / 128));
      channel.source.playbackRate.value = 2 ** ((pitch - 128) / 64);
    }
    return 1;
  }

  /** Silence the game when focus is lost or the player quits. */
  suspend() { this.context?.suspend(); }
}
