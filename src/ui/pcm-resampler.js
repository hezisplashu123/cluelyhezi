(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.Pcm16Resampler = value.Pcm16Resampler;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class Pcm16Resampler {
    constructor(sourceRate, targetRate = 16000) {
      if (!Number.isFinite(sourceRate) || sourceRate < 8000 || sourceRate > 192000) throw new Error('Invalid source sample rate.');
      this.sourceRate = sourceRate;
      this.targetRate = targetRate;
      this.step = sourceRate / targetRate;
      this.position = 0;
      this.carry = new Float32Array(0);
    }

    process(input) {
      if (!input || !input.length) return new Int16Array(0);
      const samples = input instanceof Float32Array ? input : Float32Array.from(input);
      const data = new Float32Array(this.carry.length + samples.length);
      data.set(this.carry, 0);
      data.set(samples, this.carry.length);
      const output = [];
      while (this.position + 1 < data.length) {
        const index = Math.floor(this.position);
        const fraction = this.position - index;
        const value = data[index] + (data[index + 1] - data[index]) * fraction;
        const clipped = Math.max(-1, Math.min(1, value));
        output.push(clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff));
        this.position += this.step;
      }
      const consumed = Math.min(Math.floor(this.position), Math.max(0, data.length - 1));
      this.carry = data.slice(consumed);
      this.position -= consumed;
      return Int16Array.from(output);
    }

    reset() {
      this.position = 0;
      this.carry = new Float32Array(0);
    }
  }
  return { Pcm16Resampler };
});
