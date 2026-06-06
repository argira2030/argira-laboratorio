// ============================================================
// ARGIRA v3.5 — app-v35.js
// Pipeline completo autónomo: imagen → análisis → síntesis → audio
// ============================================================
// Ensamblado de Fases 2-6. No depende de script.js ni de funciones
// heredadas. Convive con la versión pública (V1) en /laboratorio/.
//
// Estructura:
//   §1  AudioContext (reutiliza ArgiraAudio si existe, o crea uno nuevo)
//   §2  boxCountingDimensionV35()     Fase 2
//   §3  analyzeColorV35()             Fase 3
//   §4  analyzeSpatialV35()           Fase 4
//   §5  sonicParamsV35()              Fase 5
//   §6  _granularLayer()              Fase 6
//       synthesizeV35()               Fase 6
//       stereoToAudioBuffer()         Fase 6 helper
//   §7  Pipeline: processFileV35()    Fase 7
//       renderMetricsV35()            Fase 7
//       play / stop / download        Fase 7
//
// IDs HTML esperados (mismos que V1 para reutilizar plantilla):
//   tu-canvas, tu-panel, tu-preview, tu-nombre, tu-status,
//   tu-btn-play, tu-btn-stop, tu-btn-dl,
//   tu-speed-slider, tu-speed-val,
//   tu-freq-slider, tu-gain-slider,
//   tu-drop-zone, tu-file-input,
//   tu-metricas, tu-params-grid, tu-chroma-pct, tu-chroma-bar
// ============================================================


// ── §1  AUDIO CONTEXT ────────────────────────────────────────
// Reutiliza window.ArgiraAudio (V1) si está disponible; si no, crea
// un contexto local para el laboratorio.
const _audioCtx35 = (function () {
  if (window.ArgiraAudio) return window.ArgiraAudio;
  let ctx = null;
  const api = {
    get() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    },
    resume() {
      const c = this.get();
      if (c.state === 'suspended') return c.resume().then(() => c);
      return Promise.resolve(c);
    }
  };
  document.addEventListener('touchstart', () => api.resume().catch(() => {}), { once: true });
  return api;
})();


// ── §2  BOX-COUNTING FRACTAL v3.5 ────────────────────────────
// Fases 2. Traducción exacta de box_counting_dimension() Python v3.5.
// Entrada: imgData (ImageData 256×256), W, H
// Salida:  D ∈ [1.0, 2.0]  (fallback 1.5 si datos insuficientes)

