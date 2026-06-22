import { run } from '../lib/util.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const txt = join(tmpdir(), 'sh_probe.txt')
writeFileSync(txt, 'Santorini', 'utf8')
const SRC = 'testsrc2=size=320x180:rate=30:duration=0.3'
const fontWin = 'C:\\Windows\\Fonts\\seguisb.ttf'

const fontForms = {
  'fwd-esccolon': fontWin.replace(/\\/g, '/').replace(/:/g, '\\:'),
  'fwd-plaincolon-sq': `'${fontWin.replace(/\\/g, '/')}'`,
  'fwd-esccolon-sq': `'${fontWin.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
  'back-doubleesc': fontWin.replace(/\\/g, '\\\\').replace(/:/g, '\\:'),
  'fwd-doubleslash-esc': `${fontWin.replace(/\\/g, '/').replace(/:/g, '\\\\:')}`,
}

async function tryVf(label, vf) {
  const { code, stderr } = await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', SRC, '-vf', vf, '-frames:v', '1', '-f', 'null', '-'])
  console.log((code === 0 ? 'OK   ' : 'FAIL ') + label + (code !== 0 ? '   ' + (stderr.split('\n').filter(Boolean).slice(-1)[0] || '').slice(0, 90) : ''))
  return code === 0
}

console.log('== fontfile forms (inline text) ==')
let goodFont = null
for (const [name, ff] of Object.entries(fontForms)) {
  const ok = await tryVf(name, `drawtext=fontfile=${ff}:text=Hi:fontcolor=white:fontsize=20:x=10:y=10`)
  if (ok && !goodFont) goodFont = ff
}
console.log('\n== textfile forms (with first good fontfile) ==')
if (goodFont) {
  const tf = {
    'fwd-esccolon': txt.replace(/\\/g, '/').replace(/:/g, '\\:'),
    'fwd-esccolon-sq': `'${txt.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
  }
  for (const [name, t] of Object.entries(tf)) {
    await tryVf('textfile ' + name, `drawtext=fontfile=${goodFont}:textfile=${t}:fontcolor=white:fontsize=20:x=10:y=10`)
  }
} else {
  console.log('no working fontfile form found')
}
