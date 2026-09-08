import { spawn } from 'node:child_process'

const child = spawn(process.execPath, [
  '--test',
  'scripts/tests/pocketbase-integration.test.mjs',
], {
  env: { ...process.env, POCKETBASE_INTEGRATION: '1' },
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`PocketBase integration tests stopped by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
