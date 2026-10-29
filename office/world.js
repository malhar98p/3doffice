// The building: a reception and lobby at the front door, the owner's office,
// a meeting room and a café along the back, four department rooms in the
// middle, and a lounge and games room at the front. Corridors join them, and
// every walk goes room door → corridors → room door, so nobody crosses a wall.
//
// Everything is at real-world size: desks 75 cm high, seats 47 cm, doors
// 2.1 m, a 2.8 m ceiling line, glass partitions in aluminium frames, windows
// in the two outer walls. The near walls are cut away at half a metre so the
// camera can see in, the way an architect's cutaway does.
//
// Everything here stands still, so once built it is merged into one mesh per
// material: a few dozen draw calls for the whole building instead of thousands.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { tone, mat, box, cyl, at, textures, worldUV, rng, hash } from './kit.js'

export const world = new THREE.Group()
const W = world
const tx = textures()

const CEILING = 2.8
const DOOR_H = 2.1
const DOOR_W = 1.0

/* ── Materials ─────────────────────────────────────────────────────────── */

/** Marks a material: `uv` gives world-space texture coordinates at that many metres a repeat; `quiet` casts no shadow. */
const mark = (m, data) => Object.assign(m.userData, data) && m
const physical = opts => new THREE.MeshPhysicalMaterial(opts)
const upholstery = key => mark(tone(key, { roughness: 0.95, sheen: 0.7, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff'), bumpMap: tx.weave, bumpScale: 1.4 }), { uv: 0.25 })

const M = {
  wall: tone('wall', { roughness: 0.92, bumpMap: tx.plaster, bumpScale: 0.35 }),
  sage: tone('sage', { roughness: 0.92, bumpMap: tx.plaster, bumpScale: 0.35 }),
  slate: tone('slate', { roughness: 0.92, bumpMap: tx.plaster, bumpScale: 0.35 }),
  clay: tone('clay', { roughness: 0.92, bumpMap: tx.plaster, bumpScale: 0.35 }),
  teal: tone('teal', { roughness: 0.92, bumpMap: tx.plaster, bumpScale: 0.35 }),
  skirting: tone('trim', { roughness: 0.55 }),
  slab: tone('slab', { roughness: 0.9 }),
  frame: mat('#a3a8af', 0.32, 0.85),
  glass: mark(physical({ color: '#e4f0f5', roughness: 0.03, transparent: true, opacity: 0.11, depthWrite: false, ior: 1.5, envMapIntensity: 1.6 }), { quiet: true, order: 3 }),
  frost: mark(physical({ color: '#ffffff', roughness: 0.65, transparent: true, opacity: 0.35, depthWrite: false }), { quiet: true, order: 3 }),
  deskTop: mark(tone('deskTop', { map: tx.grain, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 }), { uv: 1.4 }),
  frameWhite: mat('#e8e7e3', 0.42, 0.3),
  acoustic: mat('#8f949b', 0.95, 0, { sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }),
  cable: mat('#1b1c1f', 0.55),
  pad: mat('#2b2d31', 0.95, 0, { sheen: 0.3, sheenColor: new THREE.Color('#ffffff') }),
  keys: new THREE.MeshStandardMaterial({ map: tx.keys, roughness: 0.55 }),
  linen: mat('#ece6da', 0.95, 0, { sheen: 0.5, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide }),
  radiator: mat('#f2f1ed', 0.38, 0.1),
  tiles: mark(physical({ color: '#f4f2ee', map: tx.tile, roughness: 0.15, clearcoat: 0.8 }), { uv: 0.3 }),
  oak: mark(tone('wood', { map: tx.grain, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 }), { uv: 0.9 }),
  walnut: mark(tone('walnut', { map: tx.grain, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3 }), { uv: 0.9 }),
  steel: mat('#2a2c30', 0.42, 0.6),
  chrome: mat('#e1e4e8', 0.12, 1),
  alu: mat('#c3c6cb', 0.32, 0.9),
  plastic: mat('#1f2125', 0.5),
  fabric: upholstery('chair'),
  sofa: upholstery('sofa'),
  sofaWarm: upholstery('sofaWarm'),
  leather: mat('#6e4128', 0.42, 0, { clearcoat: 0.4, clearcoatRoughness: 0.35, sheen: 0.2 }),
  stone: tone('worktop', { roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.12 }),
  cabinet: tone('counter', { roughness: 0.5, clearcoat: 0.2 }),
  ceramic: mat('#efece6', 0.28, 0, { clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  terracotta: mat('#b5735a', 0.85),
  soil: mat('#35261c', 1),
  leaf: mat('#3c7a47', 0.48, 0, { side: THREE.DoubleSide, sheen: 0.35, sheenColor: new THREE.Color('#bff0b0') }),
  leafDark: mat('#285a33', 0.48, 0, { side: THREE.DoubleSide, sheen: 0.35, sheenColor: new THREE.Color('#9fd99a') }),
  bark: mat('#5b4433', 0.9),
  screenBack: mat('#1a1c20', 0.35, 0.2),
  white: mat('#f4f4f2', 0.45),
  felt: mat('#1d4870', 0.8),
  rug: tone('rug', { map: tx.rug, roughness: 0.98, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') }),
  rugAccent: tone('rugAccent', { map: tx.rug, roughness: 0.98, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') }),
  decal: mark(new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: tx.softbox, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), { quiet: true, order: 1 }),
}
/** The lamps' diffusers: soft by day, bright at night. */
export const lampGlow = mark(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff0d4', emissiveIntensity: 0.5, roughness: 0.6 }), { quiet: true })
const BOOKS = ['#7a2e2e', '#2f4a6b', '#c58b2a', '#2f5a45', '#e6dfd0', '#3a3a3a', '#8f6f9a'].map(c => mat(c, 0.75))

const floorMat = (key, map, size, opts = {}) => mark(tone(key, { map, roughness: 0.9, ...opts }), { uv: size, quiet: true })
const F = {
  oak: floorMat('oak', tx.planks, 1.2, { roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
  concrete: floorMat('concrete', tx.concrete, 4, { roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.5 }),
  stone: floorMat('stone', tx.tile, 1.2, { roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  tile: floorMat('tile', tx.tile, 0.8, { roughness: 0.4 }),
  vinyl: floorMat('vinyl', tx.concrete, 3, { roughness: 0.5 }),
}
for (const key of ['carpetPlan', 'carpetEng', 'carpetQA', 'carpetDesign', 'carpetMeet']) F[key] = floorMat(key, tx.carpet, 1, { roughness: 0.98, sheen: 0.3, sheenColor: new THREE.Color('#ffffff') })

/* ── Floors, walls, partitions ─────────────────────────────────────────── */

/* Each layer of floor sits a few millimetres above the one beneath, so overlaps never shimmer. */
const floor = (x0, x1, z0, z1, material, y = 0.004) => {
  const m = at(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material), (x0 + x1) / 2, y, (z0 + z1) / 2, W)
  m.rotation.x = -Math.PI / 2
}

/** A box spanning [a, b] along a wall's axis, at `c` across it. */
const piece = (axis, c, a, b, y0, y1, depth, material, r = 0.004) =>
  axis === 'x'
    ? at(box(b - a, y1 - y0, depth, material, r), (a + b) / 2, (y0 + y1) / 2, c, W)
    : at(box(depth, y1 - y0, b - a, material, r), c, (y0 + y1) / 2, (a + b) / 2, W)

/**
 * A solid wall with a skirting board along both faces. `zones` paints
 * stretches of it another colour — [from, to, material] — so a room can
 * have its own wall colour where it meets the outer wall.
 */
const solid = (axis, c, a, b, y0, y1, thick = 0.2, zones = []) => {
  const cuts = [...new Set([a, ...zones.flatMap(([u, v]) => [u, v]).filter(x => x > a && x < b), b])].sort((x, y) => x - y)
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2
    const paint = zones.find(([u, v]) => mid >= u && mid < v)?.[2] ?? M.wall
    piece(axis, c, cuts[i], cuts[i + 1], y0, y1, thick, paint, 0.003)
  }
  if (y0 === 0) piece(axis, c, a, b, 0, 0.08, thick + 0.024, M.skirting, 0.003)
}

/**
 * A tall outer wall with windows: sill at 0.85 m, head at 2.35 m, two panes
 * split by a mullion, a stone sill inside, a linen roller blind part-drawn,
 * and a panel radiator beneath wherever nothing stands against the wall.
 */
const outerWall = (axis, c, from, to, windows, inside, zones = [], noRadiator = []) => {
  const half = 1.0
  solid(axis, c, from, to, 0, 0.85, 0.2, zones)
  solid(axis, c, from, to, 2.35, CEILING, 0.2, zones)
  let a = from
  for (const w of windows) {
    solid(axis, c, a, w - half, 0.85, 2.35, 0.2, zones)
    a = w + half
    piece(axis, c, w - half, w + half, 0.85, 2.35, 0.012, M.glass)
    for (const [y0, y1] of [[0.85, 0.9], [2.3, 2.35]]) piece(axis, c, w - half, w + half, y0, y1, 0.07, M.frame)
    for (const x of [w - half, w, w + half]) piece(axis, c, x - 0.025, x + 0.025, 0.85, 2.35, 0.07, M.frame)
    piece(axis, c + inside * 0.13, w - half - 0.05, w + half + 0.05, 0.82, 0.85, 0.08, M.stone)
    piece(axis, c + inside * 0.135, w - half + 0.02, w + half - 0.02, 2.33, 2.4, 0.06, M.frame, 0.02)
    piece(axis, c + inside * 0.14, w - half + 0.03, w + half - 0.03, 1.88, 2.33, 0.006, M.linen)
    piece(axis, c + inside * 0.14, w - half + 0.03, w + half - 0.03, 1.865, 1.885, 0.016, M.frame, 0.006)
    if (!noRadiator.includes(w)) {
      piece(axis, c + inside * 0.16, w - 0.8, w + 0.8, 0.14, 0.62, 0.07, M.radiator, 0.01)
      for (const x of [w - 0.7, w + 0.7]) piece(axis, c + inside * 0.125, x - 0.012, x + 0.012, 0.36, 0.42, 0.04, M.chrome, 0.006)
    }
  }
  solid(axis, c, a, to, 0.85, 2.35, 0.2, zones)
}

/**
 * A glass partition in an aluminium frame: floor and ceiling tracks, a
 * mullion every metre and a bit, a frosted band at eye level, and a glass
 * door hinged open flat against the panel beside each doorway.
 */
const partition = (axis, c, from, to, doors = [], room = 1) => {
  const cuts = [from, ...doors.flatMap(d => [d - DOOR_W / 2, d + DOOR_W / 2]), to]
  for (let i = 0; i < cuts.length; i += 2) {
    const [a, b] = [cuts[i], cuts[i + 1]]
    if (b - a < 0.05) continue
    piece(axis, c, a, b, 0, 0.05, 0.09, M.frame)
    piece(axis, c, a, b, CEILING - 0.05, CEILING, 0.09, M.frame)
    piece(axis, c, a, b, 0.05, CEILING - 0.05, 0.012, M.glass)
    piece(axis, c, a, b, 1.0, 1.08, 0.016, M.frost)
    const n = Math.max(1, Math.round((b - a) / 1.6))
    for (let j = 0; j <= n; j++) {
      const x = a + ((b - a) * j) / n
      piece(axis, c, x - 0.016, x + 0.016, 0, CEILING, 0.07, M.frame)
    }
  }
  for (const d of doors) {
    const [a, b] = [d - DOOR_W / 2, d + DOOR_W / 2]
    piece(axis, c, a - 0.03, b + 0.03, DOOR_H, DOOR_H + 0.06, 0.09, M.frame)
    piece(axis, c, a, b, DOOR_H + 0.06, CEILING - 0.05, 0.012, M.glass)
    piece(axis, c, a, b, CEILING - 0.05, CEILING, 0.09, M.frame)
    /* The leaf, swung open against the glass on the room side. */
    const leaf = c + room * 0.07
    piece(axis, leaf, b + 0.03, b + 0.98, 0.02, DOOR_H - 0.02, 0.012, M.glass)
    for (const [y0, y1] of [[0.02, 0.12], [DOOR_H - 0.12, DOOR_H - 0.02]]) piece(axis, leaf, b + 0.03, b + 0.2, y0, y1, 0.03, M.alu)
    piece(axis, leaf + room * 0.04, b + 0.88, b + 0.91, 0.75, 1.45, 0.025, M.chrome, 0.01)
  }
}

/* Room names lie on the floor inside each door: quiet, readable, never in the way. */
const labels = []
const floorLabel = (text, x, z, rotation = 0) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 96 })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.49), mark(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), { quiet: true, order: 2 }))
  m.rotation.set(-Math.PI / 2, 0, rotation)
  m.position.set(x, 0.021, z)
  labels.push({ canvas, texture, text })
  W.add(m)
}
export const paintLabels = colour => {
  for (const { canvas, texture, text } of labels) {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, 512, 96)
    ctx.fillStyle = colour
    ctx.font = '700 44px Inter, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.letterSpacing = '6px'
    ctx.fillText(text.toUpperCase(), 256, 62)
    texture.needsUpdate = true
  }
}

/** A soft contact shadow on the floor under a piece of furniture. */
const contact = (x, z, w, d, rotation = 0, y = 0.028) => {
  const m = at(new THREE.Mesh(new THREE.PlaneGeometry(w * 1.25, d * 1.25), M.decal), x, y, z, W)
  m.rotation.set(-Math.PI / 2, 0, rotation)
}

/* ── Lights in the ceiling ─────────────────────────────────────────────── */

/** A linear LED pendant hung on two wires. */
const linearLamp = (x, z, length = 1.6, rotation = 0) => {
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = rotation
  at(box(length, 0.045, 0.07, M.frame, 0.008), 0, 2.6, 0, g)
  at(box(length - 0.03, 0.006, 0.055, lampGlow, 0.002), 0, 2.576, 0, g)
  for (const s of [-1, 1]) at(cyl(0.0015, 0.0015, 0.18, M.steel, 4), s * (length / 2 - 0.12), 2.71, 0, g)
}
/** A frosted globe on a cord. */
const globeLamp = (x, z, y = 2.15, r = 0.15) => {
  at(cyl(0.003, 0.003, CEILING - y - r, M.plastic, 4), x, (CEILING + y + r) / 2, z, W)
  at(cyl(0.05, 0.05, 0.02, M.frame, 16), x, CEILING - 0.01, z, W)
  at(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), lampGlow), x, y, z, W)
}

/* ── Plants ────────────────────────────────────────────────────────────── */

const leafShape = (w, h) => {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(w * 0.62, h * 0.15, w * 0.55, h * 0.78, 0, h)
  s.bezierCurveTo(-w * 0.55, h * 0.78, -w * 0.62, h * 0.15, 0, 0)
  return new THREE.ShapeGeometry(s, 6)
}

/** A potted plant: a fiddle-leaf fig on a trunk, or a snake plant of upright blades. */
const plant = (x, z, size = 1, kind = 'ficus') => {
  const r = rng(hash(`${x},${z}`))
  const g = at(new THREE.Group(), x, 0, z, W)
  const potH = 0.42 * size
  const pot = new THREE.LatheGeometry([[0, 0], [0.13 * size, 0], [0.16 * size, potH * 0.85], [0.17 * size, potH], [0.155 * size, potH], [0.15 * size, potH * 0.9], [0, potH * 0.9]].map(([a, b]) => new THREE.Vector2(a, b)), 28)
  at(new THREE.Mesh(pot, r() < 0.5 ? M.ceramic : M.terracotta), 0, 0, 0, g)
  at(cyl(0.148 * size, 0.148 * size, 0.01, M.soil, 20), 0, potH * 0.88, 0, g)
  contact(x, z, 0.4 * size, 0.4 * size)
  if (kind === 'snake') {
    for (let i = 0; i < 12; i++) {
      const leaf = at(new THREE.Mesh(leafShape(0.08 * size, (0.5 + r() * 0.4) * size), i % 3 ? M.leaf : M.leafDark), (r() - 0.5) * 0.12 * size, potH * 0.85, (r() - 0.5) * 0.12 * size, g)
      leaf.rotation.set((r() - 0.5) * 0.35, r() * Math.PI, (r() - 0.5) * 0.35)
    }
    return
  }
  const trunk = 1.25 * size
  at(cyl(0.014 * size, 0.024 * size, trunk, M.bark, 8), 0, potH + trunk / 2 - 0.05, 0, g)
  for (let i = 0; i < 40; i++) {
    const h = potH + trunk * (0.35 + r() * 0.7)
    const a = r() * Math.PI * 2
    const d = (0.05 + r() * 0.24) * size * (1.2 - (h - potH) / trunk / 1.4)
    const leaf = at(new THREE.Mesh(leafShape(0.15 * size, 0.22 * size), i % 3 ? M.leaf : M.leafDark), Math.cos(a) * d, h, Math.sin(a) * d, g)
    leaf.rotation.set(-0.9 + r() * 1.1, -a + Math.PI / 2, (r() - 0.5) * 0.6, 'YXZ')
  }
}

/* ── Furniture ─────────────────────────────────────────────────────────── */

/** A task chair: five-star base on casters, gas lift, padded seat (top at 47 cm), mesh back, armrests. `facing` is the way its sitter looks. */
const taskChair = (x, z, facing, { back = 0.5, cover = M.fabric } = {}) => {
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = facing
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const leg = at(box(0.3, 0.03, 0.045, M.plastic, 0.012), Math.cos(a) * 0.15, 0.075, Math.sin(a) * 0.15, g)
    leg.rotation.y = -a
    at(new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), M.plastic), Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29, g)
  }
  at(cyl(0.035, 0.045, 0.06, M.plastic, 14), 0, 0.09, 0, g)
  at(cyl(0.02, 0.02, 0.28, M.chrome, 12), 0, 0.25, 0, g)
  at(box(0.2, 0.04, 0.22, M.plastic, 0.01), 0, 0.385, 0, g)
  at(box(0.48, 0.07, 0.47, cover, 0.03), 0, 0.435, 0.01, g)
  const rest = at(box(0.45, back, 0.05, cover, 0.025), 0, 0.53 + back / 2, -0.25, g)
  rest.rotation.x = -0.1
  at(box(0.06, 0.32, 0.03, M.plastic, 0.01), 0, 0.52, -0.25, g)
  for (const s of [-1, 1]) {
    at(box(0.028, 0.2, 0.04, M.plastic, 0.01), s * 0.255, 0.53, -0.04, g)
    at(box(0.06, 0.025, 0.24, M.plastic, 0.012), s * 0.255, 0.64, -0.02, g)
  }
  contact(x, z, 0.62, 0.62)
}

