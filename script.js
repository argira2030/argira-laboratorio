// ARGIRA SCRIPT VERSION 2026-05-31-D
// ========== 1. AudioContext global y desbloqueo móvil ==========
window.ArgiraAudio = (function () {
  let ctx = null;
  return {
    get: function () {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    },
    resume: function () {
      const c = this.get();
      if (c.state === 'suspended') return c.resume().then(() => c);
      return Promise.resolve(c);
    }
  };
})();

document.addEventListener('touchstart', () => {
  window.ArgiraAudio.resume().catch(() => {});
}, { once: true });

// ========== ARGIRA PIPELINE v3.5 ==========
// boxCountingDimensionV35, analyzeColorV35, analyzeSpatialV35,
// sonicParamsV35, _granularLayer, synthesizeV35,
// stereoToAudioBuffer, stereoToWavBlob
// Insertado desde app-v35.js (correcciones aplicadas: 512px box, canal L spatial)

// ── BOX-COUNTING FRACTAL v3.5 ─────────────────────────────────
// Entrada: imgData (ImageData 512×512), W, H  ← igual que Python img.thumbnail(512)
// Salida:  D ∈ [1.0, 2.0]  (fallback 1.5 si datos insuficientes)
function boxCountingDimensionV35(imgData, W, H) {
  if (!imgData || !W || !H) return 1.5;
  const d = imgData.data;
  const N = W * H;
  const arr = new Float64Array(N);
  let arrSum = 0;
  for (let i = 0; i < N; i++) {
    const lum = 0.299 * d[i * 4]     / 255
              + 0.587 * d[i * 4 + 1] / 255
              + 0.114 * d[i * 4 + 2] / 255;
    arr[i]  = lum;
    arrSum += lum;
  }
  const threshold = arrSum / N;
  const binary = new Uint8Array(N);
  for (let i = 0; i < N; i++) binary[i] = arr[i] > threshold ? 1 : 0;
  const sizes = [], counts = [];
  let box_size = 2;
  while (box_size <= 256) {   // 512px → máx box_size 256
    let count = 0;
    for (let i = 0; i + box_size <= H; i += box_size) {
      for (let j = 0; j + box_size <= W; j += box_size) {
        let patchSum = 0;
        outer: for (let pi = i; pi < i + box_size; pi++) {
          for (let pj = j; pj < j + box_size; pj++) {
            if (binary[pi * W + pj]) { patchSum = 1; break outer; }
          }
        }
        if (patchSum) count++;
      }
    }
    if (count > 0) { sizes.push(box_size); counts.push(count); }
    box_size *= 2;
  }
  if (sizes.length < 2) return 1.5;
  const log_sizes  = sizes.map(s => Math.log(1.0 / s));
  const log_counts = counts.map(c => Math.log(c));
  const n = log_sizes.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += log_sizes[i];  sumY  += log_counts[i];
    sumXY += log_sizes[i] * log_counts[i];
    sumX2 += log_sizes[i] * log_sizes[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  const D_raw = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 1.5;
  return Math.max(1.0, Math.min(2.0, D_raw));
}

// ── ANÁLISIS DE COLOR v3.5 ────────────────────────────────────
// Entrada: imgData (ImageData 256×256), W, H
// Salida:  { hue_mean, saturation_mean, value_mean, hue_std,
//            hue_entropy, edge_density, roughness, luminance_contrast }
function analyzeColorV35(imgData, W, H) {
  const d = imgData.data;
  const N = W * H;
  const hArr = new Float64Array(N);
  const sArr = new Float64Array(N);
  const vArr = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const r = d[i * 4]     / 255;
    const g = d[i * 4 + 1] / 255;
    const b = d[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const delta = mx - mn;
    vArr[i] = mx;
    sArr[i] = mx > 0 ? delta / mx : 0;
    let h = 0;
    if (delta > 0) {
      if      (mx === r) h = ((g - b) / delta + 6) % 6;
      else if (mx === g) h = (b - r) / delta + 2;
      else               h = (r - g) / delta + 4;
      h /= 6;
    }
    hArr[i] = h;
  }
  let sumH = 0, sumS = 0, sumV = 0;
  for (let i = 0; i < N; i++) { sumH += hArr[i]; sumS += sArr[i]; sumV += vArr[i]; }
  const hue_mean        = sumH / N;
  const saturation_mean = sumS / N;
  const value_mean      = sumV / N;
  let sumSqH = 0;
  for (let i = 0; i < N; i++) sumSqH += (hArr[i] - hue_mean) ** 2;
  const hue_std = Math.sqrt(sumSqH / N);
  const BINS = 32;
  const hist = new Float64Array(BINS);
  for (let i = 0; i < N; i++) hist[Math.min(BINS - 1, Math.floor(hArr[i] * BINS))]++;
  let hue_entropy = 0;
  for (let b = 0; b < BINS; b++) {
    const p = hist[b] / N;
    if (p > 0) hue_entropy -= p * Math.log2(p);
  }
  let edgeCount = 0;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const idx = row * W + col;
      const v0  = vArr[idx];
      const gx  = Math.abs((col + 1 < W ? vArr[idx + 1] : v0) - v0);
      const gy  = Math.abs((row + 1 < H ? vArr[idx + W] : v0) - v0);
      if (Math.sqrt(gx * gx + gy * gy) > 0.05) edgeCount++;
    }
  }
  const edge_density = edgeCount / N;
  const PATCH = 8;
  let patchVarSum = 0, patchCount = 0;
  for (let row = 0; row + PATCH <= H; row += PATCH) {
    for (let col = 0; col + PATCH <= W; col += PATCH) {
      let pSum = 0, pSum2 = 0, pN = 0;
      for (let pr = row; pr < row + PATCH; pr++) {
        for (let pc = col; pc < col + PATCH; pc++) {
          const v = vArr[pr * W + pc];
          pSum += v; pSum2 += v * v; pN++;
        }
      }
      const mean = pSum / pN;
      patchVarSum += pSum2 / pN - mean * mean;
      patchCount++;
    }
  }
  const roughness = patchCount > 0 ? Math.min(1.0, (patchVarSum / patchCount) / 0.25) : 0;
  let sumSqV = 0;
  for (let i = 0; i < N; i++) sumSqV += (vArr[i] - value_mean) ** 2;
  const luminance_contrast = Math.sqrt(sumSqV / N);
  return { hue_mean, saturation_mean, value_mean, hue_std, hue_entropy,
           edge_density, roughness, luminance_contrast };
}

// ── ANÁLISIS ESPACIAL v3.5 ────────────────────────────────────
// Entrada: imgData (256×256), W, H
// Canal L BT.601 — igual que PIL img.convert('L'), NO canal V de HSV
function analyzeSpatialV35(imgData, W, H) {
  const d = imgData.data;
  const N = W * H;
  const lum = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lum[i] = (0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]) / 255;
  }
  const zones    = new Float64Array(9);
  const zone_pan = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const zi  = r * 3 + c;
      const rs  = Math.floor(r * H / 3), re = Math.floor((r + 1) * H / 3);
      const cs  = Math.floor(c * W / 3), ce = Math.floor((c + 1) * W / 3);
      let sum = 0, count = 0;
      for (let row = rs; row < re; row++)
        for (let col = cs; col < ce; col++) { sum += lum[row * W + col]; count++; }
      zones[zi]    = count > 0 ? sum / count : 0;
      zone_pan[zi] = (c - 1) * 1.0;
    }
  }
  let total = 0;
  for (let i = 0; i < 9; i++) total += zones[i];
  const zones_norm = new Float64Array(9);
  if (total > 0) for (let i = 0; i < 9; i++) zones_norm[i] = zones[i] / total;
  let stereo_pan = 0;
  for (let i = 0; i < 9; i++) stereo_pan += zones_norm[i] * zone_pan[i];
  let sumLum = 0, sumX = 0, sumY = 0;
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W; col++) {
      const v = lum[row * W + col];
      sumLum += v; sumX += col * v; sumY += row * v;
    }
  const cx = sumLum > 0 ? (sumX / sumLum) / W : 0.5;
  const cy = sumLum > 0 ? (sumY / sumLum) / H : 0.5;
  const phi  = (1 + Math.sqrt(5)) / 2;
  const g1   = 1.0 / phi;
  const g2   = 1.0 - 1.0 / phi;
  const dist_P1 = Math.sqrt((cx - g2) ** 2 + (cy - g2) ** 2);
  const dist_P2 = Math.sqrt((cx - g1) ** 2 + (cy - g1) ** 2);
  return {
    zones: zones_norm, zone_pan, stereo_pan,
    center_x: cx, center_y: cy,
    golden_distance: Math.min(dist_P1, dist_P2),
    nearest_golden:  dist_P1 <= dist_P2 ? 'P1(0.382)' : 'P2(0.618)',
    dist_P1, dist_P2,
  };
}

// ── PARÁMETROS SÓNICOS v3.5 ───────────────────────────────────
function sonicParamsV35(fractal_D, colorM, spatialM) {
  const hue      = colorM.hue_mean;
  const sat      = colorM.saturation_mean;
  const hue_std  = colorM.hue_std;
  const hue_entropy        = colorM.hue_entropy;
  const edge_density       = colorM.edge_density;
  const luminance_contrast = colorM.luminance_contrast;
  const stereo_pan = Math.max(-1.0, Math.min(1.0, spatialM.stereo_pan * 4.0));
  const hue_entropy_norm  = Math.max(0, Math.min(1, hue_entropy / 5.2));
  const fractal_norm      = Math.max(0, Math.min(1, (fractal_D - 1.5) / 0.5));
  const edge_density_norm = Math.max(0, Math.min(1, edge_density / 0.50));
  const lum_norm          = Math.max(0, Math.min(1, luminance_contrast / 0.3));
  const hue_x_fractal = hue_entropy_norm * fractal_norm;
  const freq_input = 0.65 * hue_entropy_norm + 0.35 * lum_norm;
  const freq_base  = 150.0 * Math.pow(800.0 / 150.0, freq_input);
  const n_harmonics = Math.floor(3 + sat * 10);
  const odd_bias    = Math.max(0, Math.min(1, hue_std * 0.9 + hue_x_fractal * 0.6));
  const hue_complement = (hue + 0.5) % 1.0;
  const freq2_base = Math.max(150.0, Math.min(1000.0,
    300.0 + 600.0 * hue_entropy_norm
    + 350.0 * Math.cos(2 * Math.PI * hue_complement)
  ));
  const osc2_weight = Math.max(0, Math.min(0.6, (hue_std - 0.18) / 0.22));
  const zones = spatialM.zones;
  let zMean = 0;
  for (let i = 0; i < 9; i++) zMean += zones[i];
  zMean /= 9;
  let zVar = 0;
  for (let i = 0; i < 9; i++) zVar += (zones[i] - zMean) ** 2;
  zVar /= 9;
  const tempo_from_color   = Math.max(0, Math.min(15, hue_std * 25.0 + hue_x_fractal * 25.0));
  const tempo_from_space   = Math.max(0, Math.min(15, Math.log1p(zVar * 8000) * 12));
  const tempo_from_fractal = Math.max(-12, Math.min(12, (fractal_D - 1.5) * 60.0));
  const tempo_bpm = Math.max(40, Math.min(115,
    70.0 + tempo_from_color + tempo_from_space + tempo_from_fractal
  ));
  const fractal_offset = (fractal_D - 1.5) * 100;
  const mod_depth = 144.9 + edge_density_norm * 56.4 + fractal_norm * 83.1;
  const mod_rate  = 1.0 + hue_std * 4.0 + edge_density_norm * 6.0;
  const hue_x_edge  = hue_entropy_norm * edge_density_norm;
  const decay_input = lum_norm * 0.65 + hue_x_edge * 0.35;
  const decay       = 0.3 + decay_input * 0.4;
  return {
    freq_base, freq2_base, osc2_weight, n_harmonics, odd_bias,
    tempo_bpm, decay, mod_depth, mod_rate, stereo_pan, fractal_D,
    _tempo_color: tempo_from_color, _tempo_space: tempo_from_space,
    _tempo_fractal: tempo_from_fractal,
    _hue_entropy_norm: hue_entropy_norm, _edge_density_norm: edge_density_norm,
    _lum_norm: lum_norm, _golden_distance: spatialM.golden_distance,
    _fractal_offset: fractal_offset, _fractal_norm: fractal_norm,
    _hue_x_fractal: hue_x_fractal, _hue_x_edge: hue_x_edge,
    _freq_input: freq_input, _decay_input: decay_input,
  };
}

// ── CAPA GRANULAR v3.5 ────────────────────────────────────────
function _granularLayer(n, freq_base, fractal_D, sampleRate) {
  const grain_size  = Math.floor(0.04 * sampleRate);
  const grain_layer = new Float32Array(n);
  const intensity   = Math.max(0, Math.min(1, (fractal_D - 1.85) / 0.15));
  let rngState = 42n;
  function rngUniform(lo, hi) {
    rngState = (rngState * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    const u01 = Number(rngState & 0xFFFFFFFFn) / 4294967296.0;
    return lo + u01 * (hi - lo);
  }
  let pos = 0;
  while (pos < n) {
    const freq_jitter  = freq_base * (1.0 + rngUniform(-0.04, 0.04) * intensity);
    const phase_offset = rngUniform(0, 2 * Math.PI);
    const end  = Math.min(pos + grain_size, n);
    const gLen = end - pos;
    for (let i = 0; i < gLen; i++) {
      const t_grain = (pos + i) / sampleRate;
      const w = gLen > 1 ? 0.5 * (1 - Math.cos(2 * Math.PI * i / (gLen - 1))) : 1.0;
      grain_layer[pos + i] += w * Math.sin(2 * Math.PI * freq_jitter * t_grain + phase_offset)
                              * 0.25 * intensity;
    }
    pos += Math.floor(grain_size * 0.75);
  }
  return grain_layer;
}

// ── SÍNTESIS v3.5 ─────────────────────────────────────────────
function synthesizeV35(sonicParams, duration = 8.0, sampleRate = 44100) {
  const N = Math.floor(sampleRate * duration);
  const freq_base   = sonicParams.freq_base;
  const freq2_base  = sonicParams.freq2_base  ?? freq_base;
  const osc2_weight = sonicParams.osc2_weight ?? 0.0;
  const n_harmonics = sonicParams.n_harmonics;
  const mod_depth   = sonicParams.mod_depth;
  const mod_rate    = sonicParams.mod_rate;
  const decay       = sonicParams.decay;
  const tempo_bpm   = sonicParams.tempo_bpm;
  const odd_bias    = sonicParams.odd_bias;
  const stereo_pan  = sonicParams.stereo_pan;
  const fractal_D   = sonicParams.fractal_D;
  const signal = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t        = i / sampleRate;
    const modulator = mod_depth * Math.sin(2 * Math.PI * mod_rate * t);
    let s = 0;
    for (let k = 1; k <= n_harmonics; k++) {
      let amp = 1.0 / Math.pow(k, 1.5);
      if (k % 2 === 0) amp *= (1.0 - odd_bias * 0.90);
      s += amp * Math.sin(2 * Math.PI * (freq_base * k + modulator) * t);
    }
    signal[i] = s;
  }
  if (fractal_D > 1.85) {
    const gl = _granularLayer(N, freq_base, fractal_D, sampleRate);
    for (let i = 0; i < N; i++) signal[i] += gl[i];
  }
  if (osc2_weight > 0) {
    const signal2 = new Float32Array(N);
    const nH2 = Math.min(n_harmonics, 5);
    for (let i = 0; i < N; i++) {
      const t  = i / sampleRate;
      const m2 = mod_depth * 0.5 * Math.sin(2 * Math.PI * mod_rate * 1.618 * t);
      let s2 = 0;
      for (let k = 1; k <= nH2; k++)
        s2 += (1.0 / Math.pow(k, 2.0)) * Math.sin(2 * Math.PI * (freq2_base * k + m2) * t);
      signal2[i] = s2;
    }
    let max2 = 0;
    for (let i = 0; i < N; i++) if (Math.abs(signal2[i]) > max2) max2 = Math.abs(signal2[i]);
    if (max2 > 0) for (let i = 0; i < N; i++) signal2[i] /= max2;
    for (let i = 0; i < N; i++)
      signal[i] = signal[i] * (1.0 - osc2_weight * 0.4) + signal2[i] * osc2_weight;
  }
  let maxVal = 0;
  for (let i = 0; i < N; i++) if (Math.abs(signal[i]) > maxVal) maxVal = Math.abs(signal[i]);
  if (maxVal > 0) for (let i = 0; i < N; i++) signal[i] /= maxVal;
  const beat_period    = 60.0 / tempo_bpm;
  const beat_samples   = Math.floor(beat_period * sampleRate);
  const attack_samples = Math.floor(0.02 * sampleRate);
  const rel_samples    = Math.floor(Math.min(decay, beat_period * 0.8) * sampleRate);
  for (let bs = 0; bs < N; bs += beat_samples) {
    for (let i = 0; i < attack_samples; i++) {
      const idx = bs + i;
      if (idx < N) signal[idx] *= i / attack_samples;
    }
    const be = bs + beat_samples;
    for (let i = 0; i < rel_samples; i++) {
      const idx = be - rel_samples + i;
      if (idx >= 0 && idx < N) signal[idx] *= i / rel_samples;
    }
  }
  const fade = Math.floor(0.5 * sampleRate);
  for (let i = 0; i < fade; i++) signal[N - fade + i] *= 1 - i / (fade - 1);
  maxVal = 0;
  for (let i = 0; i < N; i++) if (Math.abs(signal[i]) > maxVal) maxVal = Math.abs(signal[i]);
  if (maxVal > 0) for (let i = 0; i < N; i++) signal[i] /= maxVal;
  const angle  = ((stereo_pan + 1) / 2) * (Math.PI / 2);
  const gain_L = Math.cos(angle);
  const gain_R = Math.sin(angle);
  const stereo = new Float32Array(2 * N);
  for (let i = 0; i < N; i++) {
    stereo[2 * i]     = signal[i] * gain_L;
    stereo[2 * i + 1] = signal[i] * gain_R;
  }
  return stereo;
}

// stereo Float32Array → AudioBuffer 2 canales
function stereoToAudioBuffer(audioCtx, stereoArray, sampleRate = 44100) {
  const N   = stereoArray.length / 2;
  const buf = audioCtx.createBuffer(2, N, sampleRate);
  const chL = buf.getChannelData(0);
  const chR = buf.getChannelData(1);
  for (let i = 0; i < N; i++) { chL[i] = stereoArray[2 * i]; chR[i] = stereoArray[2 * i + 1]; }
  return buf;
}

