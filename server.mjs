// server.mjs — Sharime's local server. Serves the UI, handles uploads, drives the
// edit engine, and proxies the editing brain to the ALAMO gateway. Localhost-only.
//
// Run: node server.mjs   (or the "Sharime" desktop shortcut)

import http from 'node:http'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { readdir, copyFile, rm, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { ensureDir, makeId, sanitizeName } from './lib/util.mjs'
import { probe, makeThumb } from './lib/media.mjs'
import { analyzeBeats } from './lib/beats.mjs'
import { fingerprintReference } from './lib/fingerprint.mjs'
import { requestRecipe, houseRecipe, requestSuggestions, gatewayStatus } from './lib/alamo.mjs'
import { buildEdl } from './lib/edl.mjs'
import { render, previewFrame, previewBehindFrame } from './lib/render.mjs'
import { matteAvailable } from './lib/matte.mjs'
import {
  PATHS, PRESETS, createProject, getProject, saveProject, listProjects,
  deleteProject, projectDir, subdir,
} from './lib/store.mjs'

const PORT = Number(process.env.SHARIME_PORT || 4188)
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
}
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])

// ---- one active job per project (auto-edit or render) -----------------------
const jobs = new Map()
function setJob(projectId, patch) {
  const cur = jobs.get(projectId) || {}
  const next = { ...cur, ...patch }
  jobs.set(projectId, next)
  return next
}

function musicEditDuration(music) {
  if (!music) return 0
  const duration = Math.max(0, Number(music.duration) || 0)
  const start = Math.max(0, Math.min(Number(music.start) || 0, Math.max(0, duration - 0.1)))
  const end = Number(music.end) || 0
  if (end > start + 0.1) return Math.max(0.1, Math.min(end, duration || end) - start)
  return Math.max(0.1, duration - start)
}

function musicEditBeats(music) {
  const start = Math.max(0, Number(music?.start) || 0)
  const span = musicEditDuration(music)
  const shifted = (music?.beats || [])
    .filter((b) => b >= start && b <= start + span + 0.001)
    .map((b) => Math.round((b - start) * 1000) / 1000)
  return shifted.length > 1 ? shifted : (music?.beats || [])
}

function sanitizeReviewFeedback(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').slice(0, 1200)
}

// ---- tiny response helpers --------------------------------------------------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}
function notFound(res, msg = 'Not found') { sendJson(res, 404, { error: msg }) }
function bad(res, msg) { sendJson(res, 400, { error: msg }) }

async function readJsonBody(req) {
  const chunks = []
  for await (const c of req) {
    chunks.push(c)
    if (Buffer.concat(chunks).length > 2_000_000) throw new Error('body too large')
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

// Stream a request body straight to disk (raw-body upload — no multipart lib).
async function uploadToFile(req, destFile) {
  await ensureDir(join(destFile, '..'))
  await pipeline(req, createWriteStream(destFile))
  return destFile
}

// Static / media file serving with HTTP Range (so <video> can seek).
function serveFile(req, res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return notFound(res)
  const size = statSync(filePath).size
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1
    if (Number.isNaN(start)) start = 0
    if (Number.isNaN(end) || end >= size) end = size - 1
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end() }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type,
    })
    createReadStream(filePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
    createReadStream(filePath).pipe(res)
  }
}

// ---- engine orchestration ---------------------------------------------------
async function runAutoEdit(project, notes) {
  const id = project.id
  try {
    setJob(id, { id: makeId('job'), kind: 'autoedit', status: 'running', percent: 10, phase: 'thinking', message: 'Reading your style…', error: null })
    project.status = 'editing'
    await saveProject(project)

    if (!project.music?.beats?.length) throw new Error('Choose music first.')
    if (!project.clips?.length) throw new Error('Add some clips first.')

    let recipe
    if (project.reference?.fingerprint) {
      setJob(id, { percent: 35, message: 'Asking ALAMO to match the look…' })
      recipe = await requestRecipe({
        fingerprint: project.reference.fingerprint,
        referenceFile: project.reference.file,
        notes,
        clipCount: project.clips.length,
        musicBpm: project.music.bpm,
        musicSeconds: musicEditDuration(project.music),
        preset: project.canvas.preset,
      })
    } else {
      recipe = houseRecipe({ notes })
    }
    if (notes) recipe.userNotes = String(notes).slice(0, 300)

    setJob(id, { percent: 70, phase: 'cutting', message: 'Cutting to the beat…' })
    const { edl, totalDuration } = buildEdl({
      clips: project.clips,
      beats: musicEditBeats(project.music),
      recipe,
      musicSeconds: musicEditDuration(project.music),
      title: project.name,
    })

    project.recipe = recipe
    project.edl = edl
    project.status = 'ready'
    await saveProject(project)
    setJob(id, { status: 'done', percent: 100, phase: 'done', message: 'Draft ready', result: { recipe, edl, totalDuration } })
  } catch (err) {
    project.status = 'ready'
    await saveProject(project).catch(() => {})
    setJob(id, { status: 'error', error: String(err?.message || err) })
  }
}

