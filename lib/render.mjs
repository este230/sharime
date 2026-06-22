// render.mjs — turn an EDL into a finished MP4 with ffmpeg.
//
// Strategy (chosen for reliability over raw speed): normalize every shot to an
// identical canvas/fps/codec segment file, cache it by content hash, then join.
// Hard cuts join via the fast concat demuxer; crossfades via an xfade chain.
// Finally the chosen music is mixed over the joined video with fades.
//
// Caching by hash means re-rendering after a small timeline edit only re-encodes
// the shots that actually changed.

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { writeFile, unlink, stat, rename, rm } from 'node:fs/promises'
import { ffmpeg, ensureDir, run, makeId } from './util.mjs'
import { matteAvailable, runSegment } from './matte.mjs'

// Named color looks. Each is a linear ffmpeg filter fragment. The cinematic ones
// layer in vignette / grain / lifted-black curves for a graded-film feel.
const GRADES = {
  natural: 'eq=saturation=1.05',
  warm: 'colorbalance=rs=0.06:gs=0.02:bs=-0.06:rm=0.04:bm=-0.04,eq=saturation=1.1:gamma=1.02',
  'golden-hour': 'colorbalance=rh=0.10:gh=0.04:bh=-0.08:rm=0.05:bm=-0.04,eq=saturation=1.12:gamma=1.04:brightness=0.02,vignette=PI/5',
  'teal-orange': 'curves=preset=increase_contrast,colorbalance=rs=-0.06:bs=0.06:rh=0.08:bh=-0.06,eq=saturation=1.12',
  'cinematic-teal': 'curves=preset=increase_contrast,colorbalance=rs=-0.08:gs=-0.02:bs=0.10:rm=0.04:bm=-0.02:rh=0.10:gh=0.02:bh=-0.06,eq=contrast=1.06:saturation=1.06,vignette=PI/4.5',
  'cool-cinematic': 'colorbalance=bs=0.06:bm=0.03,eq=contrast=1.08:saturation=0.95',
  'muted-cool': 'eq=saturation=0.72:contrast=1.06,colorbalance=rs=-0.04:bs=0.06:rm=-0.02:bm=0.03:rh=-0.03:bh=0.05',
  moody: 'eq=saturation=0.82:contrast=1.12:brightness=-0.03,colorbalance=bs=0.05',
  noir: 'hue=s=0,eq=contrast=1.2:brightness=-0.02,curves=preset=increase_contrast,vignette=PI/4',
  'bleach-bypass': 'eq=saturation=0.35:contrast=1.26:brightness=-0.02,curves=preset=increase_contrast,vignette=PI/4.5',
  'film-fade': 'curves=r=0/0.06 1/0.96:g=0/0.06 1/0.96:b=0/0.09 1/0.93,eq=saturation=0.92:contrast=0.97,noise=alls=6:allf=t,vignette=PI/5',
  'cyber-neon': 'colorbalance=rs=0.04:bs=0.12:rm=-0.04:bm=0.08:rh=0.04:bh=0.06,eq=contrast=1.12:saturation=1.25,vignette=PI/4.5',
  vibrant: 'eq=saturation=1.22:contrast=1.05:brightness=0.02',
  'kodak-warm': 'curves=preset=increase_contrast,colorbalance=rs=0.04:rm=0.05:bm=-0.05:rh=0.06:bh=-0.05,eq=saturation=1.05:gamma=1.03',
  'fuji-vivid': 'eq=saturation=1.28:contrast=1.08,colorbalance=gs=0.03:bs=0.03',
  'cross-process': 'curves=preset=cross_process,eq=saturation=1.1:contrast=1.05',
  slate: 'eq=saturation=0.78:contrast=1.05,colorbalance=bs=0.05:bm=0.04:rh=-0.03,vignette=PI/5',
  ember: 'colorbalance=rs=0.05:rm=0.08:bm=-0.06:rh=0.09:bh=-0.07,eq=saturation=1.1:contrast=1.06:brightness=-0.01,vignette=PI/5',
  dreamy: 'eq=saturation=1.06:brightness=0.03:contrast=0.97,gblur=sigma=1.2,vignette=PI/6',
  vintage: 'curves=preset=vintage,eq=saturation=0.9',
}

function gradeFilter(name) {
  return GRADES[name] || GRADES.natural
}

