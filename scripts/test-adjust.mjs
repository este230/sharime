// test-adjust.mjs — validate adjustFilter, previewFrame, and animated drawtext.
import { adjustFilter, previewFrame, GRADES } from '../lib/render.mjs'
import { ffmpeg } from '../lib/util.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const W = 640, H = 360
const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
const src = `testsrc2=size=${W}x${H}:rate=30:duration=0.4`
const tail = (e) => (e.stderr ? e.stderr.split('\n').filter(Boolean).slice(-1)[0] : e.message)

const adj = adjustFilter({ exposure: 20, contrast: 30, saturation: 25, warmth: 40, sharpness: 60, shadows: 40, highlights: -30, vignette: 50 })
console.log('adjust =>', adj)
try { await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${adj},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), 'adj.mp4')]); console.log('OK   adjust render') } catch (e) { console.log('FAIL adjust  ' + tail(e)) }

try { await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${GRADES['cinematic-teal']},${adj},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), 'gadj.mp4')]); console.log('OK   grade+adjust') } catch (e) { console.log('FAIL grade+adjust  ' + tail(e)) }

// negative sharpness (blur) + negative shadows (crush) path
const adj2 = adjustFilter({ sharpness: -40, shadows: -30, highlights: 30 })
console.log('adjust2 =>', adj2)
try { await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${adj2},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), 'adj2.mp4')]); console.log('OK   adjust negative paths') } catch (e) { console.log('FAIL adjust2  ' + tail(e)) }

// previewFrame
const clip = join(tmpdir(), 'pf_clip.mp4')
await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip])
try { const jpeg = await previewFrame({ clipFile: clip, canvas: { w: 1920, h: 1080, fps: 30 }, inSec: 1, grade: 'golden-hour', adjust: { sharpness: 50, shadows: 30, vignette: 40 } }); writeFileSync(join(tmpdir(), 'preview.jpg'), jpeg); console.log('OK   previewFrame  ' + jpeg.length + ' bytes') } catch (e) { console.log('FAIL previewFrame  ' + tail(e)) }

// animated drawtext (fade + slide-up) — exact expression shape from render.mjs
const txt = join(tmpdir(), 'anim.txt'); writeFileSync(txt, 'Santorini', 'utf8')
const efont = `'${'C:/Windows/Fonts/seguisb.ttf'.replace(/:/g, '\\:')}'`
const etxt = `'${txt.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
const D = 0.4, fade = 0.14
for (const [name, alpha, y] of [
  ['fade', `if(lt(t,${fade}),t/${fade},if(gt(t,${D}-${fade}),max(0,(${D}-t)/${fade}),1))`, '0.85*h-text_h/2'],
  ['slide-up', `min(t/${fade},1)`, `0.85*h-text_h/2+22*(1-min(t/0.16,1))`],
]) {
  const dt = `drawtext=fontfile=${efont}:textfile=${etxt}:fontcolor=0xF5D76E:fontsize=40:expansion=none:shadowcolor=black@0.5:shadowx=2:shadowy=2:borderw=2:bordercolor=black@0.4:x='0.5*w-text_w/2':y='${y}':alpha='${alpha}'`
  try { await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${dt},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), `anim_${name}.mp4`)]); console.log('OK   animated text: ' + name) } catch (e) { console.log('FAIL animated ' + name + '  ' + tail(e)) }
}
