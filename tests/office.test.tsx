import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'agent-office',
  component: 'Pane',
  requestId: 'agent-office',
  props: { title: 'Brain', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const HOME = '/home/test/.claude/agent-office'

/** The engine beneath the mod: a clock, a home folder, files kept in memory, a server with an outbox. */
const world = (on: On, outbox: object[] = [], officeShown = true) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/test' })
  const files: Record<string, string> = {
    [`${HOME}/token`]: 'secret',
    '/home/test/.claude/agents/planner.md': '---\nname: planner\ndescription: Plans one task before any code is written.\n---',
    '/home/test/.claude/agents/developer.md': '---\nname: developer\ndescription: Builds the planned task end to end.\n---',
    '/home/test/.claude/agents/qa.md': '---\nname: qa\ndescription: Verifies the task and pushes it.\n---',
  }
  const submitted: { text: string; asUser?: boolean }[] = []
  const spawned: { prompt: string; subagent_type?: string }[] = []
  const opened: string[] = []
  on('fs.write', (_, e) => ((files[e.path] = e.text), { value: undefined }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path]! } : Promise.reject(new Error('missing'))) as never)
  on('fs.list', (_, e) => ({
    value: e.path === '/home/test/.claude/agents'
      ? ['planner.md', 'developer.md', 'qa.md'].map(name => ({ name, kind: 'file', size: 1 }))
      : e.path === `${HOME}/sessions`
        ? Object.keys(files).filter(f => f.startsWith(`${HOME}/sessions/`)).map(f => ({ name: f.split('/').at(-1)!, kind: 'file', size: 1 }))
        : [],
  }) as never)
  on('http.fetch', (_, e) => ({
    value: {
      ok: true, status: 200, headers: {},
      text: e.url.includes('/api/outbox') ? JSON.stringify({ messages: outbox, last: outbox.length }) : e.url.includes('/api/should-open') ? JSON.stringify({ open: !officeShown }) : '{}',
    },
  }) as never)
  on('process.run', (_, e) => (opened.push(e.argv.join(' ')), { value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('prompt.submit', (_, e) => (submitted.push({ text: e.text, asUser: (e as { origin?: { asUser?: boolean } }).origin?.asUser }), { text: e.text }) as never)
  /* The engine hands a spawn on as an Agent tool call, so the type arrives as subagent_type. */
  on('agent.spawn', (_, e) => (spawned.push(e as never), { model: 'sonnet', agentId: 'spawned' }) as never)
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}) as never)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.Stop', () => ({}))
  on('tool.call', (_, e) =>
    e.tool === 'mcp__shiftwren__search_code'
      ? { result: {}, text: 'backend/src/routes/payroll.ts:12\nshiftwren-hq/src/pages/Home.tsx:40' }
      : e.tool === 'Bash' && (e as { run_in_background?: boolean }).run_in_background
        ? { result: {}, text: 'Command running in background with ID: bg1. Output is being written to: /tmp/bg1.output' }
        : { result: {} },
  )
  return { clock, files, submitted, spawned, opened }
}

test('the whole team is on the roster, and a job goes to the person for that role', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Agent', subagent_type: 'qa', model: 'sonnet', description: 'Check the payroll fix', prompt: 'x' } as never)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'qa', session_id: 's1', transcript_path: '/home/test/.claude/projects/p/s1.jsonl' } as never)
  await $.tool.call({ tool: 'mcp__shiftwren__search_code', query: 'pay run' } as never)

  /* The roster: Wren, the person's own agents, the built-in ones, then the receptionist and floaters. */
  const team = JSON.parse(files[`${HOME}/team.json`] ?? '{}').members as { name: string; kind: string | null; title: string | null }[]
  expect(team.slice(0, 4).map(m => m.name)).toEqual(['Wren', 'Paige', 'Diego', 'Quinn'])
  expect(team.find(m => m.title === 'Reception')?.name).toBe('Rae')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Wren · search_code “pay run” → 2 files \(Routes, HQ\)/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Quinn · QA · sonnet · working/ })).toBeTruthy()
    expect(Boolean(await ui.find({ type: 'Svg' } as never))).toBe(surface === 'desktop')
    await ui.unmount()
  }

  /* The office reads the same team, with each role's duties from its agent file. */
  await clock.settle()
  const file = JSON.parse(files[`${HOME}/sessions/s1.json`] ?? '{}')
  expect(file.agents.a1.name).toBe('Quinn')
  /* The office can draw the hand-off: Wren's conversation briefed Quinn, and the brain's regions come with the state. */
  expect(file.agents.a1.parent).toBe('main')
  expect(file.brain.regions.map((r: { area: string }) => r.area)).toContain('Routes')
  expect(file.agents.a1.transcriptGuesses[0]).toBe('/home/test/.claude/projects/p/s1/subagents/agent-a1.jsonl')
  expect(file.kinds.find((k: { kind: string }) => k.kind === 'qa').duties).toBe('Verifies the task and pushes it.')

  /* Finishing sends Quinn back to office life. */
  await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'qa', agent_transcript_path: '' } as never)
  const later = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await later.find({ type: 'Text', text: /Quinn · QA · sonnet · between tasks/ })).toBeTruthy()
  await later.unmount()
})

