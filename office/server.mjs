// The 3D office's local server: serves the scene, the live state the mod
// writes, an agent's conversation read from its transcript, the team roster
// the owner edits, and the messages the owner sends to people in the office.
//
// Bound to 127.0.0.1 only. Reads only the state files under
// ~/.claude/agent-office and transcripts under ~/.claude/projects.
//
// Sending a message puts words in front of Claude, so every /api request must
// come from the office page itself: the right Host (no DNS rebinding), a
// same-origin Origin, a JSON body (a cross-site form can't send one without a
// preflight this server never answers), and the token baked into the page —
// which another site cannot read. The mod reads the same token from a file
// only this user can open.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, readdir, stat, open, writeFile, mkdir, chmod, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.AGENT_OFFICE_PORT ?? 4477)
const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = join(homedir(), '.claude', 'agent-office')
const STATE_DIR = join(HOME, 'sessions')
const TEAM_FILE = join(HOME, 'team.json')
const TOKEN_FILE = join(HOME, 'token')
const PROJECTS = join(homedir(), '.claude', 'projects')
/* A transcript can run to many megabytes; the drawer only shows its end. */
const TAIL_BYTES = 1_500_000
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

await mkdir(HOME, { recursive: true })
const TOKEN = randomBytes(24).toString('hex')

/* Messages wait here until the mod collects them; numbered so it never takes one twice. */
const outbox = []
let seq = 0

/*
 * Whether the office is already on screen somewhere. An open page asks for
 * state every second (about once a minute when its tab is in the background),
 * so a page seen within the last 70 s is still open. `opening` stops two
 * sessions that start together from both opening a tab.
 */
let pageSeenAt = 0
let openingAt = 0
const PAGE_GONE_MS = 70_000

/** The session most recently written, unless one is asked for by id. */
const latestState = async wanted => {
  const names = (await readdir(STATE_DIR).catch(() => [])).filter(n => n.endsWith('.json'))
  if (wanted && names.includes(`${wanted}.json`)) return JSON.parse(await readFile(join(STATE_DIR, `${wanted}.json`), 'utf8'))
  let best = null
  for (const n of names) {
    const s = await stat(join(STATE_DIR, n)).catch(() => null)
    if (s && (!best || s.mtimeMs > best.at)) best = { n, at: s.mtimeMs }
  }
  return best ? JSON.parse(await readFile(join(STATE_DIR, best.n), 'utf8')) : null
}

/* A session that hasn't written for this long has closed; after a week its file goes. */
const ACTIVE_MS = 3 * 60_000
const KEEP_MS = 7 * 24 * 60 * 60_000

/** Every open session, most recently busy first — the whole office across all of them. */
const openSessions = async () => {
  const out = []
  for (const n of (await readdir(STATE_DIR).catch(() => [])).filter(f => f.endsWith('.json'))) {
    const path = join(STATE_DIR, n)
    const s = await stat(path).catch(() => null)
    if (!s) continue
    if (Date.now() - s.mtimeMs > KEEP_MS) {
      await unlink(path).catch(() => undefined)
      continue
    }
    if (Date.now() - s.mtimeMs > ACTIVE_MS) continue
    const state = await readFile(path, 'utf8').then(JSON.parse).catch(() => null)
    if (state?.session?.id) out.push(state)
  }
  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

const tail = async path => {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const from = Math.max(0, size - TAIL_BYTES)
    const buf = Buffer.alloc(size - from)
    await fh.read(buf, 0, buf.length, from)
    const text = buf.toString('utf8')
    /* Starting mid-file, the first line is a fragment. */
    return (from > 0 ? text.slice(text.indexOf('\n') + 1) : text).split('\n').filter(Boolean)
  } finally {
    await fh.close()
  }
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A transcript as chat: what was said, and the tools used along the way. */
const conversation = lines => {
  const out = []
  for (const line of lines) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'user' && row.type !== 'assistant') continue
    const content = row.message?.content
    const at = row.timestamp ?? null
    if (typeof content === 'string') {
      if (content.trim() && !content.startsWith('<')) out.push({ role: row.type, text: clip(content.trim(), 4000), at })
      continue
    }
    if (!Array.isArray(content)) continue
    /* Tool results are the machinery, not the conversation. */
    if (row.type === 'user' && content.every(b => b.type === 'tool_result')) continue
    const text = content.filter(b => b.type === 'text' && b.text?.trim()).map(b => b.text.trim()).join('\n\n')
    const tools = content.filter(b => b.type === 'tool_use').map(b => b.name)
    if (text && !(row.type === 'user' && text.startsWith('<'))) out.push({ role: row.type, text: clip(text, 4000), at })
    /* A run of tool calls reads as one line of chips, not a line each. */
    if (tools.length && out.at(-1)?.role === 'tools') out.at(-1).tools.push(...tools)
    else if (tools.length) out.push({ role: 'tools', tools, at })
  }
  return out.slice(-120)
}

