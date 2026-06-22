// media.mjs — probe video/audio files and make thumbnails.

import { join } from 'node:path'
import { ffprobe, ffmpeg, ensureDir } from './util.mjs'

// Returns { duration, width, height, fps, hasAudio, hasVideo, codec }.
export async function probe(file) {
  const json = await ffprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ])
  const data = JSON.parse(json)
  const streams = data.streams || []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const duration = Number(
    data.format?.duration || v?.duration || a?.duration || 0,
  )
  let fps = 30
  if (v?.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number)
    if (d) fps = n / d
  }
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: v ? Number(v.width) : 0,
    height: v ? Number(v.height) : 0,
    fps: Math.round(fps * 1000) / 1000,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    codec: v?.codec_name || a?.codec_name || '',
  }
}

// Grab a single representative frame as a small jpg for the clip browser.
export async function makeThumb(file, outFile, { atSeconds = null, width = 480 } = {}) {
  await ensureDir(join(outFile, '..'))
  const ss = atSeconds == null ? [] : ['-ss', String(atSeconds)]
  await ffmpeg([
    ...ss,
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    '-q:v', '4',
    '-y', outFile,
  ])
  return outFile
}
