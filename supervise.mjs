import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const results = process.env.LAB_RESULTS;
const home = process.env.LAB_HOME;
if (!results || !home) throw new Error('Explicit LAB_RESULTS and LAB_HOME required');
fs.mkdirSync(results, { recursive: true });
fs.mkdirSync(path.join(home, 'temp'), { recursive: true });
const boundedNumber = (name, fallback, minimum, maximum) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
};
const timeout = boundedNumber('LAB_TIMEOUT_SECONDS', 5100, 1, 5100) * 1000;
const outputLimit = boundedNumber('LAB_OUTPUT_BYTES', 67108864, 1024, 67108864);
const storageLimit = boundedNumber('LAB_STORAGE_BYTES', 2147483648, 1024, 2147483648);
const reserve = boundedNumber('LAB_RESERVE_BYTES', 8589934592, 1024, Number.MAX_SAFE_INTEGER);
const environment = {
  ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, '.local', 'share'),
  TMPDIR: path.join(home, 'temp'), TEMP: path.join(home, 'temp'), TMP: path.join(home, 'temp'),
  DOTNET_GCHeapHardLimit: '80000000', LAB_RESULTS: results,
};
const fixture = process.env.LAB_FIXTURE;
const fixtures = {
  normal: "console.log(JSON.stringify({Utc:new Date().toISOString(),Phase:'Install',Stream:'PhaseStart',Message:'Install'}));console.log(JSON.stringify({Utc:new Date().toISOString(),Phase:'Import',Stream:'Verbose',Message:'fixture import'}));",
  error: "console.error('synthetic explicit error');process.exit(7)",
  timeout: "setInterval(()=>{},100)",
  output: "setInterval(()=>console.log('x'.repeat(8192)),5)",
  storage: "setInterval(()=>{},100)",
};
if (fixture && !Object.hasOwn(fixtures, fixture)) throw new Error('Unknown synthetic fixture');
const executable = fixture ? process.execPath : process.env.PWSH_PATH;
if (!executable) throw new Error('PWSH_PATH required');
const args = fixture ? ['-e', fixtures[fixture]] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'Invoke-GalleryCheck.ps1')];
const began = Date.now();
const record = { startUtc: new Date().toISOString(), endUtc: null, reason: null, exitCode: null,
  outputBytes: 0, records: 0, streams: {}, phaseStreams: {}, phaseStarts: {}, limits: { timeoutSeconds: timeout / 1000, outputLimit, storageLimit, reserve } };
const consoleFile = fs.openSync(path.join(results, 'console.txt'), 'wx');
const eventsFile = fs.openSync(path.join(results, 'events.jsonl'), 'wx');
let child;
let stopCode;
let currentPhase = 'Preparation';
let phaseStarted = began;
let nativeBuffer = '';
const stop = (reason, code) => {
  if (stopCode !== undefined) return;
  record.reason = reason;
  stopCode = code;
  if (child) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};
const accept = (item) => {
  if (stopCode !== undefined) return;
  const json = `${JSON.stringify(item)}\n`;
  const readable = `${item.Utc} [${item.Phase}] [${item.Stream}] ${item.Message}\n`;
  const bytes = Buffer.byteLength(json) + Buffer.byteLength(readable);
  if (record.outputBytes + bytes > outputLimit) return stop('output-limit', 125);
  fs.writeSync(eventsFile, json);
  fs.writeSync(consoleFile, readable);
  process.stdout.write(readable);
  record.outputBytes += bytes;
  record.records++;
  record.streams[item.Stream] = (record.streams[item.Stream] ?? 0) + 1;
  const phaseCounts = record.phaseStreams[item.Phase] ??= {};
  phaseCounts[item.Stream] = (phaseCounts[item.Stream] ?? 0) + 1;
  if (item.Stream === 'PhaseStart') {
    currentPhase = item.Phase;
    phaseStarted = Date.now();
    record.phaseStarts[item.Phase] = item.Utc;
  }
};
const raw = (text, stream) => accept({ Utc: new Date().toISOString(), Phase: currentPhase, Stream: stream, Message: text });
const consume = (chunk) => {
  if (stopCode !== undefined) return;
  nativeBuffer += chunk;
  if (Buffer.byteLength(nativeBuffer) > 1048576) return stop('oversized-record', 125);
  let newline;
  while ((newline = nativeBuffer.indexOf('\n')) >= 0) {
    const line = nativeBuffer.slice(0, newline).replace(/\r$/, '');
    nativeBuffer = nativeBuffer.slice(newline + 1);
    let item;
    try { item = JSON.parse(line); } catch { raw(line, 'NativeOutput'); continue; }
    if (item && typeof item.Utc === 'string' && typeof item.Phase === 'string' && typeof item.Stream === 'string' && typeof item.Message === 'string') accept(item);
    else raw(line, 'NativeOutput');
  }
};
const treeBytes = (directory) => {
  const pending = [directory];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
      if (++entries > 100000) return Infinity;
      const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) bytes += fs.statSync(fullPath).size;
      if (bytes > storageLimit) return bytes;
    }
  }
  return bytes;
};
const checkStorage = () => {
  try {
    const stats = fs.statfsSync(home);
    if (stats.bavail * stats.bsize < reserve || treeBytes(home) > storageLimit) stop('storage-limit', 126);
  } catch (error) {
    if (error.code !== 'ENOENT') stop('storage-check-error', 126);
  }
};
child = spawn(executable, args, { env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', consume);
child.stderr.on('data', (chunk) => raw(chunk, 'NativeError'));
child.on('error', (error) => { raw(error.message, 'SupervisorError'); record.reason = 'spawn-error'; stopCode = 127; });
checkStorage();
const clock = setInterval(() => {
  if (Date.now() - began > timeout) stop('deadline', 124);
  const phaseLimit = currentPhase === 'Install' ? 4500000 : currentPhase === 'Import' ? 900000 : timeout;
  if (Date.now() - phaseStarted > phaseLimit) stop('phase-deadline', 124);
}, 100);
const storageClock = setInterval(checkStorage, 2000);
child.on('close', (code, signal) => {
  clearInterval(clock);
  clearInterval(storageClock);
  if (nativeBuffer && stopCode === undefined) raw(nativeBuffer, 'NativeOutput');
  fs.closeSync(consoleFile);
  fs.closeSync(eventsFile);
  record.endUtc = new Date().toISOString();
  record.exitCode = stopCode ?? code ?? 127;
  record.signal = signal;
  record.reason ??= record.exitCode === 0 ? 'completed' : 'child-error';
  fs.writeFileSync(path.join(results, 'supervisor.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.exitCode = record.exitCode;
});