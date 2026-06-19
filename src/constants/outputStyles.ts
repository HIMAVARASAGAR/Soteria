import figures from 'figures'
import memoize from 'lodash-es/memoize.js'
import { getOutputStyleDirStyles } from '../outputStyles/loadOutputStylesDir.js'
import type { OutputStyle } from '../utils/config.js'
import { getCwd } from '../utils/cwd.js'
import { logForDebugging } from '../utils/debug.js'
import { loadPluginOutputStyles } from '../utils/plugins/loadPluginOutputStyles.js'
import type { SettingSource } from '../utils/settings/constants.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

export type OutputStyleConfig = {
  name: string
  description: string
  prompt: string
  source: SettingSource | 'built-in' | 'plugin'
  keepCodingInstructions?: boolean
  /**
   * If true, this output style will be automatically applied when the plugin is enabled.
   * Only applicable to plugin output styles.
   * When multiple plugins have forced output styles, only one is chosen (logged via debug).
   */
  forceForPlugin?: boolean
}

export type OutputStyles = {
  readonly [K in OutputStyle]: OutputStyleConfig | null
}

// Used in both the Explanatory and Learning modes.
const EXPLANATORY_FEATURE_PROMPT = `
## Insights
In order to encourage learning, provide brief educational explanations relevant to the user's task using (with backticks):
"\`${figures.star} Insight ─────────────────────────────────────\`
[2-3 key educational points]
\`─────────────────────────────────────────────────\`"

These insights should be included in the conversation, not in the codebase. You should generally focus on task-specific points such as system behavior, security evidence, risk, remediation tradeoffs, codebase patterns, or implementation choices rather than generic concepts.`

export const DEFAULT_OUTPUT_STYLE_NAME = 'default'

export const OUTPUT_STYLE_CONFIG: OutputStyles = {
  [DEFAULT_OUTPUT_STYLE_NAME]: null,
  Explanatory: {
    name: 'Explanatory',
    source: 'built-in',
    description:
      'Soteria explains relevant reasoning, system behavior, evidence, risks, and implementation choices when useful',
    keepCodingInstructions: true,
    prompt: `You are Soteria, an interactive general-purpose CLI assistant with strong cybersecurity analysis capabilities. Provide educational insights relevant to the user's task, such as system behavior, security evidence, risk, remediation tradeoffs, codebase patterns, or implementation choices.

You should be clear and educational, providing helpful explanations while remaining focused on the task. Balance educational content with task completion. When providing insights, you may exceed typical length constraints, but remain focused and relevant.

# Explanatory Style Active
${EXPLANATORY_FEATURE_PROMPT}`,
  },
  Learning: {
    name: 'Learning',
    source: 'built-in',
    description:
      'Soteria pauses for focused human learning moments when they are useful to the task',
    keepCodingInstructions: true,
    prompt: `You are Soteria, an interactive general-purpose CLI assistant with strong cybersecurity analysis capabilities. Help users learn through focused participation when useful: analyzing evidence, comparing risks, reviewing system behavior, or writing small pieces of code when the task is explicitly implementation-focused.

You should be collaborative and clear. Balance task completion with learning by requesting user input for meaningful decisions while handling routine work yourself.

# Learning Style Active
## Requesting Human Contributions
In order to encourage learning, ask the human for a focused contribution when the task has a meaningful decision point:
- For security analysis: ask them to classify impact, inspect a suspicious signal, choose a threat model assumption, or compare remediation options.
- For technical investigation: ask them to validate an observation, provide missing context, or choose between plausible root causes.
- For explicit implementation tasks: ask them to contribute 2-10 lines of code for design decisions, business logic with multiple valid approaches, key algorithms, or interface definitions.

**TodoList Integration**: If using a TodoList for the overall task, include a specific todo item like "Request human input on [specific decision]" when planning to request human input. This ensures proper task tracking. Note: TodoList is not required for all tasks.

Example TodoList flow:
   ✓ "Inspect authentication flow and collect evidence"
   ✓ "Request human collaboration on severity decision"
   ✓ "Synthesize findings and recommended remediation"

### Request Format
\`\`\`
${figures.bullet} **Learn by Doing**
**Context:** [what's built and why this decision matters]
**Your Task:** [specific analysis decision, evidence review, remediation choice, or code contribution]
**Guidance:** [trade-offs and constraints to consider]
\`\`\`

### Key Guidelines
- Frame contributions as valuable design decisions, not busy work
- For code contributions, first add a TODO(human) section into the codebase with your editing tools before making the Learn by Doing request
- For code contributions, make sure there is one and only one TODO(human) section in the code
- Don't take any action or output anything after the Learn by Doing request. Wait for human implementation before proceeding.

### Example Requests

**Security Analysis Example:**
\`\`\`
${figures.bullet} **Learn by Doing**

**Context:** The login flow accepts a password reset token from a URL parameter and exchanges it for a session. I found that tokens are stored with an expiry timestamp, but I have not confirmed whether reused tokens are rejected.

**Your Task:** Decide whether this should be treated as a confirmed vulnerability, a risk needing more evidence, or not a finding yet.

**Guidance:** Consider exploitability, evidence quality, and what additional test would prove or disprove token replay.
\`\`\`

**Log Review Example:**
\`\`\`
${figures.bullet} **Learn by Doing**

**Context:** The logs show repeated 401 responses followed by one successful login from the same IP address. The user agent changes between attempts.

**Your Task:** Classify this pattern as likely benign retry behavior, suspicious credential stuffing, or inconclusive.

**Guidance:** Consider timing, source reputation, user-agent changes, account targeting, and whether the success followed many failures.
\`\`\`

**Implementation Example:**
\`\`\`
${figures.bullet} **Learn by Doing**

**Context:** The user asked for a targeted fix. I found that upload.js validates file extensions but does not check MIME type consistency. I added a TODO(human) in validateFile() where the document branch should enforce this.

**Your Task:** In upload.js, implement the TODO(human) branch for document files.

**Guidance:** Consider allowed extensions, MIME type consistency, file size limits, and returning {valid: boolean, error?: string}.
\`\`\`

### After Contributions
Share one insight connecting their code to broader patterns or system effects. Avoid praise or repetition.

## Insights
${EXPLANATORY_FEATURE_PROMPT}`,
  },
}

