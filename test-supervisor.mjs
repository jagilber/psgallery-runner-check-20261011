import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
for (const [fixture, exitCode, reason] of [
  ['normal', 0, 'completed'], ['error', 7, 'child-error'], ['timeout', 124, 'deadline'],
  ['output', 125, 'output-limit'], ['storage', 126, 'storage-limit'],
]) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-supervisor-'));
  const results = path.join(temporary, 'results');
  const run = spawnSync(process.execPath, [path.join(root, 'supervise.mjs')], {
    env: { ...process.env, LAB_RESULTS: results, LAB_HOME: path.join(temporary, 'home'),
      LAB_FIXTURE: fixture, LAB_TIMEOUT_SECONDS: '1', LAB_OUTPUT_BYTES: '32768',
      LAB_STORAGE_BYTES: '1048576', LAB_RESERVE_BYTES: fixture === 'storage' ? String(Number.MAX_SAFE_INTEGER) : '1024' },
    timeout: 10000, encoding: 'utf8', maxBuffer: 1048576,
  });
  assert.equal(run.status, exitCode, `${fixture}: ${run.stderr}`);
  const summary = JSON.parse(fs.readFileSync(path.join(results, 'supervisor.json'), 'utf8'));
  assert.equal(summary.reason, reason);
  assert.ok(summary.outputBytes <= 32768);
  assert.ok(fs.existsSync(path.join(results, 'events.jsonl')));
  if (fixture === 'normal') assert.equal(summary.phaseStreams.Import.Verbose, 1);
  fs.rmSync(temporary, { recursive: true });
  console.log(`PASS: ${fixture}, exit ${exitCode}, ${reason}, bounded output, preserved summary, fixture-only cleanup`);
}