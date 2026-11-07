// Jyuno 온라인 저지: 문제 페이지의 편집기와 채점용 웹 워커, 제출 기록 저장
import { Editor, resolveDotnetUrl } from './playground.js';

const DRAFT_KEY = (id) => `jyuno.judge.draft.${id}`;
const SUBMISSIONS_KEY = 'jyuno.judge.submissions';
const MAX_HISTORY = 30;

/* ───────────────────────── 저장소 ───────────────────────── */

function readSubmissions() {
    try { return JSON.parse(localStorage.getItem(SUBMISSIONS_KEY)) || {}; } catch { return {}; }
}

function writeSubmissions(all) {
    try { localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(all)); } catch { /* 무시 */ }
}

/** 문제 번호 → 'solved' | 'tried' */
export function summary() {
    const all = readSubmissions();
    const result = {};
    for (const [id, list] of Object.entries(all)) {
        if (!list.length) continue;
        result[id] = list.some(s => s.verdict === 'AC') ? 'solved' : 'tried';
    }
    return result;
}

export function history(problemId) {
    return readSubmissions()[problemId] || [];
}

export function record(problemId, entry) {
    const all = readSubmissions();
    const list = all[problemId] || [];
    list.unshift(entry);
    all[problemId] = list.slice(0, MAX_HISTORY);
    writeSubmissions(all);
    return all[problemId];
}

export function readDraft(problemId) {
    try { return localStorage.getItem(DRAFT_KEY(problemId)); } catch { return null; }
}

/* ───────────────────────── 채점기 ───────────────────────── */

class Judge {
    constructor(root, dotnet, problemId, code, timeLimitMs) {
        this.dotnet = dotnet;
        this.problemId = problemId;
        this.timeLimitMs = timeLimitMs;
        this.runId = 0;
        this.busy = false;
        this.editor = new Editor(root,
            (submit) => this.dotnet.invokeMethodAsync(submit ? 'SubmitShortcut' : 'Shortcut'),
            () => this.save());
        this.editor.value = code;
        this.dotnetUrl = resolveDotnetUrl();
        this.startWorker();
    }

    save() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            try { localStorage.setItem(DRAFT_KEY(this.problemId), this.editor.value); } catch { /* 무시 */ }
        }, 300);
    }

    startWorker() {
        const worker = new Worker(new URL('jyuno-worker.js', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.addEventListener('message', (e) => {
            if (worker !== this.worker) return;
            const data = e.data;
            switch (data.type) {
                case 'ready':
                    this.dotnet.invokeMethodAsync('OnWorkerReady');
                    break;
                case 'boot-error':
                    this.dotnet.invokeMethodAsync('OnWorkerError', data.message);
                    break;
                case 'output':
                    if (data.kind === 'judge' && this.busy) {
                        const progress = JSON.parse(data.text);
                        this.current = progress.index + 1;
                        this.armWatchdog();
                        this.dotnet.invokeMethodAsync('OnProgress', progress.index + 1, progress.total);
                    }
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

    /** 테스트 하나가 시간 제한보다 오래 걸리면 워커를 끝내고 시간 초과로 처리 */
    armWatchdog() {
        clearTimeout(this.watchdog);
        // 처음 실행은 JIT 준비 시간이 있어서 여유를 더 줌
        const grace = this.current === 0 ? 2500 : 1000;
        this.watchdog = setTimeout(() => this.timeout(), this.timeLimitMs + grace);
    }

    judge(mode) {
        if (this.busy) return;
        this.busy = true;
        this.mode = mode;
        this.current = 0;
        this.runId++;
        this.editor.setErrorLine(-1);
        this.armWatchdog();
        this.worker.postMessage({ type: 'judge', id: this.runId, code: this.editor.value, problemId: this.problemId, mode });
    }

    finish(result) {
        clearTimeout(this.watchdog);
        this.busy = false;
        const failed = (result.cases || []).find(c => c.verdict === 'GE' || c.verdict === 'RE');
        if (failed && failed.line >= 0) this.editor.setErrorLine(failed.line);
        this.dotnet.invokeMethodAsync('OnFinished', JSON.stringify(result));
    }

    timeout() {
        if (!this.busy) return;
        this.runId++;
        this.worker.terminate();
        this.startWorker();
        const index = this.current;
        this.finish({
            verdict: 'TLE',
            total: 0,
            passed: index,
            failedIndex: index,
            maxMs: this.timeLimitMs,
            cases: [{ index, verdict: 'TLE', ms: this.timeLimitMs, line: -1 }],
            killed: true,
        });
    }

    getCode() { return this.editor.value; }

    setCode(code) {
        this.editor.value = code;
        this.save();
    }

    dispose() {
        clearTimeout(this.watchdog);
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
    }
}

export function create(root, dotnet, problemId, code, timeLimitMs) {
    return new Judge(root, dotnet, problemId, code, timeLimitMs);
}
