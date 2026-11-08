// JyunoWeb의 호스트(Engine/JyunoHost.cs)를 JS로 옮긴 것: console.*, 수학, 예시 호스트 함수
import { D, JyunoError, str, formatArgs, mathFunctions, mathConstants, tryInt, tryReal } from './runtime.mjs';

const nullError = () => new JyunoError('null을 처리할수 없습니다.');
const text = (v) => (v === null ? null : str(v)); // JyunoHost.Text

// System.IO.StringReader
export class StringReader {
  constructor(s) { this.s = s; this.p = 0; }
  readLine() {
    const s = this.s;
    if (this.p >= s.length) return null;
    let i = this.p;
    while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    const line = s.slice(this.p, i);
    if (i < s.length && s[i] === '\r' && s[i + 1] === '\n') i++;
    this.p = i + 1;
    return line;
  }
  read() { return this.p < this.s.length ? this.s.charCodeAt(this.p++) : -1; }
}

export class OutputLimit extends Error { constructor() { super('output limit'); this.hostAbort = true; } }

/**
 * @param {object} o
 * @param {(s: string) => void} o.write 출력
 * @param {(s: string) => void} [o.echo] console.readline으로 읽은 입력 (화면용)
 * @param {StringReader} o.input
 */
export function addConsole(host, { write, echo = () => {}, clear = () => {}, title = () => {}, input, exhausted = () => {} }) {
  host.set('console.write', { kind: 'func', fn: (a) => { if (a.length === 0) return null; write(a.length === 1 ? text(a[0]) ?? 'null' : formatArgs(a)); return null; } });
  host.set('console.writeline', { kind: 'func', fn: (a) => {
    if (a.length === 0) write('\n');
    else if (a.length === 1) write((text(a[0]) ?? '') + '\n');
    else write(formatArgs(a) + '\n');
    return null;
  } });
  host.set('console.readline', { kind: 'func', fn: () => {
    const line = input.readLine();
    if (line === null) exhausted(); else echo(line + '\n');
    return line;
  } });
  host.set('console.read', { kind: 'func', fn: () => {
    const c = input.read();
    if (c < 0) exhausted(); else echo(String.fromCharCode(c));
    return String.fromCharCode(c < 0 ? 0xffff : c); // C#은 char 타입 (Native JS에서는 한 글자 문자열)
  } });
  host.set('console.clear', { kind: 'func', fn: () => { clear(); return null; } });
  let t = 'Jyuno';
  host.set('console.title', { kind: 'var', get: () => t, set: (v) => { t = text(v); if (t === null) throw nullError(); title(t); } });
}

export function addMath(host) {
  for (const [k, fn] of Object.entries(mathFunctions)) host.set(k, { kind: 'func', fn });
  for (const [k, value] of Object.entries(mathConstants)) host.set(k, { kind: 'const', value });
}

const toLong = (v) => {
  const i = tryInt(v);
  if (i !== undefined) return Number(i);
  const r = tryReal(v); // C#의 (long)double: 소수점 아래 버림
  if (r !== undefined) return Math.trunc(r);
  throw new JyunoError(`'${v === null ? 'null' : str(v)}'은/는 정수가 아닙니다.`);
};
export function addHostFunctions(host) {
  host.set('random', { kind: 'func', fn: (a) => {
    if (a.length === 0) return D(Math.random());
    let min = 0, max;
    if (a.length === 1) max = toLong(a[0]); else { min = toLong(a[0]); max = toLong(a[1]); }
    if (max <= min) throw new JyunoError('random의 최댓값은 최솟값보다 커야 합니다.');
    return min + Math.floor(Math.random() * (max - min));
  } });
  host.set('time.now', { kind: 'func', fn: () => Date.now() });
  host.set('text.at', { kind: 'func', fn: (a) => {
    if (a.length < 2 || typeof a[0] !== 'string') throw new JyunoError('text.at 에는 문자열과 위치가 필요합니다.');
    const s = a[0], i = toLong(a[1]);
    if (i < 0 || i >= s.length) throw new JyunoError(`위치 ${i}은/는 문자열의 범위(0 ~ ${s.length - 1})를 벗어났습니다.`);
    return s[i];
  } });
  host.set('text.upper', { kind: 'func', fn: (a) => {
    if (a.length === 0 || typeof a[0] !== 'string') throw new JyunoError('대문자로 바꿀 문자열이 필요합니다.');
    return a[0].toUpperCase();
  } });
}

/** JyunoWeb 채점과 같은 환경 (Math + 콘솔 + 예시 호스트 함수) */
export function judgeHost(stdin, { outputLimit = 1_000_000 } = {}) {
  const host = new Map();
  let out = '';
  addMath(host);
  addConsole(host, {
    input: new StringReader(stdin),
    write: (s) => { out += s; if (out.length > outputLimit) throw new OutputLimit(); },
    clear: () => { out = ''; },
  });
  addHostFunctions(host);
  return { host, output: () => out };
}

