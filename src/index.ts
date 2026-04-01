import 'dotenv/config'
import path from 'node:path'
import express from 'express'
import { z } from 'zod'

const app = express()
const publicDir = path.resolve(process.cwd(), 'public')

const config = {
  port: Number(process.env.PORT ?? 8080),
  openclawBaseUrl: process.env.OPENCLAW_BASE_URL?.replace(/\/$/, '') ?? '',
  openclawToken: process.env.OPENCLAW_TOKEN ?? '',
  hooksToken: process.env.OPENCLAW_HOOKS_TOKEN ?? '',
  sessionKey: process.env.OPENCLAW_SESSION_KEY ?? 'main',
  pollLimit: Number(process.env.POLL_LIMIT ?? 25),
}

type SessionRow = {
  sessionKey?: string
  sessionId?: string
  label?: string
  kind?: string
  status?: string
  updatedAt?: string | number
  channel?: string
  preview?: string
  model?: string
  key?: string
  displayName?: string
  lastChannel?: string
  messages?: unknown[]
}

type WorkloadActionId =
  | 'launch-planner'
  | 'launch-research'
  | 'launch-coder'
  | 'launch-reviewer'
  | 'launch-full-workload'

const workload = {
  id: 'workload-multiagent-board',
  title: 'Multi-Agent Workload Board',
  brief:
    'A live control surface for planning, spawning, monitoring, and reviewing parallel agent work without losing the thread.',
  lanes: ['Planning', 'Research', 'Build', 'Review', 'Done'],
  tasks: [
    { id: 'WL-101', title: 'Frame the user goal', lane: 'Planning', owner: 'Planner', status: 'running', priority: 'critical', summary: 'Turn the request into a bounded objective with success criteria and scope.', dependencyCount: 0 },
    { id: 'WL-102', title: 'Gather context and constraints', lane: 'Research', owner: 'Researcher', status: 'waiting', priority: 'high', summary: 'Collect the relevant files, history, and assumptions before work starts.', dependencyCount: 1 },
    { id: 'WL-103', title: 'Implement the solution', lane: 'Build', owner: 'Builder', status: 'blocked', priority: 'high', summary: 'Execute the requested changes and keep artifacts traceable.', dependencyCount: 2 },
    { id: 'WL-104', title: 'Verify and tighten', lane: 'Review', owner: 'Reviewer', status: 'waiting', priority: 'normal', summary: 'Check for drift, missing cases, and obvious cleanup opportunities.', dependencyCount: 1 },
    { id: 'WL-105', title: 'Archive the final result', lane: 'Done', owner: 'Archivist', status: 'done', priority: 'low', summary: 'Preserve the final state, decisions, and next steps for later inspection.', dependencyCount: 0 },
  ],
  dependencies: [
    { from: 'Planner', to: 'Researcher', label: 'scope → context' },
    { from: 'Researcher', to: 'Builder', label: 'context → implementation' },
    { from: 'Builder', to: 'Reviewer', label: 'implementation → verification' },
    { from: 'Reviewer', to: 'Archivist', label: 'verified → archived' },
  ],
  alerts: [
    { severity: 'warning', title: 'Build lane waiting on two prerequisites', description: 'The implementation lane is held until context and scope settle.', action: 'Inspect dependency chain' },
    { severity: 'info', title: 'Planner is actively shaping the objective', description: 'The board is still in the definition phase, not execution yet.', action: 'Open planner details' },
  ],
}

const actions: Array<{ id: WorkloadActionId; label: string; role: string; sessionKey: string; message: string }> = [
  { id: 'launch-planner', label: 'Launch planner', role: 'Planner', sessionKey: 'hook:workflow:multiagent:planner', message: 'You are the Planner. Convert the request into a crisp objective, identify success criteria, and define the scope boundaries. Return a short plan, not a stream of raw reasoning.' },
  { id: 'launch-research', label: 'Launch researcher', role: 'Researcher', sessionKey: 'hook:workflow:multiagent:researcher', message: 'You are the Researcher. Gather the needed context, constraints, and references for the workload. Return concise findings and any important unknowns.' },
  { id: 'launch-coder', label: 'Launch builder', role: 'Builder', sessionKey: 'hook:workflow:multiagent:builder', message: 'You are the Builder. Implement the requested changes carefully and report the concrete result, assumptions, and any follow-up needed.' },
  { id: 'launch-reviewer', label: 'Launch reviewer', role: 'Reviewer', sessionKey: 'hook:workflow:multiagent:reviewer', message: 'You are the Reviewer. Check the current workload output for missing cases, correctness issues, and cleanup opportunities. Return concise review notes.' },
  { id: 'launch-full-workload', label: 'Launch full workload', role: 'Orchestrator', sessionKey: 'hook:workflow:multiagent:orchestrator', message: 'You are the Orchestrator. Coordinate planning, research, build, and review into one coherent multi-agent workflow. Return a short operational summary and next actions.' },
]

