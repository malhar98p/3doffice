// The office, live: the building from world.js, the people from people.js,
// kept in step with the session the mod writes to /api/state. The owner can
// move around the floor, rename people and change their roles, and talk to
// anyone in the office.

import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { THEMES, applyTheme } from './kit.js'
import { world, mergeStatic, screens, board, paintLabels, lampGlow, mice, DEPARTMENTS, DESKS, ACTIVITIES, OWNER_SEAT, COORDINATOR_DESK, RECEPTION_SEAT, PONG, ENTRANCE, pongBall, roomLights, route } from './world.js'
import { Person } from './people.js'
import { brainPanel, hologram } from './brain.js'

/* ── Talking to the server ─────────────────────────────────────────────── */

const TOKEN = document.querySelector('meta[name="office-token"]').content
/* ?session=<id> shows that session; without it, whichever session moved last. */
const PINNED = new URLSearchParams(location.search).get('session')
const stored = (key, value) => {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch {
    /* private window or blocked storage: nothing is remembered */
  }
  return null
}

const api = (path, body) =>
  fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-office-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => {
    /* The server was restarted by another session and holds a new token: load the page afresh, at most every 15 s. */
    if (r.status === 403 && Date.now() - Number(stored('office-reloaded') ?? 0) > 15_000) (stored('office-reloaded', String(Date.now())), location.reload())
    return r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))
  })


/* ── Renderer, camera, controls, light ─────────────────────────────────── */

const host = document.getElementById('scene')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
/* Variance shadows blur their edges, so a shadow softens with distance from what casts it, as daylight's does. */
renderer.shadowMap.type = THREE.VSMShadowMap
/* Neutral keeps the colours of cloth, wood and paint true while still rolling off bright highlights. */
renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping
host.appendChild(renderer.domElement)

const labels = new CSS2DRenderer()
labels.setSize(innerWidth, innerHeight)
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' })
host.appendChild(labels.domElement)

const scene = new THREE.Scene()
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 300)
/* Map-style: drag moves across the floor, right-drag turns, scroll zooms. */
const controls = new MapControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.minDistance = 0.6
controls.maxDistance = 75
controls.maxPolarAngle = 1.35
controls.screenSpacePanning = false
const HOME = { target: new THREE.Vector3(-0.8, 0, 0.3), dir: new THREE.Vector3(-0.55, 0.78, 0.9).normalize() }
const goHome = () => {
  controls.target.copy(HOME.target)
  camera.position.copy(HOME.target).addScaledVector(HOME.dir, 42 * Math.max(1, 1.3 / camera.aspect))
}
goHome()

const hemi = new THREE.HemisphereLight('#f4f7ff', '#c9c2b8', 0.4)
scene.add(hemi)
/* Daylight from the right-hand windows and a little from the front, so faces at the desks are lit from the side. */
const sun = new THREE.DirectionalLight('#fff4e3', 2.6)
sun.position.set(22, 17, 9)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 })
sun.shadow.radius = 5
sun.shadow.blurSamples = 12
sun.shadow.bias = -0.0006
scene.add(sun)
/* Warm pools of light under the pendants, lit only at night. */
const lamps = roomLights.map(([x, z]) => {
  const l = new THREE.PointLight('#ffd9a0', 0, 9, 2)
  l.position.set(x, 2.4, z)
  scene.add(l)
  return l
})

let resizeComposer = () => {}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  /* The composer is made further down; a resize during loading comes before it exists. */
  resizeComposer()
  labels.setSize(innerWidth, innerHeight)
})

mergeStatic()
scene.add(world)
scene.add(pongBall)
scene.add(mice.group)
const holo = hologram()
scene.add(holo.root)

/*
 * Ambient occlusion: the soft darkening where a chair meets the floor, under
 * a desk, in a room's corners. Glass, decals and anything else see-through is
 * left out, or the panes would shade what stands behind them.
 */
class SolidAO extends GTAOPass {
  overrideVisibility() {
    super.overrideVisibility()
    this.scene.traverse(o => o.isMesh && o.material?.transparent && (o.visible = false))
  }
}
const composer = new EffectComposer(renderer)
resizeComposer = () => composer.setSize(innerWidth, innerHeight)
composer.addPass(new RenderPass(scene, camera))
const ao = new SolidAO(scene, camera, innerWidth, innerHeight)
ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.6, thickness: 1.2, scale: 1.1 })
ao.blendIntensity = 0.9
composer.addPass(ao)
composer.addPass(new OutputPass())

/*
 * Quality steps down, never up, if the office can't keep up: first the
 * ambient occlusion goes, then the pixel ratio drops to 1. Only measured
 * while the page is on screen, since a hidden tab runs slowly on purpose.
 */
let quality = 2
/* A capture steps many frames at once; the seconds around one say nothing about speed. */
let shotAt = 0
let slow = 0
const fullRatio = Math.min(devicePixelRatio, 2)
const setQuality = level => {
  quality = level
  renderer.setPixelRatio(level === 0 ? 1 : fullRatio)
  composer.setPixelRatio(level === 0 ? 1 : fullRatio)
  composer.setSize(innerWidth, innerHeight)
}
const draw = () => (quality === 2 ? composer.render() : renderer.render(scene, camera))

/* ── Day and night ─────────────────────────────────────────────────────── */

