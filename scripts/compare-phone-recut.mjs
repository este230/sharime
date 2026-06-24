// compare-phone-recut.mjs — run a real phone-feedback re-cut and leave a
// before/after audit under data/projects/<id>/comparisons/.
//
// Default use reads the project's saved reviewFeedback notes. For harness checks
// only, pass --notes "..." to supply temporary notes without changing project.json.

import { copyFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildEdl } from '../lib/edl.mjs'
import { deterministicRecipe, requestRecipe } from '../lib/alamo.mjs'
import { render } from '../lib/render.mjs'
import { ensureDir, ffmpeg, ffprobe } from '../lib/util.mjs'
import { PATHS, getProject, projectDir, subdir } from '../lib/store.mjs'

function argValue(name) {
  const flag = `--${name}`
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : ''
}

async function latestProjectId() {
  const ids = await readdir(PATHS.projects).catch(() => [])
  let latest = null
  for (const id of ids) {
    const p = await getProject(id)
    if (!p) continue
    if (!latest || String(p.updatedAt || p.createdAt || '').localeCompare(String(latest.updatedAt || latest.createdAt || '')) > 0) latest = p
  }
  return latest?.id || ''
}

function musicEditDuration(music) {
  const start = Math.max(0, Number(music?.start) || 0)
  const end = Number(music?.end) || 0
  if (end > start + 0.1) return end - start
  return Number(music?.duration) || 0
}

function musicEditBeats(music) {
  const beats = music?.beats || []
  const start = Math.max(0, Number(music?.start) || 0)
  const end = Number(music?.end) || 0
  if (end > start + 0.1) return beats.filter((b) => b >= start && b <= end).map((b) => b - start)
  return beats
}

function histogram(items) {
  const out = {}
  for (const item of items) out[item || 'none'] = (out[item || 'none'] || 0) + 1
  return out
}

function timelineMetrics(edl = []) {
  const total = edl.reduce((sum, s) => sum + (Number(s.dur) || 0), 0)
  const title = edl.find((s) => s.text)?.text || null
  return {
    shots: edl.length,
    durationSec: Number(total.toFixed(3)),
    avgShotSec: edl.length ? Number((total / edl.length).toFixed(3)) : 0,
    grades: histogram(edl.map((s) => s.grade)),
    transitions: histogram(edl.map((s) => s.transition)),
    title: title ? { content: title.content, x: title.x, y: title.y } : null,
  }
}

async function videoDuration(file) {
  const raw = await ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  return Number(Number(raw.trim()).toFixed(3))
}

async function phoneStill(video, outFile) {
  await ffmpeg(['-y', '-i', video, '-vf', 'scale=393:-2', '-frames:v', '1', '-q:v', '3', outFile])
}

function markdownReport({ project, notesSource, notes, before, after, paths }) {
  return `# Phone re-cut comparison — ${project.name}

Project: ${project.id}
Notes source: ${notesSource}
Notes: ${notes.replace(/\s+/g, ' ').trim()}

## Pacing
- Before: ${before.timeline.shots} shots, ${before.timeline.durationSec}s timeline, ${before.timeline.avgShotSec}s average shot.
- After: ${after.timeline.shots} shots, ${after.timeline.durationSec}s timeline, ${after.timeline.avgShotSec}s average shot.

## Color
- Before grades: ${JSON.stringify(before.timeline.grades)}
- After grades: ${JSON.stringify(after.timeline.grades)}

## Transitions
- Before transitions: ${JSON.stringify(before.timeline.transitions)}
- After transitions: ${JSON.stringify(after.timeline.transitions)}

## Title placement
- Before title: ${before.timeline.title ? JSON.stringify(before.timeline.title) : 'none'}
- After title: ${after.timeline.title ? JSON.stringify(after.timeline.title) : 'none'}

## Render proof
- Before render duration: ${before.videoDurationSec}s
- After render duration: ${after.videoDurationSec}s
- Before phone still: ${paths.beforePhone}
- After phone still: ${paths.afterPhone}
- After video: ${paths.afterVideo}
`
}