async function runRender(project) {
  const id = project.id
  try {
    setJob(id, { id: makeId('job'), kind: 'render', status: 'running', percent: 0, phase: 'starting', message: 'Preparing…', error: null })
    project.status = 'rendering'
    await saveProject(project)

    const clipsById = {}
    for (const c of project.clips) clipsById[c.id] = join(subdir(id, 'clips'), c.file)
    const ctx = {
      canvas: project.canvas,
      edl: project.edl,
      clipsById,
      musicFile: project.music.file,
      music: project.music,
      segmentsDir: subdir(id, 'segments'),
      workDir: subdir(id, 'work'),
      outFile: join(subdir(id, 'output'), 'final.mp4'),
      adjust: project.adjust || null,
    }
    const { duration } = await render(ctx, {
      onProgress: (p) => setJob(id, { percent: p.percent ?? 0, phase: p.phase, message: phaseMessage(p) }),
    })

    project.output = { file: 'output/final.mp4', duration, renderedAt: new Date().toISOString() }
    project.status = 'done'
    await saveProject(project)
    setJob(id, { status: 'done', percent: 100, phase: 'done', message: 'Your video is ready', result: project.output })
  } catch (err) {
    project.status = 'ready'
    await saveProject(project).catch(() => {})
    setJob(id, { status: 'error', error: String(err?.message || err) })
  }
}

function phaseMessage(p) {
  if (p.phase === 'matte') return `${p.message || 'Tracing the subject'} (shot ${(p.done || 0) + 1} of ${p.total})…`
  if (p.phase === 'shots') return `Rendering shot ${(p.done || 0) + 1} of ${p.total}…`
  if (p.phase === 'joining') return 'Stitching the cut together…'
  if (p.phase === 'music') return 'Mixing in the music…'
  if (p.phase === 'done') return 'Finishing…'
  return 'Working…'
}

// ---- library ----------------------------------------------------------------
async function listLibraryMusic() {
  await ensureDir(PATHS.music)
  const files = await readdir(PATHS.music).catch(() => [])
  const out = []
  for (const f of files) {
    if (!AUDIO_EXT.has(extname(f).toLowerCase())) continue
    out.push({ name: f, label: basename(f, extname(f)) })
  }
  out.sort((a, b) => a.label.localeCompare(b.label))
  return out
}

