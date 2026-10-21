import {Clock9,resolveAddress,programAddress} from './clock9.js';
const engine=new Clock9();
const result=await engine.generate('Compose a typed transformation for a geometric illustration');
console.log(JSON.stringify({mode:result.generator,ops:result.program.ops,code:result.code,uri:result.address,verification:result.valid,proof:result.proof,trace:result.events,decode_ok:programAddress(resolveAddress(result.address))===result.address,motifs:engine.motifs.slice(0,3)},null,2));