function boxCountingDimensionV35(imgData, W, H) {
  if (!imgData || !W || !H) return 1.5;

  const d = imgData.data;
  const N = W * H;

  // Luminancia BT.601 normalizada [0,1] → equivale a PIL img.convert('L')
  const arr = new Float64Array(N);
  let arrSum = 0;
  for (let i = 0; i < N; i++) {
    const lum = 0.299 * d[i * 4]     / 255
              + 0.587 * d[i * 4 + 1] / 255
              + 0.114 * d[i * 4 + 2] / 255;
    arr[i]  = lum;
    arrSum += lum;
  }

  const threshold = arrSum / N;  // arr.mean()

  const binary = new Uint8Array(N);
  for (let i = 0; i < N; i++) binary[i] = arr[i] > threshold ? 1 : 0;

  const sizes = [], counts = [];
  let box_size = 2;
  while (box_size <= 128) {
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


// ── §3  ANÁLISIS DE COLOR v3.5 ───────────────────────────────
// Fase 3. Traducción exacta de analyze_color() Python v3.5.
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

  // hue_std: std lineal (np.std, no circular)
  let sumSqH = 0;
  for (let i = 0; i < N; i++) sumSqH += (hArr[i] - hue_mean) ** 2;
  const hue_std = Math.sqrt(sumSqH / N);

  // hue_entropy: histograma 32 bins, bits
  const BINS = 32;
  const hist = new Float64Array(BINS);
  for (let i = 0; i < N; i++) hist[Math.min(BINS - 1, Math.floor(hArr[i] * BINS))]++;
  let hue_entropy = 0;
  for (let b = 0; b < BINS; b++) {
    const p = hist[b] / N;
    if (p > 0) hue_entropy -= p * Math.log2(p);
  }

  // edge_density: gradiente finito canal V, umbral 0.05
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

  // roughness: varianza local en parches 8×8, normalizada / 0.25
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
  const roughness = patchCount > 0
    ? Math.min(1.0, (patchVarSum / patchCount) / 0.25)
    : 0;

  // luminance_contrast: std canal V
  let sumSqV = 0;
  for (let i = 0; i < N; i++) sumSqV += (vArr[i] - value_mean) ** 2;
  const luminance_contrast = Math.sqrt(sumSqV / N);

  return { hue_mean, saturation_mean, value_mean, hue_std, hue_entropy,
           edge_density, roughness, luminance_contrast };
}


// ── §4  ANÁLISIS ESPACIAL v3.5 ───────────────────────────────
// Fase 4. Traducción exacta de analyze_spatial() Python v3.5.
// Entrada: imgData, W, H
// Salida:  { zones, zone_pan, stereo_pan, center_x, center_y,
//            golden_distance, nearest_golden, dist_P1, dist_P2 }

function analyzeSpatialV35(imgData, W, H) {
  const d = imgData.data;
  const N = W * H;

  const lum = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    lum[i] = 0.299 * d[i*4]/255 + 0.587 * d[i*4+1]/255 + 0.114 * d[i*4+2]/255;
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
    zones: zones_norm, zone_pan,
    stereo_pan,
    center_x: cx, center_y: cy,
    golden_distance: Math.min(dist_P1, dist_P2),
    nearest_golden:  dist_P1 <= dist_P2 ? 'P1(0.382)' : 'P2(0.618)',
    dist_P1, dist_P2,
  };
}


// ── §5  PARÁMETROS SÓNICOS v3.5 ──────────────────────────────
// Fase 5. Traducción exacta de compute_sonic_params() Python v3.5.
// Incorpora los 5 cambios v3.5 (C1–C5).
// Entrada: fractal_D, colorM, spatialM
// Salida:  objeto con todos los parámetros + campos de diagnóstico (_)