// ---- router -----------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const seg = url.pathname.split('/').filter(Boolean)
  const method = req.method

  // static UI
  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(req, res, join(PATHS.public, 'index.html'))
  if (method === 'GET' && url.pathname === '/app.js') return serveFile(req, res, join(PATHS.public, 'app.js'))
  if (method === 'GET' && url.pathname === '/styles.css') return serveFile(req, res, join(PATHS.public, 'styles.css'))
  if (method === 'GET' && url.pathname === '/favicon.svg') return serveFile(req, res, join(PATHS.public, 'favicon.svg'))
  if (method === 'GET' && seg[0] === 'assets') return serveFile(req, res, join(PATHS.public, 'assets', ...seg.slice(1)))

  // api
  if (seg[0] !== 'api') return notFound(res)

  if (method === 'GET' && seg[1] === 'health') return sendJson(res, 200, { ok: true, port: PORT, matte: matteAvailable() })
  if (method === 'GET' && seg[1] === 'presets') return sendJson(res, 200, { presets: PRESETS })
  if (method === 'GET' && seg[1] === 'alamo' && seg[2] === 'status') return sendJson(res, 200, await gatewayStatus())

  if (method === 'GET' && seg[1] === 'library' && seg[2] === 'music') return sendJson(res, 200, { tracks: await listLibraryMusic() })
  if (method === 'GET' && seg[1] === 'library' && seg[2] === 'file') {
    const name = sanitizeName(url.searchParams.get('name') || '')
    const file = join(PATHS.music, name)
    if (!file.startsWith(PATHS.music)) return notFound(res)
    return serveFile(req, res, file)
  }

  // projects collection
  if (seg[1] === 'projects' && seg.length === 2) {
    if (method === 'GET') return sendJson(res, 200, { projects: await listProjects() })
    if (method === 'POST') {
      const body = await readJsonBody(req)
      const project = await createProject({ name: body.name, preset: body.preset })
      return sendJson(res, 201, { project })
    }
  }

  // everything below needs a project id
  if (seg[1] === 'projects' && seg[2]) {
    const id = seg[2]
    const project = await getProject(id)
    if (!project) return notFound(res, 'Project not found')

    // /api/projects/:id
    if (seg.length === 3) {
      if (method === 'GET') return sendJson(res, 200, { project })
      if (method === 'DELETE') { await deleteProject(id); return sendJson(res, 200, { ok: true }) }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req)
        if (typeof body.name === 'string') project.name = sanitizeName(body.name, project.name)
        if (typeof body.preset === 'string' && PRESETS[body.preset]) {
          project.canvas = { ...PRESETS[body.preset], preset: body.preset }
        }
        if (body.adjust && typeof body.adjust === 'object') project.adjust = sanitizeAdjust(body.adjust)
        if (typeof body.reviewFeedback === 'string') project.reviewFeedback = sanitizeReviewFeedback(body.reviewFeedback)
        await saveProject(project)
        return sendJson(res, 200, { project })
      }
    }

    const sub = seg[3]

    // job status
    if (sub === 'job' && method === 'GET') return sendJson(res, 200, { job: jobs.get(id) || null })

    // clips
    if (sub === 'clips' && method === 'POST') {
      const fname = sanitizeName(req.headers['x-filename'] || 'clip.mp4', 'clip.mp4')
      const ext = extname(fname).toLowerCase() || '.mp4'
      if (!VIDEO_EXT.has(ext)) return bad(res, `Unsupported video type: ${ext}`)
      const clipId = makeId('clip')
      const stored = `${clipId}${ext}`
      const dest = join(subdir(id, 'clips'), stored)
      await uploadToFile(req, dest)
      const meta = await probe(dest).catch(() => null)
      if (!meta || !meta.hasVideo) { await rm(dest, { force: true }); return bad(res, 'That file is not a readable video.') }
      const thumbName = `${clipId}.jpg`
      await makeThumb(dest, join(subdir(id, 'thumbs'), thumbName), { atSeconds: Math.min(1, meta.duration * 0.3) }).catch(() => {})
      const clip = {
        id: clipId, file: stored, name: fname,
        duration: Math.round(meta.duration * 100) / 100,
        width: meta.width, height: meta.height, thumb: thumbName,
      }
      project.clips.push(clip)
      await saveProject(project)
      return sendJson(res, 201, { clip })
    }
    if (sub === 'clips' && seg[4] && method === 'DELETE') {
      const clipId = seg[4]
      const clip = project.clips.find((c) => c.id === clipId)
      project.clips = project.clips.filter((c) => c.id !== clipId)
      project.edl = (project.edl || []).filter((s) => s.clipId !== clipId)
      if (clip) {
        await rm(join(subdir(id, 'clips'), clip.file), { force: true }).catch(() => {})
        await rm(join(subdir(id, 'thumbs'), clip.thumb || ''), { force: true }).catch(() => {})
      }
      await saveProject(project)
      return sendJson(res, 200, { ok: true, project })
    }

    // music upload
    if (sub === 'music' && seg.length === 4 && method === 'POST') {
      const fname = sanitizeName(req.headers['x-filename'] || 'music.mp3', 'music.mp3')
      const ext = extname(fname).toLowerCase() || '.mp3'
      if (!AUDIO_EXT.has(ext)) return bad(res, `Unsupported audio type: ${ext}`)
      const dest = join(projectDir(id), `music${ext}`)
      await uploadToFile(req, dest)
      const meta = await probe(dest).catch(() => null)
      if (!meta || !meta.hasAudio) { await rm(dest, { force: true }); return bad(res, 'That file has no audio.') }
      const beats = await analyzeBeats(dest, meta.duration)
      project.music = {
        file: dest, name: fname, source: 'upload',
        duration: Math.round(meta.duration * 100) / 100,
        bpm: beats.bpm, beats: beats.beats, period: beats.period,
      }
      await saveProject(project)
      return sendJson(res, 201, { music: publicMusic(project.music) })
    }
    if (sub === 'music' && seg.length === 4 && (method === 'PUT' || method === 'PATCH')) {
      if (!project.music?.file) return bad(res, 'Choose music first.')
      const body = await readJsonBody(req)
      const duration = Math.max(0, Number(project.music.duration) || 0)
      const start = Math.max(0, Math.min(Number(body.start) || 0, Math.max(0, duration - 0.1)))
      const rawEnd = Number(body.end) || 0
      const end = rawEnd > start + 0.1 ? Math.min(rawEnd, duration || rawEnd) : 0
      project.music.start = Math.round(start * 100) / 100
      project.music.end = end ? Math.round(end * 100) / 100 : 0
      await saveProject(project)
      return sendJson(res, 200, { music: publicMusic(project.music) })
    }
    // music pick from library
    if (sub === 'music' && seg[4] === 'select' && method === 'POST') {
      const body = await readJsonBody(req)
      const name = sanitizeName(body.name || '')
      const src = join(PATHS.music, name)
      if (!src.startsWith(PATHS.music) || !existsSync(src)) return bad(res, 'Track not found in library.')
      const meta = await probe(src).catch(() => null)
      if (!meta || !meta.hasAudio) return bad(res, 'That track has no audio.')
      const beats = await analyzeBeats(src, meta.duration)
      project.music = {
        file: src, name, source: 'library',
        duration: Math.round(meta.duration * 100) / 100,
        bpm: beats.bpm, beats: beats.beats, period: beats.period,
      }
      await saveProject(project)
      return sendJson(res, 200, { music: publicMusic(project.music) })
    }

    // reference upload / clear
    if (sub === 'reference' && method === 'POST') {
      const fname = sanitizeName(req.headers['x-filename'] || 'reference.mp4', 'reference.mp4')
      const ext = extname(fname).toLowerCase() || '.mp4'
      if (!VIDEO_EXT.has(ext)) return bad(res, `Unsupported video type: ${ext}`)
      const dest = join(projectDir(id), `reference${ext}`)
      await uploadToFile(req, dest)
      const meta = await probe(dest).catch(() => null)
      if (!meta || !meta.hasVideo) { await rm(dest, { force: true }); return bad(res, 'That reference is not a readable video.') }
      const fingerprint = await fingerprintReference(dest)
      project.reference = { file: dest, name: fname, fingerprint }
      await saveProject(project)
      return sendJson(res, 201, { reference: { name: fname, fingerprint } })
    }
    if (sub === 'reference' && method === 'DELETE') {
      if (project.reference?.file) await rm(project.reference.file, { force: true }).catch(() => {})
      project.reference = null
      await saveProject(project)
      return sendJson(res, 200, { ok: true })
    }

    // auto-edit
    if (sub === 'auto-edit' && method === 'POST') {
      if (jobs.get(id)?.status === 'running') return bad(res, 'A job is already running for this project.')
      const body = await readJsonBody(req).catch(() => ({}))
      runAutoEdit(project, body.notes) // fire and forget; client polls /job
      return sendJson(res, 202, { started: true })
    }

    // live preview frame (grade + adjustments baked; text overlaid by the UI)
    if (sub === 'preview' && method === 'GET') {
      const i = parseInt(url.searchParams.get('shot') || '0', 10)
      const seg = (project.edl || [])[i]
      if (!seg) return notFound(res, 'No such shot')
      const clip = project.clips.find((c) => c.id === seg.clipId)
      if (!clip) return notFound(res, 'No clip')
      const clipFile = join(subdir(id, 'clips'), clip.file)
      const inSec = Math.max(0, (Number(seg.in) || 0) + (Number(seg.dur) || 1) / 2)
      const grade = url.searchParams.get('grade') || seg.grade || 'natural'
      const adjust = parseAdjustParams(url.searchParams)
      const wantBehind = url.searchParams.get('behind') === '1' && matteAvailable()
      try {
        const jpeg = wantBehind
          ? await previewBehindFrame({ clipFile, canvas: project.canvas, inSec, grade, adjust, seg, workDir: subdir(id, 'work') })
          : await previewFrame({ clipFile, canvas: project.canvas, inSec, grade, adjust })
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
        return res.end(jpeg)
      } catch (e) {
        return sendJson(res, 500, { error: String(e.message || e) })
      }
    }

    // tips from ALAMO (improve this video + what to film next time)
    if (sub === 'suggestions' && method === 'POST') {
      const ctx = {
        canvas: project.canvas,
        clips: (project.clips || []).map((c) => ({ w: c.width, h: c.height, duration: c.duration })),
        musicBpm: project.music?.bpm,
        musicSeconds: project.music?.duration,
        reference: project.reference?.fingerprint || null,
        recipe: project.recipe || null,
        edlLength: (project.edl || []).length,
      }
      const suggestions = await requestSuggestions(ctx)
      return sendJson(res, 200, { suggestions })
    }

    // save edited timeline
    if (sub === 'edl' && method === 'PUT') {
      const body = await readJsonBody(req)
      const clean = sanitizeEdl(body.edl, project)
      project.edl = clean
      await saveProject(project)
      return sendJson(res, 200, { edl: clean })
    }

    // render
    if (sub === 'render' && method === 'POST') {
      if (jobs.get(id)?.status === 'running') return bad(res, 'A job is already running for this project.')
      if (!project.edl?.length) return bad(res, 'Make a draft first.')
      if (!project.music?.file) return bad(res, 'Choose music first.')
      runRender(project)
      return sendJson(res, 202, { started: true })
    }

    // media serving
    if (sub === 'media') {
      const kind = seg[4]
      if (kind === 'clip' && seg[5]) {
        const clip = project.clips.find((c) => c.id === seg[5])
        if (!clip) return notFound(res)
        return serveFile(req, res, join(subdir(id, 'clips'), clip.file))
      }
      if (kind === 'thumb' && seg[5]) {
        const clip = project.clips.find((c) => c.id === seg[5])
        if (!clip) return notFound(res)
        return serveFile(req, res, join(subdir(id, 'thumbs'), clip.thumb))
      }
      if (kind === 'reference') {
        if (!project.reference?.file) return notFound(res)
        return serveFile(req, res, project.reference.file)
      }
      if (kind === 'music') {
        if (!project.music?.file) return notFound(res)
        return serveFile(req, res, project.music.file)
      }
      if (kind === 'output') {
        const f = join(subdir(id, 'output'), 'final.mp4')
        return serveFile(req, res, f)
      }
    }
  }

  return notFound(res)
}

