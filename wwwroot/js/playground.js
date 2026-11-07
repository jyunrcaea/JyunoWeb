// Jyuno 플레이그라운드: 코드 편집기, 터미널 출력, 실행용 웹 워커를 관리합니다.
import { highlightLine } from './jyuno-highlight.js';

const STORAGE_KEY = 'jyuno.playground.code';
const BLOCK_OPENERS = /^\s*(if|else|while|repeat|func)\b/;

function resolveDotnetUrl() {
    // index.html의 importmap에 지문(fingerprint)이 붙은 dotnet.js 경로가 있음
    try {
        const map = document.querySelector('script[type="importmap"]');
        const imports = map ? JSON.parse(map.textContent).imports || {} : {};
        const mapped = imports['./_framework/dotnet.js'];
        if (mapped) return new URL(mapped, document.baseURI).href;
    } catch { /* 무시 */ }
    return new URL('_framework/dotnet.js', document.baseURI).href;
}

/* ───────────────────────── 편집기 ───────────────────────── */

class Editor {
    constructor(host, onRunShortcut, onChange) {
        this.onChange = onChange;
        host.classList.add('editor');
        host.innerHTML = `
            <div class="editor-gutter" aria-hidden="true"><div class="editor-gutter-inner"></div></div>
            <div class="editor-body">
                <pre class="editor-highlight" aria-hidden="true"><code></code></pre>
                <textarea class="editor-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Jyuno 코드 편집기"></textarea>
            </div>`;
        this.gutter = host.querySelector('.editor-gutter-inner');
        this.code = host.querySelector('.editor-highlight code');
        this.pre = host.querySelector('.editor-highlight');
        this.input = host.querySelector('.editor-input');
        this.errorLine = -1;

        this.input.addEventListener('input', () => {
            this.errorLine = -1;
            this.render();
            this.onChange?.();
        });
        this.input.addEventListener('scroll', () => this.syncScroll());
        this.input.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                onRunShortcut();
                return;
            }
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.indent(e.shiftKey);
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                const { value, selectionStart } = this.input;
                const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
                const current = value.slice(lineStart, selectionStart);
                let indentation = current.match(/^\s*/)[0];
                if (BLOCK_OPENERS.test(current)) indentation += '    ';
                this.insert('\n' + indentation);
            }
        });
    }

    insert(text) {
        this.input.focus();
        // execCommand를 쓰면 실행 취소(Ctrl+Z) 기록이 유지됨
        if (!document.execCommand || !document.execCommand('insertText', false, text)) {
            this.input.setRangeText(text, this.input.selectionStart, this.input.selectionEnd, 'end');
            this.input.dispatchEvent(new Event('input'));
        }
    }

    indent(outdent) {
        const el = this.input;
        const { value, selectionStart, selectionEnd } = el;
        if (selectionStart === selectionEnd && !outdent) {
            this.insert('    ');
            return;
        }
        const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
        const block = value.slice(start, selectionEnd);
        const changed = block.split('\n').map(l => outdent ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l).join('\n');
        el.setSelectionRange(start, selectionEnd);
        this.insert(changed);
        el.setSelectionRange(start, start + changed.length);
    }

    get value() { return this.input.value; }

    set value(text) {
        this.input.value = text;
        this.errorLine = -1;
        this.render();
        this.input.scrollTop = 0;
        this.syncScroll();
    }

    setErrorLine(line) {
        this.errorLine = line;
        this.render();
        if (line >= 0) {
            const lineHeight = parseFloat(getComputedStyle(this.input).lineHeight) || 22;
            const target = line * lineHeight;
            if (target < this.input.scrollTop || target > this.input.scrollTop + this.input.clientHeight - lineHeight * 2)
                this.input.scrollTop = Math.max(0, target - this.input.clientHeight / 3);
        }
    }

    render() {
        const lines = this.input.value.split('\n');
        let html = '';
        let gutter = '';
        for (let i = 0; i < lines.length; i++) {
            const cls = i === this.errorLine ? ' class="line-error"' : '';
            html += `<span${cls}>${highlightLine(lines[i]) || ' '}</span>\n`;
            gutter += `<div${cls}>${i}</div>`;
        }
        this.code.innerHTML = html;
        this.gutter.innerHTML = gutter;
        this.syncScroll();
    }

    syncScroll() {
        const { scrollTop, scrollLeft } = this.input;
        this.pre.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
        this.gutter.style.transform = `translateY(${-scrollTop}px)`;
    }
}

/* ───────────────────────── 터미널 ───────────────────────── */

class Terminal {
    constructor(host) {
        this.host = host;
        this.last = null;
        this.lastKind = null;
    }

    clear() {
        this.host.textContent = '';
        this.last = null;
        this.lastKind = null;
    }

    write(kind, text) {
        if (!text) return;
        const stick = this.host.scrollHeight - this.host.scrollTop - this.host.clientHeight < 40;
        if (this.lastKind === kind && this.last) {
            this.last.appendData(text);
        } else {
            const node = document.createTextNode(text);
            if (kind === 'out') {
                this.host.appendChild(node);
            } else {
                const span = document.createElement('span');
                span.className = 'term-' + kind;
                span.appendChild(node);
                this.host.appendChild(span);
            }
            this.last = node;
            this.lastKind = kind;
        }
        if (stick) this.host.scrollTop = this.host.scrollHeight;
    }