// stereo Float32Array → Blob WAV PCM 16-bit
function stereoToWavBlob(stereoArray, sampleRate = 44100) {
  const N      = stereoArray.length / 2;
  const nBytes = N * 4;
  const buf    = new ArrayBuffer(44 + nBytes);
  const v      = new DataView(buf);
  const w      = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + nBytes, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, nBytes, true);
  let off = 44;
  for (let i = 0; i < stereoArray.length; i++) {
    const s   = Math.max(-1, Math.min(1, stereoArray[i]));
    const i16 = Math.round(s < 0 ? s * 32768 : s * 32767);
    v.setInt16(off, i16, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ========== FIN PIPELINE v3.5 ==========

// ========== 2. Cola centralizada de voz ==========
window.ArgiraSpeech = {
  current: null,
  speaking: false,
  _transitioning: false,
  _queue: [],
  _onComplete: null,

  // Divide texto en chunks <= maxLen por límites de frase/coma/espacio.
  // Necesario en Android: SpeechSynthesis corta frases largas (~200 chars / ~15s).
  _chunk(text, maxLen = 180) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    // Separar primero por '. ' o '.' al final, luego por ', ', luego por espacio
    const sentences = text.split(/(?<=[.?!])\s+|(?<=\.)\s*/);
    let current = '';
    for (const s of sentences) {
      const piece = s.trim();
      if (!piece) continue;
      if ((current + ' ' + piece).trim().length <= maxLen) {
        current = current ? current + ' ' + piece : piece;
      } else {
        if (current) chunks.push(current.trim());
        // Si la frase sola es más larga que maxLen, dividir por comas
        if (piece.length > maxLen) {
          const parts = piece.split(/,\s*/);
          let sub = '';
          for (const p of parts) {
            if ((sub + ', ' + p).trim().length <= maxLen) {
              sub = sub ? sub + ', ' + p : p;
            } else {
              if (sub) chunks.push(sub.trim());
              sub = p;
            }
          }
          if (sub) current = sub;
          else current = '';
        } else {
          current = piece;
        }
      }
    }
    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  },

  // speak() devuelve una Promise que se resuelve cuando terminan TODOS los chunks.
  // Esto permite al tour hacer simplemente: await ArgiraSpeech.speak(texto, opts)
  // sin depender de estado global mutable (speaking, _transitioning, _onComplete).
  // El estado global se mantiene para compatibilidad con botones de lectura y toggle.
  speak(text, opts = {}) {
    if (!window.speechSynthesis) return Promise.resolve();
    if (this.speaking && this.current && this.current.text === text) return Promise.resolve();

    window.speechSynthesis.cancel();
    this.speaking = false;
    this.current = null;
    this._queue = [];

    const chunks = this._chunk(text);
    const self = this;

    // Promise que se resuelve cuando todos los chunks han terminado (o el speech ha sido detenido)
    const completion = new Promise(resolve => {

      const doSpeak = () => {
        self._queue = [...chunks];
        self.speaking = true;
        self._transitioning = false;

        function speakNext(chunkRetries) {
          if (!self._queue.length) {
            // Todos los chunks terminados — resolver tanto la Promise como el callback legacy
            self.speaking = false;
            self._transitioning = false;
            self.current = null;
            resolve();
            if (typeof self._onComplete === 'function') {
              const cb = self._onComplete;
              self._onComplete = null;
              cb();
            }
            return;
          }
          const retries = chunkRetries || 0;
          const chunk = self._queue.shift();
          const u = new SpeechSynthesisUtterance(chunk);
          u.text_original = text;
          Object.assign(u, { lang: 'es-ES', rate: 0.95, volume: 0.9, ...opts });
          self.current = u;
          u.onend = () => {
            self._transitioning = true;
            setTimeout(() => {
              self._transitioning = false;
              speakNext(0);
            }, 60);
          };
          u.onerror = (e) => {
            // Android cancela utterances con 'interrupted'/'canceled' por lag del TTS.
            const ignorable = !e || !e.error || e.error === 'interrupted' || e.error === 'canceled';
            if (ignorable && self.speaking && retries < 3) {
              self._queue.unshift(chunk);
              self._transitioning = true;
              setTimeout(() => {
                self._transitioning = false;
                if (self.speaking) speakNext(retries + 1);
              }, 150);
            } else {
              // Error real o reintentos agotados: saltar chunk y continuar
              self._transitioning = true;
              setTimeout(() => {
                self._transitioning = false;
                if (self.speaking) speakNext(0);
              }, 80);
            }
          };
          window.speechSynthesis.speak(u);
        }

        speakNext();
      };

      // Safari/iOS necesita un tick después del cancel() antes de lanzar la nueva utterance.
      if (/iP(hone|ad|od)/.test(navigator.userAgent)) {
        self.speaking = true; // evitar que waitUntilFinished resuelva durante el tick
        setTimeout(() => {
          if (window.speechSynthesis.speaking) {
            setTimeout(doSpeak, 90);
          } else {
            doSpeak();
          }
        }, 90);
      } else {
        doSpeak();
      }
    });

    return completion;
  },

  // waitUntilFinished() — mantenido por compatibilidad con código existente que no usa await speak().
  // El tour usa directamente await speak(), así que este método ya no es crítico para él.
  waitUntilFinished(timeout = 15000) {
    return new Promise(resolve => {
      if (!this.speaking && !this._transitioning) { resolve(); return; }
      const timer = setTimeout(() => {
        this._onComplete = null;
        resolve();
      }, timeout);
      this._onComplete = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  },
  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.speaking = false;
      this._transitioning = false;
      this._onComplete = null;
      this.current = null;
      this._queue = [];
    }
  }
};

// ========== 3. Sincronización de audio en el test ==========
function initAudioSync() {
  const allAudios = document.querySelectorAll('audio');
  allAudios.forEach(audio => {
    audio.addEventListener('play', () => {
      allAudios.forEach(other => {
        if (other !== audio && !other.paused) other.pause();
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', initAudioSync);

// ========== 4. Test auditivo dinámico (con rutas .wav) ==========
// Catálogo completo — nivel cromático 1 (mínimo) a 16 (máximo)
const OBRAS = [
  { nivel: 1,  audio: 'White_on_White_(Malevich,_1918).wav',                                                          img: 'White_on_White_(Malevich,_1918).png',                                                          label: 'Malevich · Blanco sobre Blanco · Nivel MÍNIMO' },
  { nivel: 2,  audio: 'Malevich_Cuadrado_Negro_1915.wav', img: 'Malevich_Cuadrado_Negro_1915.jpg', label: 'Malevich · Cuadrado Negro · Nivel MUY BAJO' },
  { nivel: 3,  audio: 'goya-saturno.wav',                               img: 'goya-saturno.jpg',                               label: 'Goya · Saturno · Nivel BAJO' },
  { nivel: 4,  audio: '500px-Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.wav',                            img: '500px-Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.jpg',                            label: 'Rembrandt · Autorretrato · Nivel BAJO' },
  { nivel: 5,  audio: 'EdwardHopperMorningSun1952.wav',                                                               img: 'EdwardHopperMorningSun1952.jpg',                                                               label: 'Hopper · Morning Sun · Nivel BAJO-MEDIO' },
  { nivel: 6,  audio: 'Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.wav',                                   img: 'Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.png',                                   label: 'Vermeer · La Lechera · Nivel MEDIO-BAJO' },
  { nivel: 7,  audio: 'Dalí,_Perfil_del_tiempo,_Vroclavo,_7.wav',                                                    img: 'Dalí,_Perfil_del_tiempo,_Vroclavo,_7.jpeg',                                                    label: 'Dalí · Perfil del Tiempo · Nivel MEDIO' },
  { nivel: 8,  audio: 'Paul_Cézanne_-_Montagne_Saint-victoire_-_Google_Art_Project.wav',                             img: 'Paul_Cézanne_-_Montagne_Saint-victoire_-_Google_Art_Project.jpg',                             label: 'Cézanne · Mont Sainte-Victoire · Nivel MEDIO' },
  { nivel: 9,  audio: 'Claude_Monet_-_Cliff_Walk_at_Pourville_-_Google_Art_Project.wav',                             img: 'Claude_Monet_-_Cliff_Walk_at_Pourville_-_Google_Art_Project.jpg',                             label: 'Monet · Acantilados de Pourville · Nivel MEDIO' },
  { nivel: 10, audio: 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.wav',                   img: 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',                   label: 'Botticelli · Nacimiento de Venus · Nivel MEDIO-ALTO' },
  { nivel: 11, audio: 'Edgar_Germain_Hilaire_Degas_076.wav',                                                          img: 'Edgar_Germain_Hilaire_Degas_076.jpg',                                                          label: 'Degas · Bailarinas Azules · Nivel MEDIO-ALTO' },
  { nivel: 12, audio: 'field-of-poppies.jpg!Large.wav',                                                               img: 'field-of-poppies.jpg!Large.jpg',                                                               label: 'Monet · Amapolas · Nivel ALTO' },
  { nivel: 13, audio: '1280px-Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.wav',                              img: '1280px-Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.jpg',                              label: 'Van Gogh · Campo de Trigo con Cuervos · Nivel ALTO' },
  { nivel: 14, audio: 'este.wav',                                                                                      img: 'este.jpg',                                                                                      label: 'Kandinsky · Several Circles · Nivel ALTO' },
  { nivel: 15, audio: 'La_Desserte_rouge,_par_Henri_Matisse.wav',                                                     img: 'La_Desserte_rouge,_par_Henri_Matisse.jpg',                                                     label: 'Matisse · La Mesa Roja · Nivel MUY ALTO' },
  { nivel: 16, audio: '3840px-Kandinsky_-_Jaune_Rouge_Bleu.wav',                                                      img: '3840px-Kandinsky_-_Jaune_Rouge_Bleu.jpg',                                                      label: 'Kandinsky · Amarillo Rojo Azul · Nivel MÁXIMO' },
];

// 5 pares fijos con salto cromático pedagógico
const testPairs = [
  {
    pair: 1, correct: 'B',
    audioA: 'White_on_White_(Malevich,_1918).wav',
    audioB: '3840px-Kandinsky_-_Jaune_Rouge_Bleu.wav',
    imgA:   'White_on_White_(Malevich,_1918).png',
    imgB:   '3840px-Kandinsky_-_Jaune_Rouge_Bleu.jpg',
    labelA: 'Malevich · Blanco sobre Blanco · Nivel MÍNIMO',
    labelB: 'Kandinsky · Amarillo Rojo Azul · Nivel MÁXIMO'
  },
  {
    pair: 2, correct: 'B',
    audioA: 'goya-saturno.wav',
    audioB: 'La_Desserte_rouge,_par_Henri_Matisse.wav',
    imgA:   'goya-saturno.jpg',
    imgB:   'La_Desserte_rouge,_par_Henri_Matisse.jpg',
    labelA: 'Goya · Saturno · Nivel BAJO',
    labelB: 'Matisse · La Mesa Roja · Nivel MUY ALTO'
  },
  {
    pair: 3, correct: 'B',
    audioA: 'EdwardHopperMorningSun1952.wav',
    audioB: '1280px-Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.wav',
    imgA:   'EdwardHopperMorningSun1952.jpg',
    imgB:   '1280px-Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.jpg',
    labelA: 'Hopper · Morning Sun · Nivel BAJO-MEDIO',
    labelB: 'Van Gogh · Campo de Trigo con Cuervos · Nivel ALTO'
  },
  {
    pair: 4, correct: 'A',
    audioA: 'field-of-poppies.jpg!Large.wav',
    audioB: 'Malevich_Cuadrado_Negro_1915.wav',
    imgA:   'field-of-poppies.jpg!Large.jpg',
    imgB:   'Malevich_Cuadrado_Negro_1915.jpg',
    labelA: 'Monet · Amapolas · Nivel ALTO',
    labelB: 'Malevich · Cuadrado Negro · Nivel MUY BAJO'
  },
  {
    pair: 5, correct: 'A',
    audioA: 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.wav',
    audioB: '500px-Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.wav',
    imgA:   'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',
    imgB:   '500px-Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.jpg',
    labelA: 'Botticelli · Nacimiento de Venus · Nivel MEDIO-ALTO',
    labelB: 'Rembrandt · Autorretrato · Nivel BAJO'
  }
];

const testContainer = document.getElementById('testPairsContainer');
if (testContainer) {
  testPairs.forEach(p => {
    const pairDiv = document.createElement('div');
    pairDiv.className = 'test-pair';
    pairDiv.id = `pair-${p.pair}`;
    pairDiv.innerHTML = `
      <div class="test-pair-header">
        <span class="test-pair-num">Par ${p.pair} de 5</span>
        <span class="test-pair-status" id="status-${p.pair}">Escucha y elige</span>
      </div>
      <div class="test-players">
        <div class="test-player">
          <span class="test-player-label">Sonido A</span>
          <audio controls aria-label="Sonido A del par ${p.pair}">
            <source src="${p.audioA}" type="audio/wav">
          </audio>
        </div>
        <div class="test-player">
          <span class="test-player-label">Sonido B</span>
          <audio controls aria-label="Sonido B del par ${p.pair}">
            <source src="${p.audioB}" type="audio/wav">
          </audio>
        </div>
      </div>
      <div class="test-question">
        <p>¿Cuál tiene mayor variabilidad cromática (más color, más caos)?</p>
        <div class="test-buttons">
          <button class="test-btn" data-pair="${p.pair}" data-choice="A" data-correct="${p.correct === 'A'}">El Sonido A</button>
          <button class="test-btn" data-pair="${p.pair}" data-choice="B" data-correct="${p.correct === 'B'}">El Sonido B</button>
          <button class="test-btn" data-pair="${p.pair}" data-choice="?" data-correct="false">No sé</button>
        </div>
      </div>
      <div class="test-reveal" id="reveal-${p.pair}">
        <div class="reveal-item" id="reveal-item-${p.pair}-A">
          <img src="${p.imgA}" alt="${p.labelA}" loading="lazy" crossorigin="anonymous">
          <div class="reveal-item-label"><strong>Sonido A ${p.correct === 'A' ? '✓ correcto' : ''}</strong><span>${p.labelA}</span></div>
        </div>
        <div class="reveal-item" id="reveal-item-${p.pair}-B">
          <img src="${p.imgB}" alt="${p.labelB}" loading="lazy" crossorigin="anonymous">
          <div class="reveal-item-label"><strong>Sonido B ${p.correct === 'B' ? '✓ correcto' : ''}</strong><span>${p.labelB}</span></div>
        </div>
      </div>
    `;
    testContainer.appendChild(pairDiv);
  });

  // Precargar imágenes de los paneles de revelación para evitar
  // el retraso al mostrarlos tras responder.
  testPairs.forEach(p => {
    [p.imgA, p.imgB].forEach(src => {
      const img = new Image();
      img.src = src;
    });
  });
}

let score = 0, answered = 0;
const totalPairs = testPairs.length;
const liveRegion = document.getElementById('live-region');

function announce(msg) {
  if (liveRegion) {
    liveRegion.textContent = '';
    setTimeout(() => { liveRegion.textContent = msg; }, 100);
  }
}

function answerHandler(e) {
  const btn = e.currentTarget;
  const pairNum = parseInt(btn.getAttribute('data-pair'), 10);
  const choice = btn.getAttribute('data-choice');
  const isCorrect = btn.getAttribute('data-correct') === 'true';
  const pairData = testPairs.find(t => t.pair === pairNum);

  const reveal = document.getElementById(`reveal-${pairNum}`);
  const status = document.getElementById(`status-${pairNum}`);
  const pairDiv = document.getElementById(`pair-${pairNum}`);
  const btns = pairDiv.querySelectorAll('.test-btn');

  btns.forEach(b => { b.disabled = true; b.setAttribute('aria-disabled', 'true'); });

  let announcement = '';
  if (choice === '?') {
    status.textContent = '— Sin respuesta';
    status.setAttribute('data-state', 'skip');
    announcement = `Par ${pairNum}: sin respuesta. La respuesta correcta era el Sonido ${pairData.correct}.`;
  } else if (isCorrect) {
    score++;
    status.textContent = '✓ Correcto';
    status.setAttribute('data-state', 'correct');
    btns.forEach(b => { if (b.getAttribute('data-choice') === choice) b.classList.add('correct'); });
    announcement = `Par ${pairNum}: ¡Correcto! Elegiste el Sonido ${choice}, que tiene mayor variabilidad cromática.`;
  } else {
    status.textContent = '✗ Incorrecto';
    status.setAttribute('data-state', 'wrong');
    btns.forEach(b => { if (b.getAttribute('data-choice') === choice) b.classList.add('wrong'); });
    announcement = `Par ${pairNum}: incorrecto. Elegiste el Sonido ${choice}. La respuesta correcta era el Sonido ${pairData.correct}.`;
  }

  reveal.classList.add('show');
  answered++;
  announce(announcement);
  if (answered === totalPairs) setTimeout(showScore, 800);
}

function showScore() {
  const panel = document.getElementById('score-panel');
  const numEl = document.getElementById('score-number');
  const msgEl = document.getElementById('score-message');
  if (!panel || !numEl || !msgEl) return;
  numEl.textContent = `${score} de ${totalPairs}`;
  const messages = {
    0: 'El sonido y el color son difíciles de conectar. Sigue escuchando — el cerebro aprende estas correspondencias con la práctica.',
    1: 'Detectaste algo. La correlación entre color y sonido existe, y tu oído ya lo intuye.',
    2: 'Buen oído perceptivo. Comienzas a distinguir estructuras visuales a través del sonido.',
    3: 'Notable. Tu percepción auditiva reconoce la densidad cromática con claridad creciente.',
    4: 'Muy buen resultado. Lees el color con los oídos con notable precisión.',
    5: 'Extraordinario. Eres capaz de leer pinturas con los oídos. Esto es accesibilidad real.'
  };
  msgEl.textContent = messages[score];
  panel.classList.add('show');
  announce(`Resultado final: ${score} de ${totalPairs} correctas. ${messages[score]}`);

  // Botón "Ir a la encuesta" — pasa el score como parámetro URL
  const existingBtn = panel.querySelector('.btn-encuesta');
  if (!existingBtn) {
    const btn = document.createElement('a');
    btn.className = 'btn-encuesta';
    btn.href = `/argira-encuesta/?aciertos=${score}`;
    btn.textContent = 'Ir a la encuesta →';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', `Ir a la encuesta de valoración. Tu resultado (${score} de ${totalPairs}) se importará automáticamente.`);
    btn.style.cssText = [
      'display:inline-block',
      'margin-top:1.2rem',
      'padding:0.85rem 1.8rem',
      'background:var(--gold,#b8922a)',
      'color:#1c1a17',
      'font-family:"Lora",serif',
      'font-size:1rem',
      'font-weight:700',
      'border-radius:4px',
      'text-decoration:none',
      'letter-spacing:0.03em',
      'transition:background 0.15s,color 0.15s',
    ].join(';');
    btn.addEventListener('mouseover',  () => { btn.style.background = '#1c1a17'; btn.style.color = '#f0ece4'; });
    btn.addEventListener('mouseout',   () => { btn.style.background = 'var(--gold,#b8922a)'; btn.style.color = '#1c1a17'; });
    btn.addEventListener('focus',      () => { btn.style.outline = '3px solid var(--gold,#b8922a)'; btn.style.outlineOffset = '3px'; });
    btn.addEventListener('blur',       () => { btn.style.outline = ''; });
    panel.appendChild(btn);
  }

  setTimeout(() => { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
}

function resetTest() {
  score = 0; answered = 0;
  const panel = document.getElementById('score-panel');
  if (panel) panel.classList.remove('show');
  for (let i = 1; i <= totalPairs; i++) {
    const reveal = document.getElementById(`reveal-${i}`);
    const status = document.getElementById(`status-${i}`);
    const pairDiv = document.getElementById(`pair-${i}`);
    if (reveal) reveal.classList.remove('show');
    if (status) { status.textContent = 'Escucha y elige'; status.removeAttribute('data-state'); }
    if (pairDiv) {
      pairDiv.querySelectorAll('.test-btn').forEach(b => {
        b.disabled = false;
        b.classList.remove('correct', 'wrong');
        b.setAttribute('aria-disabled', 'false');
      });
    }
  }
  announce('Test reiniciado. Puedes volver a intentarlo.');
}

if (testContainer) {
  testContainer.addEventListener('click', e => {
    const btn = e.target.closest('.test-btn');
    if (btn && !btn.disabled) answerHandler({ currentTarget: btn });
  });
}
const resetBtn = document.getElementById('resetTestBtn');
if (resetBtn) resetBtn.addEventListener('click', resetTest);

// ========== 5. Lector de voz (descripciones) ==========
document.querySelectorAll('.speak-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    const text = this.getAttribute('data-text');
    if (!text) return;
    const currentOriginal = window.ArgiraSpeech.current && window.ArgiraSpeech.current.text_original;
    if (window.ArgiraSpeech.speaking && (currentOriginal === text || (window.ArgiraSpeech.current && window.ArgiraSpeech.current.text === text))) {
      window.ArgiraSpeech.stop();
      this.classList.remove('speaking');
      this.innerHTML = '🔊 Leer descripción';
    } else {
      window.ArgiraSpeech.stop();
      window.ArgiraSpeech.speak(text, { rate: 0.95 });
      this.classList.add('speaking');
      this.innerHTML = '⏹ Detener';
      const self = this;
      const checkEnd = setInterval(() => {
        if (!window.ArgiraSpeech.current) {
          clearInterval(checkEnd);
          clearTimeout(checkEndSafety);
          self.classList.remove('speaking');
          self.innerHTML = '🔊 Leer descripción';
        }
      }, 100);
      const checkEndSafety = setTimeout(() => {
        clearInterval(checkEnd);
        self.classList.remove('speaking');
        self.innerHTML = '🔊 Leer descripción';
      }, 30000);
    }
  });
});

// ========== 6. Tour sonoro en los paneles de revelación del test ==========
function argiraTestScan(btn) {
  const item = btn.closest('.reveal-item');
  if (!item) return;
  let img = item.querySelector('img');
  if (!img) return;
  if (btn._argiraScanStop) { btn._argiraScanStop(); return; }

  function runScan() {
    const SIZE = 64;
    const cvs = document.createElement('canvas');

    // === Corrección proporcional ===
    const aspect = img.naturalWidth / img.naturalHeight;

    if (aspect >= 1) {
      // Imagen horizontal
      cvs.width = SIZE;
      cvs.height = Math.round(SIZE / aspect);
    } else {
      // Imagen vertical
      cvs.height = SIZE;
      cvs.width = Math.round(SIZE * aspect);
    }

    const ctx = cvs.getContext('2d');

    // Dibujar respetando geometría real
    ctx.drawImage(img, 0, 0, cvs.width, cvs.height);

    const data = ctx.getImageData(0, 0, cvs.width, cvs.height).data;

    // Número REAL de píxeles
    const N = cvs.width * cvs.height;

    const NZONES = 13;
    const NBINS = 12;

    // Centro geométrico dinámico
    const cx0 = (cvs.width - 1) / 2;
    const cy0 = (cvs.height - 1) / 2;

    const R_CTR = (Math.min(cvs.width, cvs.height) / 2) * 0.25;

    const zSumH = new Float64Array(NZONES);
    const zSumH2 = new Float64Array(NZONES);
    const zCnt = new Int32Array(NZONES);
    const zHist = new Uint32Array(NZONES * NBINS);

    for (let i = 0; i < N; i++) {

      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);

      const d = mx - mn;

      const s = mx > 0 ? d / mx : 0;

      let h = 0;

      if (d > 0) {
        if (mx === r) {
          h = ((g - b) / d + 6) % 6;
        } else if (mx === g) {
          h = (b - r) / d + 2;
        } else {
          h = (r - g) / d + 4;
        }

        h /= 6;
      }

      // === Corrección crítica ===
      const col = i % cvs.width;
      const row = Math.floor(i / cvs.width);

      const dx = col - cx0;
      const dy = row - cy0;

      const radius = Math.sqrt(dx * dx + dy * dy);

      let zi;

      if (radius < R_CTR) {
        zi = 12;
      } else {

        const angle =
          ((Math.atan2(dy, dx) + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) %
          (2 * Math.PI);

        zi = Math.min(
          11,
          Math.floor((angle / (2 * Math.PI)) * 12)
        );
      }

      zSumH[zi] += h;
      zSumH2[zi] += h * h;
      zCnt[zi]++;

      if (s < 0.08) continue;

      zHist[
        zi * NBINS +
        Math.min(NBINS - 1, Math.floor(h * NBINS))
      ]++;
    }

    const zStd = Array.from({length:NZONES},(_,i)=>{
      const n=zCnt[i]; if(!n) return 0;
      const mean=zSumH[i]/n;
      return Math.sqrt(Math.max(0, zSumH2[i]/n - mean*mean));
    });
    const zMax = Math.max(...zStd, 0.001);
    const zNorm = zStd.map(v=>v/zMax);
    const zoneModeH = Array.from({length:NZONES},(_,zi)=>{
      let maxBin=0, maxCount=0;
      for(let b=0;b<NBINS;b++){const c=zHist[zi*NBINS+b];if(c>maxCount){maxCount=c;maxBin=b;}}
      return maxCount===0 ? -1 : (maxBin+0.5)/NBINS;
    });

    function hueToColorName(h) {
      if (h < 0) return null;
      if (window._argiraHueToName) return window._argiraHueToName(h, 0.8, 0.7);
      const deg = h*360;
      if (deg<15||deg>=345) return 'rojo';
      if (deg<45) return 'naranja';
      if (deg<70) return 'amarillo';
      if (deg<150) return 'verde';
      if (deg<210) return 'cian';
      if (deg<270) return 'azul';
      if (deg<330) return 'violeta';
      return 'rosa';
    }
    function hourToPan(zi) { return zi===12 ? 0 : Math.sin((zi/12)*2*Math.PI); }

    window.ArgiraSpeech.stop();
    btn.setAttribute('aria-pressed','true');
    btn.innerHTML = '<span aria-hidden="true">⏹</span> Detener';

    const STEP_MS = 1100;
    let active = true;
    const timers = [];

    function stop() {
      active = false;
      timers.forEach(t=>clearTimeout(t));
      window.ArgiraSpeech.stop();
      btn.setAttribute('aria-pressed','false');
      btn.innerHTML = '<span aria-hidden="true">🕐</span> Tour sonoro';
      btn._argiraScanStop = null;
    }
    btn._argiraScanStop = stop;

    [0,1,2,3,4,5,6,7,8,9,10,11,12].forEach((zi,idx) => {
      const t = setTimeout(() => {
        if (!active) return;
        const hue=zoneModeH[zi], act=zNorm[zi], pan=hourToPan(zi);
        const horaLabel = zi===12 ? 'Centro' : `a las ${zi===0?12:zi} en punto`;
        const colorName = hueToColorName(hue);
        const textoVoz = colorName ? `${horaLabel} — ${colorName}` : horaLabel;
        window.ArgiraAudio.resume().then(function(audioCtx) {
          try {
            const freq = hue>=0 ? (200+hue*800) : 400;
            const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
            osc.type='triangle'; osc.frequency.value=freq;
            gain.gain.setValueAtTime(0.12+act*0.45, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+0.28);
            osc.connect(gain);
            if (audioCtx.createStereoPanner) {
              const panner=audioCtx.createStereoPanner(); panner.pan.value=pan;
              gain.connect(panner); panner.connect(audioCtx.destination);
            } else { gain.connect(audioCtx.destination); }
            osc.start(); osc.stop(audioCtx.currentTime+0.28);
          } catch(e){}
        }).catch(()=>{});
        timers.push(setTimeout(()=>{
          if (!active) return;
          window.ArgiraSpeech.speak(textoVoz, { rate: 1.3 });
          if(liveRegion) liveRegion.textContent=textoVoz;
        },300));
        if (idx===12) timers.push(setTimeout(stop, STEP_MS));
      }, idx*STEP_MS);
      timers.push(t);
    });
  }

  if (img.complete && img.naturalWidth) {
    runScan();
  } else {
    const onLoad = () => {
      img.removeEventListener('load', onLoad);
      runScan();
    };
    img.addEventListener('load', onLoad);
  }
}

if (testContainer) {
  testContainer.addEventListener('click', e => {
    const btn = e.target.closest('.argira-test-scan');
    if (btn) argiraTestScan(btn);
  });
}

// ========== 7. Lupa temporal y canvas inversa (con 30 fps) ==========
// Usar un archivo .wav existente (La Mesa Roja de Matisse)
const wavUrl = 'La_Desserte_rouge,_par_Henri_Matisse.wav';
const speedSlider = document.getElementById('lupaSpeed');
const speedVal = document.getElementById('lupaSpeedVal');
const gainSlider = document.getElementById('lupaShelvingGain');
const freqSlider = document.getElementById('lupaShelvingFreq');
const gainVal = document.getElementById('lupaShelvingGainVal');
const freqVal = document.getElementById('lupaShelvingFreqVal');
const fill = document.getElementById('lupaShelvingFill');
const btnPlay = document.getElementById('lupaBtnPlay');
const btnStop = document.getElementById('lupaBtnStop');
const statusDiv = document.getElementById('lupaStatus');
let source = null, buffer = null, isPlaying = false, currentFilter = null;
const audioCtx = window.ArgiraAudio.get();

function updateShelvingUI() {
  const g = parseFloat(gainSlider.value), f = parseFloat(freqSlider.value);
  if (gainVal) gainVal.textContent = g;
  if (freqVal) freqVal.textContent = f;
  if (fill) fill.style.width = ((g * -1) / 12) * 100 + '%';
  if (currentFilter && audioCtx) {
    currentFilter.gain.cancelScheduledValues(audioCtx.currentTime);
    currentFilter.gain.setValueAtTime(g, audioCtx.currentTime);
    currentFilter.frequency.cancelScheduledValues(audioCtx.currentTime);
    currentFilter.frequency.setValueAtTime(f, audioCtx.currentTime);
  }
}
if (gainSlider && freqSlider) {
  gainSlider.addEventListener('input', updateShelvingUI);
  freqSlider.addEventListener('input', updateShelvingUI);
  updateShelvingUI();
}
if (speedSlider) {
  speedSlider.addEventListener('input', function() {
    const v = parseFloat(this.value);
    if (speedVal) speedVal.textContent = v.toFixed(2) + '×';
    if (source && isPlaying && audioCtx) source.playbackRate.value = v;
  });
}

async function loadBuffer() {
  if (buffer) return buffer;
  if (statusDiv) statusDiv.textContent = 'Cargando audio…';
  try {
    const resp = await fetch(wavUrl);
    if (!resp.ok) throw new Error();
    const ab = await resp.arrayBuffer();
    buffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(ab, resolve, reject);
    });
    if (statusDiv) statusDiv.textContent = '';
    return buffer;
  } catch(e) {
    if (statusDiv) statusDiv.textContent = `Error: ${wavUrl} no encontrado`;
    return null;
  }
}

async function playLupa() {
  if (isPlaying) stopLupa();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const buf = await loadBuffer();
  if (!buf) return;
  const speed = parseFloat(speedSlider.value);
  source = audioCtx.createBufferSource();
  source.buffer = buf;
  source.playbackRate.value = speed;
  currentFilter = audioCtx.createBiquadFilter();
  currentFilter.type = 'highshelf';
  currentFilter.frequency.value = parseFloat(freqSlider.value);
  currentFilter.gain.value = parseFloat(gainSlider.value);
  source.connect(currentFilter);
  currentFilter.connect(audioCtx.destination);
  source.onended = () => stopLupa();
  source.start();
  isPlaying = true;
  if (btnPlay) { btnPlay.style.background = '#e8c96a'; btnPlay.style.color = '#000'; }
  if (statusDiv) statusDiv.textContent = 'Reproduciendo a ' + speed.toFixed(2) + '× · Matisse';
  if (window.LupaInversa) window.LupaInversa.start();
}

function stopLupa() {
  if (source) { try { source.stop(); } catch(e) {} source = null; }
  if (currentFilter) { currentFilter.disconnect(); currentFilter = null; }
  isPlaying = false;
  if (btnPlay) { btnPlay.style.background = 'rgba(232,201,106,0.08)'; btnPlay.style.color = 'var(--gold)'; }
  if (statusDiv) statusDiv.textContent = '';
  if (window.LupaInversa) window.LupaInversa.stop();
}

if (btnPlay) btnPlay.addEventListener('click', playLupa);
if (btnStop) btnStop.addEventListener('click', stopLupa);

// ========== 8. Argira Inversa (visualización optimizada a 30 fps) ==========
(function() {
  const canvas = document.getElementById('lupa-inversa-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const wrap = document.getElementById('lupa-inversa-wrap');
  const freqLbl = document.getElementById('lupa-inversa-freq-label');

  const RENDER_W = 320, RENDER_H = 200;
  canvas.width = RENDER_W; canvas.height = RENDER_H;
  canvas.style.width = '100%'; canvas.style.height = 'auto';

  const LUT = 4096, MASK = LUT - 1, SCALE = LUT / (Math.PI * 2);
  const cosLUT = new Float32Array(LUT), sinLUT = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const a = (i / LUT) * Math.PI * 2;
    cosLUT[i] = Math.cos(a); sinLUT[i] = Math.sin(a);
  }
  const fcos = r => cosLUT[(r * SCALE & MASK + LUT) & MASK];
  const fsin = r => sinLUT[(r * SCALE & MASK + LUT) & MASK];

  let pattern = 'chladni';
  let rafId = null;
  let phase = 0;
  let currentFreq = 432;
  let active = false;
  const MATISSE = { freq: 1480, harmonics: 6, phi: 0.618, complexity: 8 };

  function freqFromSpeed(speed) { return Math.max(20, Math.min(2000, MATISSE.freq * speed)); }
  function getSpeed() { const sl = document.getElementById('lupaSpeed'); return sl ? parseFloat(sl.value) : 1.0; }
  function freqToSpatial(hz) { return Math.max(1, Math.log2(Math.max(20, hz) / 20) * 3.2); }
  function hsl(h, s, l, a) { return `hsla(${h|0},${s}%,${l}%,${a})`; }

  const FRAME_INTERVAL = 1000 / 30; // 30 fps
  let lastFrameTime = 0;

  function drawChladni(freq, phi, complexity, t) {
    const fsp = freqToSpatial(freq);
    const m = Math.max(1, Math.round(fsp));
    const n = Math.max(1, Math.round(fsp * phi));
    const imageData = ctx.createImageData(RENDER_W, RENDER_H);
    const data = imageData.data;
    const hue = (freq / 2000 * 300 + 40) | 0;
    for (let y = 0; y < RENDER_H; y++) {
      const ny = (y / RENDER_H) * Math.PI;
      for (let x = 0; x < RENDER_W; x++) {
        const nx = (x / RENDER_W) * Math.PI;
        const v = Math.abs(fcos(m * nx + t * 0.3) * fcos(n * ny + t * 0.2)
                          - fcos(n * nx + t * 0.25) * fcos(m * ny + t * 0.35));
        const thresh = 0.04 + (complexity / 12) * 0.08;
        const i4 = (y * RENDER_W + x) * 4;
        if (v < thresh) {
          const bri = Math.max(0, 1 - v / thresh);
          const r = Math.round(bri * 60  + bri * 80  * Math.sin(hue * Math.PI / 180));
          const g = Math.round(bri * 180 * (hue > 60 && hue < 200 ? 0.9 : 0.5));
          const b = Math.round(bri * 60  + bri * 80  * Math.sin((hue + 120) * Math.PI / 180));
          data[i4] = Math.min(255, r + 20);
          data[i4+1] = Math.min(255, g + 160);
          data[i4+2] = Math.min(255, b + 20);
          data[i4+3] = 255;
        } else {
          data[i4] = 5; data[i4+1] = 5; data[i4+2] = 8; data[i4+3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function drawLissajous(freq, phi, complexity, t) {
    const cx = RENDER_W/2, cy = RENDER_H/2;
    const rx = RENDER_W*0.44, ry = RENDER_H*0.44;
    ctx.fillStyle = '#020204';
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
    const hue = (freq / 2000 * 300 + 40) | 0;
    const steps = 3000 + complexity * 400;
    const a = Math.max(1, Math.round(freqToSpatial(freq)));
    const b = Math.max(1, Math.round(a * phi));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * Math.PI * 2;
      const x = cx + rx * fcos(a * s + t * 0.4 + phi);
      const y = cy + ry * fsin(b * s + t * 0.3);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    const grad = ctx.createLinearGradient(0, 0, RENDER_W, RENDER_H);
    grad.addColorStop(0, hsl(hue, 80, 65, 0.7));
    grad.addColorStop(0.5, hsl((hue+60)%360, 80, 65, 0.7));
    grad.addColorStop(1, hsl((hue+120)%360, 80, 65, 0.7));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawPolar(freq, phi, complexity, t) {
    const cx = RENDER_W/2, cy = RENDER_H/2;
    const R = Math.min(RENDER_W, RENDER_H) * 0.44;
    const hue = (freq / 2000 * 300 + 40) | 0;
    ctx.fillStyle = '#020204';
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
    const petals = Math.max(2, Math.round(freqToSpatial(freq)));
    const steps = 1200 + complexity * 200;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2 * petals;
      const r = R * Math.abs(fcos(angle + t * 0.5));
      const x = cx + r * Math.cos(angle / petals);
      const y = cy + r * Math.sin(angle / petals);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hsl(hue, 75, 60, 0.75);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function drawPhi(freq, phi, complexity, t) {
    const cx = RENDER_W/2, cy = RENDER_H/2;
    const hue = (freq / 2000 * 300 + 40) | 0;
    ctx.fillStyle = '#020204';
    ctx.fillRect(0, 0, RENDER_W, RENDER_H);
    const turns = 4 + complexity * 0.5;
    const steps = 2000 + complexity * 300;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * Math.PI * 2 * turns;
      const r = (Math.min(RENDER_W, RENDER_H) * 0.44) * (i / steps);
      const x = cx + r * fcos(s * phi + t * 0.3);
      const y = cy + r * fsin(s + t * 0.25);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(RENDER_W,RENDER_H)*0.44);
    grad.addColorStop(0, hsl(hue, 85, 70, 0.9));
    grad.addColorStop(1, hsl((hue+180)%360, 70, 55, 0.4));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  function drawCurrentPattern() {
    const speed = getSpeed();
    currentFreq = freqFromSpeed(speed);
    if (freqLbl) freqLbl.textContent = currentFreq.toFixed(0) + ' Hz · ' + speed.toFixed(2) + '×';
    phase += 0.018 * speed;
    switch (pattern) {
      case 'chladni': drawChladni(currentFreq, MATISSE.phi, MATISSE.complexity, phase); break;
      case 'lissajous': drawLissajous(currentFreq, MATISSE.phi, MATISSE.complexity, phase); break;
      case 'polar': drawPolar(currentFreq, MATISSE.phi, MATISSE.complexity, phase); break;
      case 'phi': drawPhi(currentFreq, MATISSE.phi, MATISSE.complexity, phase); break;
    }
  }

  function renderFrame(now) {
    if (!active) { rafId = null; return; }
    if (now - lastFrameTime >= FRAME_INTERVAL) {
      lastFrameTime = now;
      drawCurrentPattern();
    }
    rafId = requestAnimationFrame(renderFrame);
  }

  window.LupaInversa = {
    start() {
      if (wrap) wrap.classList.add('visible');
      if (!active) {
        active = true;
        lastFrameTime = performance.now();
        if (!rafId) renderFrame(lastFrameTime);
      }
    },
    stop() {
      if (wrap) wrap.classList.remove('visible');
      active = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      phase = 0;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (window.LupaInversa) window.LupaInversa.stop();
    } else {
      if (wrap && wrap.classList.contains('visible')) window.LupaInversa.start();
    }
  });

  document.querySelectorAll('.lupa-pchip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lupa-pchip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pattern = btn.dataset.pattern;
      phase = 0;
    });
  });
})();

// ========== 9. Análisis y sonificación de imagen subida ==========
const zone = document.getElementById('tu-upload-zone');
const fileInput = document.getElementById('tu-file-input');
const canvasHidden = document.getElementById('tu-canvas');
const panel = document.getElementById('tu-panel');
const preview = document.getElementById('tu-preview');
const nombreSpan = document.getElementById('tu-nombre');
const metricasEl = document.getElementById('tu-metricas');
const chromaPct = document.getElementById('tu-chroma-pct');
const chromaBar = document.getElementById('tu-chroma-bar');
const paramsGrid = document.getElementById('tu-params-grid');
const speedSliderTu = document.getElementById('tu-speed');
const speedValTu = document.getElementById('tu-speed-val');
const btnPlayTu = document.getElementById('tu-btn-play');
const btnStopTu = document.getElementById('tu-btn-stop');
const btnDL = document.getElementById('tu-btn-download');
const statusEl = document.getElementById('tu-status');
const tuGainSlider = document.getElementById('tuShelvingGain');
const tuFreqSlider = document.getElementById('tuShelvingFreq');
const tuGainVal = document.getElementById('tuShelvingGainVal');
const tuFreqVal = document.getElementById('tuShelvingFreqVal');
const tuFill = document.getElementById('tuShelvingFill');

let wavBuffer = null, wavPCM = null, sourceTu = null, currentFilterTu = null, isPlayingTu = false, currentFileName = 'mi-imagen';

function updateTuShelvingUI() {
  const g = parseFloat(tuGainSlider.value), f = parseFloat(tuFreqSlider.value);
  if (tuGainVal) tuGainVal.textContent = g;
  if (tuFreqVal) tuFreqVal.textContent = f;
  if (tuFill) tuFill.style.width = ((g * -1) / 12) * 100 + '%';
  if (currentFilterTu && audioCtx) {
    currentFilterTu.gain.cancelScheduledValues(audioCtx.currentTime);
    currentFilterTu.gain.setValueAtTime(g, audioCtx.currentTime);
    currentFilterTu.frequency.cancelScheduledValues(audioCtx.currentTime);
    currentFilterTu.frequency.setValueAtTime(f, audioCtx.currentTime);
  }
}
if (tuGainSlider && tuFreqSlider) {
  tuGainSlider.addEventListener('input', updateTuShelvingUI);
  tuFreqSlider.addEventListener('input', updateTuShelvingUI);
  updateTuShelvingUI();
}

function rgbToHsv(r,g,b) {
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = 0;
  if (d>0) {
    if (max===r) h = ((g-b)/d+6)%6;
    else if (max===g) h = (b-r)/d+2;
    else h = (r-g)/d+4;
    h/=6;
  }
  return [h, max>0?d/max:0, max];
}

// Desviación circular
function circularStd(hues) {
  const TAU = 2 * Math.PI;
  let sumSin = 0, sumCos = 0;
  for (let h of hues) {
    const angle = h * TAU;
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  }
  const R = Math.hypot(sumSin, sumCos) / hues.length;
  const Rclamped = Math.max(R, 0.001);
  const circularStdRad = Math.sqrt(-2 * Math.log(Rclamped));
  return Math.min(0.5, circularStdRad / TAU);
}

// ── processFile v3.5 ─────────────────────────────────────────
// Sustituye analyzePixels + synthesize + pcmToAudioBuffer + processFile
// del pipeline antiguo. Usa dos canvas separados:
//   512×512 → boxCountingDimensionV35  (igual que Python img.thumbnail(512))
//   256×256 → analyzeColorV35 + analyzeSpatialV35
// renderMetrics, pararTu, pcmToStereoWavBlob y los listeners de play/stop/dl
// se mantienen intactos del script de referencia.

const SIZE_COLOR = 256;
const SIZE_BOX   = 512;

// métricas planas compatibles con renderMetrics del script de referencia
function buildCompatMetrics(colorM, spatialM, fractal_D, sonic) {
  return {
    hueStd:       colorM.hue_std,
    satMean:      colorM.saturation_mean,
    valMean:      colorM.value_mean,
    irregularidad: colorM.edge_density,
    fractalD:     fractal_D,
    freqBase:     sonic.freq_base,
    centroidX:    spatialM.center_x,
    centroidY:    spatialM.center_y,
  };
}

function processFile(file) {
  currentFileName = file.name.replace(/\.[^.]+$/, '');
  if (nombreSpan) nombreSpan.textContent = file.name;
  if (statusEl)   statusEl.textContent   = 'Cargando imagen…';

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    if (preview) preview.src = dataUrl;
    if (statusEl) statusEl.textContent = 'Analizando v3.5…';

    const img = new Image();
    img.onload = () => {
      if (!canvasHidden) { alert('❌ No se encontró el canvas'); return; }

      // Canvas 256×256 — color y spatial
      canvasHidden.width  = SIZE_COLOR;
      canvasHidden.height = SIZE_COLOR;
      const ctx2d = canvasHidden.getContext('2d');
      ctx2d.drawImage(img, 0, 0, SIZE_COLOR, SIZE_COLOR);
      let imgData;
      try { imgData = ctx2d.getImageData(0, 0, SIZE_COLOR, SIZE_COLOR); }
      catch(e) { alert('❌ getImageData: ' + e.message); return; }

      // Canvas 512×512 — box-counting
      const canvasBox = document.createElement('canvas');
      canvasBox.width  = SIZE_BOX;
      canvasBox.height = SIZE_BOX;
      const ctxBox = canvasBox.getContext('2d');
      ctxBox.drawImage(img, 0, 0, SIZE_BOX, SIZE_BOX);
      let imgDataBox;
      try { imgDataBox = ctxBox.getImageData(0, 0, SIZE_BOX, SIZE_BOX); }
      catch(e) { alert('❌ getImageData (box): ' + e.message); return; }

      let fractal_D, colorM, spatialM, sonic, compat;
      try {
        fractal_D = boxCountingDimensionV35(imgDataBox, SIZE_BOX, SIZE_BOX);
        colorM    = analyzeColorV35(imgData, SIZE_COLOR, SIZE_COLOR);
        spatialM  = analyzeSpatialV35(imgData, SIZE_COLOR, SIZE_COLOR);
        sonic     = sonicParamsV35(fractal_D, colorM, spatialM);
        compat    = buildCompatMetrics(colorM, spatialM, fractal_D, sonic);
      } catch(e) { alert('❌ Pipeline análisis: ' + e.message); return; }

      if (statusEl) statusEl.textContent = 'Sintetizando audio…';

      setTimeout(() => {
        try {
          const stereo  = synthesizeV35(sonic, 8.0, 44100);
          const actx    = window.ArgiraAudio.get();
          wavPCM        = stereo;                              // Float32Array estéreo intercalado
          wavPCM._centroidX = spatialM.center_x;
          wavBuffer     = stereoToAudioBuffer(actx, stereo);  // AudioBuffer 2 canales

          renderMetrics(compat, file.name);

          if (statusEl) statusEl.textContent = 'Audio listo · Pulsa Escuchar';
          if (panel)    panel.style.display   = 'block';
          setTimeout(() => panel && panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

          window._argiraTourMapPromise = fetchSharedObjectMap(img);
          if (window._argiraTourInit)  window._argiraTourInit(img, compat);
          if (window._argiraTouchInit) window._argiraTouchInit(img);
        } catch(err) {
          alert('❌ Error en síntesis: ' + err.message);
          if (statusEl) statusEl.textContent = 'Error: ' + err.message;
        }
      }, 50);
    };

    img.onerror = () => {
      alert('❌ No se pudo procesar la imagen.');
      if (statusEl) statusEl.textContent = 'Error al procesar la imagen.';
    };
    img.src = dataUrl;
  };
  reader.onerror = () => {
    alert('❌ Error al leer el archivo.');
    if (statusEl) statusEl.textContent = 'Error de lectura.';
  };
  reader.readAsDataURL(file);
}

function renderMetrics(m, filename) {
  const pct = Math.round((m.hueStd - 0.016) / (0.364 - 0.016) * 100);
  const pctClamped = Math.min(Math.max(pct, 0), 100);
  let nivel = 'MÍNIMO';
  if (m.hueStd > 0.040) nivel = 'MUY BAJO';
  if (m.hueStd > 0.080) nivel = 'BAJO';
  if (m.hueStd > 0.130) nivel = 'BAJO-MEDIO';
  if (m.hueStd > 0.180) nivel = 'MEDIO';
  if (m.hueStd > 0.230) nivel = 'MEDIO-ALTO';
  if (m.hueStd > 0.270) nivel = 'ALTO';
  if (m.hueStd > 0.310) nivel = 'MUY ALTO';
  if (m.hueStd > 0.345) nivel = 'MÁXIMO';
  if (chromaPct) chromaPct.textContent = pctClamped.toFixed(0) + '% · ' + nivel;
  if (chromaBar) chromaBar.style.width = pctClamped.toFixed(1) + '%';
  if (metricasEl) metricasEl.innerHTML = `hue_std: <strong>${m.hueStd.toFixed(4)}</strong> · Irregularidad: <strong>${m.irregularidad.toFixed(4)}</strong> · Saturación: <strong>${m.satMean.toFixed(3)}</strong> · Pan: <strong>${m.centroidX < 0.4 ? '← izq' : m.centroidX > 0.6 ? 'der →' : '· centro'}</strong> · Pitch: <strong>${m.centroidY < 0.4 ? '↑ agudo' : m.centroidY > 0.6 ? '↓ grave' : '· medio'}</strong>`;
  if (paramsGrid) {
    const params = [ ['Frecuencia base', m.freqBase.toFixed(1) + ' Hz'],
                     ['Dimensión fractal', m.fractalD.toFixed(4)],
                     ['Armónicos', Math.round(3 + m.satMean * 10)],
                     ['Tempo (estim.)', Math.round(70 + m.hueStd * 50) + ' BPM'] ];
    paramsGrid.innerHTML = params.map(([k,v]) => `<div style="padding:12px 20px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);"><div style="font-size:0.65rem;font-family:'Cinzel',serif;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:2px;">${k}</div><div style="font-family:'IBM Plex Mono',monospace;font-size:0.9rem;color:var(--gold);">${v}</div></div>`).join('');
  }
}

function pararTu() {
  if (sourceTu) { try { sourceTu.stop(); } catch(e) {} sourceTu = null; }
  if (currentFilterTu) { currentFilterTu.disconnect(); currentFilterTu = null; }
  isPlayingTu = false;
  if (btnPlayTu) { btnPlayTu.style.background = 'rgba(232,201,106,0.08)'; btnPlayTu.style.color = 'var(--gold)'; }
  if (statusEl) statusEl.textContent = '';
}

function pcmToStereoWavBlob(pcm, sr, pan) {
  const numSamples = pcm.length;
  const theta = ((pan + 1) / 2) * (Math.PI / 2);
  const gainL = Math.cos(theta), gainR = Math.sin(theta);
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);
  function w(off, str) { for (let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); }
  function u16(off,v) { view.setUint16(off, v, true); }
  function u32(off,v) { view.setUint32(off, v, true); }
  w(0, 'RIFF'); u32(4, 36 + numSamples * 4); w(8, 'WAVE'); w(12, 'fmt ');
  u32(16, 16); u16(20, 1); u16(22, 2); u32(24, sr); u32(28, sr * 4);
  u16(32, 4); u16(34, 16); w(36, 'data'); u32(40, numSamples * 4);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    const int16 = s < 0 ? s * 32768 : s * 32767;
    view.setInt16(offset, Math.round(int16 * gainL), true);
    view.setInt16(offset + 2, Math.round(int16 * gainR), true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

if (zone && fileInput) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.background = 'rgba(232,201,106,0.1)'; });
  zone.addEventListener('dragleave', () => { zone.style.background = 'transparent'; });
  zone.addEventListener('drop', e => { e.preventDefault(); zone.style.background = 'transparent'; const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) processFile(f); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) processFile(fileInput.files[0]); });
}

if (speedSliderTu) {
  speedSliderTu.addEventListener('input', function() { const v = parseFloat(this.value); if (speedValTu) speedValTu.textContent = v.toFixed(2) + '×'; if (sourceTu && isPlayingTu) sourceTu.playbackRate.value = v; });
}
if (btnPlayTu) {
  btnPlayTu.addEventListener('click', async function() {
    if (!wavBuffer) return;
    pararTu();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const speed = parseFloat(speedSliderTu.value);
    sourceTu = audioCtx.createBufferSource();
    sourceTu.buffer = wavBuffer;
    sourceTu.playbackRate.value = speed;
    currentFilterTu = audioCtx.createBiquadFilter();
    currentFilterTu.type = 'highshelf';
    currentFilterTu.frequency.value = parseFloat(tuFreqSlider.value);
    currentFilterTu.gain.value = parseFloat(tuGainSlider.value);
    sourceTu.connect(currentFilterTu);
    if (wavPCM && wavPCM._centroidX !== undefined && audioCtx.createStereoPanner) {
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, (wavPCM._centroidX - 0.5) * 2));
      currentFilterTu.connect(panner);
      panner.connect(audioCtx.destination);
    } else {
      currentFilterTu.connect(audioCtx.destination);
    }
    sourceTu.onended = () => { isPlayingTu = false; if (btnPlayTu) { btnPlayTu.style.background = 'rgba(232,201,106,0.08)'; btnPlayTu.style.color = 'var(--gold)'; } if (statusEl) statusEl.textContent = ''; };
    sourceTu.start();
    isPlayingTu = true;
    if (btnPlayTu) { btnPlayTu.style.background = '#e8c96a'; btnPlayTu.style.color = '#000'; }
    if (statusEl) statusEl.textContent = 'Reproduciendo a ' + speed.toFixed(2) + '× · ' + currentFileName;
  });
}
if (btnStopTu) btnStopTu.addEventListener('click', pararTu);
if (btnDL) {
  btnDL.addEventListener('click', function() {
    if (!wavPCM) return;
    const speed = parseFloat(speedSliderTu.value);
    const exportSR = Math.round(44100 * speed);
    // wavPCM es estéreo intercalado (v3.5) — stereoToWavBlob lo acepta directamente
    const wavBlob = stereoToWavBlob(wavPCM, exportSR);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    const speedTag = speed !== 1.0 ? '_' + speed.toFixed(2).replace('.', '') + 'x' : '';
    a.download = currentFileName + speedTag + '_argira.wav';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.textContent = 'WAV descargado a ' + speed.toFixed(2) + '× · ' + a.download;
  });
}

// ── Puentes v3.5 ─────────────────────────────────────────────
// initGallerySonify, initGalleryAudioPan y initCanvasTour llaman a
// _argiraAnalyze, _argiraSynthesize y _argiraPcmToBuffer.
// Los redirigimos al pipeline v3.5 manteniendo la misma firma de salida.

window._argiraAnalyze = function(imgData, size) {
  // Devuelve objeto plano compatible con el script de referencia.
  // size puede ser 64, 128 o 256 — se usa tal cual para color/spatial.
  // Box-counting usa el mismo imgData (resolución ya fija por el caller).
  const colorM   = analyzeColorV35(imgData, size, size);
  const spatialM = analyzeSpatialV35(imgData, size, size);
  const fractal_D = boxCountingDimensionV35(imgData, size, size);
  const sonic    = sonicParamsV35(fractal_D, colorM, spatialM);
  return {
    hueStd:       colorM.hue_std,
    satMean:      colorM.saturation_mean,
    valMean:      colorM.value_mean,
    irregularidad: colorM.edge_density,
    fractalD:     fractal_D,
    freqBase:     sonic.freq_base,
    centroidX:    spatialM.center_x,
    centroidY:    spatialM.center_y,
  };
};

window._argiraSynthesize = function(m) {
  // Recibe el objeto plano de _argiraAnalyze y devuelve Float32Array estéreo
  // intercalado (igual que synthesizeV35). Los callers de galería solo
  // necesitan pasarlo a _argiraPcmToBuffer, que acepta ambos formatos.
  const colorM = {
    hue_mean:          m.hueStd,
    saturation_mean:   m.satMean,
    hue_std:           m.hueStd,
    hue_entropy:       Math.min(5.2, m.irregularidad * 5.2),
    edge_density:      m.irregularidad,
    luminance_contrast: m.valMean,
  };
  const spatialM = {
    stereo_pan:      (m.centroidX - 0.5) * 2,
    zones:           new Float64Array(9).fill(1 / 9),
    golden_distance: 0.1,
  };
  const sonic = sonicParamsV35(m.fractalD, colorM, spatialM);
  return synthesizeV35(sonic, 8.0, 44100);
};

window._argiraPcmToBuffer = function(stereo) {
  // stereo es Float32Array estéreo intercalado (v3.5).
  const actx = window.ArgiraAudio.get();
  return stereoToAudioBuffer(actx, stereo);
};
window._argiraHueToName = function(h, s, v) {
  if (s < 0.12) {
    if (v > 0.85) return 'blanco';
    if (v < 0.20) return 'negro';
    return 'gris';
  }
  const deg = h * 360;
  if (deg < 15 || deg >= 345) return 'rojo';
  if (deg < 45) return 'naranja';
  if (deg < 70) return 'amarillo';
  if (deg < 150) return 'verde';
  if (deg < 210) return 'cian';
  if (deg < 270) return 'azul';
  if (deg < 330) return 'violeta';
  return 'rosa';
};

// ========== 10. Inicializaciones de la galería (sin cambios, solo se declaran) ==========
function initGallerySonify() {
  const cards = document.querySelectorAll('#galeria .card');
  cards.forEach(card => {
    const img = card.querySelector('.card-image');
    const scanBtn = card.querySelector('.argira-scan-btn');
    if (!img || !scanBtn) return;

    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;padding:0 2px;';
    sliderWrap.innerHTML = `
      <span style="font-family:'Cinzel',serif;font-size:0.68rem;letter-spacing:0.1em;color:var(--text-dim);white-space:nowrap;">🐢 Ritmo</span>
      <input type="range" min="0.25" max="1.5" step="0.05" value="1.0" style="flex:1;accent-color:rgba(220,130,200,0.8);cursor:pointer;">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:0.72rem;color:var(--gold);min-width:3ch;">1×</span>`;
    const slider = sliderWrap.querySelector('input');
    const speedLbl = sliderWrap.querySelector('span:last-child');

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      speedLbl.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
      if (source) source.playbackRate.value = v;
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'argira-spatial-btn argira-sonify-btn';
    btn.setAttribute('aria-label', 'Oír la paleta sonora completa de esta obra a tu ritmo');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<span aria-hidden="true">🎵</span> Oír la obra';

    scanBtn.before(sliderWrap);
    sliderWrap.after(btn);

    let source = null, isPlaying = false, cachedPcm = null, cachedCx = 0.5;

    function stop() {
      if (source) { try { source.stop(); } catch(e) {} source = null; }
      isPlaying = false;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = '<span aria-hidden="true">🎵</span> Oír la obra';
    }

    function play(pcm, centroidX) {
      const audioCtx = window.ArgiraAudio.resume();
      const buf = window._argiraPcmToBuffer(pcm);
      source = audioCtx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = parseFloat(slider.value);
      if (audioCtx.createStereoPanner) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, (centroidX - 0.5) * 2));
        source.connect(panner);
        panner.connect(audioCtx.destination);
      } else {
        source.connect(audioCtx.destination);
      }
      source.onended = stop;
      source.start();
      isPlaying = true;
      btn.setAttribute('aria-pressed', 'true');
      btn.innerHTML = '<span aria-hidden="true">⏹</span> Detener';
    }

    function synthesizeAndPlay() {
      if (cachedPcm) { play(cachedPcm, cachedCx); return; }
      btn.innerHTML = '<span aria-hidden="true">⏳</span> Calculando…';
      btn.disabled = true;
      setTimeout(() => {
        try {
          const SIZE = 128;
          const cvs = document.createElement('canvas');
          cvs.width = cvs.height = SIZE;
          const ctx = cvs.getContext('2d');
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
          const m = window._argiraAnalyze(imgData, SIZE);
          cachedPcm = window._argiraSynthesize(m);
          cachedCx = m.centroidX;
          btn.disabled = false;
          play(cachedPcm, cachedCx);
        } catch(e) {
          btn.disabled = false;
          btn.innerHTML = '<span aria-hidden="true">🎵</span> Oír la obra';
        }
      }, 16);
    }

    btn.addEventListener('click', () => {
      if (isPlaying) { stop(); return; }
      if (!img.complete || !img.naturalWidth) {
        img.addEventListener('load', synthesizeAndPlay, { once: true });
      } else {
        synthesizeAndPlay();
      }
    });
  });
}

