// alamo.mjs — Sharime's brain. Talks to the always-on personal Hermes gateway
// (OpenAI-compatible, 127.0.0.1:8642) using the exact server-side-key pattern
// proven in alamo-hermes-os/hermes-chat.mjs. The gateway key is read from the
// Hermes profile .env and never reaches the browser.
//
// ALAMO's one job here: read the measured fingerprint of a reference she likes
// (optionally *looking* at sampled frames) and return a structured edit recipe.
// If the gateway is down or replies with junk, deterministicRecipe() keeps the
// editor fully functional — ALAMO makes it smarter, it is never a hard dependency.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { run } from './util.mjs'

const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8642'
const DEFAULT_PROFILE = 'personal'
const DEFAULT_MODEL = 'gpt-5.5'
const STATUS_TIMEOUT_MS = 4_000
const RECIPE_TIMEOUT_MS = 120_000

export const GRADES = [
  'natural', 'warm', 'golden-hour', 'teal-orange', 'cinematic-teal', 'cool-cinematic',
  'muted-cool', 'moody', 'noir', 'bleach-bypass', 'film-fade', 'cyber-neon',
  'vibrant', 'dreamy', 'vintage',
]
export const TRANSITIONS = ['cut', 'crossfade', 'dip-to-black']
export const SPEEDS = ['normal', 'slight-slowmo', 'dynamic']

export function loadConfig({ env = process.env, home } = {}) {
  const homeDir = home || userInfo().homedir || env.USERPROFILE || env.HOME || ''
  const overridePath = join(homeDir, '.config', 'alamo-os', 'hermes-chat.json')
  let override = {}
  if (existsSync(overridePath)) {
    try {
      override = JSON.parse(readFileSync(overridePath, 'utf8'))
    } catch {
      override = {}
    }
  }
  const profile = String(override.profile || env.ALAMO_CHAT_PROFILE || DEFAULT_PROFILE)
  const hermesHome = String(
    override.hermesHome || env.HERMES_HOME || join(homeDir, 'AppData', 'Local', 'hermes'),
  )
  return {
    gatewayUrl: String(override.gatewayUrl || env.ALAMO_CHAT_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, ''),
    profile,
    model: String(override.model || env.SHARIME_ALAMO_MODEL || DEFAULT_MODEL),
    apiKey: typeof override.apiKey === 'string' && override.apiKey.trim() ? override.apiKey.trim() : null,
    profileEnvPath: join(hermesHome, 'profiles', profile, '.env'),
  }
}

export function readGatewayKey(config) {
  if (config.apiKey) return config.apiKey
  try {
    if (!existsSync(config.profileEnvPath)) return null
    const line = readFileSync(config.profileEnvPath, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('API_SERVER_KEY='))
    const key = line ? line.slice('API_SERVER_KEY='.length).trim() : ''
    return key || null
  } catch {
    return null
  }
}