/** A cable lying along points given in a group's space. */
const cable = (points, parent, radius = 0.0028) =>
  at(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(8, points.length * 6), radius, 5), M.cable), 0, 0, 0, parent)

/**
 * Every desk's mouse and its cable, kept out of the static merge because
 * they move: the mouse slides under the hand of whoever uses it, and its
 * cable is re-laid from the laptop's port each time it does. All mice are
 * one instanced mesh and all cables one mesh, so they cost two draw calls.
 */
const MOUSE_SEGMENTS = 22
export const mice = {
  list: [],
  group: new THREE.Group(),
  add(home, port, facing) {
    this.list.push({ home, port, facing, at: home.clone(), target: null, drawn: null })
    return this.list.length - 1
  },
  /** The cable: out of the port, a loop of slack on the desk, into the back of the mouse. */
  curve(m) {
    const [fx, fz] = [Math.sin(m.facing), Math.cos(m.facing)]
    const [rx, rz] = [-Math.cos(m.facing), Math.sin(m.facing)]
    const back = new THREE.Vector3(m.at.x + fx * 0.055, 0.757, m.at.z + fz * 0.055)
    const out = m.port.clone().add(new THREE.Vector3(rx * 0.035, -0.003, rz * 0.035))
    const slack = out.clone().lerp(back, 0.5).add(new THREE.Vector3(rx * 0.04 + fx * 0.05, 0, rz * 0.04 + fz * 0.05)).setY(0.753)
    return new THREE.CatmullRomCurve3([m.port, out, slack, back.clone().add(new THREE.Vector3(fx * 0.03, -0.002, fz * 0.03)), back])
  },
  build() {
    const shape = new THREE.SphereGeometry(1, 22, 12)
    const sp = shape.attributes.position
    for (let i = 0; i < sp.count; i++) sp.setXYZ(i, sp.getX(i) * 0.031, Math.max(sp.getY(i), -0.35) * 0.02 + 0.007, sp.getZ(i) * 0.056)
    shape.computeVertexNormals()
    this.body = new THREE.InstancedMesh(shape, mat('#e6e6e3', 0.32, 0, { clearcoat: 0.6, clearcoatRoughness: 0.3 }), this.list.length)
    this.body.castShadow = this.body.receiveShadow = true
    this.stride = new THREE.TubeGeometry(this.curve(this.list[0]), MOUSE_SEGMENTS, 0.0017, 5).toNonIndexed().attributes.position.count
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.list.length * this.stride * 3), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.list.length * this.stride * 3), 3))
    this.cables = new THREE.Mesh(geometry, M.cable)
    this.cables.frustumCulled = this.body.frustumCulled = false
    this.cables.castShadow = true
    this.list.forEach((_, i) => this.draw(i))
    this.group.add(this.body, this.cables)
  },
  draw(i) {
    const m = this.list[i]
    const tube = new THREE.TubeGeometry(this.curve(m), MOUSE_SEGMENTS, 0.0017, 5).toNonIndexed()
    this.cables.geometry.attributes.position.array.set(tube.attributes.position.array, i * this.stride * 3)
    this.cables.geometry.attributes.normal.array.set(tube.attributes.normal.array, i * this.stride * 3)
    tube.dispose()
    this.body.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(m.at.x, 0.753, m.at.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.facing), new THREE.Vector3(1, 1, 1)))
    m.drawn = m.at.clone()
  },
  /** Where someone's hand is taking a mouse this frame; mice nobody holds drift back home. */
  set(i, pos) {
    this.list[i].target = pos
  },
  update(dt) {
    let moved = false
    this.list.forEach((m, i) => {
      const goal = m.target ?? m.home
      const k = 1 - Math.exp(-(m.target ? 30 : 4) * dt)
      m.at.x += (goal.x - m.at.x) * k
      m.at.z += (goal.z - m.at.z) * k
      m.target = null
      if (m.at.distanceTo(m.drawn) > 0.0004) ((moved = true), this.draw(i))
    })
    if (!moved) return
    this.cables.geometry.attributes.position.needsUpdate = true
    this.cables.geometry.attributes.normal.needsUpdate = true
    this.body.instanceMatrix.needsUpdate = true
  },
}