test('a renamed person keeps their job, and the coordinator\'s new name is the main conversation\'s', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'd1', agent_type: 'developer', session_id: 's1', transcript_path: '/x/s1.jsonl' } as never)
  const team = JSON.parse(files[`${HOME}/team.json`]!)
  for (const m of team.members) {
    if (m.kind === 'developer') m.name = 'Dev'
    if (m.kind === 'coordinator') m.name = 'Ava'
  }
  files[`${HOME}/team.json`] = JSON.stringify(team)
  await clock.advance(2_100)
  const file = JSON.parse(files[`${HOME}/sessions/s1.json`]!)
  expect(file.agents.d1.name).toBe('Dev')
  expect(file.agents.main.name).toBe('Ava')
})

test('messages from the office reach Wren as the owner\'s words, and start work for anyone free', async ($, on) => {
  const outbox = [
    { seq: 1, to: 'Wren', text: 'How is 1.45 going?', session: 's1' },
    { seq: 2, to: 'Diego', text: 'Fix the login charge.', session: 's1' },
    { seq: 3, to: 'Diego', text: 'Not for this session.', session: 'other' },
  ]
  const { clock, files, submitted, spawned } = world(on, outbox)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.classic.UserPromptSubmit({ session_id: 's1', transcript_path: '/x/s1.jsonl', prompt: 'hi' } as never)
  await clock.advance(2_100)
  expect(submitted).toEqual([{ text: 'How is 1.45 going?', asUser: true }])
  expect(spawned.map(s => [s.subagent_type, s.prompt])).toEqual([['developer', 'Fix the login charge.']])

  /* The job the office started is Diego's, by name. */
  await $.classic.SubagentStart({ agent_id: 'd2', agent_type: 'developer', session_id: 's1', transcript_path: '/x/s1.jsonl' } as never)
  await clock.settle()
  expect(JSON.parse(files[`${HOME}/sessions/s1.json`]!).agents.d2.name).toBe('Diego')
  expect(JSON.parse(files[`${HOME}/sessions/s1.json`]!).agents.d2.parent).toBe('owner')

  /* Each message is acted on once. */
  await clock.advance(2_100)
  expect(submitted.length).toBe(1)
  expect(spawned.length).toBe(1)
})

test('someone on a job in another session is busy here too, so a floater takes the work', async ($, on) => {
  const { clock, files } = world(on)
  /* Another open session, written moments ago, where Diego is mid-job. */
  files[`${HOME}/sessions/other.json`] = JSON.stringify({ updatedAt: 1_000_000, agents: { x1: { id: 'x1', name: 'Diego', kind: 'developer', isDone: false } } })
  await $.session.start({ cwd: '/work/Shift Wren/.claude/worktrees/abc', surface: 'desktop', isInteractive: true })
  await $.classic.SubagentStart({ agent_id: 'd1', agent_type: 'developer', session_id: 's1', transcript_path: '/x/s1.jsonl' } as never)
  await clock.settle()
  const file = JSON.parse(files[`${HOME}/sessions/s1.json`]!)
  expect(file.agents.d1.name).toBe('Max')
  /* Jobs are labelled with the project, seen past the worktree. */
  expect(file.session.project).toBe('Shift Wren')
})

test('a new session opens the office in the browser, unless a page already shows it', async ($, on) => {
  const { clock, opened } = world(on, [], false)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual(['open http://127.0.0.1:4477'])
})

