import { z } from 'zod/v4'
import * as fs from 'fs'
import * as path from 'path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export interface SBOMComponent {
  name: string
  version: string
  purl: string
  ecosystem: 'npm' | 'pypi' | 'cargo' | 'golang' | 'generic'
  license?: string
  description?: string
}

export interface CycloneDXBom {
  bomFormat: 'CycloneDX'
  specVersion: '1.5'
  serialNumber: string
  version: number
  metadata: {
    timestamp: string
    tools: { vendor: string; name: string; version: string }[]
    component?: {
      name: string
      version: string
      type: string
    }
  }
  components: {
    type: 'library' | 'application'
    name: string
    version: string
    purl: string
    licenses?: { license: { id: string } }[]
    description?: string
  }[]
}

export interface SPDXBom {
  spdxVersion: 'SPDX-2.3'
  dataLicense: 'CC0-1.0'
  SPDXID: 'SPDXRef-DOCUMENT'
  name: string
  creationInfo: {
    created: string
    creators: string[]
  }
  packages: {
    SPDXID: string
    name: string
    versionInfo: string
    downloadLocation: string
    licenseConcluded: string
    externalRefs: {
      referenceCategory: 'PACKAGE-MANAGER'
      referenceType: 'purl'
      referenceLocator: string
    }[]
  }[]
}

export function generatePurl(ecosystem: string, name: string, version: string): string {
  const cleanVer = version.replace(/^[\^~>=<v]/, '')
  if (ecosystem === 'npm') {
    if (name.startsWith('@')) {
      const [scope, pkg] = name.split('/')
      return `pkg:npm/${encodeURIComponent(scope)}/${pkg}@${cleanVer}`
    }
    return `pkg:npm/${name}@${cleanVer}`
  }
  if (ecosystem === 'pypi') {
    return `pkg:pypi/${name.toLowerCase()}@${cleanVer}`
  }
  if (ecosystem === 'cargo') {
    return `pkg:cargo/${name}@${cleanVer}`
  }
  if (ecosystem === 'golang') {
    return `pkg:golang/${name}@${cleanVer}`
  }
  return `pkg:generic/${name}@${cleanVer}`
}

export function extractComponentsFromDir(cwd: string): { rootName: string; rootVersion: string; components: SBOMComponent[] } {
  const components: SBOMComponent[] = []
  let rootName = 'workspace-project'
  let rootVersion = '1.0.0'

  // 1. package.json
  const pkgPath = path.join(cwd, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (parsed.name) rootName = parsed.name
      if (parsed.version) rootVersion = parsed.version

      const allDeps = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
      }

      for (const [name, rawVer] of Object.entries(allDeps)) {
        if (typeof rawVer === 'string') {
          const ver = rawVer.replace(/^[\^~>=<v]/, '')
          components.push({
            name,
            version: ver,
            ecosystem: 'npm',
            purl: generatePurl('npm', name, ver),
          })
        }
      }
    } catch {
      // Ignore
    }
  }

  // 2. requirements.txt
  const reqPath = path.join(cwd, 'requirements.txt')
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, 'utf8')
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:==|>=|<=|~=)\s*([a-zA-Z0-9_.-]+)/)
        if (match) {
          const name = match[1]
          const version = match[2]
          components.push({
            name,
            version,
            ecosystem: 'pypi',
            purl: generatePurl('pypi', name, version),
          })
        }
      }
    } catch {
      // Ignore
    }
  }

  // Deduplicate by purl
  const seen = new Set<string>()
  const unique = components.filter(c => {
    if (seen.has(c.purl)) return false
    seen.add(c.purl)
    return true
  })

  return { rootName, rootVersion, components: unique }
}

export function buildCycloneDX(rootName: string, rootVersion: string, components: SBOMComponent[]): CycloneDXBom {
  const now = new Date().toISOString()
  const randomUuid = `urn:uuid:${Math.random().toString(36).substring(2, 10)}-${Date.now()}`

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: randomUuid,
    version: 1,
    metadata: {
      timestamp: now,
      tools: [
        {
          vendor: 'Soteria',
          name: 'Soteria CyberIDE SBOM Generator',
          version: '1.0.0',
        },
      ],
      component: {
        name: rootName,
        version: rootVersion,
        type: 'application',
      },
    },
    components: components.map(c => ({
      type: 'library',
      name: c.name,
      version: c.version,
      purl: c.purl,
      licenses: c.license ? [{ license: { id: c.license } }] : undefined,
      description: c.description,
    })),
  }
}