const $ = id => document.getElementById(id)
const setTheme = name => {
  applyTheme(name)
  document.documentElement.dataset.theme = name
  scene.background = new THREE.Color(THEMES[name].bg)
  const night = name === 'dark'
  hemi.intensity = night ? 0.12 : 0.3
  hemi.groundColor.set(night ? '#1a1c22' : '#c9c2b8')
  sun.intensity = night ? 0.35 : 2.1
  sun.color.set(night ? '#9fb4ff' : '#fff4e3')
  scene.environmentIntensity = night ? 0.22 : 0.5
  lampGlow.emissiveIntensity = night ? 3 : 0.5
  /* Unlit lamps are switched off entirely, so daytime shading skips them. */
  for (const l of lamps) ((l.intensity = night ? 7 : 0), (l.visible = night))
  renderer.toneMappingExposure = night ? 1.1 : 1.0
  paintLabels(THEMES[name].label)
  $('themeBtn').textContent = night ? '☀︎' : '☾'
  stored('office-theme', name)
}
setTheme(stored('office-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
$('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')

/* ── View controls ─────────────────────────────────────────────────────── */

const orbit = (angle, tilt = 0) => {
  const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
  s.theta += angle
  s.phi = THREE.MathUtils.clamp(s.phi + tilt, 0.15, controls.maxPolarAngle)
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s))
}
const zoom = f => camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).multiplyScalar(f))
const VIEW = { left: () => orbit(Math.PI / 4), right: () => orbit(-Math.PI / 4), in: () => zoom(0.75), out: () => zoom(1.33), top: () => orbit(0, -2), home: goHome }
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => ((follow = null), VIEW[b.dataset.view]())
addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select')) return
  const pan = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }[e.key.toLowerCase()]
  if (pan) {
    /* Move along the floor, relative to the way the camera faces. */
    follow = null
    const forward = controls.target.clone().sub(camera.position).setY(0).normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
    const step = right.multiplyScalar(pan[0] * 1.2).add(forward.multiplyScalar(pan[1] * 1.2))
    controls.target.add(step)
    camera.position.add(step)
  }
  if (e.key === 'q') orbit(Math.PI / 8)
  if (e.key === 'e') orbit(-Math.PI / 8)
  if (e.key === 'Escape') (closeDrawer(), showBrain(false))
})

/* ── Roles ─────────────────────────────────────────────────────────────── */

const ROLE = {
  coordinator: ['Coordinator', '#f5b301'], planner: ['Planner', '#2f6fed'], developer: ['Developer', '#16a34a'], qa: ['QA', '#334155'],
  'test-runner': ['Test runner', '#7c3aed'], 'test-verifier': ['Verifier', '#db2777'], Explore: ['Explorer', '#0891b2'], Plan: ['Architect', '#3b82f6'],
  'general-purpose': ['Generalist', '#64748b'], 'claude-code-guide': ['Guide', '#d97757'], 'statusline-setup': ['Status line', '#a3a3a3'], claude: ['Helper', '#cc785c'],
  'impeccable-asset-producer': ['Asset maker', '#ef4444'], 'impeccable-documenter': ['Documenter', '#14b8a6'],
  'impeccable-finish-reviewer': ['Design reviewer', '#a855f7'], 'impeccable-manual-edit-applier': ['Copy editor', '#eab308'],
}
const isReception = m => !m.kind && /recep/i.test(m.title ?? '')
const kindsInfo = () => Object.fromEntries((state.kinds ?? []).map(k => [k.kind, k]))
const roleLabel = m => (m.kind ? kindsInfo()[m.kind]?.label ?? ROLE[m.kind]?.[0] ?? m.kind : isReception(m) ? 'Receptionist' : 'Floater')
const roleColour = m => (m.kind ? ROLE[m.kind]?.[1] ?? '#64748b' : isReception(m) ? '#0ea5a4' : '#94a3b8')
/** The department a role belongs in; changing someone's role moves them there. */
const DEPT_OF = kind => {
  if (!kind || kind === 'coordinator') return null
  if (['planner', 'Plan', 'Explore', 'claude-code-guide'].includes(kind)) return 'planning'
  if (['qa', 'test-runner', 'test-verifier'].includes(kind)) return 'qa'
  if (kind.startsWith('impeccable')) return 'design'
  return 'engineering'
}

/* ── Keeping the floor in step with the session ────────────────────────── */

let state = { agents: {}, team: { members: [] }, kinds: [] }
/* An edit shows at once; the mod's copy takes over once it has caught up. */
let localTeam = null
let localTeamAt = 0
const team = () => (localTeam && Date.now() - localTeamAt < 8000 ? localTeam : state.team ?? { members: [] })

const people = new Map()
const owners = new Map()
/** Each roster member's own desk, kept between updates. */
const homeDesk = new Map()
let firstSync = true
let unstaffed = 0
const STALE_MS = 15 * 60_000
const isLive = a => (a.id === 'main' ? !a.isWaiting : !a.isDone && Date.now() - a.lastAt < STALE_MS)
/** Someone's jobs, the live ones first and newest first; with more jobs than people, one person may hold several. */
const jobsOf = name =>
  Object.values(state.agents ?? {})
    .filter(a => a.name === name)
    .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.lastAt - a.lastAt)
/** The office holds this many people besides the owner; the mod hands extra jobs to them, never to new bodies. */
const TEAM_SIZE = 10