export async function gatewayStatus(config = loadConfig()) {
  const key = readGatewayKey(config)
  const status = { up: false, authOk: false, keyPresent: Boolean(key), detail: '', model: config.model }
  try {
    const res = await fetch(`${config.gatewayUrl}/v1/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    })
    status.up = true
    status.authOk = res.ok
    status.detail = res.ok ? 'ALAMO is online.' : `Gateway reachable but auth failed (HTTP ${res.status}).`
  } catch {
    status.detail = 'ALAMO gateway not reachable — using built-in styling.'
  }
  return status
}

// Non-streaming chat call. content may be a string or an OpenAI multimodal array.
async function chat(content, config = loadConfig()) {
  const key = readGatewayKey(config)
  if (!key) throw new Error('no gateway key')
  const res = await fetch(`${config.gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, stream: false, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(RECIPE_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`)
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty reply')
  return text
}

// Pull a few evenly-spaced frames as base64 jpegs so ALAMO can literally see the
// reference. Returns [] on any trouble (vision is a bonus, never required).
async function sampleFrames(file, durationSec, count = 3, width = 512) {
  const frames = []
  const dur = durationSec || 0
  for (let i = 0; i < count; i++) {
    const t = dur > 0 ? (dur * (i + 0.5)) / count : 0
    try {
      const { code, stdout } = await run(
        'ffmpeg',
        ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
          '-vf', `scale=${width}:-2`, '-f', 'image2', '-c:v', 'mjpeg', '-'],
        { binary: true },
      )
      if (code === 0 && stdout.length > 0) {
        frames.push(`data:image/jpeg;base64,${stdout.toString('base64')}`)
      }
    } catch {
      /* skip this frame */
    }
  }
  return frames
}

function buildPrompt({ fingerprint, notes, clipCount, musicBpm, musicSeconds, preset }) {
  return [
    'You are ALAMO, the editing brain inside Sharimie, a video editor for my wife who makes travel videos.',
    'She gave you a reference video whose STYLE she wants to emulate (not its footage).',
    'Below are measurements of that reference plus the materials for her new edit.',
    'Choose an edit recipe that recreates the reference\'s feel using her own clips and chosen music.',
    'Esteban\'s example references leaned cool, desaturated, cinematic, and punchy; when the measurements are ambiguous, bias toward muted-cool color, hard cuts, dynamic motion, and 1.5-beat edits.',
    '',
    `REFERENCE FINGERPRINT:\n${JSON.stringify(fingerprint, null, 2)}`,
    notes ? `\nHER NOTES (what she liked): ${notes}` : '',
    `\nHER MATERIALS: ${clipCount} clips, music ~${musicBpm || 'unknown'} BPM and ~${Math.round(musicSeconds || 0)}s long.`,
    `TARGET CANVAS: ${preset}.`,
    '',
    'Respond with ONLY a JSON object (no prose, no code fence) with EXACTLY these keys:',
    `  "grade": one of ${JSON.stringify(GRADES)}  // color look`,
    `  "beatsPerCut": number 0.5-4            // how many music beats each shot lasts (lower = punchier)`,
    `  "transition": one of ${JSON.stringify(TRANSITIONS)}`,
    `  "transitionDur": number 0-0.6          // seconds, 0 for hard cut`,
    `  "speed": one of ${JSON.stringify(SPEEDS)}`,
    `  "introWide": boolean                    // open on the longest/widest establishing shot`,
    `  "textStyle": "none" | "minimal-location"`,
    `  "vibe": short phrase describing the feel`,
    `  "notes": one sentence on why this recreates the reference`,
  ].filter(Boolean).join('\n')
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('no json object')
  return JSON.parse(raw.slice(start, end + 1))
}

function coerceRecipe(obj, fallback) {
  const pick = (val, allowed, def) => (allowed.includes(val) ? val : def)
  const num = (val, lo, hi, def) => {
    const n = Number(val)
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def
  }
  return {
    grade: pick(obj.grade, GRADES, fallback.grade),
    beatsPerCut: num(obj.beatsPerCut, 0.5, 4, fallback.beatsPerCut),
    transition: pick(obj.transition, TRANSITIONS, fallback.transition),
    transitionDur: num(obj.transitionDur, 0, 0.6, fallback.transitionDur),
    speed: pick(obj.speed, SPEEDS, fallback.speed),
    introWide: typeof obj.introWide === 'boolean' ? obj.introWide : fallback.introWide,
    textStyle: obj.textStyle === 'minimal-location' ? 'minimal-location' : 'none',
    vibe: String(obj.vibe || fallback.vibe).slice(0, 120),
    notes: String(obj.notes || fallback.notes).slice(0, 300),
    source: 'alamo',
  }
}

// Pure, fingerprint-derived recipe. Always available.
export function deterministicRecipe(fingerprint = {}, _opts = {}) {
  const energy = fingerprint.energy || 'high'
  const cutsPerMinute = Number(fingerprint.cutsPerMinute)
  const avgShotLengthSec = Number(fingerprint.avgShotLengthSec)
  const punchyReference = Number.isFinite(cutsPerMinute)
    ? cutsPerMinute >= 24
    : Number.isFinite(avgShotLengthSec) && avgShotLengthSec <= 2.8
  const beatsPerCut = energy === 'low' ? 4 : (punchyReference || energy === 'high' ? 1.5 : 2)
  const moodToGrade = {
    warm: 'warm', cool: 'cool-cinematic', moody: 'moody',
    vibrant: 'vibrant', muted: 'muted-cool', natural: 'natural',
  }
  const saturation = Number(fingerprint.saturation)
  const warmth = Number(fingerprint.warmth)
  const exampleLook = fingerprint.colorMood === 'muted'
    || (fingerprint.colorMood === 'natural'
      && Number.isFinite(saturation) && saturation <= 0.28
      && (!Number.isFinite(warmth) || warmth <= 0.15))
  const grade = exampleLook ? 'muted-cool' : moodToGrade[fingerprint.colorMood] || 'muted-cool'
  const transition = energy === 'low' ? 'crossfade' : 'cut'
  return {
    grade,
    beatsPerCut,
    transition,
    transitionDur: transition === 'crossfade' ? 0.4 : 0,
    speed: energy === 'low' ? 'slight-slowmo' : 'dynamic',
    introWide: true,
    textStyle: 'none',
    vibe: `${energy}-energy ${grade} travel cut`,
    notes: 'Built from the reference measurements with Esteban\'s cool, punchy example style as the fallback bias (ALAMO offline).',
    source: 'built-in',
  }
}

// Sharime's "house style" when she hasn't given a reference — tuned to the cool,
// desaturated, punchy beat-cut look across the example travel videos she liked.
export function houseRecipe() {
  return {
    grade: 'muted-cool',
    beatsPerCut: 1.5,
    transition: 'cut',
    transitionDur: 0,
    speed: 'dynamic',
    introWide: true,
    textStyle: 'none',
    vibe: 'cool cinematic travel montage',
    notes: 'Sharimie house style — cool, desaturated, beat-matched cuts. Add a reference video to match a specific look.',
    source: 'built-in',
  }
}

// Main entry: returns a recipe object. Tries ALAMO (with vision), falls back cleanly.
export async function requestRecipe({ fingerprint, referenceFile, notes, clipCount, musicBpm, musicSeconds, preset }, config = loadConfig()) {
  const fallback = deterministicRecipe(fingerprint)
  const key = readGatewayKey(config)
  if (!key) return fallback

  const promptText = buildPrompt({ fingerprint, notes, clipCount, musicBpm, musicSeconds, preset })

  // First attempt: multimodal (let ALAMO see the reference).
  if (referenceFile) {
    try {
      const frames = await sampleFrames(referenceFile, fingerprint?.durationSec, 3)
      if (frames.length) {
        const content = [
          { type: 'text', text: `${promptText}\n\nHere are ${frames.length} frames sampled from the reference:` },
          ...frames.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
        const reply = await chat(content, config)
        return coerceRecipe(extractJson(reply), fallback)
      }
    } catch {
      /* vision unsupported or failed — fall through to text-only */
    }
  }

  // Text-only attempt.
  try {
    const reply = await chat(promptText, config)
    return coerceRecipe(extractJson(reply), fallback)
  } catch {
    return fallback
  }
}

// ---- suggestions: how to improve THIS video + what to film next time ---------

// Always-available, computed from the project's own numbers.
export function deterministicSuggestions(ctx = {}) {
  const clips = ctx.clips || []
  const improvements = []
  const canvasPortrait = ctx.canvas && ctx.canvas.h > ctx.canvas.w

  const lowRes = clips.filter((c) => Math.min(c.w || 0, c.h || 0) > 0 && Math.min(c.w, c.h) < 720)
  if (lowRes.length) {
    improvements.push({ tip: 'Film in 1080p or higher', why: `${lowRes.length} clip(s) are below 720p, which looks soft once graded and cropped.` })
  }
  if (clips.length && clips.length < 5) {
    improvements.push({ tip: 'Add more clips — aim for 8–15', why: `${clips.length} clips over a ${Math.round(ctx.musicSeconds || 0)}s song means shots repeat a lot.` })
  }
  const mismatched = clips.filter((c) => c.w && c.h && (c.h > c.w) !== canvasPortrait)
  if (mismatched.length) {
    improvements.push({ tip: `Shoot ${canvasPortrait ? 'vertical' : 'horizontal'} for this format`, why: `${mismatched.length} clip(s) are the other orientation and will be cropped to fill the frame.` })
  }
  const shortOnes = clips.filter((c) => c.duration && c.duration < 2)
  if (clips.length && shortOnes.length === clips.length) {
    improvements.push({ tip: 'Capture a few longer 5–8s shots', why: 'Every clip is short, so there is no calm establishing footage to open or breathe with.' })
  }
  if (!improvements.length) {
    improvements.push({ tip: 'Looking good — try a reference video', why: 'Drop in a style you love and ALAMO will match its pacing and color.' })
  }

  const nextShots = [
    'A slow, wide establishing shot of the location',
    'A close-up detail — food, hands, textures, signage',
    'A walking or POV motion shot to add energy',
    'Golden-hour light (the hour after sunrise / before sunset)',
    'A reveal — start low or hidden, then pan up to the view',
    'A transition move — whip-pan or pass your hand over the lens',
  ]
  return { improvements: improvements.slice(0, 5), nextShots, source: 'built-in' }
}

export async function requestSuggestions(ctx = {}, config = loadConfig()) {
  const fallback = deterministicSuggestions(ctx)
  const key = readGatewayKey(config)
  if (!key) return fallback

  const clips = ctx.clips || []
  const prompt = [
    'You are ALAMO, the editing coach inside Sharimie, a travel-video app for my wife.',
    'Give warm, specific, practical advice — no fluff. Two parts: how to improve THIS video right now, and what to film next time for better results.',
    '',
    `PROJECT: ${ctx.canvas?.preset || 'landscape'} ${ctx.canvas?.w}x${ctx.canvas?.h}.`,
    `CLIPS (${clips.length}): durations ${JSON.stringify(clips.map((c) => Math.round(c.duration)))}s, sizes ${JSON.stringify(clips.map((c) => `${c.w}x${c.h}`))}.`,
    `MUSIC: ~${ctx.musicBpm || '?'} BPM, ${Math.round(ctx.musicSeconds || 0)}s.`,
    `REFERENCE STYLE: ${ctx.reference?.summary || 'none given'}.`,
    `CURRENT EDIT: ${ctx.edlLength || 0} shots, grade "${ctx.recipe?.grade || '?'}", ${ctx.recipe?.beatsPerCut || '?'} beats per cut.`,
    '',
    'Respond with ONLY JSON (no prose, no fence):',
    '{"improvements":[{"tip":"short imperative","why":"one short reason"}],"nextShots":["short concrete shot idea"]}',
    'Limit improvements to 5 and nextShots to 6. Tailor them to the numbers above.',
  ].join('\n')

  try {
    const reply = await chat(prompt, config)
    const obj = extractJson(reply)
    const improvements = Array.isArray(obj.improvements) ? obj.improvements
      .filter((x) => x && x.tip).slice(0, 5)
      .map((x) => ({ tip: String(x.tip).slice(0, 120), why: String(x.why || '').slice(0, 200) })) : []
    const nextShots = Array.isArray(obj.nextShots) ? obj.nextShots
      .filter(Boolean).slice(0, 6).map((s) => String(s).slice(0, 140)) : []
    if (!improvements.length && !nextShots.length) return fallback
    return { improvements: improvements.length ? improvements : fallback.improvements, nextShots: nextShots.length ? nextShots : fallback.nextShots, source: 'alamo' }
  } catch {
    return fallback
  }
}
