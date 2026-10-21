import { Clock9 } from './clock9.js';
const engine=new Clock9();
const warm=100;
for(let i=0;i<warm;i++) await engine.generate('warmup');
const n=1000;const timings:number[]=[];
const start=performance.now();
for(let i=0;i<n;i++) {
  const t=performance.now();
  const result=await engine.generate('generate a short typed numeric operation');
  if(!result.valid)throw Error('invalid proposal');
  timings.push(performance.now()-t);
}
const total=performance.now()-start;
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({kind:'CPU_ONLY_KERNEL_MICROBENCHMARK_NOT_LLM',environment:'current host Node.js, not Android',n,average_ms:total/n,p50_ms:timings[Math.floor(n*.5)],p95_ms:timings[Math.floor(n*.95)],throughput_proposals_per_second:1000*n/total,precision:'includes in-memory proposal, trace, independent affine verification; excludes IO and model inference'},null,2));
