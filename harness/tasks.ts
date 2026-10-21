/** Node-only loaders for the frozen task files. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toDsl, type Pipeline } from '../src/listops/ast.js';
import type { Example } from '../src/solver.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export type ListOpsTask = { id: string; split: 'train' | 'id' | 'para' | 'oog' | 'blind'; prompt: string; signature: string; visible: Example[]; hidden: Example[]; ast: Pipeline | null; reference_python: string | null };
export type HumanEvalTask = { task_id: string; prompt: string; canonical_solution: string; test: string; entry_point: string };

const jsonl = <T>(f: string): T[] => readFileSync(path.join(ROOT, 'tasks', f), 'utf8').trim().split('\n').map(l => JSON.parse(l) as T);
export const loadListOps = (f = 'listops.jsonl') => jsonl<ListOpsTask>(f);
export const loadHumanEval = () => jsonl<HumanEvalTask>('humaneval.jsonl');
export const trainPairs = (tasks: ListOpsTask[]) => tasks.filter(t => t.split === 'train').map(t => ({ prompt: t.prompt, dsl: toDsl(t.ast!) }));