// ── findObjectAtPoint: busca el objeto en bounding boxes reales ──────────────
// Regex solo para colorear el panel de diagnóstico — NO modifica la lógica de selección
const _BG_REGEX_DIAG = /oc[eé]ano|mar(\s|$)|agua(\s|$)|cielo|nube|arena|campo(\s|$)|vegetaci[oó]n|paisaje|fondo|hierba|prado|playa|horizonte|suelo/i;

function normalizeBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  const result = boxes
    .map(b => ({
      label: String(b.label || '').trim(),
      x1: Number(b.x1),
      y1: Number(b.y1),
      x2: Number(b.x2),
      y2: Number(b.y2)
    }))
    .filter(b =>
      b.label &&
      Number.isFinite(b.x1) && Number.isFinite(b.y1) &&
      Number.isFinite(b.x2) && Number.isFinite(b.y2)
    )
    .map(b => ({
      ...b,
      x1: Math.max(0, Math.min(1, b.x1)),
      y1: Math.max(0, Math.min(1, b.y1)),
      x2: Math.max(0, Math.min(1, b.x2)),
      y2: Math.max(0, Math.min(1, b.y2))
    }))
    .filter(b => b.x2 > b.x1 && b.y2 > b.y1);
  return result;
}

function findObjectAtPoint(px, py, canvasW, canvasH, objects) {
  const boxes = normalizeBoxes(objects);
  if (!boxes.length) return null;

  function isFondo(obj) {
    const w = obj.x2 - obj.x1;
    const h = obj.y2 - obj.y1;
    const area = w * h;
    if (area > 0.50) return true;
    if (area > 0.30 && _BG_REGEX_DIAG.test(obj.label)) return true;
    if (w > 0.95 && h > 0.40) return true;
    return false;
  }

  // --- Paso 1: hit test con shrink del 3% — elegir caja más pequeña ---
  const SHRINK = 0.03;
  let best = null, bestArea = Infinity;
  for (const obj of boxes) {
    if (isFondo(obj)) continue;
    const w = obj.x2 - obj.x1;
    const h = obj.y2 - obj.y1;
    const sx = w * SHRINK;
    const sy = h * SHRINK;
    const x1 = (obj.x1 + sx) * canvasW;
    const y1 = (obj.y1 + sy) * canvasH;
    const x2 = (obj.x2 - sx) * canvasW;
    const y2 = (obj.y2 - sy) * canvasH;
    if (x2 <= x1 || y2 <= y1) continue;
    if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
      const area = (x2 - x1) * (y2 - y1);
      if (area < bestArea) { bestArea = area; best = obj; }
    }
  }

  // --- Paso 2: fallback por proximidad (radio proporcional al canvas) ---
  // Cuando canvasW=1 las coordenadas son normalizadas — radio pequeño para no solapar objetos
  if (!best) {
    const RADIUS_PX = canvasW <= 1
      ? 0.03
      : Math.max(30, Math.round(canvasW * 0.10));
    let bestDist = RADIUS_PX;
    for (const obj of boxes) {
      if (isFondo(obj)) continue;
      const bx1 = obj.x1 * canvasW, by1 = obj.y1 * canvasH;
      const bx2 = obj.x2 * canvasW, by2 = obj.y2 * canvasH;
      const dx = Math.max(bx1 - px, 0, px - bx2);
      const dy = Math.max(by1 - py, 0, py - by2);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) { bestDist = dist; best = obj; }
    }
    if (best) {
    }
  }
  return best ? best.label : null;
}

