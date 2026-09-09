import { isLocalProviderUrl } from './providerConfig.js'

/**
 * Determines whether a provider/model is constrained by strict token-per-minute (TPM)
 * limits (such as Groq free on-demand tier with 8,000 TPM) or small context windows (<= 32k),
 * where sending the full ~17k token Anthropic system prompt and tool definitions will overflow.
 */
export function isConstrainedProvider(baseUrl?: string, model?: string): boolean {
  if (process.env.SOTERIA_SLIM_PAYLOAD === '1' || process.env.SOTERIA_SLIM_PAYLOAD === 'true') {
    return true
  }
  if (process.env.SOTERIA_SLIM_PAYLOAD === '0' || process.env.SOTERIA_SLIM_PAYLOAD === 'false') {
    return false
  }

  // Check explicit environment flags
  const envUrl = process.env.OPENAI_BASE_URL ?? ''
  const effectiveUrl = (baseUrl || envUrl).toLowerCase()
  const effectiveModel = (model || process.env.OPENAI_MODEL || '').toLowerCase()

  // Groq has strict TPM limits (6,000 - 12,000 tokens/min on on_demand/free tier, e.g. 8,000 for gpt-oss-120b)
  if (
    effectiveUrl.includes('groq.com') ||
    effectiveUrl.includes('groq') ||
    effectiveModel.startsWith('groq:') ||
    effectiveModel.includes('gpt-oss-120b')
  ) {
    return true
  }

  // Local backends (Ollama, LM Studio, vLLM, llama.cpp) typically run with small context windows (8k-32k)
  if (isLocalProviderUrl(effectiveUrl)) {
    return true
  }

  // Known small context models
  const smallContextTokens = [
    'gpt-4-0613',
    'gpt-4-32k',
    'gpt-3.5',
    'qwen-2.5-7b',
    'qwen-2.5-14b',
    'llama-3.1-8b',
    'llama-3.2-3b',
    'llama-3.2-1b',
  ]
  if (smallContextTokens.some(token => effectiveModel.includes(token))) {
    return true
  }

  return false
}

/**
 * Concise descriptions for core tools to replace thousands of words of Anthropic-specific
 * prompt engineering guidelines and git tutorials embedded in tool descriptions.
 */
const CONCISE_TOOL_DESCRIPTIONS: Record<string, string> = {
  Bash: 'Execute a bash command in the terminal. Returns stdout, stderr, and exit code. Use for system commands, tests, git, builds.',
  FileEdit: 'Edit an existing file by replacing an exact contiguous block of text (old_string) with new content (new_string).',
  FileRead: 'Read contents of a file with optional line offset and limit.',
  FileWrite: 'Write full content to a file, creating parent directories if needed.',
  Glob: 'Fast file pattern matching to locate files by name or glob pattern.',
  Grep: 'Search file contents for regular expressions or exact text patterns.',
  WebSearch: 'Search the web using a search engine query and return results.',
  WebFetch: 'Fetch and convert web page content to markdown.',
  WebBrowser: 'Browse a web page using a headless browser to extract dynamic content or inspect layout.',
  AskUserQuestion: 'Prompt the user with a multiple-choice or clarifying question.',
  Agent: 'Delegate an autonomous sub-task to a subagent.',
  TodoWrite: 'Create or update the task list to track progress.',
  TaskCreate: 'Create a new task in the task list.',
  TaskGet: 'Get details of a task by ID.',
  TaskUpdate: 'Update status or details of a task.',
  TaskList: 'List all tasks in the current session.',
  TaskStop: 'Signal task completion or cancellation.',
  Skill: 'Execute a registered user skill.',
  NotebookEdit: 'Edit Jupyter notebook (.ipynb) cells.',
}

/**
 * Return a crisp, concise tool description for constrained providers.
 */
export function getConciseToolDescription(toolName: string, originalDescription?: string): string {
  if (toolName in CONCISE_TOOL_DESCRIPTIONS) {
    return CONCISE_TOOL_DESCRIPTIONS[toolName]
  }

  if (!originalDescription || originalDescription.trim().length === 0) {
    return `Tool: ${toolName}`
  }

  // Extract first sentence or truncate to 140 chars
  const trimmed = originalDescription.trim()
  const firstSentenceMatch = trimmed.match(/^([^.!?]+[.!?])/m)
  if (firstSentenceMatch && firstSentenceMatch[1].length > 10 && firstSentenceMatch[1].length <= 160) {
    return firstSentenceMatch[1].trim()
  }

  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed
}

