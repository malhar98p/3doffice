// The Brain, brought into the office. Two views of one picture: how the team
// works through the code index, and who handed what to whom.
//
// The panel draws the brain with its regions of the codebase, the ten people
// on a ring around it, a line from each person to every region their recent
// searches reached (pulsing while fresh), hand-off arrows from whoever briefed
// a job to whoever is doing it, and beneath it the session's workflow in order.
//
// The hologram is the same brain floating above the office, with a beam to
// everyone at work that flares when they ask it something.

import * as THREE from 'three'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''))
const ago = ms => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}

/* Searches count as recent for three minutes, and pulse for the first twenty seconds. */
const RECENT = 180_000
const FRESH = 20_000

/* The drawing: a 640 × 470 board, the brain in the middle, people on an ellipse round it. */
const W = 640
const H = 470
const CX = 320
const CY = 222
const LOBES = [[-92, -14, 62], [-46, -66, 66], [24, -76, 66], [88, -40, 62], [108, 14, 46], [-82, 40, 46], [0, 6, 82]]

const brainBody = () => {
  const blob = cls => LOBES.map(([dx, dy, r]) => `<circle class="${cls}" cx="${CX + dx * 0.78}" cy="${CY + dy * 0.78}" r="${r * 0.78}"/>`).join('')
  const folds = [
    `M${CX - 108},${CY - 8} q24,-18 42,0 t40,-5`,
    `M${CX - 66},${CY - 72} q18,18 42,5 t42,9`,
    `M${CX + 6},${CY - 106} q-5,28 18,37 t14,33`,
    `M${CX + 55},${CY - 66} q24,9 24,33 t18,23`,
    `M${CX - 72},${CY + 44} q24,-14 46,0 t46,-9`,
  ]
  return `<path class="stem" d="M${CX + 42},${CY + 54} q9,30 -5,56 h24 q5,-30 14,-51Z"/>${blob('lobe-edge')}${blob('lobe')}<path class="fold" d="${folds.join(' ')}"/>`
}

/**
 * The Brain panel. `ctx` reads the office's state on demand: the roster,
 * each person's status and colour, the merged agents and searches, and
 * opens a conversation when a person is clicked.
 */