/** Send someone to a place, holding it for them; null walks them out of the front door. */
const sendTo = (person, spot, instantly = false) => {
  if (person.target === spot) return
  if (person.target) owners.delete(person.target.key)
  if (spot) owners.set(spot.key, person)
  person.target = spot
  person.stayUntil = undefined
  if (instantly && spot) return person.place(spot)
  /* Mid-walk they finish the walk they're on, then set off again from there. */
  if (person.mode === 'walk') return (person.pending = true)
  if (!person.placed) {
    person.root.position.set(ENTRANCE.x, 0, ENTRANCE.y)
    person.placed = true
    return person.walk(route(null, spot), spot)
  }
  person.walk(route(person.spot, spot), spot)
}

/** A free place to spend some time, chosen by weight, not the one they just left. */
const pickActivity = notName => {
  const open = ACTIVITIES.filter(a => a.name !== notName && a.spots.some(s => !owners.has(s.key)))
  let roll = Math.random() * open.reduce((n, a) => n + a.weight, 0)
  for (const a of open) {
    roll -= a.weight
    if (roll <= 0) return a.spots.find(s => !owners.has(s.key))
  }
  return null
}

/* The owner, in their office. */
const you = new Person({ name: 'You', colour: '#8b5cf6', look: 'owner' })
you.isOwner = true
you.setStatus('you')
scene.add(you.root)
you.place(OWNER_SEAT)

const sync = () => {
  const members = team().members ?? []
  const names = new Set(members.map(m => m.name))
  /*
   * Desks stick: whoever already has one in their department keeps it, and
   * someone who moves department takes a free desk there — nobody else shifts.
   */
  const deskOf = new Map()
  const used = new Set()
  const want = members.filter(m => DEPT_OF(m.kind))
  for (const m of want) {
    const kept = homeDesk.get(m.id)
    if (kept && DESKS[DEPT_OF(m.kind)].includes(kept) && !used.has(kept.key)) (deskOf.set(m.name, kept), used.add(kept.key))
  }
  for (const m of want) {
    if (deskOf.has(m.name)) continue
    const free = DESKS[DEPT_OF(m.kind)].find(d => !used.has(d.key))
    if (free) (deskOf.set(m.name, free), used.add(free.key), homeDesk.set(m.id, free))
  }
  const coordinator = members.find(m => m.kind === 'coordinator')
  if (coordinator) deskOf.set(coordinator.name, COORDINATOR_DESK)
  const spareDesk = kind => {
    const d = [...(DESKS[DEPT_OF(kind) ?? 'engineering'] ?? []), ...Object.values(DESKS).flat()].find(x => !used.has(x.key))
    if (d) used.add(d.key)
    return d ?? null
  }

  /*
   * Who is on the floor: the team, and nobody else. A job under a name that
   * isn't on the roster (an older session's newcomer) stays in the HUD count
   * but gets no body, so the office never grows past its people.
   */
  const wanted = new Map(members.map(m => [m.name, { member: m }]))
  unstaffed = Object.values(state.agents ?? {}).filter(a => a.id !== 'main' && !names.has(a.name) && isLive(a)).length

  for (const [name, w] of wanted) {
    const m = w.member
    let person = people.get(name)
    if (!person) {
      person = new Person({ name, colour: roleColour(m), look: m.id ?? name })
      people.set(name, person)
      scene.add(person.root)
    }
    person.member = m
    if (person.colour !== roleColour(m)) person.setColour(roleColour(m))
    const jobs = jobsOf(name)
    const job = jobs[0]
    person.job = job
    person.extraJobs = Math.max(0, jobs.filter(isLive).length - 1)
    person.status = job && isLive(job) ? 'working' : 'idle'
    person.setStatus(person.status)
    person.tasks = tasksOf(name)
    person.setTasks(person.tasks.length)

    let goal
    if (person.status === 'working') {
      /* A floater on a job, or anyone without a desk, takes a spare one in the job's department. */
      let desk = deskOf.get(name)
      if (!desk && person.workDesk && !used.has(person.workDesk.key)) (desk = person.workDesk), used.add(desk.key)
      person.workDesk = desk ?? spareDesk(job.kind)
      goal = person.workDesk ?? person.target
    } else {
      person.workDesk = null
      if (isReception(m)) goal = RECEPTION_SEAT
      else if (person.target?.activity) goal = person.target
      else goal = pickActivity() ?? person.target ?? deskOf.get(name) ?? null
    }
    if (goal !== person.target) sendTo(person, goal, firstSync && !!goal)
  }
  for (const [name, person] of people) if (!wanted.has(name) && person.target !== null) sendTo(person, null)

  /* The owner works when it's their turn: Wren has stopped and waits on them. */
  const waiting = Object.values(state.agents ?? {}).some(a => a.id === 'main' && a.isWaiting)
  you.mode = waiting ? 'type' : 'relax'

  for (const s of screens) ((s.owner = null), (s.typing = false))
  for (const p of [...people.values(), you]) {
    const screen = p.spot?.screen
    if (screen) ((screen.owner = p.name), (screen.typing = p.mode === 'type' && (p.status === 'working' || p.isOwner)))
  }
  for (const [name, d] of deskOf) if (d.screen && !d.screen.owner) d.screen.owner = name
  firstSync = false
  renderHud()
  drawBoard()
  showNotices()
  if (teamOpen) renderTeam()
  if (brainOpen) brain.render()
}

/** Between tasks, people move on to something else now and then. */
const wander = t => {
  for (const p of people.values()) {
    if (p.status !== 'idle' || p.mode === 'walk' || !p.spot?.activity) continue
    if (p.stayUntil === undefined) p.stayUntil = t + 25 + Math.random() * 40
    if (t < p.stayUntil) continue
    const next = pickActivity(p.spot.activity.name)
    if (next) sendTo(p, next)
    else p.stayUntil = t + 10
  }
}

