import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, BgTask, BrainQuery, KindInfo, Notice, PendingSpawn, SessionInfo, TeamMember } from '../types'

/*
 * Two views of the session's team.
 *
 * The Brain, a pane docked beside the chat: the code index drawn as a brain,
 * its regions lighting up as searches find files there.
 *
 * The Office, a 3D building in the Browser pane (office/), where the team —
 * ten named people, one for each of the most used agent types plus a
 * receptionist and a floater, who between them take every job — works at
 * desks and lives between tasks. This module feeds it: it
 * keeps the team's state, writes it to a file the office's local server
 * reads, keeps the roster the owner edits there, and delivers the messages
 * the owner sends from it.
 *
 * Everything shown is observed, never guessed: an agent's activity is the
 * last tool it called, its model is what the Agent call asked for, and the
 * brain's signals are the files the index actually returned.
 */

const PANE = 'agent-office'
const OFFICE_URL = 'http://127.0.0.1:4477'
const agentsAtom = atom({ plugin: 'agent-office', key: 'agents' } as const, {} as Record<string, Agent>)
const queriesAtom = atom({ plugin: 'agent-office', key: 'queries' } as const, [] as BrainQuery[])
const pendingAtom = atom({ plugin: 'agent-office', key: 'pending' } as const, [] as PendingSpawn[])
const teamAtom = atom({ plugin: 'agent-office', key: 'team' } as const, [] as TeamMember[])
const kindsAtom = atom({ plugin: 'agent-office', key: 'kinds' } as const, [] as KindInfo[])
const noticesAtom = atom({ plugin: 'agent-office', key: 'notices' } as const, [] as Notice[])
const outboxAtom = atom({ plugin: 'agent-office', key: 'outbox' } as const, 0)
const sessionAtom = atom({ plugin: 'agent-office', key: 'session' } as const, { id: null, transcript: null } as SessionInfo)
const tickAtom = atom({ plugin: 'agent-office', key: 'tick' } as const, 0)
const tasksAtom = atom({ plugin: 'agent-office', key: 'tasks' } as const, {} as Record<string, BgTask>)

const MAIN = 'main'
/** Quiet this long and an agent goes on a break; it comes back with its next tool call. */
const BREAK_AFTER_MS = 25_000
const DESKS = 8
/** The office holds this many people besides the owner. Extra jobs go to someone already there, never to a new body. */
const TEAM_SIZE = 10

/* ── Names and roles ───────────────────────────────────────────────────── */

/* Each role draws from its own names, so the first letter hints at the job. */
const NAMES: Record<string, string[]> = {
  planner: ['Paige', 'Priya', 'Pablo', 'Petra'],
  developer: ['Diego', 'Dana', 'Devi', 'Dmitri'],
  qa: ['Quinn', 'Kai', 'Tess', 'Kira'],
  'test-runner': ['Rowan', 'Rhea', 'Rui'],
  'test-verifier': ['Vera', 'Val', 'Vik'],
  Explore: ['Ezra', 'Elle', 'Emil'],
  Plan: ['Ada', 'Pip'],
  'general-purpose': ['Gus', 'Gia'],
  'claude-code-guide': ['Cleo', 'Cal'],
  'statusline-setup': ['Stan', 'Suki'],
  claude: ['Clyde', 'Claire'],
  'impeccable-asset-producer': ['Iris', 'Ike'],
  'impeccable-documenter': ['Imani', 'Ian'],
  'impeccable-finish-reviewer': ['Ivo', 'Ina'],
  'impeccable-manual-edit-applier': ['Ines', 'Isak'],
}
const SPARE_NAMES = ['Max', 'Noor', 'Sam', 'Lea', 'Omar', 'Ivy', 'Theo', 'Mia', 'Jude', 'Ren']

const pickName = (kind: string, taken: Set<string>) => {
  const pool = [...(NAMES[kind] ?? []), ...SPARE_NAMES]
  const free = pool.find(n => !taken.has(n))
  if (free) return free
  let n = 2
  while (taken.has(`${pool[0]} ${n}`)) n++
  return `${pool[0]} ${n}`
}

const ROLE_WORDS: Record<string, string> = {
  coordinator: 'Coordinator', planner: 'Planner', developer: 'Developer', qa: 'QA',
  'test-runner': 'Test runner', 'test-verifier': 'Verifier', Explore: 'Explorer', Plan: 'Architect',
  'general-purpose': 'Generalist', 'claude-code-guide': 'Guide', 'statusline-setup': 'Status line', claude: 'Helper',
  'impeccable-asset-producer': 'Asset maker', 'impeccable-documenter': 'Documenter',
  'impeccable-finish-reviewer': 'Design reviewer', 'impeccable-manual-edit-applier': 'Copy editor',
}
const roleOf = (kind: string) => ROLE_WORDS[kind] ?? kind.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase())
const ROLE_COLOUR: Record<string, string> = {
  coordinator: '#F5B301', planner: '#2F6FED', developer: '#16A34A', qa: '#334155',
  'test-runner': '#7C3AED', 'test-verifier': '#DB2777', Explore: '#0891B2', Plan: '#3B82F6',
}
const colourOf = (kind: string) => ROLE_COLOUR[kind] ?? '#64748B'