function initGalleryTouch() {
  const cards = document.querySelectorAll('#galeria .card');
  cards.forEach(card => {
    const img = card.querySelector('.card-image');
    const artistEl = card.querySelector('.card-artist');
    const workEl = card.querySelector('.card-work');
    if (!img || !artistEl || !workEl) return;

    const titulo = workEl.textContent.trim();
    const artista = artistEl.textContent.trim();
    const anuncio = titulo + ', ' + artista;
    const SIZE = 1024;
    const tc = document.createElement('canvas');
    // El tamaño interno del canvas se ajusta al aspect ratio real de la imagen
    // en prime(), una vez que naturalWidth/naturalHeight están disponibles.
    // Hasta entonces usamos cuadrado como fallback.
    tc.width = SIZE; tc.height = SIZE;
    tc.setAttribute('aria-label', 'Toca la imagen para oír posición y color · ' + titulo);
    tc.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;z-index:2;border-radius:inherit;';

    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid #fff;pointer-events:none;transform:translate(-50%,-50%);display:none;z-index:3;box-shadow:0 0 6px rgba(0,0,0,0.7);';
    let dotTimer = null;
    const colorLabel = document.createElement('div');
    colorLabel.className = 'argira-color-label';
    colorLabel.style.cssText = 'text-align:center;margin-top:6px;font-family:"IBM Plex Mono",monospace;font-size:0.8rem;color:var(--gold);min-height:18px;';

    const hint = document.createElement('p');
    hint.textContent = '👆 Toca la imagen para oír posición y color';
    hint.style.cssText = 'font-size:0.72rem;color:var(--text-dim);text-align:center;font-family:"Cinzel",serif;letter-spacing:0.1em;text-transform:uppercase;margin:4px 0 0;';
    const hintHeadphones = document.createElement('p');
    hintHeadphones.textContent = '🎧 Usa auriculares para oír la posición espacial del color';
    hintHeadphones.style.cssText = 'font-size:0.68rem;color:var(--text-dim);text-align:center;font-family:"Cinzel",serif;letter-spacing:0.08em;text-transform:uppercase;margin:2px 0 0;opacity:0.7;';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:block;line-height:0;overflow:hidden;width:100%;';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    wrap.appendChild(tc);
    wrap.appendChild(dot);
    // Sincronizar altura del wrap con la imagen real para que tc no se expanda más allá
    function syncWrapHeight() {
      if (img.naturalHeight > 0) {
        const ratio = img.naturalWidth / img.naturalHeight;
        wrap.style.height = (wrap.offsetWidth / ratio) + 'px';
      }
    }
    if (img.complete && img.naturalWidth > 0) syncWrapHeight();
    else img.addEventListener('load', syncWrapHeight);
    window.addEventListener('resize', syncWrapHeight);
    wrap.after(colorLabel);
    colorLabel.after(hintHeadphones);
    wrap.after(hint);

    const PROXY_URL = 'https://soft-star-11dd.argira2030.workers.dev/analyze';
    let objectMap = null, objectMapSent = false, objectMapFetched = false;
    function fetchObjectMap() {
      if (objectMapSent) return;
      // Si la imagen no esta cargada todavia, esperar y reintentar
      if (!img.complete || !img.naturalWidth) {
        img.addEventListener('load', function onLoad() {
          img.removeEventListener('load', onLoad);
          fetchObjectMap();
        });
        return;
      }
      objectMapSent = true;
      try {
        const tmpCanvas = document.createElement('canvas');
        const _ratio = img.naturalWidth / img.naturalHeight;
        tmpCanvas.width = _ratio >= 1 ? 512 : Math.round(512 * _ratio);
        tmpCanvas.height = _ratio >= 1 ? Math.round(512 / _ratio) : 512;
        tmpCanvas.getContext('2d').drawImage(img, 0, 0, tmpCanvas.width, tmpCanvas.height);
        const base64 = tmpCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        const _ctrl1 = new AbortController();
        const _tid1 = setTimeout(() => _ctrl1.abort(), 10000);
        fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mediaType: 'image/jpeg' }),
          signal: _ctrl1.signal
        }).then(r => r.json()).then(data => {
          clearTimeout(_tid1);
          if (data && data.disabled) {
            objectMap = null;
            card._argiraObjectMap = null;
            card._argiraMapFetched = true;
            if (window.ArgiraSpeech) window.ArgiraSpeech.speak('Servicio pausado hasta el lunes.', { rate: 0.92 });
            return;
          }
          objectMap = data;
          card._argiraObjectMap = data;
          card._argiraMapFetched = true;
        }).catch((err) => {
          clearTimeout(_tid1);
          objectMap = null;
          card._argiraMapFetched = true; // marcar como resuelto aunque haya fallado
          console.warn('[Argira] fetchObjectMap error:', err);
        });
      } catch(e) {
        objectMap = null;
        card._argiraMapFetched = true;
        console.warn('[Argira] fetchObjectMap catch externo:', e, 'img.naturalWidth:', img ? img.naturalWidth : 'null');
      }
    }
    card._argiraFetchObjectMap = fetchObjectMap;
    card._argiraResetObjectMap = () => { objectMapSent = false; card._argiraMapFetched = false; card._argiraObjectMap = null; };

    function posToKey(rowPos, colPos) {
      const r = rowPos === 'arriba' ? 'arriba' : rowPos === 'abajo' ? 'abajo' : 'centro';
      const c = colPos === 'izquierda' ? 'izquierda' : colPos === 'derecha' ? 'derecha' : 'centro';
      if (r === 'centro' && c === 'centro') return 'centro';
      if (r === 'centro') return `centro_${c}`;
      if (c === 'centro') return `${r}_centro`;
      return `${r}_${c}`;
    }

    let primed = false, firstTouch = true;
    let centroid = { cx: 0.5, cy: 0.5 };
    function computeChromaticCentroid(ctx2d) {
      const STEP = 4;
      const W = tc.width, H = tc.height;
      let xSum = 0, ySum = 0, wSum = 0;
      try {
        const data = ctx2d.getImageData(0, 0, W, H).data;
        for (let row = 0; row < H; row += STEP) {
          for (let col = 0; col < W; col += STEP) {
            const i = (row * W + col) * 4;
            const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
            const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
            const sat = max > 0 ? d/max : 0;
            if (sat < 0.08) continue;
            xSum += col * sat; ySum += row * sat; wSum += sat;
          }
        }
      } catch(e) { return; }
      if (wSum > 0) { centroid.cx = xSum / wSum / W; centroid.cy = ySum / wSum / H; }
    }

    function prime() {
      if (primed) return;
      primed = true;
      // Ajustar resolución interna del canvas al aspect ratio real de la imagen
      const aspect = img.naturalWidth / img.naturalHeight;
      if (aspect >= 1) {
        tc.width  = SIZE;
        tc.height = Math.round(SIZE / aspect);
      } else {
        tc.height = SIZE;
        tc.width  = Math.round(SIZE * aspect);
      }
      const ctx = tc.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, tc.width, tc.height);
      setTimeout(() => computeChromaticCentroid(ctx), 150);
    }
    if (img.complete && img.naturalWidth > 0) prime();
    else img.addEventListener('load', prime);

    function handleGalleryTouch(e) {
      prime();
      fetchObjectMap();

      // El canvas tc tiene resolución interna fija SIZE×SIZE con la imagen dibujada.
      // NO tocar tc.width/tc.height — resetear el contexto destruiría los píxeles.
      // Solo escalamos coordenadas del toque al espacio SIZE×SIZE.

      const rect = tc.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const scaleX = tc.width  / rect.width;
      const scaleY = tc.height / rect.height;
      const px = Math.round((clientX - rect.left) * scaleX);
      const py = Math.round((clientY - rect.top)  * scaleY);
      if (px < 0 || px >= tc.width || py < 0 || py >= tc.height) return;

      const ctx = tc.getContext('2d');
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      const r = pixel[0]/255, g = pixel[1]/255, b = pixel[2]/255;
      const [h, s, v] = rgbToHsv(r,g,b);

      dot.style.left = (clientX - rect.left) + 'px';
      dot.style.top  = (clientY - rect.top)  + 'px';
      dot.style.background = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
      dot.style.display = 'block';
      if (dotTimer) clearTimeout(dotTimer);
      dotTimer = setTimeout(() => { dot.style.display = 'none'; }, 1100);

      const nombre = window._argiraHueToName(h,s,v);
      const freq = Math.round(200 + h * 800);
      const _panSide = centroid.cx < 0.40 ? 'a la izquierda' : centroid.cx > 0.60 ? 'a la derecha' : 'al centro';
      const panArrow = `el color se concentra ${_panSide}`;
      const _colorLabelBase = `${nombre}  ·  ${freq} Hz  ·  ${panArrow}`;
      colorLabel.textContent = _colorLabelBase;

      const relX = px / tc.width, relY = py / tc.height;
      const colPos = relX < 0.33 ? 'izquierda' : relX < 0.66 ? 'centro' : 'derecha';
      const rowPos = relY < 0.33 ? 'arriba' : relY < 0.66 ? 'centro' : 'abajo';
      const posicion = (rowPos === 'centro' && colPos === 'centro') ? 'centro' : rowPos === 'centro' ? colPos : colPos === 'centro' ? rowPos : `${rowPos} ${colPos}`;

      window.ArgiraAudio.resume().then(function(audioCtx) {
        try {
          const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
          osc.type = s < 0.12 ? 'sine' : 'triangle';
          osc.frequency.value = 200 + h * 800;
          gain.gain.setValueAtTime(0.15 + s * 0.55, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.32);
          osc.connect(gain);
          if (audioCtx.createStereoPanner) {
            const panner = audioCtx.createStereoPanner();
            const CX_MIN = 0.38, CX_MAX = 0.65;
            const panNorm = (centroid.cx - CX_MIN) / (CX_MAX - CX_MIN);
            panner.pan.value = Math.max(-1, Math.min(1, panNorm * 2 - 1));
            gain.connect(panner);
            panner.connect(audioCtx.destination);
          } else {
            gain.connect(audioCtx.destination);
          }
          osc.start();
          osc.stop(audioCtx.currentTime + 0.32);
          // Haptica — Ley del Umbral v*
          const _hueStd = parseFloat(card.dataset.argiraHueStd || '0.15');
          const _Dv = parseFloat(card.dataset.argiraDv || '1.5');
          emularTexturaHaptica(_hueStd, _Dv);
        } catch(e) {}
      }).catch(function() {});

      // Esperar a que objectMap este disponible (max 12s) antes de hablar el objeto
      const _speakWithObject = () => {
        const objeto = findObjectAtPoint(px, py, tc.width, tc.height,
          Array.isArray(objectMap) ? objectMap : null);
        if (firstTouch) {
          firstTouch = false;
          window.ArgiraSpeech.speak(anuncio, { rate: 1.0 });
          const estimado = Math.max(6000, anuncio.length * 100);
          setTimeout(() => {
            const texto2 = objeto ? `${posicion}, ${nombre}, ${freq} hercios, ${panArrow}, ${objeto}` : `${posicion}, ${nombre}, ${freq} hercios, ${panArrow}`;
            window.ArgiraSpeech.speak(texto2, { rate: 0.92 });
          }, estimado);
        } else {
          const texto = objeto ? `${posicion}, ${nombre}, ${freq} hercios, ${panArrow}, ${objeto}` : `${posicion}, ${nombre}, ${freq} hercios, ${panArrow}`;
          window.ArgiraSpeech.speak(texto, { rate: 0.92 });
        }
      };
      if (Array.isArray(objectMap) || card._argiraMapFetched) {
        setTimeout(() => {
          _speakWithObject();
          const _obj = findObjectAtPoint(px, py, tc.width, tc.height, Array.isArray(objectMap) ? objectMap : null);
          if (_obj) colorLabel.textContent = _colorLabelBase + '  ·  ' + _obj;
        }, 300);
      } else {
        // objectMap aun no ha llegado: hablar sin objeto ahora, y cuando llegue hablar solo el objeto
        setTimeout(() => {
          const textoBase = firstTouch
            ? (firstTouch = false, window.ArgiraSpeech.speak(anuncio, { rate: 1.0 }), null)
            : `${posicion}, ${nombre}, ${freq} hercios, ${panArrow}`;
          if (textoBase) window.ArgiraSpeech.speak(textoBase, { rate: 0.92 });
        }, 300);
        const _waitMap = setInterval(() => {
          if (Array.isArray(objectMap) || card._argiraMapFetched) {
            clearInterval(_waitMap);
            const objeto = findObjectAtPoint(px, py, tc.width, tc.height,
              Array.isArray(objectMap) ? objectMap : null);
            if (objeto) {
              window.ArgiraSpeech.speak(objeto, { rate: 0.92 });
              colorLabel.textContent = _colorLabelBase + '  ·  ' + objeto;
            }
          }
        }, 200);
        setTimeout(() => clearInterval(_waitMap), 12000);
      }
    }

    let touchMode = 'tap';

    const modeBar = document.createElement('div');
    modeBar.style.cssText = 'display:flex;gap:6px;margin:8px 0 2px;justify-content:center;flex-wrap:wrap;';
    modeBar.innerHTML = `
      <button class="argira-mode-btn argira-mode-active" data-mode="tap">👆 Tocar</button>
      <button class="argira-mode-btn" data-mode="sweep">🖐 Barrido</button>
      <button class="argira-mode-btn" data-mode="braille">🦯 Braille</button>`;

    const modeStatus = document.createElement('p');
    modeStatus.style.cssText = 'font-size:0.68rem;color:var(--text-dim);text-align:center;font-family:"Cinzel",serif;letter-spacing:0.1em;margin:2px 0 0;';
    modeStatus.textContent = '✓ Scroll libre';

    const MODE_INFO = {
      tap:    { status: '✓ Scroll libre',     announce: 'Modo tocar. Scroll libre. Toca la imagen para oír posición y color.' },
      sweep:  { status: '🔒 Scroll bloqueado', announce: 'Modo barrido activado. Scroll bloqueado. Desliza para explorar tonos.' },
      braille:{ status: '🔒 Scroll bloqueado', announce: 'Modo braille activado. Scroll bloqueado. Desliza despacio, oirás posición y descripción de cada zona.' }
    };

    wrap.after(modeBar);
    modeBar.after(modeStatus);
    modeBar.querySelectorAll('.argira-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        touchMode = btn.dataset.mode;
        modeBar.querySelectorAll('.argira-mode-btn').forEach(b => b.classList.toggle('argira-mode-active', b === btn));
        const info = MODE_INFO[touchMode];
        modeStatus.textContent = info.status;
        if (liveRegion) { liveRegion.textContent = ''; setTimeout(() => { liveRegion.textContent = info.announce; }, 50); }
        fetchObjectMap();
      });
    });

    let _isTouchDevice = false;
    let _lastHandleT = 0, THROTTLE_MS = 120;
    let _touchStartY = 0;
    let _brailleBlocked = false;

    function throttledHandle(e) {
      const now = Date.now();
      if (now - _lastHandleT < THROTTLE_MS) return;
      _lastHandleT = now;
      handleGalleryTouch(e);
    }

    async function brailleHandle(e) {
      if (_brailleBlocked) return;
      _brailleBlocked = true;
      handleGalleryTouch(e);
      await new Promise(r => {
        const deadline = setTimeout(r, 10000);
        const poll = setInterval(() => {
          if (!window.ArgiraSpeech.speaking && !window.ArgiraSpeech._transitioning) { clearInterval(poll); clearTimeout(deadline); r(); }
        }, 80);
      });
      await new Promise(r => setTimeout(r, 300));
      _brailleBlocked = false;
    }

    tc.addEventListener('click', e => { if (!_isTouchDevice) handleGalleryTouch(e); });
    tc.addEventListener('mousedown', e => {
      if (_isTouchDevice) return;
      fetchObjectMap();
      handleGalleryTouch(e);
      function onMove(ev) { throttledHandle(ev); }
      function onUp() { tc.removeEventListener('mousemove', onMove); }
      tc.addEventListener('mousemove', onMove);
      tc.addEventListener('mouseup', onUp, { once: true });
      tc.addEventListener('mouseleave', onUp, { once: true });
    });

    tc.addEventListener('touchstart', e => {
      _isTouchDevice = true;
      _touchStartY = e.touches[0].clientY;
      try { window.ArgiraAudio.resume(); } catch(e) {}
      fetchObjectMap();
    }, { passive: true });

    tc.addEventListener('touchend', e => {
      if (touchMode !== 'tap') return;
      const dy = Math.abs(e.changedTouches[0].clientY - _touchStartY);
      if (dy > 10) return;
      const t = e.changedTouches[0];
      handleGalleryTouch({ preventDefault:()=>{}, cancelable:false, touches:[{clientX:t.clientX,clientY:t.clientY}], clientX:t.clientX, clientY:t.clientY });
    });

    tc.addEventListener('touchmove', e => {
      if (touchMode === 'tap') return;
      e.preventDefault();
      const t = e.touches[0];
      const ev = { preventDefault:()=>{}, cancelable:false, touches:[{clientX:t.clientX,clientY:t.clientY}], clientX:t.clientX, clientY:t.clientY };
      if (touchMode === 'sweep') throttledHandle(ev);
      else if (touchMode === 'braille') brailleHandle(ev);
    }, { passive: false });

    // Prefetch serializado — una petición a la vez para no agotar el límite de concurrencia.
    // La cola global garantiza que aunque todas las cards entren en pantalla a la vez,
    // las llamadas a Anthropic se encadenan en lugar de lanzarse en paralelo.
    if ('IntersectionObserver' in window) {
      const _prefetchObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            _prefetchObserver.unobserve(card);
            const doFetch = () => {
              if (img.complete && img.naturalWidth > 0) {
                fetchObjectMap();
              } else {
                img.addEventListener('load', () => fetchObjectMap(), { once: true });
              }
            };
            // Encolar — esperar a que la anterior termine antes de lanzar la siguiente
            window._argiraFetchQueue = (window._argiraFetchQueue || Promise.resolve())
              .then(() => new Promise(resolve => {
                // Pequeño retardo entre peticiones para no saturar
                setTimeout(() => { doFetch(); resolve(); }, 300);
              }));
          }
        });
      }, { rootMargin: '200px' });
      _prefetchObserver.observe(card);
    }
  });
}