/**
 * Prune verbose property descriptions in JSON schema for constrained models.
 */
export function slimToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema }

  if (result.type === 'object' && result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, Record<string, unknown>>
    const slimProps: Record<string, Record<string, unknown>> = {}

    for (const [key, propDef] of Object.entries(props)) {
      if (!propDef || typeof propDef !== 'object') {
        slimProps[key] = propDef
        continue
      }

      const slimDef: Record<string, unknown> = { ...propDef }
      if (typeof slimDef.description === 'string') {
        const desc = slimDef.description.trim()
        const firstSentenceMatch = desc.match(/^([^.!?]+[.!?])/m)
        if (firstSentenceMatch && firstSentenceMatch[1].length > 5 && firstSentenceMatch[1].length <= 120) {
          slimDef.description = firstSentenceMatch[1].trim()
        } else if (desc.length > 100) {
          slimDef.description = `${desc.slice(0, 97)}...`
        }
      }

      // Recurse into nested items if array
      if (slimDef.items && typeof slimDef.items === 'object' && !Array.isArray(slimDef.items)) {
        slimDef.items = slimToolSchema(slimDef.items as Record<string, unknown>)
      }

      slimProps[key] = slimDef
    }

    result.properties = slimProps
  }

  return result
}

/**
 * Converts a massive 26k+ character system prompt into a concise, high-density
 * system prompt (<1,000 characters, ~200 tokens) suitable for Groq and constrained models,
 * preserving key environment context and any custom user-appended instructions.
 */
export function getSlimSystemPrompt(originalSystem: string): string {
  if (!originalSystem || originalSystem.length < 1200) {
    return originalSystem
  }

  // Extract environment facts from original prompt
  const envLines: string[] = []

  const cwdMatch =
    originalSystem.match(/Primary working directory:\s*([^\n]+)/i) ||
    originalSystem.match(/Working directory:\s*([^\n]+)/i) ||
    originalSystem.match(/CWD:\s*([^\n]+)/i)
  if (cwdMatch) {
    envLines.push(`Working directory: ${cwdMatch[1].trim()}`)
  }

  const platformMatch = originalSystem.match(/Platform:\s*([^\n]+)/i)
  if (platformMatch) {
    envLines.push(`Platform: ${platformMatch[1].trim()}`)
  }

  const shellMatch = originalSystem.match(/(?:Shell|Login shell):\s*([^\n]+)/i)
  if (shellMatch) {
    envLines.push(`Shell: ${shellMatch[1].trim()}`)
  }

  const osMatch = originalSystem.match(/OS Version:\s*([^\n]+)/i)
  if (osMatch) {
    envLines.push(`OS: ${osMatch[1].trim()}`)
  }

  const envBlock =
    envLines.length > 0 ? `\nEnvironment:\n${envLines.map(l => `- ${l}`).join('\n')}\n` : ''

  // Look for custom appended instructions (e.g. # Additional Instructions, # User Instructions, CLAUDE.md)
  let customInstructions = ''
  const appendMarker = originalSystem.indexOf('# Additional Instructions')
  if (appendMarker !== -1) {
    customInstructions = `\n\n${originalSystem.slice(appendMarker).trim()}`
  } else {
    const userInstMarker = originalSystem.indexOf('# User Instructions')
    if (userInstMarker !== -1) {
      customInstructions = `\n\n${originalSystem.slice(userInstMarker).trim()}`
    }
  }

  return `You are Soteria, an interactive general-purpose assistant and CLI with strong cybersecurity analysis and coding capabilities.${envBlock}
Directives:
- Inspect existing files and understand codebase structure before suggesting modifications.
- Prefer editing existing files with targeted, minimal changes.
- Reserve Bash for shell commands; use dedicated tools to read and edit files.
- Verify changes using terminal commands/tests before concluding tasks.
- Keep responses concise, direct, and factual.${customInstructions}`
}