/* What the built-in agent types are for; the person's own agents say it in their files. */
const BUILT_IN_DUTIES: Record<string, string> = {
  'general-purpose': 'Researches questions, searches the code and carries out multi-step tasks.',
  Explore: 'Sweeps the codebase to find where things live, and reports back.',
  Plan: 'Designs how a change should be built and weighs the trade-offs.',
  'claude-code-guide': 'Answers questions about Claude Code, the Agent SDK and the API.',
  'statusline-setup': 'Sets up the Claude Code status line.',
  claude: 'The catch-all helper for anything without a better fit.',
}

/* ── Words ─────────────────────────────────────────────────────────────── */

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const firstLine = (v: unknown) => String(v ?? '').split('\n')[0]!.trim()
const tail = (path: unknown) => String(path ?? '').split('/').slice(-2).join('/')

/** A tool call as a person would say it. */
const describe = (e: Record<string, unknown>): string => {
  const tool = String(e.tool)
  const pick = (...keys: string[]) => keys.map(k => e[k]).find(v => typeof v === 'string' && v) as string | undefined
  if (tool === 'Bash') return `Running: ${clip(firstLine(pick('description', 'command')), 70)}`
  if (tool === 'Read') return `Reading ${clip(tail(pick('file_path')), 60)}`
  if (tool === 'Edit' || tool === 'Write') return `Editing ${clip(tail(pick('file_path')), 60)}`
  if (tool === 'Agent') return `Briefing a ${roleOf(pick('subagent_type') ?? 'helper')}: ${clip(firstLine(pick('description')), 50)}`
  if (tool.startsWith('mcp__shiftwren__')) return `Asking the brain (${tool.replace('mcp__shiftwren__', '')}): ${clip(firstLine(pick('query', 'name', 'table', 'pattern', 'path') ?? ''), 50)}`
  if (tool.startsWith('mcp__Claude_Browser__')) return `In the browser: ${tool.replace('mcp__Claude_Browser__', '')}`
  if (tool.startsWith('mcp__')) return `Using ${tool.split('__').slice(1).join(' · ')}`
  return `Using ${tool}`
}

/* ── The brain's regions ───────────────────────────────────────────────── */

/** The codebase as regions of the brain, each placed on its surface. */
const REGIONS: { area: string; dx: number; dy: number }[] = [
  { area: 'Routes', dx: -112, dy: -18 },
  { area: 'Services', dx: -62, dy: -78 },
  { area: 'Database', dx: 6, dy: -96 },
  { area: 'HQ server', dx: 74, dy: -74 },
  { area: 'Backend', dx: 116, dy: -14 },
  { area: 'App', dx: -84, dy: 44 },
  { area: 'HQ', dx: -20, dy: 58 },
  { area: 'Staff', dx: 44, dy: 44 },
  { area: 'Marketing', dx: 100, dy: 52 },
  { area: 'Docs', dx: 104, dy: 104 },
]

const areaOf = (path: string): string => {
  if (path.startsWith('backend/src/routes')) return 'Routes'
  if (path.startsWith('backend/src/services')) return 'Services'
  if (path.startsWith('backend/src/db') || path.includes('schema.ts')) return 'Database'
  if (path.startsWith('backend/src/hq')) return 'HQ server'
  if (path.startsWith('backend')) return 'Backend'
  if (path.startsWith('shiftwren-app')) return 'App'
  if (path.startsWith('shiftwren-hq')) return 'HQ'
  if (path.startsWith('shiftwren-staff')) return 'Staff'
  if (path.startsWith('shiftwren-marketing')) return 'Marketing'
  return 'Docs'
}

const PATH_RE = /(?:[\w.\-]+\/)*?(?:backend|shiftwren-app|shiftwren-hq|shiftwren-staff|shiftwren-marketing|docs|tools)\/[\w.\-/[\]]+\.[a-z]{1,5}/g
const WORKTREE = /^.*?\.claude\/worktrees\/[^/]+\//

/** The files a search returned, and the regions they belong to. */
const brainHit = (tool: string, text: string) => {
  const files = [...new Set((text.match(PATH_RE) ?? []).map(f => f.replace(WORKTREE, '')))].slice(0, 40)
  const areas = new Set(files.map(areaOf))
  /* Some tools answer about a region without naming files. */
  if (tool.endsWith('db_table')) areas.add('Database')
  if (tool.endsWith('api_routes')) areas.add('Routes')
  return { files, areas: [...areas] }
}

/* ── Drawing the brain ─────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const W = 640
const H = 400
const CX = 300
const CY = 200
const CORE: [number, number] = [CX + 4, CY - 6]

/* A brain seen from the side, built of overlapping lobes: outlined once, filled on top, then folded. */
const LOBES: [number, number, number][] = [[-92, -14, 62], [-46, -66, 66], [24, -76, 66], [88, -40, 62], [108, 14, 46], [-82, 40, 46], [0, 6, 82]]
const brainBody = () => {
  const blob = (fill: string, stroke: string, w: number) =>
    LOBES.map(([dx, dy, r]) => `<circle cx="${CX + dx}" cy="${CY + dy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${w}"/>`).join('')
  const folds = [
    `M${CX - 140},${CY - 10} q30,-24 54,0 t50,-6`,
    `M${CX - 86},${CY - 92} q24,24 54,6 t54,12`,
    `M${CX + 8},${CY - 136} q-6,36 24,48 t18,42`,
    `M${CX + 70},${CY - 84} q30,12 30,42 t24,30`,
    `M${CX - 92},${CY + 56} q30,-18 60,0 t60,-12`,
    `M${CX - 40},${CY - 30} q20,14 44,4 t40,10`,
  ]
  return `
    <path d="M${CX + 54},${CY + 70} q12,40 -6,72 h30 q6,-40 18,-66Z" fill="#E9E3FB" stroke="#7C3AED" stroke-width="3"/>
    <ellipse cx="${CX + 98}" cy="${CY + 76}" rx="44" ry="28" fill="#E9E3FB" stroke="#7C3AED" stroke-width="3"/>
    <path d="M${CX + 64},${CY + 70} q34,8 66,0 M${CX + 66},${CY + 82} q30,6 58,0" fill="none" stroke="#C4B5FD" stroke-width="2"/>
    ${blob('#7C3AED', '#7C3AED', 6)}${blob('#F6F3FF', 'none', 0)}
    <path d="${folds.join(' ')}" fill="none" stroke="#D3C6FB" stroke-width="3" stroke-linecap="round"/>`
}

