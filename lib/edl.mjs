// edl.mjs — assemble an Edit Decision List (the shot-by-shot plan) from her clips,
// the music's beat grid, and ALAMO's recipe. Pure logic, no ffmpeg. The review
// UI edits this list directly; render.mjs turns it into pixels.

import { makeId, clamp } from './util.mjs'

const MIN_SEG = 0.4
const MAX_SEG = 4.0

function speedFactor(speed, index) {
  if (speed === 'slight-slowmo') return 0.85
  if (speed === 'dynamic') return index % 3 === 0 ? 0.8 : 1.0
  return 1.0
}

function titleCase(s) {
  return String(s || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function recipeTitle(recipe, title) {
  if (recipe?.textStyle !== 'minimal-location') return null
  const raw = recipe.locationTitle || recipe.title || title
  const clean = titleCase(raw).slice(0, 42)
  return clean || 'Travel Diary'
}

function autoText(recipe, title, index) {
  const content = index === 0 ? recipeTitle(recipe, title) : null
  if (!content) return null
  return {
    content,
    x: 0.5,
    y: 0.82,
    size: 'md',
    font: 'light',
    color: '#F7F3EA',
    anim: 'fade',
    behind: false,
  }
}

// clips: [{id,duration,...}], beats: [t...], recipe, musicSeconds, title
export function buildEdl({ clips, beats, recipe, musicSeconds, title }) {
  const usable = (clips || []).filter((c) => c.duration > 0.2)
  if (!usable.length) return { edl: [], totalDuration: 0, segDur: 0 }

  const period = beats && beats.length > 1 ? beats[1] - beats[0] : 0.6
  let segDur = clamp(period * (recipe.beatsPerCut || 2), MIN_SEG, MAX_SEG)
  const target = clamp(musicSeconds || segDur * usable.length, segDur, 600)

  // Keep edits watchable and renders quick: never produce more than ~70 shots.
  // On long songs with fast cutting this lengthens each shot to the nearest beat.
  const MAX_SHOTS = 70
  if (target / segDur > MAX_SHOTS) {
    const beatsToFit = Math.ceil(target / MAX_SHOTS / period)
    segDur = clamp(period * beatsToFit, MIN_SEG, MAX_SEG)
  }

  // Playback order: optional establishing shot first, then a rotation that never
  // repeats the same clip back-to-back.
  const order = [...usable]
  if (recipe.introWide) {
    order.sort((a, b) => b.duration - a.duration)
    const wide = order.shift()
    order.unshift(wide) // longest first; rest keep natural order
  }

  const cursors = new Map() // clipId -> next in-point, so repeats show new footage
  const edl = []
  let t = 0
  let i = 0
  let prevClipId = null
  while (t < target - 0.05) {
    let clip = order[i % order.length]
    if (order.length > 1 && clip.id === prevClipId) {
      i++
      clip = order[i % order.length]
    }
    const factor = speedFactor(recipe.speed, edl.length)
    const sourceNeeded = segDur * factor // slower playback needs less source
    let inPoint = cursors.get(clip.id) || 0
    if (inPoint + sourceNeeded > clip.duration) inPoint = 0
    const thisDur = Math.min(segDur, (clip.duration - inPoint) / factor, target - t)
    if (thisDur < MIN_SEG && edl.length > 0) break

    edl.push({
      id: makeId('seg'),
      clipId: clip.id,
      in: Math.round(inPoint * 1000) / 1000,
      dur: Math.round(thisDur * 1000) / 1000,
      speed: factor,
      grade: recipe.grade,
      transition: edl.length === 0 ? 'cut' : recipe.transition,
      transitionDur: edl.length === 0 ? 0 : recipe.transitionDur,
      text: autoText(recipe, title, edl.length),
    })

    cursors.set(clip.id, inPoint + sourceNeeded + 0.05)
    prevClipId = clip.id
    t += thisDur
    i++
  }

  const totalDuration = edl.reduce((sum, s) => sum + s.dur, 0)
  return { edl, totalDuration: Math.round(totalDuration * 1000) / 1000, segDur, period }
}
