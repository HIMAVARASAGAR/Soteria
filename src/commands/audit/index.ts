import type { Command } from '../../commands.js'

const audit = {
  type: 'local',
  name: 'audit',
  description: 'Run comprehensive deterministic cybersecurity audit (SCA, SAST, Secrets, Containers, SBOM scorecard)',
  supportsNonInteractive: true,
  load: () => import('./audit.js'),
} satisfies Command

export default audit
