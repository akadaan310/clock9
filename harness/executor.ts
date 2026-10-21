/** Node-only: independent executor that runs generated Python in harness/sandbox.py. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Example, ExecResult, Executor } from '../src/solver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SANDBOX = path.join(ROOT, 'harness', 'sandbox.py');

function runSandbox(payload: unknown): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // --net: no network (only a down loopback); --mount: private mounts so sandbox.py can seal /tmp etc.
    const p = spawn('unshare', ['--net', '--mount', 'python3', '-I', SANDBOX], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => {
      try { resolve(JSON.parse(out.trim().split('\n').pop()!)); }
      catch { reject(Error(`sandbox failed (${code}): ${err.slice(-300)}`)); }
    });
    p.stdin.end(JSON.stringify(payload));
  });
}

export class PythonSandbox implements Executor {
  readonly id = 'python3-sandbox(unshare-net,uid65534,rlimits)';
  run(code: string, tests: Example[]): Promise<ExecResult> { return runSandbox({ mode: 'io', code, tests }); }
  runProgram(program: string): Promise<ExecResult> { return runSandbox({ mode: 'humaneval', program }); }
}