function sonicParamsV35(fractal_D, colorM, spatialM) {
  const hue      = colorM.hue_mean;
  const sat      = colorM.saturation_mean;
  const hue_std  = colorM.hue_std;
  const hue_entropy        = colorM.hue_entropy;
  const edge_density       = colorM.edge_density;
  const luminance_contrast = colorM.luminance_contrast;

  const stereo_pan = Math.max(-1.0, Math.min(1.0, spatialM.stereo_pan * 4.0));

  // Normalizaciones base
  const hue_entropy_norm  = Math.max(0, Math.min(1, hue_entropy / 5.2));
  const fractal_norm      = Math.max(0, Math.min(1, (fractal_D - 1.5) / 0.5));
  const edge_density_norm = Math.max(0, Math.min(1, edge_density / 0.50));
  const lum_norm          = Math.max(0, Math.min(1, luminance_contrast / 0.3));

  // [C1] hue×fractal  I_full=1.000 Tempo & 0.996 Odd Bias
  const hue_x_fractal = hue_entropy_norm * fractal_norm;

  // [C2] freq_base log [150–800 Hz], pesos 0.65/0.35
  const freq_input = 0.65 * hue_entropy_norm + 0.35 * lum_norm;
  const freq_base  = 150.0 * Math.pow(800.0 / 150.0, freq_input);

  // [C3] odd_bias = hue_std×0.9 + hue_x_fractal×0.6
  const n_harmonics = Math.floor(3 + sat * 10);
  const odd_bias    = Math.max(0, Math.min(1, hue_std * 0.9 + hue_x_fractal * 0.6));

  // Segundo oscilador
  const hue_complement = (hue + 0.5) % 1.0;
  const freq2_base = Math.max(150.0, Math.min(1000.0,
    300.0 + 600.0 * hue_entropy_norm
    + 350.0 * Math.cos(2 * Math.PI * hue_complement)
  ));
  const osc2_weight = Math.max(0, Math.min(0.6, (hue_std - 0.18) / 0.22));

  // Tempo
  const zones = spatialM.zones;
  let zMean = 0;
  for (let i = 0; i < 9; i++) zMean += zones[i];
  zMean /= 9;
  let zVar = 0;
  for (let i = 0; i < 9; i++) zVar += (zones[i] - zMean) ** 2;
  zVar /= 9;

  const tempo_from_color   = Math.max(0, Math.min(15, hue_std * 25.0 + hue_x_fractal * 25.0));
  const tempo_from_space   = Math.max(0, Math.min(15, Math.log1p(zVar * 8000) * 12));
  // [C5] cap ±12 BPM
  const tempo_from_fractal = Math.max(-12, Math.min(12, (fractal_D - 1.5) * 60.0));
  const tempo_bpm = Math.max(40, Math.min(115,
    70.0 + tempo_from_color + tempo_from_space + tempo_from_fractal
  ));

  // Modulación
  const fractal_offset = (fractal_D - 1.5) * 100;
  const mod_depth = 144.9 + edge_density_norm * 56.4 + fractal_norm * 83.1;
  const mod_rate  = 1.0 + hue_std * 4.0 + edge_density_norm * 6.0;

  // [C4] decay = lum×0.65 + hue×edge×0.35
  const hue_x_edge  = hue_entropy_norm * edge_density_norm;
  const decay_input = lum_norm * 0.65 + hue_x_edge * 0.35;
  const decay       = 0.3 + decay_input * 0.4;

  return {
    freq_base, freq2_base, osc2_weight, n_harmonics, odd_bias,
    tempo_bpm, decay, mod_depth, mod_rate, stereo_pan, fractal_D,
    _tempo_color:       tempo_from_color,
    _tempo_space:       tempo_from_space,
    _tempo_fractal:     tempo_from_fractal,
    _hue_entropy_norm,
    _edge_density_norm: edge_density_norm,
    _lum_norm:          lum_norm,
    _golden_distance:   spatialM.golden_distance,
    _fractal_offset:    fractal_offset,
    _fractal_norm:      fractal_norm,
    _hue_x_fractal:     hue_x_fractal,
    _hue_x_edge:        hue_x_edge,
    _freq_input:        freq_input,
    _decay_input:       decay_input,
  };
}


// ── §6  SÍNTESIS v3.5 ────────────────────────────────────────
// Fase 6. Traducción exacta de _granular_layer() + synthesize_audio()
// Python v3.5 líneas 458–581.

