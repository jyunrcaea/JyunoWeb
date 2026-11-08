// 브라우저 벤치마크용 정적 서버: /njs → native-js, /interp, /aot → dotnet publish 결과의 wwwroot
// 사용법: INTERP_ROOT=… AOT_ROOT=… node bench/browser/serve.mjs [포트]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const roots = {
  njs: path.resolve(here, '../..'),
  interp: process.env.INTERP_ROOT ?? '/tmp/claude-0/pub-interp/wwwroot',
  aot: process.env.AOT_ROOT ?? '/tmp/claude-0/pub-aot/wwwroot',
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.dat': 'application/octet-stream', '.jyuno': 'text/plain; charset=utf-8', '.css': 'text/css' };
export function serve(port = 8123) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, root, ...rest] = url.pathname.split('/');
    const base = roots[root];
    const file = base && path.join(base, ...rest);
    if (!file || !file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { serve(+(process.argv[2] ?? 8123)); console.log('listening'); }
