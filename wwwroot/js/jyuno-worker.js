// Jyuno 실행 전용 웹 워커
// 메인 스레드와 별개로 .NET 런타임을 하나 더 띄워서, 이 안에서 Jyuno 인터프리터를 실행합니다.
// (무한 반복문이 있어도 화면이 멈추지 않고, worker.terminate()로 언제든 중단할수 있음)
// Native JS를 켜면 .NET은 코드를 JavaScript로 변환만 하고, 실행은 이 워커의 JS 엔진이 직접 합니다.

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
        const options = JSON.parse(data.options);
        result = options.nativeJs
            ? runNative(data.code, data.stdin, data.options, options)
            : JSON.parse(exports.Run(data.code, data.stdin, data.options));
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

/* ───────────────────────── Native JS ───────────────────────── */

const post = (kind, text) => globalThis.jyunoHost.post(kind, text);

/** C#의 JyunoSandbox.OutputBuffer와 같은 규칙으로 출력을 모아서 보냄 */
class OutputBuffer {
    constructor() {
        this.buffer = '';
        this.total = 0;
        this.truncated = false;
        this.last = performance.now();
    }
    write(text) {
        if (this.truncated) return;
        this.total += text.length;
        if (this.total > 2_000_000) {
            this.truncated = true;
            this.flush();
            post('notice', '출력이 너무 많아서 2,000,000자 이후로는 표시하지 않습니다.');
            return;
        }
        this.buffer += text;
        if (this.buffer.length > 16_384 || performance.now() - this.last > 50) this.flush();
    }
    echo(text) { this.flush(); post('input', text); }
    clear() { this.buffer = ''; this.total = 0; this.truncated = false; post('clear', ''); }
    title(text) { this.flush(); post('title', text); }
    flush() {
        if (this.buffer) { post('out', this.buffer); this.buffer = ''; }
        this.last = performance.now();
    }
}

/** .NET의 StringReader와 같은 방식으로 읽음 (\n, \r, \r\n 줄바꿈) */
class StdinReader {
    constructor(text) { this.text = text; this.pos = 0; }
    readLine() {
        const s = this.text;
        if (this.pos >= s.length) return null;
        let i = this.pos;
        while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
        const line = s.slice(this.pos, i);
        this.pos = i < s.length && s[i] === '\r' && s[i + 1] === '\n' ? i + 2 : i + 1;
        return line;
    }
    read() { return this.pos < this.text.length ? this.text.charCodeAt(this.pos++) : -1; }
}

/** Engine/JyunoHost.cs의 AddHostFunctions를 JS로 옮긴 것 (rt: 생성된 프로그램의 runtime) */
function hostFunctions(rt) {
    const toLong = (v) => {
        const i = rt.tryInt(v);
        if (i !== undefined) return Number(i);
        const r = rt.tryReal(v);
        if (r !== undefined) return Math.trunc(r);
        throw new rt.JyunoError(`'${v === null ? 'null' : rt.str(v)}'은/는 정수가 아닙니다.`);
    };
    return {
        random: (a) => {
            if (a.length === 0) return rt.D(Math.random());
            let min = 0, max;
            if (a.length === 1) max = toLong(a[0]);
            else { min = toLong(a[0]); max = toLong(a[1]); }
            if (max <= min) throw new rt.JyunoError('random의 최댓값은 최솟값보다 커야 합니다.');
            return min + Math.floor(Math.random() * (max - min));
        },
        'time.now': () => Date.now(),
        'text.at': (a) => {
            if (a.length < 2 || typeof a[0] !== 'string') throw new rt.JyunoError('text.at 에는 문자열과 위치가 필요합니다.');
            const s = a[0], i = toLong(a[1]);
            if (i < 0 || i >= s.length) throw new rt.JyunoError(`위치 ${i}은/는 문자열의 범위(0 ~ ${s.length - 1})를 벗어났습니다.`);
            return s[i];
        },
        'text.upper': (a) => {
            if (a.length === 0 || typeof a[0] !== 'string') throw new rt.JyunoError('대문자로 바꿀 문자열이 필요합니다.');
            return a[0].toUpperCase();
        },
    };
}

function runNative(code, stdin, optionsJson, options) {
    const compiled = JSON.parse(exports.CompileNativeJs(code, optionsJson));
    const base = { engine: 'native-js', compileMs: compiled.compileMs, elapsedMs: 0, inputExhausted: false };
    if (!compiled.ok)
        return { ...base, status: compiled.status, message: compiled.message, line: compiled.line };
    if (options.file)
        post('notice', 'Native JS는 File 명령어(file.*, directory.*)를 지원하지 않습니다.');
    // 생성된 코드는 전역 변수 JyunoProgram을 정의함. sourceURL은 오류가 난 줄을 스택 트레이스에서 찾는데 쓰임
    const program = new Function(compiled.code + '\n//# sourceURL=jyuno-program.js\nreturn JyunoProgram;')();
    const output = new OutputBuffer();
    const reader = new StdinReader(stdin.replace(/\r\n/g, '\n'));
    let inputExhausted = false;
    const started = performance.now();
    const r = program.run({
        write: (text) => output.write(text),
        readLine: () => {
            const line = reader.readLine();
            if (line === null) inputExhausted = true; else output.echo(line + '\n');
            return line;
        },
        read: () => {
            const c = reader.read();
            if (c < 0) inputExhausted = true; else output.echo(String.fromCharCode(c));
            return c;
        },
        clear: () => output.clear(),
        title: (text) => output.title(text),
        host: options.host ? hostFunctions(program.runtime) : {},
    });
    const elapsedMs = performance.now() - started;
    output.flush();
    const result = { ...base, status: r.status, elapsedMs, inputExhausted, line: r.line ?? -1 };
    if (r.status === 'ok') {
        result.value = r.text;
        result.valueType = r.type;
    } else {
        result.message = r.message;
        result.exceptionType = r.exceptionType ?? null;
    }
    return result;
}