const triggerSchema = z.object({
  actionId: z.enum(['launch-planner', 'launch-research', 'launch-coder', 'launch-reviewer', 'launch-full-workload']),
})

app.use(express.json({ limit: '1mb' }))
app.use(express.static(publicDir))

function normalizeToolResult(result: unknown) {
  if (!result || typeof result !== 'object') return result
  const maybe = result as { details?: unknown; content?: Array<{ type?: string; text?: string }> }
  if (maybe.details) return maybe.details
  const textChunk = maybe.content?.find((item) => item.type === 'text' && item.text)
  if (!textChunk?.text) return result
  try { return JSON.parse(textChunk.text) } catch { return result }
}

async function openClawInvoke(tool: string, args: Record<string, unknown>) {
  if (!config.openclawBaseUrl || !config.openclawToken) throw new Error('OpenClaw gateway is not configured')
  const response = await fetch(`${config.openclawBaseUrl}/tools/invoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openclawToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, sessionKey: config.sessionKey }),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `OpenClaw invoke failed for ${tool}`)
  return normalizeToolResult(data.result)
}

async function fetchSessionHistory(sessionKey: string) {
  if (!config.openclawBaseUrl || !config.openclawToken) throw new Error('OpenClaw gateway is not configured')
  const url = new URL(`${config.openclawBaseUrl}/sessions/${encodeURIComponent(sessionKey)}/history`)
  url.searchParams.set('limit', '12')
  url.searchParams.set('includeTools', '1')
  const response = await fetch(url, { headers: { Authorization: `Bearer ${config.openclawToken}` } })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error?.message ?? `Could not fetch history for ${sessionKey}`)
  return data
}

async function fetchKnownSessions() {
  const results = await Promise.all(actions.map(async (action) => {
    try {
      const history = await fetchSessionHistory(action.sessionKey)
      const messages = Array.isArray(history?.items) ? history.items : Array.isArray(history?.messages) ? history.messages : Array.isArray(history) ? history : []
      return { action, exists: true, messages }
    } catch {
      return { action, exists: false, messages: [] }
    }
  }))
  return results
}

async function sendHookRun(action: (typeof actions)[number]) {
  const response = await fetch(`${config.openclawBaseUrl}/hooks/agent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.hooksToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: action.message, name: action.label, agentId: 'codex', sessionKey: action.sessionKey, wakeMode: 'now', deliver: false, timeoutSeconds: 180 }),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.error?.message ?? data?.message ?? 'Hook trigger failed')
  return data
}

async function triggerAction(actionId: WorkloadActionId) {
  if (!config.openclawBaseUrl || !config.hooksToken) throw new Error('Hooks are not configured for the workflow board')
  const action = actions.find((item) => item.id === actionId)
  if (!action) throw new Error('Unknown action')
  if (actionId === 'launch-full-workload') {
    const fanout = await Promise.all(actions.filter((item) => item.id !== 'launch-full-workload').map(async (a) => ({ action: a, result: await sendHookRun(a) })))
    const result = await sendHookRun(action)
    return { action, result, fanout }
  }
  return { action, result: await sendHookRun(action) }
}