/* Things people keep on their desks, one or two to a desk, so no two look alike. */
const ACCESSORIES = [
  (g, r) => {
    at(cyl(0.042, 0.038, 0.1, M.ceramic, 18), 0.48, 0.8, -0.08, g)
    at(new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 14, Math.PI), M.ceramic), 0.522, 0.8, -0.08, g).rotation.z = -Math.PI / 2
  },
  (g, r) => {
    const book = at(box(0.15, 0.014, 0.21, BOOKS[Math.floor(r() * BOOKS.length)], 0.004), 0.42, 0.757, 0.06, g)
    book.rotation.y = (r() - 0.5) * 0.4
    at(cyl(0.004, 0.004, 0.14, M.plastic, 6), 0.42, 0.768, 0.06, g).rotation.set(Math.PI / 2, 0, 0.6)
  },
  (g, r) => {
    at(cyl(0.045, 0.038, 0.08, M.ceramic, 16), -0.55, 0.79, 0.18, g)
    for (let i = 0; i < 7; i++) {
      const leaf = at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M.leaf), -0.55 + Math.cos(i) * 0.02, 0.84 + (i % 3) * 0.008, 0.18 + Math.sin(i) * 0.02, g)
      leaf.scale.set(0.7, 1.4, 0.5)
      leaf.rotation.set(Math.sin(i) * 0.6, i, Math.cos(i) * 0.6)
    }
  },
  (g, r) => {
    const band = at(new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 6, 20, Math.PI), M.plastic), 0.5, 0.758, 0.14, g)
    band.rotation.x = -Math.PI / 2
    for (const s of [-1, 1]) at(cyl(0.04, 0.04, 0.03, M.plastic, 16), 0.5 + s * 0.085, 0.766, 0.14, g)
  },
  (g, r) => at(cyl(0.034, 0.034, 0.22, mat(['#3d6b8f', '#b8b8b8', '#2f5a45'][Math.floor(r() * 3)], 0.3, 0.5), 16), 0.58, 0.86, -0.18, g),
  (g, r) => {
    for (let i = 0; i < 4; i++) at(box(0.21, 0.002, 0.297, M.white, 0.001), 0.44, 0.751 + i * 0.002, 0.08, g).rotation.y = (r() - 0.5) * 0.15
  },
]

