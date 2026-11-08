// 차등 테스트: 같은 스크립트를 Jyuno 1.3.2(C#, RefRunner)와 Native JS로 실행해서 결과를 비교
import { spawnSync } from 'node:child_process';
import { compileJyuno, runCompiled } from '../src/index.mjs';
import { addConsole, addMath, addHostFunctions, StringReader, OutputLimit } from '../src/host.mjs';
import { ser } from './common.mjs';

export const REF = process.env.JYUNO_REF ?? new URL('../ref/RefRunner/bin/Release/net10.0/RefRunner.dll', import.meta.url).pathname;

export function runRef(jobs) {
  const r = spawnSync(process.env.DOTNET ?? '/opt/dotnet/dotnet', [REF, 'run'], { input: JSON.stringify(jobs), maxBuffer: 1 << 30, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('RefRunner 실패: ' + r.stderr.slice(0, 2000));
  return JSON.parse(r.stdout);
}

export function runJs(job) {
  const o = { console: true, math: true, host: true, enableRemoveVariable: true, blockSubstitute: false, ...(job.options ?? {}) };
  const host = new Map();
  let out = '';
  if (o.math) addMath(host);
  if (o.console) addConsole(host, { input: new StringReader((job.stdin ?? '').replace(/\r\n/g, '\n')), write: (s) => { out += s; if (out.length > 2_000_000) throw new OutputLimit(); } });
  if (o.host) addHostFunctions(host);
  const t0 = performance.now();
  const comp = compileJyuno(job.code, { host, blockSubstitute: o.blockSubstitute, enableRemoveVariable: o.enableRemoveVariable });
  if (!comp.ok) {
    const e = comp.errors[0];
    return { id: job.id, status: e.kind === 'restriction' ? 'restricted' : 'grammar', message: e.message, line: e.line, out: '' };
  }
  let r = runCompiled(comp, host);
  if (r.status === 'abort') r = { status: 'error', message: '출력 제한', line: r.line, exceptionType: 'InvalidOperationException' };
  const res = { id: job.id, status: r.status, out, ms: performance.now() - t0 };
  if (r.status === 'ok') res.value = ser(r.value);
  else { res.message = r.message; res.line = r.line; if (r.status === 'error') res.exceptionType = r.exceptionType ?? null; }
  return res;
}

const pick = (r) => {
  const o = { status: r.status, out: r.out };
  if (r.status === 'ok') o.value = r.value; else { o.message = r.message; o.line = r.line; if (r.status === 'error') o.exceptionType = r.exceptionType ?? null; }
  return o;
};
export function compare(jobs, refs, outs) {
  const res = { same: 0, restricted: 0, diff: [] };
  jobs.forEach((job, i) => {
    const a = pick(refs[i]), b = outs[i];
    if (b.status === 'restricted') { res.restricted++; res.diff.push({ job, ref: a, js: b, restricted: true }); return; }
    if (JSON.stringify(a) === JSON.stringify(pick(b))) res.same++;
    else res.diff.push({ job, ref: a, js: pick(b) });
  });
  return res;
}
