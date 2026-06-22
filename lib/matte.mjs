// matte.mjs — thin bridge to the Python subject-segmentation worker used by the
// "text behind subject" effect. Detects whether the one-time matting runtime is
// installed (venv + model) and runs it. All ffmpeg orchestration lives in
// render.mjs; this file only owns the segmentation call.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { run } from './util.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))) // projects/sharime
const VENV_PY = join(ROOT, 'matte', 'venv', 'Scripts', 'python.exe')
const MODEL = join(ROOT, 'matte', 'models', 'u2net.onnx')
const SCRIPT = join(ROOT, 'matte', 'segment.py')

export const MATTE = { VENV_PY, MODEL, SCRIPT }

// True only when the venv, model, and script all exist (feature is opt-in setup).
export function matteAvailable() {
  return existsSync(VENV_PY) && existsSync(MODEL) && existsSync(SCRIPT)
}

// Segment every PNG in framesDir -> grayscale mask PNG (same name) in masksDir.
// The model loads once for the whole batch, so a shot's frames are cheap after
// the first. onProgress receives the worker's stderr lines ("frame i/n").
export async function runSegment(framesDir, masksDir, { onProgress } = {}) {
  const { code, stderr } = await run(VENV_PY, [SCRIPT, framesDir, masksDir, MODEL], {
    onStderr: (s) => { if (onProgress) onProgress(s) },
  })
  if (code !== 0) throw new Error('segmentation failed: ' + stderr.slice(-300))
}
