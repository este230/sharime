// test-grades.mjs — render a tiny clip through every grade + a text overlay to
// confirm the filter strings are valid. node scripts/test-grades.mjs
import { GRADES } from '../lib/render.mjs'
import { ffmpeg } from '../lib/util.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const W = 640, H = 360
const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
const src = `testsrc2=size=${W}x${H}:rate=30:duration=0.4`

for (const [name, g] of Object.entries(GRADES)) {
  try {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${g},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), `g_${name}.mp4`)])
    console.log('OK   ' + name)
  } catch (e) { console.log('FAIL ' + name + '  ' + (e.stderr ? e.stderr.split('\n').filter(Boolean).slice(-1)[0] : e.message)) }
}

// drawtext
const txt = join(tmpdir(), 'sh_txt.txt')
writeFileSync(txt, "Santorini, Greece\nDay 3: it's golden", 'utf8')
const FONT = 'C:/Windows/Fonts/seguisb.ttf'
const esc = (p) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
const dt = `drawtext=fontfile=${esc(FONT)}:textfile=${esc(txt)}:fontcolor=white:fontsize=${Math.round(H / 15)}:expansion=none:line_spacing=6:shadowcolor=black@0.5:shadowx=2:shadowy=2:borderw=1:bordercolor=black@0.35:x=(w-text_w)/2:y=h-text_h-h*0.10`
try {
  await ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-vf', `${base},${dt},format=yuv420p`, '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', join(tmpdir(), 'g_text.mp4')])
  console.log('OK   drawtext (font: ' + FONT + ')')
} catch (e) { console.log('FAIL drawtext  ' + String(e.message).split('\n').pop()) }