/**
 * A desk: a 1.4 × 0.7 m oak top at 75 cm on a white steel frame, an
 * acoustic modesty panel and a cable tray along the far side with the power
 * running down a leg, a monitor on a stand, an open laptop with its keys and
 * trackpad, a mouse on a pad with its cable, and a thing or two of its
 * owner's; the chair 0.6 m back on the sitter's side. `facing` is the way the
 * sitter looks. Returns the screen to draw on, where the hands rest, and the
 * mouse.
 */
const screens = []
const desk = (x, z, facing = 0, { top = M.deskTop, small = false } = {}) => {
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = facing
  const r = rng(hash(`desk${x},${z}`))
  const w = small ? 1.2 : 1.4
  at(box(w, 0.025, 0.7, top, 0.004), 0, 0.7375, 0, g)
  for (const s of [-1, 1]) {
    at(box(0.05, 0.7, 0.05, M.frameWhite, 0.004), s * (w / 2 - 0.08), 0.375, 0, g)
    at(box(0.05, 0.025, 0.64, M.frameWhite, 0.004), s * (w / 2 - 0.08), 0.0125, 0, g)
    at(cyl(0.012, 0.012, 0.01, M.plastic, 10), s * (w / 2 - 0.08), 0.005, 0.3, g)
    at(cyl(0.012, 0.012, 0.01, M.plastic, 10), s * (w / 2 - 0.08), 0.005, -0.3, g)
  }
  at(box(w - 0.2, 0.04, 0.04, M.frameWhite, 0.004), 0, 0.705, 0.22, g)
  at(box(w - 0.2, 0.3, 0.018, M.acoustic, 0.006), 0, 0.55, 0.33, g)
  at(box(w - 0.4, 0.05, 0.12, M.steel, 0.004), 0, 0.665, 0.24, g)
  at(cyl(0.03, 0.03, 0.004, M.plastic, 18), 0.06, 0.751, 0.29, g)
  /* The monitor faces the sitter; its picture is drawn by the office each frame. */
  at(box(0.22, 0.012, 0.16, M.alu, 0.006), 0, 0.756, 0.2, g)
  at(box(0.035, 0.32, 0.025, M.alu, 0.006), 0, 0.91, 0.22, g)
  at(box(0.56, 0.33, 0.022, M.screenBack, 0.006), 0, 1.06, 0.19, g)
  at(box(0.012, 0.004, 0.004, mat('#ffffff', 0.3, 0, { emissive: '#b8f0c0', emissiveIntensity: 1.2 }), 0.001), 0.25, 0.9, 0.177, g)
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 160 })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const picture = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  at(new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.31), picture), 0, 1.06, 0.178, g).rotation.y = Math.PI
  /* The laptop: aluminium base with its keyboard and trackpad, lid open a little past upright, showing the same work. */
  at(box(0.31, 0.012, 0.215, M.alu, 0.004), 0, 0.756, -0.13, g)
  const keyboard = at(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.095), M.keys), 0, 0.7625, -0.11, g)
  keyboard.rotation.x = -Math.PI / 2
  at(box(0.11, 0.001, 0.065, mat('#b4b7bc', 0.25, 0.8), 0.001), 0, 0.7625, -0.195, g)
  const lid = at(new THREE.Group(), 0, 0.762, -0.023, g)
  lid.rotation.x = 0.28
  at(box(0.31, 0.205, 0.006, M.alu, 0.003), 0, 0.103, 0, lid)
  at(new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.175), picture), 0, 0.105, -0.0035, lid).rotation.y = Math.PI
  /* Cables: monitor and laptop into the grommet, the tray's power down the right-hand leg to a floor box. */
  cable([[0.03, 0.97, 0.235], [0.04, 0.82, 0.24], [0.06, 0.758, 0.28], [0.06, 0.7, 0.28], [0.25, 0.67, 0.26]], g)
  cable([[0.155, 0.758, -0.09], [0.2, 0.754, -0.07], [0.24, 0.754, 0.08], [0.1, 0.754, 0.25], [0.07, 0.75, 0.29], [0.08, 0.7, 0.28]], g, 0.0022)
  cable([[w / 2 - 0.2, 0.665, 0.26], [w / 2 - 0.09, 0.6, 0.27], [w / 2 - 0.06, 0.3, 0.29], [w / 2 - 0.06, 0.03, 0.31], [w / 2 - 0.1, 0.008, 0.42]], g, 0.0035)
  at(box(0.12, 0.012, 0.12, M.alu, 0.004), w / 2 - 0.1, 0.006, 0.48, g)
  /* The mouse pad; the mouse itself is one of the live ones. */
  at(box(0.22, 0.003, 0.18, M.pad, 0.002), -0.3, 0.7515, -0.15, g)
  for (const i of [0, 1].slice(0, 1 + Math.floor(r() * 2))) ACCESSORIES[Math.floor(r() * ACCESSORIES.length)](g, r, i)
  if (!small) taskChair(x - Math.sin(facing) * 0.6, z - Math.cos(facing) * 0.6, facing)
  contact(x, z, w, 0.75, facing)
  const screen = { texture, ctx: canvas.getContext('2d'), lines: [], typing: false, owner: null, drawnAt: -1e9 }
  screens.push(screen)
  /* Desk space into world space: where the wrists rest, the mouse's home, and the laptop's port. */
  const world = (lx, ly, lz) => new THREE.Vector3(x + lx * Math.cos(facing) + lz * Math.sin(facing), ly, z - lx * Math.sin(facing) + lz * Math.cos(facing))
  const reach = world(0, 0.778, -0.21)
  const home = world(-0.3, 0.753, -0.15)
  const mouse = { index: mice.add(home, world(-0.155, 0.758, -0.09), facing), x: home.x, y: home.y, z: home.z }
  return { screen, reach, mouse }
}
export { screens }

/** A sofa of `seats` places, cushions 45 cm high, on short wooden legs. */
const sofa = (x, z, facing, seats = 3, cover = M.sofa) => {
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = facing
  const seatW = 0.8
  const w = seats * seatW + 0.36
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(cyl(0.022, 0.016, 0.1, M.walnut, 10), lx * (w / 2 - 0.1), 0.05, lz * 0.34, g)
  at(box(w, 0.2, 0.88, cover, 0.04), 0, 0.2, 0, g)
  at(box(w, 0.48, 0.16, cover, 0.05), 0, 0.5, -0.36, g)
  for (let i = 0; i < seats; i++) {
    const cx = -((seats - 1) * seatW) / 2 + i * seatW
    at(box(seatW - 0.015, 0.15, 0.66, cover, 0.06), cx, 0.375, 0.08, g)
    const back = at(box(seatW - 0.02, 0.42, 0.17, cover, 0.07), cx, 0.64, -0.24, g)
    back.rotation.x = -0.14
  }
  for (const s of [-1, 1]) at(box(0.18, 0.34, 0.88, cover, 0.06), s * (w / 2 - 0.09), 0.47, 0, g)
  contact(x, z, w, 0.9, facing)
}

/** A lounge armchair on tapered legs, seat at 44 cm. */
const armchair = (x, z, facing, cover = M.sofaWarm) => {
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = facing
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(cyl(0.018, 0.012, 0.2, M.walnut, 10), lx * 0.3, 0.1, lz * 0.3, g)
  at(box(0.72, 0.16, 0.72, cover, 0.05), 0, 0.28, 0, g)
  at(box(0.56, 0.08, 0.58, cover, 0.04), 0, 0.4, 0.05, g)
  at(box(0.72, 0.42, 0.14, cover, 0.06), 0, 0.55, -0.29, g).rotation.x = -0.12
  for (const s of [-1, 1]) at(box(0.1, 0.24, 0.66, cover, 0.04), s * 0.31, 0.46, 0.01, g)
  contact(x, z, 0.75, 0.75, facing)
}

/** A round upholstered pouf, 42 cm high. */
const pouf = (x, z, cover) => {
  at(cyl(0.25, 0.24, 0.38, cover, 28), x, 0.19, z, W)
  at(new THREE.Mesh(new THREE.SphereGeometry(0.25, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), cover), x, 0.38, z, W).scale.y = 0.16
  contact(x, z, 0.5, 0.5)
}