async function main() {
  const id = argValue('project') || await latestProjectId()
  if (!id) throw new Error('No project found. Create or load a project first.')
  const project = await getProject(id)
  if (!project) throw new Error(`Project not found: ${id}`)
  if (!project.edl?.length) throw new Error('Project has no existing EDL to compare against.')
  if (!project.music?.file || !project.music?.beats?.length) throw new Error('Project needs selected music with a beat grid.')
  if (!project.clips?.length) throw new Error('Project needs clips.')

  const suppliedNotes = argValue('notes')
  const savedNotes = String(project.reviewFeedback || '').trim()
  const notes = String(suppliedNotes || savedNotes).trim()
  const notesSource = suppliedNotes ? 'temporary --notes override' : 'saved project.reviewFeedback'
  if (!notes) throw new Error('No saved phone review notes found on this project. Add notes in Review, then run this again.')

  const beforeVideo = join(subdir(id, 'output'), 'final.mp4')
  if (!existsSync(beforeVideo)) throw new Error(`Before render missing: ${beforeVideo}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const comparisonDir = join(projectDir(id), 'comparisons', stamp)
  await ensureDir(comparisonDir)

  const beforeCopy = join(comparisonDir, 'before.mp4')
  const afterVideo = join(comparisonDir, 'after.mp4')
  const beforePhone = join(comparisonDir, 'before-phone-393w.jpg')
  const afterPhone = join(comparisonDir, 'after-phone-393w.jpg')
  await copyFile(beforeVideo, beforeCopy)

  const baseRecipe = project.reference?.fingerprint
    ? await requestRecipe({
      fingerprint: project.reference.fingerprint,
      referenceFile: project.reference.file,
      notes,
      clipCount: project.clips.length,
      musicBpm: project.music.bpm,
      musicSeconds: musicEditDuration(project.music),
      preset: project.canvas.preset,
    }).catch(() => deterministicRecipe(project.reference.fingerprint, { notes }))
    : deterministicRecipe({}, { notes })

  const { edl, totalDuration } = buildEdl({
    clips: project.clips,
    beats: musicEditBeats(project.music),
    recipe: baseRecipe,
    musicSeconds: musicEditDuration(project.music),
    title: project.name,
  })

  const clipsById = {}
  for (const c of project.clips) clipsById[c.id] = join(subdir(id, 'clips'), c.file)

  process.stdout.write(`Rendering feedback re-cut for ${project.name} (${id})...\n`)
  await render({
    canvas: project.canvas,
    edl,
    clipsById,
    musicFile: project.music.file,
    music: project.music,
    segmentsDir: subdir(id, 'segments'),
    workDir: join(comparisonDir, 'work'),
    outFile: afterVideo,
    adjust: project.adjust || null,
  }, {
    onProgress: (p) => process.stdout.write(`\r${p.phase || 'render'} ${p.percent ?? 0}%       `),
  })
  process.stdout.write('\n')

  await phoneStill(beforeCopy, beforePhone)
  await phoneStill(afterVideo, afterPhone)

  const before = { timeline: timelineMetrics(project.edl), videoDurationSec: await videoDuration(beforeCopy) }
  const after = { timeline: timelineMetrics(edl), videoDurationSec: await videoDuration(afterVideo), totalDuration }
  const paths = { beforeCopy, afterVideo, beforePhone, afterPhone }
  const report = markdownReport({ project, notesSource, notes, before, after, paths })
  const reportFile = join(comparisonDir, 'report.md')
  await writeFile(reportFile, report, 'utf8')

  console.log(`Report: ${reportFile}`)
  console.log(`Pacing: ${before.timeline.avgShotSec}s avg before -> ${after.timeline.avgShotSec}s avg after`)
  console.log(`Color: ${JSON.stringify(before.timeline.grades)} -> ${JSON.stringify(after.timeline.grades)}`)
  console.log(`Transitions: ${JSON.stringify(before.timeline.transitions)} -> ${JSON.stringify(after.timeline.transitions)}`)
  console.log(`Title: ${before.timeline.title ? JSON.stringify(before.timeline.title) : 'none'} -> ${after.timeline.title ? JSON.stringify(after.timeline.title) : 'none'}`)
}

main().catch((err) => {
  console.error(`compare-phone-recut failed: ${err.message}`)
  process.exit(1)
})
