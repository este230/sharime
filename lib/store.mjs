// store.mjs — on-disk project state. One folder per project under data/projects/<id>,
// holding the uploaded media plus a single project.json. No database needed.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdir, rm } from 'node:fs/promises'
import { makeId, ensureDir, readJson, writeJson, sanitizeName } from './util.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // projects/sharime
export const PATHS = {
  root: ROOT,
  data: join(ROOT, 'data'),
  projects: join(ROOT, 'data', 'projects'),
  music: join(ROOT, 'music'), // shared starter + saved library
  public: join(ROOT, 'public'),
}

export const PRESETS = {
  landscape: { w: 1920, h: 1080, fps: 30, label: 'Landscape 16:9' },
  vertical: { w: 1080, h: 1920, fps: 30, label: 'Vertical 9:16' },
  square: { w: 1080, h: 1080, fps: 30, label: 'Square 1:1' },
}

export function projectDir(id) {
  return join(PATHS.projects, id)
}
export function projectFile(id) {
  return join(projectDir(id), 'project.json')
}
export function subdir(id, name) {
  return join(projectDir(id), name)
}

export async function createProject({ name, preset = 'landscape' }) {
  const id = makeId('proj')
  const p = PRESETS[preset] ? preset : 'landscape'
  const canvas = { ...PRESETS[p], preset: p }
  const project = {
    id,
    name: sanitizeName(name, 'Untitled trip'),
    createdAt: new Date().toISOString(),
    canvas,
    clips: [],
    music: null,
    reference: null,
    recipe: null,
    edl: [],
    adjust: { exposure: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, shadows: 0, highlights: 0, vignette: 0 },
    output: null,
    status: 'new',
  }
  await ensureDir(projectDir(id))
  await ensureDir(subdir(id, 'clips'))
  await ensureDir(subdir(id, 'thumbs'))
  await writeJson(projectFile(id), project)
  return project
}

export async function getProject(id) {
  return readJson(projectFile(id), null)
}

export async function saveProject(project) {
  project.updatedAt = new Date().toISOString()
  await writeJson(projectFile(project.id), project)
  return project
}

export async function listProjects() {
  await ensureDir(PATHS.projects)
  const ids = await readdir(PATHS.projects).catch(() => [])
  const out = []
  for (const id of ids) {
    const p = await getProject(id)
    if (p) {
      out.push({
        id: p.id, name: p.name, createdAt: p.createdAt, status: p.status,
        canvas: p.canvas, clipCount: p.clips?.length || 0,
        hasMusic: Boolean(p.music), hasReference: Boolean(p.reference), hasOutput: Boolean(p.output),
      })
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

export async function deleteProject(id) {
  await rm(projectDir(id), { recursive: true, force: true })
  return true
}