function publicMusic(m) {
  return { name: m.name, source: m.source, duration: m.duration, bpm: m.bpm, beatCount: m.beats?.length || 0, start: m.start || 0, end: m.end || 0 }
}

const ADJUST_KEYS = ['exposure', 'contrast', 'saturation', 'warmth', 'sharpness', 'shadows', 'highlights', 'vignette']
function parseAdjustParams(sp) {
  const a = {}
  for (const k of ADJUST_KEYS) { const v = sp.get(k); if (v != null) a[k] = Math.max(-100, Math.min(100, Number(v) || 0)) }
  return a
}
function sanitizeAdjust(obj) {
  const a = {}
  for (const k of ADJUST_KEYS) a[k] = Math.max(-100, Math.min(100, Number(obj[k]) || 0))
  return a
}

// Keep only valid segments that point at clips the project still has.
function sanitizeEdl(edl, project) {
  if (!Array.isArray(edl)) return project.edl || []
  const clipIds = new Set(project.clips.map((c) => c.id))
  const clipById = new Map(project.clips.map((c) => [c.id, c]))
  const out = []
  for (const s of edl) {
    if (!s || !clipIds.has(s.clipId)) continue
    const clip = clipById.get(s.clipId)
    const inn = Math.max(0, Math.min(Number(s.in) || 0, Math.max(0, clip.duration - 0.2)))
    const dur = Math.max(0.3, Math.min(Number(s.dur) || 1, 8))
    out.push({
      id: s.id || makeId('seg'),
      clipId: s.clipId,
      in: Math.round(inn * 1000) / 1000,
      dur: Math.round(dur * 1000) / 1000,
      speed: Number(s.speed) > 0 ? Number(s.speed) : 1,
      grade: typeof s.grade === 'string' ? s.grade : (project.recipe?.grade || 'natural'),
      transition: typeof s.transition === 'string' ? s.transition : 'cut',
      transitionDur: Math.max(0, Math.min(Number(s.transitionDur) || 0, 0.6)),
      text: s.text || null,
    })
  }
  return out
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) sendJson(res, 500, { error: String(err?.message || err) })
    else res.end()
  })
})

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Sharimie running at http://${HOST}:${PORT}`)
})
