// The people: lifelike adults at real-world size — about 1.72 m tall, a head
// an eighth of their height, shoulders a little under half a metre across.
//
// A person is a skeleton (hips, spine, chest, neck, head, shoulders, elbows,
// wrists, hips, knees, ankles, and a bone that lets long hair swing) with a
// skin over it. Arms, legs and the torso are each one continuous surface
// whose vertices are weighted across two or three bones, so an elbow, knee,
// shoulder or waist bends smoothly the way flesh and cloth do, with no seams.
//
// Each frame the skeleton is posed from what they are doing: a walk cycle with
// arm swing, breathing, weight shifts and glances while standing, and two-bone
// arm IK that puts their hands on the keyboard, the mouse, the meeting table
// or the arcade controls. Most joints move on damped springs, so they ease,
// settle and lag a little the way a body does, rather than snapping to a pose.
//
// All of a person's parts in one material are one skinned mesh: a whole
// person is about eight draw calls.

import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { rng, hash, textures } from './kit.js'

const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt))
const dampAngle = (cur, target, k, dt) => cur + Math.atan2(Math.sin(target - cur), Math.cos(target - cur)) * (1 - Math.exp(-k * dt))
const clamp = THREE.MathUtils.clamp
const smooth = THREE.MathUtils.smoothstep
const gauss = (d, s) => Math.exp(-(d * d) / (s * s))
const pick = (list, r) => list[Math.floor(r() * list.length) % list.length]

/**
 * A damped spring toward `target`: `hz` how quickly it answers, `ratio` how
 * much it overshoots (1 never does). Stepped in small slices so a slow frame
 * from a background tab never sends it flying.
 */
const spring = (s, target, dt, hz, ratio) => {
  const w = 2 * Math.PI * hz
  for (let left = dt; left > 1e-6; left -= 1 / 120) {
    const h = Math.min(left, 1 / 120)
    s.v += (w * w * (target - s.x) - 2 * ratio * w * s.v) * h
    s.x += s.v * h
  }
  return s.x
}

/* ── Proportions, in metres ────────────────────────────────────────────── */

const THIGH = 0.41
const SHIN = 0.41
const ANKLE = 0.075
const HIP_Y = THIGH + SHIN + ANKLE
const UPPER = 0.29
const FORE = 0.25
const SHOULDER = { x: 0.17, y: 0.485 }
const HEAD = { rx: 0.074, ry: 0.112, rz: 0.096 }
/* The head's centre, from the top of the neck. */
const HEAD_C = new THREE.Vector3(0, 0.075, 0.016)
const SEAT = 0.47

/* ── Looks ─────────────────────────────────────────────────────────────── */

/* Real skin, from very fair to deep, each with its own undertone. */
const SKINS = ['#f1d0bd', '#e9bea2', '#dfae8c', '#d09a74', '#b97f5b', '#9a6646', '#7a4d33', '#5c3826', '#47291c']
const HAIRS = ['#16110e', '#2a1c14', '#3f2a1c', '#5c4029', '#7e5c3c', '#a8835a', '#c9a777', '#6e3420', '#8a8580']
const IRIS = ['#5a3a22', '#3d2a1c', '#6e5530', '#4f6f8f', '#5e7a52', '#4a3424', '#7a8a96']
const STYLES = ['fade', 'bob', 'locs', 'afro', 'bun', 'ponytail', 'bald', 'long', 'sidepart', 'curly', 'fade', 'locs']
const TOPS = ['tee', 'shirt', 'turtleneck', 'hoodie', 'puffer', 'sweater', 'tee']
const BOTTOMS = {
  jeans: ['#2f4466', '#26344f', '#3e5677', '#1f2430'],
  chinos: ['#b39b78', '#5b6449', '#2d3a4f', '#8a7a65'],
  trousers: ['#2b2d31', '#3a3f47', '#4a4440'],
  wide: ['#ece5d6', '#232427', '#b08d63', '#7b8a6a'],
}
const SHOES = {
  sneaker: { upper: ['#f2f1ee', '#e9e6df', '#2b2d31'], sole: '#f7f6f2' },
  leather: { upper: ['#4a2e1c', '#2a1d16', '#1a1a1c'], sole: '#2a211b' },
  boot: { upper: ['#7a5536', '#5e4330'], sole: '#3b2f25' },
  loafer: { upper: ['#d8c08a', '#c9c9cc'], sole: '#2a211b' },
}

/** A role colour as cloth: the hue kept, the brightness and saturation of a real dyed fabric. */
const cloth = hex => {
  const c = new THREE.Color(hex)
  const hsl = c.getHSL({})
  return c.setHSL(hsl.h, hsl.s * 0.68, clamp(hsl.l, 0.24, 0.55))
}

/* ── Building geometry ─────────────────────────────────────────────────── */

const lathe = (profile, seg = 28) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg)
/** A profile's radius at a height, for placing things on a lathe's surface. */
const radiusAt = (profile, y) => {
  for (let i = 1; i < profile.length; i++) {
    const [[r0, y0], [r1, y1]] = [profile[i - 1], profile[i]]
    if ((y - y0) * (y - y1) <= 0 && y0 !== y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)
  }
  return 0
}

/**
 * Collects a person's shapes, each placed in a bone's space and optionally
 * weighted across neighbouring bones, then merges every material's shapes
 * into one skinned mesh bound to the skeleton in its rest pose.
 */
class Kit {
  constructor(root) {
    this.root = root
    this.parts = []
  }
  add(bone, key, geometry, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], colour, weights } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)))
    if (colour) {
      const c = new THREE.Color(colour)
      const arr = new Float32Array(g.attributes.position.count * 3)
      for (let i = 0; i < arr.length; i += 3) ((arr[i] = c.r), (arr[i + 1] = c.g), (arr[i + 2] = c.b))
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    this.parts.push({ bone, key, g, weights })
    return this
  }
  build(materials, quiet) {
    const root = this.root
    root.updateMatrixWorld(true)
    const bones = []
    root.traverse(o => o.isBone && bones.push(o))
    const index = new Map(bones.map((b, i) => [b, i]))
    const toRoot = root.matrixWorld.clone().invert()
    const piles = new Map()
    const v = new THREE.Vector3()
    for (const { bone, key, g, weights } of this.parts) {
      const n = g.attributes.position.count
      const si = new Uint16Array(n * 4)
      const sw = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const list = (weights ? weights(v.fromBufferAttribute(g.attributes.position, i)) : [[bone, 1]]).filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4)
        const total = list.reduce((t, [, w]) => t + w, 0) || 1
        list.forEach(([b, w], j) => ((si[i * 4 + j] = index.get(b)), (sw[i * 4 + j] = w / total)))
      }
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, bone.matrixWorld))
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
      if (!piles.has(key)) piles.set(key, [])
      piles.get(key).push(g)
    }
    const skeleton = new THREE.Skeleton(bones)
    for (const [key, list] of piles) {
      const material = materials[key]
      const keep = ['position', 'normal', 'skinIndex', 'skinWeight', ...(material.vertexColors ? ['color'] : []), ...(material.map || material.bumpMap || material.alphaMap ? ['uv'] : [])]
      for (const g of list) {
        for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name)
        if (keep.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
        if (keep.includes('color') && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3))
      }
      const mesh = new THREE.SkinnedMesh(mergeGeometries(list), material)
      mesh.castShadow = !quiet.includes(key)
      mesh.receiveShadow = true
      /* A posed person reaches past the rest pose's bounds; ten of them are cheap to draw regardless. */
      mesh.frustumCulled = false
      root.add(mesh)
      mesh.bind(skeleton)
    }
  }
}

/** Plain meshes merged into one, for things a person holds. */
const propMesh = (parts, material) => {
  const list = parts.map(([geometry, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], colour }]) => {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)))
    const c = new THREE.Color(colour)
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3))
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name)
    return g
  })
  const mesh = new THREE.Mesh(mergeGeometries(list), material)
  mesh.castShadow = true
  return mesh
}


/* ── The head ──────────────────────────────────────────────────────────── */

const _hp = new THREE.Vector3()
/**
 * A point on the head's surface, from a direction on the unit sphere: an
 * egg-shaped skull, a jaw that narrows to the chin, and the face raised
 * from the front — brow, eye sockets, cheekbones, nose, lips and chin.
 */
const headPoint = (x, y, z, f, out = _hp) => {
  /* A rounder, broader cranium than a real skull's, as character heads are drawn. */
  let X = x * HEAD.rx * f.width * (1 + 0.07 * Math.max(0, y))
  const Y = y * HEAD.ry * (y > 0 ? 0.94 : 1)
  let Z = z * HEAD.rz * (1 + (z < 0 ? 0.04 * Math.max(0, y) : 0))
  if (y < 0.2) {
    const k = smooth(0.2 - y, 0, 1.2)
    X *= 1 - f.jaw * k * k
    if (z < 0.2) Z *= 1 - 0.32 * k * k * smooth(0.2 - z, 0, 1)
  }
  if (z > 0) {
    const ax = Math.abs(x)
    const down = clamp((0.12 - y) / 0.44, 0, 1)
    const along = y > 0.12 ? 0 : y > -0.32 ? 0.2 + 0.8 * down : Math.max(0, 1 - (-0.32 - y) / 0.09)
    let d = f.nose * along * gauss(x, 0.085 + 0.15 * down)
    d += 0.007 * gauss(x, 0.3) * gauss(y + 0.37, 0.065)
    d -= 0.008 * gauss(ax - 0.41, 0.17) * gauss(y - 0.03, 0.12)
    d += 0.004 * gauss(ax - 0.36, 0.3) * gauss(y - 0.21, 0.08)
    d += 0.005 * gauss(ax - 0.56, 0.2) * gauss(y + 0.16, 0.15)
    d += 0.007 * gauss(x, 0.32) * gauss(y + 0.59, 0.08)
    d -= 0.002 * gauss(x, 0.35) * gauss(y + 0.72, 0.05)
    d += f.chin * gauss(x, 0.3) * gauss(y + 0.88, 0.12)
    Z += z * z * d
  }
  return out.set(X, Y, Z)
}
/** The surface point in front of a spot on the face given as unit x, y. */
const facePoint = (x, y, f) => headPoint(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)), f, new THREE.Vector3())