const brainSvg = (queries: BrainQuery[], agents: Record<string, Agent>, now: number) => {
  const recent = queries.filter(q => now - q.at < 120_000).slice(-8)
  const heat = new Map<string, number>()
  const filesBy = new Map<string, string[]>()
  for (const q of queries.slice(-25)) {
    for (const f of q.files) {
      const a = areaOf(f)
      const list = filesBy.get(a) ?? []
      if (!list.includes(f)) filesBy.set(a, [...list, f])
    }
  }
  for (const q of recent) for (const a of q.areas) heat.set(a, (heat.get(a) ?? 0) + 1)

  const regions = REGIONS.map(({ area, dx, dy }) => {
    const [x, y] = [CX + dx, CY + dy]
    const hot = heat.get(area) ?? 0
    const files = (filesBy.get(area) ?? []).slice(-5).reverse()
    const lines = files.length ? files.map(f => clip(f, 44)) : ['No files found here yet']
    const cardW = 250
    const cardH = 30 + lines.length * 16
    const cx = Math.min(Math.max(x - cardW / 2, 8), W - cardW - 8)
    const cy = y > CY ? y - cardH - 22 : y + 22
    return `<g class="region">
      <circle cx="${x}" cy="${y}" r="30" fill="transparent"/>
      <circle cx="${x}" cy="${y}" r="${hot ? 15 : 10}" fill="${hot ? '#8B5CF6' : '#E4DBFD'}" stroke="#7C3AED" stroke-width="2">${hot ? '<animate attributeName="r" values="13;18;13" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>
      ${hot ? `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#A78BFA" stroke-width="2"><animate attributeName="r" values="15;34" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.8s" repeatCount="indefinite"/></circle>` : ''}
      <text x="${x}" y="${y - (hot ? 22 : 17)}" text-anchor="middle" class="lab${hot ? ' on' : ''}">${area}</text>
      <g class="card" transform="translate(${cx},${cy})">
        <rect width="${cardW}" height="${cardH}" rx="10" fill="#111827" opacity=".95"/>
        <text x="12" y="20" class="ch">${area} · ${(filesBy.get(area) ?? []).length} file${(filesBy.get(area) ?? []).length === 1 ? '' : 's'} found</text>
        ${lines.map((l, i) => `<text x="12" y="${38 + i * 16}" class="cl">${esc(l)}</text>`).join('')}
      </g>
    </g>`
  }).join('')

  /* Neurons firing: from each region a search touched, inward to the index at the centre, in the asker's colour. */
  const signals = recent.flatMap((q, qi) => q.areas.map((area, ai) => {
    const r = REGIONS.find(x => x.area === area)
    if (!r) return ''
    const [x, y] = [CX + r.dx, CY + r.dy]
    const bend = `M${x},${y} Q${(x + CORE[0]) / 2 + (y - CORE[1]) * 0.25},${(y + CORE[1]) / 2 - (x - CORE[0]) * 0.25} ${CORE[0]},${CORE[1]}`
    const colour = colourOf(agents[q.by]?.kind ?? 'coordinator')
    return `<path d="${bend}" fill="none" stroke="${colour}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="4 6"/>
      <circle r="5" fill="${colour}" stroke="#fff" stroke-width="1.5"><animateMotion dur="1.5s" begin="-${(qi * 0.4 + ai * 0.2).toFixed(2)}s" repeatCount="indefinite" path="${bend}"/></circle>`
  })).join('')

  const last = recent.at(-1)
  const who = last ? agents[last.by]?.name ?? 'Someone' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, -apple-system, Segoe UI, sans-serif">
  <style>
    .region .card{opacity:0;transition:opacity .15s;pointer-events:none}.region:hover .card{opacity:1}
    .lab{font-size:12px;font-weight:600;fill:#6D28D9}.lab.on{fill:#4C1D95;font-weight:700}
    .ch{font-size:12.5px;font-weight:700;fill:#fff}.cl{font-size:11.5px;fill:#D1D5DB;font-family:ui-monospace,Menlo,monospace}
    .ask{font-size:13px;fill:#4C1D95;font-weight:600}.sub{font-size:11.5px;fill:#7C6AA8}
  </style>
  <rect width="${W}" height="${H}" rx="16" fill="#FBFAFF"/>
  ${brainBody()}
  ${signals}
  <circle cx="${CORE[0]}" cy="${CORE[1]}" r="${recent.length ? 24 : 21}" fill="${recent.length ? '#FACC15' : '#EDE4FF'}" stroke="#7C3AED" stroke-width="2">${recent.length ? '<animate attributeName="r" values="22;27;22" dur="1.2s" repeatCount="indefinite"/>' : ''}</circle>
  <text x="${CORE[0]}" y="${CORE[1] + 3}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#4C1D95">INDEX</text>
  ${regions}
  <text x="${W / 2}" y="${H - 34}" text-anchor="middle" class="ask">${last ? esc(clip(`${who} asked “${last.ask}”`, 70)) : 'Waiting for the first code-index search'}</text>
  <text x="${W / 2}" y="${H - 15}" text-anchor="middle" class="sub">${last ? esc(clip(`${last.tool} → ${last.files.length} file${last.files.length === 1 ? '' : 's'} in ${last.areas.join(', ') || 'no region'} · hover a region for its files`, 90)) : 'Each search lights the regions where it found files'}</text>
</svg>`
}

/* ── Feeding the office ────────────────────────────────────────────────── */

const officeDir = async ($: EngineInterface) => `${(await $.env.get('HOME')) ?? ''}/.claude/agent-office`

/** Writes the team to the file the office reads; a missed write only delays the office a moment. */
async function publish($: EngineInterface) {
  try {
    const session = await read($, sessionAtom)
    const body = {
      session,
      breakAfterMs: BREAK_AFTER_MS,
      updatedAt: await $.clock.now(),
      team: { members: await read($, teamAtom) },
      kinds: await read($, kindsAtom),
      notices: await read($, noticesAtom),
      agents: await read($, agentsAtom),
      queries: (await read($, queriesAtom)).slice(-20),
      tasks: Object.values(await read($, tasksAtom)).sort((a, b) => a.startedAt - b.startedAt).slice(-30),
      /* The brain's regions, so the office can draw the same brain. */
      brain: { regions: REGIONS },
    }
    await $.fs.write(`${await officeDir($)}/sessions/${session.id ?? 'current'}.json`, JSON.stringify(body))
  } catch {
    /* the office keeps the last picture it had */
  }
}

async function notify($: EngineInterface, text: string) {
  const at = await $.clock.now()
  await update($, noticesAtom, list => [...list, { at, text }].slice(-10))
  void publish($)
}

/** Starts the office's server unless one is already answering; a second copy would only exit. */
async function ensureServer($: EngineInterface) {
  try {
    const { ok } = await $.http.fetch(`${OFFICE_URL}/api/health`)
    if (ok) return
  } catch {
    /* nobody answering: start one */
  }
  void (async () => {
    try {
      for await (const _ of $.process.spawn({ argv: ['node', `${$.plugin.root}/office/server.mjs`] })) void _
    } catch {
      /* no node on the path: the Brain still works, the office does not */
    }
  })()
}

/**
 * Opens the office in the default browser when a session starts — unless a
 * page already shows it, or another session just opened one. Waits up to
 * fifteen seconds for the server this session may have just started.
 */
async function openOffice($: EngineInterface) {
  const dir = await officeDir($)
  for (let i = 0; i < 15; i++) {
    const token = String(await $.fs.read(`${dir}/token`).catch(() => '')).trim()
    const res = token
      ? await $.http.fetch(`${OFFICE_URL}/api/should-open`, { method: 'POST', headers: { 'x-office-token': token, 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
      : null
    if (res?.ok) {
      if (!(JSON.parse(res.text) as { open: boolean }).open) return
      /* macOS has `open`; Linux desktops have `xdg-open`. */
      for (const argv of [['open', OFFICE_URL], ['xdg-open', OFFICE_URL]]) {
        const ran = await $.process.run(argv).catch(() => null)
        if (ran?.exitCode === 0) return
      }
      return
    }
    await $.clock.sleep(1_000)
  }
}

/** What hook events say about the session: its id, and the main conversation's transcript. */
async function noteSession($: EngineInterface, e: { session_id?: string; transcript_path?: string }) {
  if (!e.session_id) return
  const before = await read($, sessionAtom)
  if (before.id === e.session_id && before.transcript === (e.transcript_path ?? null)) return
  await update($, sessionAtom, was => ({ ...was, id: e.session_id!, transcript: e.transcript_path ?? null }))
  await update($, agentsAtom, all => (all[MAIN] ? { ...all, [MAIN]: { ...all[MAIN]!, transcript: e.transcript_path ?? null } } : all))
}

/** A project's everyday name: the folder it lives in, seen past any worktree inside it. */
const projectName = (cwd: string) => {
  const root = cwd.split('/.claude/worktrees/')[0] ?? cwd
  return root.split('/').filter(Boolean).at(-1) ?? 'Project'
}

/* A session that hasn't written for this long has closed. */
const ACTIVE_MS = 3 * 60_000

/**
 * Who has a job in another open session right now, once per job. The roster
 * is shared by every session, so someone busy there is busy here too.
 */
async function busyElsewhere($: EngineInterface) {
  const names: string[] = []
  const dir = `${await officeDir($)}/sessions`
  const mine = (await read($, sessionAtom)).id
  const now = await $.clock.now()
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (!f.name.endsWith('.json') || f.name === `${mine}.json`) continue
    try {
      const other = JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))) as { updatedAt?: number; agents?: Record<string, Agent> }
      if (!other.updatedAt || now - other.updatedAt > ACTIVE_MS) continue
      for (const a of Object.values(other.agents ?? {})) if (a.id !== MAIN && !a.isDone) names.push(a.name)
    } catch {
      /* a file mid-write: try again next time */
    }
  }
  return names
}

/* ── The team roster ───────────────────────────────────────────────────── */

/* The agent types every session has, before the person's own. */
const BUILT_IN = ['general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'claude']
/* The loop team first, so they sit together; everyone else after, in name order. */
const FIRST = ['planner', 'developer', 'qa', 'test-runner', 'test-verifier', 'Explore', 'general-purpose', 'Plan', 'claude-code-guide']
/* Who gets a desk on a fresh roster, most used first; the rest of the types are covered by whoever is free. */
const STAFFED = FIRST

/** Every agent type there is — built in, the person's own, the project's — with what each is for. */
async function loadKinds($: EngineInterface, cwd: string) {
  const kinds = new Map<string, string>(BUILT_IN.map(k => [k, BUILT_IN_DUTIES[k]!]))
  const home = await $.env.get('HOME').catch(() => undefined)
  for (const dir of [home && `${home}/.claude/agents`, `${cwd}/.claude/agents`]) {
    if (!dir) continue
    const entries = await $.fs.list(dir).catch(() => [])
    for (const f of entries) {
      if (f.kind === 'dir' || !f.name.endsWith('.md')) continue
      const text = await $.fs.read(`${dir}/${f.name}`).catch(() => '')
      const said = /^description:\s*["']?(.+?)["']?\s*$/m.exec(typeof text === 'string' ? text : '')?.[1] ?? ''
      kinds.set(f.name.slice(0, -3), clip(said.replace(/\\n/g, ' '), 180))
    }
  }
  const ordered = [...FIRST.filter(k => kinds.has(k)), ...[...kinds.keys()].filter(k => !FIRST.includes(k)).sort()]
  await update($, kindsAtom, () => ordered.map(kind => ({ kind, label: roleOf(kind), duties: kinds.get(kind) ?? '' })))
  return ordered
}

/**
 * The roster the owner edits in the office: ten people. Wren, a person for
 * each of the most used agent types, a receptionist and one floater; types
 * without a person of their own are picked up by whoever is free. Written
 * once; after that the owner's file is the truth, and this only reads it back.
 */
async function loadTeam($: EngineInterface, kinds: string[]) {
  const file = `${await officeDir($)}/team.json`
  let text = await $.fs.read(file).catch(() => '')
  if (typeof text !== 'string' || !text.trim()) {
    const taken = new Set(['Wren', 'Rae', 'Max'])
    const members: TeamMember[] = [{ id: 'coordinator', name: 'Wren', kind: 'coordinator', title: null }]
    /* Wren, Rae and at least one floater are always there; the rest of the places go to roles. */
    for (const kind of STAFFED.filter(k => kinds.includes(k)).slice(0, TEAM_SIZE - 3)) {
      const name = pickName(kind, taken)
      taken.add(name)
      members.push({ id: `k-${kind}`, name, kind, title: null })
    }
    members.push({ id: 'f-rae', name: 'Rae', kind: null, title: 'Reception' })
    for (const name of ['Max', ...SPARE_NAMES.filter(n => !taken.has(n))]) {
      if (members.length >= TEAM_SIZE) break
      members.push({ id: `f-${name.toLowerCase()}`, name, kind: null, title: null })
    }
    text = JSON.stringify({ members }, null, 2)
    await $.fs.write(file, text)
  }
  await applyTeam($, text)
}

/**
 * Who takes a new job. Whoever the owner asked; else the free person for
 * that role; else a free floater; else anyone free (the receptionist last).
 * With everyone busy, the person with the fewest jobs takes one more — the
 * role's own person when it's a tie. Only an empty roster falls back to a
 * newcomer, so the office never grows extra bodies.
 */
const chooseMember = (team: TeamMember[], kind: string, load: Map<string, number>, asked?: string) => {
  const byAsk = asked ? team.find(m => m.id === asked) : undefined
  if (byAsk) return byAsk
  const helpers = team.filter(m => m.kind !== 'coordinator')
  const jobs = (m: TeamMember) => load.get(m.name) ?? 0
  const reception = (m: TeamMember) => !m.kind && /recep/i.test(m.title ?? '')
  const free = helpers.filter(m => jobs(m) === 0)
  const firstFree = free.find(m => m.kind === kind) ?? free.find(m => !m.kind && !reception(m)) ?? free.find(m => !reception(m)) ?? free[0]
  if (firstFree) return firstFree
  return [...helpers].sort((a, b) => jobs(a) - jobs(b) || Number(b.kind === kind) - Number(a.kind === kind) || Number(reception(a)) - Number(reception(b)))[0]
}

let lastTeamText = ''
/** Takes up an edited roster: renamed people keep their jobs, and the coordinator's name is the main conversation's. */
async function applyTeam($: EngineInterface, text: string) {
  if (text === lastTeamText) return
  let members: TeamMember[]
  try {
    members = (JSON.parse(text) as { members: TeamMember[] }).members ?? []
  } catch {
    return
  }
  lastTeamText = text
  await update($, teamAtom, () => members)
  const byId = new Map(members.map(m => [m.id, m]))
  const coordinator = members.find(m => m.kind === 'coordinator')
  await update($, agentsAtom, all => {
    const next: Record<string, Agent> = {}
    for (const [id, a] of Object.entries(all)) {
      const m = a.memberId ? byId.get(a.memberId) : undefined
      next[id] = id === MAIN && coordinator ? { ...a, name: coordinator.name, memberId: coordinator.id } : m ? { ...a, name: m.name } : a
    }
    return next
  })
  void publish($)
}

/* ── Background tasks ──────────────────────────────────────────────────── */

/** A tool result as text, whichever way the tool returned it. */
const resultText = (ran: object) => ('text' in ran && typeof ran.text === 'string' ? ran.text : 'result' in ran ? JSON.stringify(ran.result ?? '') : '')

type RunningTask = { id: string; type: string; status: string; description: string; command?: string; agent_type?: string; name?: string; tool?: string }

/**
 * The engine's list of work still running, from a Stop or SubagentStop:
 * anything listed is running (and anything new to the office is added);
 * anything the office thought was running but isn't listed has finished.
 */
async function reconcileTasks($: EngineInterface, list: RunningTask[] | undefined) {
  if (!Array.isArray(list)) return
  const now = await $.clock.now()
  const seen = new Set(list.map(t => t.id))
  await update($, tasksAtom, all => {
    const next = { ...all }
    for (const t of list) {
      const was = next[t.id]
      next[t.id] = {
        id: t.id, by: was?.by ?? MAIN, startedAt: was?.startedAt ?? now, status: 'running',
        kind: was?.kind ?? (t.type === 'subagent' ? 'agent' : t.type),
        label: was?.label ?? clip(firstLine(t.description || t.command || t.name || t.agent_type || t.tool || t.type), 90),
        command: was?.command ?? (t.command ? clip(t.command, 300) : undefined),
      }
    }
    for (const t of Object.values(next)) if (t.status === 'running' && !seen.has(t.id)) next[t.id] = { ...t, status: 'finished', endedAt: now }
    return next
  })
  void publish($)
}

/** A task notification (`<task-id>`, `<status>`, `<summary>`) marks how that task ended. */
async function finishTask($: EngineInterface, text: string) {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
  if (!id) return
  const said = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim() ?? ''
  const status: BgTask['status'] = said === 'completed' ? 'completed' : said === 'failed' ? 'failed' : /kill|stop|cancel/.test(said) ? 'stopped' : 'finished'
  const summary = clip(firstLine(/<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] ?? ''), 160)
  const now = await $.clock.now()
  await update($, tasksAtom, all => {
    const was = all[id]
    return { ...all, [id]: { id, kind: was?.kind ?? 'task', label: was?.label ?? (summary || id), command: was?.command, by: was?.by ?? MAIN, startedAt: was?.startedAt ?? now, status, endedAt: now, summary } }
  })
  void publish($)
}

/* ── Messages from the office ──────────────────────────────────────────── */

type OfficeMessage = { seq: number; to: string; text: string; session?: string | null }

/** Collects what the owner sent from the office for this session, each message once. */
async function collectMessages($: EngineInterface) {
  const dir = await officeDir($)
  const token = String(await $.fs.read(`${dir}/token`).catch(() => '')).trim()
  if (!token) return
  const after = await read($, outboxAtom)
  const res = await $.http.fetch(`${OFFICE_URL}/api/outbox?after=${after}`, { headers: { 'x-office-token': token } }).catch(() => null)
  if (!res?.ok) return
  const { messages, last } = JSON.parse(res.text) as { messages: OfficeMessage[]; last: number }
  /* A restarted server numbers from 1 again; then everything it holds is new. */
  const fresh = last < after ? messages : messages.filter(m => m.seq > after)
  /* Mark them taken before acting, so a slow delivery can never run twice. */
  if (last !== after) await update($, outboxAtom, () => last)
  const session = (await read($, sessionAtom)).id
  for (const m of fresh) if (m.session && m.session === session) await deliver($, m)
}

/**
 * Wren gets it as the owner's next message. Someone mid-job hears it through
 * Wren, who can reach a running agent. Anyone free starts on it at once, as
 * an agent of their role; a floater as a generalist.
 */
async function deliver($: EngineInterface, m: OfficeMessage) {
  const team = await read($, teamAtom)
  const agents = await read($, agentsAtom)
  const main = agents[MAIN]
  const member = team.find(x => x.name === m.to)
  const live = Object.values(agents).find(a => a.name === m.to && a.id !== MAIN && !a.isDone)
  if (member?.kind === 'coordinator' || m.to === main?.name) {
    await $.prompt.submit({ text: m.text, asUser: true })
    return notify($, `${m.to} has your message — it's in the Claude chat`)
  }
  if (live) {
    await $.prompt.submit({
      text: `The owner sent this from the office for ${live.name}, the ${roleOf(live.kind)} working on "${live.description}" (agent ${live.id}):\n\n${m.text}\n\nPass it on to them with SendMessage; if that isn't possible, act on it yourself.`,
    })
    return notify($, `${main?.name ?? 'Wren'} is passing your message to ${live.name}`)
  }
  if (!member) return notify($, `Nobody called ${m.to} is in the office`)
  const kind = member.kind ?? 'general-purpose'
  const description = `${member.name}: ${clip(firstLine(m.text), 40)}`
  await update($, pendingAtom, list => [...list, { kind, model: null, description, at: Date.now(), name: member.name, memberId: member.id, by: 'owner' }].slice(-20))
  const started = await $.agent.spawn({ prompt: m.text, description, subagentType: kind }).catch((e: unknown) => ({ deny: String(e) }))
  if ('deny' in started && started.deny) {
    await update($, pendingAtom, list => list.filter(p => p.name !== member.name))
    return notify($, `${member.name} couldn't start: ${clip(String(started.deny), 80)}`)
  }
  return notify($, `${member.name} is on it`)
}

/* ── Hooks ─────────────────────────────────────────────────────────────── */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'brain', description: 'Open the Brain: how code-index searches find files, live' })
    await $.command.register({ name: 'office', description: 'Start the 3D agent office and show its address' })
    const now = await $.clock.now()
    await update($, sessionAtom, was => ({ ...was, cwd: e.cwd, project: projectName(e.cwd) }))
    await update($, agentsAtom, all => ({
      ...all,
      [MAIN]: all[MAIN] ?? {
        id: MAIN, name: 'Wren', memberId: 'coordinator', kind: 'coordinator', description: 'Runs this conversation and hands work to the team', model: null,
        isDone: false, activity: 'Ready', startedAt: now, lastAt: now, desk: 0, stepCount: 0, steps: [], transcript: null, transcriptGuesses: [],
      },
    }))
    try {
      await loadTeam($, await loadKinds($, e.cwd))
    } catch {
      /* the office shows whoever turns up */
    }
    /* Now and then: redraw the Brain, refresh the office, pick up roster edits and messages, keep the server up. */
    $.clock.every(10_000, () => {
      void update($, tickAtom, n => n + 1)
      void publish($)
    })
    $.clock.every(2_000, () => {
      void collectMessages($).catch(() => undefined)
      void (async () => applyTeam($, String(await $.fs.read(`${await officeDir($)}/team.json`))))().catch(() => undefined)
    })
    $.clock.every(30_000, () => void ensureServer($))
    void ensureServer($)
    void openOffice($).catch(() => undefined)
    void $.ui.open({ id: PANE, title: 'Brain' })
    void publish($)
    return started
  })

  on('command.run', { command: 'brain' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Brain' })
    return { text: 'Brain opened.' }
  })

  on('command.run', { command: 'office' }, async $ => {
    await ensureServer($)
    await publish($)
    return { text: `The 3D office is at ${OFFICE_URL} — ask Claude to open it in the Browser pane, or open it in any browser.` }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      await noteSession($, e)
      const now = await $.clock.now()
      await update($, agentsAtom, all => (all[MAIN] ? { ...all, [MAIN]: { ...all[MAIN]!, activity: 'Reading your message', lastAt: now, isWaiting: false } } : all))
      void publish($)
    } catch {
      /* a quieter office, never a blocked prompt */
    }
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    try {
      await noteSession($, e)
      const now = await $.clock.now()
      const pending = await read($, pendingAtom)
      const match = pending.find(p => p.kind === e.agent_type)
      if (match) await update($, pendingAtom, list => list.filter(p => p !== match))
      const folder = e.transcript_path ? e.transcript_path.replace(/\.jsonl$/, '') : null
      const team = await read($, teamAtom)
      const elsewhere = await busyElsewhere($).catch(() => [] as string[])
      await update($, agentsAtom, all => {
        /* Jobs each person already holds, here and in other open sessions. */
        const load = new Map<string, number>()
        for (const name of [...elsewhere, ...Object.values(all).filter(a => a.id !== MAIN && !a.isDone).map(a => a.name)]) load.set(name, (load.get(name) ?? 0) + 1)
        const member = chooseMember(team, e.agent_type, load, match?.memberId)
        const name = member?.name ?? pickName(e.agent_type, new Set(load.keys()))
        /* Someone already at work keeps their desk for the extra job. */
        const sameDesk = Object.values(all).find(a => !a.isDone && a.name === name)?.desk
        const used = new Set(Object.values(all).filter(a => !a.isDone).map(a => a.desk))
        const desk = sameDesk ?? [...Array(DESKS).keys()].find(d => !used.has(d)) ?? DESKS + used.size
        return {
          ...all,
          [e.agent_id]: {
            id: e.agent_id, name, memberId: member?.id, kind: e.agent_type,
            /* Who handed them the job: the conversation or agent that called Agent, or the owner from the office. */
            parent: match?.by ?? MAIN,
            description: match?.description ?? '', model: match?.model ?? null, isDone: false, activity: 'Getting started',
            startedAt: now, lastAt: now, desk, stepCount: 0, steps: [],
            transcript: null, transcriptGuesses: folder ? [`${folder}/subagents/agent-${e.agent_id}.jsonl`] : [],
          },
        }
      })
      void publish($)
    } catch {
      /* the new hire just won't show up in the office */
    }
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    try {
      await reconcileTasks($, e.background_tasks)
      const now = await $.clock.now()
      await update($, agentsAtom, all => (all[e.agent_id]
        ? { ...all, [e.agent_id]: { ...all[e.agent_id]!, isDone: true, activity: 'Finished', lastAt: now, transcript: e.agent_transcript_path || all[e.agent_id]!.transcript } }
        : all))
      void publish($)
    } catch {
      /* they'll look busy a little longer */
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    const who = e.agentId ?? MAIN
    const args = e as unknown as Record<string, unknown>
    /*
     * The office only watches. Its bookkeeping is kept apart from next(e) so a
     * slip in it can never stop, or repeat, the tool call itself.
     */
    try {
      const what = describe(args)
      if (e.tool === 'Agent') {
        const kind = String(args.subagent_type ?? 'general-purpose')
        const description = String(args.description ?? '')
        /* An office-started job is already waiting under its person's name. */
        await update($, pendingAtom, list => (list.some(p => p.kind === kind && p.description === description)
          ? list
          : [...list, { kind, model: typeof args.model === 'string' ? args.model : null, description, at: now, by: who }].slice(-20)))
      }
      await update($, agentsAtom, all => {
        const a = all[who]
        if (!a) return all
        return { ...all, [who]: { ...a, activity: what, lastAt: now, isWaiting: false, stepCount: a.stepCount + 1, steps: [...a.steps, { tool: e.tool, what, at: now }].slice(-30) } }
      })
      void publish($)
    } catch {
      /* a missed step is only a quieter office */
    }

    const ran = await next(e)

    /* A command or monitor left running in the background: note it under whoever started it, by the id the engine gave it. */
    if ((e.tool === 'Bash' && args.run_in_background) || e.tool === 'Monitor') {
      try {
        const id = /\bID:\s*([\w-]+)/i.exec(resultText(ran))?.[1] ?? e.tool_use_id ?? String(now)
        const label = clip(firstLine(args.description ?? args.command ?? args.prompt ?? e.tool), 90)
        await update($, tasksAtom, all => ({
          ...all,
          [id]: { id, kind: e.tool === 'Bash' ? 'shell' : 'monitor', label, command: e.tool === 'Bash' ? clip(String(args.command ?? ''), 300) : undefined, by: who, startedAt: now, status: 'running' },
        }))
        void publish($)
      } catch {
        /* the task runs regardless; the office just won't list it */
      }
    }
    if (e.tool === 'TaskStop' || e.tool === 'KillShell') {
      const id = String(args.task_id ?? args.shell_id ?? args.id ?? '')
      await update($, tasksAtom, all => (all[id] ? { ...all, [id]: { ...all[id]!, status: 'stopped', endedAt: now } } : all)).catch(() => undefined)
      void publish($)
    }

    if (e.tool.startsWith('mcp__shiftwren__')) {
      try {
        const text = resultText(ran)
        const { files, areas } = brainHit(e.tool, text)
        await update($, queriesAtom, list => [...list, {
          id: e.tool_use_id ?? String(now),
          tool: e.tool.replace('mcp__shiftwren__', ''),
          ask: clip(firstLine(args.query ?? args.name ?? args.table ?? args.pattern ?? args.path ?? ''), 60),
          areas, files, by: who, at: now,
        }].slice(-40))
        void publish($)
      } catch {
        /* a missed search is only a quieter brain */
      }
    }
    return ran
  })

  /* A background task's notification says how it ended. */
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      try {
        await finishTask($, e.text)
      } catch {
        /* the task list just stays a step behind */
      }
    }
    return next(e)
  })

  /* Each time the main conversation stops, the engine lists the work still running: take it as the truth. */
  on('classic.Stop', async ($, e, next) => {
    try {
      await reconcileTasks($, e.background_tasks)
    } catch {
      /* the next stop will catch up */
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    /* A subagent's turn ending is its own business; only the main conversation waits for the owner. */
    if (e.agentId) return next(e)
    try {
      const now = await $.clock.now()
      await update($, agentsAtom, all => (all[MAIN] ? { ...all, [MAIN]: { ...all[MAIN]!, activity: 'Waiting for you', lastAt: now, isWaiting: true } } : all))
      void publish($)
    } catch {
      /* Wren just stays at the desk */
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tickAtom)
    const now = await $.clock.now()
    const agents = await read($, agentsAtom)
    const queries = await read($, queriesAtom)
    const members = await read($, teamAtom)
    const { Box, Text } = $.ui.resolve(e)
    /* The terminal draws no vector art; it gets the words alone. */
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    const ago = (t: number) => { const s = Math.round((now - t) / 1000); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago` }
    const live = (a: Agent) => (a.id === MAIN ? !a.isWaiting : !a.isDone)
    /* Everyone on the team, with the job they're on now or did last. */
    const jobOf = (name: string) => Object.values(agents).filter(a => a.name === name).sort((a, b) => Number(live(b)) - Number(live(a)) || b.lastAt - a.lastAt)[0]
    const standIns = Object.values(agents).filter(a => live(a) && !members.some(m => m.name === a.name)).map(a => ({ name: a.name, kind: a.kind as string | null }))
    const team = [...members.map(m => ({ name: m.name, kind: m.kind })), ...standIns].map(m => ({ ...m, job: jobOf(m.name) }))

    return (
      <Box flexDirection="column" gap={1}>
        {Svg
          ? <Svg source={brainSvg(queries, agents, now)} alt={`The code-index brain: ${queries.length} searches this session`} isInteractive />
          : <Text dimColor>The brain drawing shows in the Claude desktop app.</Text>}
        <Text bold>Searches</Text>
        {queries.length === 0 ? <Text dimColor>No code-index searches yet this session.</Text> : null}
        {queries.slice(-6).reverse().map(q => (
          <Text key={`q-${q.id}`}>{ago(q.at)} · {agents[q.by]?.name ?? 'Someone'} · {q.tool} “{q.ask}” → {q.files.length} file{q.files.length === 1 ? '' : 's'}{q.areas.length ? ` (${q.areas.join(', ')})` : ''}</Text>
        ))}
        <Text bold>Team</Text>
        {team.map(m => (
          <Text key={`a-${m.name}`} dimColor={!(m.job && live(m.job))}>{m.name} · {m.kind ? roleOf(m.kind) : 'Floater'}{m.job?.model ? ` · ${m.job.model}` : ''} · {m.job && live(m.job) ? `working — ${clip(m.job.activity, 60)}` : 'between tasks'}</Text>
        ))}
        <Text dimColor>3D office: {OFFICE_URL} (run /office, then ask Claude to open it in the Browser pane)</Text>
      </Box>
    )
  })
}
