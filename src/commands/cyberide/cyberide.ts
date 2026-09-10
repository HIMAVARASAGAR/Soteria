import chalk from 'chalk'
import type { LocalCommandCall } from '../../types/command.js'
import { createCyberIdeServer } from '../../server/cyberIdeServer.js'
import { openBrowser } from '../../utils/browser.js'

let activeServerInstance: any = null
let activePort = 4200

export function getActiveCyberIdeInstance() {
  return { server: activeServerInstance, port: activePort }
}

export const call: LocalCommandCall = async (args, context) => {
  const cwd = (context as any)?.cwd || process.cwd()
  const portArg = parseInt(args?.trim() || '4200', 10)
  const port = isNaN(portArg) ? 4200 : portArg

  if (activeServerInstance) {
    const url = `http://127.0.0.1:${activePort}`
    void openBrowser(url).catch(() => {})
    return {
      type: 'text',
      value: `${chalk.green('✓')} Soteria CyberIDE is already running at ${chalk.bold.cyan(url)} (reopened in browser)`,
    }
  }

  const server = createCyberIdeServer(cwd)

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      activeServerInstance = server
      activePort = port
      resolve()
    })
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Fallback to next port
        server.listen(port + 1, '127.0.0.1', () => {
          activeServerInstance = server
          activePort = port + 1
          resolve()
        })
      } else {
        reject(err)
      }
    })
  })

  const ideUrl = `http://127.0.0.1:${activePort}`
  void openBrowser(ideUrl).catch(() => {})

  let banner = ''
  banner += chalk.bold.cyan(`\n🛡️  Soteria CyberIDE Launched Successfully!\n`)
  banner += chalk.dim(`─────────────────────────────────────────────────────────────\n`)
  banner += `  • URL:                 ${chalk.bold.green(ideUrl)}\n`
  banner += `  • Workspace:           ${chalk.dim(cwd)}\n`
  banner += `  • Monaco Editor:       ${chalk.cyan('Enabled (Real-time SAST & Secret Squiggles)')}\n`
  banner += `  • Security Drawer:     ${chalk.yellow('Active (SCA, Taint Tracing, Container Linter, SBOM)')}\n`
  banner += `  • Soteria AI Copilot:  ${chalk.magenta('Connected')}\n`
  banner += chalk.dim(`─────────────────────────────────────────────────────────────\n\n`)

  return {
    type: 'text',
    value: banner,
  }
}
