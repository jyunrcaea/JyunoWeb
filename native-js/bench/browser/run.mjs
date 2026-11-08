// Chromium에서 Native JS / JyunoWeb(.NET WASM 인터프리터) / AOT를 같은 워커 조건으로 비교
// 사용법: node bench/browser/run.mjs [interp|aot|njs ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // 미리 설치된 전역 playwright
import { serve, roots } from './serve.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../programs');
const progs = fs.readdirSync(dir).filter((f) => f.endsWith('.jyuno')).sort().map((f) => ({ name: f.slice(0, -6), code: fs.readFileSync(path.join(dir, f), 'utf8') }));
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['njs', 'interp', 'aot'];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const server = serve(8123);
const browser = await chromium.launch();
console.error('chromium', browser.version());
for (const kind of kinds) {
  const page = await browser.newPage();
  await page.goto('http://localhost:8123/njs/bench/browser/page.html');
  await page.waitForFunction(() => window.bootDotnet);
  if (kind === 'njs') {
    const boot = await page.evaluate(async () => { window.e = await bootNjs(); return window.e.bootMs; });
    console.log(JSON.stringify({ kind, bootMs: boot }));
    for (const p of progs) {
      const r = await page.evaluate(async ([code]) => window.e.run(code, 40), [p.code]);
      console.log(JSON.stringify({ kind, bench: p.name, first: r.full[0], steady: median(r.full.slice(20)), steadyRun: median(r.run.slice(20)), result: r.result }));
    }
  } else {
    // dotnet.js는 지문(fingerprint)이 붙은 이름으로 배포됨
    const fw = path.join(roots[kind], '_framework');
    const file = fs.readdirSync(fw).find((f) => /^dotnet\.[a-z0-9]+\.js$/.test(f)) ?? 'dotnet.js';
    const boot = await page.evaluate(async ([k, f]) => { window.e = await bootDotnet(k, f); return { ms: window.e.bootMs, v: window.e.version }; }, [kind, file]);
    console.log(JSON.stringify({ kind, bootMs: boot.ms, version: boot.v }));
    for (const p of progs) {
      const times = []; let res;
      for (let i = 0; i < 7; i++) {
        const r = await page.evaluate(async (code) => window.e.run(code), p.code);
        times.push(r.elapsedMs); res = r;
      }
      console.log(JSON.stringify({ kind, bench: p.name, first: times[0], steady: median(times.slice(2)), result: res.value, status: res.status }));
    }
  }
  await page.close();
}
await browser.close();
server.close();
