/** Node-only adapter binding ModelAdapter to a REAL local llama.cpp `llama-server`.
 * Measures: cold load (spawn -> /health ok), per-request prefill/decode from the
 * server's own timings, client wall time, process CPU seconds (utime+stime, an
 * energy proxy; no RAPL on this host) and peak RSS (VmHWM) — never file size. */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Completion, CompletionRequest, ModelAdapter } from '../src/neural/adapter.js';

export const LLAMA_BIN = process.env.LLAMA_BIN ?? '/home/user/ext/llama.cpp/build/bin';
export const MODELS = process.env.CLOCK9_MODELS ?? '/home/user/models';
export const QWEN_SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';

/** Qwen2.5 ChatML, written out explicitly so the exact template is part of the record. */
export function chatml(user: string, system = QWEN_SYSTEM): string {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n`;
}

export type ServerConfig = { name: string; model: string; port: number; threads?: number; ctx?: number; extra?: string[] };
const CLK_TCK = 100;

export class LlamaServer implements ModelAdapter {
  private proc: ChildProcess | null = null;
  loadMs = 0;
  log = '';
  constructor(readonly cfg: ServerConfig) {}
  get id() { return this.cfg.name; }
  get pid() { return this.proc?.pid ?? -1; }
  args(): string[] {
    return ['-m', this.cfg.model, '--port', String(this.cfg.port), '--host', '127.0.0.1',
      '-t', String(this.cfg.threads ?? 4), '-c', String(this.cfg.ctx ?? 4096), '-np', '1',
      '--no-webui', '--metrics', ...(this.cfg.extra ?? [])];
  }
  async start(): Promise<number> {
    const t0 = performance.now();
    this.proc = spawn(`${LLAMA_BIN}/llama-server`, this.args(), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout!.on('data', d => (this.log += d));
    this.proc.stderr!.on('data', d => (this.log += d));
    for (;;) {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) throw Error(`llama-server exited (${this.proc.exitCode ?? this.proc.signalCode}): ${this.log.slice(-800)}`);
      try {
        const r = await fetch(`http://127.0.0.1:${this.cfg.port}/health`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 25));
      if (performance.now() - t0 > 180_000) throw Error('llama-server load timeout');
    }
    this.loadMs = performance.now() - t0;
    return this.loadMs;
  }
  stats(): { cpuSec: number; rssMiB: number; hwmMiB: number } {
    const stat = readFileSync(`/proc/${this.pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const cpuSec = (Number(f[11]) + Number(f[12])) / CLK_TCK;
    const status = readFileSync(`/proc/${this.pid}/status`, 'utf8');
    const kb = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(status)?.[1] ?? 0) / 1024;
    return { cpuSec, rssMiB: kb('VmRSS'), hwmMiB: kb('VmHWM') };
  }
  async complete(req: CompletionRequest): Promise<Completion> {
    const body: Record<string, unknown> = {
      prompt: chatml(req.user, req.system), n_predict: req.maxTokens, seed: req.seed,
      temperature: req.temperature ?? 0, top_k: 1, top_p: 1, min_p: 0, repeat_penalty: 1,
      cache_prompt: false, stop: ['<|im_end|>', '<|endoftext|>'], timings_per_token: false,
    };
    if (req.grammar) body.grammar = req.grammar;
    const t0 = performance.now();
    const r = await fetch(`http://127.0.0.1:${this.cfg.port}/completion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw Error(`llama-server ${r.status}: ${await r.text()}`);
    const j = await r.json() as Record<string, any>;
    const ms = performance.now() - t0;
    const t = j.timings ?? {};
    return {
      text: j.content ?? '', promptTokens: t.prompt_n ?? j.tokens_evaluated ?? 0, genTokens: t.predicted_n ?? j.tokens_predicted ?? 0,
      ms, prefillMs: t.prompt_ms ?? 0, decodeMs: t.predicted_ms ?? 0,
      draftTokens: t.draft_n, draftAccepted: t.draft_n_accepted,
      model: this.cfg.name, stop: j.stop_type ?? String(j.stopped_eos ? 'eos' : j.stopped_limit ? 'limit' : 'word'),
    };
  }
  async stop(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    const p = this.proc;
    await new Promise<void>(res => { p.once('exit', () => res()); p.kill('SIGTERM'); });
  }
}
