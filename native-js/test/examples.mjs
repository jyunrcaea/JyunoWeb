// 플레이그라운드 예제 비교
import fs from 'node:fs';
import { runRef, runJs, compare } from './diff.mjs';
const ex = JSON.parse(fs.readFileSync(process.argv[2] ?? new URL('./data/examples.json', import.meta.url), 'utf8'));
const jobs = ex.filter((e) => !/random|time\.now/.test(e.code) && e.id !== 'infinite').map((e) => ({ id: e.id, code: e.code, stdin: e.stdin, options: e.options ?? undefined }));
const refs = runRef(jobs);
const outs = jobs.map(runJs);
const r = compare(jobs, refs, outs);
console.log(`예제 ${ex.length}개 중 비결정적(random/time)·무한 반복 ${ex.length - jobs.length}개 제외, 비교 ${jobs.length}개: 일치 ${r.same}, 제약 ${r.restricted}, 불일치 ${r.diff.length - r.restricted}`);
for (const d of r.diff) console.log(d.job.id, JSON.stringify(d.ref).slice(0, 300), '\n   js ', JSON.stringify(d.js).slice(0, 300));
