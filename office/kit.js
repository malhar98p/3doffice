// Building blocks shared by the office and its people: themed materials that
// recolour in place when the theme changes, procedural textures (wood, carpet,
// concrete, fabric, hair), and small shape helpers.
//
// Every surface is a MeshPhysicalMaterial lit by the RoomEnvironment, so wood,
// fabric, leather, steel and glass each catch light the way the real thing does.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/** Every surface colour the office uses, for day and for night. Textured surfaces are tinted by these. */
export const THEMES = {
  light: {
    bg: '#e7e9ed', label: '#8a93a3',
    wall: '#e6e1d8', trim: '#d8d2c6', slab: '#cfccc6', sage: '#9aa894', slate: '#7d8a99', clay: '#c99a7e', teal: '#4f7a78',
    oak: '#d6bc98', concrete: '#c4c1bb', stone: '#d9d4cb', tile: '#dcd5ca', vinyl: '#b5c1bc',
    carpetPlan: '#a9b5c6', carpetEng: '#aebcae', carpetQA: '#c4b7a4', carpetDesign: '#bfafbd', carpetMeet: '#b4b7bd',
    deskTop: '#dcc39e', wood: '#c9a77f', walnut: '#7a5538',
    sofa: '#8b9096', sofaWarm: '#cdbfab', chair: '#3d4148', counter: '#e8e4dc', worktop: '#f1efea',
    rug: '#d8cfc2', rugAccent: '#9aa8b8',
  },
  dark: {
    bg: '#0e1015', label: '#9aa3b3',
    wall: '#8e8a84', trim: '#7a756d', slab: '#3a3936', sage: '#5f6a5b', slate: '#4f5966', clay: '#87634f', teal: '#33504f',
    oak: '#a2896c', concrete: '#8a8884', stone: '#9c9993', tile: '#9a958d', vinyl: '#73807b',
    carpetPlan: '#6e7a8e', carpetEng: '#6f7e6f', carpetQA: '#867b6b', carpetDesign: '#83737f', carpetMeet: '#73767d',
    deskTop: '#9c8264', wood: '#946f4c', walnut: '#5a3b26',
    sofa: '#565a60', sofaWarm: '#857a6b', chair: '#2c2f35', counter: '#a29e97', worktop: '#b5b2ac',
    rug: '#8f877c', rugAccent: '#5f6c7b',
  },
}

export let themeName = 'light'
const themed = []

/** A material whose colour follows the theme. */
export const tone = (key, opts = {}) => {
  const m = new THREE.MeshPhysicalMaterial({ color: THEMES[themeName][key], roughness: 0.7, ...opts })
  themed.push([m, key])
  return m
}

export const applyTheme = name => {
  themeName = name
  for (const [m, key] of themed) m.color.set(THEMES[name][key])
}

