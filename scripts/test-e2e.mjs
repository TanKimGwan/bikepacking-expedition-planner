import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// Keep Chromium profiles off a desktop runtime tmpfs that may have a tight quota.
const temporaryRoot = process.platform === 'win32' ? tmpdir() : '/tmp'
const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'bikepacking-playwright-'))
for (const variable of ['TMPDIR', 'TEMP', 'TMP']) process.env[variable] = temporaryDirectory

try {
  const command = process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, ['test', ...process.argv.slice(2)], {
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