/* The ball only flies when both ends of the table are taken. */
const playPong = t => {
  const [a, b] = ACTIVITIES.find(x => x.name === 'pong').spots.map(s => owners.get(s.key)).map(p => (p?.mode === 'pong' ? p : null))
  pongBall.visible = !!(a && b)
  if (!pongBall.visible) return
  const period = 1.1
  const leg = Math.floor(t / period)
  const u = (t % period) / period
  const fromLeft = leg % 2 === 0
  pongBall.position.set(
    THREE.MathUtils.lerp(fromLeft ? PONG.x0 : PONG.x1, fromLeft ? PONG.x1 : PONG.x0, u),
    0.8 + Math.abs(Math.sin(u * Math.PI * 1.4)) * 0.25,
    PONG.z + Math.sin(leg * 1.7) * 0.25 * (fromLeft ? u : 1 - u),
  )
  /* The receiver swings as the ball arrives; the hitter follows through just after. */
  const swing = coming => (coming ? Math.max(0, (u - 0.75) * 4) : Math.max(0, 1 - u * 3))
  a.pongSwing = swing(!fromLeft)
  b.pongSwing = swing(fromLeft)
}

/* ── Screens and the meeting-room board ────────────────────────────────── */

const drawScreen = (s, t) => {
  if (t - s.drawnAt < (s.typing ? 160 : 1500)) return
  s.drawnAt = t
  const { ctx } = s
  if (!s.typing) {
    const grad = ctx.createLinearGradient(0, 0, 256, 160)
    grad.addColorStop(0, s.owner ? '#8fb5f2' : '#3a3f4a')
    grad.addColorStop(1, s.owner ? '#c4b2f0' : '#2a2e36')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 160)
    if (s.owner) {
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      ctx.font = '600 30px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(new Date().toTimeString().slice(0, 5), 128, 92)
    }
  } else {
    /* Code that writes itself while the person types. */
    if (s.lines.length > 12) s.lines.shift()
    s.lines.push({ indent: Math.floor(Math.random() * 4), parts: Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => ({ w: 14 + Math.random() * 50, c: ['#7dd3fc', '#f9a8d4', '#fde68a', '#a7f3d0', '#e5e7eb'][Math.floor(Math.random() * 5)] })) })
    ctx.fillStyle = '#1e2433'
    ctx.fillRect(0, 0, 256, 160)
    s.lines.forEach((line, row) => {
      let x = 12 + line.indent * 12
      for (const p of line.parts) ((ctx.fillStyle = p.c), ctx.fillRect(x, 12 + row * 11.5, p.w, 5), (x += p.w + 6))
    })
  }
  s.texture.needsUpdate = true
}

const drawBoard = () => {
  const ctx = board.canvas.getContext('2d')
  const W = board.canvas.width
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, board.canvas.height)
  ctx.fillStyle = '#1d2433'
  ctx.font = '700 30px Inter, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Steps this session', 34, 52)
  const totals = new Map()
  for (const a of Object.values(state.agents ?? {})) totals.set(a.name, (totals.get(a.name) ?? 0) + (a.stepCount ?? 0))
  const list = [...totals].filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 9)
  const max = Math.max(10, ...list.map(([, n]) => n))
  const bw = Math.min(64, (W - 80) / Math.max(1, list.length) - 18)
  list.forEach(([name, n], i) => {
    const h = (n / max) * 240
    const x = 40 + i * (bw + 18)
    ctx.fillStyle = people.get(name)?.colour ?? '#2663eb'
    ctx.beginPath()
    ctx.roundRect(x, 350 - h, bw, Math.max(h, 4), [6, 6, 0, 0])
    ctx.fill()
    ctx.fillStyle = '#5b6474'
    ctx.font = '600 16px Inter, sans-serif'
    ctx.fillText(String(name).slice(0, 7), x, 380)
  })
  board.texture.needsUpdate = true
}

/* ── HUD, hover, toasts ────────────────────────────────────────────────── */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const initials = n => String(n ?? '?').slice(0, 1).toUpperCase()

/** Someone's background tasks that are still running. */
const tasksOf = name => (state.tasks ?? []).filter(t => t.status === 'running' && state.agents?.[t.by]?.name === name)

const agoShort = ms => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}
const renderHud = () => {
  const list = [...people.values()].filter(p => p.target !== null)
  const working = list.filter(p => p.status === 'working').length
  const jobs = list.reduce((n, p) => n + (p.status === 'working' ? 1 + (p.extraJobs ?? 0) : 0), 0) + unstaffed
  const background = (state.tasks ?? []).filter(t => t.status === 'running').length
  $('counts').innerHTML = `<span><span class="dot working"></span> ${working} working${jobs > working ? ` · ${jobs} jobs` : ''}</span><span><span class="dot"></span> ${list.length - working} between tasks</span>${background ? `<span class="bgcount" title="Open the Brain to see them">⟳ ${background} in background</span>` : ''}`
}

const toast = text => {
  const el = Object.assign(document.createElement('div'), { className: 'toast card', textContent: text })
  $('toasts').append(el)
  setTimeout(() => el.remove(), 4500)
}
/* Notices the mod writes (a message delivered, a task started) appear once each. */
let lastNotice = Date.now() - 5000
const showNotices = () => {
  for (const n of state.notices ?? []) if (n.at > lastNotice) ((lastNotice = n.at), toast(n.text))
}

