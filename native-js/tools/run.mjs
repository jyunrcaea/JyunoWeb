// 사용법: node tools/run.mjs file.jyuno [stdin파일] [--js]
import fs from 'node:fs';
import { compileJyuno, runCompiled } from '../src/index.mjs';
import { judgeHost } from '../src/host.mjs';
import { describe, typeName } from '../src/runtime.mjs';
const [file, stdinFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const code = fs.readFileSync(file, 'utf8');
const stdin = stdinFile ? fs.readFileSync(stdinFile, 'utf8') : '';
const h = judgeHost(stdin);
const c = compileJyuno(code, { host: h.host });
if (process.argv.includes('--js')) console.error(c.js);
if (!c.ok) { console.log(JSON.stringify(c.errors.map((e) => ({ line: e.line, message: e.message, kind: e.kind })))); process.exit(1); }
const t = performance.now();
const r = runCompiled(c, h.host);
const ms = performance.now() - t;
process.stdout.write(h.output());
console.error(JSON.stringify({ status: r.status, value: r.status === 'ok' ? describe(r.value) : undefined, type: r.status === 'ok' ? typeName(r.value) : undefined, message: r.message, line: r.line, exceptionType: r.exceptionType, ms: +ms.toFixed(2), compileMs: +c.compileMs.toFixed(2) }));
