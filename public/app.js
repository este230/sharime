// app.js — Sharimie front end. Vanilla ES modules, no framework.

const state = { view: 'home', projects: [], project: null, library: [], alamo: null, notes: '', musicTab: 'library', poll: null }

const GRADES = [
  'natural', 'warm', 'golden-hour', 'teal-orange', 'cinematic-teal', 'cool-cinematic',
  'muted-cool', 'moody', 'noir', 'bleach-bypass', 'film-fade', 'cyber-neon',
  'vibrant', 'kodak-warm', 'fuji-vivid', 'cross-process', 'slate', 'ember', 'dreamy', 'vintage',
]
const TRANSITIONS = [['cut', 'Cut'], ['crossfade', 'Crossfade'], ['dip-to-black', 'Dip to black'], ['wipe-left', 'Wipe left'], ['wipe-right', 'Wipe right']]

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmtDur = (s) => { const x = Math.max(0, Math.round(s)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}` }

async function api(path, { method = 'GET', json, raw, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json) }
  if (raw) opts.body = raw
  const res = await fetch(path, opts)
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('json') ? await res.json() : null
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`)
  return data
}

let toastTimer
function toast(msg, isErr = false) {
  const t = $('#toast')
  t.textContent = msg
  t.className = 'toast' + (isErr ? ' err' : '')
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, isErr ? 4500 : 2600)
}

// ---------- inspiration quotes (cycle forever) ----------
const QUOTES = [
  'Travel is the only thing you buy that makes you richer.',
  'To travel is to live. — Hans Christian Andersen',
  'Collect moments, not things.',
  'The world is a book, and those who do not travel read only one page. — Augustine',
  'Once a year, go somewhere you have never been before. — Dalai Lama',
  'Take only memories, leave only footprints. — Chief Seattle',
  'Wherever you go becomes a part of you somehow. — Anita Desai',
  'The journey, not the arrival, matters. — T. S. Eliot',
  'Not all those who wander are lost. — J. R. R. Tolkien',
  'Jobs fill your pocket, but adventures fill your soul.',
  'Life is short and the world is wide.',
  'Of all the books in the world, the best stories are found between the pages of a passport.',
]
function startQuotes() {
  const el = $('#quoteText')
  if (!el) return
  let i = Math.floor(Math.random() * QUOTES.length)
  const show = () => { el.textContent = QUOTES[i % QUOTES.length]; el.classList.remove('fade') }
  show()
  setInterval(() => {
    el.classList.add('fade')
    setTimeout(() => { i = (i + 1) % QUOTES.length; show() }, 600)
  }, 7000)
}

// ---------- boot ----------
async function boot() {
  $('#homeBtn').addEventListener('click', () => goHome())
  startQuotes()
  try { state.matte = !!(await api('/api/health')).matte } catch { state.matte = false }
  refreshAlamo()
  setInterval(refreshAlamo, 20000)
  await goHome()
}

async function refreshAlamo() {
  try {
    state.alamo = await api('/api/alamo/status')
  } catch { state.alamo = { up: false } }
  const dot = $('#alamoDot')
  const ok = state.alamo && state.alamo.up && state.alamo.authOk
  dot.className = 'dot ' + (ok ? 'online' : 'offline')
  $('#alamoBadge').title = (state.alamo && state.alamo.detail) || 'ALAMO editing brain'
}

async function goHome() {
  stopPoll()
  state.view = 'home'; state.project = null
  $('#homeBtn').hidden = true
  try { state.projects = (await api('/api/projects')).projects } catch { state.projects = [] }
  renderHome()
}

// ---------- home ----------
function renderHome() {
  const app = $('#app')
  app.innerHTML = `
    <div class="hero">
      <h1>Her travels, beautifully cut.</h1>
      <p>Drop in your clips, choose a song, and show ALAMO a style you love — Sharimie delivers a finished travel video you can fine-tune.</p>
    </div>
    <div class="proj-grid" id="grid"></div>`
  const grid = $('#grid')
  const nc = document.createElement('div')
  nc.className = 'proj-card new-card'
  nc.textContent = '+  New trip'
  nc.onclick = createTrip
  grid.appendChild(nc)
  for (const p of state.projects) {
    const card = document.createElement('div')
    card.className = 'proj-card'
    const thumbId = p.id
    card.innerHTML = `
      <div class="thumb">${p.hasOutput ? `<img src="/api/projects/${thumbId}/media/output#t=0.1" />` : 'Sharimie'}</div>
      <div class="body">
        <h3>${esc(p.name)}</h3>
        <div class="meta">${p.clipCount} clip${p.clipCount === 1 ? '' : 's'} &middot; ${esc(p.canvas.label || p.canvas.preset)} &middot; ${statusLabel(p.status)}</div>
      </div>`
    card.onclick = () => openProject(p.id)
    grid.appendChild(card)
  }
}

function statusLabel(s) {
  return { new: 'New', editing: 'Drafting', ready: 'Draft ready', rendering: 'Rendering', done: 'Finished' }[s] || s
}