/** A shelf unit filled with books and a few objects. `facing` is the way its open front faces. */
const bookshelf = (x, z, facing, w = 1.6, h = 1.9, wood = M.oak) => {
  const r = rng(hash(`shelf${x},${z}`))
  const g = at(new THREE.Group(), x, 0, z, W)
  g.rotation.y = facing
  const d = 0.34
  for (const s of [-1, 1]) at(box(0.025, h, d, wood, 0.003), s * (w / 2 - 0.0125), h / 2, 0, g)
  at(box(w, h, 0.012, wood, 0.002), 0, h / 2, -d / 2 + 0.006, g)
  const shelves = 5
  for (let i = 0; i <= shelves; i++) {
    const y = 0.04 + (i * (h - 0.06)) / shelves
    at(box(w - 0.05, 0.025, d, wood, 0.003), 0, y, 0, g)
    if (i === shelves) break
    let bx = -w / 2 + 0.05
    while (bx < w / 2 - 0.12) {
      if (r() < 0.12) {
        at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 16), M.ceramic), bx + 0.06, y + 0.093, 0, g)
        bx += 0.16
        continue
      }
      const bw = 0.02 + r() * 0.03
      const bh = 0.18 + r() * 0.12
      const book = at(new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.2 + r() * 0.06), BOOKS[Math.floor(r() * BOOKS.length)]), bx + bw / 2, y + 0.0125 + bh / 2, 0.02, g)
      if (r() < 0.06) book.rotation.z = 0.25
      bx += bw + 0.002
      if (r() < 0.08) bx += 0.08
    }
  }
  contact(x, z, w, d, facing)
}

/** A rug lying flat, its weave texture once across it. */
const rug = (x, z, w, d, material) => {
  at(new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), material), x, 0.012, z, W)
}

/* ── The building ──────────────────────────────────────────────────────── */

/* The footprint runs x −14…14 and z −10…10. Back (z −10) and right (x 14) are the tall outer walls; left and front are cut away at half a metre. */
at(box(28.4, 0.3, 20.4, M.slab, 0.04), 0, -0.15, 0, W)
floor(-14, 14, -10, 10, F.concrete, 0.002)

/* Corridors: polished concrete. */
floor(-14, 14, -4.5, -3, F.concrete, 0.008)
floor(-14, 14, 4, 5.5, F.concrete, 0.008)
floor(-0.7, 0.7, -3, 4, F.concrete, 0.008)

/* Each room has its own wall colour where it meets the outside: sage in the owner's office, slate in the meeting room, clay in Design, teal in the games room. */
outerWall('x', -10.1, -14.2, 14.2, [-11.5, -4.5, 3.5, 7.5, 11.5], 1, [[-14.2, -7, M.sage], [-7, 1, M.slate]], [3.5, 7.5])
outerWall('z', 14.1, -10, 10, [-7.5, 1, 7.5], -1, [[-3, 4, M.clay], [5.5, 10, M.teal]], [7.5])
solid('z', -14.1, -10.2, 10.2, 0, 0.5)
solid('x', 10.1, -14.2, 0.6, 0, 0.5)
solid('x', 10.1, 2.4, 14.2, 0, 0.5)

/* Back row: owner's office and meeting room behind glass, the café open to the corridor. */
floor(-14, -7, -10, -4.5, F.oak)
floor(-7, 1, -10, -4.5, F.carpetMeet)
floor(1, 14, -10, -4.5, F.tile)
partition('x', -4.5, -14, 1, [-9, -3], -1)
partition('z', -7, -10, -4.5)
partition('z', 1, -10, -4.5)

/* The four departments, with a door each off the back corridor and the spine between Engineering and QA. */
export const DEPARTMENTS = {
  planning: { label: 'Planning & Research', x0: -14, x1: -7, key: 'carpetPlan' },
  engineering: { label: 'Engineering', x0: -7, x1: -0.7, key: 'carpetEng' },
  qa: { label: 'QA & Testing', x0: 0.7, x1: 7, key: 'carpetQA' },
  design: { label: 'Design', x0: 7, x1: 14, key: 'carpetDesign' },
}
for (const d of Object.values(DEPARTMENTS)) {
  d.cx = (d.x0 + d.x1) / 2
  floor(d.x0, d.x1, -3, 4, F[d.key])
}
partition('x', -3, -14, -0.7, [DEPARTMENTS.planning.cx, DEPARTMENTS.engineering.cx], 1)
partition('x', -3, 0.7, 14, [DEPARTMENTS.qa.cx, DEPARTMENTS.design.cx], 1)
partition('x', 4, -14, -0.7)
partition('x', 4, 0.7, 14)
for (const x of [-7, -0.7, 0.7, 7]) partition('z', x, -3, 4)

/* Front row: lounge, lobby with reception, games room. */
floor(-14, -5, 5.5, 10, F.oak)
floor(-5, 5, 5.5, 10, F.stone)
floor(5, 14, 5.5, 10, F.vinyl)
partition('x', 5.5, -14, -5, [-9.5], 1)
partition('z', -5, 5.5, 10)
partition('x', 5.5, 5, 14, [9.5], 1)
partition('z', 5, 5.5, 10)

floorLabel("Owner's office", -10.5, -5.3)
floorLabel('Meeting room', -3, -5.3)
floorLabel('Café', 7.5, -5.3)
for (const d of Object.values(DEPARTMENTS)) floorLabel(d.label, d.cx, 3.45)
floorLabel('Lounge', -9.5, 6.2)
floorLabel('Reception', 1.5, 9.4)
floorLabel('Games room', 9.5, 6.2)

/* ── Desks ─────────────────────────────────────────────────────────────── */

/*
 * Six desks a department, in two rows. People sit facing the camera across
 * their desks, so their faces show. A door path runs along the top aisle, then
 * down the side aisle to the middle aisle for the second row.
 */
export const DESKS = {}
const SIDE = 2.85
for (const [name, d] of Object.entries(DEPARTMENTS)) {
  DESKS[name] = []
  for (const [row, deskZ] of [-0.9, 2.1].entries()) {
    linearLamp(d.cx, deskZ, 4.8)
    for (const dx of [-1.85, 0, 1.85]) {
      const x = d.cx + dx
      const seatZ = deskZ - 0.6
      const { screen, reach, mouse } = desk(x, deskZ, 0)
      const inner = row === 0 ? [[d.cx, -2.4], [x, -2.4], [x, seatZ]] : [[d.cx, -2.4], [d.cx + SIDE, -2.4], [d.cx + SIDE, 0.35], [x, 0.35], [x, seatZ]]
      DESKS[name].push({ key: `desk:${name}:${DESKS[name].length}`, door: `door:${name}`, inner, x, z: seatZ, facing: 0, pose: 'type', screen, reach, mouse })
    }
  }
}
plant(DEPARTMENTS.planning.x0 + 0.45, 3.5, 1.1, 'snake')
plant(DEPARTMENTS.engineering.x1 - 0.4, 3.5, 1.1)
plant(DEPARTMENTS.qa.x0 + 0.4, 3.5, 1.1)
plant(DEPARTMENTS.design.x1 - 0.45, 3.5, 1.1, 'snake')

/* ── Owner's office ────────────────────────────────────────────────────── */

/* An executive desk in walnut: two pedestals and a panel facing the room. */
at(box(1.9, 0.035, 0.9, M.walnut, 0.008), -11.5, 0.7325, -7.9, W)
for (const s of [-1, 1]) at(box(0.42, 0.715, 0.82, M.walnut, 0.006), -11.5 + s * 0.72, 0.3575, -7.9, W)
at(box(1.0, 0.5, 0.025, M.walnut, 0.004), -11.5, 0.45, -7.5, W)
contact(-11.5, -7.9, 1.9, 0.9)
const ownerDesk = { reach: { x: -11.5, y: 0.778, z: -8.17 } }
{
  /* A monitor and laptop on it, sharing the same picture. */
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 160 })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const picture = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  at(box(0.22, 0.012, 0.16, M.alu, 0.006), -11.5, 0.756, -7.62, W)
  at(box(0.035, 0.32, 0.025, M.alu, 0.006), -11.5, 0.91, -7.6, W)
  at(box(0.62, 0.36, 0.022, M.screenBack, 0.006), -11.5, 1.07, -7.63, W)
  at(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), picture), -11.5, 1.07, -7.642, W).rotation.y = Math.PI
  at(box(0.31, 0.012, 0.215, M.alu, 0.004), -11.5, 0.756, -8.04, W)
  const lid = at(new THREE.Group(), -11.5, 0.762, -7.93, W)
  lid.rotation.x = 0.28
  at(box(0.31, 0.205, 0.006, M.alu, 0.003), 0, 0.103, 0, lid)
  at(new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.175), picture), 0, 0.105, -0.0035, lid).rotation.y = Math.PI
  ownerDesk.screen = { texture, ctx: canvas.getContext('2d'), lines: [], typing: false, owner: null, drawnAt: -1e9 }
  const keyboard = at(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.095), M.keys), -11.5, 0.7625, -8.02, W)
  keyboard.rotation.x = -Math.PI / 2
  at(box(0.22, 0.003, 0.18, M.pad, 0.002), -11.15, 0.7515, -8.12, W)
  const home = new THREE.Vector3(-11.15, 0.753, -8.12)
  ownerDesk.mouse = { index: mice.add(home, new THREE.Vector3(-11.345, 0.758, -8.06), 0), x: home.x, y: home.y, z: home.z }
  cable([[-11.48, 0.97, -7.6], [-11.48, 0.758, -7.55], [-11.3, 0.754, -7.5], [-11.0, 0.7, -7.48]], W)
  screens.push(ownerDesk.screen)
}
taskChair(-11.5, -8.6, 0, { back: 0.72, cover: M.leather })
const wrenDesk = desk(-8.2, -8.0, 0)
sofa(-13.4, -6.2, Math.PI / 2, 2, M.leather)
plant(-13.45, -8.55, 1.3)
bookshelf(-9.6, -9.72, 0, 1.6, 1.9, M.walnut)
rug(-11.5, -7.7, 3.0, 2.2, M.rug)
globeLamp(-11.5, -7.9, 2.2, 0.18)
linearLamp(-8.6, -7.6, 1.2, Math.PI / 2)