export const brainPanel = ctx => {
  const el = document.getElementById('brainBody')
  let drawn = ''

  const render = () => {
    const state = ctx.state()
    const now = Date.now()
    const members = ctx.members()
    const agents = Object.values(state.agents ?? {})
    const regions = state.brain?.regions?.length ? state.brain.regions : []
    const nameOf = id => state.agents?.[id]?.name
    const recent = (state.queries ?? []).filter(q => now - q.at < RECENT)

    /* People on a ring of evenly spaced places, Wren at the top; the place at the bottom is kept for You. */
    const places = members.length + (members.length % 2 ? 1 : 2)
    const slot = k => {
      const a = -Math.PI / 2 + (k / places) * Math.PI * 2
      return { x: CX + Math.cos(a) * 262, y: CY + Math.sin(a) * 192 }
    }
    const ring = members.map((m, i) => ({ m, ...slot(i < places / 2 ? i : i + 1) }))
    const you = slot(places / 2)
    const at = name => ring.find(p => p.m.name === name)
    const regionAt = area => {
      const r = regions.find(x => x.area === area)
      return r ? { x: CX + r.dx * 0.78, y: CY + r.dy * 0.78 } : null
    }

    /* Lines from people to the regions they searched; fresh ones carry a travelling pulse. */
    const links = recent.flatMap((q, qi) => {
      const p = at(nameOf(q.by))
      if (!p) return []
      const colour = ctx.colourOf(p.m)
      const fade = 0.25 + 0.6 * (1 - (now - q.at) / RECENT)
      return q.areas.map((area, ai) => {
        const r = regionAt(area)
        if (!r) return ''
        const path = `M${p.x},${p.y} Q${(p.x + r.x) / 2 + (r.y - p.y) * 0.2},${(p.y + r.y) / 2 - (r.x - p.x) * 0.2} ${r.x},${r.y}`
        const pulse = now - q.at < FRESH ? `<circle r="4.5" fill="${colour}" stroke="#fff" stroke-width="1.5"><animateMotion dur="1.4s" begin="-${(qi * 0.3 + ai * 0.2).toFixed(2)}s" repeatCount="indefinite" path="${path}"/></circle>` : ''
        return `<path d="${path}" fill="none" stroke="${colour}" stroke-opacity="${fade.toFixed(2)}" stroke-width="2" stroke-dasharray="5 5"><title>${esc(`${p.m.name} asked “${q.ask}” → ${q.files.length} files in ${area}`)}</title></path>${pulse}`
      })
    }).join('')

    /* Hand-offs: an arrow from whoever briefed each live job to whoever is doing it. */
    const live = agents.filter(a => a.id !== 'main' && ctx.isLive(a))
    const handoffs = live.map(a => {
      const to = at(a.name)
      const parent = a.parent === 'owner' ? null : state.agents?.[`${a.sessionId}:${a.parent ?? 'main'}`]
      const from = a.parent === 'owner' ? you : at(parent?.name)
      if (!to || !from || from === to) return ''
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy) || 1
      const [ex, ey] = [to.x - (dx / len) * 24, to.y - (dy / len) * 24]
      return `<path class="handoff" d="M${from.x + (dx / len) * 24},${from.y + (dy / len) * 24} L${ex},${ey}" marker-end="url(#arrow)"><title>${esc(`${a.parent === 'owner' ? 'You' : parent?.name ?? 'Wren'} → ${a.name}: ${a.description || a.kind}`)}</title></path>`
    }).join('')

    /* Regions, lit by how many recent searches reached them; hover lists the files found there. */
    const heat = new Map()
    const files = new Map()
    for (const q of recent) for (const area of q.areas) heat.set(area, (heat.get(area) ?? 0) + 1)
    for (const q of (state.queries ?? []).slice(-25)) for (const f of q.files) {
      const area = q.areas.find(a => f.includes(a.toLowerCase())) ?? q.areas[0]
      if (!area) continue
      files.set(area, [...new Set([...(files.get(area) ?? []), f])].slice(-6))
    }
    const regionNodes = regions.map(({ area }) => {
      const { x, y } = regionAt(area)
      const hot = heat.get(area) ?? 0
      const list = files.get(area) ?? []
      return `<g class="region${hot ? ' hot' : ''}"><title>${esc(`${area}${list.length ? `\n${list.join('\n')}` : '\nNo files found here yet'}`)}</title>
        <circle cx="${x}" cy="${y}" r="${hot ? 11 : 7.5}" class="dot">${hot ? '<animate attributeName="r" values="10;13;10" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>
        <text x="${x}" y="${y - (hot ? 16 : 12)}" text-anchor="middle">${esc(area)}</text></g>`
    }).join('')

    /* People: initials in their role colour, a green ring while working, the job they're on underneath. */
    const people = ring.map(({ m, x, y }) => {
      const p = ctx.person(m.name)
      const working = p?.status === 'working'
      const job = p?.job
      const bg = (state.tasks ?? []).filter(t => t.status === 'running' && nameOf(t.by) === m.name)
      return `<g class="person" data-name="${esc(m.name)}" transform="translate(${x},${y})"><title>${esc(`${m.name} · ${ctx.roleOf(m)}${working && job ? `\n${job.activity}` : ''}${bg.map(t => `\n⟳ ${t.label}`).join('')}`)}</title>
        ${working ? '<circle r="23" class="halo"><animate attributeName="r" values="21;25;21" dur="2s" repeatCount="indefinite"/></circle>' : ''}
        <circle r="18" fill="${ctx.colourOf(m)}" class="face${working ? ' on' : ''}"/>
        <text class="initial" y="5" text-anchor="middle">${esc(m.name.slice(0, 1).toUpperCase())}</text>
        ${bg.length ? `<g class="bgbadge" transform="translate(15,-15)"><circle r="8.5"/><text y="3.5" text-anchor="middle">${bg.length}</text></g>` : ''}
        <text class="nm" y="33" text-anchor="middle">${esc(m.name)}</text>
        <text class="role" y="45" text-anchor="middle">${esc(clip(working && job ? job.activity : ctx.roleOf(m), 26))}</text></g>`
    }).join('')

    const lastQ = recent.at(-1)
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="brain-svg" role="img" aria-label="The code-index brain and the team around it">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>
      ${brainBody()}
      <circle cx="${CX + 3}" cy="${CY - 5}" r="${recent.length ? 19 : 16}" class="core${lastQ && now - lastQ.at < FRESH ? ' live' : ''}">${lastQ && now - lastQ.at < FRESH ? '<animate attributeName="r" values="17;22;17" dur="1.2s" repeatCount="indefinite"/>' : ''}</circle>
      <text x="${CX + 3}" y="${CY - 2}" text-anchor="middle" class="core-label">INDEX</text>
      ${handoffs}${links}${regionNodes}${people}
      <g class="person" data-name="You" transform="translate(${you.x},${you.y})"><circle r="13" class="you"/><text class="initial small" y="4" text-anchor="middle">You</text></g>
    </svg>`

    /* The workflow: every job this session in the order it began, nested under whoever handed it over. */
    const jobs = agents.filter(a => a.id !== 'main').sort((a, b) => a.startedAt - b.startedAt).slice(-30)
    const depth = a => {
      let d = 0
      for (let p = a; p?.parent && p.parent !== 'main' && p.parent !== 'owner' && d < 4; p = state.agents?.[`${p.sessionId}:${p.parent}`]) d++
      return d
    }
    const regionsOf = a => [...new Set((state.queries ?? []).filter(q => q.by === `${a.sessionId}:${a.id}`).flatMap(q => q.areas))]
    const rows = jobs.map(a => {
      const parent = a.parent === 'owner' ? 'You' : state.agents?.[`${a.sessionId}:${a.parent ?? 'main'}`]?.name ?? 'Wren'
      const liveNow = ctx.isLive(a)
      const took = ago(now - ((a.isDone ? a.lastAt : now) - a.startedAt))
      return `<div class="flow-row${liveNow ? ' live' : ''}" style="--depth:${depth(a)}" data-name="${esc(a.name)}">
        <span class="flow-time">${ago(a.startedAt)} ago</span>
        <span class="flow-who"><b>${esc(parent)}</b> → <b style="color:${ctx.colourOf({ kind: a.kind, name: a.name })}">${esc(a.name)}</b> <span class="muted">${esc(ctx.roleOf({ kind: a.kind }))}</span></span>
        <span class="flow-what">${esc(clip(a.description || a.activity, 80))}</span>
        <span class="flow-meta">${liveNow ? `<span class="dot working"></span> ${esc(clip(a.activity, 50))}` : `done in ${took}`} · ${a.stepCount ?? 0} steps${regionsOf(a).map(r => `<span class="chip">${esc(r)}</span>`).join('')}</span>
      </div>`
    }).reverse().join('')

    const searches = (state.queries ?? []).slice(-6).reverse().map(q => `<div class="flow-q"><span class="flow-time">${ago(q.at)} ago</span> <b>${esc(nameOf(q.by) ?? 'Someone')}</b> ${esc(q.tool)} “${esc(clip(q.ask, 50))}” → ${q.files.length} file${q.files.length === 1 ? '' : 's'}${q.areas.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>`).join('')

    /* Work left running in the background: what's running now, then what has ended and how. */
    const tasks = state.tasks ?? []
    const running = tasks.filter(t => t.status === 'running')
    const ended = tasks.filter(t => t.status !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 8)
    const KIND = { shell: 'Command', monitor: 'Monitor', agent: 'Background agent', workflow: 'Workflow', task: 'Task' }
    const OUTCOME = { completed: ['done', 'ok'], failed: ['failed', 'bad'], stopped: ['stopped', 'off'], finished: ['ended', 'off'] }
    const taskRow = t => {
      const who = nameOf(t.by) ?? 'Someone'
      const [word, tone] = OUTCOME[t.status] ?? ['running', 'run']
      return `<div class="task-row ${tone}" data-name="${esc(who)}">
        <span class="task-state">${t.status === 'running' ? '<span class="spin"></span>' : `<span class="pill ${tone}">${word}</span>`}</span>
        <span class="flow-who"><b>${esc(clip(t.label, 70))}</b> <span class="muted">${esc(KIND[t.kind] ?? t.kind)} · started by ${esc(who)}${t.project && state.sessions?.length > 1 ? ` (${esc(t.project)})` : ''}</span></span>
        ${t.command && t.command !== t.label ? `<code>${esc(clip(t.command, 110))}</code>` : ''}
        <span class="flow-meta">${t.status === 'running' ? `running for ${ago(t.startedAt)}` : `ran ${ago(now - ((t.endedAt ?? now) - t.startedAt))}, ended ${ago(t.endedAt ?? now)} ago`}${t.summary ? ` · ${esc(clip(t.summary, 100))}` : ''}</span>
      </div>`
    }
    const background = [...running, ...ended].map(taskRow).join('')

    const html = `${svg}
      <div class="brain-legend"><span><i class="lg-link"></i> searched a region</span><span><i class="lg-hand"></i> handed a job</span><span><span class="dot working"></span> working now</span><span><b class="bglegend">1</b> background tasks</span></div>
      <h3>Background tasks</h3>${background || '<div class="empty">Nothing running in the background. Commands and monitors left running show here, with who started them.</div>'}
      <h3>Workflow</h3>${rows || '<div class="empty">No jobs yet this session. When Wren briefs someone, the hand-off shows here.</div>'}
      <h3>Recent searches</h3>${searches || '<div class="empty">No code-index searches yet. Each one lights the regions it found files in.</div>'}`
    /* Redraw only when something changed, so the SVG's animations keep running smoothly. */
    const key = html.replace(/\d+[smh] ago|done in \d+[smh]|running for \d+[smh]|ran \d+[smh]/g, '')
    if (key === drawn) return
    drawn = key
    el.innerHTML = html
  }

  el.addEventListener('click', e => {
    const name = e.target.closest('[data-name]')?.dataset.name
    if (name) ctx.open(name)
  })
  return { render }
}

/* ── The hologram above the office ─────────────────────────────────────── */

/**
 * A translucent brain floating above the middle of the office, turning
 * slowly. A thin beam joins it to everyone at work; when someone searches
 * the index, their beam brightens and a spark runs up it. One mesh of lines
 * and one instanced mesh of sparks, so it costs a handful of draw calls.
 */
export const hologram = () => {
  const group = new THREE.Group()
  group.position.set(0, 5.2, 0.5)
  const shell = new THREE.MeshPhysicalMaterial({ color: '#a78bfa', emissive: '#7c3aed', emissiveIntensity: 0.55, roughness: 0.3, transparent: true, opacity: 0.32, depthWrite: false })
  const wire = new THREE.MeshBasicMaterial({ color: '#c4b5fd', wireframe: true, transparent: true, opacity: 0.25, depthWrite: false })
  const brain = new THREE.Group()
  for (const [dx, dy, r] of LOBES) {
    const g = new THREE.SphereGeometry(r / 100, 18, 12)
    const lobe = new THREE.Mesh(g, shell)
    lobe.position.set(dx / 100, -dy / 100, (r - 60) / 200)
    const mesh = new THREE.Mesh(g, wire)
    mesh.position.copy(lobe.position)
    brain.add(lobe, mesh)
  }
  brain.scale.setScalar(0.9)
  group.add(brain)
  const coreMat = new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.9 })
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), coreMat)
  group.add(core)
  /* An invisible ball to click, which opens the Brain panel. */
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ visible: false }))
  group.add(hit)

  /* Beams are thin glowing tubes (a WebGL line is only ever a pixel wide), one instance each. */
  const MAX = 12
  const lines = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), MAX)
  lines.frustumCulled = false
  const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX)
  sparks.frustumCulled = false
  const root = new THREE.Group()
  root.add(group, lines, sparks)

  const head = new THREE.Vector3()
  const top = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const turn = new THREE.Quaternion()
  const c = new THREE.Color()
  const m = new THREE.Matrix4()

  /** `links`: [{ person, colour, fresh }] — everyone at work, `fresh` while their last search is new. */
  const update = (t, links) => {
    brain.rotation.y = t * 0.15
    const busy = links.some(l => l.fresh)
    core.scale.setScalar(busy ? 1.2 + Math.sin(t * 8) * 0.2 : 0.8)
    coreMat.color.set(busy ? '#facc15' : '#c4b5fd')
    group.updateMatrixWorld()
    group.getWorldPosition(top)
    top.y -= 0.6
    let n = 0
    for (const { person, colour, fresh } of links.slice(0, MAX)) {
      person.head.getWorldPosition(head)
      head.y += 0.25
      dir.subVectors(top, head)
      const r = fresh ? 0.06 + Math.sin(t * 10) * 0.012 : 0.028
      lines.setMatrixAt(n, m.compose(head, turn.setFromUnitVectors(up, dir.clone().normalize()), dir.set(r, dir.length(), r)))
      lines.setColorAt(n, c.set(colour).multiplyScalar(fresh ? 1.4 : 0.8))
      dir.subVectors(top, head)
      /* A spark runs up a fresh beam, from the person to the brain. */
      const u = fresh ? (t * 0.8 + n * 0.37) % 1 : -1
      m.makeTranslation(head.x + dir.x * u, head.y + dir.y * u, head.z + dir.z * u)
      if (u < 0) m.makeScale(0, 0, 0)
      sparks.setMatrixAt(n, m)
      n++
    }
    for (let i = n; i < MAX; i++) {
      lines.setMatrixAt(i, m.makeScale(0, 0, 0))
      sparks.setMatrixAt(i, m.makeScale(0, 0, 0))
    }
    lines.instanceMatrix.needsUpdate = sparks.instanceMatrix.needsUpdate = true
    if (lines.instanceColor) lines.instanceColor.needsUpdate = true
  }
  return { root, hit, update }
}