// ========== Ley del Umbral de Argira — haptica móvil ==========
function obtenerUmbralHaptico(hue_std) {
  const k = 7800, m = 12500;
  return Math.max(4000, Math.min(k - m * hue_std, 8000));
}
function emularTexturaHaptica(hue_std, Dv) {
  if (!('vibrate' in navigator)) return;
  const v_critico = obtenerUmbralHaptico(hue_std);
  if (v_critico < 5500) {
    const tiempoPulso = Math.max(5, Math.round((2.0 - Dv) * 30));
    navigator.vibrate([tiempoPulso, 15, tiempoPulso, 15]);
  } else {
    navigator.vibrate(40);
  }
}

function initGalleryAudioPan() {
  const cards = Array.from(document.querySelectorAll('#galeria .card'));
  function calcCentroids(img) {
    const SIZE = 64;
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = SIZE;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const N = SIZE*SIZE, NZONES = 13, NBINS = 12;
    const cx0 = (SIZE-1)/2, cy0 = (SIZE-1)/2;
    const R_CTR = (SIZE/2)*0.25;
    const zSumH = new Float64Array(NZONES), zSumH2 = new Float64Array(NZONES);
    const zCnt = new Int32Array(NZONES);
    const zHist = new Uint32Array(NZONES*NBINS);
    for (let i=0; i<N; i++) {
      const r=data[i*4]/255, g=data[i*4+1]/255, b=data[i*4+2]/255;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
      const s=mx>0?d/mx:0;
      let h=0;
      if (d>0) {
        if (mx===r) h=((g-b)/d+6)%6;
        else if (mx===g) h=(b-r)/d+2;
        else h=(r-g)/d+4;
        h/=6;
      }
      const col=i%SIZE, row=Math.floor(i/SIZE);
      const dx=col-cx0, dy=row-cy0;
      const radius=Math.sqrt(dx*dx+dy*dy);
      let zi;
      if (radius<R_CTR) zi=12;
      else { const angle=((Math.atan2(dy,dx)+Math.PI/2)%(2*Math.PI)+2*Math.PI)%(2*Math.PI); zi=Math.min(11, Math.floor(angle/(2*Math.PI)*12)); }
      zSumH[zi]+=h; zSumH2[zi]+=h*h; zCnt[zi]++;
      if (s<0.08) continue;
      zHist[zi*NBINS + Math.min(NBINS-1, Math.floor(h*NBINS))]++;
    }
    const zStd = Array.from({length:NZONES},(_,i)=>{ const n=zCnt[i]; if(!n) return 0; const mean=zSumH[i]/n; return Math.sqrt(Math.max(0, zSumH2[i]/n - mean*mean)); });
    const zMax = Math.max(...zStd, 0.001);
    const zNorm = zStd.map(v=>v/zMax);
    const zoneModeH = Array.from({length:NZONES},(_,zi)=>{ let maxBin=0, maxCount=0; for(let b=0;b<NBINS;b++){ const c=zHist[zi*NBINS+b]; if(c>maxCount){maxCount=c;maxBin=b;}} return maxCount===0?-1:(maxBin+0.5)/NBINS; });
    let sumX=0, sumY=0, total=0;
    for (let i=0;i<N;i++) {
      const s = (data[i*4+1]/255);
      if (s<0.08) continue;
      const col=i%SIZE, row=Math.floor(i/SIZE);
      const w=s*s;
      sumX+=col*w; sumY+=row*w; total+=w;
    }
    return { cx: total>0?sumX/total/(SIZE-1):0.5, cy: total>0?sumY/total/(SIZE-1):0.5, zNorm, zoneModeH };
  }
  function applyPanToAudio(audioEl, cx, cy) {
    try {
      const audioCtx = window.ArgiraAudio.get();
      if (!audioCtx || !audioCtx.createStereoPanner) return;
      if (audioEl._argiraPanApplied) return;
      audioEl._argiraPanApplied = true;
      const src = audioCtx.createMediaElementSource(audioEl);
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, (cx-0.5)*2));
      src.connect(panner);
      panner.connect(audioCtx.destination);
      audioEl.dataset.argiraPan = cx.toFixed(3);
      const yFactor = 1.25 - cy*0.50;
      audioEl.playbackRate = Math.max(0.5, Math.min(2.0, yFactor));
      audioEl.dataset.argiraPlaybackRate = yFactor.toFixed(3);
    } catch(e) {}
  }
  function processCard(idx) {
    if (idx>=cards.length) return;
    const card = cards[idx];
    const img = card.querySelector('.card-image');
    const audioEl = card.querySelector('audio');
    if (!img || !audioEl) { setTimeout(()=>processCard(idx+1),10); return; }
    function doCalc() {
      try {
        const {cx, cy, zNorm, zoneModeH} = calcCentroids(img);
        applyPanToAudio(audioEl, cx, cy);
        audioEl.dataset.argiraCx = cx.toFixed(3);
        audioEl.dataset.argiraCy = cy.toFixed(3);
        card.dataset.argiraCx = cx.toFixed(3);
        card.dataset.argiraCy = cy.toFixed(3);
        card.dataset.argiraClockZones = zNorm.map(v=>v.toFixed(4)).join(',');
        card.dataset.argiraClockHues = zoneModeH.map(v=>v.toFixed(4)).join(',');
        // Ley del Umbral — datos para haptica
        const hueStdCard = parseFloat(card.dataset.argiraHueStd || '0');
        if (!hueStdCard) {
          // Calcular hue_std desde la imagen si no está en dataset
          const SIZE64 = 64;
          const cvsTmp = document.createElement('canvas');
          cvsTmp.width = cvsTmp.height = SIZE64;
          cvsTmp.getContext('2d').drawImage(img, 0, 0, SIZE64, SIZE64);
          const mTmp = window._argiraAnalyze(cvsTmp.getContext('2d').getImageData(0, 0, SIZE64, SIZE64), SIZE64);
          card.dataset.argiraHueStd = mTmp.hueStd.toFixed(4);
          card.dataset.argiraDv = mTmp.fractalD.toFixed(4);
        }
      } catch(e) {}
      setTimeout(()=>processCard(idx+1), 120);
    }
    if (img.complete && img.naturalWidth>0) doCalc();
    else { img.addEventListener('load', doCalc, {once:true}); setTimeout(()=>processCard(idx+1),120); }
  }
  setTimeout(()=>processCard(0), 800);
}