export const OWNER_SEAT = { key: 'owner', door: 'door:owner', inner: [[-9, -5.4], [-9.9, -6.3], [-9.9, -9.2], [-11.5, -9.2], [-11.5, -8.6]], x: -11.5, z: -8.6, facing: 0, pose: 'relax', seat: 0.48, screen: ownerDesk.screen, reach: ownerDesk.reach, mouse: ownerDesk.mouse }
export const COORDINATOR_DESK = { key: 'desk:coordinator', door: 'door:owner', inner: [[-9, -5.4], [-9, -9.0], [-8.2, -9.0], [-8.2, -8.6]], x: -8.2, z: -8.6, facing: 0, pose: 'type', screen: wrenDesk.screen, reach: wrenDesk.reach, mouse: wrenDesk.mouse }

/* Framed prints on the back wall of the owner's office and the meeting room: abstract colour fields, painted once. */
const print = (x, z, palette, seed) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 192 })
  const ctx = canvas.getContext('2d')
  const r = rng(seed)
  ctx.fillStyle = palette[0]
  ctx.fillRect(0, 0, 256, 192)
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = palette[1 + (i % (palette.length - 1))]
    ctx.globalAlpha = 0.55 + r() * 0.4
    ctx.beginPath()
    ctx.ellipse(r() * 256, r() * 192, 30 + r() * 70, 18 + r() * 50, r() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  at(box(0.94, 0.7, 0.03, M.walnut, 0.004), x, 1.6, z, W)
  at(box(0.86, 0.62, 0.002, M.white, 0.001), x, 1.6, z + 0.016, W)
  at(new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.46), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 })), x, 1.6, z + 0.018, W)
}
print(-13.25, -9.98, ['#efe9df', '#b5603f', '#2f4a5c', '#d9a441'], 3)
print(-6.25, -9.98, ['#e9ece8', '#3e6b62', '#c7c0b3', '#8a3b2e'], 9)

/* ── Meeting room ──────────────────────────────────────────────────────── */

at(box(3.6, 0.035, 1.2, M.oak, 0.01), -3, 0.7325, -7.4, W)
for (const x of [-4.3, -1.7]) {
  at(box(0.08, 0.7, 0.7, M.white, 0.01), x, 0.365, -7.4, W)
  at(box(0.5, 0.02, 0.8, M.white, 0.006), x, 0.01, -7.4, W)
}
contact(-3, -7.4, 3.6, 1.2)
linearLamp(-3, -7.4, 2.8)
const MEET = []
for (const x of [-4.2, -3, -1.8]) {
  taskChair(x, -8.3, 0)
  MEET.push({ x, z: -8.3, facing: 0, pose: 'meet', reach: { x, y: 0.778, z: -7.86 }, inner: [[-3, -5.4], [-5.6, -5.4], [-5.6, -9.0], [x, -9.0], [x, -8.3]] })
  taskChair(x, -6.5, Math.PI)
  MEET.push({ x, z: -6.5, facing: Math.PI, pose: 'meet', reach: { x, y: 0.778, z: -6.94 }, inner: [[-3, -5.4], [x, -5.4], [x, -6.5]] })
}
/* A mobile whiteboard at the room's end, showing the session's work. */
const boardCanvas = Object.assign(document.createElement('canvas'), { width: 768, height: 420 })
export const board = { canvas: boardCanvas, texture: new THREE.CanvasTexture(boardCanvas) }
board.texture.colorSpace = THREE.SRGBColorSpace
at(box(0.04, 1.3, 2.3, M.alu, 0.01), 0.6, 1.4, -7.4, W)
for (const s of [-1, 1]) {
  at(box(0.04, 1.9, 0.04, M.alu, 0.008), 0.6, 0.95, -7.4 + s * 1.18, W)
  at(box(0.5, 0.03, 0.05, M.alu, 0.008), 0.6, 0.06, -7.4 + s * 1.18, W)
}
const boardFace = at(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ map: board.texture, toneMapped: false })), 0.578, 1.4, -7.4, W)
boardFace.rotation.y = -Math.PI / 2
plant(-6.5, -9.5, 1.0, 'snake')

/* ── Café ──────────────────────────────────────────────────────────────── */

/* Base cabinets with a stone worktop at 90 cm, a sink, an espresso machine and a tall fridge. */
at(box(6.5, 0.1, 0.56, M.plastic, 0.005), 5, 0.05, -9.62, W)
at(box(6.5, 0.76, 0.6, M.cabinet, 0.006), 5, 0.48, -9.62, W)
for (let i = 0; i < 9; i++) {
  const x = 2.1 + i * 0.725
  at(box(0.71, 0.74, 0.02, M.cabinet, 0.004), x, 0.48, -9.31, W)
  at(box(0.16, 0.012, 0.02, M.chrome, 0.004), x, 0.8, -9.29, W)
}
at(box(6.6, 0.04, 0.65, M.stone, 0.006), 5, 0.88, -9.6, W)
at(box(0.5, 0.01, 0.38, M.steel, 0.004), 6.2, 0.9, -9.6, W)
at(cyl(0.012, 0.012, 0.28, M.chrome, 10), 6.2, 1.04, -9.8, W)
at(box(0.02, 0.02, 0.18, M.chrome, 0.008), 6.2, 1.17, -9.72, W)
const machine = at(new THREE.Group(), 3.2, 0.9, -9.65, W)
at(box(0.5, 0.42, 0.42, M.chrome, 0.03), 0, 0.21, 0, machine)
at(box(0.5, 0.04, 0.42, M.plastic, 0.02), 0, 0.44, 0, machine)
for (const s of [-1, 1]) at(cyl(0.03, 0.03, 0.06, M.steel, 12), s * 0.1, 0.2, 0.24, machine)
at(box(0.22, 0.38, 0.22, M.plastic, 0.03), 3.7, 1.09, -9.7, W)
for (const x of [4.25, 4.4, 4.55]) at(cyl(0.042, 0.038, 0.1, M.ceramic, 18), x, 0.95, -9.55, W)
/* Open shelf between the windows, mugs and jars on it. */
at(box(1.6, 0.03, 0.28, M.oak, 0.004), 5.5, 1.55, -9.85, W)
for (let i = 0; i < 6; i++) at(cyl(0.045, 0.04, 0.1 + (i % 2) * 0.06, M.ceramic, 16), 4.9 + i * 0.24, 1.615 + (i % 2) * 0.03, -9.84, W)
at(box(2, 0.6, 0.01, M.tiles, 0.002), 5.5, 1.2, -9.895, W)
/* A wall clock over the shelf. */
at(cyl(0.16, 0.16, 0.03, M.plastic, 32), 5.5, 2.05, -9.88, W).rotation.x = Math.PI / 2
at(cyl(0.145, 0.145, 0.032, M.white, 32), 5.5, 2.05, -9.878, W).rotation.x = Math.PI / 2
for (const [len, angle] of [[0.09, 0.9], [0.12, 2.6]]) {
  const hand = at(box(0.006, len, 0.003, M.plastic, 0.001), 5.5 + Math.sin(angle) * len / 2, 2.05 + Math.cos(angle) * len / 2, -9.858, W)
  hand.rotation.z = -angle
}
at(box(0.75, 1.85, 0.68, M.chrome, 0.02), 8.9, 0.925, -9.6, W)
at(box(0.02, 0.6, 0.02, M.steel, 0.008), 8.6, 1.2, -9.25, W)
contact(5, -9.6, 6.6, 0.65)
contact(8.9, -9.6, 0.75, 0.68)
for (const x of [3.8, 5, 6.2]) globeLamp(x, -9.3, 2.05, 0.13)
/* Two standing-height tables, 105 cm, on round bases. */
for (const [x, z] of [[10.5, -7.3], [12.4, -6.2]]) {
  at(cyl(0.38, 0.38, 0.03, M.oak, 32), x, 1.035, z, W)
  at(cyl(0.035, 0.035, 1.0, M.steel, 14), x, 0.52, z, W)
  at(cyl(0.24, 0.26, 0.025, M.steel, 28), x, 0.0125, z, W)
  contact(x, z, 0.6, 0.6)
  globeLamp(x, z, 2.1, 0.15)
}
plant(13.3, -9.3, 1.2)
const CAFE = [
  ...[3.8, 5.0, 6.2].map(x => ({ x, z: -8.75, facing: Math.PI, pose: 'drink', inner: [[6, -5.4], [x, -5.4], [x, -8.75]] })),
  ...[[10.5, -7.3], [12.4, -6.2]].flatMap(([x, z]) => [
    { x: x - 0.7, z, facing: Math.PI / 2, pose: 'chat', inner: [[6, -5.4], [x - 0.7, -5.4], [x - 0.7, z]] },
    { x: x + 0.7, z, facing: -Math.PI / 2, pose: 'drink', inner: [[6, -5.4], [x + 0.7, -5.4], [x + 0.7, z]] },
  ]),
]
const WINDOWS = [7.5, 11.5].map(x => ({ x, z: -9.0, facing: Math.PI, pose: 'stretch', inner: [[6, -5.4], [x, -5.4], [x, -9.0]] }))