// Text fonts: friendly keys -> candidate Windows font files.
const FONTS = {
  sans: ['C:/Windows/Fonts/seguisb.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  serif: ['C:/Windows/Fonts/georgiab.ttf', 'C:/Windows/Fonts/georgia.ttf', 'C:/Windows/Fonts/times.ttf'],
  display: ['C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  light: ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'],
}
function fontFile(key) {
  const candidates = FONTS[key] || FONTS.sans
  return candidates.find((f) => existsSync(f)) || candidates[candidates.length - 1]
}
function colorToFF(c) {
  if (!c) return 'white'
  const s = String(c).trim()
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return '0x' + s.replace('#', '')
  return s
}

// A Windows path for use inside an ffmpeg filtergraph: forward slashes, the "C:"
// colon escaped, and the whole thing single-quoted (verified the parser needs
// all three — see scripts/probe-text.mjs).
function escFilter(p) {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
}

// Manual grade adjustments (sharpness, shadows, highlights, contrast, saturation,
// warmth, exposure, vignette). Each slider is -100..100 (vignette/sharpness too).
// Returns a linear filter fragment (or '' if everything is neutral). Used by both
// the renderer and the live preview so what she tweaks is what she gets.
export function adjustFilter(a) {
  if (!a) return ''
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  const parts = []
  const exposure = n(a.exposure) / 100 * 0.3
  const contrast = 1 + n(a.contrast) / 100 * 0.5
  const saturation = 1 + n(a.saturation) / 100
  const eq = []
  if (Math.abs(exposure) > 0.001) eq.push(`brightness=${exposure.toFixed(3)}`)
  if (Math.abs(contrast - 1) > 0.001) eq.push(`contrast=${contrast.toFixed(3)}`)
  if (Math.abs(saturation - 1) > 0.001) eq.push(`saturation=${saturation.toFixed(3)}`)
  if (eq.length) parts.push('eq=' + eq.join(':'))
  const w = n(a.warmth) / 100 * 0.3
  if (Math.abs(w) > 0.001) parts.push(`colorbalance=rm=${w.toFixed(3)}:bm=${(-w).toFixed(3)}:rh=${(w * 0.8).toFixed(3)}:bh=${(-w * 0.8).toFixed(3)}`)
  const sh = n(a.shadows); const hi = n(a.highlights)
  const cl = []
  if (sh > 0) { const v = (sh / 100 * 0.25).toFixed(3); cl.push(`romin=${v}`, `gomin=${v}`, `bomin=${v}`) }
  else if (sh < 0) { const v = (-sh / 100 * 0.2).toFixed(3); cl.push(`rimin=${v}`, `gimin=${v}`, `bimin=${v}`) }
  if (hi < 0) { const v = (1 + hi / 100 * 0.25).toFixed(3); cl.push(`romax=${v}`, `gomax=${v}`, `bomax=${v}`) }
  else if (hi > 0) { const v = (1 - hi / 100 * 0.2).toFixed(3); cl.push(`rimax=${v}`, `gimax=${v}`, `bimax=${v}`) }
  if (cl.length) parts.push('colorlevels=' + cl.join(':'))
  const sp = n(a.sharpness)
  if (sp > 0) parts.push(`unsharp=5:5:${(sp / 100 * 1.5).toFixed(3)}:5:5:0`)
  else if (sp < 0) parts.push(`gblur=sigma=${(-sp / 100 * 2).toFixed(3)}`)
  const vg = n(a.vignette)
  if (vg > 0) parts.push(`vignette=angle=PI/${(6 - vg / 100 * 3.5).toFixed(2)}`)
  return parts.join(',')
}

// Build a drawtext fragment for a shot's text (or ''). Supports free x/y position
// (0..1 of frame), font/color/size, and time-based animation (fade / slide / pop).
// Text content comes from a file so arbitrary characters need no escaping.
function drawtextFilter(seg, canvas, txtFile) {
  const t = seg.text
  if (!t || !String(t.content || '').trim()) return ''
  const D = Math.max(0.2, seg.dur || 1)
  const sizes = { sm: canvas.h / 24, md: canvas.h / 15, lg: canvas.h / 10, xl: canvas.h / 7 }
  const fs = Math.round(sizes[t.size] || canvas.h / 15)
  const X = typeof t.x === 'number' ? Math.max(0, Math.min(1, t.x)) : 0.5
  const Y = typeof t.y === 'number' ? Math.max(0, Math.min(1, t.y)) : 0.85
  const fade = Math.min(0.4, D * 0.35).toFixed(2)
  const slide = Math.round(canvas.h * 0.06)
  let xExpr = `${X}*w-text_w/2`
  let yExpr = `${Y}*h-text_h/2`
  let alpha = '1'
  // x/y/alpha are emitted single-quoted below, so commas inside are literal.
  switch (t.anim) {
    case 'fade':
      alpha = `if(lt(t,${fade}),t/${fade},if(gt(t,${D}-${fade}),max(0,(${D}-t)/${fade}),1))`; break
    case 'slide-up':
      yExpr = `${Y}*h-text_h/2+${slide}*(1-min(t/${(D * 0.4).toFixed(2)},1))`; alpha = `min(t/${fade},1)`; break
    case 'slide-down':
      yExpr = `${Y}*h-text_h/2-${slide}*(1-min(t/${(D * 0.4).toFixed(2)},1))`; alpha = `min(t/${fade},1)`; break
    case 'pop':
      alpha = `min(t/${Math.min(0.18, D * 0.2).toFixed(2)},1)`; break
    default: break
  }
  const opts = [
    `fontfile=${escFilter(fontFile(t.font))}`,
    `textfile=${escFilter(txtFile)}`,
    `fontcolor=${colorToFF(t.color)}`,
    `fontsize=${fs}`, 'expansion=none', 'line_spacing=6',
    'shadowcolor=black@0.5', 'shadowx=2', 'shadowy=2',
    'borderw=2', 'bordercolor=black@0.4',
    `x='${xExpr}'`, `y='${yExpr}'`,
  ]
  if (alpha !== '1') opts.push(`alpha='${alpha}'`)
  return 'drawtext=' + opts.join(':')
}

function ffPath(p) {
  // concat list + filtergraph want forward slashes on Windows.
  return p.replace(/\\/g, '/')
}

function segHash(seg, canvas, mtimeMs, adjust) {
  return createHash('md5')
    .update(JSON.stringify({
      clipId: seg.clipId, in: seg.in, dur: seg.dur, speed: seg.speed, grade: seg.grade,
      text: seg.text || null, adjust: adjust || null,
      w: canvas.w, h: canvas.h, fps: canvas.fps, m: mtimeMs,
    }))
    .digest('hex')
    .slice(0, 16)
}

async function renderSegment(seg, clipFile, canvas, segmentsDir, adjust, onMatte) {
  let mtimeMs = 0
  try { mtimeMs = (await stat(clipFile)).mtimeMs } catch { /* leave 0 */ }
  const hash = segHash(seg, canvas, mtimeMs, adjust)
  const outFile = join(segmentsDir, `seg_${hash}.mp4`)
  if (existsSync(outFile)) return outFile

  const factor = seg.speed || 1
  const sourceNeeded = Math.max(0.1, seg.dur * factor)
  const base = `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},setsar=1`
  let vf = `${base},${gradeFilter(seg.grade)}`
  const adj = adjustFilter(adjust)
  if (adj) vf += ',' + adj
  if (factor !== 1) vf += `,setpts=${(1 / factor).toFixed(4)}*PTS`
  vf += ',format=yuv420p'

  const hasText = seg.text && String(seg.text.content || '').trim()
  const behind = Boolean(hasText && seg.text.behind && matteAvailable())

  // Text on TOP is baked here; text BEHIND is composited after segmentation.
  if (hasText && !behind) {
    const txtFile = join(segmentsDir, `seg_${hash}.txt`)
    await writeFile(txtFile, String(seg.text.content), 'utf8')
    const dt = drawtextFilter(seg, canvas, txtFile)
    if (dt) vf += ',' + dt
  }

  await ffmpeg([
    '-y',
    '-ss', String(seg.in),
    '-t', String(sourceNeeded),
    '-i', clipFile,
    '-an',
    '-vf', vf,
    '-r', String(canvas.fps),
    '-vsync', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    outFile,
  ])

  if (behind) await compositeBehind(seg, canvas, segmentsDir, hash, outFile, onMatte)
  return outFile
}

// Place text BETWEEN the background and the masked subject. outFile currently
// holds the graded, text-free segment; we segment its frames, draw the text on a
// copy, then overlay the masked subject back on top so it occludes the text.
async function compositeBehind(seg, canvas, segmentsDir, hash, outFile, onMatte) {
  const id = makeId('m')
  const framesDir = join(segmentsDir, `f_${id}`)
  const masksDir = join(segmentsDir, `k_${id}`)
  const graded = join(segmentsDir, `seg_${hash}_g.mp4`)
  try {
    if (onMatte) onMatte('Tracing the subject…')
    await ensureDir(framesDir); await ensureDir(masksDir)
    const ww = Math.min(canvas.w, 640)
    const wh = Math.round((ww * canvas.h) / canvas.w / 2) * 2
    await ffmpeg(['-y', '-i', outFile, '-vf', `scale=${ww}:${wh}`, join(framesDir, '%05d.png')])
    await runSegment(framesDir, masksDir, { onProgress: (s) => { if (onMatte && /frame/.test(s)) onMatte('Tracing the subject — ' + s.trim()) } })

    const txtFile = join(segmentsDir, `seg_${hash}.txt`)
    await writeFile(txtFile, String(seg.text.content), 'utf8')
    const dt = drawtextFilter(seg, canvas, txtFile)
    await rename(outFile, graded)
    await ffmpeg([
      '-y',
      '-i', graded,
      '-framerate', String(canvas.fps), '-i', join(masksDir, '%05d.png'),
      '-filter_complex',
      `[0:v]split=2[v0][v1];[v0]${dt}[bg];[1:v]scale=${canvas.w}:${canvas.h},format=gray,boxblur=1[m];[v1][m]alphamerge[fg];[bg][fg]overlay=shortest=1,format=yuv420p[out]`,
      '-map', '[out]', '-r', String(canvas.fps), '-vsync', 'cfr',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      outFile,
    ])
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {})
    await rm(masksDir, { recursive: true, force: true }).catch(() => {})
    await rm(graded, { force: true }).catch(() => {})
  }
}

