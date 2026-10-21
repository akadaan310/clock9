/** CLOCK9/0.1: tiny grammar-clocked hybrid computation research kernel.
 * Browser-capable ESM, CPU-only, no network, no external dependencies, no LLM weights.
 * Not a neural LLM; an optional external model adapter can PROPOSE typed ops.
 */
export type OpName = 'add' | 'sub' | 'mul' | 'neg';
export type Op = {kind:OpName, value?:number};
export type Program = {version:1, ops:Op[]};
export type EventKind = 'context' | 'draft' | 'admission' | 'compile' | 'promote' | 'witness';
export type Event = {beat:number,kind:EventKind,details:string};
export type Result = {program:Program, code:string, address:string, valid:boolean, proof:{x:number,interpreted:number,compiled:number}[], events:Event[], generator:'clock9-non-neural'|'adapter-proposal'};
export type TinyModel = (context:{goal:string, allowed:OpName[], limit:number})=>Promise<Op[]>;

function canonical(value: unknown): string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object') {
    const x=value as Record<string,unknown>;
    return `{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash32(input:string):string {
  let h=2166136261;
  for(let i=0;i<input.length;i++) {h=Math.imul(h ^ input.charCodeAt(i),16777619)>>>0;}
  return h.toString(16).padStart(8,'0');
}
function finite(n:unknown): n is number { return typeof n==='number' && Number.isFinite(n); }
export function validate(p:Program, budget=6):string[] {
  const faults:string[]=[];
  if(p.version!==1) faults.push('schema_version');
  if(!Array.isArray(p.ops)||p.ops.length<1||p.ops.length>budget) return [...faults,'program_length'];
  const allowed:OpName[]=['add','sub','mul','neg'];
  for(let i=0;i<p.ops.length;i++) {
    const op=p.ops[i]!;
    if(!allowed.includes(op.kind)) faults.push(`operator_${i}`);
    if(op.kind==='neg' && op.value!==undefined) faults.push(`neg_operand_${i}`);
    if(op.kind!=='neg' && (!finite(op.value)||!Number.isInteger(op.value)||Math.abs(op.value)>5)) faults.push(`operand_${i}`);
  }
  return faults;
}
export function interpret(p:Program, x:number):number {
  if(validate(p).length) throw Error('Invalid program');
  let v=x;
  for(const op of p.ops) {
    switch(op.kind) {
      case 'add': v+=op.value!; break;
      case 'sub': v-=op.value!; break;
      case 'mul': v*=op.value!; break;
      case 'neg': v=-v; break;
    }
  }
  return v;
}
/** Independent affine summarizer: output = a*x + b, with exact small integer constraints. */
export function affine(p:Program):{a:number,b:number} {
  if(validate(p).length) throw Error('Invalid program');
  let a=1,b=0;
  for(const op of p.ops) {
    switch(op.kind) {
      case 'add': b+=op.value!; break;
      case 'sub': b-=op.value!; break;
      case 'mul': a*=op.value!; b*=op.value!; break;
      case 'neg': a=-a; b=-b; break;
    }
  }
  return {a,b};
}
export function renderCode(p:Program):string {
  const {a,b}=affine(p);
  return `export function transform(x: number): number {\n  return ${a} * x + (${b});\n}\n`;
}
export function programAddress(p:Program):string {
  if(validate(p).length) throw Error('Invalid program');
  const content=canonical(p);
  return `clock9://program/${encodeURIComponent(content)}.${hash32(content)}`;
}
export function resolveAddress(addr:string):Program {
  const prefix='clock9://program/';
  if(!addr.startsWith(prefix)) throw Error('Invalid address');
  const after=addr.slice(prefix.length);const dot=after.lastIndexOf('.');
  if(dot<0) throw Error('Missing checksum');
  let src:string;
  try {src=decodeURIComponent(after.slice(0,dot));} catch {throw Error('Invalid encoding');}
  if(hash32(src)!==after.slice(dot+1))throw Error('Checksum mismatch');
  const obj=JSON.parse(src) as Program;
  if(validate(obj).length||canonical(obj)!==src)throw Error('Noncanonical or invalid program');
  return obj;
}