/* ── Lounge ────────────────────────────────────────────────────────────── */

rug(-11.3, 7.8, 3.2, 2.6, M.rugAccent)
sofa(-13.4, 7.8, Math.PI / 2, 3)
at(box(0.6, 0.03, 1.2, M.oak, 0.008), -11.7, 0.405, 7.8, W)
for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) at(cyl(0.015, 0.015, 0.39, M.steel, 8), -11.7 + lx * 0.25, 0.195, 7.8 + lz * 0.55, W)
at(box(0.3, 0.04, 0.22, BOOKS[1], 0.004), -11.75, 0.44, 7.6, W)
contact(-11.7, 7.8, 0.6, 1.2)
pouf(-8.0, 8.8, M.sofaWarm)
pouf(-7.8, 6.9, M.sofaWarm)
bookshelf(-5.35, 8.0, -Math.PI / 2, 1.6, 1.9)
plant(-13.4, 9.4, 1.1, 'snake')
/* An arc floor lamp leaning over the sofa. */
at(cyl(0.16, 0.16, 0.03, M.stone, 24), -13.5, 0.015, 6.05, W)
at(cyl(0.012, 0.012, 1.9, M.chrome, 8), -13.5, 0.98, 6.05, W)
at(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.frame), -13.3, 1.95, 6.05, W)
at(new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), lampGlow), -13.3, 1.948, 6.05, W).rotation.x = Math.PI / 2
globeLamp(-9.5, 7.8, 2.1, 0.2)
const LOUNGE = [
  ...[6.85, 7.8, 8.75].map(z => ({ x: -13.15, z, facing: Math.PI / 2, pose: 'read', seat: 0.45, inner: [[-9.5, 6.3], [-12.3, 6.3], [-12.3, z], [-13.15, z]] })),
  ...[[-8.0, 8.8], [-7.8, 6.9]].map(([x, z]) => ({ x, z, facing: -Math.PI / 2, pose: 'phone', seat: 0.42, inner: [[-9.5, 6.3], [x, z]] })),
  { x: -6.1, z: 8.0, facing: Math.PI / 2, pose: 'think', inner: [[-9.5, 6.3], [-6.1, 6.3], [-6.1, 8.0]] },
]

/* ── Reception and lobby ───────────────────────────────────────────────── */

/* A reception counter: a solid front at 1.05 m with an oak ledge, the receptionist's desk behind it. */
at(box(2.6, 1.05, 0.12, M.stone, 0.01), -2.2, 0.525, 8.42, W)
for (const s of [-1, 1]) at(box(0.12, 1.05, 0.5, M.stone, 0.01), -2.2 + s * 1.24, 0.525, 8.23, W)
at(box(2.7, 0.04, 0.34, M.oak, 0.01), -2.2, 1.07, 8.36, W)
contact(-2.2, 8.3, 2.6, 0.5)
const receptionDesk = desk(-2.2, 7.6, 0, { small: true })
taskChair(-2.2, 7.0, 0)
armchair(4.4, 7.6, -Math.PI / 2)
armchair(4.4, 8.6, -Math.PI / 2)
at(cyl(0.22, 0.22, 0.025, M.oak, 24), 4.45, 0.5, 8.1, W)
at(cyl(0.02, 0.02, 0.48, M.steel, 8), 4.45, 0.25, 8.1, W)
at(cyl(0.15, 0.15, 0.015, M.steel, 20), 4.45, 0.008, 8.1, W)
plant(4.4, 6.1, 1.2)
plant(-4.4, 9.5, 1.3)
rug(1.5, 9.55, 1.8, 0.8, M.rug)
for (const x of [-1, 2]) globeLamp(x, 7.6, 2.2, 0.16)
export const RECEPTION_SEAT = { key: 'reception', door: 'node:lobby', inner: [[-2.2, 6.3], [-2.2, 7.0]], x: -2.2, z: 7.0, facing: 0, pose: 'type', screen: receptionDesk.screen, reach: receptionDesk.reach, mouse: receptionDesk.mouse }
const LOBBY = [
  ...[7.6, 8.6].map(z => ({ x: 4.4, z, facing: -Math.PI / 2, pose: 'phone', seat: 0.44, inner: [[3.6, z], [4.4, z]] })),
  { x: 3.7, z: 6.5, facing: Math.atan2(0.7, -0.4), pose: 'water', inner: [[3.7, 6.5]] },
]

/* ── Games room ────────────────────────────────────────────────────────── */