function createTrip() {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal">
      <h2>New trip</h2>
      <div class="sub" style="margin:4px 0 16px">Name it, then choose the shape of the video.</div>
      <input class="modal-name" id="mName" value="New trip" />
      <div class="fmt-grid">
        <button class="fmt" data-preset="vertical"><span class="fmt-shape v"></span><b>Vertical</b><small>9:16 · Reels, TikTok</small></button>
        <button class="fmt" data-preset="landscape"><span class="fmt-shape l"></span><b>Landscape</b><small>16:9 · YouTube</small></button>
        <button class="fmt" data-preset="square"><span class="fmt-shape s"></span><b>Square</b><small>1:1</small></button>
      </div>
      <div class="modal-actions"><button class="ghost-btn" id="mCancel">Cancel</button></div>
    </div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector('#mCancel').onclick = close
  overlay.querySelectorAll('.fmt').forEach((b) => b.onclick = async () => {
    const name = overlay.querySelector('#mName').value.trim() || 'New trip'
    const preset = b.dataset.preset
    close()
    try { const { project } = await api('/api/projects', { method: 'POST', json: { name, preset } }); await openProject(project.id) } catch (e) { toast(e.message, true) }
  })
  setTimeout(() => { const n = overlay.querySelector('#mName'); n.focus(); n.select() }, 50)
}

// ---------- project ----------
async function openProject(id) {
  stopPoll()
  state.tips = null
  state.sel = 0
  try { state.project = (await api('/api/projects/' + id)).project } catch (e) { return toast(e.message, true) }
  try { state.library = (await api('/api/library/music')).tracks } catch { state.library = [] }
  state.view = 'project'
  $('#homeBtn').hidden = false
  renderProject()
}

async function refreshProject() {
  const id = state.project.id
  state.project = (await api('/api/projects/' + id)).project
}

function renderProject() {
  const p = state.project
  const app = $('#app')
  app.innerHTML = `
    <div class="project-title-row">
      <input class="project-title" id="projTitle" value="${esc(p.name)}" />
      <select id="formatSel" class="ghost-btn" style="font-weight:600">
        <option value="landscape">Landscape 16:9</option>
        <option value="vertical">Vertical 9:16</option>
        <option value="square">Square 1:1</option>
      </select>
      <button class="icon-btn" id="delProj" title="Delete trip">Delete</button>
    </div>
    <div class="steps" id="steps"></div>`
  $('#formatSel').value = p.canvas.preset
  $('#projTitle').addEventListener('change', async (e) => {
    try { await api('/api/projects/' + p.id, { method: 'PUT', json: { name: e.target.value } }); toast('Renamed') } catch (err) { toast(err.message, true) }
  })
  $('#formatSel').addEventListener('change', async (e) => {
    try { await api('/api/projects/' + p.id, { method: 'PUT', json: { preset: e.target.value } }); await refreshProject(); renderProject() } catch (err) { toast(err.message, true) }
  })
  $('#delProj').addEventListener('click', async () => {
    if (!confirm('Delete this trip and all its clips?')) return
    try { await api('/api/projects/' + p.id, { method: 'DELETE' }); goHome() } catch (e) { toast(e.message, true) }
  })

  const steps = $('#steps')
  steps.appendChild(clipsCard())
  steps.appendChild(musicCard())
  steps.appendChild(referenceCard())
  steps.appendChild(draftCard())
  if (p.edl && p.edl.length) steps.appendChild(reviewCard())
  if (p.clips.length) steps.appendChild(suggestionsCard())
  if (p.output) steps.appendChild(outputCard())
}

// ----- step 1: clips -----
function clipsCard() {
  const p = state.project
  const card = document.createElement('div')
  card.className = 'card' + (p.clips.length ? ' step-done' : '')
  card.innerHTML = `
    <div class="step-head"><span class="step-num">1</span><h2>Your clips</h2></div>
    <div class="sub">Add the videos from the trip. Any order — Sharimie arranges them.</div>
    <div class="dropzone" id="clipDrop"><strong>Drop video clips here</strong><br/>or click to choose &middot; mp4, mov, webm</div>
    <input type="file" id="clipInput" accept="video/*" multiple hidden />
    <div class="clip-grid" id="clipGrid"></div>`
  const grid = card.querySelector('#clipGrid')
  for (const c of p.clips) {
    const div = document.createElement('div')
    div.className = 'clip'
    div.innerHTML = `<img src="/api/projects/${p.id}/media/thumb/${c.id}" loading="lazy" />
      <span class="dur">${fmtDur(c.duration)}</span>
      <button class="rm" title="Remove">&times;</button>`
    div.querySelector('.rm').onclick = async () => {
      try { await api(`/api/projects/${p.id}/clips/${c.id}`, { method: 'DELETE' }); await refreshProject(); renderProject() } catch (e) { toast(e.message, true) }
    }
    grid.appendChild(div)
  }
  const input = card.querySelector('#clipInput')
  const drop = card.querySelector('#clipDrop')
  drop.onclick = () => input.click()
  input.onchange = () => uploadClips([...input.files])
  wireDrop(drop, (files) => uploadClips(files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(f.name))))
  return card
}

async function uploadClips(files) {
  if (!files.length) return
  const p = state.project
  const drop = $('#clipDrop')
  let done = 0
  for (const f of files) {
    drop.innerHTML = `<span class="spinner"></span> Uploading ${esc(f.name)} (${++done}/${files.length})…`
    try {
      await api(`/api/projects/${p.id}/clips`, { method: 'POST', raw: f, headers: { 'X-Filename': f.name } })
    } catch (e) { toast(`${f.name}: ${e.message}`, true) }
  }
  await refreshProject(); renderProject()
}

// ----- step 2: music -----
function musicCard() {
  const p = state.project
  const card = document.createElement('div')
  card.className = 'card' + (p.music ? ' step-done' : '')
  card.innerHTML = `
    <div class="step-head"><span class="step-num">2</span><h2>The music</h2></div>
    <div class="sub">Pick the song. Sharimie finds the beat and cuts to it.</div>
    <div class="tabs">
      <button class="tab ${state.musicTab === 'library' ? 'active' : ''}" data-tab="library">Library</button>
      <button class="tab ${state.musicTab === 'upload' ? 'active' : ''}" data-tab="upload">Upload</button>
    </div>
    <div id="musicBody"></div>
    <div id="chosenMusic"></div>`
  card.querySelectorAll('.tab').forEach((t) => t.onclick = () => { state.musicTab = t.dataset.tab; renderMusicBody(card) })
  renderMusicBody(card)
  renderChosenMusic(card)
  return card
}

