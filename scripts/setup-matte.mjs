// setup-matte.mjs — one-time setup for the "text behind subject" effect.
// Creates an isolated Python venv, installs the lean matting stack
// (onnxruntime + numpy + pillow), and downloads the U2-Net model (~168MB).
//
// Run: node scripts/setup-matte.mjs   (or npm run setup-matte)

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const matte = join(ROOT, 'matte')
const venvPy = join(matte, 'venv', 'Scripts', 'python.exe')
const model = join(matte, 'models', 'u2net.onnx')
const MODEL_URL = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx'

function sh(cmd, args) {
  console.log('>', cmd, args.join(' '))
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true })
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`)
}

async function main() {
  if (!existsSync(venvPy)) sh('python', ['-m', 'venv', join(matte, 'venv')])
  sh(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  sh(venvPy, ['-m', 'pip', 'install', 'onnxruntime', 'numpy', 'pillow'])
  await mkdir(join(matte, 'models'), { recursive: true })
  if (!existsSync(model)) {
    console.log('downloading U2-Net model…')
    sh(venvPy, ['-c', `import urllib.request; urllib.request.urlretrieve(${JSON.stringify(MODEL_URL)}, ${JSON.stringify(model)}); print('model downloaded')`])
  }
  console.log(existsSync(venvPy) && existsSync(model)
    ? 'Matte runtime ready — "text behind subject" is now enabled.'
    : 'Setup incomplete.')
}

main().catch((e) => { console.error('setup failed:', e.message); process.exit(1) })
