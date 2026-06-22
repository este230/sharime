// probe-anim.mjs — find the escaping form ffmpeg accepts for drawtext expressions
// that contain commas (alpha fade, x/y slide). Spawn, no shell.
import { run } from '../lib/util.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const txt = join(tmpdir(), 'sh_anim.txt')
writeFileSync(txt, 'Hello', 'utf8')
const font = 'C:/Windows/Fonts/seguisb.ttf'
const efont = `'${font.replace(/:/g, '\\:')}'`
const etxt = `'${txt.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
const SRC = 'testsrc2=size=320x180:rate=30:duration=0.4'

async function tryVf(label, alphaOpt) {
  const vf = `drawtext=fontfile=${efont}:textfile=${etxt}:fontcolor=white:fontsize=20:x=20:y=20:${alphaOpt}`
  const { code, stderr } = await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', SRC, '-vf', vf, '-frames:v', '1', '-f', 'null', '-'])
  console.log((code === 0 ? 'OK   ' : 'FAIL ') + label + (code !== 0 ? '   ' + (stderr.split('\n').filter(Boolean).slice(-1)[0] || '').slice(0, 80) : ''))
}

const D = 0.4, fade = 0.14
// A: quoted, commas NOT escaped
await tryVf('A quoted-plaincommas', `alpha='if(lt(t,${fade}),t/${fade},1)'`)
// B: unquoted, commas escaped \,
await tryVf('B unquoted-esccommas', `alpha=if(lt(t\\,${fade})\\,t/${fade}\\,1)`)
// C: quoted AND commas escaped
await tryVf('C quoted-esccommas', `alpha='if(lt(t\\,${fade})\\,t/${fade}\\,1)'`)
