// fingerprint.mjs — measure the *style* of a reference video she likes.
//
// We don't try to understand content; we measure the levers that define a travel
// edit's feel: how often it cuts (pacing/energy), how bright/saturated/warm the
// image is (color grade direction), the aspect ratio, and the music tempo. These
// numbers become the prompt ALAMO reasons over to choose an edit recipe.

import { run } from './util.mjs'
import { probe } from './media.mjs'
import { analyzeBeats } from './beats.mjs'

// Count scene changes -> pacing. The metadata filter prints one block per frame
// that survives the scene threshold; we read those from ffmpeg's log (writing to
// a file is unreliable because a Windows path's ":" breaks filtergraph parsing).
async function sceneCuts(file) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-i', file, '-an',
    '-vf', "select='gt(scene,0.3)',metadata=mode=print",
    '-f', 'null', '-',
  ])
  const matches = stderr.match(/pts_time:/g)
  return matches ? matches.length : 0
}

// Average luma / saturation / hue across the clip via signalstats, sampled 2x/sec.
async function colorStats(file) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-i', file, '-an',
    '-vf', 'fps=2,signalstats,metadata=mode=print',
    '-f', 'null', '-',
  ])
  const avg = (key) => {
    const re = new RegExp(`signalstats\\.${key}=([\\d.]+)`, 'g')
    let m
    let sum = 0
    let n = 0
    while ((m = re.exec(stderr))) { sum += Number(m[1]); n++ }
    return n ? sum / n : null
  }
  return { YAVG: avg('YAVG'), SATAVG: avg('SATAVG'), HUEAVG: avg('HUEAVG') }
}

function classifyMood({ brightness, saturation, warmth }) {
  if (saturation != null && saturation < 0.12) {
    return brightness != null && brightness < 0.4 ? 'moody' : 'muted'
  }
  if (warmth != null && warmth > 0.25) return 'warm'
  if (warmth != null && warmth < -0.25) return 'cool'
  if (saturation != null && saturation > 0.38) return 'vibrant'
  return 'natural'
}

function classifyEnergy(cutsPerMinute) {
  if (cutsPerMinute >= 30) return 'high'
  if (cutsPerMinute >= 12) return 'medium'
  return 'low'
}

function aspectOf(w, h) {
  if (!w || !h) return 'landscape'
  const r = w / h
  if (r > 1.2) return 'landscape'
  if (r < 0.85) return 'vertical'
  return 'square'
}

export async function fingerprintReference(file) {
  const meta = await probe(file)
  const dur = meta.duration || 0

  let cuts = 0
  let color = { YAVG: null, SATAVG: null, HUEAVG: null }
  if (meta.hasVideo) {
    ;[cuts, color] = await Promise.all([sceneCuts(file), colorStats(file)])
  }

  const cutsPerMinute = dur > 0 ? Math.round((cuts / dur) * 600) / 10 : 0
  const avgShotLengthSec = cuts > 0 ? Math.round((dur / (cuts + 1)) * 100) / 100 : dur

  const brightness = color.YAVG != null ? clamp01((color.YAVG - 16) / 219) : null
  const saturation = color.SATAVG != null ? clamp01(color.SATAVG / 160) : null
  let warmth = null
  if (color.HUEAVG != null) {
    const rad = (color.HUEAVG * Math.PI) / 180
    warmth = Math.round(Math.cos(rad) * 100) / 100 // red/orange ~ +1, cyan/blue ~ -1
  }

  let tempoBpm = null
  if (meta.hasAudio) {
    try {
      const b = await analyzeBeats(file, dur)
      tempoBpm = b.bpm
    } catch {
      tempoBpm = null
    }
  }

  const colorMood = classifyMood({ brightness, saturation, warmth })
  const energy = classifyEnergy(cutsPerMinute)
  const aspect = aspectOf(meta.width, meta.height)

  const fp = {
    durationSec: Math.round(dur * 100) / 100,
    width: meta.width,
    height: meta.height,
    aspect,
    sceneCuts: cuts,
    cutsPerMinute,
    avgShotLengthSec,
    brightness,
    saturation,
    warmth,
    hueAvg: color.HUEAVG != null ? Math.round(color.HUEAVG) : null,
    colorMood,
    energy,
    hasAudio: meta.hasAudio,
    tempoBpm,
  }
  fp.summary = describeFingerprint(fp)
  return fp
}

function describeFingerprint(fp) {
  const parts = []
  parts.push(`${fp.aspect} ${fp.width}x${fp.height}, ${fp.durationSec}s long`)
  parts.push(`${fp.energy}-energy pacing (~${fp.cutsPerMinute} cuts/min, ~${fp.avgShotLengthSec}s per shot)`)
  parts.push(`color reads ${fp.colorMood}`)
  if (fp.brightness != null) parts.push(`brightness ${(fp.brightness * 100).toFixed(0)}%`)
  if (fp.saturation != null) parts.push(`saturation ${(fp.saturation * 100).toFixed(0)}%`)
  if (fp.tempoBpm) parts.push(`music ~${fp.tempoBpm} BPM`)
  return parts.join('; ')
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}
