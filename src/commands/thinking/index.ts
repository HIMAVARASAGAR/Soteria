import type { Command } from '../../commands.js'

const command = {
  name: 'thinking',
  aliases: ['think'],
  description: 'Toggle thinking mode (reasoning budget) for supported models',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./thinking.js'),
} satisfies Command

export default command