function _granularLayer(n, freq_base, fractal_D, sampleRate) {
  const grain_size  = Math.floor(0.04 * sampleRate);
  const grain_layer = new Float32Array(n);
  const intensity   = Math.max(0, Math.min(1, (fractal_D - 1.85) / 0.15));

  // LCG reproducible (semilla 42) — estadísticamente equivalente a NumPy RNG
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

  // ── Serie armónica + modulador FM
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

  // ── Capa granular (D > 1.85)
  if (fractal_D > 1.85) {
    const gl = _granularLayer(N, freq_base, fractal_D, sampleRate);
    for (let i = 0; i < N; i++) signal[i] += gl[i];
  }

  // ── Segundo oscilador
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

  // ── Normalizar
  let maxVal = 0;
  for (let i = 0; i < N; i++) if (Math.abs(signal[i]) > maxVal) maxVal = Math.abs(signal[i]);
  if (maxVal > 0) for (let i = 0; i < N; i++) signal[i] /= maxVal;

  // ── Envolvente rítmica
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

  // ── Fade out (linspace 1→0, paso −1/(M−1), validado vs Python)
  const fade = Math.floor(0.5 * sampleRate);
  for (let i = 0; i < fade; i++) signal[N - fade + i] *= 1 - i / (fade - 1);

  // ── Normalizar final
  maxVal = 0;
  for (let i = 0; i < N; i++) if (Math.abs(signal[i]) > maxVal) maxVal = Math.abs(signal[i]);
  if (maxVal > 0) for (let i = 0; i < N; i++) signal[i] /= maxVal;

  // ── Pan seno/coseno potencia constante
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

// stereo Float32Array → Blob WAV PCM 16-bit para descarga
function stereoToWavBlob(stereoArray, sampleRate = 44100) {
  const N      = stereoArray.length / 2;
  const nBytes = N * 4;  // 2 canales × 2 bytes (16-bit)
  const buf    = new ArrayBuffer(44 + nBytes);
  const v      = new DataView(buf);
  const w      = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + nBytes, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true);    // chunk size
  v.setUint16(20, 1, true);     // PCM
  v.setUint16(22, 2, true);     // 2 canales
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);     // block align
  v.setUint16(34, 16, true);    // bits per sample
  w(36, 'data'); v.setUint32(40, nBytes, true);
  let off = 44;
  for (let i = 0; i < stereoArray.length; i++) {
    const s    = Math.max(-1, Math.min(1, stereoArray[i]));
    const i16  = Math.round(s < 0 ? s * 32768 : s * 32767);
    v.setInt16(off, i16, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}


// ── §7  PIPELINE & UI ────────────────────────────────────────
// Fase 7. Conecta análisis → síntesis → Web Audio API.
// Maneja UI: drag-drop, play/stop, descarga, métricas.

document.addEventListener('DOMContentLoaded', function () {
  const SIZE = 256;  // misma resolución que V1

  // ── Referencias DOM
  const canvas      = document.getElementById('tu-canvas');
  const panel       = document.getElementById('tu-panel');
  const preview     = document.getElementById('tu-preview');
  const nombreSpan  = document.getElementById('tu-nombre');
  const statusEl    = document.getElementById('tu-status');
  const btnPlay     = document.getElementById('tu-btn-play');
  const btnStop     = document.getElementById('tu-btn-stop');
  const btnDL       = document.getElementById('tu-btn-download');  // id real en HTML
  const speedSlider = document.getElementById('tu-speed');         // id real en HTML
  const speedVal    = document.getElementById('tu-speed-val');
  const freqSlider  = document.getElementById('tuShelvingFreq');   // id real en HTML
  const gainSlider  = document.getElementById('tuShelvingGain');   // id real en HTML
  const dropZone    = document.getElementById('tu-upload-zone');   // <label> que actúa como zona drop
  const fileInput   = document.getElementById('tu-file-input');
  const metricasEl  = document.getElementById('tu-metricas');
  const paramsGrid  = document.getElementById('tu-params-grid');
  const chromaPct   = document.getElementById('tu-chroma-pct');
  const chromaBar   = document.getElementById('tu-chroma-bar');

  // ── Estado
  let wavBuffer     = null;   // AudioBuffer (play)
  let wavStereo     = null;   // Float32Array (descarga)
  let sourceNode    = null;
  let filterNode    = null;
  let isPlaying     = false;
  let currentFile   = 'mi-imagen';
  let lastSonic     = null;   // último sonicParams (debug)

  // ── Render métricas v3.5
  function renderMetricsV35(colorM, spatialM, fractal_D, sonic) {
    const hue_std = colorM.hue_std;
    const pct = Math.round((hue_std - 0.016) / (0.364 - 0.016) * 100);
    const pctC = Math.min(Math.max(pct, 0), 100);
    let nivel = 'MÍNIMO';
    if (hue_std > 0.040) nivel = 'MUY BAJO';
    if (hue_std > 0.080) nivel = 'BAJO';
    if (hue_std > 0.130) nivel = 'BAJO-MEDIO';
    if (hue_std > 0.180) nivel = 'MEDIO';
    if (hue_std > 0.230) nivel = 'MEDIO-ALTO';
    if (hue_std > 0.270) nivel = 'ALTO';
    if (hue_std > 0.310) nivel = 'MUY ALTO';
    if (hue_std > 0.345) nivel = 'MÁXIMO';

    if (chromaPct) chromaPct.textContent = pctC.toFixed(0) + '% · ' + nivel;
    if (chromaBar) chromaBar.style.width = pctC.toFixed(1) + '%';

    if (metricasEl) {
      const panDir = spatialM.stereo_pan < -0.1 ? '← izq'
                   : spatialM.stereo_pan >  0.1 ? 'der →' : '· centro';
      metricasEl.innerHTML =
        `hue_std: <strong>${hue_std.toFixed(4)}</strong> · ` +
        `hue_entropy: <strong>${colorM.hue_entropy.toFixed(3)}</strong> · ` +
        `edge_density: <strong>${colorM.edge_density.toFixed(3)}</strong> · ` +
        `lum_contrast: <strong>${colorM.luminance_contrast.toFixed(3)}</strong> · ` +
        `pan: <strong>${panDir}</strong>`;
    }

    if (paramsGrid) {
      const granularFlag = fractal_D > 1.85 ? ' ← granular' : '';
      const params = [
        ['Frec. base',      sonic.freq_base.toFixed(1)  + ' Hz'],
        ['D fractal',       fractal_D.toFixed(4) + granularFlag],
        ['Armónicos',       sonic.n_harmonics],
        ['Tempo',           sonic.tempo_bpm.toFixed(1)  + ' BPM'],
        ['Decay',           sonic.decay.toFixed(3)       + ' s'],
        ['odd_bias',        sonic.odd_bias.toFixed(4)],
        ['mod_depth',       sonic.mod_depth.toFixed(1)],
        ['hue×fractal',     sonic._hue_x_fractal.toFixed(4)],
      ];
      paramsGrid.innerHTML = params.map(([k, v]) =>
        `<div style="padding:12px 20px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);">` +
        `<div style="font-size:0.65rem;font-family:'Cinzel',serif;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:2px;">${k}</div>` +
        `<div style="font-family:'IBM Plex Mono',monospace;font-size:0.9rem;color:var(--gold);">${v}</div>` +
        `</div>`
      ).join('');
    }
  }

  // ── Procesar imagen
  function processFileV35(file) {
    currentFile = file.name.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      if (preview)    preview.src = url;
      if (nombreSpan) nombreSpan.textContent = file.name;
      if (statusEl)   statusEl.textContent   = 'Analizando v3.5…';

      // Dibujar en canvas 256×256
      if (!canvas) { console.error('[v35] No se encontró tu-canvas'); return; }
      canvas.width  = SIZE;
      canvas.height = SIZE;
      const ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(img, 0, 0, SIZE, SIZE);
      const imgData = ctx2d.getImageData(0, 0, SIZE, SIZE);

      // ── Pipeline v3.5
      const fractal_D = boxCountingDimensionV35(imgData, SIZE, SIZE);
      const colorM    = analyzeColorV35(imgData, SIZE, SIZE);
      const spatialM  = analyzeSpatialV35(imgData, SIZE, SIZE);
      const sonic     = sonicParamsV35(fractal_D, colorM, spatialM);
      lastSonic       = sonic;

      // Síntesis (puede tardar ~200-400 ms en CPU lenta)
      if (statusEl) statusEl.textContent = 'Sintetizando…';
      // Diferir un tick para que el navegador actualice el DOM
      setTimeout(() => {
        const stereo = synthesizeV35(sonic, 8.0, 44100);
        const actx   = _audioCtx35.get();
        wavStereo    = stereo;
        wavBuffer    = stereoToAudioBuffer(actx, stereo);

        renderMetricsV35(colorM, spatialM, fractal_D, sonic);

        if (statusEl)  statusEl.textContent = 'Audio listo · Pulsa Escuchar';
        if (panel)     panel.style.display   = 'block';
        setTimeout(() => panel && panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

        // Compatibilidad: exponer para tour y touch si V1 los usa
        if (window._argiraTourInit)  window._argiraTourInit(img, {
          hueStd: colorM.hue_std, satMean: colorM.saturation_mean,
          fractalD: fractal_D,    centroidX: spatialM.center_x,
          centroidY: spatialM.center_y,
        });
        if (window._argiraTouchInit) window._argiraTouchInit(img);
        URL.revokeObjectURL(url);
      }, 0);
    };

    img.onerror = () => {
      if (statusEl) statusEl.textContent = 'Error al cargar la imagen.';
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }

  // ── Stop
  function stop() {
    if (sourceNode) { try { sourceNode.stop(); } catch (_) {} sourceNode = null; }
    if (filterNode) { filterNode.disconnect(); filterNode = null; }
    isPlaying = false;
    if (btnPlay)  { btnPlay.style.background = 'rgba(232,201,106,0.08)'; btnPlay.style.color = 'var(--gold)'; }
    if (statusEl) statusEl.textContent = '';
  }

  // ── Play
  async function play() {
    if (!wavBuffer) return;
    stop();
    const actx = await _audioCtx35.resume();

    const speed  = speedSlider ? parseFloat(speedSlider.value) : 1.0;
    sourceNode   = actx.createBufferSource();
    sourceNode.buffer = wavBuffer;
    sourceNode.playbackRate.value = speed;

    filterNode = actx.createBiquadFilter();
    filterNode.type = 'highshelf';
    filterNode.frequency.value = freqSlider ? parseFloat(freqSlider.value) : 8000;
    filterNode.gain.value      = gainSlider ? parseFloat(gainSlider.value) : 0;

    sourceNode.connect(filterNode);
    filterNode.connect(actx.destination);

    sourceNode.onended = () => {
      isPlaying = false;
      if (btnPlay)  { btnPlay.style.background = 'rgba(232,201,106,0.08)'; btnPlay.style.color = 'var(--gold)'; }
      if (statusEl) statusEl.textContent = '';
    };

    sourceNode.start();
    isPlaying = true;
    if (btnPlay)  { btnPlay.style.background = '#e8c96a'; btnPlay.style.color = '#000'; }
    if (statusEl) statusEl.textContent = 'Reproduciendo a ' + speed.toFixed(2) + '× · ' + currentFile;
  }

  // ── Descarga WAV
  function download() {
    if (!wavStereo) return;
    const speed    = speedSlider ? parseFloat(speedSlider.value) : 1.0;
    const exportSR = Math.round(44100 * speed);
    const blob     = stereoToWavBlob(wavStereo, exportSR);
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    a.href = url;
    const tag = speed !== 1.0 ? '_' + speed.toFixed(2).replace('.', '') + 'x' : '';
    a.download = currentFile + tag + '_argira35.wav';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.textContent = 'WAV descargado · ' + a.download;
  }

  // ── Event listeners
  if (dropZone && fileInput) {
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.style.background = 'rgba(232,201,106,0.1)'; });
    dropZone.addEventListener('dragleave', ()  => { dropZone.style.background = 'transparent'; });
    dropZone.addEventListener('drop',      e  => {
      e.preventDefault(); dropZone.style.background = 'transparent';
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) processFileV35(f);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) processFileV35(fileInput.files[0]); });
  }

  if (btnPlay)  btnPlay.addEventListener('click', play);
  if (btnStop)  btnStop.addEventListener('click', stop);
  if (btnDL)    btnDL.addEventListener('click',   download);

  if (speedSlider) {
    speedSlider.addEventListener('input', function () {
      if (speedVal) speedVal.textContent = parseFloat(this.value).toFixed(2) + '×';
      if (sourceNode && isPlaying) sourceNode.playbackRate.value = parseFloat(this.value);
    });
  }

  // ── Exponer API pública (equivalente al window._argira* de V1)
  window._argiraV35 = {
    processFile:       processFileV35,
    sonicParams:       () => lastSonic,
    boxCounting:       boxCountingDimensionV35,
    analyzeColor:      analyzeColorV35,
    analyzeSpatial:    analyzeSpatialV35,
    computeSonicParams: sonicParamsV35,
    synthesize:        synthesizeV35,
    stop,
  };

});

// ============================================================
// FIN app-v35.js
// ============================================================
