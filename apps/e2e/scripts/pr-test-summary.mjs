#!/usr/bin/env node
// Reads Playwright JSON results and outputs a markdown PR comment body to stdout.
// Usage: node scripts/pr-test-summary.mjs [results-file]

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resultsFile = process.argv[2] || join(__dirname, '../test-results/results.json')

let data
try {
  data = JSON.parse(readFileSync(resultsFile, 'utf8'))
} catch (e) {
  console.log('### 🧪 E2E Test Results\n\n⚠️ No test results found.\n')
  process.exit(0)
}

const { stats } = data

function collectSpecs(suites, results = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      const result = spec.tests?.[0]?.results?.[0]
      const status = result?.status ?? 'unknown'
      const duration = result?.duration ?? 0
      results.push({ suite: suite.title, title: spec.title, status, duration })
    }
    collectSpecs(suite.suites, results)
  }
  return results
}

const specs = collectSpecs(data.suites)
const passed = specs.filter(s => s.status === 'passed')
const failed = specs.filter(s => s.status === 'failed' || s.status === 'unexpected')
const skipped = specs.filter(s => s.status === 'skipped')
const totalDuration = ((stats?.duration ?? 0) / 1000).toFixed(1)

const statusIcon = failed.length > 0 ? '❌' : '✅'
const statusText = failed.length > 0 ? `${failed.length} failed` : 'All passed'

let output = `### ${statusIcon} E2E Tests — ${statusText} · ${totalDuration}s\n\n`
output += `| | Count |\n|---|---|\n`
output += `| ✅ Passed | ${passed.length} |\n`
if (failed.length) output += `| ❌ Failed | ${failed.length} |\n`
if (skipped.length) output += `| ⏭️ Skipped | ${skipped.length} |\n`
output += '\n'

if (failed.length > 0) {
  output += `#### ❌ Failed tests\n\n`
  for (const s of failed) {
    output += `- **${s.suite}** › ${s.title}\n`
  }
  output += '\n'
}

output += `<details>\n<summary>All tests (${specs.length})</summary>\n\n`
for (const s of specs) {
  const icon = s.status === 'passed' ? '✅' : s.status === 'skipped' ? '⏭️' : '❌'
  output += `${icon} ${s.suite} › ${s.title}\n`
}
output += `\n</details>\n`

process.stdout.write(output)
