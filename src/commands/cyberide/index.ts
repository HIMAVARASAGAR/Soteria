import type { Command } from '../../commands.js'

const cyberide = {
  type: 'local',
  name: 'cyberide',
  description: 'Launch Soteria standalone web CyberIDE with Monaco Editor and real-time cybersecurity diagnostics',
  argumentHint: '[port]',
  supportsNonInteractive: true,
  load: () => import('./cyberide.js'),
} satisfies Command

export default cyberide