function initRoughnessWidgets() {
  const ROUGHNESS = {
    'White_on_White_(Malevich,_1918).png':0, 'Malevich_Cuadrado_Negro_1915.jpg':9,
    'goya-saturno.jpg':18, '500px-Rembrandt_van_Rijn_-_Self-Portrait_-_Google_Art_Project.jpg':33,
    'EdwardHopperMorningSun1952.jpg':43, 'Johannes_Vermeer_-_Het_melkmeisje_-_Google_Art_Project.png':53,
    'Dalí,_Perfil_del_tiempo,_Vroclavo,_7.jpeg':61, 'Paul_Cézanne_-_Montagne_Saint-victoire_-_Google_Art_Project.jpg':76,
    'Claude_Monet_-_Cliff_Walk_at_Pourville_-_Google_Art_Project.jpg':79, 'Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg':85,
    'Edgar_Germain_Hilaire_Degas_076.jpg':88, 'field-of-poppies.jpg!Large.jpg':92, '1280px-Korenveld_met_kraaien_-_s0149V1962_-_Van_Gogh_Museum.jpg':95,
    'este.jpg':96, 'La_Desserte_rouge,_par_Henri_Matisse.jpg':97, '3840px-Kandinsky_-_Jaune_Rouge_Bleu.jpg':99
  };
  function roughnessLabel(pct) { if(pct<=8) return 'liso'; if(pct<=25) return 'muy suave'; if(pct<=45) return 'suave'; if(pct<=60) return 'medio'; if(pct<=75) return 'rugoso'; if(pct<=88) return 'áspero'; if(pct<=95) return 'muy áspero'; return 'máximo'; }
  function roughnessBar(pct) { const filled=Math.round(pct/100*8); return '█'.repeat(filled)+'░'.repeat(8-filled); }
  function roughnessColor(pct) { const hue=Math.round(120-pct*1.2); return `hsl(${hue},70%,55%)`; }
  const cards = document.querySelectorAll('#galeria .card');
  cards.forEach(card => {
    const img = card.querySelector('.card-image');
    if(!img) return;
    const src = img.getAttribute('src');
    const pct = (src in ROUGHNESS) ? ROUGHNESS[src] : null;
    if(pct===null) return;
    const rWrap = document.createElement('div');
    rWrap.className = 'argira-roughness-widget';
    rWrap.setAttribute('aria-label', `Rugosidad espectral: ${pct}% — ${roughnessLabel(pct)}`);
    rWrap.style.cssText = 'margin:6px 0 2px;font-family:"IBM Plex Mono",monospace;font-size:0.75rem;text-align:center;line-height:1.5;';
    const rBar = document.createElement('div');
    rBar.style.cssText = `color:${roughnessColor(pct)};letter-spacing:0.04em;`;
    rBar.textContent = `rugosidad ${roughnessBar(pct)} ${pct}%`;
    const rText = document.createElement('div');
    rText.style.cssText = 'color:rgba(168,158,136,0.65);font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;';
    rText.textContent = `${roughnessLabel(pct)} · emergent spectral roughness`;
    rWrap.appendChild(rBar); rWrap.appendChild(rText);
    const colorLabelEl = card.querySelector('.argira-color-label');
    if(colorLabelEl) colorLabelEl.after(rWrap);
    else { const cardBody = card.querySelector('.card-body'); const speakBtn = card.querySelector('.speak-btn'); if(cardBody && speakBtn) cardBody.insertBefore(rWrap, speakBtn); }
    card.dataset.argiraRoughness = pct;
    const narrBtn = document.createElement('button');
    narrBtn.type = 'button'; narrBtn.className = 'argira-spatial-btn';
    narrBtn.setAttribute('aria-label', 'Escuchar descripción de la estructura espacial del color');
    narrBtn.innerHTML = '<span aria-hidden="true">🦯</span> Estructura espacial';
    const cardTagsEl = card.querySelector('.card-tags');
    const speakBtnEl = card.querySelector('.speak-btn');
    if(speakBtnEl) speakBtnEl.after(narrBtn);
    else card.querySelector('.card-body').appendChild(narrBtn);
    narrBtn.addEventListener('click', function() {
      const trySpeak = (attempt) => {
        const zonesRaw = card.dataset.argiraClockZones;
        const huesRaw = card.dataset.argiraClockHues;
        const cx = parseFloat(card.dataset.argiraCx) || 0.5;
        const cy = parseFloat(card.dataset.argiraCy) || 0.5;
        if (!zonesRaw && attempt<15) { setTimeout(()=>trySpeak(attempt+1),200); return; }
        function hueToColorName(h) { if(h<0) return null; if(window._argiraHueToName) return window._argiraHueToName(h,0.8,0.7); const deg=h*360; if(deg<15||deg>=345) return 'rojo'; if(deg<45) return 'naranja'; if(deg<70) return 'amarillo'; if(deg<150) return 'verde'; if(deg<210) return 'cian'; if(deg<270) return 'azul'; if(deg<330) return 'violeta'; return 'rosa'; }
        function clockLabel(zi) { if(zi===12) return 'el centro'; const h=zi===0?12:zi; return `las ${h} en punto`; }
        let tts;
        if(!zonesRaw) {
          const dx=cx-0.5, dy=cy-0.5;
          const angle=((Math.atan2(dy,dx)+Math.PI/2+2*Math.PI)%(2*Math.PI));
          const hora=Math.round(angle/(2*Math.PI)*12)%12;
          const horaLabel=hora===0?12:hora;
          tts = `El color principal de la obra se concentra hacia las ${horaLabel} en punto.`;
        } else {
          const Z = zonesRaw.split(',').map(Number);
          const H = huesRaw ? huesRaw.split(',').map(Number) : null;
          let mxZ=-1, mxI=0, mnZ=2, mnI=0;
          for(let i=0;i<12;i++) { if(Z[i]>mxZ) { mxZ=Z[i]; mxI=i; } if(Z[i]<mnZ) { mnZ=Z[i]; mnI=i; } }
          const colorActiva = H ? hueToColorName(H[mxI]) : null;
          const colorTranquila = H ? hueToColorName(H[mnI]) : null;
          const colorCentro = H ? hueToColorName(H[12]) : null;
          const zonaActivaStr = colorActiva ? `Zona más activa: a ${clockLabel(mxI)}, donde predomina el ${colorActiva}.` : `Zona más activa: a ${clockLabel(mxI)}.`;
          const zonaTranqStr = colorTranquila ? `Zona más uniforme: a ${clockLabel(mnI)}, donde predomina el ${colorTranquila}.` : `Zona más uniforme: a ${clockLabel(mnI)}.`;
          const centroStr = colorCentro ? `En el centro predomina el ${colorCentro}.` : '';
          const topIdx=[10,11,0,1,2], botIdx=[4,5,6,7,8];
          const topAvg=topIdx.reduce((s,i)=>s+Z[i],0)/topIdx.length;
          const botAvg=botIdx.reduce((s,i)=>s+Z[i],0)/botIdx.length;
          const leftIdx=[7,8,9,10,11], rightIdx=[1,2,3,4,5];
          const leftAvg=leftIdx.reduce((s,i)=>s+Z[i],0)/leftIdx.length;
          const rightAvg=rightIdx.reduce((s,i)=>s+Z[i],0)/rightIdx.length;
          const vT = Math.abs(topAvg-botAvg)>0.18 ? (topAvg>botAvg?'Mayor variedad en la mitad superior.':'Mayor variedad en la mitad inferior.') : '';
          const hT = Math.abs(leftAvg-rightAvg)>0.18 ? (leftAvg>rightAvg?'Mayor variedad a la izquierda.':'Mayor variedad a la derecha.') : '';
          tts = [zonaActivaStr, zonaTranqStr, centroStr, vT, hT].filter(Boolean).join(' ');
        }
        window.ArgiraSpeech.speak(tts, { rate:1.0 });
        narrBtn.setAttribute('aria-pressed','true');
        const checkEnd = setInterval(()=>{ if(!window.ArgiraSpeech.current){ clearInterval(checkEnd); clearTimeout(checkEndSafety); narrBtn.setAttribute('aria-pressed','false'); } },100);
        const checkEndSafety = setTimeout(()=>{ clearInterval(checkEnd); narrBtn.setAttribute('aria-pressed','false'); }, 30000);
      };
      trySpeak(0);
    });
  });
}