export function buildSPDX(rootName: string, rootVersion: string, components: SBOMComponent[]): SPDXBom {
  const now = new Date().toISOString()

  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${rootName}@${rootVersion}`,
    creationInfo: {
      created: now,
      creators: ['Tool: Soteria-CyberIDE-1.0.0'],
    },
    packages: components.map((c, i) => ({
      SPDXID: `SPDXRef-Package-${i + 1}-${c.name.replace(/[^a-zA-Z0-9]/g, '-')}`,
      name: c.name,
      versionInfo: c.version,
      downloadLocation: 'NOASSERTION',
      licenseConcluded: c.license || 'NOASSERTION',
      externalRefs: [
        {
          referenceCategory: 'PACKAGE-MANAGER',
          referenceType: 'purl',
          referenceLocator: c.purl,
        },
      ],
    })),
  }
}

export function formatSBOMMarkdown(rootName: string, rootVersion: string, components: SBOMComponent[]): string {
  let md = `### Software Bill of Materials (SBOM) Summary\n\n`
  md += `**Root Component:** \`${rootName}@${rootVersion}\`\n`
  md += `**Total Included Components:** ${components.length}\n\n`

  if (components.length === 0) {
    md += `No third-party packages detected in workspace manifests.\n`
    return md
  }

  md += `| Package | Version | Ecosystem | Package URL (purl) |\n`
  md += `|:---|:---|:---|:---|\n`

  for (const c of components) {
    md += `| **${c.name}** | \`${c.version}\` | \`${c.ecosystem}\` | \`${c.purl}\` |\n`
  }

  return md
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    format: z
      .enum(['CycloneDX', 'SPDX', 'Markdown'])
      .optional()
      .describe('Output format for SBOM (CycloneDX JSON, SPDX JSON, or Markdown table). Defaults to CycloneDX.'),
    outputPath: z
      .string()
      .optional()
      .describe('Optional file path to save the generated SBOM (e.g. sbom.cdx.json).'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    rootName: z.string(),
    rootVersion: z.string(),
    totalComponents: z.number(),
    format: z.string(),
    savedPath: z.string().optional(),
    sbomData: z.any(),
    markdownSummary: z.string(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

import { getCwd } from '../../utils/cwd.js'

export const SBOMGeneratorTool = buildTool({
  name: 'generate_sbom',
  searchHint: 'generate sbom cyclonedx spdx bill of materials dependencies inventory compliance',
  description: async () =>
    'Generates a standardized Software Bill of Materials (SBOM) conforming to CycloneDX v1.5 or SPDX 2.3 specifications, with Package URLs (purls), versions, and ecosystems for compliance and inventory tracking.',
  prompt: async () =>
    'Generates standardized Software Bill of Materials (SBOM) conforming to CycloneDX v1.5 or SPDX 2.3 specifications.',
  maxResultSizeChars: 100_000,
  renderToolUseMessage: () => null,
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.markdownSummary,
    }
  },
  inputSchema: inputSchema(),
  outputSchema: outputSchema(),
  isConcurrencySafe: () => true,
  isReadOnly: () => false,
  isEnabled: () => true,
  async call({ format = 'CycloneDX', outputPath }, _context) {
    const cwd = getCwd()
    const { rootName, rootVersion, components } = extractComponentsFromDir(cwd)

    let sbomData: any
    if (format === 'SPDX') {
      sbomData = buildSPDX(rootName, rootVersion, components)
    } else {
      sbomData = buildCycloneDX(rootName, rootVersion, components)
    }

    let savedPath: string | undefined
    if (outputPath) {
      const resolvedOutput = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath)
      fs.writeFileSync(
        resolvedOutput,
        typeof sbomData === 'string' ? sbomData : JSON.stringify(sbomData, null, 2),
        'utf8',
      )
      savedPath = resolvedOutput
    }

    const markdownSummary = formatSBOMMarkdown(rootName, rootVersion, components)

    return {
      data: {
        rootName,
        rootVersion,
        totalComponents: components.length,
        format,
        savedPath,
        sbomData,
        markdownSummary,
      },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