const insideProjects = p => {
  const full = resolve(p)
  return full.startsWith(PROJECTS + sep) && full.endsWith('.jsonl') ? full : null
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const readJson = req =>
  new Promise((ok, fail) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > 200_000) fail(new Error('too large'))
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        fail(e)
      }
    })
  })

/** Only the office page, from this machine, holding the token. */
const trusted = req => {
  if (!HOSTS.has(req.headers.host ?? '')) return false
  const origin = req.headers.origin
  if (origin && !HOSTS.has(origin.replace(/^http:\/\//, ''))) return false
  if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return false
  return req.headers['x-office-token'] === TOKEN
}

const cleanTeam = body => {
  const members = Array.isArray(body?.members) ? body.members.slice(0, 60) : []
  return {
    members: members.map(m => ({
      id: String(m.id ?? '').slice(0, 40),
      name: String(m.name ?? '').trim().slice(0, 30) || 'Someone',
      kind: m.kind == null || m.kind === '' ? null : String(m.kind).slice(0, 80),
      title: m.title == null ? null : String(m.title).slice(0, 40),
    })).filter(m => m.id),
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    if (!path.startsWith('/api/')) {
      if (!HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'wrong host' })
      const file = path === '/' ? 'index.html' : path.slice(1)
      const ext = file.slice(file.lastIndexOf('.'))
      if (!/^[\w-]+\.(html|js|css)$/.test(file) || !TYPES[ext]) return send(res, 404, { error: 'not found' })
      let body = await readFile(join(HERE, file), 'utf8')
      if (file === 'index.html') body = body.replace('__OFFICE_TOKEN__', TOKEN)
      return send(res, 200, body, TYPES[ext])
    }

    if (path === '/api/health') return send(res, 200, { app: 'agent-office' })
    if (!trusted(req)) return send(res, 403, { error: 'not from the office page' })

    if (path === '/api/states' || path === '/api/state') pageSeenAt = Date.now()
    if (path === '/api/should-open' && req.method === 'POST') {
      const now = Date.now()
      const open = now - pageSeenAt > PAGE_GONE_MS && now - openingAt > 30_000
      if (open) openingAt = now
      return send(res, 200, { open })
    }
    if (path === '/api/states') return send(res, 200, { sessions: await openSessions() })
    if (path === '/api/state') return send(res, 200, (await latestState(url.searchParams.get('session'))) ?? { agents: {}, queries: [] })

    if (path === '/api/transcript') {
      const state = await latestState(url.searchParams.get('session'))
      const agent = state?.agents?.[url.searchParams.get('agent') ?? '']
      /* Only a path the mod recorded for that agent, and only inside the transcripts folder. */
      const candidates = [agent?.transcript, ...(agent?.transcriptGuesses ?? [])].filter(Boolean).map(insideProjects).filter(Boolean)
      for (const p of candidates) {
        const lines = await tail(p).catch(() => null)
        if (lines) return send(res, 200, { messages: conversation(lines) })
      }
      return send(res, 200, { messages: [], missing: true })
    }

    if (path === '/api/team' && req.method === 'GET') {
      const team = await readFile(TEAM_FILE, 'utf8').then(JSON.parse).catch(() => ({ members: [] }))
      return send(res, 200, team)
    }
    if (path === '/api/team' && req.method === 'POST') {
      const team = cleanTeam(await readJson(req))
      await writeFile(TEAM_FILE, JSON.stringify(team, null, 2))
      return send(res, 200, team)
    }

    if (path === '/api/message' && req.method === 'POST') {
      const body = await readJson(req)
      const to = String(body.to ?? '').slice(0, 40)
      const text = String(body.text ?? '').trim().slice(0, 8000)
      if (!to || !text) return send(res, 400, { error: 'who and what' })
      /* Tied to one session, so another Claude session that shares this server never acts on it. */
      const session = String(body.session ?? '').slice(0, 80) || null
      outbox.push({ seq: ++seq, to, text, session, at: Date.now() })
      if (outbox.length > 200) outbox.splice(0, outbox.length - 200)
      return send(res, 200, { queued: seq })
    }
    if (path === '/api/outbox') {
      const after = Number(url.searchParams.get('after') ?? 0)
      /* A restarted server numbers from 1 again; a reader ahead of it starts over. */
      return send(res, 200, { messages: outbox.filter(m => m.seq > (after > seq ? 0 : after)), last: seq })
    }

    send(res, 404, { error: 'not found' })
  } catch (error) {
    send(res, 500, { error: String(error?.message ?? error) })
  }
})

/* Another session's server already serves the office: nothing more to do. */
server.on('error', error => process.exit(error.code === 'EADDRINUSE' ? 0 : 1))
server.listen(PORT, '127.0.0.1', async () => {
  await writeFile(TOKEN_FILE, TOKEN, { mode: 0o600 })
  /* An older file keeps its old permissions through a write: set them again. */
  await chmod(TOKEN_FILE, 0o600)
})
