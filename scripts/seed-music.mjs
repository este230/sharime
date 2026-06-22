// seed-music.mjs — generate a few royalty-free starter beds with ffmpeg so the
// library isn't empty on first run. These are simple synthesized ambient pads
// with a steady pulse (so beat detection locks). Replace them by dropping your
// own .mp3 / .wav files into the music/ folder.
//
// Run: npm run seed-music   (add --force to overwrite existing beds)

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { ffmpeg, ensureDir } from '../lib/util.mjs'
import { PATHS } from '../lib/store.mjs'

const FORCE = process.argv.includes('--force')
const DUR = 75

const BEDS = [
  { slug: 'Sunrise Drive', bpm: 100, chord: [220.0, 277.18, 329.63] },   // A major, bright
  { slug: 'Coastal Calm', bpm: 84, chord: [196.0, 246.94, 293.66] },     // G major, mellow
  { slug: 'City Pulse', bpm: 120, chord: [261.63, 329.63, 392.0] },      // C major, energetic
]

async function makeBed({ slug, bpm, chord }) {
  const out = join(PATHS.music, `${slug}.mp3`)
  if (existsSync(out) && !FORCE) { console.log(`skip  ${slug} (exists)`); return }
  const beatHz = (bpm / 60).toFixed(4)
  const fadeOut = (DUR - 2).toFixed(2)
  const args = [
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${chord[0]}:sample_rate=44100:duration=${DUR}`,
    '-f', 'lavfi', '-i', `sine=frequency=${chord[1]}:sample_rate=44100:duration=${DUR}`,
    '-f', 'lavfi', '-i', `sine=frequency=${chord[2]}:sample_rate=44100:duration=${DUR}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=brown:sample_rate=44100:duration=${DUR}:amplitude=0.35`,
    '-filter_complex', [
      '[0:a]volume=0.18[a0]',
      '[1:a]volume=0.13[a1]',
      '[2:a]volume=0.11[a2]',
      `[3:a]highpass=f=120,lowpass=f=1800,tremolo=f=${beatHz}:d=0.92,volume=0.55[beat]`,
      '[a0][a1][a2]amix=inputs=3:normalize=0,tremolo=f=0.12:d=0.5[pad]',
      `[pad][beat]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo,alimiter=limit=0.92,afade=in:st=0:d=1.2,afade=out:st=${fadeOut}:d=2[out]`,
    ].join(';'),
    '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '4', out,
  ]
  await ffmpeg(args)
  console.log(`wrote ${slug}.mp3  (~${bpm} BPM)`)
}

async function main() {
  await ensureDir(PATHS.music)
  for (const bed of BEDS) {
    try { await makeBed(bed) } catch (e) { console.error(`failed ${bed.slug}: ${e.message}`) }
  }
  console.log('done.')
}

main()