function renderMusicBody(card) {
  const body = card.querySelector('#musicBody')
  const p = state.project
  if (state.musicTab === 'library') {
    if (!state.library.length) { body.innerHTML = `<div class="muted">No library tracks yet. Use the Upload tab, or run <code>npm run seed-music</code> to add starter beds.</div>`; return }
    body.innerHTML = `<div class="track-list">${state.library.map((t) => `
      <div class="track ${p.music && p.music.source === 'library' && p.music.name === t.name ? 'sel' : ''}" data-name="${esc(t.name)}">
        <span class="name">${esc(t.label)}</span>
        <span class="muted">choose &rsaquo;</span>
      </div>`).join('')}</div>`
    body.querySelectorAll('.track').forEach((row) => row.onclick = () => selectLibraryTrack(row.dataset.name))
  } else {
    body.innerHTML = `<div class="dropzone" id="musicDrop"><strong>Drop a song here</strong><br/>or click to choose &middot; mp3, wav, m4a</div>
      <input type="file" id="musicInput" accept="audio/*" hidden />`
    const input = body.querySelector('#musicInput')
    const drop = body.querySelector('#musicDrop')
    drop.onclick = () => input.click()
    input.onchange = () => uploadMusic(input.files[0])
    wireDrop(drop, (files) => uploadMusic(files[0]))
  }
}

function renderChosenMusic(card) {
  const p = state.project
  const box = card.querySelector('#chosenMusic')
  if (!p.music) { box.innerHTML = ''; return }
  const start = Number(p.music.start) || 0
  const end = Number(p.music.end) || 0
  box.innerHTML = `<div class="chosen-music">
    <span class="badge">Chosen</span>
    <span class="name" style="font-weight:600">${esc(p.music.name)}</span>
    <span class="pill">${fmtDur(p.music.duration)}</span>
    <span class="pill">~${p.music.bpm} BPM</span>
  </div>
  <div class="music-region">
    <label>Use song region</label>
    <input id="musicStart" type="number" min="0" max="${p.music.duration}" step="0.1" value="${start}" />
    <span class="muted">to</span>
    <input id="musicEnd" type="number" min="0" max="${p.music.duration}" step="0.1" value="${end || ''}" placeholder="end" />
    <button class="ghost-btn" id="musicRegionSave">Save region</button>
    <span class="muted">blank end uses the rest of the song</span>
  </div>`
  box.querySelector('#musicRegionSave').onclick = saveMusicRegion
}

async function saveMusicRegion() {
  const p = state.project
  const start = Number($('#musicStart')?.value) || 0
  const end = Number($('#musicEnd')?.value) || 0
  try {
    await api(`/api/projects/${p.id}/music`, { method: 'PUT', json: { start, end } })
    await refreshProject(); renderProject(); toast('Music region saved')
  } catch (e) { toast(e.message, true) }
}

async function selectLibraryTrack(name) {
  try {
    await api(`/api/projects/${state.project.id}/music/select`, { method: 'POST', json: { name } })
    await refreshProject(); renderProject()
  } catch (e) { toast(e.message, true) }
}

async function uploadMusic(file) {
  if (!file) return
  const drop = $('#musicDrop')
  if (drop) drop.innerHTML = `<span class="spinner"></span> Adding ${esc(file.name)}…`
  try {
    await api(`/api/projects/${state.project.id}/music`, { method: 'POST', raw: file, headers: { 'X-Filename': file.name } })
    await refreshProject(); renderProject()
  } catch (e) { toast(e.message, true); renderProject() }
}

// ----- step 3: reference -----
function referenceCard() {
  const p = state.project
  const card = document.createElement('div')
  card.className = 'card' + (p.reference ? ' step-done' : '')
  const fp = p.reference && p.reference.fingerprint
  card.innerHTML = `
    <div class="step-head"><span class="step-num">3</span><h2>The style <span class="muted" style="font-size:13px;font-weight:400">— optional</span></h2></div>
    <div class="sub">Show ALAMO a video whose editing you love. It studies the pacing and color, then matches the feel with your footage.</div>
    ${fp ? `
      <div class="fp">
        <div class="head"><span class="dot online" style="width:9px;height:9px;border-radius:50%;background:var(--teal)"></span> ALAMO sees this style</div>
        <div class="chips">
          <span class="chip">${esc(p.reference.name)}</span>
          <span class="chip">${esc(fp.energy)} energy</span>
          <span class="chip">${esc(fp.colorMood)} color</span>
          <span class="chip">~${fp.cutsPerMinute} cuts/min</span>
          ${fp.tempoBpm ? `<span class="chip">~${fp.tempoBpm} BPM</span>` : ''}
          <span class="chip">${esc(fp.aspect)}</span>
        </div>
        <div class="muted" style="margin-top:8px;font-size:12.5px">${esc(fp.summary)}</div>
        <button class="ghost-btn" id="rmRef" style="margin-top:12px">Remove style reference</button>
      </div>` : `
      <div class="dropzone" id="refDrop"><strong>Drop a reference video here</strong><br/>or click to choose</div>
      <input type="file" id="refInput" accept="video/*" hidden />`}
    <textarea class="notes" id="notes" placeholder="Optional: tell ALAMO what you liked about it (e.g. 'fast cuts on the drops, warm sunset colors, slow-mo openings')">${esc(state.notes)}</textarea>`
  card.querySelector('#notes').addEventListener('input', (e) => { state.notes = e.target.value })
  if (fp) {
    card.querySelector('#rmRef').onclick = async () => {
      try { await api(`/api/projects/${p.id}/reference`, { method: 'DELETE' }); await refreshProject(); renderProject() } catch (e) { toast(e.message, true) }
    }
  } else {
    const input = card.querySelector('#refInput')
    const drop = card.querySelector('#refDrop')
    drop.onclick = () => input.click()
    input.onchange = () => uploadReference(input.files[0])
    wireDrop(drop, (files) => uploadReference(files[0]))
  }
  return card
}