const doing = p => {
  if (p.isOwner) return p.mode === 'type' ? 'Your turn — Wren is waiting for you' : 'Watching the team work'
  if (p.status === 'working') return `${p.mode === 'walk' ? 'Heading to their desk' : p.job?.activity ?? 'Working'}${p.extraJobs ? ` (+${p.extraJobs} more job${p.extraJobs > 1 ? 's' : ''})` : ''}`
  if (p.mode === 'walk') return 'Walking over'
  if (p.target === RECEPTION_SEAT) return 'At the front desk'
  return p.spot?.activity?.words ?? 'Taking a moment'
}

const pointer = new THREE.Vector2()
const ray = new THREE.Raycaster()
let hovered = null
const pick = e => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(pointer, camera)
  return ray.intersectObjects([...people.values(), you].map(p => p.hit))[0]?.object.userData.person ?? null
}
renderer.domElement.addEventListener('pointermove', e => {
  const p = pick(e)
  if (p !== hovered) {
    if (hovered && hovered.name !== selected) hovered.setHover(false)
    p?.setHover(true)
    hovered = p
    renderer.domElement.style.cursor = p ? 'pointer' : ''
  }
  const el = $('hover')
  if (!p) return el.classList.remove('show')
  const m = p.member ?? {}
  el.innerHTML = `<b>${esc(p.name)}</b> · ${esc(p.isOwner ? 'Owner' : roleLabel(m))}${p.job?.model ? ` · ${esc(p.job.model)}` : ''}<div>${esc(doing(p))}</div>${p.job?.description && !p.isOwner ? `<div class="muted">${p.status === 'working' ? 'Task' : 'Last task'}${esc(projectTag(p.job))}: ${esc(p.job.description)}</div>` : ''}${(p.tasks ?? []).map(t => `<div class="muted">⟳ In the background: ${esc(t.label)} · ${esc(agoShort(t.startedAt))}</div>`).join('')}<div class="muted">Click to chat</div>`
  el.style.left = `${Math.min(e.clientX + 16, innerWidth - 320)}px`
  el.style.top = `${Math.min(e.clientY + 16, innerHeight - 150)}px`
  el.classList.add('show')
})
renderer.domElement.addEventListener('pointerleave', () => $('hover').classList.remove('show'))
let downAt = null
renderer.domElement.addEventListener('pointerdown', e => (downAt = [e.clientX, e.clientY]))
renderer.domElement.addEventListener('pointerup', e => {
  /* A drag moves the camera; only a still click picks someone. */
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return
  const p = pick(e)
  if (p) return openDrawer(p.name)
  /* The brain floating above the office opens the Brain panel. */
  if (ray.intersectObject(holo.hit).length) showBrain(true)
})

/* ── The chat drawer ───────────────────────────────────────────────────── */

let selected = null
let tab = 'chat'
let follow = null
const personNamed = name => (name === 'You' ? you : people.get(name))

const openDrawer = name => {
  if (selected && selected !== name) personNamed(selected)?.setHover(false)
  selected = name
  const p = personNamed(name)
  if (!p) return
  p.setHover(true)
  follow = p
  $('drawer').classList.add('open')
  delete $('saySession').dataset.picked
  fillDrawer()
  loadFeed(true)
  $('say').focus()
}
const closeDrawer = () => {
  personNamed(selected)?.setHover(false)
  selected = null
  follow = null
  $('drawer').classList.remove('open')
}
$('dClose').onclick = closeDrawer
for (const b of document.querySelectorAll('.tabs button')) {
  b.onclick = () => {
    tab = b.dataset.tab
    for (const o of document.querySelectorAll('.tabs button')) o.classList.toggle('on', o === b)
    loadFeed(true)
  }
}

const wrenName = () => team().members?.find(m => m.kind === 'coordinator')?.name ?? 'Wren'
/** The newest open session's main conversation: where a message to Wren lands by default. */
const mainOf = sessionId => Object.values(state.agents ?? {}).find(a => a.id === 'main' && (!sessionId || a.sessionId === sessionId))
const multi = () => (state.sessions?.length ?? 0) > 1
const projectTag = job => (multi() && job?.project ? ` (${job.project})` : '')
const fillDrawer = () => {
  const p = personNamed(selected)
  if (!p) return
  const m = p.member ?? {}
  $('dAvatar').textContent = initials(p.name)
  $('dAvatar').style.background = p.colour
  $('dName').textContent = p.name
  $('dMeta').textContent = [p.isOwner ? 'Owner' : roleLabel(m), p.job?.model, doing(p)].filter(Boolean).join(' · ')
  $('dTask').textContent = p.job?.description && !p.isOwner ? `${p.status === 'working' ? 'Task' : 'Last task'}${projectTag(p.job)}: ${p.job.description}` : ''
  /* With several sessions open, the owner picks which one a message goes to; a busy person's own session comes first. */
  const sel = $('saySession')
  sel.hidden = !multi()
  if (multi()) {
    /* A busy person's own session; for Wren or the owner, the session waiting on them; else whatever was picked. */
    const prefer = p.status === 'working' && !p.isOwner ? p.job?.sessionId : sel.dataset.picked || state.sessions.find(x => x.waiting)?.id || state.sessions[0].id
    sel.innerHTML = state.sessions.map(x => `<option value="${esc(x.id)}"${x.id === prefer ? ' selected' : ''}>${esc(x.project)}${x.waiting ? ' · waiting on you' : ''}</option>`).join('')
  }
  $('sayHint').textContent =
    p.isOwner || p.name === wrenName()
      ? `Goes to ${wrenName()} as your next message in the Claude chat.`
      : p.status === 'working'
        ? `${p.name} is busy — ${wrenName()} passes your message on to them.`
        : m.kind
          ? `${p.name} starts on it straight away, as your ${roleLabel(m).toLowerCase()}.`
          : `${p.name} has no role yet, so they take it on as a generalist.`
  $('say').placeholder = `Message ${p.isOwner ? wrenName() : p.name}…`
}

