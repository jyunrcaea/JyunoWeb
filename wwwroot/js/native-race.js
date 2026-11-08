// Native JS 소개 페이지의 "직접 비교" : 같은 코드를 C# 인터프리터와 Native JS로 실행해서 시간을 잽니다.
// 플레이그라운드와 같은 웹 워커(jyuno-worker.js)를 하나 띄워서, 옵션만 바꿔 두번 실행합니다.
import { resolveDotnetUrl } from './playground.js';

let worker = null;
let ready = null;
let bootMs = 0;
let nextId = 0;
const waiting = new Map();

function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
        const started = performance.now();
        worker = new Worker(new URL('jyuno-worker.js', import.meta.url), { type: 'module' });
        worker.addEventListener('message', (e) => {
            const data = e.data;
            if (data.type === 'ready') {
                bootMs = performance.now() - started;
                resolve();
            } else if (data.type === 'boot-error') {
                reject(new Error(data.message));
            } else if (data.type === 'done') {
                const done = waiting.get(data.id);
                waiting.delete(data.id);
                done?.(data.result);
            }
            // 'output'(프로그램 출력)은 비교에 쓰지 않으므로 무시
        });
        worker.addEventListener('error', (e) => reject(new Error(e.message || '웹 워커를 시작하지 못했습니다.')));
        worker.postMessage({ type: 'boot', dotnetUrl: resolveDotnetUrl() });
    });
    ready.catch(() => { ready = null; worker?.terminate(); worker = null; });
    return ready;
}

function run(code, nativeJs) {
    const id = ++nextId;
    const options = JSON.stringify({ console: true, math: true, file: false, host: true, enableRemoveVariable: true, blockSubstitute: false, nativeJs });
    return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker.postMessage({ type: 'run', id, code, stdin: '', options });
    });
}

/** 워커를 준비합니다. 준비에 걸린 시간(ms)을 돌려줌 */
export async function prepare() {
    await start();
    return Math.round(bootMs);
}

/** 한쪽 엔진으로 실행하고 결과를 JSON 문자열로 돌려줍니다. */
export async function runOnce(code, nativeJs) {
    await start();
    const r = await run(code, nativeJs);
    return JSON.stringify({
        status: r.status,
        value: r.value ?? null,
        message: r.message ?? null,
        elapsedMs: r.elapsedMs ?? 0,
        compileMs: r.compileMs ?? 0,
    });
}

export function dispose() {
    worker?.terminate();
    worker = null;
    ready = null;
    for (const done of waiting.values()) done({ status: 'stopped' });
    waiting.clear();
}
