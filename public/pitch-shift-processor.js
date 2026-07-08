
class PitchShiftProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffers = [new Float32Array(this.bufferSize), new Float32Array(this.bufferSize)];
    this.writePointers = [0, 0];
    this.readPointers1 = [this.bufferSize / 2, this.bufferSize / 2];
    this.readPointers2 = [0, 0];
  }

  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0 }];
  }

  getWindow(dist) {
      // Triangle window centered in the buffer history
      let phase = dist / this.bufferSize;
      return Math.max(0, 1.0 - Math.abs((phase * 2.0) - 1.0));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    // parameters.pitch could be an array of 128 elements (a-rate) or 1 element (k-rate)
    const pitch = parameters.pitch && parameters.pitch.length > 0 ? parameters.pitch[0] : 1.0;

    if (!input || input.length === 0) return true;
    if (!output || output.length === 0) return true;

    for (let channel = 0; channel < input.length; channel++) {
      if (channel >= 2) break; // Only process up to stereo for simplicity
      
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      
      if (!outputChannel) continue;

      for (let i = 0; i < inputChannel.length; i++) {
          this.buffers[channel][this.writePointers[channel]] = inputChannel[i];
          
          let p1 = this.readPointers1[channel];
          let p2 = this.readPointers2[channel];
          
          let p1_i = Math.floor(p1);
          let p1_f = p1 - p1_i;
          let val1 = this.buffers[channel][p1_i % this.bufferSize] * (1 - p1_f) + this.buffers[channel][(p1_i + 1) % this.bufferSize] * p1_f;
          
          let p2_i = Math.floor(p2);
          let p2_f = p2 - p2_i;
          let val2 = this.buffers[channel][p2_i % this.bufferSize] * (1 - p2_f) + this.buffers[channel][(p2_i + 1) % this.bufferSize] * p2_f;
          
          // distance from read head to write head (going backwards)
          let dist1 = (this.writePointers[channel] - p1 + this.bufferSize) % this.bufferSize;
          let dist2 = (this.writePointers[channel] - p2 + this.bufferSize) % this.bufferSize;
          
          let w1 = this.getWindow(dist1);
          let w2 = this.getWindow(dist2);
          
          outputChannel[i] = (val1 * w1 + val2 * w2) / (w1 + w2 + 0.001);
          
          this.writePointers[channel] = (this.writePointers[channel] + 1) % this.bufferSize;
          this.readPointers1[channel] = (p1 + pitch) % this.bufferSize;
          this.readPointers2[channel] = (p2 + pitch) % this.bufferSize;
      }
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