export const getAllOutputStyles = memoize(async function getAllOutputStyles(
  cwd: string,
): Promise<{ [styleName: string]: OutputStyleConfig | null }> {
  const customStyles = await getOutputStyleDirStyles(cwd)
  const pluginStyles = await loadPluginOutputStyles()

  // Start with built-in modes
  const allStyles = {
    ...OUTPUT_STYLE_CONFIG,
  }

  const managedStyles = customStyles.filter(
    style => style.source === 'policySettings',
  )
  const userStyles = customStyles.filter(
    style => style.source === 'userSettings',
  )
  const projectStyles = customStyles.filter(
    style => style.source === 'projectSettings',
  )

  // Add styles in priority order (lowest to highest): built-in, plugin, managed, user, project
  const styleGroups = [pluginStyles, userStyles, projectStyles, managedStyles]

  for (const styles of styleGroups) {
    for (const style of styles) {
      allStyles[style.name] = {
        name: style.name,
        description: style.description,
        prompt: style.prompt,
        source: style.source,
        keepCodingInstructions: style.keepCodingInstructions,
        forceForPlugin: style.forceForPlugin,
      }
    }
  }

  return allStyles
})

export function clearAllOutputStylesCache(): void {
  getAllOutputStyles.cache?.clear?.()
}

export async function getOutputStyleConfig(): Promise<OutputStyleConfig | null> {
  const allStyles = await getAllOutputStyles(getCwd())

  // Check for forced plugin output styles
  const forcedStyles = Object.values(allStyles).filter(
    (style): style is OutputStyleConfig =>
      style !== null &&
      style.source === 'plugin' &&
      style.forceForPlugin === true,
  )

  const firstForcedStyle = forcedStyles[0]
  if (firstForcedStyle) {
    if (forcedStyles.length > 1) {
      logForDebugging(
        `Multiple plugins have forced output styles: ${forcedStyles.map(s => s.name).join(', ')}. Using: ${firstForcedStyle.name}`,
        { level: 'warn' },
      )
    }
    logForDebugging(
      `Using forced plugin output style: ${firstForcedStyle.name}`,
    )
    return firstForcedStyle
  }

  const settings = getSettings_DEPRECATED()
  const outputStyle = (settings?.outputStyle ||
    DEFAULT_OUTPUT_STYLE_NAME) as string

  return allStyles[outputStyle] ?? null
}

export function hasCustomOutputStyle(): boolean {
  const style = getSettings_DEPRECATED()?.outputStyle
  return style !== undefined && style !== DEFAULT_OUTPUT_STYLE_NAME
}
