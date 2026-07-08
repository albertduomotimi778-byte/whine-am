
export type EditOperation = 'CUT' | 'CROP';

export const editAudioBuffer = (
  audioContext: AudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number,
  operation: EditOperation
): AudioBuffer | null => {
  const totalSamples = buffer.length;
  const startSample = Math.floor(start * totalSamples);
  const endSample = Math.floor(end * totalSamples);
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  
  // Validate range
  if (startSample >= totalSamples || endSample <= startSample) return buffer;
  const safeStart = Math.max(0, startSample);
  const safeEnd = Math.min(totalSamples, endSample);

  let newLength = 0;
  if (operation === 'CROP') {
    newLength = safeEnd - safeStart;
  } else if (operation === 'CUT') {
    newLength = totalSamples - (safeEnd - safeStart);
  }

  if (newLength <= 0) return null;

  const newBuffer = audioContext.createBuffer(channels, newLength, sampleRate);

  for (let i = 0; i < channels; i++) {
    const oldData = buffer.getChannelData(i);
    const newData = newBuffer.getChannelData(i);
    
    if (operation === 'CROP') {
      for (let j = 0; j < newLength; j++) {
        newData[j] = oldData[safeStart + j];
      }
    } else if (operation === 'CUT') {
      // Copy part before cut
      for (let j = 0; j < safeStart; j++) {
        newData[j] = oldData[j];
      }
      // Copy part after cut
      const secondPartLen = totalSamples - safeEnd;
      for (let k = 0; k < secondPartLen; k++) {
        newData[safeStart + k] = oldData[safeEnd + k];
      }
    }
  }
  return newBuffer;
};

export const appendAudioBuffer = (
    audioContext: AudioContext,
    buffer1: AudioBuffer,
    buffer2: AudioBuffer
): AudioBuffer => {
    const channels = Math.max(buffer1.numberOfChannels, buffer2.numberOfChannels);
    const totalLength = buffer1.length + buffer2.length;
    const sampleRate = buffer1.sampleRate; 
    
    const newBuffer = audioContext.createBuffer(channels, totalLength, sampleRate);
    
    for (let i = 0; i < channels; i++) {
        // Handle mono/stereo mismatch by using channel 0 if channel i doesn't exist
        const data1 = i < buffer1.numberOfChannels ? buffer1.getChannelData(i) : buffer1.getChannelData(0);
        const data2 = i < buffer2.numberOfChannels ? buffer2.getChannelData(i) : buffer2.getChannelData(0);
        const newData = newBuffer.getChannelData(i);
        
        newData.set(data1, 0);
        newData.set(data2, buffer1.length);
    }
    
    return newBuffer;
};