/**
 * The head, carrying the skin's own colouring as vertex colours: warmer over
 * the cheeks, nose and ears, cooler under the eyes, a touch lighter at the
 * forehead, and on some jaws the grey-blue shadow of stubble.
 */
const headGeometry = (f, skin, stubble) => {
  const g = new THREE.SphereGeometry(1, 56, 42, -Math.PI / 2)
  const p = g.attributes.position
  const colours = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  const warm = new THREE.Color('#c2453a')
  const cool = new THREE.Color('#5d4a66')
  const shadow = new THREE.Color('#2f3540')
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    const ax = Math.abs(x)
    c.copy(skin)
    if (z > 0) {
      c.lerp(warm, 0.11 * gauss(ax - 0.55, 0.22) * gauss(y + 0.18, 0.18) + 0.13 * gauss(x, 0.16) * gauss(y + 0.3, 0.1) + 0.05 * gauss(x, 0.3) * gauss(y + 0.66, 0.1))
      c.lerp(cool, 0.08 * gauss(ax - 0.4, 0.15) * gauss(y + 0.1, 0.06))
      if (stubble) c.lerp(shadow, stubble * smooth(-y, 0.42, 0.75) * (1 - gauss(x, 0.32) * gauss(y + 0.6, 0.08)))
    }
    if (ax > 0.8 && Math.abs(y) < 0.35) c.lerp(warm, 0.07)
    c.multiplyScalar(1 + 0.035 * y)
    colours.set([c.r, c.g, c.b], i * 3)
    const v = headPoint(x, y, z, f)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  g.deleteAttribute('normal')
  const merged = mergeVertices(g, 1e-5)
  merged.computeVertexNormals()
  return merged
}

/** A shell of hair over the scalp, thinning to nothing at the hairline. */
/** `soft` is how gradually it thins at the hairline (a fade's line-up is crisp); `start` leaves the crown open, for a beanie's cuff. */
const hairShell = (f, { cap, tilt, thick, curl = 0, lift = 0, soft = 0.45, start = 0 }) => {
  const g = new THREE.SphereGeometry(1, 44, 26, -Math.PI / 2, Math.PI * 2, start, cap - start)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  const tip = new THREE.Euler(-tilt, 0, 0)
  for (let i = 0; i < p.count; i++) {
    const theta = Math.acos(clamp(p.getY(i), -1, 1))
    v.set(p.getX(i), p.getY(i), p.getZ(i)).applyEuler(tip)
    const edge = smooth(cap - theta, 0, soft)
    const s = headPoint(v.x, v.y, v.z, f, new THREE.Vector3())
    let t = thick * edge
    t += curl * edge * Math.sin(v.x * 29) * Math.sin(v.y * 23 + 1) * Math.sin(v.z * 27 + 2)
    t += lift * edge * smooth(v.y, 0.3, 1) * smooth(v.z, -0.3, 0.7)
    const len = s.length()
    s.multiplyScalar((len + t) / len)
    p.setXYZ(i, s.x, s.y, s.z)
  }
  g.computeVertexNormals()
  return g
}

/** Long hair falling from the crown past the ears to the shoulders, open at the face. */
const hairCurtain = (f, length, open = 0.95) => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 40, 10, true, open, Math.PI * 2 - open * 2)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = 0.5 - p.getY(i)
    const [sx, sz] = [p.getX(i), p.getZ(i)]
    const s = headPoint(sx * 0.98, 0.15, sz * 0.98, f, new THREE.Vector3())
    const flare = 1 + 0.16 * t + 0.06 * Math.sin(Math.atan2(sx, sz) * 9 + t * 4) * t
    p.setXYZ(i, s.x * flare + Math.sign(sx) * 0.008, 0.02 - t * length, s.z * flare - 0.01 * t + 0.006 * Math.sign(sz))
  }
  g.computeVertexNormals()
  return g
}

/** A short beard and moustache: the jaw's skin, raised a little, minus the lips. */
/**
 * Facial hair as a sculpted shape: a full short beard, a goatee, or a
 * moustache with a chin patch. Every vertex of a face-hugging shell gets a
 * weight from how far inside the shape it lies; outside, the shell sinks
 * under the skin, so the edge is a clean curve rather than a jagged line.
 */
const beardGeometry = (f, kind = 'full') => {
  const g = new THREE.SphereGeometry(1, 72, 56, -Math.PI / 2)
  const p = g.attributes.position
  const band = (v, a, b, soft = 0.04) => smooth(v, a - soft, a + soft) * (1 - smooth(v, b - soft, b + soft))
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    const ax = Math.abs(x)
    const front = smooth(z, -0.2, 0.05)
    const lips = band(-y, 0.53, 0.68, 0.025) * (1 - smooth(ax, 0.36, 0.44))
    const moustache = band(-y, 0.42, 0.53, 0.025) * (1 - smooth(ax, 0.4, 0.48)) * smooth(z, 0.55, 0.65)
    const jaw = band(-y, 0.3, 1.02) * front
    const chin = band(-y, 0.68, 1.02) * (1 - smooth(ax, 0.36, 0.44)) * smooth(z, 0.15, 0.25)
    const patch = band(-y, 0.68, 0.8, 0.02) * (1 - smooth(ax, 0.1, 0.15)) * smooth(z, 0.45, 0.55)
    const shape = kind === 'full' ? jaw * (1 - lips) : kind === 'goatee' ? chin : patch
    const w = Math.max(shape, moustache)
    const s = headPoint(x, y, z, f, new THREE.Vector3())
    s.multiplyScalar((s.length() + 0.0036 * w - 0.003 * (1 - w)) / s.length())
    p.setXYZ(i, s.x, s.y, s.z)
  }
  g.computeVertexNormals()
  return g
}

/** A tube along points given in face units, lifted just off the skin. */
const faceTube = (points, f, radius, lift = 0.0012) => {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => facePoint(x, y, f).add(new THREE.Vector3(0, 0, lift))))
  return new THREE.TubeGeometry(curve, 14, radius, 6, false)
}

/* ── Arms, legs and the IK that places hands ───────────────────────────── */

const _d = new THREE.Vector3()
const _p = new THREE.Vector3()
const _u = new THREE.Vector3()
const _f = new THREE.Vector3()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
/**
 * Two-bone IK in the spine's space: the shoulder turn that points the upper
 * arm so the wrist reaches `target`, with the elbow bending toward `pole`.
 * Writes the turn into `out` and returns the elbow's bend.
 */
const reachFor = (shoulder, target, pole, out) => {
  _d.subVectors(target, shoulder)
  const L = clamp(_d.length(), 0.08, (UPPER + FORE) * 0.995)
  _d.normalize()
  const alpha = Math.acos(clamp((UPPER * UPPER + L * L - FORE * FORE) / (2 * UPPER * L), -1, 1))
  const bend = Math.PI - Math.acos(clamp((UPPER * UPPER + FORE * FORE - L * L) / (2 * UPPER * FORE), -1, 1))
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize()
  _u.copy(_d).multiplyScalar(Math.cos(alpha)).addScaledVector(_p, Math.sin(alpha))
  _f.copy(_d).multiplyScalar(L).addScaledVector(_u, -UPPER).normalize()
  _y.copy(_u).negate()
  _z.copy(_f).addScaledVector(_u, -_f.dot(_u))
  if (_z.lengthSq() < 1e-6) _z.copy(_p)
  _z.normalize()
  _x.crossVectors(_y, _z)
  out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z))
  return bend
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()


/** A shared texture with its own repeat. */
const tiled = (texture, x, y) => {
  const t = texture.clone()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(x, y)
  t.needsUpdate = true
  return t
}

const bone = (parent, x, y, z) => {
  const b = new THREE.Bone()
  b.position.set(x, y, z)
  parent.add(b)
  return b
}

/**
 * One person. `look` is any string: the same string always gives the same
 * face, hair, build and clothes, so a person keeps their looks between visits.
 */
