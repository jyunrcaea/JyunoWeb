// 브라우저 워커 안에서 Native JS로 컴파일+실행
import { compileJyuno, runCompiled } from '../../src/index.mjs';
import { judgeHost } from '../../src/host.mjs';
import { describe } from '../../src/runtime.mjs';
self.onmessage = (e) => {
  const { code, iterations } = e.data;
  const first = [], full = [], run = [];
  let result;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const { host } = judgeHost('');
    const c = compileJyuno(code, { host });
    const t1 = performance.now();
    const r = runCompiled(c, host);
    const t2 = performance.now();
    full.push(t2 - t0); run.push(t2 - t1);
    result = describe(r.value);
  }
  self.postMessage({ full, run, result });
};
