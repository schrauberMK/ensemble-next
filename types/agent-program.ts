/**
 * AgentProgram — Declarative configuration for AI agent programs.
 * Loaded from agents.json at runtime; eliminates hardcoded agent-specific logic.
 */

export interface AgentProgram {
  /** Unique identifier matching the key in agents.json (e.g. "codex", "claude") */
  name: string
  /** CLI command to launch the agent (e.g. "codex", "claude", "glm") */
  command: string
  /** Default flags appended to the command (e.g. ["-m", "gpt-5.4"]) */
  flags: string[]
  /** Environment variable names to unset in the pane before launching */
  unsetEnv?: string[]
  /** String that appears in tmux pane when agent is ready for input */
  readyMarker: string
  /** How to deliver multi-line prompts */
  inputMethod: 'pasteFromFile' | 'sendKeys'
  /**
   * Paste with tmux bracketed paste (`paste-buffer -p`). Needed for TUIs such
   * as agy that submit every pasted line as its own turn otherwise.
   */
  bracketedPaste?: boolean
  /**
   * Role this program takes as a non-lead teammate when the team template has
   * no role for its position (e.g. agy as researcher/griller).
   */
  teamRole?: { role: string; focus: string }
  /** Base color name for monitor TUI (e.g. "blue", "green", "magenta", "yellow") */
  color: string
  /** Single-char icon shown in monitor UI (e.g. "◆", "●", "▲", "★") */
  icon: string
}

export interface AgentsConfig {
  [key: string]: AgentProgram
}
