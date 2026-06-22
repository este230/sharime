// analyze.mjs — fingerprint reference videos (and ask ALAMO to describe the style).
// Usage: node scripts/analyze.mjs <file1> <file2> ...

import { fingerprintReference } from '../lib/fingerprint.mjs'
import { probe } from '../lib/media.mjs'
import { requestRecipe } from '../lib/alamo.mjs'

const files = process.argv.slice(2)
if (!files.length) { console.error('pass video paths'); process.exit(1) }

for (const f of files) {
  console.log('\n=== ' + f.split(/[\\/]/).pop() + ' ===')
  try {
    const meta = await probe(f)
    console.log(`probe: ${meta.width}x${meta.height} ${meta.duration.toFixed(1)}s @${meta.fps}fps audio=${meta.hasAudio}`)
    const fp = await fingerprintReference(f)
    console.log('fingerprint:', JSON.stringify(fp, null, 2))
    const recipe = await requestRecipe({
      fingerprint: fp, referenceFile: f, notes: '',
      clipCount: 12, musicBpm: fp.tempoBpm || 120, musicSeconds: 30, preset: fp.aspect,
    })
    console.log('ALAMO recipe:', JSON.stringify(recipe))
  } catch (e) {
    console.error('FAILED:', e.message)
  }
}
console.log('\ndone.')