export class Person {
  constructor({ name, colour, look }) {
    this.name = name
    this.colour = colour
    const r = rng(hash(look ?? name))
    const tx = textures()

    /* Who they are: build, colouring, hair, clothes, and what they wear on their head and face. */
    this.height = 0.94 + r() * 0.12
    const build = 0.95 + r() * 0.12
    const skinColour = new THREE.Color(pick(SKINS, r))
    const hairColour = pick(HAIRS, r)
    const style = pick(STYLES, r)
    const top = pick(TOPS, r)
    const bottomKind = pick(Object.keys(BOTTOMS), r)
    const bottomColour = pick(BOTTOMS[bottomKind], r)
    const shoeKind = pick(Object.keys(SHOES), r)
    const shoeColour = pick(SHOES[shoeKind].upper, r)
    const face = { width: 0.96 + r() * 0.1, jaw: 0.1 + r() * 0.15, nose: 0.02 + r() * 0.012, chin: 0.004 + r() * 0.01 }
    const glasses = r() < 0.3 ? pick(['rect', 'round', 'clear', 'rect'], r) : null
    const cropped = ['fade', 'locs', 'bald', 'sidepart', 'curly', 'afro'].includes(style)
    const beard = cropped && r() < 0.55 ? pick(['full', 'goatee', 'patch', 'goatee'], r) : null
    const stubble = cropped && !beard && r() < 0.4 ? 0.1 + r() * 0.1 : 0
    const hat = ['fade', 'locs', 'bald', 'sidepart', 'curly'].includes(style) && r() < 0.4 ? pick(['cap', 'beanie', 'cap'], r) : null
    const hatColour = pick(['#5f6b45', '#1f2124', '#2d3a55', '#c9b48f', '#b7d43b', '#8a2f2f'], r)
    const earrings = r() < 0.4 ? pick(['hoops', 'studs', 'both'], r) : null
    const lipRing = r() < 0.08
    const rolled = r() < 0.4
    const tucked = top === 'shirt'
    const sleeves = top === 'tee' ? 'short' : top === 'shirt' && rolled ? 'rolled' : 'long'
    /* Oversized cuts sit away from the body; a puffer most of all. */
    const puff = { tee: 0.014, shirt: 0, turtleneck: 0.004, sweater: 0.01, hoodie: 0.016, puffer: 0.036 }[top]
    const irisColour = pick(IRIS, r)

    /*
     * Materials, in the manner of a modern 3D character portrait: smooth,
     * clean skin with a warm glow at its edges where light passes under it;
     * hair sculpted as solid locks with soft grooves; matte cotton, ribbed
     * knits and quilted nylon; leather with a waxed coat; real metal for
     * earrings.
     */
    const skin = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.46, bumpMap: tiled(tx.pores, 8, 6), bumpScale: 0.12, sheen: 0.38, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ff9f88'), clearcoat: 0.12, clearcoatRoughness: 0.45, specularIntensity: 0.5 })
    const hair = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hairColour).multiplyScalar(0.85), roughness: 0.55, bumpMap: tiled(tx.strands, 24, 4), bumpScale: style === 'fade' || style === 'afro' ? 0.6 : 1.6, sheen: 0.5, sheenRoughness: 0.35, sheenColor: new THREE.Color(hairColour).lerp(new THREE.Color('#fff2dc'), 0.3) })
    const hatMat = new THREE.MeshPhysicalMaterial({ color: hatColour, roughness: hat === 'beanie' ? 0.95 : 0.7, sheen: 0.4, sheenColor: new THREE.Color(hatColour).lerp(new THREE.Color('#ffffff'), 0.3), ...(hat === 'beanie' ? { bumpMap: tiled(tx.rib, 16, 3), bumpScale: 2.5 } : {}) })
    const knit = top === 'sweater' || top === 'turtleneck'
    const fibre = { tee: [0.9, 0.35], shirt: [0.72, 0.25], turtleneck: [0.96, 0.6], sweater: [0.97, 0.7], hoodie: [0.95, 0.6], puffer: [0.42, 0.15] }[top]
    this.topMat = new THREE.MeshPhysicalMaterial({
      color: cloth(colour), roughness: fibre[0], sheen: fibre[1], sheenRoughness: 0.5, sheenColor: cloth(colour).lerp(new THREE.Color('#ffffff'), 0.3), side: THREE.DoubleSide,
      bumpMap: knit ? tiled(tx.rib, 18, 6) : top === 'puffer' ? tiled(tx.folds, 1, 2.2) : tiled(tx.folds, 2, 2.5),
      bumpScale: knit ? 2.2 : top === 'puffer' ? 3 : 0.45,
      ...(top === 'puffer' ? { clearcoat: 0.25, clearcoatRoughness: 0.5 } : {}),
    })
    const bottom = bottomKind === 'jeans'
      ? new THREE.MeshPhysicalMaterial({ color: bottomColour, map: tiled(tx.denim, 4, 12), bumpMap: tiled(tx.folds, 2, 3), bumpScale: 0.6, roughness: 0.82, sheen: 0.25, sheenColor: new THREE.Color('#8fa3c7') })
      : new THREE.MeshPhysicalMaterial({ color: bottomColour, bumpMap: tiled(tx.folds, 2, 3), bumpScale: 0.45, roughness: bottomKind === 'chinos' ? 0.85 : 0.68, sheen: 0.3, sheenColor: new THREE.Color(bottomColour).lerp(new THREE.Color('#ffffff'), 0.3) })
    const shoe = shoeKind === 'leather'
      ? new THREE.MeshPhysicalMaterial({ color: shoeColour, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25 })
      : shoeKind === 'loafer'
        ? new THREE.MeshPhysicalMaterial({ color: shoeColour, metalness: 1, roughness: 0.22 })
        : new THREE.MeshPhysicalMaterial({ color: shoeColour, roughness: shoeKind === 'boot' ? 0.95 : 0.7, sheen: shoeKind === 'boot' ? 0.6 : 0.2, sheenColor: new THREE.Color('#ffffff') })
    const detail = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55 })
    const eye = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
    const metal = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 1, roughness: 0.22 })
    const lens = new THREE.MeshPhysicalMaterial({ color: glasses === 'clear' ? '#f2efe9' : '#3a3530', roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false })
    const materials = { skin, hair, hat: hatMat, top: this.topMat, bottom, shoe, detail, eye, metal, lens }
    const lip = skinColour.clone().lerp(new THREE.Color('#9c5058'), 0.28)
    const brow = new THREE.Color(hairColour).multiplyScalar(0.7).lerp(new THREE.Color('#2a1d16'), 0.3)
    const shade = skinColour.clone().multiplyScalar(0.45)
    const sole = SHOES[shoeKind].sole
    const S = skinColour

    /* The skeleton, in its rest pose. */
    this.root = new THREE.Group()
    this.root.scale.setScalar(this.height)
    this.hips = bone(this.root, 0, HIP_Y, 0)
    this.spine = bone(this.hips, 0, 0, 0)
    this.chest = bone(this.spine, 0, 0, 0)
    this.neck = bone(this.spine, 0, 0.5, -0.008)
    this.head = bone(this.neck, 0, 0.115, 0.01)
    /* A head a little larger than life, as a character portrait draws it. */
    this.head.scale.setScalar(1.13)
    const k = new Kit(this.root)
    const H = HEAD_C.toArray()
    const onHead = (x, y, z) => [x + H[0], y + H[1], z + H[2]]

    /* How each continuous surface shares itself between bones, so joints bend like flesh. */
    const torsoWeights = v => [[this.hips, 1 - smooth(v.y, 0.06, 0.24)], [this.chest, smooth(v.y, 0.06, 0.24) * (1 - 0.5 * smooth(v.y, 0.5, 0.535))], [this.neck, 0.5 * smooth(v.y, 0.5, 0.535)]]
    const neckWeights = v => [[this.chest, 1 - smooth(v.y, 0, 0.07)], [this.neck, smooth(v.y, 0, 0.07) * (1 - 0.6 * smooth(v.y, 0.1, 0.14))], [this.head, 0.6 * smooth(v.y, 0.1, 0.14)]]

    /* Pelvis, belt and legs. */
    const pelvis = [[0, -0.1], [0.1, -0.095], [0.148, -0.05], [0.16, 0.02], [0.156, 0.1], [0.15, 0.15], [0, 0.152]]
    k.add(this.hips, 'bottom', lathe(pelvis), { s: [build, 1, 0.66] })
    if (tucked) {
      k.add(this.hips, 'detail', new THREE.TorusGeometry(0.157, 0.008, 8, 40), { p: [0, 0.122, 0], r: [Math.PI / 2, 0, 0], s: [build, 0.66, 1], colour: shoeKind === 'sneaker' ? '#2b2420' : shoeColour })
      k.add(this.hips, 'detail', new THREE.BoxGeometry(0.03, 0.022, 0.006), { p: [0, 0.122, 0.158 * 0.66 + 0.008], colour: '#b8b4ab' })
    }
    const leg = side => {
      const thigh = bone(this.hips, side * 0.088 * build, 0, 0)
      const knee = bone(thigh, 0, -THIGH, 0)
      const ankle = bone(knee, 0, -SHIN, 0)
      const weights = v => {
        const top = 0.55 * smooth(v.y, -0.04, 0.06)
        const bend = smooth(-v.y, 0.36, 0.46)
        return [[this.hips, top], [thigh, (1 - top) * (1 - bend)], [knee, (1 - top) * bend]]
      }
      /* One trouser leg from hip to ankle, slightly flattened front to back; wide-leg trousers fall straight and finish in a deep turn-up. */
      const wide = bottomKind === 'wide'
      const legProfile = wide
        ? [[0.088, -0.818], [0.087, -0.7], [0.084, -0.55], [0.08, -0.42], [0.079, -0.3], [0.08, -0.18], [0.084, -0.08], [0.087, 0], [0.074, 0.05], [0, 0.072]]
        : [[0.05, -0.818], [0.051, -0.75], [0.054, -0.62], [0.058, -0.5], [0.058, -0.42], [0.061, -0.36], [0.07, -0.22], [0.079, -0.09], [0.083, 0], [0.072, 0.05], [0, 0.072]]
      k.add(thigh, 'bottom', lathe(legProfile, 24), { s: [1, 1, 0.95], weights })
      if (wide) k.add(thigh, 'bottom', lathe([[0.091, -0.82], [0.094, -0.81], [0.094, -0.74], [0.09, -0.73]], 24), { s: [1, 1, 0.95], weights })
      /* The shoe: a long rounded last, flat underneath, its toe box lower than the heel. */
      const last = new THREE.SphereGeometry(1, 28, 16)
      const lp = last.attributes.position
      for (let i = 0; i < lp.count; i++) {
        let [x, y, z] = [lp.getX(i), lp.getY(i), lp.getZ(i)]
        y = Math.max(y, -0.62)
        if (z > 0) y -= (y + 0.62) * 0.38 * z * z
        /* Sneakers are chunky; loafers sleek. */
        const [w, h, l] = shoeKind === 'sneaker' ? [0.051, 0.054, 0.134] : shoeKind === 'loafer' ? [0.044, 0.042, 0.13] : [0.046, 0.05, 0.128]
        lp.setXYZ(i, x * w, y * h, z * l + 0.042)
      }
      last.computeVertexNormals()
      const soleH = shoeKind === 'sneaker' ? 0.024 : 0.016
      k.add(ankle, 'shoe', last, { p: [0, -ANKLE + 0.031 + (soleH - 0.016), 0] })
      k.add(ankle, 'detail', new THREE.CylinderGeometry(1, 1, 1, 24), { p: [0, -ANKLE + soleH / 2, 0.044], s: [shoeKind === 'sneaker' ? 0.055 : 0.049, soleH, 0.138], colour: sole })
      if (shoeKind === 'sneaker') for (let i = 0; i < 4; i++) k.add(ankle, 'detail', new THREE.BoxGeometry(0.034, 0.003, 0.005), { p: [0, -0.012 + i * 0.002, 0.09 - i * 0.017], r: [-0.5, 0, 0], colour: '#d9d6cf' })
      return { thigh, knee, ankle }
    }
    this.legs = [leg(1), leg(-1)]

    /* The torso: a shirt tucked in at the belt; anything else worn loose over it, oversized cuts further from the body. */
    const torso = (tucked
      ? [[0, 0.13], [0.153, 0.13], [0.156, 0.2], [0.165, 0.3], [0.172, 0.38], [0.176, 0.44], [0.168, 0.475], [0.13, 0.51], [0.075, 0.53], [0, 0.534]]
      : [[0, top === 'puffer' || top === 'tee' ? -0.02 : 0.05], [0.166, top === 'puffer' || top === 'tee' ? -0.02 : 0.05], [0.163, 0.12], [0.162, 0.2], [0.168, 0.3], [0.174, 0.38], [0.178, 0.44], [0.17, 0.475], [0.13, 0.51], [0.075, 0.53], [0, 0.534]]
    ).map(([rr, y]) => [rr ? rr + puff * smooth(rr, 0.06, 0.14) : 0, y])
    const front = y => radiusAt(torso, y) * 0.66
    const onTorso = { weights: torsoWeights }
    k.add(this.chest, 'top', lathe(torso, 40), { s: [build, 1, 0.66], ...onTorso })
    if (top === 'shirt') {
      k.add(this.chest, 'top', new THREE.CylinderGeometry(0.068, 0.062, 0.03, 24, 1, true, 0.45, Math.PI * 2 - 0.9), { p: [0, 0.538, -0.008], ...onTorso })
      /* The placket in short lengths, so it follows the chest's curve. */
      for (let y = 0.16; y < 0.51; y += 0.04) k.add(this.chest, 'top', new THREE.BoxGeometry(0.026, 0.042, 0.004), { p: [0, y, front(y) + 0.0015], r: [Math.atan2(front(y - 0.02) - front(y + 0.02), 0.04), 0, 0], ...onTorso })
      for (const y of [0.47, 0.39, 0.31, 0.23, 0.16]) k.add(this.chest, 'detail', new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 10), { p: [0, y, front(y) + 0.006], r: [Math.PI / 2, 0, 0], colour: '#ece8df', ...onTorso })
    } else if (top === 'hoodie') {
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.088, 0.034, 10, 28, Math.PI * 1.3), { p: [0, 0.52, -0.03], r: [Math.PI / 2 - 0.35, 0, Math.PI * 0.85], ...onTorso })
      k.add(this.chest, 'top', new THREE.BoxGeometry(0.24, 0.13, 0.022), { p: [0, 0.17, front(0.17) + 0.004], ...onTorso })
      for (const s of [-1, 1]) k.add(this.chest, 'detail', new THREE.CylinderGeometry(0.0038, 0.0038, 0.14, 6), { p: [s * 0.036, 0.42, front(0.43) + 0.007], colour: '#e9e6df', ...onTorso })
    } else if (top === 'puffer') {
      /* A puffer: quilted, a high stand collar, a zip down the front and a chest pocket. */
      k.add(this.chest, 'top', new THREE.CylinderGeometry(0.084, 0.092, 0.075, 30, 1, true), { p: [0, 0.56, -0.004], s: [1, 1, 0.9], ...onTorso })
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.086, 0.01, 8, 30), { p: [0, 0.597, -0.004], r: [Math.PI / 2, 0, 0], s: [1, 0.9, 1], ...onTorso })
      for (let y = 0.0; y < 0.55; y += 0.05) k.add(this.chest, 'detail', new THREE.BoxGeometry(0.008, 0.052, 0.004), { p: [0, y, front(y) + 0.002], r: [Math.atan2(front(y - 0.025) - front(y + 0.025), 0.05), 0, 0], colour: '#1d1e21', ...onTorso })
      k.add(this.chest, 'detail', new THREE.BoxGeometry(0.012, 0.02, 0.004), { p: [0, 0.5, front(0.5) + 0.006], colour: '#c9c9cc', ...onTorso })
      k.add(this.chest, 'top', new THREE.BoxGeometry(0.1, 0.075, 0.012), { p: [build * 0.085, 0.36, front(0.36) + 0.004], r: [-0.15, 0, 0], ...onTorso })
    } else if (top === 'turtleneck') {
      /* A turtleneck: the collar rolled twice up the neck. */
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.062, 0.02, 10, 30), { p: [0, 0.555, -0.004], r: [Math.PI / 2, 0, 0], s: [1, 0.92, 1.3], ...onTorso })
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.058, 0.018, 10, 30), { p: [0, 0.6, -0.002], r: [Math.PI / 2, 0, 0], s: [1, 0.92, 1.2], ...onTorso })
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.167, 0.012, 8, 40), { p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0], s: [build, 0.66, 1], ...onTorso })
    } else {
      k.add(this.chest, 'top', new THREE.TorusGeometry(0.06, 0.01, 8, 28), { p: [0, 0.528, -0.004], r: [Math.PI / 2 - 0.12, 0, 0], s: [1, 0.85, 1], ...onTorso })
      if (top === 'sweater') k.add(this.chest, 'top', new THREE.TorusGeometry(0.17, 0.013, 8, 40), { p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0], s: [build, 0.66, 1], ...onTorso })
    }

    /* Neck and head. */
    k.add(this.neck, 'skin', new THREE.CylinderGeometry(0.051, 0.057, 0.15, 20, 6), { p: [0, 0.06, 0], s: [1, 1, 0.92], colour: S.clone().multiplyScalar(0.96), weights: neckWeights })
    k.add(this.head, 'skin', headGeometry(face, S, stubble), { p: H })
    const earAt = s => onHead(s * HEAD.rx * face.width * 0.96, -0.006, -0.01)
    for (const s of [-1, 1]) {
      k.add(this.head, 'skin', new THREE.SphereGeometry(1, 18, 12), { p: earAt(s), r: [0, s * 0.42, s * 0.08], s: [0.0135, 0.033, 0.022], colour: S.clone().lerp(new THREE.Color('#c2453a'), 0.08) })
      const nostril = facePoint(s * 0.12, -0.39, face)
      k.add(this.head, 'detail', new THREE.SphereGeometry(1, 8, 6), { p: onHead(nostril.x, nostril.y - 0.001, nostril.z - 0.005), s: [0.0042, 0.0018, 0.0034], colour: shade })
    }

    /*
     * Eyes: large and soft, set a little wider apart, under heavy upper lids
     * that cover the top of the iris — the calm, half-lidded look of a
     * character portrait. A clearcoat and a small catchlight make them wet.
     */
    const eyes = facePoint(0.44, 0.03, face)
    this.eyes = bone(this.head, 0, H[1] + eyes.y, 0)
    const R = 0.0128
    for (const s of [-1, 1]) {
      const c = [s * eyes.x + H[0], 0, eyes.z - 0.0046 + H[2]]
      k.add(this.eyes, 'eye', new THREE.SphereGeometry(R, 20, 14), { p: c, s: [1.12, 1, 1], colour: '#efe9e1' })
      k.add(this.eyes, 'eye', new THREE.SphereGeometry(R * 1.006, 20, 6, 0, Math.PI * 2, 0, 0.62), { p: c, r: [Math.PI / 2 - 0.05, s * -0.05, 0], colour: irisColour })
      k.add(this.eyes, 'eye', new THREE.SphereGeometry(R * 1.012, 14, 4, 0, Math.PI * 2, 0, 0.26), { p: c, r: [Math.PI / 2 - 0.05, s * -0.05, 0], colour: '#0a0908' })
      k.add(this.eyes, 'eye', new THREE.SphereGeometry(0.001, 8, 6), { p: [c[0] - s * 0.0035, 0.0038, c[2] + R * 0.985], colour: '#ffffff' })
      const lidAt = [c[0], H[1] + eyes.y, c[2]]
      k.add(this.head, 'skin', new THREE.SphereGeometry(R * 1.1, 22, 8, 0, Math.PI * 2, 0, 1.0), { p: lidAt, r: [0.42, 0, 0], s: [1.14, 1, 1], colour: S.clone().multiplyScalar(0.94) })
      k.add(this.head, 'skin', new THREE.SphereGeometry(R * 1.08, 22, 6, 0, Math.PI * 2, 2.25, Math.PI - 2.25), { p: lidAt, r: [-0.08, 0, 0], s: [1.14, 1, 1], colour: S })
      const lash = new THREE.TorusGeometry(R * 1.11 * Math.sin(1.0), 0.0007, 5, 20, Math.PI).rotateX(Math.PI / 2).translate(0, R * 1.11 * Math.cos(1.0), 0)
      k.add(this.head, 'detail', lash, { p: lidAt, r: [0.42, 0, 0], s: [1.14, 1, 1], colour: '#2a1f1a' })
      /* Brows: thick, sculpted and solid. */
      k.add(this.head, 'detail', faceTube([[s * 0.13, 0.272], [s * 0.3, 0.29], [s * 0.48, 0.286], [s * 0.65, 0.255]], face, 0.0042 + r() * 0.0012, 0.0024), { p: H, colour: brow })
    }

    /* The mouth: full, softly defined lips; the lower lip and the dark of the mouth open to talk and laugh. */
    k.add(this.head, 'detail', faceTube([[-0.36, -0.59], [-0.16, -0.572], [-0.05, -0.575], [0, -0.57], [0.05, -0.575], [0.16, -0.572], [0.36, -0.59]], face, 0.0042, 0.0011), { p: H, colour: lip })
    const mouthAt = facePoint(0, -0.6, face)
    this.jaw = bone(this.head, 0, 0, 0)
    k.add(this.jaw, 'detail', faceTube([[-0.31, -0.6], [-0.1, -0.622], [0, -0.626], [0.1, -0.622], [0.31, -0.6]], face, 0.0052, 0.0006), { p: H, colour: lip.clone().multiplyScalar(1.04) })
    this.mouthHole = bone(this.head, H[0], H[1] + mouthAt.y, H[2] + mouthAt.z - 0.0005)
    k.add(this.mouthHole, 'detail', new THREE.SphereGeometry(1, 16, 8), { s: [0.02, 0.009, 0.0025], colour: '#3a1414' })
    k.add(this.mouthHole, 'detail', new THREE.BoxGeometry(0.025, 0.0032, 0.002), { p: [0, 0.005, 0.0012], colour: '#ece6da' })
    this.mouthHole.scale.y = 0.05

    /*
     * Hair, sculpted as solid locks rather than strands: a crisp fade, a bob
     * with a heavy fringe, locs, an afro, a bun, a ponytail, long hair, a
     * side parting, curls — or none at all. Under a cap or beanie it is cut
     * close. A bone lets long hair, locs and ponytails swing.
     */
    const shell = {
      fade: { cap: 1.42, tilt: 0.62, thick: 0.004, soft: 0.07 },
      bob: { cap: 1.62, tilt: -0.14, thick: 0.013, soft: 0.06, lift: 0.004 },
      locs: { cap: 1.5, tilt: 0.55, thick: 0.007, soft: 0.1 },
      afro: { cap: 1.66, tilt: 0.42, thick: 0.042, curl: 0.005, soft: 0.25 },
      bun: { cap: 1.6, tilt: 0.5, thick: 0.007, soft: 0.15 },
      ponytail: { cap: 1.6, tilt: 0.5, thick: 0.007, soft: 0.15 },
      long: { cap: 1.62, tilt: 0.45, thick: 0.011, lift: 0.004, soft: 0.2 },
      sidepart: { cap: 1.5, tilt: 0.55, thick: 0.012, lift: 0.016, soft: 0.12 },
      curly: { cap: 1.6, tilt: 0.5, thick: 0.02, curl: 0.007, soft: 0.2 },
    }[style]
    this.swing = bone(this.head, 0, H[1] + 0.03, H[2] - 0.1)
    const swingWeights = v => {
      const w = 0.9 * smooth(H[1] - v.y, 0, 0.16)
      return [[this.head, 1 - w], [this.swing, w]]
    }
    if (shell) k.add(this.head, 'hair', hairShell(face, hat ? { ...shell, thick: Math.min(shell.thick, 0.006), lift: 0, curl: 0 } : shell), { p: H })
    if (style === 'long') k.add(this.head, 'hair', hairCurtain(face, 0.2 + r() * 0.08), { p: H, weights: swingWeights })
    if (style === 'bob') k.add(this.head, 'hair', hairCurtain(face, 0.1 + r() * 0.03, 1.2), { p: H, weights: swingWeights })
    if (style === 'bun') k.add(this.head, 'hair', new THREE.SphereGeometry(0.038, 20, 14), { p: onHead(0, 0.074, -0.08), s: [1, 0.9, 1] })
    if (style === 'ponytail') {
      k.add(this.swing, 'detail', new THREE.TorusGeometry(0.014, 0.004, 6, 14), { r: [0.4, 0, 0], colour: '#222' })
      k.add(this.swing, 'hair', lathe([[0, -0.21], [0.012, -0.18], [0.024, -0.08], [0.018, 0], [0, 0.01]], 16), { p: [0, 0, -0.004], r: [0.42, 0, 0] })
    }
    if (style === 'locs') {
      /* Locs: rope-like twists from the crown, falling past the ears and down the back, clear of the face. */
      const tip = new THREE.Euler(-shell.tilt, 0, 0)
      const down = new THREE.Vector3(0, -1, 0)
      for (let i = 0; i < 30; i++) {
        const th = 0.5 + r() * 0.95
        const ph = r() * Math.PI * 2
        const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)).applyEuler(tip)
        if (d.z > 0.3) continue
        const root = headPoint(d.x, d.y, d.z, face, new THREE.Vector3()).multiplyScalar(1.06)
        const len = 0.08 + r() * 0.08
        const dir = d.clone().setY(0).multiplyScalar(0.4).add(down).normalize()
        const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(down, dir))
        k.add(this.head, 'hair', new THREE.CapsuleGeometry(0.0085, len, 3, 8).translate(0, -len / 2, 0), { p: onHead(root.x, root.y, root.z), r: turn.toArray().slice(0, 3), weights: swingWeights })
      }
    }
    if (beard) k.add(this.head, 'hair', beardGeometry(face, beard), { p: H })

    /* A cap with a curved brim and a patch on the front, or a ribbed beanie with a turned-up cuff. */
    if (hat === 'cap') {
      k.add(this.head, 'hat', hairShell(face, { cap: 1.45, tilt: 0.12, thick: 0.017, soft: 0.02 }), { p: H })
      k.add(this.head, 'hat', new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 1.1), { p: onHead(0, HEAD.ry * 0.36, HEAD.rz * 0.95), r: [Math.PI / 2 - 0.42, 0, 0], s: [0.088, 0.075, 0.012] })
      k.add(this.head, 'hat', new THREE.SphereGeometry(0.007, 10, 6), { p: onHead(0, HEAD.ry + 0.017, -0.012) })
      k.add(this.head, 'detail', new THREE.BoxGeometry(0.045, 0.02, 0.003), { p: onHead(0, HEAD.ry * 0.62, HEAD.rz * 0.9), r: [-0.55, 0, 0], colour: pick(['#efe9df', '#c23b3b', '#1f2124'], r) })
    } else if (hat === 'beanie') {
      /* A slouchy dome turned on a lathe, sized to this head, tipped back so it sits above the brows; a thicker cuff round its rim. */
      const fit = { s: [HEAD.rx * face.width + 0.02, 1, HEAD.rz + 0.024], r: [-0.22, 0, 0] }
      k.add(this.head, 'hat', lathe([[1.0, 0.03], [1.04, 0.05], [1.03, 0.085], [0.96, 0.125], [0.78, 0.16], [0.45, 0.182], [0, 0.19]], 40), { ...fit, s: [fit.s[0], 1.05, fit.s[2]], p: onHead(0, 0.008, 0.012) })
      k.add(this.head, 'hat', lathe([[0.98, 0.026], [1.06, 0.03], [1.075, 0.058], [1.05, 0.078], [0.97, 0.08]], 40), { ...fit, p: onHead(0, 0.008, 0.012) })
    }

    /* Earrings, a lip ring, and glasses: thick rectangles, round wire, or clear acetate. */
    if (earrings) for (const s of [-1, 1]) {
      const [ex, ey, ez] = earAt(s)
      const gold = r() < 0.5 ? '#d9b46a' : '#c8cacd'
      if (earrings !== 'studs') k.add(this.head, 'metal', new THREE.TorusGeometry(0.0065, 0.0013, 6, 18), { p: [ex + s * 0.004, ey - 0.03, ez + 0.002], r: [0, Math.PI / 2, 0], colour: gold })
      if (earrings !== 'hoops') k.add(this.head, 'metal', new THREE.SphereGeometry(0.0026, 10, 8), { p: [ex + s * 0.006, ey - (earrings === 'both' ? 0.012 : 0.026), ez + 0.004], colour: gold })
    }
    if (lipRing) {
      const at = facePoint(0.16, -0.64, face)
      k.add(this.jaw, 'metal', new THREE.TorusGeometry(0.0042, 0.0009, 6, 14), { p: onHead(at.x, at.y - 0.002, at.z + 0.002), r: [0, 0, 0.3], colour: '#c8cacd' })
    }
    if (glasses) {
      const rim = glasses === 'clear' ? '#d7d3cc' : glasses === 'round' ? '#a88a5a' : '#141414'
      const ey = H[1] + eyes.y + 0.002
      const ez = eyes.z + H[2] + 0.016
      for (const s of [-1, 1]) {
        const ex = s * eyes.x * 1.02 + H[0]
        if (glasses === 'round') k.add(this.head, 'detail', new THREE.TorusGeometry(0.0178, 0.0018, 8, 30), { p: [ex, ey, ez], colour: rim })
        else {
          const [w, h, bar] = glasses === 'clear' ? [0.05, 0.034, 0.005] : [0.052, 0.031, 0.0055]
          for (const [bx, by, bw, bh] of [[0, h / 2, w + bar, bar], [0, -h / 2, w + bar, bar * 0.8], [-w / 2, 0, bar, h + bar], [w / 2, 0, bar, h + bar]]) k.add(this.head, 'detail', new THREE.BoxGeometry(bw, bh, 0.006), { p: [ex + bx, ey + by, ez], colour: rim })
        }
        k.add(this.head, 'lens', new THREE.PlaneGeometry(glasses === 'round' ? 0.032 : 0.046, glasses === 'round' ? 0.032 : 0.028), { p: [ex, ey, ez - 0.001] })
        k.add(this.head, 'detail', new THREE.BoxGeometry(0.003, 0.004, 0.092), { p: [s * 0.074 * face.width + H[0], ey + 0.008, H[2] - 0.028], r: [0, s * 0.16, 0], colour: rim })
      }
      k.add(this.head, 'detail', new THREE.BoxGeometry(0.018, 0.004, 0.005), { p: [H[0], ey + 0.006, ez + 0.001], colour: rim })
    }

    /* Arms: one surface from shoulder to wrist, shared across shoulder, elbow and wrist so the elbow folds and the forearm twists. Hands hang palms back (-z), fingers along -y, thumb inside. */
    const arm = side => {
      const shoulder = bone(this.spine, side * SHOULDER.x * build, SHOULDER.y, -0.01)
      shoulder.userData.build = build
      const elbow = bone(shoulder, 0, -UPPER, 0)
      const wrist = bone(elbow, 0, -FORE, 0)
      const weights = v => {
        const top = 0.55 * smooth(v.y, -0.02, 0.06)
        const fold = smooth(-v.y, 0.25, 0.33)
        const twist = 0.55 * smooth(-v.y, 0.38, 0.545)
        return [[this.chest, top], [shoulder, (1 - top) * (1 - fold)], [elbow, (1 - top) * fold * (1 - twist)], [wrist, (1 - top) * fold * twist]]
      }
      const limb = loose => [[0, -0.548], [0.027 + loose, -0.545], [0.029 + loose, -0.5], [0.033 + loose, -0.44], [0.04 + loose, -0.36], [0.043 + loose, -0.33], [0.041 + loose, -0.29], [0.045 + loose, -0.25], [0.048 + loose, -0.16], [0.05 + loose, -0.08], [0.051 + loose, -0.03], [0.047 + loose, 0.0], [0.038 + loose, 0.022], [0.02 + loose, 0.036], [0, 0.04]]
      if (sleeves === 'long') {
        /* Sleeves as full as the cut: a puffer's are padded, a hoodie's roomy. */
        const loose = 0.007 + puff * 0.65
        k.add(shoulder, 'top', lathe(limb(loose), 22), { weights })
        k.add(shoulder, 'top', new THREE.TorusGeometry(0.034 + loose * 0.5, 0.008, 8, 18), { p: [0, -0.522, 0], r: [Math.PI / 2, 0, 0], weights })
      } else {
        k.add(shoulder, 'skin', lathe(limb(0), 20), { colour: S, weights })
        /* An oversized tee's sleeves are wide and reach the elbow. */
        const end = sleeves === 'short' ? -0.21 : -0.31
        const loose = sleeves === 'short' ? 0.006 + puff : 0.006
        const cut = limb(loose).filter(([, y]) => y > end)
        k.add(shoulder, 'top', lathe([[0.05 + loose + (sleeves === 'short' ? 0.004 : 0), end], ...cut], 22), { weights })
        if (sleeves === 'rolled') k.add(shoulder, 'top', new THREE.TorusGeometry(0.046, 0.013, 8, 18), { p: [0, end, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 1.4], weights })
      }
      k.add(wrist, 'skin', new RoundedBoxGeometry(0.07, 0.086, 0.024, 2, 0.01), { p: [0, -0.047, 0], colour: S })
      for (const [i, len] of [0.07, 0.078, 0.073, 0.058].entries()) {
        const finger = new THREE.CapsuleGeometry(0.0072, len - 0.015, 4, 8).translate(0, -len / 2, 0).rotateX(0.32)
        k.add(wrist, 'skin', finger, { p: [-side * (0.026 - i * 0.0173), -0.086, 0], colour: S })
        k.add(wrist, 'detail', new THREE.SphereGeometry(0.0055, 8, 6), { p: [-side * (0.026 - i * 0.0173), -0.086 - (len - 0.008) * Math.cos(0.32), -(len - 0.008) * Math.sin(0.32) + 0.004], s: [1, 1.2, 0.3], colour: S.clone().lerp(new THREE.Color('#f3d9d0'), 0.45) })
      }
      k.add(wrist, 'skin', new THREE.CapsuleGeometry(0.0105, 0.036, 4, 8).translate(0, -0.026, 0).rotateX(0.55), { p: [-side * 0.036, -0.022, -0.006], r: [0, 0, -side * 0.75], colour: S })
      return { shoulder, elbow, wrist, side, q: new THREE.Quaternion(), bend: 0.15, twist: side * 1.3, pitch: 0, fk: [{ x: 0, v: 0 }, { x: 0, v: 0 }, { x: side * 0.07, v: 0 }] }
    }
    this.arms = [arm(1), arm(-1)]

    k.build(materials, ['eye', 'detail'])

    /* Things they hold, shown only while doing what needs them. Each is one plain mesh. */
    const held = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.3 })
    const prop = (parent, parts, p, rot = [0, 0, 0]) => {
      const mesh = propMesh(parts, held)
      mesh.position.set(...p)
      mesh.rotation.set(...rot)
      mesh.visible = false
      parent.add(mesh)
      return mesh
    }
    const right = this.arms[1].wrist
    this.props = {
      drink: prop(right, [
        [new THREE.CylinderGeometry(0.04, 0.036, 0.095, 20), { colour: '#f4f1ea' }],
        [new THREE.CylinderGeometry(0.036, 0.036, 0.002, 20), { p: [0, 0.042, 0], colour: '#4a2c19' }],
        [new THREE.TorusGeometry(0.024, 0.007, 8, 14, Math.PI), { p: [0.04, 0, 0], r: [0, 0, -Math.PI / 2], colour: '#f4f1ea' }],
      ], [0.005, -0.055, -0.048]),
      read: prop(this.chest, [
        [new THREE.BoxGeometry(0.18, 0.25, 0.024), { colour: pick(['#2f4a6b', '#7a2e2e', '#2f5a45', '#c58b2a', '#3a3a3a'], r) }],
        [new THREE.BoxGeometry(0.17, 0.24, 0.026), { p: [0.006, 0, 0], colour: '#efe8d8' }],
      ], [0, 0.22, 0.34], [-0.85, 0, 0]),
      phone: prop(right, [
        [new THREE.BoxGeometry(0.072, 0.15, 0.008), { colour: '#1a1b1e' }],
        [new THREE.PlaneGeometry(0.064, 0.138), { p: [0, 0, -0.0045], r: [0, Math.PI, 0], colour: '#3d5a80' }],
      ], [0, -0.075, -0.022]),
      pong: prop(right, [
        [new THREE.CylinderGeometry(0.075, 0.075, 0.01, 22), { p: [0, -0.11, 0], r: [Math.PI / 2, 0, 0], colour: '#b3262a' }],
        [new THREE.BoxGeometry(0.026, 0.1, 0.022), { p: [0, -0.02, 0], colour: '#b8895b' }],
      ], [0, -0.05, -0.01]),
      water: prop(right, [
        [new THREE.CylinderGeometry(0.06, 0.07, 0.14, 18), { p: [0, -0.07, 0.05], colour: '#5b8a6a' }],
        [new THREE.CylinderGeometry(0.008, 0.012, 0.18, 8), { p: [0, -0.04, 0.16], r: [1.1, 0, 0], colour: '#5b8a6a' }],
      ], [0, -0.06, -0.03]),
    }

    /* A soft contact shadow on the floor beneath them. */
    this.blob = at(new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.6), BLOB()), 0, 0.03, 0, this.root)
    this.blob.rotation.x = -Math.PI / 2
    this.blob.renderOrder = 1

    /* An invisible column to hover and click: bigger than the person, so easy to hit. */
    this.hit = at(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 10), new THREE.MeshBasicMaterial({ visible: false })), 0, 0.9, 0, this.root)
    this.hit.userData.person = this

    /* Over the head, a dot; it opens to the name on hover. It rides on the neck, so it sits down with them. */
    this.tag = document.createElement('div')
    this.tag.className = 'tag'
    this.tag.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="bg" hidden></span>'
    this.label = at(new CSS2DObject(this.tag), 0, 0.42, 0, this.neck)
    this.setName(name)

    /* Each joint's spring: where it is and how fast it is moving. */
    const s = x => ({ x, v: 0 })
    this.sp = {
      hipY: s(HIP_Y), hipZ: s(0), hipX: s(0), hipYaw: s(0), hipRoll: s(0), lean: s(0), spineYaw: s(0), spineRoll: s(0),
      headX: s(0), headY: s(0), headZ: s(0), swingX: s(0), swingZ: s(0),
      thigh: [s(0), s(0)], splay: [s(0), s(0)], knee: [s(0), s(0)], ankle: [s(0), s(0)],
    }
    this.mouth = 0
    this.path = []
    this.spot = null
    this.target = undefined
    this.mode = 'stand'
    this.walkPhase = 0
    this.blinkAt = 1 + Math.random() * 3
    this.seed = Math.random() * 100
    this.look = { yaw: 0, pitch: 0, at: 0 }
    this.mouseAt = null
    this.placed = false
  }

  setName(name) {
    this.name = name
    this.tag.querySelector('.nm').textContent = name
  }

  /** How many background tasks they have running: a small badge beside their dot. */
  setTasks(count) {
    const badge = this.tag.querySelector('.bg')
    badge.hidden = !count
    badge.textContent = count ? `⟳ ${count}` : ''
  }

  setStatus(status) {
    this.tag.querySelector('.dot').className = `dot ${status}`
  }

  setColour(colour) {
    this.colour = colour
    this.topMat.color.copy(cloth(colour))
    this.topMat.sheenColor.copy(cloth(colour).lerp(new THREE.Color('#ffffff'), 0.3))
  }

  setHover(on) {
    this.tag.classList.toggle('open', on)
    this.topMat.emissive.set(on ? '#ffffff' : '#000000')
    this.topMat.emissiveIntensity = on ? 0.08 : 0
  }

  /** Stand at a place, as if they had always been there. */
  place(spot) {
    this.placed = true
    this.spot = spot
    this.path = []
    this.next = null
    this.root.position.set(spot.x, 0, spot.z)
    this.root.rotation.y = spot.facing
    this.mode = spot.pose
  }

  /** Walk a route; on arrival take up `spot`, or, with none, leave by the front door. */
  walk(points, spot) {
    this.path = points
    this.next = spot
    this.spot = null
    this.mode = 'walk'
    this.mouseAt = null
  }

  tick(dt, t) {
    const pos = this.root.position
    if (this.mode === 'walk') {
      /* A long frame (a background tab) covers several corners at once, so walking keeps real time. */
      const speed = 1.3 * this.height
      let step = speed * dt
      while (step > 0 && this.mode === 'walk') {
        const target = this.path[0]
        if (!target) {
          if (this.next) this.place(this.next)
          else this.gone = true
          break
        }
        const dx = target.x - pos.x
        const dz = target.y - pos.z
        const d = Math.hypot(dx, dz)
        if (d <= step) {
          pos.x = target.x
          pos.z = target.y
          step -= d
          this.path.shift()
        } else {
          pos.x += (dx / d) * step
          pos.z += (dz / d) * step
          this.root.rotation.y = dampAngle(this.root.rotation.y, Math.atan2(dx, dz), 9, dt)
          step = 0
        }
      }
      /* One stride is two steps of about two-thirds of a metre. */
      this.walkPhase += dt * ((2 * Math.PI * speed) / (1.34 * this.height))
    } else if (this.spot) {
      this.root.rotation.y = dampAngle(this.root.rotation.y, this.spot.facing, 7, dt)
    }
    this.animate(Math.min(dt, 0.1), t)
  }

  /** A world point as the spine sees it. */
  inSpine(world, out = new THREE.Vector3()) {
    return this.spine.worldToLocal(out.copy(world))
  }

  animate(dt, t) {
    const m = this.mode
    const o = this.seed
    const s = 1 / this.height
    const seated = ['type', 'read', 'phone', 'meet', 'relax'].includes(m)

    /* Now and then, glance somewhere else. */
    if (t > this.look.at) this.look = { yaw: (Math.random() - 0.5) * 0.9, pitch: (Math.random() - 0.5) * 0.15, at: t + 2 + Math.random() * 5 }

    const T = {
      hipY: HIP_Y, hipZ: 0, hipX: 0, hipYaw: 0, hipRoll: 0, lean: 0.02, spineYaw: 0, spineRoll: 0,
      thigh: [0, 0], splay: [0.02, 0.02], knee: [0.02, 0.02], ankle: [null, null], headX: 0, headY: 0, headZ: 0, mouth: 0,
    }
    /* Each arm: an IK target in the spine's space, or a plain shoulder turn; then the elbow, and the hand's twist and pitch. */
    const A = this.arms.map(a => ({ ik: null, pole: new THREE.Vector3(a.side * 0.4, -1, -0.3), fk: [0.04, 0, a.side * 0.07], bend: 0.15, twist: a.side * 1.3, pitch: 0 }))
    const talk = amount => amount * (0.35 + 0.35 * Math.abs(Math.sin(t * 9.5 + o)) * (Math.sin(t * 2.1 + o) > -0.3 ? 1 : 0.2))

    if (seated) {
      const seat = (this.spot?.seat ?? SEAT) * s
      T.hipY = seat + 0.075
      T.hipZ = -0.04
      /* Thighs along the seat; shins down to the floor, angled forward when the seat is low. */
      const kneeY = T.hipY - THIGH * Math.cos(1.42)
      const shin = Math.acos(clamp((kneeY - ANKLE) / SHIN, -1, 1))
      T.thigh = [-1.42, -1.42]
      T.knee = [1.42 - shin, 1.42 - shin]
      T.splay = [0.07, 0.07]
      T.lean = 0.04
    } else if (m === 'walk') {
      const ph = this.walkPhase
      for (const i of [0, 1]) {
        const p = ph + (i ? Math.PI : 0)
        const f = Math.sin(p)
        T.thigh[i] = -0.42 * f
        T.knee[i] = 0.08 + 0.85 * Math.max(0, Math.cos(p + 0.4)) ** 2
        T.ankle[i] = -(T.thigh[i] + T.knee[i]) + 0.32 * Math.max(0, Math.cos(p + 1.6)) - 0.15 * Math.max(0, Math.cos(p - 1.4))
        const arm = A[i]
        arm.fk = [0.34 * f, 0, (i ? -1 : 1) * 0.09]
        arm.bend = 0.22 + 0.32 * Math.max(0, -f)
      }
      T.hipY = HIP_Y - 0.026 * Math.sin(ph) ** 2 - 0.012
      T.hipYaw = -0.1 * Math.sin(ph)
      T.spineYaw = 0.15 * Math.sin(ph)
      T.hipRoll = 0.03 * Math.cos(ph)
      T.hipX = -0.012 * Math.cos(ph)
      T.lean = 0.05
      T.headX = 0.03
    } else {
      /* Standing: weight drifts from foot to foot, the other knee easing. */
      const w = Math.sin(t * 0.45 + o)
      T.hipX = 0.018 * w
      T.hipRoll = -0.03 * w
      T.spineRoll = 0.025 * w
      T.knee = [0.03 + 0.1 * Math.max(0, -w), 0.03 + 0.1 * Math.max(0, w)]
      T.thigh = [-0.04 * Math.max(0, -w), -0.04 * Math.max(0, w)]
      T.splay = [0.04, 0.04]
      T.headY = this.look.yaw * 0.6
      T.headX = this.look.pitch
      T.headZ = -0.02 * w
    }

    const [L, R] = A
    this.mouseAt = null
    const keys = this.spot?.reach
    if (m === 'type') {
      /* Hands on the keyboard; now and then the right goes to the mouse. */
      this.root.updateMatrixWorld(true)
      const board = keys ? this.inSpine(_v.set(keys.x, keys.y, keys.z)) : _v.set(0, 0.29, 0.42)
      const mouse = (t + o) % 11 < 2.2
      for (const a of A) {
        const sx = a === L ? 1 : -1
        const tap = 0.006 * Math.max(0, Math.sin(t * 13 + o + sx * 1.9))
        a.ik = board.clone().add(new THREE.Vector3(sx * 0.095 + Math.sin(t * 3 + sx) * 0.01, tap, 0))
        a.pole = new THREE.Vector3(sx * 0.6, -1, -0.5)
        a.twist = sx * 0.15
        a.pitch = 0.18
      }
      /* On the mouse, the hand rests over it and the mouse goes wherever the hand does. */
      const home = this.spot?.mouse
      if (mouse && home) {
        const f = this.spot.facing
        const [fx, fz] = [Math.sin(f), Math.cos(f)]
        const [rx, rz] = [-Math.cos(f), Math.sin(f)]
        const slide = Math.sin(t * 1.4 + o) * 0.028
        const push = Math.sin(t * 0.9 + o * 2) * 0.02
        this.mouseAt = { x: home.x + rx * slide + fx * push, z: home.z + rz * slide + fz * push }
        R.ik = this.inSpine(_w.set(this.mouseAt.x - fx * 0.065, home.y + 0.035, this.mouseAt.z - fz * 0.065))
        R.pitch = 0.3
        R.twist = -0.1
      } else if (mouse) R.ik.add(new THREE.Vector3(-0.21, 0.004, 0.04))
      T.lean = 0.12
      T.headX = 0.2 + Math.sin(t * 0.6 + o) * 0.03
      T.headY = Math.sin(t * 0.31 + o) * 0.08 + (mouse ? -0.06 : 0)
    }
    if (m === 'meet') {
      /* Forearms on the table; whoever is talking lifts a hand to make the point. */
      this.root.updateMatrixWorld(true)
      const table = keys ? this.inSpine(_v.set(keys.x, keys.y, keys.z)) : _v.set(0, 0.28, 0.42)
      const talking = Math.sin(t * 0.9 + o) > 0.2
      for (const a of A) {
        const sx = a === L ? 1 : -1
        a.ik = table.clone().add(new THREE.Vector3(sx * 0.13, 0, -0.02))
        a.pole = new THREE.Vector3(sx * 0.9, -1, -0.3)
        a.twist = sx * 0.6
      }
      if (talking) {
        R.ik.add(new THREE.Vector3(0.04, 0.12 + Math.sin(t * 2.4 + o) * 0.05, -0.02))
        R.twist = -1.2
      }
      T.headY = Math.sin(t * 0.5 + o) * 0.45
      T.headX = 0.05
      T.mouth = talking ? talk(1) : 0
    }
    if (m === 'read') {
      /* The book in both hands at the chest, head bowed to it. */
      for (const a of A) {
        const sx = a === L ? 1 : -1
        a.ik = new THREE.Vector3(sx * 0.1, 0.17, 0.3)
        a.pole = new THREE.Vector3(sx, -0.6, -0.4)
        a.twist = sx * 1.4
      }
      T.lean = -0.08
      T.headX = 0.42
      if ((t + o) % 9 < 0.6) R.ik.add(new THREE.Vector3(0.05, 0.06, 0))
    }
    if (m === 'phone') {
      /* Phone in the right hand, the left resting on the thigh; a laugh now and then. */
      R.ik = new THREE.Vector3(-0.04, 0.22, 0.27)
      R.pole = new THREE.Vector3(-0.8, -1, -0.2)
      R.twist = 0.5
      R.pitch = -0.6
      L.ik = new THREE.Vector3(0.11, -0.02, 0.3)
      L.pole = new THREE.Vector3(1, -0.4, -0.5)
      L.twist = 0.2
      L.pitch = 0.3
      T.lean = -0.05
      T.headX = 0.48
      T.headY = -0.05
      T.mouth = (t + o) % 7 < 1.1 ? 0.55 : 0
    }
    if (m === 'relax') {
      /* Leant back, hands on the armrests, looking around the room. */
      for (const a of A) {
        const sx = a === L ? 1 : -1
        a.ik = new THREE.Vector3(sx * 0.24, 0.13, 0.2)
        a.pole = new THREE.Vector3(sx, -0.5, -1)
        a.twist = sx * 0.2
      }
      T.lean = -0.16
      T.headY = this.look.yaw * 0.7
      T.headX = 0.05 + this.look.pitch
    }
    if (m === 'drink') {
      /* Mug held at the chest; every few seconds it comes up to the lips. */
      const sip = (t + o) % 6 < 1.4
      this.root.updateMatrixWorld(true)
      R.ik = sip ? this.inSpine(this.head.localToWorld(_w.set(-0.02, HEAD_C.y - 0.17, HEAD_C.z + 0.14))) : new THREE.Vector3(-0.12, 0.27, 0.26)
      R.pole = new THREE.Vector3(-1, -1, -0.4)
      R.twist = 1.5
      L.fk = [0.05, 0, 0.1]
      L.bend = 0.2
      T.headX = sip ? -0.12 : this.look.pitch
      T.headY = sip ? 0 : this.look.yaw
      T.mouth = sip ? 0 : (t + o) % 5 < 1 ? 0.6 : 0
    }
    if (m === 'chat') {
      /* One hand in a pocket, the other making the point. */
      const talking = Math.sin(t * 0.9 + o) > 0.2
      const g = Math.sin(t * 2.3 + o)
      L.fk = [0.22, 0, 0.12]
      L.bend = 0.5
      L.twist = 1.6
      R.fk = talking ? [-0.55 + g * 0.2, 0, -0.18] : [0.05, 0, -0.1]
      R.bend = talking ? 1.3 : 0.25
      R.twist = talking ? -0.5 : -1.3
      T.headY = Math.sin(t * 0.5 + o) * 0.4
      T.mouth = talking ? talk(1) : 0
    }
    if (m === 'think') {
      /* Hand to the chin, the other arm folded beneath it, head tipped. */
      this.root.updateMatrixWorld(true)
      R.ik = this.inSpine(this.head.localToWorld(_w.set(0, HEAD_C.y - 0.12, HEAD_C.z + 0.07)))
      R.pole = new THREE.Vector3(-0.3, -1, 0.2)
      R.twist = -2.2
      L.ik = new THREE.Vector3(-0.07, 0.24, 0.17)
      L.pole = new THREE.Vector3(1, -1, 0.1)
      L.twist = 1.6
      T.headZ = 0.1
      T.headX = -0.06
    }
    if (m === 'stretch') {
      const up = (t + o) % 8 < 2.6
      for (const a of A) {
        const sx = a === L ? 1 : -1
        a.fk = up ? [-2.85, 0, sx * 0.3] : a.fk
        a.bend = up ? 0.35 : 0.15
        a.twist = up ? sx * 0.3 : a.twist
      }
      T.headX = up ? -0.3 : T.headX
      T.lean = up ? -0.07 : T.lean
      T.mouth = up ? 0.7 : 0
    }
    if (m === 'pong') {
      const swing = this.pongSwing ?? 0
      T.thigh = [-0.35, -0.35]
      T.knee = [0.62, 0.62]
      T.hipY = HIP_Y - 0.08
      T.lean = 0.24
      T.splay = [0.12, 0.12]
      L.fk = [-0.35, 0, 0.3]
      L.bend = 1.0
      R.fk = [-0.55 - swing * 0.6, 0, -0.35 - swing * 0.5]
      R.bend = 0.9 - swing * 0.4
      R.twist = -0.3
      T.headX = -0.05
      T.headY = 0
      T.mouth = swing > 0.5 ? 0.5 : 0
    }
    if (m === 'arcade') {
      this.root.updateMatrixWorld(true)
      const panel = keys ? this.inSpine(_v.set(keys.x, keys.y, keys.z)) : _v.set(0, 0.25, 0.4)
      const j = Math.sin(t * 9 + o)
      L.ik = panel.clone().add(new THREE.Vector3(0.1 + j * 0.012, 0.03, -0.01))
      R.ik = panel.clone().add(new THREE.Vector3(-0.1, 0.01 + 0.008 * Math.max(0, Math.sin(t * 15 + o)), 0))
      L.pole = new THREE.Vector3(1, -1, -0.4)
      R.pole = new THREE.Vector3(-1, -1, -0.4)
      L.twist = 0.6
      R.twist = -0.1
      T.lean = 0.1
      T.headX = 0.1
      T.headY = 0
      T.mouth = (t + o) % 4 < 1 ? 0.6 : 0
    }
    if (m === 'water') {
      R.fk = [-0.9, 0, -0.1]
      R.bend = 0.35
      R.pitch = 0.4 + Math.sin(t * 1.5 + o) * 0.25
      R.twist = -1.4
      T.headX = 0.3
      T.headY = 0
    }
    if (m === 'present') {
      R.fk = [-2.0 + Math.sin(t * 1.2 + o) * 0.2, 0, -0.2]
      R.bend = 0.2
      T.headY = Math.sin(t * 0.6 + o) * 0.3
      T.mouth = talk(1)
    }

    /*
     * Move every joint on its spring. Legs follow closely while walking so
     * feet keep their timing; the trunk eases and settles; the head answers
     * last and steadies itself against the hips' sway.
     */
    const P = this.sp
    const walking = m === 'walk'
    const body = walking ? [6, 0.85] : [2.6, 0.78]
    for (const key of ['hipY', 'hipZ', 'hipX', 'hipYaw', 'hipRoll', 'spineYaw', 'spineRoll']) spring(P[key], T[key], dt, ...body)
    spring(P.lean, T.lean, dt, 1.8, 0.7)
    for (const i of [0, 1]) {
      const legs = walking ? [9, 0.9] : [2.8, 0.85]
      spring(P.thigh[i], T.thigh[i], dt, ...legs)
      spring(P.splay[i], T.splay[i], dt, ...legs)
      spring(P.knee[i], T.knee[i], dt, ...legs)
      spring(P.ankle[i], T.ankle[i] ?? -(T.thigh[i] + T.knee[i]), dt, ...legs)
    }
    spring(P.headX, T.headX, dt, 1.5, 0.7)
    spring(P.headY, T.headY, dt, 1.2, 0.72)
    spring(P.headZ, T.headZ - P.hipRoll.x * 0.7, dt, 1.5, 0.7)
    this.mouth = damp(this.mouth, T.mouth, 18, dt)

    this.hips.position.set(P.hipX.x, P.hipY.x, P.hipZ.x)
    this.hips.rotation.set(0, P.hipYaw.x, P.hipRoll.x)
    this.spine.rotation.set(P.lean.x, P.spineYaw.x - P.hipYaw.x * 0.5, P.spineRoll.x - P.hipRoll.x)
    this.legs.forEach((leg, i) => {
      const side = i ? -1 : 1
      leg.thigh.rotation.set(P.thigh[i].x, 0, side * P.splay[i].x)
      leg.knee.rotation.x = Math.max(0, P.knee[i].x)
      leg.ankle.rotation.set(P.ankle[i].x, 0, -side * P.splay[i].x)
    })
    /* Breathing: the chest rises and widens a touch. */
    const breath = Math.sin(t * 1.55 + o)
    this.chest.scale.set(1 + breath * 0.008, 1, 1 + breath * 0.014)
    this.neck.rotation.x = P.headX.x * 0.35
    this.head.rotation.set(P.headX.x * 0.65, P.headY.x, P.headZ.x)

    /*
     * Arms: solve the reaches against this frame's body, then ease toward
     * them. A shoulder turn swings on its own spring, so arms lag and settle
     * like a pendulum when walking. The shoulder itself lifts and draws in
     * as the arm rises above the waist, as a collarbone does.
     */
    this.root.updateMatrixWorld(true)
    const ease = 1 - Math.exp(-(m === 'type' || m === 'arcade' || m === 'pong' ? 18 : 9) * dt)
    this.arms.forEach((a, i) => {
      const spec = A[i]
      let bend = spec.bend
      if (spec.ik) {
        bend = reachFor(a.shoulder.position, spec.ik, spec.pole, _q)
        _e.setFromQuaternion(_q)
        a.fk.forEach((f, j) => ((f.x = _e.toArray()[j]), (f.v = 0)))
      } else {
        const [hz, ratio] = walking ? [1.6, 0.45] : [2.2, 0.7]
        _q.setFromEuler(_e.set(...spec.fk.map((x, j) => spring(a.fk[j], x, dt, hz, ratio))))
      }
      a.q.slerp(_q, spec.ik ? ease : 1)
      a.shoulder.quaternion.copy(a.q)
      const rise = clamp((_v.set(0, -1, 0).applyQuaternion(a.q).y + 0.2) / 1.2, 0, 1)
      a.shoulder.position.set(a.side * (SHOULDER.x - rise * 0.012) * (a.shoulder.userData.build ?? 1), SHOULDER.y + breath * 0.002 + rise * 0.032, -0.01)
      a.bend = damp(a.bend, bend, spec.ik ? 18 : 8, dt)
      a.elbow.rotation.x = -a.bend
      a.twist = dampAngle(a.twist, spec.twist, 8, dt)
      a.pitch = damp(a.pitch, spec.pitch, 8, dt)
      a.wrist.rotation.set(a.pitch, a.twist, 0)
    })

    /* Long hair and ponytails swing behind the head's movement and the walk's bounce. */
    const bounce = walking ? Math.sin(this.walkPhase * 2) : 0
    spring(P.swingX, -P.headX.x * 0.6 - P.lean.x * 0.5 + bounce * 0.05, dt, 1.8, 0.35)
    spring(P.swingZ, -P.headZ.x * 0.8 - P.hipRoll.x * 1.5 + (walking ? Math.cos(this.walkPhase) * 0.05 : 0), dt, 1.6, 0.35)
    this.swing.rotation.set(P.swingX.x, 0, P.swingZ.x)

    /* Props: shown for their activity; the mug stays upright in the hand. */
    for (const [name, p] of Object.entries(this.props)) p.visible = m === name
    if (m === 'drink') {
      this.root.updateMatrixWorld(true)
      this.props.drink.parent.getWorldQuaternion(_q).invert()
      this.props.drink.quaternion.copy(_q.multiply(this.root.quaternion))
    }

    /* Face: the mouth opens to talk and laugh; the eyes blink every few seconds. */
    this.mouthHole.scale.y = 0.05 + this.mouth
    this.jaw.position.y = -this.mouth * 0.006
    if (t > this.blinkAt) {
      const closing = t - this.blinkAt < 0.11
      this.eyes.scale.y = closing ? 0.08 : 1
      if (!closing) this.blinkAt = t + 2 + Math.random() * 4.5
    }
  }

  dispose(scene) {
    this.label.element.remove()
    scene.remove(this.root)
  }
}

let blobMaterial = null
const BLOB = () => (blobMaterial ??= new THREE.MeshBasicMaterial({ map: textures().blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))

function at(obj, x, y, z, parent) {
  obj.position.set(x, y, z)
  parent.add(obj)
  return obj
}