const cache = new Map()
/** A fixed-colour material, shared by everything of that colour. */
export const mat = (color, rough = 0.6, metal = 0, extra = {}) => {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`
  if (!cache.has(key)) cache.set(key, new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, ...extra }))
  return cache.get(key)
}

/* ── Seeded randomness, so the same name always gives the same thing ───── */

/** Mulberry32. Unsigned shifts throughout: a signed shift of a large hash goes negative and picks nothing. */
export const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const hash = s => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

/* ── Procedural textures ───────────────────────────────────────────────── */

/** A texture painted pixel by pixel; `paint(x, y)` returns grey 0–1 or [r, g, b] 0–1. */
const painted = (size, paint, { srgb = true } = {}) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = paint(x, y)
      const [r, g, b] = Array.isArray(v) ? v : [v, v, v]
      const i = (y * size + x) * 4
      img.data[i] = r * 255
      img.data[i + 1] = g * 255
      img.data[i + 2] = b * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/* Value noise that tiles across the texture edge. */
const lattice = (seed, n) => {
  const r = rng(seed)
  const g = Array.from({ length: n * n }, r)
  const smooth = u => u * u * (3 - 2 * u)
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const [fx, fy] = [smooth(x - xi), smooth(y - yi)]
    const at = (i, j) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)]
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx
    return top + (bottom - top) * fy
  }
}
const fbm = (noise, x, y, octaves = 4) => {
  let v = 0
  let a = 0.5
  for (let o = 0; o < octaves; o++, a /= 2) v += a * noise(x * 2 ** o, y * 2 ** o)
  return v
}

let made = null
/** The office's textures, made once on first use. Colour maps are near-white so the theme tint shows through. */
export const textures = () => {
  if (made) return made
  const n1 = lattice(11, 64)
  const n2 = lattice(23, 64)
  const S = 512
  made = {
    /* Oak planks: 6 boards across, staggered joints, long grain. */
    planks: painted(S, (x, y) => {
      const board = Math.floor((y / S) * 6)
      const along = (x / S + board * 0.37) % 1
      const joint = along < 0.004 || y % (S / 6) < 1.5 ? 0.78 : 1
      const grain = 0.9 + 0.1 * Math.sin((y / S) * 6 * Math.PI * 14 + fbm(n1, (x / S) * 8, (y / S) * 64) * 9)
      const tone = 0.93 + 0.07 * n2((board * 7.3) % 64, 3)
      const v = joint * grain * tone
      return [v, v * 0.985, v * 0.96]
    }),
    /* Furniture wood: fine straight grain. */
    grain: painted(256, (x, y) => {
      const g = 0.9 + 0.1 * Math.sin((y / 256) * Math.PI * 40 + fbm(n1, (x / 256) * 4, (y / 256) * 32) * 6)
      return [g, g * 0.98, g * 0.95]
    }),
    /* Loop-pile carpet tiles: speckle, with faint 50 cm tile seams. */
    carpet: painted(S, (x, y) => {
      const speck = 0.86 + 0.14 * fbm(n2, (x / S) * 64, (y / S) * 64, 2)
      const seam = x % (S / 2) < 1 || y % (S / 2) < 1 ? 0.9 : 1
      return speck * seam
    }),
    /* Polished concrete: soft mottling. */
    concrete: painted(S, (x, y) => 0.88 + 0.12 * fbm(n1, (x / S) * 6, (y / S) * 6, 5)),
    /* Large stone or ceramic tiles with thin grout lines. */
    tile: painted(S, (x, y) => {
      const grout = x % (S / 2) < 2 || y % (S / 2) < 2 ? 0.8 : 1
      return grout * (0.93 + 0.07 * fbm(n2, (x / S) * 10, (y / S) * 10, 4))
    }),
    /* A woven rug: a quiet border and a herringbone field. */
    rug: painted(S, (x, y) => {
      const border = Math.min(x, y, S - x, S - y) < 28
      const zig = ((Math.floor(x / 8) + Math.floor((y + (Math.floor(x / 32) % 2 ? x % 32 : 32 - (x % 32))) / 8)) % 2) * 0.06
      const fuzz = 0.92 + 0.08 * n1((x / S) * 64, (y / S) * 64)
      return border ? 0.7 * fuzz : (0.94 - zig) * fuzz
    }),
    /* Upholstery weave, for bump: fine over-under threads. */
    weave: painted(128, (x, y) => 0.5 + 0.25 * Math.sin(x * 0.8) * Math.sin(y * 0.8) + 0.25 * n1(x / 4, y / 4), { srgb: false }),
    /* Denim twill: diagonal ribs and slubby yarn, near-white so the colour tints it. */
    denim: painted(256, (x, y) => {
      const twill = 0.86 + 0.14 * Math.sin(((x + y) / 256) * Math.PI * 2 * 48)
      const slub = 0.9 + 0.1 * fbm(n2, (x / 256) * 4, (y / 256) * 48, 3)
      return [twill * slub, twill * slub, Math.min(1, twill * slub * 1.04)]
    }),
    /* Rib knit: raised ribs running along the garment, for bump. */
    rib: painted(128, (x, y) => {
      const v = Math.sin((x / 128) * Math.PI * 2 * 8)
      return 0.5 + 0.42 * Math.sign(v) * Math.abs(v) ** 0.5 + 0.08 * n2(x / 4, y / 2)
    }, { srgb: false }),
    /* Knit stitches for sweaters, for bump. */
    knit: painted(128, (x, y) => {
      const col = x % 8
      const v = Math.abs(((y + (col < 4 ? col : 8 - col) * 2) % 8) - 4) / 4
      return 0.35 + 0.65 * v
    }, { srgb: false }),
    /* Hair strands running down the head, for bump. */
    strands: painted(256, (x, y) => 0.5 + 0.5 * fbm(n1, (x / 256) * 64, (y / 256) * 2, 3), { srgb: false }),
    /* Skin: fine pores and the faint lines of real skin, for bump. */
    pores: painted(256, (x, y) => {
      const pore = n1(x / 3, y / 3) > 0.82 ? 0.25 : 1
      return 0.55 + 0.25 * fbm(n2, x / 16, y / 16, 3) + 0.2 * pore * n2(x / 1.5, y / 1.5)
    }, { srgb: false }),
    /* Cloth: soft creases running round a sleeve or trouser leg, for bump. */
    folds: painted(256, (x, y) => {
      const crease = Math.sin((y / 256) * Math.PI * 2 * 9 + fbm(n1, (x / 256) * 3, (y / 256) * 6, 3) * 7)
      return 0.5 + 0.32 * crease * crease * Math.sign(crease) + 0.18 * n2(x / 6, y / 6)
    }, { srgb: false }),
    /* Hair strands for hair cards: brightness varies strand to strand; alpha thins toward the tips. */
    ...(() => {
      const rnd = rng(77)
      const strands = Array.from({ length: 170 }, () => ({ x: rnd() * 128, w: 0.8 + rnd() * 1.6, len: 0.6 + rnd() * 0.4, tone: 0.7 + rnd() * 0.3, wave: rnd() * 6 }))
      const at = (x, y) => {
        const v = y / 256
        let a = 0
        let tone = 0.7
        for (const s of strands) {
          const sx = (s.x + Math.sin(v * 9 + s.wave) * 1.5 + 128) % 128
          const d = Math.min(Math.abs(x - sx), 128 - Math.abs(x - sx))
          if (d < s.w && v < s.len) {
            const fade = Math.min(1, (s.len - v) / 0.25) * Math.min(1, v / 0.04 + 0.6)
            if (fade > a) ((a = fade), (tone = s.tone))
          }
        }
        return [a, tone]
      }
      const cache = Array.from({ length: 256 }, (_, y) => Array.from({ length: 128 }, (_, x) => at(x, y)))
      const tex = (pick, srgb) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 256 })
        const ctx = canvas.getContext('2d')
        const img = ctx.createImageData(128, 256)
        for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) {
          const v = pick(cache[y][x]) * 255
          img.data.set([v, v, v, 255], (y * 128 + x) * 4)
        }
        ctx.putImageData(img, 0, 0)
        const t = new THREE.CanvasTexture(canvas)
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        return t
      }
      return { strandColour: tex(([, tone]) => tone, true), strandAlpha: tex(([a]) => a, false) }
    })(),
    /* Paint on plaster: the faint orange-peel of a rollered wall, for bump. */
    plaster: painted(256, (x, y) => 0.5 + 0.5 * fbm(n2, (x / 256) * 32, (y / 256) * 32, 3), { srgb: false }),
    /* A laptop keyboard: dark keys on a lighter deck. */
    keys: (() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 192 })
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#9ea2a8'
      ctx.fillRect(0, 0, 512, 192)
      ctx.fillStyle = '#16171a'
      for (let row = 0; row < 5; row++) {
        const keys = [14, 14, 13, 12, 9][row]
        const w = 512 / 14.6
        let x = 8 + (row % 2) * 6
        for (let k = 0; k < keys; k++) {
          const kw = row === 4 && k === 4 ? w * 5 : w - 4
          ctx.beginPath()
          ctx.roundRect(x, 8 + row * 36, kw, 31, 4)
          ctx.fill()
          x += kw + 4
        }
      }
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })(),
    /* A soft round shadow, for contact shadows under people. */
    blob: (() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 })
      const ctx = canvas.getContext('2d')
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(0.5, 'rgba(0,0,0,0.25)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 128, 128)
      return new THREE.CanvasTexture(canvas)
    })(),
    /* A soft rectangle, for contact shadows under furniture. */
    softbox: (() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 })
      const ctx = canvas.getContext('2d')
      ctx.filter = 'blur(14px)'
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(26, 26, 76, 76)
      return new THREE.CanvasTexture(canvas)
    })(),
  }
  return made
}

/**
 * World-space UVs for a merged, already-placed geometry: each face takes the
 * two axes it lies along, so a texture keeps its real size on every surface.
 */
export const worldUV = (g, size) => {
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const [ax, ay, az] = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv[i * 2] = u / size
    uv[i * 2 + 1] = v / size
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/* ── Shapes ────────────────────────────────────────────────────────────── */

export const shade = mesh => ((mesh.castShadow = true), (mesh.receiveShadow = true), mesh)
/* A box with rounded edges; edges under a centimetre are left square, since nobody sees a bevel that small and it costs triangles. */
export const box = (w, h, d, material, r = 0.01) => {
  const radius = Math.min(r, w / 2, h / 2, d / 2) - 0.0001
  const g = radius < 0.008 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, radius >= 0.03 ? 2 : 1, radius)
  return shade(new THREE.Mesh(g, material))
}
export const cyl = (rt, rb, h, material, seg = 20) => shade(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material))
export const ball = (r, material, seg = 20) => shade(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)), material))
export const capsule = (r, len, material, seg = 14) => shade(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, seg), material))
export const at = (obj, x, y, z, parent) => (obj.position.set(x, y, z), parent.add(obj), obj)
