// Jyuno.Tests(C# 테스트 320개)가 실행하는 스크립트를 Native JS로 실행해서 1.3.2와 결과 비교
import fs from 'node:fs';
import { compileJyuno, runCompiled } from '../src/index.mjs';
import { addMath, addConsole, StringReader } from '../src/host.mjs';
import { ser } from './common.mjs';
const file = process.argv[2] ?? new URL('./data/jyuno-tests-corpus.jsonl', import.meta.url);
const cases = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let pass = 0, restricted = 0;
const fails = [];
const seen = new Set();
for (const c of cases) {
  const key = JSON.stringify(c.lines);
  if (seen.has(key)) continue;
  seen.add(key);
  const host = new Map();
  addMath(host);
  addConsole(host, { input: new StringReader(''), write: () => {} });
  const outValues = [];
  host.set('out', { kind: 'func', fn: (a) => { if (outValues.length >= 1000) throw new Error('출력이 너무 많습니다. (무한 루프?)'); outValues.push(ser(a.length ? a[0] : null, false)); return null; } });
  const eval_ = c.mode === 'eval';
  const comp = compileJyuno(c.lines.join('\n'), { host, evalMode: eval_ });
  let got;
  if (!comp.ok) {
    const e = comp.errors[0];
    got = e.kind === 'restriction' ? { status: 'restricted', message: e.message } : { status: 'grammar', message: e.message };
  } else {
    const r = runCompiled(comp, host);
    got = { status: r.status };
    if (r.status === 'ok') got.value = ser(r.value, false);
    else { got.message = r.message; if (r.status === 'error') got.exceptionType = r.exceptionType ?? null; }
  }
  if (got.status === 'restricted') { restricted++; fails.push({ c, got, why: 'restricted' }); continue; }
  const want = { status: c.status };
  if (c.status === 'ok') want.value = c.value; else { want.message = c.message; if (c.status === 'error') want.exceptionType = c.exceptionType ?? null; }
  if (!eval_) { got.outValues = outValues; want.outValues = c.outValues; }
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fails.push({ c, got, want });
}
console.log(`Jyuno.Tests 스크립트 ${seen.size}개: 일치 ${pass}, 제약으로 거부 ${restricted}, 불일치 ${seen.size - pass - restricted}`);
for (const f of fails.slice(0, 40)) console.log(JSON.stringify(f.c.lines), '\n   got ', JSON.stringify(f.got), '\n   want', JSON.stringify(f.want ?? f.why));