async function uploadReference(file) {
  if (!file) return
  const drop = $('#refDrop')
  if (drop) drop.innerHTML = `<span class="spinner"></span> ALAMO is studying ${esc(file.name)}…`
  try {
    await api(`/api/projects/${state.project.id}/reference`, { method: 'POST', raw: file, headers: { 'X-Filename': file.name } })
    await refreshProject(); renderProject()
  } catch (e) { toast(e.message, true); renderProject() }
}

// ----- step 4: draft -----
function draftCard() {
  const p = state.project
  const card = document.createElement('div')
  card.className = 'card'
  const ready = p.clips.length >= 1 && p.music
  const hasDraft = p.edl && p.edl.length
  card.innerHTML = `
    <div class="step-head"><span class="step-num">4</span><h2>${hasDraft ? 'Re-make the draft' : 'Make the draft'}</h2></div>
    <div class="sub">${ready ? 'ALAMO cuts your clips to the beat in the style you chose.' : 'Add at least one clip and a song first.'}</div>
    <div class="row" style="margin-top:14px"><button class="btn lg coral" id="draftBtn" ${ready ? '' : 'disabled'}>${hasDraft ? 'Re-cut draft' : 'Create my draft'}</button></div>
    <div id="draftProgress"></div>`
  card.querySelector('#draftBtn').onclick = startDraft
  return card
}

async function startDraft() {
  const p = state.project
  try {
    await api(`/api/projects/${p.id}/auto-edit`, { method: 'POST', json: { notes: state.notes } })
    pollJob('autoedit', '#draftProgress')
  } catch (e) { toast(e.message, true) }
}

