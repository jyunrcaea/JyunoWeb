// Native JS 벤치마크 (Node/V8)
// 사용법: node bench/node-bench.mjs [반복 수] [--cold 이름]
//   --cold: 새 프로세스에서 한번만 컴파일+실행한 시간 (첫 실행)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileJyuno, runCompiled } from '../src/index.mjs';
import { addMath } from '../src/host.mjs';
import { describe } from '../src/runtime.mjs';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'programs');
const host = () => { const h = new Map(); addMath(h); return h; };
const coldIdx = process.argv.indexOf('--cold');
if (coldIdx > 0) {
  const name = process.argv[coldIdx + 1];
  const code = fs.readFileSync(path.join(dir, name + '.jyuno'), 'utf8');
  const t0 = performance.now();
  const h = host();
  const c = compileJyuno(code, { host: h });
  const t1 = performance.now();
  const r = runCompiled(c, h);
  const t2 = performance.now();
  console.log(JSON.stringify({ bench: name, engine: 'node ' + process.version, first: t2 - t0, compile: t1 - t0, run: t2 - t1, result: describe(r.value) }));
  process.exit(0);
}
const iterations = +(process.argv[2] ?? 200);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jyuno')).sort()) {
  const name = f.replace('.jyuno', '');
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  const full = [], runOnly = [];
  let result;
  // 컴파일 포함 (C# 벤치마크처럼 반복마다 새로 컴파일)
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const h = host();
    const c = compileJyuno(code, { host: h });
    const r = runCompiled(c, h);
    full.push(performance.now() - t0);
    result = describe(r.value);
  }
  // 한번 컴파일하고 여러번 실행 (채점처럼 같은 코드를 테스트 케이스마다 실행)
  const h = host();
  const c = compileJyuno(code, { host: h });
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    runCompiled(c, h);
    runOnly.push(performance.now() - t0);
  }
  const steady = (a) => median(a.slice(Math.floor(a.length / 2)));
  console.log(JSON.stringify({ bench: name, engine: 'node ' + process.version, steadyWithCompile: steady(full), steadyRun: steady(runOnly), compileMs: c.compileMs, result }));
}