async function concatHardCuts(segFiles, canvas, workDir) {
  const listFile = join(workDir, 'concat.txt')
  const body = segFiles.map((f) => `file '${ffPath(f)}'`).join('\n')
  await writeFile(listFile, body, 'utf8')
  const out = join(workDir, 'joined.mp4')
  // Segments share identical params, so a stream copy is safe and fast.
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out])
  await unlink(listFile).catch(() => {})
  return out
}

async function concatXfade(segFiles, edl, canvas, transition, workDir) {
  const T = transition === 'dip-to-black' ? 'fadeblack' : 'fade'
  const d = Math.max(0.1, Math.min(0.6, edl.find((s, i) => i > 0)?.transitionDur || 0.3))
  const inputs = []
  segFiles.forEach((f) => inputs.push('-i', f))

  const durs = edl.map((s) => s.dur)
  const filters = []
  let prevLabel = '[0:v]'
  let accLen = durs[0]
  for (let k = 1; k < segFiles.length; k++) {
    const offset = Math.max(0, accLen - d)
    const outLabel = k === segFiles.length - 1 ? '[v]' : `[x${k}]`
    filters.push(`${prevLabel}[${k}:v]xfade=transition=${T}:duration=${d}:offset=${offset.toFixed(3)}${outLabel}`)
    prevLabel = outLabel
    accLen = accLen + durs[k] - d
  }
  const out = join(workDir, 'joined.mp4')
  await ffmpeg([
    '-y', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[v]',
    '-r', String(canvas.fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    out,
  ])
  return out
}

async function muxMusic(videoFile, musicFile, outFile, videoDur) {
  const fadeOutStart = Math.max(0, videoDur - 1.4)
  await ffmpeg([
    '-y',
    '-i', videoFile,
    '-stream_loop', '-1', '-i', musicFile,
    '-t', String(videoDur),
    '-filter:a', `afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.4`,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outFile,
  ])
  return outFile
}

async function probeDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  const d = Number(String(stdout).trim())
  return Number.isFinite(d) ? d : 0
}

