// Audio data work runs here so waveform preparation and Fourier analysis do not
// compete with the page's controls and canvas rendering.
let samples = null;

function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, angle = -2 * Math.PI / size;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const even = start + j, odd = even + half;
        const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
        real[even] += tr; imag[even] += ti;
        const next = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = next;
      }
    }
  }
}

function prepareWaveform(channel) {
  const count = Math.min(12000, Math.max(2000, Math.ceil(channel.length / 2048)));
  const bucketSize = Math.ceil(channel.length / count), envelope = new Float32Array(count * 2);
  for (let bucket = 0; bucket < count; bucket++) {
    const from = bucket * bucketSize, to = Math.min(channel.length, from + bucketSize);
    let low = 1, high = -1;
    for (let i = from; i < to; i++) { const value = channel[i]; if (value < low) low = value; if (value > high) high = value; }
    envelope[bucket * 2] = low; envelope[bucket * 2 + 1] = high;
  }
  return envelope;
}

function analyze(seconds, sampleRate) {
  const maxN = Math.min(2048, 2 ** Math.floor(Math.log2(samples.length)));
  if (maxN < 32) return { type: 'analysis', seconds, result: { samples: new Float32Array(samples), n: samples.length, sr: sampleRate, components: [], spectrum: new Uint8Array(0), fundamental: 0 } };
  const n = maxN, center = Math.floor(seconds * sampleRate), start = Math.max(0, Math.min(samples.length - n, center - n / 2));
  const original = samples.slice(start, start + n), real = new Float64Array(n), imag = new Float64Array(n);
  let mean = 0; for (const sample of original) mean += sample; mean /= n;
  for (let i = 0; i < n; i++) real[i] = (original[i] - mean) * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
  fft(real, imag);
  const low = Math.max(2, Math.floor(55 * n / sampleRate)), high = Math.min(n / 2 - 1, Math.floor(1200 * n / sampleRate));
  let fundamental = Math.min(low, n / 2 - 1), best = 0;
  for (let k = low; k <= high; k++) { const magnitude = Math.hypot(real[k], imag[k]); if (magnitude > best) { best = magnitude; fundamental = k; } }
  const components = [];
  for (let harmonic = 1; harmonic <= 18; harmonic++) {
    const k = fundamental * harmonic; if (k >= n / 2) break;
    components.push({ harmonic, frequency: k * sampleRate / n, cosine: 2 * real[k] / n, sine: -2 * imag[k] / n });
  }
  let maxMagnitude = 1;
  for (let k = 1; k < n / 2; k++) maxMagnitude = Math.max(maxMagnitude, Math.hypot(real[k], imag[k]));
  const spectrum = new Uint8Array(n / 2);
  for (let k = 1; k < spectrum.length; k++) spectrum[k] = Math.min(255, Math.round(Math.hypot(real[k], imag[k]) / maxMagnitude * 255));
  return { type: 'analysis', seconds, result: { samples: original, n, sr: sampleRate, components, spectrum, fundamental: fundamental * sampleRate / n } };
}

self.onmessage = event => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      samples = new Float32Array(message.samples);
      const waveform = prepareWaveform(samples);
      self.postMessage({ type: 'ready', waveform }, [waveform.buffer]);
    } else if (message.type === 'analyze' && samples) {
      const response = analyze(message.seconds, message.sampleRate), result = response.result;
      self.postMessage(response, [result.samples.buffer, result.spectrum.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Audio analysis failed.' });
  }
};
