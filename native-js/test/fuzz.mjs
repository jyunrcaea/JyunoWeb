// 무작위 Jyuno 프로그램을 만들어서 1.3.2(C#)와 Native JS의 결과(출력, 반환값, 오류 메시지, 오류 줄)를 비교
// 사용법: node test/fuzz.mjs [프로그램 수] [씨앗]
import { runRef, runJs, compare } from './diff.mjs';

import { makeGenerator } from './fuzz-gen.mjs';
const N = +(process.argv[2] ?? 1000);
const program = makeGenerator(+(process.argv[3] ?? 1));

const jobs = [];
for (let i = 0; i < N; i++) jobs.push({ id: i, code: program(), stdin: '', timeoutMs: 20000 });
const t0 = performance.now();
const refs = [];
for (let i = 0; i < jobs.length; i += 500) refs.push(...runRef(jobs.slice(i, i + 500)));
const t1 = performance.now();
const outs = jobs.map(runJs);
const t2 = performance.now();
const r = compare(jobs, refs, outs);
const statuses = {};
for (const x of refs) statuses[x.status] = (statuses[x.status] ?? 0) + 1;
console.log(`무작위 프로그램 ${N}개 (씨앗 ${process.argv[3] ?? 1}): 일치 ${r.same}, 제약으로 거부 ${r.restricted}, 불일치 ${r.diff.length - r.restricted}`);
console.log(`  기준 결과 분포 ${JSON.stringify(statuses)} · C# ${((t1 - t0) / 1000).toFixed(1)}s, JS ${((t2 - t1) / 1000).toFixed(1)}s`);
const show = r.diff.filter((d) => !d.restricted).slice(0, +(process.env.SHOW ?? 5));
for (const d of show) {
  console.log('────────\n' + d.job.code.split('\n').map((l, i) => `${String(i).padStart(3)}| ${l}`).join('\n'));
  const k = [...d.ref.out].findIndex((ch, i) => ch !== d.js.out[i]);
  const cut = (o) => ({ ...o, out: o.out.length > 300 ? `…(${o.out.length}자, ${k}번째부터 다름) ` + JSON.stringify(o.out.slice(Math.max(0, k - 80), k + 120)) : o.out });
  console.log('C#:', JSON.stringify(cut(d.ref)).slice(0, 700));
  console.log('JS:', JSON.stringify(cut(d.js)).slice(0, 700));
}
for (const d of r.diff.filter((x) => x.restricted).slice(0, 3)) console.log('제약:', d.js.message);
