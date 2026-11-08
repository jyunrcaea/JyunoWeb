// JyunoWeb 53문제의 풀이를 모든 테스트 케이스(예제 + 숨겨진 테스트)로 Native JS에서 채점
import fs from 'node:fs';
import path from 'node:path';
import { compileJyuno, runCompiled } from '../src/index.mjs';
import { judgeHost } from '../src/host.mjs';
const problems = JSON.parse(fs.readFileSync(process.argv[2] ?? new URL('./data/problems.json', import.meta.url), 'utf8'));
const dir = process.argv[3] ?? process.env.JYUNO_SOLUTIONS ?? '/mnt/project-files/jyunoweb-solutions';
const normalize = (t) => { const l = t.replace(/\r\n/g, '\n').split('\n').map((x) => x.trimEnd()); while (l.length && l.at(-1) === '') l.pop(); return l.join('\n'); };
let ac = 0, total = 0, cases = 0, maxMs = 0, sumMs = 0;
const bad = [];
for (const p of problems) {
  const f = path.join(dir, `${p.id}.jyuno`);
  if (!fs.existsSync(f)) continue;
  total++;
  const code = fs.readFileSync(f, 'utf8');
  const comp = compileJyuno(code, { host: judgeHost('').host });
  if (!comp.ok) { bad.push(`${p.id}: 컴파일 실패 ${comp.errors[0].message}`); continue; }
  let ok = true;
  for (const [i, c] of p.cases.entries()) {
    const h = judgeHost(c.input);
    const t = performance.now();
    const r = runCompiled(comp, h.host);
    const ms = performance.now() - t;
    cases++; sumMs += ms; maxMs = Math.max(maxMs, ms);
    if (r.status !== 'ok' || normalize(h.output()) !== normalize(c.output)) {
      ok = false;
      bad.push(`${p.id} #${i}: ${r.status} ${r.message ?? ''} line ${r.line ?? ''}\n  got:  ${JSON.stringify(h.output().slice(0, 200))}\n  want: ${JSON.stringify(c.output.slice(0, 200))}`);
      break;
    }
  }
  if (ok) ac++;
}
console.log(`문제 ${total}개 중 AC ${ac}개, 테스트 케이스 ${cases}개, 케이스당 평균 ${(sumMs / cases).toFixed(3)} ms, 최대 ${maxMs.toFixed(2)} ms`);
bad.forEach((b) => console.log(b));