test('with the office already on screen, starting a session opens nothing', async ($, on) => {
  const { clock, opened } = world(on, [], true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened).toEqual([])
})

test('a fresh roster holds exactly ten people: Wren, Rae, one per role in use, and a floater', async ($, on) => {
  const { files } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const team = JSON.parse(files[`${HOME}/team.json`]!).members as { id: string; name: string; kind: string | null; title: string | null }[]
  expect(team.length).toBe(10)
  expect(team[0]!.name).toBe('Wren')
  expect(team.filter(m => m.title === 'Reception').map(m => m.name)).toEqual(['Rae'])
  /* One person per role, the loop roles first, and nobody twice. */
  const kinds = team.filter(m => m.kind).map(m => m.kind)
  expect(new Set(kinds).size).toBe(kinds.length)
  expect(kinds.slice(0, 6)).toEqual(['coordinator', 'planner', 'developer', 'qa', 'Explore', 'general-purpose'])
  expect(new Set(team.map(m => m.name)).size).toBe(10)
  expect(team.some(m => !m.kind && !m.title)).toBe(true)
})

test('with more jobs than people, people take on extra jobs and nobody new appears', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const team = JSON.parse(files[`${HOME}/team.json`]!).members as { name: string; kind: string | null }[]
  const names = new Set(team.map(m => m.name))
  for (let i = 0; i < 14; i++) {
    await $.classic.SubagentStart({ agent_id: `j${i}`, agent_type: i % 2 ? 'developer' : 'qa', session_id: 's1', transcript_path: '/x/s1.jsonl' } as never)
  }
  await clock.settle()
  const agents = Object.values(JSON.parse(files[`${HOME}/sessions/s1.json`]!).agents) as { id: string; name: string; desk: number }[]
  const jobs = agents.filter(a => a.id !== 'main')
  expect(jobs.length).toBe(14)
  /* Every job is someone on the roster, never Wren, and the load is spread before anyone doubles up. */
  expect(jobs.every(a => names.has(a.name) && a.name !== 'Wren')).toBe(true)
  const load = new Map<string, number>()
  for (const a of jobs) load.set(a.name, (load.get(a.name) ?? 0) + 1)
  expect(load.size).toBe(9)
  expect(Math.max(...load.values())).toBe(2)
  /* Diego, the developer, gets the first developer job; an extra job keeps the same desk. */
  expect(jobs.find(a => a.id === 'j1')!.name).toBe('Diego')
  const diego = jobs.filter(a => a.name === 'Diego')
  expect(new Set(diego.map(a => a.desk)).size).toBe(1)
})

test('background tasks show who started them, while they run and how they ended', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.classic.UserPromptSubmit({ session_id: 's1', transcript_path: '/x/s1.jsonl', prompt: 'hi' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Start the dev server', run_in_background: true } as never)
  await clock.settle()
  const tasks = () => JSON.parse(files[`${HOME}/sessions/s1.json`]!).tasks as { id: string; label: string; by: string; status: string; summary?: string }[]
  expect(tasks()).toEqual([expect.objectContaining({ id: 'bg1', label: 'Start the dev server', by: 'main', status: 'running' })])

  /* Its notification says how it ended. */
  await $.prompt.submit({ text: '<task-notification><task-id>bg1</task-id><status>failed</status><summary>Background command "npm run dev" failed with exit code 1</summary></task-notification>', origin: { kind: 'task-notification' } } as never)
  await clock.settle()
  expect(tasks()[0]).toEqual(expect.objectContaining({ status: 'failed', summary: 'Background command "npm run dev" failed with exit code 1' }))

  /* The engine's list at a stop is the truth: a task it lists is running; one it no longer lists has finished. */
  await $.classic.Stop({ session_id: 's1', background_tasks: [{ id: 'm2', type: 'monitor', status: 'running', description: 'Watch the deploy' }] } as never)
  await clock.settle()
  expect(tasks().find(t => t.id === 'm2')).toEqual(expect.objectContaining({ label: 'Watch the deploy', status: 'running' }))
  await $.classic.Stop({ session_id: 's1', background_tasks: [] } as never)
  await clock.settle()
  expect(tasks().find(t => t.id === 'm2')!.status).toBe('finished')
})