function initClockScan() {
  // ── velocidad global del tour (compartida por todas las tarjetas) ──────────
  // 0 = lento (espera voz completa + 600 ms)
  let _tourSpeed = 0;

  // ── función auxiliar: esperar a que SpeechSynthesis termine ───────────────
  // Devuelve una Promise que se resuelve cuando la voz actual termina
  // (o en maxMs si algo falla).
  // ── tarjeta por tarjeta ───────────────────────────────────────────────────
  const cards = document.querySelectorAll('#galeria .card');
  cards.forEach(card => {
    const narrBtn = card.querySelector('.argira-spatial-btn');
    if (!narrBtn) return;
    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'argira-spatial-btn argira-scan-btn';
    scanBtn.setAttribute('aria-label', 'Tour espacial automático: recorre el cuadro por zonas');
    scanBtn.setAttribute('aria-pressed', 'false');
    scanBtn.innerHTML = '<span aria-hidden="true">🖼️</span> Tour espacial';
    narrBtn.after(scanBtn);

    // token de cancelación: cada tour tiene un id único
    let _tourId = 0;
    let _aborted = false;

    function stopScan() {
      _tourId++;          // invalida cualquier tour en vuelo
      _aborted = true;
      window.ArgiraSpeech.stop();
      scanBtn.setAttribute('aria-pressed', 'false');
      scanBtn.innerHTML = '<span aria-hidden="true">🖼️</span> Tour espacial';
      scanBtn._argiraScanStop = null;
    }
    scanBtn._argiraScanStop = null;

    scanBtn.addEventListener('click', function() {
      try { window.ArgiraAudio.resume(); } catch(e) {}

      // si ya corre → parar
      if (scanBtn.getAttribute('aria-pressed') === 'true') { stopScan(); return; }

      const zonesRaw = card.dataset.argiraClockZones;
      const huesRaw  = card.dataset.argiraClockHues;

      // datos aún no listos → esperar hasta 8 s
      if (!zonesRaw) {
        let wait = 0;
        const waitInterval = setInterval(() => {
          wait += 200;
          if (card.dataset.argiraClockZones || wait >= 8000) {
            clearInterval(waitInterval);
            if (card.dataset.argiraClockZones) scanBtn.click();
          }
        }, 200);
        return;
      }

      // ── lanzar tour ──────────────────────────────────────────────────────
      _aborted = false;
      const myTourId = ++_tourId;
      scanBtn.setAttribute('aria-pressed', 'true');
      scanBtn.innerHTML = '<span aria-hidden="true">⏹</span> Detener';
      scanBtn._argiraScanStop = stopScan;

      const Z = zonesRaw.split(',').map(Number);
      const H = huesRaw ? huesRaw.split(',').map(Number) : null;

      const ETIQUETA_RELOJ = [
        'a las doce','a la una','a las dos','a las tres','a las cuatro',
        'a las cinco','a las seis','a las siete','a las ocho','a las nueve',
        'a las diez','a las once','Centro'
      ];
      const ETIQUETA_ESPACIAL = [
        'arriba centro','arriba derecha','centro derecha','centro derecha',
        'abajo derecha','abajo centro','abajo centro','abajo izquierda',
        'centro izquierda','centro izquierda','arriba izquierda','arriba izquierda',
        'centro'
      ];
      const ARGIRA_GRID_KEY_ZONA9 = [
        'arriba_centro','arriba_derecha','centro_derecha','centro_derecha','abajo_derecha',
        'abajo_centro','abajo_centro','abajo_izquierda','centro_izquierda','centro_izquierda',
        'arriba_izquierda','arriba_izquierda','centro'
      ];

      // niveles descriptivos de actividad cromática
      function actToLabel(act) {
        if (act < 0.10) return 'color uniforme';
        if (act < 0.28) return 'color casi uniforme';
        if (act < 0.50) return 'color moderado';
        if (act < 0.72) return 'color variado';
        if (act < 0.88) return 'color muy variado';
        return 'color máximamente variado';
      }

      function hueToColorName(h) {
        if (h < 0) return null;
        if (window._argiraHueToName) return window._argiraHueToName(h, 0.8, 0.7);
        const deg = h * 360;
        if (deg<15||deg>=345) return 'rojo';
        if (deg<45)  return 'naranja';
        if (deg<70)  return 'amarillo';
        if (deg<150) return 'verde';
        if (deg<210) return 'cian';
        if (deg<270) return 'azul';
        if (deg<330) return 'violeta';
        return 'rosa';
      }

      function hourToPan(zi) { return zi === 12 ? 0 : Math.sin((zi / 12) * 2 * Math.PI); }

      // sonido del tono de zona
      function playZoneTone(hue, act, pan, durSec) {
        try {
          const audioCtx = window.ArgiraAudio.resume();
          const freq = hue >= 0 ? (200 + hue * 800) : 400;
          const vol  = 0.12 + act * 0.45;
          const osc  = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(vol, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durSec);
          osc.connect(gain);
          if (audioCtx.createStereoPanner) {
            const panner = audioCtx.createStereoPanner();
            panner.pan.value = pan;
            gain.connect(panner);
            panner.connect(audioCtx.destination);
          } else { gain.connect(audioCtx.destination); }
          osc.start();
          osc.stop(audioCtx.currentTime + durSec);
        } catch(e) {}
      }

      // construir descripción completa del sector
      function buildTextoVoz(zi, objeto, colorName, act) {
        const reloj   = ETIQUETA_RELOJ[zi];
        const espacial = ETIQUETA_ESPACIAL[zi];
        const actLabel = actToLabel(act);
        const partes = [];

        // posición: combinar reloj + espacial para mayor claridad
        if (zi === 12) {
          partes.push('Centro del cuadro');
        } else {
          partes.push(espacial);
        }

        // color dominante
        if (colorName) partes.push(`tonos ${colorName}`);

        // nivel de actividad cromática
        partes.push(actLabel);

        // objeto detectado al final
        if (objeto) partes.push(objeto);

        return partes.join('. ') + '.';
      }

      const sequence = [10, 0, 1, 8, 12, 2, 7, 5, 4];

      // tour asíncrono — espera la voz entre sectores
      async function runTour() {
        for (let idx = 0; idx < sequence.length; idx++) {
          if (_aborted || _tourId !== myTourId) return;

          const zi        = sequence[idx];
          const hue       = H ? H[zi] : -1;
          const act       = Z[zi];
          const pan       = hourToPan(zi);
          const colorName = hue >= 0 ? hueToColorName(hue) : null;
          // Leer el mapa en cada sector (puede llegar del proxy mientras el tour corre)
          const _rawMap = card._argiraObjectMap || null;
          const _c = (function(zi) {
            if (zi === 12) return { nx: 0.5, ny: 0.5 };
            const angle = (zi / 12) * 2 * Math.PI - Math.PI / 2;
            const r = 0.30;
            return {
              nx: Math.max(0.05, Math.min(0.95, 0.5 + r * Math.cos(angle))),
              ny: Math.max(0.05, Math.min(0.95, 0.5 + r * Math.sin(angle)))
            };
          })(zi);
          const objeto = findObjectAtPoint(_c.nx, _c.ny, 1, 1, Array.isArray(_rawMap) ? _rawMap : null);
          const textoVoz  = buildTextoVoz(zi, objeto, colorName, act);

          // reproducir tono breve
          const toneDur = _tourSpeed === 2 ? 0.22 : 0.35;
          playZoneTone(hue, act, pan, toneDur);

          // pequeña pausa para que el tono suene antes de hablar
          await new Promise(r => setTimeout(r, _tourSpeed === 2 ? 150 : 280));
          if (_aborted || _tourId !== myTourId) return;

          // hablar descripción completa
          const speechRate = _tourSpeed === 0 ? 0.82 : _tourSpeed === 1 ? 0.92 : 1.1;
          if (liveRegion) liveRegion.textContent = textoVoz;
          if (_tourSpeed === 2) {
            window.ArgiraSpeech.speak(textoVoz, { rate: speechRate });
            await new Promise(r => setTimeout(r, 1200));
          } else {
            await window.ArgiraSpeech.speak(textoVoz, { rate: speechRate });
            if (_aborted || _tourId !== myTourId) return;
            const pausa = _tourSpeed === 0 ? 900 : 200;
            await new Promise(r => setTimeout(r, pausa));
          }
        }

        // tour completo
        if (!_aborted && _tourId === myTourId) {
          await new Promise(r => setTimeout(r, 400));
          stopScan();
        }
      }

      // esperar el mapa de objetos antes de empezar
      window.ArgiraSpeech.stop();
      if (!card._argiraObjectMap) {
        if (card._argiraResetObjectMap) card._argiraResetObjectMap();
        if (card._argiraFetchObjectMap) card._argiraFetchObjectMap();
      } else {
        card._argiraMapFetched = true;
      }

      const MAP_WAIT_MAX = 8000, MAP_POLL = 150;
      let mapWaited = 0, _vozEsperaEnviada = false;
      function startWhenReady() {
        if (_aborted || _tourId !== myTourId) return;
        // mapFetched = true cuando la petición al proxy terminó (con éxito o error)
        const mapFetched = !!card._argiraMapFetched;
        const timeout    = mapWaited >= MAP_WAIT_MAX;
        if (mapFetched || timeout) {
          runTour();
        } else {
          // Solo avisar si la espera supera 1500ms Y el mapa aún no llegó
          if (!_vozEsperaEnviada && mapWaited >= 1500) {
            _vozEsperaEnviada = true;
            window.ArgiraSpeech.speak('Analizando imagen, un momento…', { rate: 0.9 });
          }
          mapWaited += MAP_POLL;
          setTimeout(startWhenReady, MAP_POLL);
        }
      }
      startWhenReady();
    });
  });
}

// Fetch compartido del mapa de objetos — usado por initCanvasTouch e initCanvasTour.
// Devuelve Promise<data|null>. Un solo fetch por imagen subida.
// Usa sessionStorage como caché: la misma imagen no vuelve a enviarse a Anthropic
// mientras dure la sesión del navegador.
async function fetchSharedObjectMap(imageElement) {
  const PROXY_URL = 'https://soft-star-11dd.argira2030.workers.dev/analyze';
  try {
    const tmpCanvas = document.createElement('canvas');
    const _ratio = imageElement.naturalWidth / imageElement.naturalHeight;
    tmpCanvas.width  = _ratio >= 1 ? 512 : Math.round(512 * _ratio);
    tmpCanvas.height = _ratio >= 1 ? Math.round(512 / _ratio) : 512;
    tmpCanvas.getContext('2d').drawImage(imageElement, 0, 0, tmpCanvas.width, tmpCanvas.height);
    const base64 = tmpCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    // Caché: clave = primeros 64 chars del base64 (suficiente para distinguir imágenes)
    const _cacheKey = 'argira_map_' + base64.substring(0, 64);
    try {
      const _cached = sessionStorage.getItem(_cacheKey);
      if (_cached) {
        return JSON.parse(_cached);
      }
    } catch(e) {}

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10000);
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64, mediaType: 'image/jpeg' }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    const data = await response.json();
    if (data && data.disabled) {
      if (window.ArgiraSpeech) window.ArgiraSpeech.speak('Servicio pausado hasta el lunes.', { rate: 0.92 });
      return null;
    }

    // Guardar en caché solo si hay datos válidos
    try {
      if (data && Array.isArray(data) && data.length) {
        sessionStorage.setItem(_cacheKey, JSON.stringify(data));
      }
    } catch(e) {}

    return data;
  } catch(e) {
    console.warn('[Argira] fetchSharedObjectMap error:', e);
    return null;
  }
}