    /** 다음 출력이 새 줄에서 시작하도록 함 */
    breakLine() {
        const text = this.host.textContent;
        if (text.length && !text.endsWith('\n')) this.write('out', '\n');
    }
}

/* ───────────────────────── 플레이그라운드 ───────────────────────── */

class Playground {
    constructor(root, dotnet, initialCode) {
        this.dotnet = dotnet;
        this.terminal = new Terminal(root.querySelector('[data-terminal]'));
        this.elapsed = root.querySelector('[data-elapsed]');
        this.editor = new Editor(root.querySelector('[data-editor]'),
            () => this.dotnet.invokeMethodAsync('RunShortcut'),
            () => this.save());
        this.editor.value = initialCode;
        this.runId = 0;
        this.running = false;
        this.dotnetUrl = resolveDotnetUrl();
        this.startWorker();
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            try { localStorage.setItem(STORAGE_KEY, this.editor.value); } catch { /* 무시 */ }
        }, 300);
    }

    startWorker() {
        this.ready = false;
        const worker = new Worker(new URL('jyuno-worker.js', import.meta.url), { type: 'module' });
        this.worker = worker;
        const bootStarted = performance.now();
        worker.addEventListener('message', (e) => {
            if (worker !== this.worker) return;
            const data = e.data;
            switch (data.type) {
                case 'ready':
                    this.ready = true;
                    this.dotnet.invokeMethodAsync('OnWorkerReady', data.version, Math.round(performance.now() - bootStarted));
                    break;
                case 'boot-error':
                    this.dotnet.invokeMethodAsync('OnWorkerError', data.message);
                    break;
                case 'output':
                    this.output(data.kind, data.text);
                    break;
                case 'done':
                    if (data.id === this.runId) this.finish(data.result);
                    break;
            }
        });
        worker.addEventListener('error', (e) => {
            if (worker !== this.worker) return;
            this.dotnet.invokeMethodAsync('OnWorkerError', e.message || '웹 워커를 시작하지 못했습니다.');
        });
        worker.postMessage({ type: 'boot', dotnetUrl: this.dotnetUrl });
    }

    output(kind, text) {
        switch (kind) {
            case 'clear': this.terminal.clear(); break;
            case 'title': this.dotnet.invokeMethodAsync('OnTitle', text); break;
            case 'notice': this.terminal.breakLine(); this.terminal.write('notice', text + '\n'); break;
            default: this.terminal.write(kind, text); break;
        }
    }

    run(stdin, options) {
        if (this.running) this.stop(true);
        this.terminal.clear();
        this.editor.setErrorLine(-1);
        this.running = true;
        this.runId++;
        this.started = performance.now();
        this.tick();
        this.worker.postMessage({ type: 'run', id: this.runId, code: this.editor.value, stdin, options });
        // 좁은 화면에서는 편집기 아래에 있는 터미널이 보이도록 스크롤
        if (window.matchMedia('(max-width: 900px)').matches) {
            const pane = this.terminal.host.closest('.pane');
            const rect = pane.getBoundingClientRect();
            if (rect.top > window.innerHeight * 0.6 || rect.bottom < 0)
                pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    tick() {
        if (!this.running) return;
        const ms = performance.now() - this.started;
        if (this.elapsed) this.elapsed.textContent = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
        requestAnimationFrame(() => this.tick());
    }

    finish(result) {
        this.running = false;
        if (result.line >= 0 && result.status !== 'ok') this.editor.setErrorLine(result.line);
        this.dotnet.invokeMethodAsync('OnRunFinished', JSON.stringify(result));
    }

    /** 실행중인 워커를 종료하고 새 워커를 띄움 */
    stop(silent) {
        if (!this.running) return;
        this.running = false;
        this.runId++;
        this.worker.terminate();
        this.startWorker();
        if (!silent) {
            this.terminal.breakLine();
            this.terminal.write('notice', '실행을 중단했습니다.\n');
            this.dotnet.invokeMethodAsync('OnStopped', Math.round(performance.now() - this.started));
        }
    }

    getCode() { return this.editor.value; }

    setCode(code) {
        this.editor.value = code;
        this.save();
        this.terminal.clear();
    }

    focus() { this.editor.input.focus(); }

    async shareUrl() {
        const url = new URL(location.href);
        url.hash = 'code=' + await encodeCode(this.editor.value);
        return url.href;
    }

    dispose() {
        this.running = false;
        this.worker?.terminate();
        this.worker = null;
    }
}

/* ───────────────────────── 공유 링크 ───────────────────────── */

function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

async function encodeCode(code) {
    const bytes = new TextEncoder().encode(code);
    if (typeof CompressionStream === 'function')
        return 'z' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
    return 'b' + toBase64Url(bytes);
}

async function decodeCode(encoded) {
    const kind = encoded[0];
    let bytes = fromBase64Url(encoded.slice(1));
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(bytes);
}

/** 주소의 #code=... 에서 코드를 읽음 (없으면 null) */
export async function readSharedCode() {
    const match = location.hash.match(/code=([A-Za-z0-9_-]+)/);
    if (!match) return null;
    try { return await decodeCode(match[1]); } catch { return null; }
}

export function readSavedCode() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function create(root, dotnet, initialCode) {
    return new Playground(root, dotnet, initialCode);
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