// ctx: { canvas:{w,h,fps}, edl, clipsById:{id->absPath}, musicFile, segmentsDir, workDir, outFile, adjust }
export async function render(ctx, { onProgress = () => {} } = {}) {
  const { canvas, edl, clipsById, musicFile, segmentsDir, workDir, outFile, adjust } = ctx
  if (!edl?.length) throw new Error('Nothing to render — the timeline is empty.')
  if (!musicFile) throw new Error('Choose music before rendering.')
  await ensureDir(segmentsDir)
  await ensureDir(workDir)

  // 1) Segments (the slow part) — cached, so report fine-grained progress.
  const segFiles = []
  for (let i = 0; i < edl.length; i++) {
    const seg = edl[i]
    const clipFile = clipsById[seg.clipId]
    if (!clipFile) throw new Error(`Missing clip for segment ${i + 1}.`)
    const pct = Math.round((i / edl.length) * 80)
    onProgress({ phase: 'shots', done: i, total: edl.length, percent: pct })
    const onMatte = (msg) => onProgress({ phase: 'matte', done: i, total: edl.length, percent: pct, message: msg })
    segFiles.push(await renderSegment(seg, clipFile, canvas, segmentsDir, adjust, onMatte))
  }

  // 2) Join.
  onProgress({ phase: 'joining', done: edl.length, total: edl.length, percent: 85 })
  const wantsTransition = edl.some((s, i) => i > 0 && s.transition !== 'cut' && (s.transitionDur || 0) > 0)
  const canXfade = wantsTransition && segFiles.length >= 2 && segFiles.length <= 50
  const transition = edl.find((s, i) => i > 0)?.transition || 'cut'
  const joined = canXfade
    ? await concatXfade(segFiles, edl, canvas, transition, workDir)
    : await concatHardCuts(segFiles, canvas, workDir)

  // 3) Music.
  onProgress({ phase: 'music', percent: 92 })
  const videoDur = (await probeDuration(joined)) || edl.reduce((s, x) => s + x.dur, 0)
  await ensureDir(join(outFile, '..'))
  await muxMusic(joined, musicFile, outFile, videoDur)
  await unlink(joined).catch(() => {})

  onProgress({ phase: 'done', percent: 100 })
  return { outFile, duration: videoDur }
}

