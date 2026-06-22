// test-behind.mjs — render one shot with "text behind subject" and confirm the
// composite runs. node scripts/test-behind.mjs
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { render } from '../lib/render.mjs'
import { matteAvailable } from '../lib/matte.mjs'
import { ensureDir } from '../lib/util.mjs'
import { PATHS } from '../lib/store.mjs'

console.log('matte available:', matteAvailable())
const clip = 'C:\\Users\\esteb\\Downloads\\v24044gl0000d1pdt9vog65pbjh7kr4g.mp4'
const work = join(tmpdir(), 'behind_test')
await ensureDir(work)
const canvas = { w: 1080, h: 1920, fps: 30, preset: 'vertical' }
const edl = [{
  id: 's1', clipId: 'c1', in: 6, dur: 3, speed: 1, grade: 'cinematic-teal', transition: 'cut', transitionDur: 0,
  text: { content: 'OESCHINEN', x: 0.5, y: 0.72, size: 'lg', font: 'display', color: '#ffffff', anim: 'none', behind: true },
}]
const ctx = {
  canvas, edl, clipsById: { c1: clip },
  musicFile: join(PATHS.music, 'Coastal Calm.mp3'),
  segmentsDir: join(work, 'segments'), workDir: join(work, 'work'), outFile: join(work, 'out.mp4'),
  adjust: { vignette: 35, contrast: 10 },
}
const r = await render(ctx, { onProgress: (p) => { if (p.message) process.stdout.write('\r  ' + p.message + '                         ') } })
console.log('\nrendered:', JSON.stringify(r))
console.log('output:', ctx.outFile)