/* A regulation table: 2.74 × 1.525 m at 76 cm, white lines, a net on posts, folding legs. */
const pong = at(new THREE.Group(), 9.5, 0, 7.8, W)
at(box(2.74, 0.025, 1.525, M.felt, 0.004), 0, 0.7475, 0, pong)
for (const [w, d, x, z] of [[2.74, 0.02, 0, 0.752], [2.74, 0.02, 0, -0.752], [0.02, 1.525, 1.36, 0], [0.02, 1.525, -1.36, 0], [2.74, 0.004, 0, 0]]) at(box(w, 0.002, d, M.white, 0.001), x, 0.761, z, pong)
at(box(0.008, 0.15, 1.6, mat('#f1f1f1', 0.7, 0, { transparent: true, opacity: 0.75 }), 0.002), 0, 0.835, 0, pong)
for (const s of [-1, 1]) at(cyl(0.012, 0.012, 0.16, M.steel, 8), 0, 0.83, s * 0.8, pong)
for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  at(box(0.05, 0.73, 0.05, M.steel, 0.006), lx * 1.0, 0.365, lz * 0.6, pong)
  at(cyl(0.03, 0.03, 0.03, M.plastic, 10), lx * 1.0, 0.03, lz * 0.6, pong).rotation.x = Math.PI / 2
}
contact(9.5, 7.8, 2.74, 1.525)
linearLamp(9.5, 7.8, 2.4)
for (const z of [6.9, 8.5]) {
  /* An upright arcade cabinet: side panels, a lit marquee, a tilted screen, a control panel with stick and buttons. */
  const cab = at(new THREE.Group(), 13.5, 0, z, W)
  cab.rotation.y = -Math.PI / 2
  for (const s of [-1, 1]) at(box(0.03, 1.8, 0.72, mat('#24204a', 0.5), 0.01), s * 0.33, 0.9, 0, cab)
  at(box(0.64, 1.8, 0.04, mat('#1c1838', 0.6), 0.01), 0, 0.9, -0.34, cab)
  at(box(0.64, 0.86, 0.6, mat('#1c1838', 0.6), 0.01), 0, 0.43, -0.04, cab)
  at(box(0.64, 0.16, 0.2, mat('#ffffff', 0.3, 0, { emissive: '#ffb347', emissiveIntensity: 0.9 }), 0.01), 0, 1.68, 0.1, cab)
  const screen = at(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshBasicMaterial({ color: '#38bdf8' })), 0, 1.32, 0.06, cab)
  screen.rotation.x = -0.2
  const panel = at(box(0.64, 0.04, 0.3, mat('#2b2b33', 0.45), 0.008), 0, 0.96, 0.26, cab)
  panel.rotation.x = 0.18
  at(cyl(0.006, 0.006, 0.06, M.steel, 6), -0.1, 1.0, 0.27, cab)
  at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), mat('#d62828', 0.3)), -0.1, 1.035, 0.27, cab)
  for (let i = 0; i < 4; i++) at(cyl(0.014, 0.014, 0.012, mat(['#f2c14e', '#38bdf8', '#e63946', '#2a9d8f'][i], 0.3), 12), 0.04 + (i % 2) * 0.05, 0.99, 0.24 + Math.floor(i / 2) * 0.05, cab)
  contact(13.5, z, 0.75, 0.72)
}
plant(13.4, 9.5, 1.0, 'snake')
const GAME = [
  { x: 7.6, z: 7.8, facing: Math.PI / 2, pose: 'pong', inner: [[9.5, 6.3], [7.6, 6.3], [7.6, 7.8]] },
  { x: 11.4, z: 7.8, facing: -Math.PI / 2, pose: 'pong', inner: [[9.5, 6.3], [11.4, 6.3], [11.4, 7.8]] },
  ...[6.9, 8.5].map(z => ({ x: 12.75, z, facing: Math.PI / 2, pose: 'arcade', reach: { x: 13.15, y: 0.99, z }, inner: [[9.5, 6.3], [12.75, 6.3], [12.75, z]] })),
]
export const PONG = { x0: 8.3, x1: 10.7, z: 7.8 }

/* ── What there is to do between tasks ─────────────────────────────────── */

const withDoor = (door, spots) => spots.map(s => ({ ...s, door }))
export const ACTIVITIES = [
  { name: 'coffee', words: 'Getting a coffee in the café', weight: 3, spots: withDoor('door:cafe', CAFE) },
  { name: 'window', words: 'Stretching by the café window', weight: 1, spots: withDoor('door:cafe', WINDOWS) },
  { name: 'meeting', words: 'Talking things through in the meeting room', weight: 2, spots: withDoor('door:meeting', MEET) },
  { name: 'lounge', words: 'Taking a break in the lounge', weight: 2.5, spots: withDoor('door:lounge', LOUNGE) },
  { name: 'pong', words: 'Playing ping-pong', weight: 2, spots: withDoor('door:game', GAME.slice(0, 2)) },
  { name: 'arcade', words: 'On the arcade machine', weight: 1, spots: withDoor('door:game', GAME.slice(2)) },
  { name: 'lobby', words: 'Waiting in the lobby', weight: 0.7, spots: withDoor('node:lobby', LOBBY) },
]
ACTIVITIES.forEach(a => a.spots.forEach((s, i) => Object.assign(s, { key: `${a.name}:${i}`, activity: a })))

/* ── The way between rooms ─────────────────────────────────────────────── */

const NODES = {
  'a:-10.5': [-10.5, -3.75], 'a:-9': [-9, -3.75], 'a:-3.85': [-3.85, -3.75], 'a:-3': [-3, -3.75], 'a:0': [0, -3.75],
  'a:3.85': [3.85, -3.75], 'a:6': [6, -3.75], 'a:10.5': [10.5, -3.75],
  'b:-9.5': [-9.5, 4.75], 'b:0': [0, 4.75], 'b:1.5': [1.5, 4.75], 'b:9.5': [9.5, 4.75],
  'door:planning': [DEPARTMENTS.planning.cx, -3], 'door:engineering': [DEPARTMENTS.engineering.cx, -3],
  'door:qa': [DEPARTMENTS.qa.cx, -3], 'door:design': [DEPARTMENTS.design.cx, -3],
  'door:owner': [-9, -4.5], 'door:meeting': [-3, -4.5], 'door:cafe': [6, -4.5],
  'door:lounge': [-9.5, 5.5], 'door:game': [9.5, 5.5], 'node:lobby': [1.5, 6.3], entrance: [1.5, 11.2],
}
const EDGES = [
  ['a:-10.5', 'a:-9'], ['a:-9', 'a:-3.85'], ['a:-3.85', 'a:-3'], ['a:-3', 'a:0'], ['a:0', 'a:3.85'], ['a:3.85', 'a:6'], ['a:6', 'a:10.5'],
  ['b:-9.5', 'b:0'], ['b:0', 'b:1.5'], ['b:1.5', 'b:9.5'], ['a:0', 'b:0'],
  ['door:planning', 'a:-10.5'], ['door:engineering', 'a:-3.85'], ['door:qa', 'a:3.85'], ['door:design', 'a:10.5'],
  ['door:owner', 'a:-9'], ['door:meeting', 'a:-3'], ['door:cafe', 'a:6'],
  ['door:lounge', 'b:-9.5'], ['door:game', 'b:9.5'], ['node:lobby', 'b:1.5'], ['node:lobby', 'entrance'],
]
const NEXT = {}
for (const [a, b] of EDGES) ((NEXT[a] ??= []).push(b), (NEXT[b] ??= []).push(a))
const dist = (a, b) => Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1])

/** The shortest way between two doors, as points (Dijkstra over a couple of dozen nodes). */
const between = (from, to) => {
  const best = { [from]: 0 }
  const prev = {}
  const open = new Set([from])
  while (open.size) {
    const here = [...open].reduce((x, y) => (best[x] <= best[y] ? x : y))
    open.delete(here)
    if (here === to) break
    for (const n of NEXT[here] ?? []) {
      const d = best[here] + dist(here, n)
      if (d < (best[n] ?? Infinity)) ((best[n] = d), (prev[n] = here), open.add(n))
    }
  }
  const out = []
  for (let n = to; n; n = prev[n]) out.unshift(n)
  return out.map(n => new THREE.Vector2(...NODES[n]))
}

/** The full walk from one place to another; null on either end means the front door. */
export const route = (from, to) => {
  const out = []
  if (from) out.push(...[...from.inner].reverse().slice(1).map(p => new THREE.Vector2(...p)))
  out.push(...between(from?.door ?? 'entrance', to?.door ?? 'entrance'))
  if (to) out.push(...to.inner.map(p => new THREE.Vector2(...p)))
  /* Drop points that repeat the one before. */
  return out.filter((p, i) => i === 0 || p.distanceTo(out[i - 1]) > 0.01)
}
export const ENTRANCE = new THREE.Vector2(...NODES.entrance)

/* ── Moving parts kept apart from the merge ────────────────────────────── */

mice.build()

export const pongBall = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), mat('#ff8a1f', 0.4))
pongBall.castShadow = true

/** Room lights for the evening: warm pools under the pendants. */
export const roomLights = [[-10.5, -7.5], [-3, -7.4], [7.5, -7.5], [-10.5, 0.6], [-3.85, 0.6], [3.85, 0.6], [10.5, 0.6], [-9.5, 7.8], [0.5, 7.6], [9.5, 7.8]]

/* ── Merge what stands still ───────────────────────────────────────────── */

/**
 * One mesh per material for everything static. Textured materials get world-
 * space UVs as they merge, so wood, carpet and concrete keep their real scale.
 */
export const mergeStatic = () => {
  world.updateMatrixWorld(true)
  const groups = new Map()
  world.traverse(o => {
    if (!o.isMesh) return
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
    g.clearGroups()
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
    g.applyMatrix4(o.matrixWorld)
    if (o.material.userData.uv) worldUV(g, o.material.userData.uv)
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (!groups.has(o.material)) groups.set(o.material, [])
    groups.get(o.material).push(g)
  })
  world.clear()
  for (const [material, list] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material)
    mesh.castShadow = !material.transparent && !material.userData.quiet
    mesh.receiveShadow = !material.transparent
    mesh.renderOrder = material.userData.order ?? 0
    world.add(mesh)
  }
}