function initCanvasTouch() {
  const tuPanel = document.getElementById('tu-panel');
  if (!tuPanel) return;
  const touchCanvas = document.createElement('canvas');
  touchCanvas.id = 'tu-touch-canvas';
  touchCanvas.setAttribute('aria-label', 'Toca cualquier punto de la imagen para oír su color');
  touchCanvas.style.cssText = 'display:none;width:100%;max-width:512px;height:auto;cursor:crosshair;border-radius:4px;border:1px solid rgba(232,201,106,0.25);margin:16px auto 0;position:relative;';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute;width:18px;height:18px;border-radius:50%;border:2px solid #fff;pointer-events:none;transform:translate(-50%,-50%);display:none;z-index:10;box-shadow:0 0 6px rgba(0,0,0,0.7);';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:none;max-width:512px;margin:16px auto 0;';
  wrap.appendChild(touchCanvas); wrap.appendChild(dot);
  const hint = document.createElement('p');
  hint.textContent = '👆 Toca la imagen para oír el color de ese punto';
  hint.style.cssText = 'font-size:0.72rem;color:var(--text-dim);text-align:center;font-family:"Cinzel",serif;letter-spacing:0.1em;text-transform:uppercase;margin:6px 0 0;display:none;';
  const colorLabel = document.createElement('div');
  colorLabel.style.cssText = 'display:none;text-align:center;margin-top:8px;font-family:"IBM Plex Mono",monospace;font-size:0.85rem;color:var(--gold);min-height:22px;';
  tuPanel.insertBefore(wrap, tuPanel.firstChild);
  wrap.after(hint); hint.after(colorLabel);

  let objectMap = null;

  function posToKey(rowPos, colPos) {
    const r = rowPos === 'arriba' ? 'arriba' : rowPos === 'abajo' ? 'abajo' : 'centro';
    const c = colPos === 'izquierda' ? 'izquierda' : colPos === 'derecha' ? 'derecha' : 'centro';
    if (r === 'centro' && c === 'centro') return 'centro';
    if (r === 'centro') return `centro_${c}`;
    if (c === 'centro') return `${r}_centro`;
    return `${r}_${c}`;
  }

  if (!window._argiraTouchInitId) window._argiraTouchInitId = 0;
  window._argiraTouchInit = function(imageElement) {
    const SIZE = 1024;
    const _ratio = imageElement.naturalWidth / imageElement.naturalHeight;
    touchCanvas.width  = _ratio >= 1 ? SIZE : Math.round(SIZE * _ratio);
    touchCanvas.height = _ratio >= 1 ? Math.round(SIZE / _ratio) : SIZE;
    const ctx = touchCanvas.getContext('2d');
    ctx.drawImage(imageElement, 0, 0, touchCanvas.width, touchCanvas.height);
    touchCanvas.style.display = 'block';
    wrap.style.display = 'block';
    hint.style.display = 'block';
    colorLabel.style.display = 'block';
    objectMap = null;

    // Capturar el ID de esta imagen para evitar que una Promise anterior
    // sobreescriba objectMap cuando ya se ha subido una imagen nueva.
    const _thisInitId = ++window._argiraTouchInitId;
    (window._argiraTourMapPromise || Promise.resolve(null)).then(data => {
      if (_thisInitId === window._argiraTouchInitId) {
        objectMap = data;
      }
    });
  };

  function playColorTone(h, s, v) {
    window.ArgiraAudio.resume().then(function(audioCtx) {
      try {
        const freq = 200 + h * 800;
        const volume = 0.15 + s * 0.55;
        const dur = 0.32;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = s < 0.12 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
      } catch(e) {}
    }).catch(function() {});
  }

  function handleTouch(e) {
    const rect = touchCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // === Corrección de coordenadas para object-fit:contain ===
    const imgW = touchCanvas.width, imgH = touchCanvas.height;
    const imgAspect = imgW / imgH;
    const boxAspect = rect.width / rect.height;
    let drawWidth, drawHeight, offsetX, offsetY;
    if (imgAspect > boxAspect) {
      drawWidth  = rect.width;
      drawHeight = rect.width / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - drawHeight) / 2;
    } else {
      drawHeight = rect.height;
      drawWidth  = rect.height * imgAspect;
      offsetX = (rect.width - drawWidth) / 2;
      offsetY = 0;
    }

    const x = clientX - rect.left - offsetX;
    const y = clientY - rect.top  - offsetY;
    if (x < 0 || x > drawWidth || y < 0 || y > drawHeight) return;

    const px = Math.round(x / drawWidth  * imgW);
    const py = Math.round(y / drawHeight * imgH);
    if (px < 0 || px >= imgW || py < 0 || py >= imgH) return;

    const ctx = touchCanvas.getContext('2d');
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const r = pixel[0]/255, g = pixel[1]/255, b = pixel[2]/255;
    const [h,s,v] = rgbToHsv(r,g,b);
    const nombre = window._argiraHueToName(h,s,v);
    const freqMostrar = Math.round(200 + h * 800);
    colorLabel.textContent = `${nombre}  ·  ${freqMostrar} Hz`;
    dot.style.left = (x + offsetX) + 'px';
    dot.style.top  = (y + offsetY) + 'px';
    dot.style.background = `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;
    dot.style.display = 'block';
    setTimeout(() => { dot.style.display = 'none'; }, 1100);
    const relX = x / drawWidth, relY = y / drawHeight;
    const colPos = relX < 0.33 ? 'izquierda' : relX < 0.66 ? 'centro' : 'derecha';
    const rowPos = relY < 0.33 ? 'arriba' : relY < 0.66 ? 'centro' : 'abajo';
    const posicion = (rowPos === 'centro' && colPos === 'centro') ? 'centro' : rowPos === 'centro' ? colPos : colPos === 'centro' ? rowPos : `${rowPos} ${colPos}`;
    const _panSide2 = relX < 0.40 ? 'a la izquierda' : relX > 0.60 ? 'a la derecha' : 'al centro';
    const panArrow = `el color se concentra ${_panSide2}`;
    playColorTone(h,s,v);
    setTimeout(() => {
      const objeto = findObjectAtPoint(px, py, touchCanvas.width, touchCanvas.height,
        Array.isArray(objectMap) ? objectMap : null);
      const texto = objeto ? `${posicion}, ${nombre}, ${freqMostrar} hercios, ${panArrow}, ${objeto}` : `${posicion}, ${nombre}, ${freqMostrar} hercios, ${panArrow}`;
      window.ArgiraSpeech.speak(texto, { rate:0.92 });
    }, 500);
  }

  let _tuIsTouchDevice = false;
  touchCanvas.addEventListener('click', e => { if (!_tuIsTouchDevice) handleTouch(e); });
  let _tuTouchStartY = 0;
  touchCanvas.addEventListener('touchstart', e => { _tuIsTouchDevice = true; _tuTouchStartY = e.touches[0].clientY; window.ArgiraAudio.resume(); }, { passive: true });
  touchCanvas.addEventListener('touchend', e => {
    const dy = Math.abs(e.changedTouches[0].clientY - _tuTouchStartY);
    if (dy < 10) {
      const t = e.changedTouches[0];
      handleTouch({ preventDefault:()=>{}, cancelable:false, touches:[{clientX:t.clientX,clientY:t.clientY}], clientX:t.clientX, clientY:t.clientY });
    }
  });
}

// ========== Tour espacial para imagen subida por el usuario ==========
function initCanvasTour() {
  const tuPanel = document.getElementById('tu-panel');
  if (!tuPanel) return;

  // Botón y estado del tour — se crean una sola vez
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'argira-spatial-btn argira-scan-btn';
  scanBtn.setAttribute('aria-label', 'Tour espacial automático de tu imagen');
  scanBtn.setAttribute('aria-pressed', 'false');
  scanBtn.innerHTML = '<span aria-hidden="true">🖼️</span> Tour espacial';
  scanBtn.style.display = 'none';
  tuPanel.appendChild(scanBtn);

  let _tourId = 0, _aborted = false;
  let _tuObjectMap = null, _tuMapFetched = false;
  let _tuZones = null, _tuHues = null;
  let _tourSpeed = 1; // normal por defecto

  function stopScan() {
    _tourId++;
    _aborted = true;
    window.ArgiraSpeech.stop();
    scanBtn.setAttribute('aria-pressed', 'false');
    scanBtn.innerHTML = '<span aria-hidden="true">🖼️</span> Tour espacial';
    scanBtn._argiraScanStop = null;
  }

  function actToLabel(act) {
    if (act < 0.10) return 'color uniforme';
    if (act < 0.28) return 'color casi uniforme';
    if (act < 0.50) return 'color moderado';
    if (act < 0.72) return 'color variado';
    if (act < 0.88) return 'color muy variado';
    return 'color máximamente variado';
  }

  function hueToColorName(h) {
    if (h < 0) return null;
    if (window._argiraHueToName) return window._argiraHueToName(h, 0.8, 0.7);
    const deg = h * 360;
    if (deg<15||deg>=345) return 'rojo';
    if (deg<45) return 'naranja';
    if (deg<70) return 'amarillo';
    if (deg<150) return 'verde';
    if (deg<210) return 'cian';
    if (deg<270) return 'azul';
    if (deg<330) return 'violeta';
    return 'rosa';
  }

  function hourToPan(zi) { return zi === 12 ? 0 : Math.sin((zi / 12) * 2 * Math.PI); }

  function playZoneTone(hue, act, pan, durSec) {
    try {
      const audioCtx = window.ArgiraAudio.resume();
      const freq = hue >= 0 ? (200 + hue * 800) : 400;
      const vol = 0.12 + act * 0.45;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durSec);
      osc.connect(gain);
      if (audioCtx.createStereoPanner) {
        const panner = audioCtx.createStereoPanner();
        panner.pan.value = pan; gain.connect(panner); panner.connect(audioCtx.destination);
      } else { gain.connect(audioCtx.destination); }
      osc.start(); osc.stop(audioCtx.currentTime + durSec);
    } catch(e) {}
  }

  const ETIQUETA_ESPACIAL = [
    'arriba centro','arriba derecha','centro derecha','centro derecha',
    'abajo derecha','abajo centro','abajo centro','abajo izquierda',
    'centro izquierda','centro izquierda','arriba izquierda','arriba izquierda','centro'
  ];

  // buildTextoVoz — tres modos:
  //   objetoNuevo normal  → "arriba izquierda. tonos cian. niña con traje rosa."
  //   objetoNuevo inyectado → "En la escena también aparece: océano con olas."  (sin info espacial falsa)
  //   objetoRef            → "zona de niña."  (referencia espacial, sin repetir descripción)
  // Determina si un label corresponde a un objeto de fondo (misma lógica que isFondo en findObjectAtPoint)
  function esFondoLabel(label, objects) {
    if (!Array.isArray(objects)) return false;
    const obj = objects.find(o => o.label === label);
    if (!obj) return false;
    const w = (obj.x2 || 0) - (obj.x1 || 0);
    const h = (obj.y2 || 0) - (obj.y1 || 0);
    const area = w * h;
    const _BG = /oc[eé]ano|mar(\s|$)|agua(\s|$)|cielo|nube|arena|campo(\s|$)|vegetaci[oó]n|paisaje|fondo|hierba|prado|playa|horizonte|suelo/i;
    if (area > 0.50) return true;
    if (area > 0.30 && _BG.test(label)) return true;
    if (w > 0.95 && h > 0.40) return true;
    return false;
  }

  function buildTextoVoz(zi, objetoNuevo, objetoRef, colorName, act, esInyectado, fondoPendiente) {
    if (esInyectado && objetoNuevo) {
      // Objeto inyectado en zona vacía: no afirmar que está "arriba derecha" si no es así
      return 'En la escena también aparece: ' + objetoNuevo + '.';
    }
    const partes = [];
    partes.push(zi === 12 ? 'Centro' : ETIQUETA_ESPACIAL[zi]);
    if (colorName) partes.push(`tonos ${colorName}`);
    partes.push(actToLabel(act));
    if (objetoNuevo) {
      partes.push(objetoNuevo);
    } else if (objetoRef) {
      if (fondoPendiente) {
        // "sobre" para fondos (agua, arena, cielo); "junto a" para otras figuras
        const prep = esFondoLabel(fondoPendiente, _tuObjectMap) ? 'sobre' : 'junto a';
        partes.push(`zona de ${objetoRef}, ${prep} ${fondoPendiente}`);
      } else {
        partes.push(`zona de ${objetoRef}`);
      }
    }
    return partes.join('. ') + '.';
  }

  const sequence = [10, 0, 1, 8, 12, 2, 7, 5, 4];

  async function runTour() {
    const Z = _tuZones, H = _tuHues;
    if (!Z) return;
    const announced = new Set();

    // Lista de todos los labels detectados — criterio único: ¿ya se anunció?
    // No se separa por figura/fondo: funciona igual con personas, animales, objetos, paisajes.
    const allLabels = Array.isArray(_tuObjectMap)
      ? [..._tuObjectMap]
          .sort((a, b) => {
            const areaA = ((a.x2 || 0) - (a.x1 || 0)) * ((a.y2 || 0) - (a.y1 || 0));
            const areaB = ((b.x2 || 0) - (b.x1 || 0)) * ((b.y2 || 0) - (b.y1 || 0));
            return areaB - areaA; // mayor área primero → contexto escénico antes que figuras
          })
          .map(o => o.label)
      : [];

    try {
      for (let idx = 0; idx < sequence.length; idx++) {
        if (_aborted || _tourId !== myTourId) return;
        const zi = sequence[idx];
        const hue = H ? H[zi] : -1;
        const act = Z[zi];
        const pan = hourToPan(zi);
        const colorName = hue >= 0 ? hueToColorName(hue) : null;
        const _c = (function(zi) {
          if (zi === 12) return { nx: 0.5, ny: 0.5 };
          const angle = (zi / 12) * 2 * Math.PI - Math.PI / 2;
          const r = 0.30;
          return { nx: Math.max(0.05, Math.min(0.95, 0.5 + r * Math.cos(angle))),
                   ny: Math.max(0.05, Math.min(0.95, 0.5 + r * Math.sin(angle))) };
        })(zi);
        let objetoDetectado = findObjectAtPoint(_c.nx, _c.ny, 1, 1, Array.isArray(_tuObjectMap) ? _tuObjectMap : null);

        // Zona vacía: inyectar el siguiente objeto pendiente (cualquier categoría).
        // La locución lo marcará como "detectado en la escena", no como objeto de esa zona.
        let esInyectado = false;
        if (!objetoDetectado) {
          const pendiente = allLabels.find(l => !announced.has(l));
          if (pendiente) { objetoDetectado = pendiente; esInyectado = true; }
        }

        // Primera vez → anunciar; repetido → referencia espacial; inyectado → contexto escena
        let objetoNuevo = null, objetoRef = null;
        if (objetoDetectado) {
          if (!announced.has(objetoDetectado)) {
            objetoNuevo = objetoDetectado;
            announced.add(objetoDetectado);
          } else {
            objetoRef = objetoDetectado;
          }
        }

        // Fondo solapado: cuando el punto cae sobre una referencia o zona vacía,
        // buscar objetos de fondo no anunciados que cubran ese mismo punto.
        // isFondo excluye estos objetos del hit-test normal, por eso nunca ganan solos.
        let fondoPendiente = null;
        if (objetoRef !== null || (!objetoDetectado && !esInyectado)) {
          if (Array.isArray(_tuObjectMap)) {
            for (const obj of _tuObjectMap) {
              if (announced.has(obj.label)) continue;
              if (_c.nx >= obj.x1 && _c.nx <= obj.x2 && _c.ny >= obj.y1 && _c.ny <= obj.y2) {
                fondoPendiente = obj.label;
                announced.add(obj.label);
                break;
              }
            }
          }
        }
        const textoVoz = buildTextoVoz(zi, objetoNuevo, objetoRef, colorName, act, esInyectado, fondoPendiente);
        const liveRegion = document.getElementById('live-region');

        playZoneTone(hue, act, pan, _tourSpeed === 2 ? 0.22 : 0.35);
        await new Promise(r => setTimeout(r, _tourSpeed === 2 ? 150 : 280));
        if (_aborted || _tourId !== myTourId) return;

        const speechRate = _tourSpeed === 0 ? 0.82 : _tourSpeed === 1 ? 0.92 : 1.1;

        // Monkey-patch temporal de speak — restaura speechSynthesis.speak tras cada utterance.
        // Necesario en iOS/Safari para evitar que el patch se acumule entre pasos.
        const _origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        let _intercepted = false;
        window.speechSynthesis.speak = function(u) {
          if (!_intercepted) {
            _intercepted = true;
            window.speechSynthesis.speak = _origSpeak;
            const _prevOnend = u.onend;
            const _prevOnerror = u.onerror;
            u.onend = function(ev) { if (_prevOnend) _prevOnend.call(this, ev); };
            u.onerror = function(ev) { if (_prevOnerror) _prevOnerror.call(this, ev); };
          }
          _origSpeak(u);
        };

        // await speak() — la Promise se resuelve cuando todos los chunks han terminado.
        if (liveRegion) liveRegion.textContent = textoVoz;
        if (_tourSpeed === 2) {
          window.ArgiraSpeech.speak(textoVoz, { rate: speechRate });
          await new Promise(r => setTimeout(r, 1200));
        } else {
          await window.ArgiraSpeech.speak(textoVoz, { rate: speechRate });
          // Restaurar speechSynthesis.speak por si el intercept no se disparó
          window.speechSynthesis.speak = _origSpeak;
          if (_aborted || _tourId !== myTourId) return;
          await new Promise(r => setTimeout(r, _tourSpeed === 0 ? 900 : 200));
        }
      }
      // Epílogo: objetos detectados que ninguna zona seleccionó ni inyectó.
      // Criterio único: !announced.has(label).
      const pendientesTotales = allLabels.filter(l => !announced.has(l));
      const cobertura = allLabels.length > 0
        ? Math.round(announced.size / allLabels.length * 100) : 100;

      if (pendientesTotales.length > 0 && !_aborted && _tourId === myTourId) {
        const speechRate = _tourSpeed === 0 ? 0.82 : _tourSpeed === 1 ? 0.92 : 1.1;
        const intro = 'Además se detectaron: ' + pendientesTotales.join('. ') + '.';
        if (_tourSpeed === 2) {
          window.ArgiraSpeech.speak(intro, { rate: speechRate });
          await new Promise(r => setTimeout(r, 2000));
        } else {
          await window.ArgiraSpeech.speak(intro, { rate: speechRate });
          if (_aborted || _tourId !== myTourId) return;
          await new Promise(r => setTimeout(r, _tourSpeed === 0 ? 600 : 200));
        }
        pendientesTotales.forEach(l => announced.add(l));
      }

      if (!_aborted && _tourId === myTourId) {
        await new Promise(r => setTimeout(r, 400));
        stopScan();
      }
    } catch(err) {
      console.error('[ArgiraTour] error en runTour:', err);
    } finally {
      // Garantizar que el botón nunca quede bloqueado aunque falle una zona
      if (scanBtn.getAttribute('aria-pressed') === 'true') {
        scanBtn.disabled = false;
        scanBtn.setAttribute('aria-pressed', 'false');
        scanBtn.innerHTML = '<span aria-hidden="true">🖼️</span> Tour espacial';
      }
    }
  }

  let myTourId = 0;

  scanBtn.addEventListener('click', function() {
    try { window.ArgiraAudio.resume(); } catch(e) {}
    if (scanBtn.getAttribute('aria-pressed') === 'true') { stopScan(); return; }
    if (!_tuZones) return;

    _aborted = false;
    myTourId = ++_tourId;
    scanBtn.setAttribute('aria-pressed', 'true');
    scanBtn.innerHTML = '<span aria-hidden="true">⏹</span> Detener';
    scanBtn._argiraScanStop = stopScan;

    window.ArgiraSpeech.stop();
    // Esperar mapa si no llegó todavía
    // Esperar la Promise compartida en lugar de polling sobre _tuMapFetched
    (window._argiraTourMapPromise || Promise.resolve(null)).then(() => {
      if (_aborted || _tourId !== myTourId) return;
      runTour();
    });
  });

  // Llamado desde processFile cuando se carga una nueva imagen
  window._argiraTourInit = function(imageElement, metrics) {
    // Resetear estado
    _tuObjectMap = null; _tuMapFetched = false;
    _tuZones = null; _tuHues = null;
    stopScan();
    // Deshabilitar el botón mientras se calcula la nueva imagen —
    // se rehabilita en cuanto las zonas estén listas (unas decenas de ms).
    scanBtn.disabled = true;
    scanBtn.style.opacity = '0.45';
    scanBtn.style.display = 'inline-flex';

    // Calcular zonas desde métricas o desde la imagen
    const SIZE = 64;
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = SIZE;
    cvs.getContext('2d').drawImage(imageElement, 0, 0, SIZE, SIZE);
    const data = cvs.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
    const N = SIZE*SIZE, NZONES = 13, NBINS = 12;
    const cx0 = (SIZE-1)/2, cy0 = (SIZE-1)/2, R_CTR = (SIZE/2)*0.25;
    const zSumH = new Float64Array(NZONES), zSumH2 = new Float64Array(NZONES);
    const zCnt = new Int32Array(NZONES), zHist = new Uint32Array(NZONES*NBINS);
    for (let i=0; i<N; i++) {
      const r=data[i*4]/255, g=data[i*4+1]/255, b=data[i*4+2]/255;
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
      const s=mx>0?d/mx:0; let h=0;
      if (d>0) { if(mx===r) h=((g-b)/d+6)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h/=6; }
      const col=i%SIZE, row=Math.floor(i/SIZE);
      const dx=col-cx0, dy=row-cy0, radius=Math.sqrt(dx*dx+dy*dy);
      let zi;
      if (radius<R_CTR) zi=12;
      else { const angle=((Math.atan2(dy,dx)+Math.PI/2)%(2*Math.PI)+2*Math.PI)%(2*Math.PI); zi=Math.min(11,Math.floor(angle/(2*Math.PI)*12)); }
      zSumH[zi]+=h; zSumH2[zi]+=h*h; zCnt[zi]++;
      if (s<0.08) continue;
      zHist[zi*NBINS+Math.min(NBINS-1,Math.floor(h*NBINS))]++;
    }
    const zStd = Array.from({length:NZONES},(_,i)=>{ const n=zCnt[i]; if(!n) return 0; const mean=zSumH[i]/n; return Math.sqrt(Math.max(0,zSumH2[i]/n-mean*mean)); });
    const zMax = Math.max(...zStd, 0.001);
    _tuZones = zStd.map(v=>v/zMax);
    _tuHues = Array.from({length:NZONES},(_,zi)=>{ let maxBin=0,maxCount=0; for(let b=0;b<NBINS;b++){const c=zHist[zi*NBINS+b];if(c>maxCount){maxCount=c;maxBin=b;}} return maxCount===0?-1:(maxBin+0.5)/NBINS; });

    // Zonas listas — rehabilitar botón
    scanBtn.disabled = false;
    scanBtn.style.opacity = '';

    // Consumir la Promise compartida — cuando resuelve, el mapa está listo
    // (data puede ser null si el fetch falló; runTour lo maneja con fallback)
    window._argiraTourMapPromise.then(data => {
      _tuObjectMap = data;
      _tuMapFetched = true;
    });
  };
}
window.argiraStopAll = function() {
  if (window.ArgiraSpeech) window.ArgiraSpeech.stop();
  try {
    const ctx = window.ArgiraAudio && window.ArgiraAudio.get();
    if (ctx && ctx.state !== 'closed') ctx.suspend();
  } catch(e) {}
  if (window.LupaInversa) window.LupaInversa.stop();
  if (typeof stopLupa === 'function') stopLupa();
  document.querySelectorAll('audio').forEach(a => { try { a.pause(); a.currentTime = 0; } catch(e) {} });
  document.querySelectorAll('.argira-scan-btn[aria-pressed="true"], .argira-test-scan[aria-pressed="true"]').forEach(btn => {
    if (btn._argiraScanStop) btn._argiraScanStop();
  });
  document.querySelectorAll('.argira-sonify-btn[aria-pressed="true"]').forEach(btn => btn.click());
  try {
    const ctx = window.ArgiraAudio && window.ArgiraAudio.get();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  } catch(e) {}
};

document.addEventListener('DOMContentLoaded', () => {
  const stopAllBtn = document.getElementById('btn-stop-all');
  if (stopAllBtn) {
    stopAllBtn.addEventListener('click', () => {
      window.argiraStopAll();
      stopAllBtn.textContent = '✓ Detenido';
      setTimeout(() => { stopAllBtn.innerHTML = '⏹ Detener todo'; }, 1200);
    });
  }
});

// ========== Inicialización al cargar el DOM ==========
document.addEventListener('DOMContentLoaded', () => {
  initGallerySonify();
  initGalleryTouch();
  initGalleryAudioPan();
  initRoughnessWidgets();
  initClockScan();
  initCanvasTouch();
  initCanvasTour();
});