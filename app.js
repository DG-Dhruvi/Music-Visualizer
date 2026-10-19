(() => {
  const $ = id => document.getElementById(id);
  const audio = $('audio'), fileInput = $('fileInput'), grid = $('graphGrid');
  const state = { audioContext: null, analyser: null, source: null, buffer: null, waveform: null, url: null, worker: null, workerReady: false, analysisPending: false, pendingMoment: null, raf: 0, drag: null, selected: null, expanded: null };
  try {
    state.worker = new Worker(new URL('./analysis-worker.js', window.location.href));
    state.worker.onmessage = event => {
      const message = event.data;
      if (message.type === 'ready') {
        state.waveform = message.waveform; state.workerReady = true; $('waveEmpty').hidden = true;
        updateMoment(); renderLive();
      } else if (message.type === 'analysis') {
        state.analysisPending = false;
        // Ignore a result if a newer scrub request has already replaced it.
        if (Math.abs(message.seconds - audio.currentTime) < .12 || audio.paused) {
          state.selected = message.result;
          $('windowFrequency').textContent = `SELECTED MOMENT · ${Math.round(state.selected.fundamental)} HZ`;
          for (const id of ['sine', 'cosine', 'fourier', 'harmonics']) { const card = grid.querySelector(`[data-graph="${id}"]`); if (card) drawById(card.querySelector('canvas'), id); }
          if (state.expanded && ['sine', 'cosine', 'fourier', 'harmonics'].includes(state.expanded)) drawById($('expandedCanvas'), state.expanded);
          if (audio.paused) renderLive();
        }
        if (state.pendingMoment !== null) { const next = state.pendingMoment; state.pendingMoment = null; requestMoment(next); }
      } else if (message.type === 'error') {
        state.analysisPending = false; toast(message.message);
      }
    };
    state.worker.onerror = () => toast('Audio analysis worker failed to start. Open the site through its Vercel URL.');
  } catch (_) { state.worker = null; }
  const palette = { grid: '#ecebf1', axis: '#9493a0', violet: '#7657e8', coral: '#fa8067', teal: '#159caa', ink: '#34323f' };

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function timeLabel(value) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00'; }
  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height), px = Math.round(w * dpr), py = Math.round(h * dpr);
    if (canvas.width !== px || canvas.height !== py) { canvas.width = px; canvas.height = py; }
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, w, h };
  }
  function gridLines(c, w, h, rows = 4) {
    c.clearRect(0, 0, w, h); c.strokeStyle = palette.grid; c.lineWidth = 1;
    for (let i = 0; i < rows; i++) { const y = 8 + (h - 16) * i / (rows - 1); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.save(); c.setLineDash([3, 5]); c.strokeStyle = '#d6d4df'; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke(); c.restore();
  }
  function frame(canvas, id, fn) { const { c, w, h } = setupCanvas(canvas); gridLines(c, w, h, id === 'spectrum' || id === 'harmonics' ? 4 : 5); fn(c, w, h); }

  function drawWave(c, w, h) {
    if (!state.buffer || !state.waveform?.length) return;
    const data = state.waveform, duration = state.buffer.duration;
    const mid = h / 2, scale = h * .43;
    c.beginPath(); c.strokeStyle = palette.violet; c.lineWidth = 1;
    const segmentCount = data.length / 2;
    for (let x = 0; x < w; x++) { const index = Math.min(segmentCount - 1, Math.floor(x / w * segmentCount)) * 2; c.moveTo(x, mid - data[index + 1] * scale); c.lineTo(x, mid - data[index] * scale); }
    c.stroke();
    if (duration > 0) { const x = w * audio.currentTime / duration; c.fillStyle = palette.coral; c.fillRect(x - 1, 0, 2, h); c.beginPath(); c.arc(x, 8, 4, 0, Math.PI * 2); c.fill(); }
  }
  function drawSpectrum(c, w, h) {
    if (!state.audioContext) return;
    let values;
    if (!audio.paused && state.analyser) { values = new Uint8Array(state.analyser.frequencyBinCount); state.analyser.getByteFrequencyData(values); }
    else values = state.selected?.spectrum;
    if (!values?.length) return;
    const nyquist = audio.paused ? state.selected.sr / 2 : state.audioContext.sampleRate / 2, maxF = Math.min(20000, nyquist), minF = 20, logMin = Math.log(minF), span = Math.log(maxF) - logMin;
    const count = Math.max(100, Math.floor(w * 1.2)); c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x < count; x++) { const frequency = Math.exp(logMin + x / (count - 1) * span), index = Math.min(values.length - 1, Math.max(0, Math.round(frequency / nyquist * values.length))), strength = values[index] / 255, y = h - 8 - Math.pow(strength, .8) * (h - 20); c.lineTo(x / (count - 1) * w, y); }
    c.lineTo(w, h); c.closePath(); const gradient = c.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, '#fa806780'); gradient.addColorStop(1, '#fa806704'); c.fillStyle = gradient; c.fill();
    c.beginPath();
    for (let x = 0; x < count; x++) { const frequency = Math.exp(logMin + x / (count - 1) * span), index = Math.min(values.length - 1, Math.max(0, Math.round(frequency / nyquist * values.length))), y = h - 8 - Math.pow(values[index] / 255, .8) * (h - 20); if (x === 0) c.moveTo(0, y); else c.lineTo(x / (count - 1) * w, y); }
    c.strokeStyle = palette.coral; c.lineWidth = 1.7; c.stroke();
    c.font = '8px "DM Mono",monospace'; c.fillStyle = palette.axis;
    for (const [label, freq] of [['20 Hz', 20], ['100', 100], ['1k', 1000], ['10k', 10000]]) { if (freq <= maxF) { const x = (Math.log(freq) - logMin) / span * w; c.fillText(label, Math.max(1, Math.min(w - 30, x - 6)), h - 1); } }
  }
  function fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; } }
    for (let size = 2; size <= n; size <<= 1) { const half = size >> 1, angle = -2 * Math.PI / size, stepR = Math.cos(angle), stepI = Math.sin(angle); for (let start = 0; start < n; start += size) { let wr = 1, wi = 0; for (let j = 0; j < half; j++) { const even = start + j, odd = even + half, tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd]; real[odd] = real[even] - tr; imag[odd] = imag[even] - ti; real[even] += tr; imag[even] += ti; const next = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = next; } } }
  }
  function analyzeWindow(seconds) {
    const channel = state.buffer.getChannelData(0), sr = state.buffer.sampleRate, n = 2048;
    if (channel.length < n) return { samples: channel, n: channel.length, sr, components: [], fundamental: 0 };
    const center = Math.floor(seconds * sr), start = Math.max(0, Math.min(channel.length - n, center - n / 2));
    const original = channel.slice(start, start + n), real = new Float64Array(n), imag = new Float64Array(n); let mean = 0;
    for (const sample of original) mean += sample; mean /= n;
    for (let i = 0; i < n; i++) real[i] = (original[i] - mean) * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
    fft(real, imag);
    const low = Math.max(2, Math.floor(55 * n / sr)), high = Math.min(n / 2 - 1, Math.floor(1200 * n / sr)); let fundamental = low;
    for (let k = low; k <= high; k++) if (Math.hypot(real[k], imag[k]) > Math.hypot(real[fundamental], imag[fundamental])) fundamental = k;
    const components = [], spectrum = new Uint8Array(n / 2), maxMagnitude = Math.max(1, ...Array.from({ length: n / 2 - 1 }, (_, i) => Math.hypot(real[i + 1], imag[i + 1])));
    for (let k = 1; k < spectrum.length; k++) spectrum[k] = Math.min(255, Math.round(Math.hypot(real[k], imag[k]) / maxMagnitude * 255));
    for (let harmonic = 1; harmonic <= 18; harmonic++) { const k = fundamental * harmonic; if (k >= n / 2) break; components.push({ harmonic, frequency: k * sr / n, cosine: 2 * real[k] / n, sine: -2 * imag[k] / n }); }
    return { samples: original, n, sr, components, spectrum, fundamental: fundamental * sr / n };
  }
  function drawComponents(c, w, h, kind) {
    if (!state.selected?.components.length) return;
    const parts = state.selected.components.slice(0, 5), mid = h / 2, scale = h * .37, cycles = 3, pts = Math.floor(w * 1.4);
    parts.forEach((part, index) => { c.beginPath(); for (let i = 0; i <= pts; i++) { const phase = 2 * Math.PI * cycles * i / pts * part.harmonic, value = (kind === 'sine' ? part.sine * Math.sin(phase) : part.cosine * Math.cos(phase)) * 8, y = mid - Math.max(-1, Math.min(1, value)) * scale; if (!i) c.moveTo(0, y); else c.lineTo(i / pts * w, y); } c.strokeStyle = index === 0 ? (kind === 'sine' ? '#7657e8ad' : '#fa8067ad') : (kind === 'sine' ? '#7657e84d' : '#fa80674d'); c.lineWidth = index === 0 ? 1.7 : 1; c.stroke(); });
    c.fillStyle = kind === 'sine' ? palette.violet : palette.coral; c.font = '9px "DM Mono",monospace'; c.fillText(`${parts.length} HARMONIC COMPONENTS`, 8, 13);
  }
  function drawFourier(c, w, h) {
    if (!state.selected?.components.length) return;
    const components = state.selected.components, mid = h / 2, scale = h * .32, cycles = 4, pts = Math.floor(w * 1.5);
    const max = Math.max(.001, ...components.map(p => Math.abs(p.sine) + Math.abs(p.cosine)));
    // Overlay the selected audio window for comparison.
    c.beginPath(); const raw = state.selected.samples, stride = Math.max(1, Math.floor(raw.length / pts));
    for (let i = 0; i < pts; i++) { const value = raw[Math.min(raw.length - 1, i * stride)] / max, y = mid - Math.max(-1.3, Math.min(1.3, value)) * scale; if (!i) c.moveTo(0, y); else c.lineTo(i / pts * w, y); }
    c.strokeStyle = '#159caa55'; c.lineWidth = 1; c.stroke();
    c.beginPath();
    for (let i = 0; i <= pts; i++) { const phase = 2 * Math.PI * cycles * i / pts, value = components.reduce((sum, p) => sum + p.cosine * Math.cos(phase * p.harmonic) + p.sine * Math.sin(phase * p.harmonic), 0), y = mid - Math.max(-1.25, Math.min(1.25, value / max)) * scale; if (!i) c.moveTo(0, y); else c.lineTo(i / pts * w, y); }
    c.strokeStyle = palette.teal; c.lineWidth = 2; c.shadowColor = '#159caa35'; c.shadowBlur = 5; c.stroke(); c.shadowBlur = 0;
    c.fillStyle = palette.violet; c.font = '9px "DM Mono",monospace'; c.fillText(`FUNDAMENTAL ≈ ${Math.round(state.selected.fundamental)} Hz`, 8, 13);
  }
  function drawHarmonics(c, w, h) {
    if (!state.selected?.components.length) return;
    const parts = state.selected.components.slice(0, 12), max = Math.max(.001, ...parts.map(p => Math.hypot(p.cosine, p.sine))), gap = 7, bw = Math.max(5, (w - 24 - gap * parts.length) / parts.length), left = 12, base = h - 19;
    parts.forEach((p, i) => { const x = left + i * (bw + gap), strength = Math.hypot(p.cosine, p.sine) / max, bh = strength * (h - 40); c.fillStyle = i === 0 ? palette.violet : (i % 2 ? '#fa8067' : '#b5a5f5'); c.beginPath(); c.roundRect(x, base - bh, bw, bh, 3); c.fill(); c.font = '8px "DM Mono",monospace'; c.fillStyle = palette.axis; c.textAlign = 'center'; c.fillText(String(p.harmonic), x + bw / 2, h - 5); }); c.textAlign = 'left';
  }
  function drawById(canvas, id) {
    frame(canvas, id, (c, w, h) => {
      if (id === 'waveform') drawWave(c, w, h);
      if (id === 'spectrum') drawSpectrum(c, w, h);
      if (id === 'sine' || id === 'cosine') drawComponents(c, w, h, id);
      if (id === 'fourier') drawFourier(c, w, h);
      if (id === 'harmonics') drawHarmonics(c, w, h);
    });
  }
  function renderAll() {
    for (const card of grid.querySelectorAll('.graph-card')) drawById(card.querySelector('canvas'), card.dataset.graph);
    if (state.expanded) drawById($('expandedCanvas'), state.expanded);
  }
  function renderLive() {
    for (const id of ['waveform', 'spectrum']) { const card = grid.querySelector(`[data-graph="${id}"]`); if (card) drawById(card.querySelector('canvas'), id); }
    if (state.expanded === 'waveform' || state.expanded === 'spectrum') drawById($('expandedCanvas'), state.expanded);
  }
  function updateMoment() {
    if (!state.buffer) return;
    if (!state.worker || !state.workerReady) return;
    if (state.analysisPending) { state.pendingMoment = audio.currentTime; return; }
    state.analysisPending = true;
    state.worker.postMessage({ type: 'analyze', seconds: audio.currentTime, sampleRate: state.buffer.sampleRate });
  }
  function prepareWaveform() {
    state.channel = state.buffer.getChannelData(0);
    const bucketCount = Math.min(12000, Math.max(2000, Math.ceil(state.channel.length / 2048))), bucketSize = Math.ceil(state.channel.length / bucketCount);
    state.waveform = new Array(bucketCount);
    for (let b = 0; b < bucketCount; b++) { const from = b * bucketSize, to = Math.min(state.channel.length, from + bucketSize); let low = 1, high = -1; for (let i = from; i < to; i++) { const value = state.channel[i]; if (value < low) low = value; if (value > high) high = value; } state.waveform[b] = [low, high]; }
  }
  function animate() { if (!state.buffer) return; renderLive(); if (!audio.paused) state.raf = requestAnimationFrame(animate); }
  function goWorkspace(file) {
    $('landing').hidden = true; $('workspace').hidden = false;
    $('trackName').textContent = file.name.replace(/\.[^.]+$/, ''); $('trackFormat').textContent = (file.name.split('.').pop() || 'AUDIO').toUpperCase() + ' AUDIO';
  }
  async function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|flac|ogg|aac|m4a|opus)$/i.test(file.name)) { toast('Choose an audio file, such as MP3, WAV, or FLAC.'); return; }
    if (file.size > 100 * 1024 * 1024) { toast('This track is over the 100 MB limit.'); return; }
    try {
      const Context = window.AudioContext || window.webkitAudioContext; if (!Context) throw new Error('Web Audio is not supported by this browser.');
      if (!state.audioContext) state.audioContext = new Context(); await state.audioContext.resume();
      if (state.url) URL.revokeObjectURL(state.url); state.url = URL.createObjectURL(file); audio.src = state.url; audio.load();
      if (!state.source) state.source = state.audioContext.createMediaElementSource(audio);
      if (state.analyser) { try { state.source.disconnect(state.analyser); state.analyser.disconnect(); } catch (_) {} }
      state.analyser = state.audioContext.createAnalyser(); state.analyser.fftSize = 8192; state.analyser.smoothingTimeConstant = .76; state.source.connect(state.analyser); state.analyser.connect(state.audioContext.destination);
      state.buffer = await state.audioContext.decodeAudioData(await file.arrayBuffer());
      if (!state.worker) throw new Error('Web Worker is unavailable. Serve the app over HTTPS or localhost.');
      state.workerReady = false; state.analysisPending = false; state.pendingMoment = null;
      const audioSamples = state.buffer.getChannelData(0).slice();
      state.worker.postMessage({ type: 'init', samples: audioSamples.buffer }, [audioSamples.buffer]);
      goWorkspace(file); $('trackDuration').textContent = timeLabel(state.buffer.duration); $('durationTime').textContent = timeLabel(state.buffer.duration); $('waveDuration').textContent = timeLabel(state.buffer.duration);
      $('playButton').disabled = false; $('waveEmpty').hidden = false; $('waveEmpty').textContent = 'Preparing waveform…'; audio.currentTime = 0; $('seekSlider').value = '0';
    } catch (error) { console.error(error); toast('This track could not be decoded. Try MP3, WAV, or FLAC.'); }
  }
  $('browseButton').addEventListener('click', () => fileInput.click()); $('newTrackButton').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
  const landingDrop = $('landingDrop');
  for (const type of ['dragenter', 'dragover']) landingDrop.addEventListener(type, event => { event.preventDefault(); landingDrop.classList.add('dragging'); });
  for (const type of ['dragleave', 'drop']) landingDrop.addEventListener(type, event => { event.preventDefault(); landingDrop.classList.remove('dragging'); });
  landingDrop.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
  document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
  $('homeButton').addEventListener('click', event => { event.preventDefault(); audio.pause(); $('workspace').hidden = true; $('landing').hidden = false; });
  $('playButton').addEventListener('click', async () => { await state.audioContext.resume(); if (audio.paused) { try { await audio.play(); } catch (_) { toast('Press play again to start audio.'); } } else audio.pause(); });
  audio.addEventListener('play', () => { $('playButton').textContent = 'Ⅱ'; $('playButton').setAttribute('aria-label', 'Pause'); cancelAnimationFrame(state.raf); animate(); });
  audio.addEventListener('pause', () => { $('playButton').textContent = '▶'; $('playButton').setAttribute('aria-label', 'Play'); cancelAnimationFrame(state.raf); renderAll(); });
  audio.addEventListener('timeupdate', () => { if (!state.buffer) return; $('currentTime').textContent = timeLabel(audio.currentTime); if (!$('seekSlider').matches(':active')) $('seekSlider').value = String(audio.currentTime / audio.duration * 1000); updateMoment(); });
  $('seekSlider').addEventListener('input', event => { if (!state.buffer) return; audio.currentTime = state.buffer.duration * Number(event.target.value) / 1000; $('currentTime').textContent = timeLabel(audio.currentTime); updateMoment(); });
  audio.addEventListener('ended', () => renderAll());

  // Drag graph headers/cards to rearrange the grid; use the corner control to focus one graph.
  grid.addEventListener('dragstart', event => { const card = event.target.closest('.graph-card'); if (!card || event.target.closest('button')) { event.preventDefault(); return; } state.drag = card; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
  grid.addEventListener('dragend', () => { if (state.drag) state.drag.classList.remove('dragging'); state.drag = null; grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); });
  grid.addEventListener('dragover', event => { event.preventDefault(); const target = event.target.closest('.graph-card'); if (target && target !== state.drag) { grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); target.classList.add('drag-over'); } });
  grid.addEventListener('drop', event => { event.preventDefault(); const target = event.target.closest('.graph-card'); if (!state.drag || !target || target === state.drag) return; const cards = [...grid.querySelectorAll('.graph-card')], from = cards.indexOf(state.drag), to = cards.indexOf(target); if (from < to) target.after(state.drag); else target.before(state.drag); target.classList.remove('drag-over'); renderAll(); });
  function expandGraph(id, title, caption) { state.expanded = id; $('expandedTitle').textContent = title; $('expandedCaption').textContent = caption || 'This graph updates as you move through the track.'; $('expandOverlay').hidden = false; document.body.style.overflow = 'hidden'; drawById($('expandedCanvas'), id); }
  grid.addEventListener('click', event => { const button = event.target.closest('.expand-button'); if (!button) return; const card = button.closest('.graph-card'); expandGraph(card.dataset.graph, card.querySelector('h3').textContent, card.querySelector('.graph-title p').textContent); });
  function closeExpand() { $('expandOverlay').hidden = true; state.expanded = null; document.body.style.overflow = ''; }
  $('closeExpand').addEventListener('click', closeExpand); $('expandOverlay').addEventListener('click', event => { if (event.target === $('expandOverlay')) closeExpand(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.expanded) closeExpand(); });
  window.addEventListener('resize', renderAll);
  renderAll();
})();