/** Tiny transparent variable-order n-gram estimator (counts and suffix backoff). */
export class NGram {
  private transitions=new Map<string,Map<OpName,number>>();
  constructor(private readonly maxOrder=4) {if(maxOrder<1||maxOrder>16)throw Error('maxOrder out of range');}
  observe(words:OpName[]):void {
    const seq:OpName[]=[];
    for(const word of words) {
      for(let n=0;n<=Math.min(this.maxOrder,seq.length);n++) {
        const key=seq.slice(seq.length-n).join('|');
        const d=this.transitions.get(key)??new Map<OpName,number>();
        d.set(word,(d.get(word)??0)+1);this.transitions.set(key,d);
      }
      seq.push(word);
    }
  }
  distribution(prefix:OpName[]):{order:number, counts:[OpName,number][]} {
    for(let n=Math.min(this.maxOrder,prefix.length);n>=0;n--){
      const found=this.transitions.get(prefix.slice(prefix.length-n).join('|'));
      if(found) return {order:n,counts:[...found.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))};
    }
    return {order:0,counts:[]};
  }
  next(prefix:OpName[], permitted:OpName[]):OpName|null {
    const counts=this.distribution(prefix).counts.filter(x=>permitted.includes(x[0]));
    return counts[0]?.[0]??null;
  }
}

/** Certified motif: a repeated operation sequence receives a reversible letter. */
export type Plica = {glyph:string, unfolded:OpName[], occurrences:number, certificate:string};
export function promoteWords(sequences:OpName[][],minOccurrences=2):Plica[] {
  const counts=new Map<string,number>();
  for(const seq of sequences)for(let i=0;i<seq.length-1;i++){
    const word=[seq[i]!,seq[i+1]!].join('|');
    counts.set(word,(counts.get(word)??0)+1);
  }
  return [...counts.entries()].filter(([,count])=>count>=minOccurrences).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([word,occurrences],i)=>{
    const unfolded=word.split('|') as OpName[];
    return {glyph:`P${i+1}`,unfolded,occurrences,certificate:hash32(canonical({unfolded,occurrences}))};
  });
}
export function unfold(plica:Plica):OpName[] {
  const check=hash32(canonical({unfolded:plica.unfolded,occurrences:plica.occurrences}));
  if(check!==plica.certificate)throw Error('Invalid plica');
  return [...plica.unfolded];
}

const CORPUS:OpName[][]=[
  ['add','mul','add'],['add','mul','neg'],['mul','add','sub'],
  ['add','mul','sub'],['neg','add','mul'],['add','mul','add']
];
function opWithValue(kind:OpName,position:number):Op {
  return kind==='neg'?{kind}:{kind,value:kind==='mul'?2:(position%5)+1};
}
export class Clock9 {
  readonly index=new NGram(3);
  readonly motifs:Plica[];
  constructor() {for(const row of CORPUS)this.index.observe(row);this.motifs=promoteWords(CORPUS);}
  /** No real-time sleep. "Clock" denotes ordered verifiable computational beats. */
  async generate(goal:string, adapter?:TinyModel):Promise<Result> {
    const events:Event[]=[]; let beat=0;
    const emit=(kind:EventKind,details:string)=>events.push({beat:beat++,kind,details});
    emit('context',`goal:${goal.slice(0,80)}; admitted DSL: add/sub/mul/neg`);
    let ops:Op[];
    if(adapter){ ops=await adapter({goal,allowed:['add','sub','mul','neg'],limit:6}); }
    else {
      const letters:OpName[]=[];
      for(let i=0;i<3;i++){
        const next=this.index.next(letters,['add','sub','mul','neg']);
        letters.push(next??'add');
      }
      ops=letters.map(opWithValue);
    }
    emit('draft',ops.map(x=>x.kind).join(','));
    const program:Program={version:1,ops};
    const failures=validate(program);
    emit('admission',failures.length?`rejected:${failures.join(',')}`:'accepted');
    if(failures.length)throw Error(`Candidate rejected: ${failures.join(',')}`);
    const code=renderCode(program);
    emit('compile',`typed affine program length=${ops.length}; source bytes=${code.length}`);
    const motif=this.motifs.find(x=>x.unfolded.join('|')===ops.slice(0,2).map(x=>x.kind).join('|'));
    emit('promote',motif?`reused:${motif.glyph}, certificate:${motif.certificate}`:'no certified motif');
    const {a,b}=affine(program);
    const proof=[-3,-1,0,2,7].map(x=>({x,interpreted:interpret(program,x),compiled:a*x+b}));
    const valid=proof.every(x=>x.interpreted===x.compiled);
    emit('witness',`affine proof samples:${proof.length}; ${valid?'PASS':'FAIL'}`);
    return {program,code,address:programAddress(program),valid,proof,events,generator:adapter?'adapter-proposal':'clock9-non-neural'};
  }
}
