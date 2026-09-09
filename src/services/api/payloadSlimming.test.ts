import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import {
  isConstrainedProvider,
  getConciseToolDescription,
  slimToolSchema,
  getSlimSystemPrompt,
} from './payloadSlimming.js'
import { convertTools } from './openaiShim.js'

describe('payloadSlimming', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.SOTERIA_SLIM_PAYLOAD
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isConstrainedProvider', () => {
    test('detects Groq endpoint via baseUrl', () => {
      expect(isConstrainedProvider('https://api.groq.com/openai/v1', 'some-model')).toBe(true)
      expect(isConstrainedProvider('https://custom-groq-proxy.internal/v1', 'some-model')).toBe(true)
    })

    test('detects Groq endpoint via OPENAI_BASE_URL env', () => {
      process.env.OPENAI_BASE_URL = 'https://api.groq.com/openai/v1'
      expect(isConstrainedProvider(undefined, 'some-model')).toBe(true)
    })

    test('detects Groq model prefixes and gpt-oss-120b', () => {
      expect(isConstrainedProvider('https://example.com/v1', 'groq:llama-3.3-70b-versatile')).toBe(true)
      expect(isConstrainedProvider('https://example.com/v1', 'openai/gpt-oss-120b')).toBe(true)
    })

    test('detects local provider URLs (e.g. Ollama, LM Studio)', () => {
      expect(isConstrainedProvider('http://localhost:11434/v1', 'llama3')).toBe(true)
      expect(isConstrainedProvider('http://127.0.0.1:1234/v1', 'mistral')).toBe(true)
    })

    test('returns false for standard unconstrained models on OpenAI', () => {
      expect(isConstrainedProvider('https://api.openai.com/v1', 'gpt-4o')).toBe(false)
      expect(isConstrainedProvider('https://integrate.api.nvidia.com/v1', 'deepseek-ai/deepseek-v4-pro-0813')).toBe(false)
    })

    test('honors SOTERIA_SLIM_PAYLOAD override', () => {
      process.env.SOTERIA_SLIM_PAYLOAD = '1'
      expect(isConstrainedProvider('https://api.openai.com/v1', 'gpt-4o')).toBe(true)

      process.env.SOTERIA_SLIM_PAYLOAD = '0'
      expect(isConstrainedProvider('https://api.groq.com/openai/v1', 'openai/gpt-oss-120b')).toBe(false)
    })
  })

  describe('getConciseToolDescription', () => {
    test('returns concise description for standard tools', () => {
      expect(getConciseToolDescription('Bash')).toBe(
        'Execute a bash command in the terminal. Returns stdout, stderr, and exit code. Use for system commands, tests, git, builds.',
      )
      expect(getConciseToolDescription('FileEdit')).toBe(
        'Edit an existing file by replacing an exact contiguous block of text (old_string) with new content (new_string).',
      )
      expect(getConciseToolDescription('WebSearch')).toBe(
        'Search the web using a search engine query and return results.',
      )
      expect(getConciseToolDescription('WebBrowser')).toBe(
        'Browse a web page using a headless browser to extract dynamic content or inspect layout.',
      )
    })

    test('truncates lengthy custom/MCP descriptions to first sentence', () => {
      const longDesc = 'This tool performs deep security analysis on binaries. It inspects symbols, ELF headers, relocations, and vulnerabilities across multiple architectures.'
      const concise = getConciseToolDescription('CustomAnalyzer', longDesc)
      expect(concise).toBe('This tool performs deep security analysis on binaries.')
    })
  })

  describe('slimToolSchema', () => {
    test('truncates multi-paragraph property descriptions to concise 1-sentence summaries', () => {
      const originalSchema = {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute in the terminal. Make sure to quote parameters properly and do not run interactive prompts. Long explanations here...',
          },
          timeout: {
            type: 'number',
            description: 'Optional timeout in milliseconds.',
          },
        },
        required: ['command'],
      }

      const slimmed = slimToolSchema(originalSchema)
      expect(slimmed.type).toBe('object')
      expect(slimmed.required).toEqual(['command'])
      const props = slimmed.properties as Record<string, { description: string }>
      expect(props.command.description).toBe('The shell command to execute in the terminal.')
      expect(props.timeout.description).toBe('Optional timeout in milliseconds.')
    })
  })

  describe('getSlimSystemPrompt', () => {
    test('condenses verbose system prompt while preserving working directory and platform', () => {
      const verbosePrompt = `You are Soteria, an interactive general-purpose assistant...
${'Lots of words '.repeat(1000)}
Primary working directory: /Users/test/myproject
Platform: darwin
Shell: /bin/zsh
OS Version: Darwin 24.1.0
${'More guidance and output efficiency essays '.repeat(500)}
# Additional Instructions
Always run tests before committing.`

      const slim = getSlimSystemPrompt(verbosePrompt)
      expect(slim.length).toBeLessThan(1200)
      expect(slim).toContain('Working directory: /Users/test/myproject')
      expect(slim).toContain('Platform: darwin')
      expect(slim).toContain('Shell: /bin/zsh')
      expect(slim).toContain('Always run tests before committing.')
      expect(slim).toContain('You are Soteria')
    })
  })

  describe('convertTools with isConstrained: true', () => {
    test('massively reduces token size compared to unconstrained tools', () => {
      const verboseTools = [
        {
          name: 'Bash',
          description: 'A'.repeat(5000), // e.g. the 5k char git tutorial in BashTool
          input_schema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'B'.repeat(500) },
              run_in_background: { type: 'boolean', description: 'C'.repeat(500) },
            },
            required: ['command'],
          },
        },
        {
          name: 'FileEdit',
          description: 'D'.repeat(3000),
          input_schema: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'E'.repeat(300) },
              old_string: { type: 'string', description: 'F'.repeat(300) },
              new_string: { type: 'string', description: 'G'.repeat(300) },
            },
            required: ['file_path', 'old_string', 'new_string'],
          },
        },
      ]

      const unconstrained = convertTools(verboseTools, { isConstrained: false })
      const unconstrainedJson = JSON.stringify(unconstrained)

      const constrained = convertTools(verboseTools, { isConstrained: true })
      const constrainedJson = JSON.stringify(constrained)

      // The constrained tools should be at least 80% smaller
      expect(constrainedJson.length).toBeLessThan(unconstrainedJson.length * 0.2)
      expect(constrained[0].function.description).toBe(
        'Execute a bash command in the terminal. Returns stdout, stderr, and exit code. Use for system commands, tests, git, builds.',
      )
    })

    test('total initial payload for 15 core tools + system prompt is under 2,500 tokens (well below Groq 8,000 limit)', () => {
      const coreToolNames = [
        'Bash',
        'FileRead',
        'FileEdit',
        'FileWrite',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'WebBrowser',
        'AskUserQuestion',
        'Agent',
        'TodoWrite',
        'TaskCreate',
        'TaskUpdate',
        'TaskList',
      ]

      const mockTools = coreToolNames.map(name => ({
        name,
        description: `${name} tool with extensive multi-paragraph documentation `.repeat(50),
        input_schema: {
          type: 'object',
          properties: {
            arg1: { type: 'string', description: 'Verbose description '.repeat(20) },
            arg2: { type: 'number', description: 'More parameter explanation '.repeat(20) },
          },
          required: ['arg1'],
        },
      }))

      const slimTools = convertTools(mockTools, { isConstrained: true })
      const slimPrompt = getSlimSystemPrompt(`You are Soteria... ${'guidance '.repeat(1000)} Primary working directory: /my/dir Platform: darwin Shell: zsh OS Version: 1.0`)
      const userMessage = { role: 'user', content: 'hi' }

      const totalChars =
        JSON.stringify(slimTools).length +
        slimPrompt.length +
        userMessage.content.length

      // Conservative token estimate: 1 token ~= 3.5 characters
      const approxTokens = Math.ceil(totalChars / 3.5)

      // Must be well below Groq's 8,000 TPM limit
      expect(approxTokens).toBeLessThan(2500)
    })
  })
})