const ago = ms => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}
let feedKey = ''
const loadFeed = async reset => {
  if (!selected) return
  const p = personNamed(selected)
  const job = p?.isOwner ? mainOf($('saySession').hidden ? undefined : $('saySession').value) : p?.job
  const feed = $('feed')
  const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40
  if (!job) {
    feed.innerHTML = `<div class="empty">${esc(selected)} hasn't had a task yet this session. Send one below.</div>`
    return
  }
  if (tab === 'steps') {
    const steps = [...(job.steps ?? [])].reverse()
    feed.innerHTML = steps.length ? steps.map(s => `<div class="step"><time>${ago(s.at)}</time><span>${esc(s.what)}</span></div>`).join('') : '<div class="empty">Nothing done yet.</div>'
    return
  }
  const res = await api(`transcript?agent=${encodeURIComponent(job.id)}&session=${encodeURIComponent(job.sessionId ?? '')}`).catch(() => null)
  if (!res) return
  const key = `${job.id}:${res.messages.length}:${JSON.stringify(res.messages.at(-1) ?? '')}`
  if (!reset && key === feedKey) return
  feedKey = key
  feed.innerHTML = res.messages.length
    ? res.messages.map(m => (m.role === 'tools' ? `<div class="toolrow">${m.tools.map(t => `<span>${esc(t.replace(/^mcp__/, '').replace(/__/g, ' · '))}</span>`).join('')}</div>` : `<div class="msg ${m.role}">${esc(m.text)}</div>`)).join('')
    : `<div class="empty">${res.missing ? 'Their conversation shows here once it is written.' : 'Nothing said yet.'}</div>`
  if (reset || stick) feed.scrollTop = feed.scrollHeight
}
setInterval(() => loadFeed(false), 3000)

$('composer').onsubmit = async e => {
  e.preventDefault()
  const text = $('say').value.trim()
  if (!text || !selected) return
  const to = selected === 'You' ? wrenName() : selected
  try {
    const p = personNamed(selected)
    const session = !$('saySession').hidden ? $('saySession').value : p?.status === 'working' ? p.job?.sessionId : state.sessions?.[0]?.id
    await api('message', { to, text, session: session ?? null })
    $('say').value = ''
    toast(`Sent to ${to}`)
  } catch {
    toast('Could not send — is the session still open?')
  }
}
$('say').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), $('composer').requestSubmit())
})

/* ── The Team window ───────────────────────────────────────────────────── */

let teamOpen = false
$('teamBtn').onclick = () => {
  teamOpen = !teamOpen
  if (teamOpen) showBrain(false)
  $('team').classList.toggle('open', teamOpen)
  if (teamOpen) renderTeam()
}
$('teamClose').onclick = () => ((teamOpen = false), $('team').classList.remove('open'))

/* ── The Brain ─────────────────────────────────────────────────────────── */

/* The brain panel and the Team window share the left side; opening one closes the other. */
let brainOpen = false
const brain = brainPanel({
  state: () => state,
  members: () => team().members ?? [],
  person: name => people.get(name),
  colourOf: roleColour,
  roleOf: roleLabel,
  isLive,
  open: name => openDrawer(name),
})
const showBrain = open => {
  brainOpen = open
  if (open) ((teamOpen = false), $('team').classList.remove('open'), brain.render())
  $('brain').classList.toggle('open', open)
}
$('brainBtn').onclick = () => showBrain(!brainOpen)
$('counts').addEventListener('click', e => e.target.closest('.bgcount') && showBrain(true))
$('brainClose').onclick = () => showBrain(false)

const saveTeam = members => {
  localTeam = { members }
  localTeamAt = Date.now()
  sync()
  clearTimeout(saveTeam.t)
  saveTeam.t = setTimeout(() => api('team', localTeam).catch(() => toast('Could not save the team')), 400)
}

