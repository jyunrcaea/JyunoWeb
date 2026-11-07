// Jyuno 실행 전용 웹 워커
// 메인 스레드와 별개로 .NET 런타임을 하나 더 띄워서, 이 안에서 Jyuno 인터프리터를 실행합니다.
// (무한 반복문이 있어도 화면이 멈추지 않고, worker.terminate()로 언제든 중단할수 있음)

let exports = null;
let pending = [];

globalThis.jyunoHost = {
    post(kind, text) {
        self.postMessage({ type: 'output', kind, text });
    }
};

async function boot(dotnetUrl) {
    try {
        const { dotnet } = await import(dotnetUrl);
        const runtime = await dotnet.create();
        const config = runtime.getConfig();
        const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
        exports = assemblyExports.JyunoWeb.Engine.JyunoSandbox;
        const version = exports.Ping();
        self.postMessage({ type: 'ready', version });
        for (const message of pending)
            handle(message);
        pending = [];
    } catch (err) {
        self.postMessage({ type: 'boot-error', message: String(err && err.message || err) });
    }
}

function handle(data) {
    if (data.type === 'judge') {
        let result;
        try {
            result = JSON.parse(exports.Judge(data.code, data.problemId, data.mode));
        } catch (err) {
            result = { verdict: 'RE', total: 0, passed: 0, failedIndex: -1, maxMs: 0, cases: [{ index: 0, verdict: 'RE', message: String(err && err.message || err), line: -1 }] };
        }
        self.postMessage({ type: 'done', id: data.id, result });
        return;
    }
    if (data.type !== 'run')
        return;
    let result;
    try {
        result = JSON.parse(exports.Run(data.code, data.stdin, data.options));
    } catch (err) {
        result = { status: 'error', message: String(err && err.message || err), line: -1, elapsedMs: 0 };
    }
    self.postMessage({ type: 'done', id: data.id, result });
}

self.addEventListener('message', (e) => {
    const data = e.data;
    if (data.type === 'boot') {
        boot(data.dotnetUrl);
        return;
    }
    if (exports)
        handle(data);
    else
        pending.push(data);
});
