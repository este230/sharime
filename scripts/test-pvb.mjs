import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { previewBehindFrame } from '../lib/render.mjs'
import { ensureDir } from '../lib/util.mjs'

const work = join(tmpdir(), 'pvb_test')
await ensureDir(work)
const seg = { in: 6, dur: 3, text: { content: 'OESCHINEN', x: 0.5, y: 0.72, size: 'lg', font: 'display', color: '#ffffff', anim: 'fade', behind: true } }
const jpeg = await previewBehindFrame({
  clipFile: 'C:\\Users\\esteb\\Downloads\\v24044gl0000d1pdt9vog65pbjh7kr4g.mp4',
  canvas: { w: 1080, h: 1920, fps: 30 }, inSec: 7.5, grade: 'cinematic-teal', adjust: { vignette: 35 }, seg, workDir: work,
})
writeFileSync(join(tmpdir(), 'pvb.jpg'), jpeg)
console.log('preview-behind jpeg bytes:', jpeg.length)
