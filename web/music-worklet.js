/* SPDX-License-Identifier: GPL-2.0-only */

/** Run MUS timing and OPL synthesis entirely on the browser's audio thread. */
class DoomMusicProcessor extends AudioWorkletProcessor {
  constructor({processorOptions}) {
    super();
    this.synth = new WebAssembly.Instance(processorOptions.module).exports;
    this.synth._initialize();
    this.bytes = new Uint8Array(this.synth.memory.buffer);
    const pointer = this.synth.music_render(0);
    this.left = new Float32Array(this.synth.memory.buffer, pointer, 128);
    this.right = new Float32Array(this.synth.memory.buffer, pointer + 512, 128);
    this.reportedError = false;
    this.port.onmessage = ({data}) => {
      try { this.command(data); }
      catch (error) { this.port.postMessage({error: error.message}); }
    };
  }

  /** Copy each song once; use fixed buffers in the render callback. */
  command({command, data, looping}) {
    if (command === 'bank') {
      if (data.length !== 6308) throw Error('Invalid GENMIDI bank');
      this.bytes.set(data, this.synth.music_bank());
    } else if (command === 'play') {
      if (data.length > 131072) throw Error('MUS score is too large');
      this.bytes.set(data, this.synth.music_score());
      this.reportedError = false;
      if (!this.synth.music_start(data.length, looping, sampleRate)) {
        this.port.postMessage({error: 'Invalid MUS music lump'});
      }
    } else if (command === 'pause') this.synth.music_pause(data);
    else if (command === 'stop') this.synth.music_stop();
  }

  /** Fill the output without allocation; also handle larger future quanta. */
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    for (let offset = 0; offset < left.length; offset += 128) {
      const count = Math.min(128, left.length - offset);
      this.synth.music_render(count);
      for (let i = 0; i < count; i++) {
        left[offset + i] = this.left[i];
        right[offset + i] = this.right[i];
      }
    }
    if (this.synth.music_status() < 0 && !this.reportedError) {
      this.reportedError = true;
      this.port.postMessage({error: 'Malformed MUS event stream'});
    }
    return true;
  }
}

registerProcessor('doom-music', DoomMusicProcessor);
