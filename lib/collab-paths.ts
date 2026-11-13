/**
 * Collab Path Resolver — Shared path contract for multi-collab isolation.
 * All runtime files live under /tmp/ensemble-next/<teamId>/.
 * Shell equivalent: scripts/collab-paths.sh (must stay in sync).
 */

import path from 'path'
import fs from 'fs'

const RUNTIME_ROOT = process.env.COLLAB_RUNTIME_ROOT?.trim() || '/tmp/ensemble-next'

/** Base runtime directory for a team */
export function collabRuntimeDir(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId)
}

/** JSONL message log */
export function collabMessagesFile(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'messages.jsonl')
}

/** Summary text written on disband */
export function collabSummaryFile(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'summary.txt')
}

/** Bridge process PID file */
export function collabBridgePid(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'bridge.pid')
}

/** Bridge log file */
export function collabBridgeLog(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'bridge.log')
}

/** Poller process PID file */
export function collabPollerPid(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'poller.pid')
}

/** Live feed output file */
export function collabFeedFile(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'feed.txt')
}

/** Per-agent prompt file */
export function collabPromptFile(teamId: string, agentName: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'prompts', `${agentName}.txt`)
}

/** Per-session delivery file */
export function collabDeliveryFile(teamId: string, sessionName: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'delivery', `${sessionName}.txt`)
}

/** Bridge result file (raw bridge output) */
export function collabBridgeResult(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'bridge-result')
}

/** Bridge posted marker */
export function collabBridgePosted(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'bridge-posted')
}

/** Team ID marker file */
export function collabTeamIdFile(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'team-id')
}

/** Sessieregister: één tmux/host-sessienaam per regel, de bron voor postcheck, rescue en cleanup */
export function collabSessionsFile(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'sessions')
}

/** Raw output of an agent's tmux pane, written by tmux pipe-pane from the spawn on */
export function collabPaneLogFile(sessionName: string): string {
  return path.join(RUNTIME_ROOT, 'panes', `${sessionName.replace(/[^a-zA-Z0-9_.-]/g, '')}.log`)
}

/** Records of hooks/verify-on-stop.cjs, one per claude session */
export function collabVerifyDir(): string {
  return path.join(RUNTIME_ROOT, 'verify')
}

/**
 * Per-reader read state: one message id per line, appended only by team-read.
 * Delivery into the pane does not count: an agent busy in a long tool call sees the
 * pasted message only when its turn ends, so marking it seen hid it from team-read.
 */
export function collabReadStateFile(teamId: string, reader: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'read-state', `${reader.replace(/[^a-zA-Z0-9_.-]/g, '')}.seen`)
}

/** Per-agent heartbeat file; its mtime counts as activity for the watchdog */
export function collabHeartbeatFile(teamId: string, agentName: string): string {
  return path.join(RUNTIME_ROOT, teamId, 'alive', agentName.replace(/[^a-zA-Z0-9_.-]/g, ''))
}

/** Last heartbeat of an agent as ISO string, or undefined when it never sent one */
export function readHeartbeatAt(teamId: string, agentName: string): string | undefined {
  try {
    return fs.statSync(collabHeartbeatFile(teamId, agentName)).mtime.toISOString()
  } catch {
    return undefined
  }
}

/** Finished marker (written on disband, signals cleanup) */
export function collabFinishedMarker(teamId: string): string {
  return path.join(RUNTIME_ROOT, teamId, '.finished')
}

/** Ensure the runtime directory (and subdirs) exist */
export function ensureCollabDirs(teamId: string): void {
  const base = collabRuntimeDir(teamId)
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(base, 'prompts'), { recursive: true })
  fs.mkdirSync(path.join(base, 'delivery'), { recursive: true })
  fs.chmodSync(base, 0o700)
}