// ----- step 5: review studio -----
const COLORS = [['#ffffff', 'White'], ['#000000', 'Black'], ['#f5d76e', 'Gold'], ['#e76f51', 'Coral'], ['#2a9d8f', 'Teal'], ['#4d7ea8', 'Sky']]
const FONT_OPTS = [['sans', 'Sans'], ['serif', 'Serif'], ['display', 'Bold'], ['light', 'Light']]
const SIZE_OPTS = [['sm', 'S'], ['md', 'M'], ['lg', 'L'], ['xl', 'XL']]
const ANIM_OPTS = [['none', 'None'], ['fade', 'Fade'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['pop', 'Pop']]
const SLIDERS = [['sharpness', 'Sharpness'], ['shadows', 'Shadows'], ['highlights', 'Highlights'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['warmth', 'Warmth'], ['exposure', 'Exposure'], ['vignette', 'Vignette']]
const SLIDER_HELP = {
  sharpness: 'Clarifies details. Keep it light for phone clips.',
  shadows: 'Lift dark areas without changing the whole shot.',
  highlights: 'Tames bright sky, sand, and water glare.',
  contrast: 'Adds punch or softens the image.',
  saturation: 'Controls how rich the colors feel.',
  warmth: 'Warmer for sunsets, cooler for a clean cinematic feel.',
  exposure: 'Brightens or darkens the full shot.',
  vignette: 'Adds a subtle edge shade to draw the eye inward.',
}
const FONT_CSS = { sans: '"Segoe UI Semibold","Segoe UI",sans-serif', serif: 'Georgia,"Times New Roman",serif', display: 'Impact,Haettenschweiler,sans-serif', light: '"Segoe UI Light","Segoe UI",sans-serif' }
const ADJ_KEYS = ['exposure', 'contrast', 'saturation', 'warmth', 'sharpness', 'shadows', 'highlights', 'vignette']

function reviewCard() {
  const p = state.project
  const r = p.recipe || {}
  if (!p.adjust) p.adjust = { exposure: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, shadows: 0, highlights: 0, vignette: 0 }
  state.sel = Math.min(Math.max(0, state.sel || 0), Math.max(0, p.edl.length - 1))
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <div class="step-head"><span class="step-num">5</span><h2>Review &amp; fine-tune</h2></div>
    <div class="sub">Tap a shot to preview it. Tune the look, drag the text where you want it, then render.</div>
    <div class="review-help">Start with the big color look, then make small slider moves. Shot controls below the preview only affect the selected shot.</div>
    <div class="row spread" style="margin:6px 0 14px">
      <div class="vibe">${esc(r.vibe || 'Travel cut')} <span class="badge">${r.source === 'alamo' ? 'ALAMO' : 'built-in'}</span></div>
      <div class="muted" style="font-size:12.5px">${p.edl.length} shots &middot; ${fmtDur(p.edl.reduce((s, x) => s + x.dur, 0))}</div>
    </div>
    <div class="studio">
      <div class="preview-col">
        <div class="preview-stage" id="previewStage" style="aspect-ratio:${p.canvas.w}/${p.canvas.h}">
          <img class="preview-frame" id="previewFrame" alt="" />
          <div class="preview-text" id="previewText" hidden></div>
          <div class="preview-hint" id="previewHint"></div>
        </div>
        <div id="shotTextEditor"></div>
      </div>
      <div class="look-col">
        <label class="look-label">Color look</label>
        <select id="gradeSel" class="look-select">${GRADES.map((g) => `<option value="${g}" ${r.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <div class="control-help">Sets the overall mood for the whole edit. You can override one shot below if it needs special treatment.</div>
        <div class="sliders">${SLIDERS.map(([k, l]) => `
          <div class="slider-row">
            <label>${l}<span class="sval" id="sval-${k}">${p.adjust[k] || 0}</span></label>
            <input type="range" min="-100" max="100" value="${p.adjust[k] || 0}" data-adj="${k}" />
            <div class="control-help">${SLIDER_HELP[k]}</div>
          </div>`).join('')}</div>
        <div class="row" style="gap:8px;margin-top:8px">
          <label class="look-label" style="margin:0;flex:0 0 auto">Transition</label>
          <select id="transSel" class="look-select" style="flex:1">${TRANSITIONS.map(([v, l]) => `<option value="${v}" ${r.transition === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="control-help">Default transition between shots. Use cuts for crisp beat edits; fades and wipes add a softer handoff.</div>
        <div class="row" style="gap:8px;margin-top:12px">
          <button class="ghost-btn" id="resetLook">Reset look</button>
          <button class="ghost-btn" id="recutBtn">Re-cut</button>
        </div>
      </div>
    </div>
    <div class="timeline" id="timeline"></div>
    <div class="row" style="margin-top:16px"><button class="btn lg" id="renderBtn">Render video</button></div>
    <div id="renderProgress"></div>`
  card.querySelector('#gradeSel').onchange = (e) => { applyGlobal('grade', e.target.value); updatePreviewFrame() }
  card.querySelector('#transSel').onchange = (e) => applyGlobal('transition', e.target.value)
  card.querySelector('#recutBtn').onclick = startDraft
  card.querySelector('#renderBtn').onclick = startRender
  card.querySelector('#resetLook').onclick = resetLook
  card.querySelectorAll('input[data-adj]').forEach((inp) => {
    inp.oninput = () => { const k = inp.dataset.adj; const v = Number(inp.value); state.project.adjust[k] = v; const sv = $(`#sval-${k}`); if (sv) sv.textContent = v; updatePreviewFrame() }
    inp.onchange = saveAdjust
  })
  setTimeout(() => { renderTimeline($('#timeline')); selectShot(state.sel) }, 0)
  return card
}

function selectShot(i) {
  const p = state.project
  if (!p.edl.length) return
  state.sel = Math.max(0, Math.min(i, p.edl.length - 1))
  $$('.shot').forEach((s, idx) => s.classList.toggle('sel', idx === state.sel))
  updatePreviewFrame(); renderPreviewText(); renderShotTextEditor()
}

let previewTimer
function updatePreviewFrame() {
  const img = $('#previewFrame'); if (!img) return
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    const p = state.project
    const seg = p.edl[state.sel]; if (!seg) return
    const grade = seg.grade || (p.recipe && p.recipe.grade) || 'natural'
    const q = new URLSearchParams({ shot: String(state.sel), grade, _: String(Date.now()) })
    for (const k of ADJ_KEYS) q.set(k, String(p.adjust[k] || 0))
    img.onerror = () => { const h = $('#previewHint'); if (h) h.textContent = 'Preview unavailable' }
    img.onload = () => { const h = $('#previewHint'); if (h) h.textContent = '' }
    img.src = `/api/projects/${p.id}/preview?${q.toString()}`
  }, 200)
}

function renderPreviewText() {
  const el = $('#previewText'); const stage = $('#previewStage'); if (!el || !stage) return
  const seg = state.project.edl[state.sel]
  const t = seg && seg.text
  if (!t || !String(t.content || '').trim()) { el.hidden = true; return }
  el.hidden = false
  el.textContent = t.content
  const x = typeof t.x === 'number' ? t.x : 0.5
  const y = typeof t.y === 'number' ? t.y : 0.85
  el.style.left = (x * 100) + '%'
  el.style.top = (y * 100) + '%'
  const ph = stage.clientHeight || 320
  const ratio = { sm: 1 / 24, md: 1 / 15, lg: 1 / 10, xl: 1 / 7 }[t.size || 'md']
  el.style.fontSize = Math.max(10, ph * ratio) + 'px'
  el.style.color = t.color || '#ffffff'
  el.style.fontFamily = FONT_CSS[t.font || 'sans']
  el.style.fontWeight = (t.font === 'serif' || t.font === 'light') ? '600' : '700'
  el.onpointerdown = (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('dragging')
    const move = (ev) => {
      const r = stage.getBoundingClientRect()
      const nx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width))
      const ny = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
      el.style.left = (nx * 100) + '%'; el.style.top = (ny * 100) + '%'
      const s = state.project.edl[state.sel]
      if (s && s.text) { s.text.x = Math.round(nx * 1000) / 1000; s.text.y = Math.round(ny * 1000) / 1000 }
    }
    const up = () => { el.classList.remove('dragging'); el.onpointermove = null; document.removeEventListener('pointerup', up); persistEdl() }
    el.onpointermove = move
    document.addEventListener('pointerup', up)
  }
}