function isoAge(updatedAt?: string) {
  if (!updatedAt) return 'unknown'
  const deltaMs = Date.now() - new Date(updatedAt).getTime()
  const mins = Math.max(0, Math.round(deltaMs / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function extractMessageText(message: unknown) {
  if (!message || typeof message !== 'object') return ''
  const record = message as { content?: unknown; text?: string }
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) {
    return record.content.map((item) => (item && typeof item === 'object' && 'text' in item ? String((item as { text?: string }).text ?? '') : '')).filter(Boolean).join('\n')
  }
  return ''
}

function getBestReadableAssistantText(messages: unknown[]) {
  const candidates = messages.filter((message) => message && typeof message === 'object' && (message as { role?: string }).role === 'assistant').map((message) => extractMessageText(message).trim()).filter(Boolean)
  const readable = candidates.filter((text) => text.length > 80 && !/"toolCall"|stopReason|partialJson|arguments/gi.test(text))
  return readable.at(-1) ?? candidates.at(-1) ?? ''
}

function getLatestTimestamp(messages: unknown[]) {
  const stamped = [...messages].reverse().find((message) => message && typeof message === 'object' && 'timestamp' in message)
  if (!stamped || typeof stamped !== 'object') return undefined
  const value = Number((stamped as { timestamp?: number }).timestamp ?? 0)
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : undefined
}

function summarizeText(text: string, maxLength = 220) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`
}

function extractBullets(text: string) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('-') || line.startsWith('•')).slice(0, 4)
}

function buildEventFeed(cards: Array<{ updated: string; status: string; name: string; preview: string }>) {
  return cards.filter((card) => card.preview).slice(0, 12).map((card, index) => ({ time: card.updated, type: card.status === 'done' ? 'deliver' : index % 3 === 0 ? 'spawn' : index % 3 === 1 ? 'update' : 'handoff', text: `${card.name} · ${summarizeText(card.preview, 140)}` }))
}

function fallbackCards() {
  return actions.map((action, index) => ({
    id: action.id,
    name: action.role,
    role: action.role,
    kind: 'demo',
    model: 'openai-codex/gpt-5.4',
    status: index === 0 ? 'running' : index === 1 ? 'waiting' : index === 2 ? 'blocked' : index === 3 ? 'waiting' : 'done',
    updated: 'demo',
    preview: `Ready to trigger ${action.label}`,
    summary: `Ready to trigger ${action.label}`,
    headline: `${action.role} standing by`,
    bullets: ['- Awaiting trigger from the action rail'],
    body: `Trigger ${action.label} to generate a readable desk brief.`,
    sessionKey: null,
    channel: 'internal',
  }))
}

app.get('/health', async (_req, res) => {
  try {
    if (!config.openclawBaseUrl || !config.openclawToken) {
      res.json({ ok: true, openclawConfigured: false, hooksConfigured: Boolean(config.hooksToken) })
      return
    }
    const sessions = await openClawInvoke('sessions_list', { limit: 1, messageLimit: 0 })
    res.json({ ok: true, openclawConfigured: true, hooksConfigured: Boolean(config.hooksToken), reachable: true, sessions })
  } catch (error) {
    res.status(200).json({ ok: true, openclawConfigured: true, hooksConfigured: Boolean(config.hooksToken), reachable: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.get('/api/state', async (_req, res) => {
  try {
    const sessionsResult = await openClawInvoke('sessions_list', { limit: config.pollLimit, messageLimit: 1 })
    const allSessions = Array.isArray(sessionsResult) ? sessionsResult : Array.isArray((sessionsResult as { sessions?: unknown[] })?.sessions) ? ((sessionsResult as { sessions: SessionRow[] }).sessions) : []
    const visible = allSessions.filter((session) => String(session.key ?? session.sessionKey ?? '').startsWith('hook:workflow:'))
    const known = await fetchKnownSessions()
    const agentCards = known.map(({ action, exists, messages }) => {
      const bestText = getBestReadableAssistantText(messages)
      const preview = bestText || (exists ? 'Workload session active' : `Ready to trigger ${action.label}`)
      const updatedAt = getLatestTimestamp(messages)
      const status = !exists ? 'waiting' : /operator take|execution|research|plan|review|summary/i.test(preview) ? 'done' : 'running'
      const bullets = extractBullets(preview)
      const headline = preview.split('\n').find(Boolean) ?? `${action.role} waiting`
      return { id: action.id, name: action.role, role: action.role, kind: exists ? 'hook-session' : 'desk-ready', model: 'openai-codex/gpt-5.4', status, updated: updatedAt ? isoAge(updatedAt) : 'idle', preview, summary: summarizeText(preview, 200), headline, bullets, body: preview, sessionKey: action.sessionKey, channel: 'internal' }
    })
    const activeCount = agentCards.filter((card) => card.status === 'running').length
    res.json({ ok: true, source: visible.length ? 'openclaw-live' : 'openclaw', configured: true, hooksConfigured: Boolean(config.hooksToken), workload, actions: actions.map(({ id, label, role }) => ({ id, label, role })), metrics: { workloadCount: 1, agentCount: agentCards.length, activeCount, blockedCount: workload.tasks.filter((task) => task.status === 'blocked').length, alertCount: workload.alerts.length, updatedAt: new Date().toISOString() }, agentCards, taskCards: workload.tasks, alerts: workload.alerts, dependencies: workload.dependencies, eventFeed: buildEventFeed(agentCards), detailHint: agentCards.find((card) => card.sessionKey)?.sessionKey ?? null, transcript: agentCards.map((card) => ({ role: card.role, title: card.headline, body: card.body, updated: card.updated, sessionKey: card.sessionKey })) })
  } catch (error) {
    const cards = fallbackCards()
    res.status(200).json({ ok: true, source: 'fallback', configured: false, hooksConfigured: Boolean(config.hooksToken), workload, actions: actions.map(({ id, label, role }) => ({ id, label, role })), metrics: { workloadCount: 1, agentCount: 5, activeCount: 2, blockedCount: 1, alertCount: workload.alerts.length, updatedAt: new Date().toISOString() }, agentCards: cards, taskCards: workload.tasks, alerts: workload.alerts, dependencies: workload.dependencies, eventFeed: buildEventFeed(cards), detailHint: null, transcript: cards.map((card) => ({ role: card.role, title: card.headline, body: card.body, updated: card.updated, sessionKey: card.sessionKey })), error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.post('/api/actions/trigger', async (req, res) => {
  try {
    const { actionId } = triggerSchema.parse(req.body)
    const result = await triggerAction(actionId)
    res.json({ ok: true, action: result.action, result: result.result })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.get('/api/session/:sessionKey/history', async (req, res) => {
  try {
    const result = await fetchSessionHistory(req.params.sessionKey)
    res.json({ ok: true, result })
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})

app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')))

app.listen(config.port, () => {
  console.log(`openclaw-workflow-board listening on ${config.port}`)
})
