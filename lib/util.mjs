// util.mjs — shared helpers: ids, json io, and a promise wrapper around ffmpeg/ffprobe.
// Zero npm dependencies by design; everything leans on Node built-ins + the
// system ffmpeg (full gyan.dev build already on PATH).

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

// A small, URL-safe id. Time-ordered prefix keeps project folders sortable.
let counter = 0
export function makeId(prefix = 'id') {
  counter = (counter + 1) % 1_000_000
  const rand = Math.random().toString(36).slice(2, 8)
  const tick = Date.now().toString(36)
  return `${prefix}_${tick}${counter.toString(36)}${rand}`
}

export async function ensureDir(dir) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  return dir
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

// Atomic-ish write: write to a temp sibling then rename, so a crash mid-write
// never leaves a half-written project.json.
export async function writeJson(file, value) {
  await ensureDir(dirname(file))
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

// Run ffmpeg/ffprobe and resolve with { code, stdout, stderr }. Never throws on
// a non-zero exit — callers decide what a failure means. onStderr lets the
// render pipeline scrape progress lines as they stream.
export function run(cmd, args, { onStderr, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    const out = []
    let stderr = ''
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => {
      const s = d.toString()
      stderr += s
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
      if (onStderr) onStderr(s)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8')
      resolve({ code, stdout, stderr })
    })
  })
}

export async function ffprobe(args) {
  const { code, stdout, stderr } = await run('ffprobe', args)
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr.slice(-400)}`)
  return stdout
}

// ffmpeg returns 0 on success. We surface the tail of stderr on failure since
// that's where ffmpeg explains itself.
export async function ffmpeg(args, opts = {}) {
  const { code, stderr, stdout } = await run('ffmpeg', args, opts)
  if (code !== 0) {
    const err = new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`)
    err.stderr = stderr
    throw err
  }
  return { stderr, stdout }
}

export function sanitizeName(name, fallback = 'file') {
  const base = String(name || '')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return base || fallback
}

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