// Render a single still of a shot with the grade + adjustments baked in, for the
// live preview. Text is NOT baked — the UI overlays draggable text on top so it
// can be dragged smoothly. Returns a JPEG buffer.
export async function previewFrame({ clipFile, canvas, inSec, grade, adjust, maxW = 760 }) {
  const ar = canvas.w / canvas.h
  let pw = Math.min(maxW, canvas.w)
  let ph = Math.round(pw / ar)
  const maxH = 720
  if (ph > maxH) { ph = maxH; pw = Math.round(ph * ar) }
  pw -= pw % 2; ph -= ph % 2
  const base = `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},setsar=1`
  let vf = `${base},${gradeFilter(grade)}`
  const adj = adjustFilter(adjust)
  if (adj) vf += ',' + adj
  vf += `,scale=${pw}:${ph},format=yuv420p`
  const { code, stdout } = await run('ffmpeg', [
    '-v', 'error', '-ss', String(Math.max(0, inSec)), '-i', clipFile,
    '-frames:v', '1', '-vf', vf, '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', '-',
  ], { binary: true })
  if (code !== 0 || !stdout.length) throw new Error('preview render failed')
  return stdout
}

// On-demand still that shows the "text behind subject" composite for one frame
// (segmentation is too slow for the live slider preview). Returns a JPEG buffer.
export async function previewBehindFrame({ clipFile, canvas, inSec, grade, adjust, seg, workDir }) {
  const id = makeId('pvb')
  const framesDir = join(workDir, `pvf_${id}`)
  const masksDir = join(workDir, `pvm_${id}`)
  try {
    await ensureDir(framesDir); await ensureDir(masksDir)
    const base = `scale=${canvas.w}:${canvas.h}:force_original_aspect_ratio=increase,crop=${canvas.w}:${canvas.h},setsar=1`
    let vf = `${base},${gradeFilter(grade)}`
    const adj = adjustFilter(adjust); if (adj) vf += ',' + adj
    vf += ',format=yuv420p'
    const framePng = join(framesDir, '00001.png')
    await ffmpeg(['-y', '-ss', String(Math.max(0, inSec)), '-i', clipFile, '-frames:v', '1', '-vf', vf, framePng])
    await runSegment(framesDir, masksDir)
    const maskPng = join(masksDir, '00001.png')
    let pw = Math.min(760, canvas.w); let ph = Math.round(pw / (canvas.w / canvas.h))
    if (ph > 720) { ph = 720; pw = Math.round((ph * canvas.w) / canvas.h) }
    pw -= pw % 2; ph -= ph % 2
    const hasText = seg && seg.text && String(seg.text.content || '').trim()
    let fc
    if (hasText) {
      const txtFile = join(framesDir, 't.txt')
      await writeFile(txtFile, String(seg.text.content), 'utf8')
      const still = { ...seg, dur: 1, text: { ...seg.text, anim: 'none' } }
      const dt = drawtextFilter(still, canvas, txtFile)
      fc = `[0:v]split=2[v0][v1];[v0]${dt}[bg];[1:v]scale=${canvas.w}:${canvas.h},format=gray,boxblur=1[m];[v1][m]alphamerge[fg];[bg][fg]overlay,scale=${pw}:${ph},format=yuvj420p[out]`
    } else {
      fc = `[0:v]scale=${pw}:${ph},format=yuvj420p[out]`
    }
    const { code, stdout } = await run('ffmpeg', ['-v', 'error', '-i', framePng, '-i', maskPng, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', '-'], { binary: true })
    if (code !== 0 || !stdout.length) throw new Error('behind preview failed')
    return stdout
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {})
    await rm(masksDir, { recursive: true, force: true }).catch(() => {})
  }
}

export { GRADES }
