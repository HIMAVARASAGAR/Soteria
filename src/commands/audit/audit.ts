import * as path from 'path'
import * as fs from 'fs'
import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import {
  scanTextForSecrets,
  collectFilesRecursively as collectSecretFiles,
} from '../../tools/SecretScanTool/SecretScanTool.js'
import {
  scanCodeForVulnerabilities,
  collectScannableFiles,
} from '../../tools/SecurityScanTool/SecurityScanTool.js'
import { analyzeFileForTaint } from '../../tools/TaintAnalysisTool/TaintAnalysisTool.js'
import {
  scanDockerfile,
  scanDockerCompose,
} from '../../tools/ContainerSecurityTool/ContainerSecurityTool.js'
import { extractComponentsFromDir } from '../../tools/SBOMGeneratorTool/SBOMGeneratorTool.js'

export function calculateSecurityGrade(score: number): { grade: string; color: (s: string) => string } {
  if (score >= 95) return { grade: 'A+', color: chalk.greenBright }
  if (score >= 85) return { grade: 'A', color: chalk.green }
  if (score >= 70) return { grade: 'B', color: chalk.yellow }
  if (score >= 50) return { grade: 'C', color: chalk.magenta }
  return { grade: 'F', color: chalk.redBright }
}

export const call: LocalCommandCall = async (args, context) => {
  const cwd = (context as any)?.cwd || process.cwd()
  const targetDir = args?.trim() ? path.resolve(cwd, args.trim()) : cwd

  let output = ''
  output += chalk.bold.cyan(`\n🛡️  Soteria Comprehensive Cybersecurity Audit\n`)
  output += chalk.dim(`Target Directory: ${targetDir}\n\n`)

  // 1. Scan Secrets
  const secretFiles = collectSecretFiles(targetDir)
  const secretFindings: any[] = []
  for (const f of secretFiles) {
    try {
      const content = fs.readFileSync(f, 'utf8')
      const rel = path.relative(cwd, f)
      secretFindings.push(...scanTextForSecrets(content, rel))
    } catch {}
  }

  // 2. SAST Scan
  const sastFiles = collectScannableFiles(targetDir)
  const sastFindings: any[] = []
  for (const f of sastFiles) {
    try {
      const content = fs.readFileSync(f, 'utf8')
      const rel = path.relative(cwd, f)
      sastFindings.push(...scanCodeForVulnerabilities(content, rel))
    } catch {}
  }

  // 3. Taint Analysis
  const taintFindings: any[] = []
  for (const f of sastFiles) {
    try {
      const content = fs.readFileSync(f, 'utf8')
      const rel = path.relative(cwd, f)
      taintFindings.push(...analyzeFileForTaint(content, rel))
    } catch {}
  }

  // 4. Container Security
  const containerFindings: any[] = []
  const dockerfilePaths = [
    path.join(targetDir, 'Dockerfile'),
    path.join(targetDir, 'Dockerfile.dev'),
    path.join(targetDir, 'Dockerfile.prod'),
  ]
  for (const df of dockerfilePaths) {
    if (fs.existsSync(df)) {
      try {
        const content = fs.readFileSync(df, 'utf8')
        containerFindings.push(...scanDockerfile(content, path.relative(cwd, df)))
      } catch {}
    }
  }

  const composePaths = [
    path.join(targetDir, 'docker-compose.yml'),
    path.join(targetDir, 'docker-compose.yaml'),
    path.join(targetDir, 'compose.yml'),
    path.join(targetDir, 'compose.yaml'),
  ]
  for (const cf of composePaths) {
    if (fs.existsSync(cf)) {
      try {
        const content = fs.readFileSync(cf, 'utf8')
        containerFindings.push(...scanDockerCompose(content, path.relative(cwd, cf)))
      } catch {}
    }
  }

  // 5. Dependency / SBOM inventory
  const { rootName, rootVersion, components } = extractComponentsFromDir(targetDir)

  // Aggregation & Scorecard
  let criticalCount = 0
  let highCount = 0
  let mediumCount = 0
  let lowCount = 0

  for (const f of secretFindings) {
    if (f.severity === 'CRITICAL') criticalCount++
    else if (f.severity === 'HIGH') highCount++
    else mediumCount++
  }

  for (const f of sastFindings) {
    if (f.severity === 'CRITICAL') criticalCount++
    else if (f.severity === 'HIGH') highCount++
    else if (f.severity === 'MEDIUM') mediumCount++
    else lowCount++
  }

  for (const f of taintFindings) {
    if (f.severity === 'CRITICAL') criticalCount++
    else highCount++
  }

  for (const f of containerFindings) {
    if (f.severity === 'CRITICAL') criticalCount++
    else if (f.severity === 'HIGH') highCount++
    else if (f.severity === 'MEDIUM') mediumCount++
    else lowCount++
  }

  const rawScore = 100 - (criticalCount * 25 + highCount * 10 + mediumCount * 3 + lowCount * 1)
  const finalScore = Math.max(0, rawScore)
  const { grade, color: gradeColor } = calculateSecurityGrade(finalScore)

  output += chalk.bold(`─────────────────────────────────────────────────────────────\n`)
  output += `Security Score: ${gradeColor(chalk.bold(`${finalScore} / 100`))} (Grade: ${gradeColor(chalk.bold(grade))})\n`
  output += `Total Components Tracked: ${chalk.bold(components.length)} (${rootName}@${rootVersion})\n`
  output += `Vulnerability Breakdown: `
  output += `${chalk.redBright(`CRITICAL: ${criticalCount}`)} | `
  output += `${chalk.yellow(`HIGH: ${highCount}`)} | `
  output += `${chalk.cyan(`MEDIUM: ${mediumCount}`)} | `
  output += `${chalk.dim(`LOW: ${lowCount}`)}\n`
  output += chalk.bold(`─────────────────────────────────────────────────────────────\n\n`)

  // Print Secret Findings
  if (secretFindings.length > 0) {
    output += chalk.bold.redBright(`🔑 Leaked Credentials & Secrets (${secretFindings.length})\n`)
    for (const s of secretFindings) {
      output += `  • [${chalk.redBright(s.severity)}] ${chalk.bold(s.secretType)} in ${chalk.cyan(`${s.file}:${s.line}`)}\n`
      output += `    Masked: ${chalk.dim(s.maskedSecret)} | Snippet: ${chalk.dim(s.contextSnippet)}\n`
    }
    output += '\n'
  }

  // Print SAST Findings
  if (sastFindings.length > 0) {
    output += chalk.bold.redBright(`⚡ Static Code Analysis / SAST Flaws (${sastFindings.length})\n`)
    for (const s of sastFindings) {
      output += `  • [${chalk.yellow(s.severity)}] ${chalk.bold(s.title)} (${s.cwe}) in ${chalk.cyan(`${s.file}:${s.line}`)}\n`
      output += `    Code: ${chalk.dim(s.snippet)}\n`
      output += `    Fix:  ${chalk.green(s.recommendation)}\n`
    }
    output += '\n'
  }

  // Print Taint Findings
  if (taintFindings.length > 0) {
    output += chalk.bold.magenta(`🌊 Exploitable Source-to-Sink Taint Flows (${taintFindings.length})\n`)
    for (const t of taintFindings) {
      output += `  • [${chalk.redBright('CRITICAL')}] ${chalk.bold(t.sinkType)} in ${chalk.cyan(t.file)}\n`
      output += `    Flow: Line ${t.sourceLine} (${t.sourceVariable}) ──> Line ${t.sinkLine} (${t.sinkVariable})\n`
      output += `    Remediation: ${chalk.dim(t.remediation)}\n`
    }
    output += '\n'
  }

  // Print Container Findings
  if (containerFindings.length > 0) {
    output += chalk.bold.yellow(`🐳 Container Misconfigurations (${containerFindings.length})\n`)
    for (const c of containerFindings) {
      output += `  • [${chalk.yellow(c.severity)}] ${chalk.bold(c.title)} in ${chalk.cyan(`${c.file}:${c.line}`)}\n`
      output += `    Fix: ${chalk.green(c.recommendation)}\n`
    }
    output += '\n'
  }

  if (criticalCount === 0 && highCount === 0 && mediumCount === 0 && lowCount === 0) {
    output += chalk.bold.green(`🎉 Excellent! No security flaws or leaked secrets detected.\n\n`)
  } else {
    output += chalk.dim(`Tip: Ask Soteria to remediate any of the issues above automatically!\n\n`)
  }

  return {
    type: 'text',
    value: output,
  }
}
