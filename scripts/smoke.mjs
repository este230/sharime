// smoke.mjs — end-to-end backend test. Generates throwaway clips, runs the full
// pipeline against a running server, and ffprobes the rendered output.
// Run the server first (npm start), then: node scripts/smoke.mjs

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { ffmpeg, ffprobe, ensureDir } from '../lib/util.mjs'

const BASE = `http://127.0.0.1:${process.env.SHARIME_PORT || 4188}`
const WORK = join(tmpdir(), 'sharime_smoke')

async function gen() {
  await ensureDir(WORK)
  const clips = [
    { f: join(WORK, 'c1.mp4'), src: 'testsrc2=size=1920x1080:rate=30:duration=6' },
    { f: join(WORK, 'c2.mp4'), src: 'mandelbrot=size=1280x720:rate=30', t: 6 },
    { f: join(WORK, 'c3.mp4'), src: 'rgbtestsrc=size=1280x720:rate=30:duration=6' },
  ]
  for (const c of clips) {
    const args = ['-y', '-f', 'lavfi', '-i', c.src]
    if (c.t) args.push('-t', String(c.t))
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', c.f)
    await ffmpeg(args)
  }
  // reference with scene changes (3 colors x 2s)
  const ref = join(WORK, 'ref.mp4')
  await ffmpeg(['-y',
    '-f', 'lavfi', '-i', 'color=c=0xE76F51:s=1280x720:d=2:r=30',
    '-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=1280x720:d=2:r=30',
    '-f', 'lavfi', '-i', 'color=c=0xF4A261:s=1280x720:d=2:r=30',
    '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ref])
  return { clips: clips.map((c) => c.f), ref }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${data ? data.error : ''}`)
  return data
}

async function upload(path, file) {
  const buf = await readFile(file)
  return api(path, { method: 'POST', body: buf, headers: { 'X-Filename': file.split(/[\\/]/).pop() } })
}

async function waitJob(id) {
  for (let i = 0; i < 600; i++) {
    const { job } = await api(`/api/projects/${id}/job`)
    if (job && job.status !== 'running') return job
    if (job) process.stdout.write(`\r   ${job.phase} ${job.percent || 0}%  ${job.message || ''}            `)
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('job timed out')
}

async function main() {
  console.log('1. generating test media…')
  const { clips, ref } = await gen()

  console.log('2. health + alamo…')
  console.log('   health:', JSON.stringify(await api('/api/health')))
  console.log('   alamo :', JSON.stringify(await api('/api/alamo/status')))

  console.log('3. create project…')
  const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Smoke Trip', preset: 'landscape' }), headers: { 'Content-Type': 'application/json' } })
  const id = project.id
  console.log('   id:', id)

  console.log('4. upload clips…')
  for (const c of clips) { const r = await upload(`/api/projects/${id}/clips`, c); console.log('   +', r.clip.name, r.clip.duration + 's') }

  console.log('5. select music…')
  console.log('   ', JSON.stringify((await api(`/api/projects/${id}/music/select`, { method: 'POST', body: JSON.stringify({ name: 'City Pulse.mp3' }), headers: { 'Content-Type': 'application/json' } })).music))

  console.log('6. upload reference…')
  const rr = await upload(`/api/projects/${id}/reference`, ref)
  console.log('   fingerprint:', rr.reference.fingerprint.summary)

  console.log('7. auto-edit (ALAMO)…')
  await api(`/api/projects/${id}/auto-edit`, { method: 'POST', body: JSON.stringify({ notes: 'fast punchy cuts, warm sunset look' }), headers: { 'Content-Type': 'application/json' } })
  const j1 = await waitJob(id)
  console.log('\n   recipe:', JSON.stringify(j1.result.recipe))
  console.log('   shots:', j1.result.edl.length, ' total:', j1.result.totalDuration + 's')

  console.log('8. render…')
  await api(`/api/projects/${id}/render`, { method: 'POST' })
  const j2 = await waitJob(id)
  console.log('\n   render:', JSON.stringify(j2.result))

  console.log('9. probe output…')
  const out = join('data', 'projects', id, 'output', 'final.mp4')
  const probe = JSON.parse(await ffprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out]))
  const v = probe.streams.find((s) => s.codec_type === 'video')
  const a = probe.streams.find((s) => s.codec_type === 'audio')
  console.log(`   output: ${v.width}x${v.height} ${Number(probe.format.duration).toFixed(1)}s  video=${v.codec_name} audio=${a ? a.codec_name : 'NONE'}`)
  console.log('\nSMOKE PASS  project id:', id)
}

main().catch((e) => { console.error('\nSMOKE FAIL:', e.message); process.exit(1) })
