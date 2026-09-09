const build = Bun.spawnSync({
  cmd: ['bun', 'scripts/build.ts'],
  cwd: process.cwd(),
  stdout: 'pipe',
  stderr: 'pipe',
})

if (!build.success) {
  process.stdout.write(build.stdout)
  process.stderr.write(build.stderr)
  process.exit(build.exitCode)
}

const cli = Bun.spawn({
  cmd: ['node', 'bin/soteria', ...process.argv.slice(2)],
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

process.exit(await cli.exited)
