/** One thing an agent did: a tool it called, in words. */
export type Step = { tool: string; what: string; at: number }

/** Someone in the office: the main conversation or a subagent. */
export type Agent = {
  id: string
  /** A person's name, so the team reads as people: the coordinator's name is the main conversation's. */
  name: string
  /** The roster entry this job belongs to, so a renamed person keeps their work. */
  memberId?: string
  /** Who handed them this job: an agent id, "main" for the main conversation, or "owner" for a message sent from the office. */
  parent?: string
  /** The agent type (planner, developer, qa, Explore …), or "coordinator" for the main conversation. */
  kind: string
  description: string
  model: string | null
  /** Done once the subagent has stopped. Working or on break is decided by how recent `lastAt` is. */
  isDone: boolean
  activity: string
  startedAt: number
  lastAt: number
  desk: number
  /** The main conversation only: its turn is over and it waits for the person. */
  isWaiting?: boolean
  /** Every step taken, though only the last 30 are kept in `steps`. */
  stepCount: number
  steps: Step[]
  /** The agent's conversation on disk, once known; until then, where it is expected. */
  transcript: string | null
  transcriptGuesses: string[]
}

/** One search of the code index, and the regions of the codebase it lit up. */
export type BrainQuery = {
  id: string
  tool: string
  ask: string
  areas: string[]
  files: string[]
  by: string
  at: number
}

/** An Agent call seen before its subagent starts, so the start can be matched to its model and task. */
export type PendingSpawn = { kind: string; model: string | null; description: string; at: number; name?: string; memberId?: string; by?: string }

/**
 * Work left running in the background: a shell command, a monitor, a
 * background agent or a workflow. `by` is the agent that started it
 * ("main" for the main conversation). `finished` means it left the session's
 * list of running work without a notification saying how it ended.
 */
export type BgTask = {
  id: string
  kind: string
  label: string
  command?: string
  by: string
  startedAt: number
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'finished'
  endedAt?: number
  summary?: string
}

/** Someone on the roster the owner edits: their role is an agent type, or none for a floater or the receptionist. */
export type TeamMember = { id: string; name: string; kind: string | null; title: string | null }

/** An agent type, its everyday name, and what it is for. */
export type KindInfo = { kind: string; label: string; duties: string }

/** Something the office should tell the owner once: a message delivered, a job started. */
export type Notice = { at: number; text: string }

/** The session as hook events describe it: its id, and where its own conversation is written. */
export type SessionInfo = {
  id: string | null
  transcript: string | null
  /** The project the session works in: its folder, and the name the office labels its jobs with. */
  cwd?: string
  project?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: Record<string, Agent>
      queries: BrainQuery[]
      pending: PendingSpawn[]
      team: TeamMember[]
      kinds: KindInfo[]
      notices: Notice[]
      outbox: number
      session: SessionInfo
      tick: number
      tasks: Record<string, BgTask>
    }
  }
}