const roleOptions = value =>
  [['', 'Floater — helps wherever needed'], ['@reception', 'Receptionist'], ...(state.kinds ?? []).filter(k => k.kind !== 'coordinator').map(k => [k.kind, k.label])]
    .map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`)
    .join('')
const dutiesOf = m =>
  m.kind ? kindsInfo()[m.kind]?.duties ?? '' : isReception(m) ? 'Looks after the front desk, and takes on any job when the team is stretched.' : 'Moves around the office and picks up any job when the team is stretched.'

const renderTeam = () => {
  /* Don't redraw under the owner while they're editing a field. */
  if (document.activeElement?.closest?.('#teamList')) return
  const members = team().members ?? []
  $('hire').textContent = members.length >= TEAM_SIZE ? `Team full — ${TEAM_SIZE} people` : '＋ Add a person'
  const groups = [
    ['Leadership', m => m.kind === 'coordinator'],
    ...Object.entries(DEPARTMENTS).map(([k, d]) => [d.label, m => DEPT_OF(m.kind) === k]),
    ['Front desk and floaters', m => !m.kind],
  ]
  $('teamList').innerHTML = groups
    .map(([label, test]) => {
      const list = members.filter(test)
      if (!list.length) return ''
      return `<div class="dept">${esc(label)}</div>${list
        .map(m => {
          const p = people.get(m.name)
          const value = m.kind ?? (isReception(m) ? '@reception' : '')
          const role = m.kind === 'coordinator' ? '<div class="duties">Coordinator — talks with you and hands out the work.</div>' : `<select data-f="role" aria-label="Role">${roleOptions(value)}</select><div class="duties">${esc(dutiesOf(m))}</div>`
          return `<div class="member" data-id="${esc(m.id)}">
            <div class="avatar" style="background:${roleColour(m)}">${esc(initials(m.name))}</div>
            <div class="fields">
              <input data-f="name" value="${esc(m.name)}" aria-label="Name">
              ${role}
              <div class="duties"><span class="dot ${p?.status === 'working' ? 'working' : ''}"></span> ${esc(p ? doing(p) : '')}</div>
              <div class="acts"><button class="link" data-act="chat">Chat</button>${m.kind === 'coordinator' ? '' : '<button class="link danger" data-act="remove">Remove</button>'}</div>
            </div></div>`
        })
        .join('')}`
    })
    .join('')
}
$('teamList').addEventListener('change', e => {
  const row = e.target.closest('.member')
  if (!row) return
  const members = structuredClone(team().members ?? [])
  const m = members.find(x => x.id === row.dataset.id)
  if (!m) return
  if (e.target.dataset.f === 'name') {
    const name = e.target.value.trim().slice(0, 30)
    if (!name || name === 'You' || members.some(x => x !== m && x.name === name)) {
      e.target.value = m.name
      return toast('That name is taken')
    }
    const p = people.get(m.name)
    if (p) (p.setName(name), people.delete(m.name), people.set(name, p))
    if (selected === m.name) selected = name
    m.name = name
  }
  if (e.target.dataset.f === 'role') {
    const v = e.target.value
    m.kind = v && v !== '@reception' ? v : null
    m.title = v === '@reception' ? 'Reception' : null
    toast(`${m.name} is now ${v ? `the ${roleLabel(m).toLowerCase()}` : 'a floater'}${DEPT_OF(m.kind) ? ` in ${DEPARTMENTS[DEPT_OF(m.kind)].label}` : ''}`)
  }
  e.target.blur()
  saveTeam(members)
  renderTeam()
})
$('teamList').addEventListener('click', e => {
  const act = e.target.dataset?.act
  const row = e.target.closest('.member')
  if (!act || !row) return
  const members = structuredClone(team().members ?? [])
  const m = members.find(x => x.id === row.dataset.id)
  if (!m) return
  if (act === 'chat') openDrawer(m.name)
  if (act === 'remove') (saveTeam(members.filter(x => x !== m)), renderTeam())
})
$('hire').onclick = () => {
  const members = structuredClone(team().members ?? [])
  if (members.length >= TEAM_SIZE) return toast(`The office holds ${TEAM_SIZE} people — remove someone first`)
  const pool = ['Max', 'Noor', 'Theo', 'Lea', 'Omar', 'Ivy', 'Sam', 'Mia', 'Jude', 'Ren', 'Tara', 'Eli']
  const name = pool.find(n => !members.some(m => m.name === n)) ?? `Person ${members.length + 1}`
  members.push({ id: `p${Date.now().toString(36)}`, name, kind: null, title: null })
  saveTeam(members)
  renderTeam()
  toast(`${name} joined as a floater — pick a role for them in the list`)
}

/* ── Sessions ──────────────────────────────────────────────────────────── */

/* With more than one session open, the HUD lets the owner watch them all or just one project. */
const renderSessions = list => {
  const sel = $('viewSel')
  sel.hidden = list.length < 2
  const html = `<option value="">All ${list.length} sessions</option>${list.map(x => `<option value="${esc(x.id)}"${x.id === viewing ? ' selected' : ''}>${esc(x.project)}</option>`).join('')}`
  if (sel.dataset.html !== html) ((sel.innerHTML = html), (sel.dataset.html = html))
  if (viewing && !list.some(x => x.id === viewing)) viewing = ''
}
$('viewSel').onchange = e => ((viewing = e.target.value), poll())
$('saySession').onchange = e => (e.target.dataset.picked = e.target.value)

/* ── The loop ──────────────────────────────────────────────────────────── */

/**
 * Every open session as one office: their agents side by side (keyed by
 * session, labelled with their project), one shared roster, all notices.
 */
const merge = list => {
  const agents = {}
  for (const s of list) for (const [id, a] of Object.entries(s.agents ?? {})) agents[`${s.session.id}:${id}`] = { ...a, sessionId: s.session.id, project: s.session.project ?? 'Session' }
  /* The roster and roles from the newest session that has them (one still on an older mod may not). */
  const withTeam = list.find(s => s.team?.members?.length) ?? {}
  return {
    agents,
    team: withTeam.team ?? { members: [] },
    kinds: withTeam.kinds ?? [],
    notices: list.flatMap(s => s.notices ?? []).sort((a, b) => a.at - b.at),
    /* Every session's searches, each tied to the agent that made it, oldest first. */
    queries: list.flatMap(s => (s.queries ?? []).map(q => ({ ...q, by: `${s.session.id}:${q.by}` }))).sort((a, b) => a.at - b.at),
    /* Every session's background tasks, each tied to the agent that started it. */
    tasks: list.flatMap(s => (s.tasks ?? []).map(t => ({ ...t, by: `${s.session.id}:${t.by}`, sessionId: s.session.id, project: s.session.project ?? 'Session' }))).sort((a, b) => a.startedAt - b.startedAt),
    brain: list.find(s => s.brain)?.brain ?? null,
    sessions: list.map(s => ({ id: s.session.id, project: s.session.project ?? 'Session', waiting: !!s.agents?.main?.isWaiting })),
  }
}
let viewing = ''
const poll = async () => {
  try {
    const list = PINNED ? [await api(`state?session=${encodeURIComponent(PINNED)}`)] : (await api('states')).sessions
    const shown = viewing ? list.filter(s => s.session.id === viewing) : list
    const next = merge(shown.length ? shown : list)
    next.sessions = merge(list).sessions
    $('offline').style.display = list.length ? 'none' : 'block'
    renderSessions(next.sessions)
    state = next
    sync()
    if (selected) fillDrawer()
  } catch {
    $('offline').style.display = 'block'
  }
}
poll()
setInterval(poll, 1000)

const clock = new THREE.Clock()
const frame = (dt = Math.min(clock.getDelta(), 1), t = clock.elapsedTime, paint = true) => {
  wander(t)
  playPong(t)
  for (const [name, p] of people) {
    p.tick(dt, t)
    if (p.gone) (p.dispose(scene), people.delete(name), owners.forEach((o, k) => o === p && owners.delete(k)))
    else if (p.pending && p.mode !== 'walk') ((p.pending = false), p.walk(route(p.spot, p.target), p.target))
  }
  you.tick(dt, t)
  /* A mouse goes where its user's hand takes it; the rest drift home. */
  for (const p of [...people.values(), you]) if (p.mouseAt && p.spot?.mouse) mice.set(p.spot.mouse.index, p.mouseAt)
  mice.update(dt)
  for (const s of screens) drawScreen(s, t * 1000)
  /* Beams from everyone at work up to the brain; a search in the last eight seconds lights theirs. */
  const now = Date.now()
  const lastSearch = new Map()
  for (const q of state.queries ?? []) lastSearch.set(q.by, q.at)
  holo.update(t, [...people.values()].filter(p => p.status === 'working' && p.target !== null).map(p => ({
    person: p,
    colour: p.colour,
    fresh: now - (lastSearch.get(`${p.job?.sessionId}:${p.job?.id}`) ?? 0) < 8000,
  })))
  /* The camera drifts to keep the person you're talking to in view. */
  if (follow) {
    const shift = follow.root.position.clone().setY(0.8).sub(controls.target).multiplyScalar(1 - Math.exp(-2.5 * dt))
    controls.target.add(shift)
    camera.position.add(shift)
  }
  /* With the drawer open, the scene shifts left so that person isn't behind it. */
  if ($('drawer').classList.contains('open') && innerWidth > 800) camera.setViewOffset(innerWidth, innerHeight, 210, 0, innerWidth, innerHeight)
  else camera.clearViewOffset()
  controls.update()
  if (!paint) return
  renderer.info.reset()
  frames++
  draw()
  labels.render(scene, camera)
}
renderer.setAnimationLoop(() => frame())
renderer.domElement.addEventListener('pointerdown', () => (follow = null))

/* For looking under the hood from the browser console. */
window.officeDebug = () => [...people.values()].map(p => ({ name: p.name, status: p.status, mode: p.mode, target: p.target?.key ?? p.target, at: [+p.root.position.x.toFixed(2), +p.root.position.z.toFixed(2)] }))
/* Frames one person up close, for checking how people look. */
window.officeLook = (name, distance = 3.2, angle = 0, lift = 0.35) => {
  const p = personNamed(name)
  if (!p) return 'nobody by that name'
  follow = null
  controls.target.copy(p.head.getWorldPosition(new THREE.Vector3())).setY(p.head.getWorldPosition(new THREE.Vector3()).y + (distance < 1.2 ? 0.06 : -0.15))
  const dir = new THREE.Vector3(Math.sin(p.root.rotation.y + angle), lift, Math.cos(p.root.rotation.y + angle)).normalize()
  camera.position.copy(controls.target).addScaledVector(dir, distance)
  return 'ok'
}
window.officeOpen = name => openDrawer(name)
/* A picture of the office as a PNG data URL, even from a hidden tab: steps the scene a second first so poses settle. */
let shotClock = 1000
window.officeShot = (steps = 60) => {
  shotAt = Date.now()
  for (let i = 0; i < steps; i++) frame(1 / 60, (shotClock += 1 / 60), i === steps - 1)
  return renderer.domElement.toDataURL('image/png')
}
/* Draw calls and triangles in the last frame, and frames a second, for checking the office stays light. */
let fps = 0
let frames = 0
setInterval(() => {
  fps = frames
  frames = 0
  /* No frames at all means the page isn't being drawn (a hidden pane), not that it is slow. */
  /* The first seconds after loading are spent compiling shaders and uploading textures, and are always slow; they say nothing about the machine. */
  if (performance.now() < 10_000) return
  if (document.visibilityState !== 'visible' || quality === 0 || fps === 0 || Date.now() - shotAt < 4000) return
  slow = fps < 48 ? slow + 1 : 0
  if (slow >= 3) ((slow = 0), setQuality(quality - 1))
}, 1000)
renderer.info.autoReset = false
const trianglesIn = root => {
  let n = 0
  root.traverse(o => o.isMesh && (n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3))
  return n
}
window.officePerf = () => ({
  fps, quality, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  building: trianglesIn(world), person: trianglesIn(you.root), meshes: { building: world.children.length, person: you.root.children.length },
})
