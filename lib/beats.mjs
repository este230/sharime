// beats.mjs — tempo + beat-grid detection with no external libraries.
//
// Pipeline: ffmpeg decodes the track to mono PCM -> we build an energy-flux
// onset envelope -> autocorrelation finds the dominant tempo in a musical band
// -> we lock the phase to the loudest grid. The output is an evenly-spaced beat
// grid, which is exactly what montage cutting wants (steady, predictable cuts)
// rather than jittery per-onset timestamps.

import { run } from './util.mjs'

const SR = 22050 // sample rate we decode to
const HOP = 512 // analysis hop -> ~43.07 frames/sec
const FPS = SR / HOP
const MIN_BPM = 70
const MAX_BPM = 175

async function decodePcm(file) {
  const { code, stdout, stderr } = await run(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    { binary: true },
  )
  if (code !== 0) throw new Error(`audio decode failed: ${stderr.slice(-300)}`)
  const buf = stdout
  const usable = buf.length - (buf.length % 4)
  const ab = new ArrayBuffer(usable)
  new Uint8Array(ab).set(buf.subarray(0, usable))
  return new Float32Array(ab)
}

// Rectified energy flux: rises sharply on note/drum onsets.
function onsetEnvelope(samples) {
  const frames = Math.floor(samples.length / HOP)
  const env = new Float32Array(frames)
  let prev = 0
  for (let i = 0; i < frames; i++) {
    let e = 0
    const base = i * HOP
    for (let j = 0; j < HOP; j++) {
      const s = samples[base + j]
      e += s * s
    }
    e = Math.log(1 + e)
    const flux = e - prev
    env[i] = flux > 0 ? flux : 0
    prev = e
  }
  // Normalize to 0..1 for stable autocorrelation.
  let max = 0
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i]
  if (max > 0) for (let i = 0; i < env.length; i++) env[i] /= max
  return env
}

function detectTempo(env) {
  const minLag = Math.round((60 / MAX_BPM) * FPS)
  const maxLag = Math.round((60 / MIN_BPM) * FPS)
  let bestLag = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    for (let i = lag; i < env.length; i++) score += env[i] * env[i - lag]
    // Slight preference for faster tempi avoids locking onto half-time.
    score *= 1 + (maxLag - lag) * 0.0008
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  return { lagFrames: bestLag, bpm: Math.round((60 * FPS) / bestLag) }
}

// Slide a one-beat-period offset to find the phase whose grid lands on the most
// energy, then emit a steady grid for the whole track.
function buildGrid(env, lagFrames, durationSec) {
  let bestOffset = 0
  let bestSum = -Infinity
  for (let off = 0; off < lagFrames; off++) {
    let sum = 0
    for (let i = off; i < env.length; i += lagFrames) sum += env[i]
    if (sum > bestSum) {
      bestSum = sum
      bestOffset = off
    }
  }
  const period = lagFrames / FPS
  const start = bestOffset / FPS
  const beats = []
  for (let t = start; t < durationSec; t += period) {
    beats.push(Math.round(t * 1000) / 1000)
  }
  return { beats, period }
}

// Returns { bpm, beats, period, durationSec }. On any failure it falls back to
// a 100 BPM grid so the editor can always proceed.
export async function analyzeBeats(file, durationSec) {
  try {
    const samples = await decodePcm(file)
    const dur = durationSec || samples.length / SR
    const env = onsetEnvelope(samples)
    const { lagFrames, bpm } = detectTempo(env)
    const { beats, period } = buildGrid(env, lagFrames, dur)
    if (beats.length < 4) throw new Error('too few beats')
    return { bpm, beats, period, durationSec: dur }
  } catch {
    const dur = durationSec || 30
    const period = 0.6 // 100 BPM
    const beats = []
    for (let t = 0; t < dur; t += period) beats.push(Math.round(t * 1000) / 1000)
    return { bpm: 100, beats, period, durationSec: dur, fallback: true }
  }
}