function renderShotTextEditor() {
  const box = $('#shotTextEditor'); if (!box) return
  const seg = state.project.edl[state.sel]
  const t = seg && seg.text
  const has = t && String(t.content || '').trim()
  box.innerHTML = `
    <div class="text-editor">
    <div class="te-head">Shot ${state.sel + 1} controls <span class="muted" style="font-weight:400">— per-shot look, transition, and text</span></div>
    <div class="inline-help">Use this when one clip needs its own color, a softer entrance, or a place-name card.</div>
    <div class="shot-polish">
      <label><span>Color</span><select id="shotGrade" class="look-select">${GRADES.map((g) => `<option value="${g}" ${(seg.grade || 'natural') === g ? 'selected' : ''}>${g}</option>`).join('')}</select><small>Only this shot; use natural to keep it simple.</small></label>
      <label><span>Transition in</span><select id="shotTrans" class="look-select" ${state.sel === 0 ? 'disabled' : ''}>${TRANSITIONS.map(([v, l]) => `<option value="${v}" ${(seg.transition || 'cut') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><small>${state.sel === 0 ? 'First shot starts clean.' : 'How this shot enters from the previous one.'}</small></label>
      <label><span>Blend</span><input id="shotTransDur" type="number" min="0.08" max="0.75" step="0.05" value="${Number(seg.transitionDur || 0.3).toFixed(2)}" ${state.sel === 0 || seg.transition === 'cut' ? 'disabled' : ''}/><small>Seconds of overlap for fades or wipes.</small></label>
    </div>
    <div class="te-head" style="margin-top:12px">Text <span class="muted" style="font-weight:400">— drag it on the preview to place</span></div>
    <textarea id="teContent" class="te-content" placeholder="Add a title or place name…">${esc(has ? t.content : '')}</textarea>
      <div class="inline-help">Short text works best: location, date, or one calm phrase.</div>
      <div class="te-row">
        <div class="te-group"><span>Font</span><div class="te-opts" id="teFont">${FONT_OPTS.map(([v, l]) => `<button data-v="${v}" class="${(t && t.font || 'sans') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="te-group"><span>Size</span><div class="te-opts" id="teSize">${SIZE_OPTS.map(([v, l]) => `<button data-v="${v}" class="${(t && t.size || 'md') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      </div>
      <div class="te-row">
        <div class="te-group"><span>Color</span><div class="te-swatches" id="teColor">${COLORS.map(([c, l]) => `<button data-v="${c}" class="${(t && t.color || '#ffffff').toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" title="${l}"></button>`).join('')}</div></div>
        <div class="te-group"><span>Motion</span><select id="teAnim" class="look-select">${ANIM_OPTS.map(([v, l]) => `<option value="${v}" ${(t && t.anim || 'none') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      ${has ? (state.matte ? `<div class="te-behind">
        <label class="te-switch"><input type="checkbox" id="teBehind" ${t && t.behind ? 'checked' : ''}/> <span>Place text behind the subject</span></label>
        ${t && t.behind ? '<button class="ghost-btn" id="teBehindPreview">Preview behind subject</button>' : ''}
      </div>` : '<div class="muted" style="font-size:11px;margin-top:8px">The behind-subject effect needs a one-time setup — run <code>node scripts/setup-matte.mjs</code>.</div>') : ''}
      ${has ? '<button class="ghost-btn" id="teRemove" style="margin-top:8px">Remove text</button>' : ''}
    </div>`
  const ensure = () => { const s = state.project.edl[state.sel]; if (!s.text) s.text = { content: '', x: 0.5, y: 0.85, size: 'md', font: 'sans', color: '#ffffff', anim: 'fade' }; return s.text }
  box.querySelector('#shotGrade').onchange = (e) => { state.project.edl[state.sel].grade = e.target.value; updatePreviewFrame(); rerenderTimeline(); persistEdl() }
  box.querySelector('#shotTrans').onchange = (e) => {
    const s = state.project.edl[state.sel]
    s.transition = e.target.value
    s.transitionDur = e.target.value === 'cut' ? 0 : Math.max(0.08, Number(s.transitionDur) || 0.3)
    renderShotTextEditor(); rerenderTimeline(); persistEdl()
  }
  box.querySelector('#shotTransDur').onchange = (e) => { state.project.edl[state.sel].transitionDur = Math.max(0.08, Math.min(0.75, Number(e.target.value) || 0.3)); persistEdl() }
  box.querySelector('#teContent').oninput = (e) => {
    const cur = state.project.edl[state.sel].text
    const wasHas = !!(cur && String(cur.content || '').trim())
    ensure().content = e.target.value
    const nowHas = !!e.target.value.trim()
    renderPreviewText(); persistEdl()
    // Re-render the editor only when text appears/disappears, so the Behind +
    // Remove controls show up; restore the caret so typing isn't interrupted.
    if (wasHas !== nowHas) { renderShotTextEditor(); const c = $('#teContent'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length) } }
  }
  box.querySelectorAll('#teFont button').forEach((b) => b.onclick = () => { ensure().font = b.dataset.v; renderShotTextEditor(); renderPreviewText(); persistEdl() })
  box.querySelectorAll('#teSize button').forEach((b) => b.onclick = () => { ensure().size = b.dataset.v; renderShotTextEditor(); renderPreviewText(); persistEdl() })
  box.querySelectorAll('#teColor button').forEach((b) => b.onclick = () => { ensure().color = b.dataset.v; renderShotTextEditor(); renderPreviewText(); persistEdl() })
  const anim = box.querySelector('#teAnim'); if (anim) anim.onchange = (e) => { ensure().anim = e.target.value; persistEdl() }
  const beh = box.querySelector('#teBehind'); if (beh) beh.onchange = (e) => { ensure().behind = e.target.checked; persistEdl(); renderShotTextEditor(); if (e.target.checked) showBehindPreview(); else { updatePreviewFrame(); renderPreviewText() } }
  const behp = box.querySelector('#teBehindPreview'); if (behp) behp.onclick = showBehindPreview
  const rm = box.querySelector('#teRemove'); if (rm) rm.onclick = () => { state.project.edl[state.sel].text = null; renderShotTextEditor(); renderPreviewText(); rerenderTimeline(); persistEdl() }
}

// Slow, on-demand still showing text composited BEHIND the subject. Replaces the
// live frame and hides the draggable overlay (the text is baked into this image).
function showBehindPreview() {
  const img = $('#previewFrame'); const hint = $('#previewHint'); const pt = $('#previewText')
  if (!img) return
  if (pt) pt.hidden = true
  if (hint) hint.textContent = 'Rendering behind-subject preview…'
  const p = state.project; const seg = p.edl[state.sel]
  const grade = seg.grade || (p.recipe && p.recipe.grade) || 'natural'
  const q = new URLSearchParams({ shot: String(state.sel), grade, behind: '1', _: String(Date.now()) })
  for (const k of ADJ_KEYS) q.set(k, String(p.adjust[k] || 0))
  img.onload = () => { if (hint) hint.textContent = 'Behind-subject preview — edit anything to go back' }
  img.onerror = () => { if (hint) hint.textContent = 'Preview failed (no clear subject?)' }
  img.src = `/api/projects/${p.id}/preview?${q.toString()}`
}

function resetLook() {
  state.project.adjust = { exposure: 0, contrast: 0, saturation: 0, warmth: 0, sharpness: 0, shadows: 0, highlights: 0, vignette: 0 }
  $$('input[data-adj]').forEach((inp) => { inp.value = 0; const sv = $(`#sval-${inp.dataset.adj}`); if (sv) sv.textContent = '0' })
  saveAdjust(); updatePreviewFrame()
}

let adjustTimer
function saveAdjust() {
  clearTimeout(adjustTimer)
  adjustTimer = setTimeout(async () => {
    try { await api(`/api/projects/${state.project.id}`, { method: 'PUT', json: { adjust: state.project.adjust } }) } catch (e) { toast(e.message, true) }
  }, 400)
}

let dragIndex = null
function renderTimeline(tl) {
  const p = state.project
  const clipName = (id) => { const c = p.clips.find((x) => x.id === id); return c ? c.name : '—' }
  const clipThumb = (id) => `/api/projects/${p.id}/media/thumb/${id}`
  tl.innerHTML = ''
  p.edl.forEach((seg, i) => {
    const shot = document.createElement('div')
    shot.className = 'shot' + (i === state.sel ? ' sel' : '')
    shot.draggable = true
    shot.dataset.i = i
    const hasText = seg.text && String(seg.text.content || '').trim()
    shot.innerHTML = `
      <span class="num">${i + 1}</span>
      <div class="ph"><img src="${clipThumb(seg.clipId)}" loading="lazy" />${hasText ? `<span class="text-tag">${esc(seg.text.content).slice(0, 22)}</span>` : ''}</div>
      <div class="info">${esc(clipName(seg.clipId)).slice(0, 18)} &middot; ${seg.dur.toFixed(1)}s</div>
      <div class="shot-tags"><span>${esc(seg.grade || 'natural')}</span>${i > 0 && seg.transition !== 'cut' ? `<span>${esc(seg.transition || 'crossfade')}</span>` : ''}</div>
      <div class="ctrls">
        <div class="dur-ctrl"><button data-act="minus">−</button><button data-act="plus">+</button></div>
        <button data-act="text" class="${hasText ? 'has-text' : ''}" title="Add text">T</button>
        <button data-act="remove" title="Remove">✕</button>
      </div>
      <div class="ctrls" style="padding-top:0">
        <select data-act="swap">${p.clips.map((c) => `<option value="${c.id}" ${c.id === seg.clipId ? 'selected' : ''}>${esc(c.name).slice(0, 16)}</option>`).join('')}</select>
      </div>`
    shot.querySelector('.ph').onclick = () => selectShot(i)
    shot.querySelector('[data-act="minus"]').onclick = () => trimShot(i, -0.2)
    shot.querySelector('[data-act="plus"]').onclick = () => trimShot(i, 0.2)
    shot.querySelector('[data-act="text"]').onclick = () => { selectShot(i); const c = $('#teContent'); if (c) c.focus() }
    shot.querySelector('[data-act="remove"]').onclick = () => removeShot(i)
    shot.querySelector('[data-act="swap"]').onchange = (e) => swapShot(i, e.target.value)
    shot.addEventListener('dragstart', () => { dragIndex = i; shot.classList.add('dragging') })
    shot.addEventListener('dragend', () => { dragIndex = null; shot.classList.remove('dragging'); $$('.shot').forEach((s) => s.classList.remove('over')) })
    shot.addEventListener('dragover', (e) => { e.preventDefault(); shot.classList.add('over') })
    shot.addEventListener('dragleave', () => shot.classList.remove('over'))
    shot.addEventListener('drop', (e) => { e.preventDefault(); moveShot(dragIndex, i) })
    tl.appendChild(shot)
  })
}

function moveShot(from, to) {
  if (from == null || from === to) return
  const edl = state.project.edl
  const [m] = edl.splice(from, 1)
  edl.splice(to, 0, m)
  persistEdl(); rerenderTimeline()
}
function trimShot(i, delta) {
  const seg = state.project.edl[i]
  const clip = state.project.clips.find((c) => c.id === seg.clipId)
  const maxDur = clip ? Math.min(8, (clip.duration - seg.in) / (seg.speed || 1)) : 8
  seg.dur = Math.max(0.3, Math.min(maxDur, Math.round((seg.dur + delta) * 10) / 10))
  persistEdl(); rerenderTimeline()
  if (i === state.sel) updatePreviewFrame()
}
function removeShot(i) {
  state.project.edl.splice(i, 1)
  persistEdl()
  if (!state.project.edl.length) return renderProject()
  rerenderTimeline(); selectShot(Math.min(state.sel, state.project.edl.length - 1))
}
function swapShot(i, clipId) {
  state.project.edl[i].clipId = clipId
  state.project.edl[i].in = 0
  persistEdl(); rerenderTimeline()
  if (i === state.sel) updatePreviewFrame()
}
function applyGlobal(key, val) {
  state.project.edl.forEach((s, i) => { if (key === 'transition' && i === 0) return; s[key] = val })
  if (state.project.recipe) state.project.recipe[key] = val
  if (key === 'transition') state.project.edl.forEach((s, i) => { if (i > 0 && val !== 'cut' && !s.transitionDur) s.transitionDur = 0.3; if (val === 'cut') s.transitionDur = 0 })
  persistEdl()
}
function rerenderTimeline() {
  const tl = $('#timeline'); if (tl) renderTimeline(tl)
}

let edlTimer
function persistEdl() {
  clearTimeout(edlTimer)
  edlTimer = setTimeout(async () => {
    try { await api(`/api/projects/${state.project.id}/edl`, { method: 'PUT', json: { edl: state.project.edl } }) } catch (e) { toast(e.message, true) }
  }, 400)
}

async function startRender() {
  try {
    await api(`/api/projects/${state.project.id}/render`, { method: 'POST' })
    pollJob('render', '#renderProgress')
  } catch (e) { toast(e.message, true) }
}

// ----- tips from ALAMO -----
function suggestionsCard() {
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <div class="step-head"><span class="step-num">&#9733;</span><h2>Tips from ALAMO</h2></div>
    <div class="sub">Ideas to make this video better — and shots to capture next time.</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="tipsBtn">${state.tips ? 'Refresh tips' : 'Get tips'}</button></div>
    <div id="tipsBody"></div>`
  card.querySelector('#tipsBtn').onclick = getTips
  if (state.tips) renderTips(card.querySelector('#tipsBody'), state.tips)
  return card
}

async function getTips() {
  const btn = $('#tipsBtn'); const body = $('#tipsBody')
  btn.disabled = true
  body.innerHTML = `<div class="progress"><div class="label"><span class="spinner"></span> ALAMO is reviewing your footage…</div></div>`
  try {
    const { suggestions } = await api(`/api/projects/${state.project.id}/suggestions`, { method: 'POST' })
    state.tips = suggestions
    renderTips(body, suggestions)
    btn.textContent = 'Refresh tips'
  } catch (e) { toast(e.message, true); body.innerHTML = '' }
  finally { btn.disabled = false }
}

function renderTips(body, s) {
  if (!s) { body.innerHTML = ''; return }
  const imp = (s.improvements || []).map((x) => `<li><strong>${esc(x.tip)}</strong>${x.why ? ` <span class="muted">— ${esc(x.why)}</span>` : ''}</li>`).join('')
  const shots = (s.nextShots || []).map((x) => `<li>${esc(x)}</li>`).join('')
  body.innerHTML = `
    <div class="tips">
      <div class="tips-col"><h4>Make this one better</h4><ul>${imp || '<li class="muted">No notes — looking good.</li>'}</ul></div>
      <div class="tips-col"><h4>Film next time</h4><ul>${shots}</ul></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:6px;text-align:right">${s.source === 'alamo' ? 'Suggested by ALAMO' : 'Built-in tips'}</div>`
}

// ----- step 6: output -----
function outputCard() {
  const p = state.project
  const card = document.createElement('div')
  card.className = 'card step-done'
  const src = `/api/projects/${p.id}/media/output?v=${encodeURIComponent(p.output.renderedAt || '')}`
  card.innerHTML = `
    <div class="step-head"><span class="step-num">6</span><h2>Your video</h2></div>
    <div class="sub">${fmtDur(p.output.duration)} &middot; ${esc(p.canvas.label || p.canvas.preset)}</div>
    <div class="player"><video src="${src}" controls playsinline></video></div>
    <div class="row" style="margin-top:14px;gap:10px">
      <a class="btn" href="${src}" download="${esc(p.name)}.mp4">Download</a>
      <span class="muted" style="font-size:12.5px">Tweak the timeline above and render again anytime.</span>
    </div>`
  return card
}

// ---------- job polling ----------
function stopPoll() { if (state.poll) { clearInterval(state.poll); state.poll = null } }

function pollJob(kind, progressSel) {
  stopPoll()
  const id = state.project.id
  const showProgress = (job) => {
    const box = $(progressSel)
    if (!box) return
    box.innerHTML = `<div class="progress">
      <div class="bar"><span style="width:${job.percent || 0}%"></span></div>
      <div class="label"><span class="spinner"></span> ${esc(job.message || 'Working…')}</div>
    </div>`
  }
  state.poll = setInterval(async () => {
    let job
    try { job = (await api(`/api/projects/${id}/job`)).job } catch { return }
    if (!job) return
    if (job.status === 'running') { showProgress(job); return }
    stopPoll()
    if (job.status === 'error') {
      const box = $(progressSel); if (box) box.innerHTML = ''
      toast(job.error || 'Something went wrong.', true)
      return
    }
    // done
    toast(kind === 'render' ? 'Your video is ready.' : 'Draft ready — review below.')
    await refreshProject()
    renderProject()
    if (kind === 'render') { const el = $('.player'); if (el) el.scrollIntoView({ behavior: 'smooth' }) }
  }, 1000)
}

// ---------- drag-drop helper ----------
function wireDrop(zone, onFiles) {
  ;['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag') }))
  ;['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave') zone.classList.remove('drag') }))
  zone.addEventListener('drop', (e) => { zone.classList.remove('drag'); onFiles([...(e.dataTransfer.files || [])]) })
}

boot()
