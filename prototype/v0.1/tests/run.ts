import {Clock9,NGram,interpret,affine,validate,renderCode,programAddress,resolveAddress,promoteWords,unfold,type Program} from '../src/clock9.js';
let ok=0;
function check(assertion:boolean,why:string){if(!assertion)throw Error('FAIL '+why);ok++;}
const good:Program={version:1,ops:[{kind:'add',value:3},{kind:'mul',value:2},{kind:'neg'}]};
check(validate(good).length===0,'valid typed program');
check(interpret(good,4)===-14,'interpreter arithmetic');
check(affine(good).a===-2&&affine(good).b===-6,'affine independent construction');
check(renderCode(good).includes('return -2 * x + (-6)'), 'render deterministic TypeScript');
const url=programAddress(good);
check(programAddress(resolveAddress(url))===url,'address roundtrip');
try{resolveAddress(url.slice(0,-1)+'0');throw Error('not refused')}catch(e){check(String(e).includes('Checksum')||String(e).includes('Noncanonical'),'checksum rejection');}
check(validate({version:1,ops:[{kind:'divide' as never,value:0}]}).length>0,'bad operation refused');
check(validate({version:1,ops:[{kind:'mul',value:Infinity}]}).length>0,'nonfinite number refused');
const ng=new NGram(3);ng.observe(['add','mul','add']);ng.observe(['add','mul','neg']);
check(ng.next(['add'],['mul','sub'])==='mul','contextual ngram preference');
check(ng.distribution(['add']).order===1,'context order recorded');
check(ng.next(['add','mul'],['sub'])===null||ng.next(['add','mul'],['sub'])==='sub','scope-aware lookup');
const motifs=promoteWords([['add','mul','add'],['add','mul','sub']],2);
check(motifs.length>0,'recurrence certification');
check(unfold(motifs[0]!).length===2,'unfold roundtrip');
try{unfold({...motifs[0]!,certificate:'fake'});throw Error('not refused')}catch(e){check(String(e).includes('Invalid'),'tampered fold refused');}
const e=new Clock9();const first=await e.generate('make a transformation');const second=await e.generate('make a transformation');
check(first.valid&&first.proof.every(x=>x.compiled===x.interpreted),'runtime witness');
check(JSON.stringify(first.program)===JSON.stringify(second.program),'repeatable generation');
check(first.events.map(x=>x.beat).join(',')==='0,1,2,3,4,5','six ordered grammar clocks');
check(first.generator==='clock9-non-neural','disclosed generator type');
check(first.address.startsWith('clock9://program/'),'program-as-address syntax');
const adapted=await e.generate('test adapter',async () => [{kind:'sub',value:1},{kind:'mul',value:3}]);
check(adapted.valid&&adapted.generator==='adapter-proposal','optional adapter checked');
try{await e.generate('invalid adapter',async () => [{kind:'add',value:999}]);throw Error('accepted invalid')}catch(e){check(String(e).includes('Candidate rejected'),'adapter output cannot bypass policy');}
check(e.motifs.some(x=>x.unfolded.join(',')==='add,mul'),'promoted corpus motif');
console.log(`${ok} checks passed. CPU/browser-compatible grammar-clocked research kernel; no LLM speedup claim.`);
