// Jyuno Native JS: 컴파일(Jyuno → JS 함수)과 실행
import * as R from './runtime.mjs';
import { compile } from './compiler.mjs';

const { U, JList, JConst, Early, HostVar, JyunoError, GrammarSignal, builtins, listGet, listSet, repeatCount, tryInt } = R;
export { R as runtime };

// 전역 이름표: 내장 함수(Jyuno 필수 명령어)가 먼저, 호스트가 추가한 이름은 같은 이름이 없을 때만 (C#의 TryAdd)
export function globalDescriptor(host) {
  const g = new Map();
  for (const k of Object.keys(builtins)) g.set(k, { kind: 'builtin' });
  g.set('null', { kind: 'const', value: null });
  g.set('true', { kind: 'const', value: true });
  g.set('false', { kind: 'const', value: false });
  for (const [name, e] of host) if (!g.has(name)) g.set(name, e.kind === 'const' ? { kind: 'const', value: e.value } : { kind: e.kind });
  return g;
}

// new Function으로 만든 코드의 줄 번호가 몇 줄 밀리는지 (엔진마다 다름)
let lineOffset = null;
function calibrate() {
  if (lineOffset !== null) return lineOffset;
  const probe = new Function('$a', 'return new Error().stack;\n//# sourceURL=jyuno-probe.js');
  const m = /jyuno-probe\.js:(\d+)/.exec(probe() ?? '');
  lineOffset = m ? +m[1] - 1 : 2;
  return lineOffset;
}

/**
 * @param {string} source Jyuno 코드
 * @param {{host: Map, blockSubstitute?: boolean, enableRemoveVariable?: boolean}} options
 */
export function compileJyuno(source, options) {
  const t0 = performance.now();
  const globals = globalDescriptor(options.host);
  const c = compile(source.replace(/\r\n/g, '\n'), { globals, blockSubstitute: options.blockSubstitute, enableRemoveVariable: options.enableRemoveVariable, evalMode: options.evalMode });
  const t1 = performance.now();
  if (!c.ok) return { ...c, compileMs: t1 - t0 };
  const factory = new Function('$R', '$X', '$H', '$K', c.js + '\n//# sourceURL=jyuno-program.js');
  return { ...c, factory, options, compileMs: t1 - t0, evalMs: performance.now() - t1 };
}

const E = (m, t = null) => new JyunoError(m, t);
function helpers(compiled, host) {
  const removed = new Set();
  const blockSubstitute = !!compiled.options.blockSubstitute;
  const wrappers = new Map();
  const entry = (name) => {
    if (removed.has(name)) return undefined;
    if (Object.prototype.hasOwnProperty.call(builtins, name)) return { kind: 'builtin', fn: builtins[name] };
    if (name === 'null') return { kind: 'const', value: null };
    if (name === 'true') return { kind: 'const', value: true };
    if (name === 'false') return { kind: 'const', value: false };
    return host.get(name);
  };
  const wrap = (name, fn) => {
    if (!wrappers.has(name)) wrappers.set(name, (...a) => fn(a));
    return wrappers.get(name);
  };
  const holderOf = (name, e) => {
    if (e.kind === 'builtin' || e.kind === 'func') return wrap(name, e.fn);
    if (e.kind === 'const') return new HostVar(() => e.value, () => { throw E('상수에 값을 대입할수 없습니다.'); });
    return new HostVar(e.get, e.set);
  };
  const noValue = (name) => { throw E(`'${name}'에서 값을 가져올수 없습니다.`); };
  const unknownVar = (name) => { throw E(`'${name}'은/는 알수없는 변수/함수 입니다.`); };
  const unknownCall = (name) => { throw E(`'${name}'은/는 존재하지 않는 함수/변수/명령어 입니다.`); };
  const notVar = (name) => { throw E(`'${name}'은/는 변수가 아닙니다.`); };
  const constChange = () => { throw E('상수를 변경할수 없습니다.'); };
  const noSubstitute = () => { throw E('런타임에서 변수 대입 연산을 허용하지 않습니다.'); };
  const bw = {};
  for (const k of Object.keys(builtins)) bw[k] = wrap(k, builtins[k]);
  return {
    $B: builtins,
    $bw: bw,
    $rv(h, name) { if (typeof h === 'function') noValue(name); return h instanceof JConst ? h.v : h; },
    $chkSet(h, name, v) { if (typeof h === 'function') notVar(name); if (h instanceof JConst) constChange(); return v; },
    $localSet(h, name, v) { if (h === U) return v; if (typeof h === 'function') notVar(name); if (h instanceof JConst) constChange(); return v; },
    $call(h, hasArgs, closed, argsFn) {
      if (typeof h === 'function') return h(...argsFn());
      const v = h instanceof JConst ? h.v : h instanceof HostVar ? h.get() : h;
      if (!hasArgs) return v;
      if (v instanceof JList) {
        const a = argsFn();
        switch (a.length) {
          case 0: return v;
          case 1: return listGet(v, a[0]);
          case 2: if (blockSubstitute) noSubstitute(); return listSet(v, a[0], a[1]);
          default: throw E("배열/리스트는 '(이름) (인덱스)' 또는 '(이름) (인덱스) (값)' 형식으로만 쓸수 있습니다.");
        }
      }
      return closed ? new Early(v) : v;
    },
    $lget: listGet,
    $lset: listSet,
    $rc1: (a) => repeatCount([a]),
    $gv(name) {
      const e = entry(name);
      if (e === undefined) unknownVar(name);
      if (e.kind === 'builtin' || e.kind === 'func') noValue(name);
      return e.kind === 'const' ? e.value : e.get();
    },
    $gh(name) { const e = entry(name); if (e === undefined) unknownCall(name); return holderOf(name, e); },
    $gHas: (name) => entry(name) !== undefined,
    $gSet(name, v) {
      const e = entry(name);
      if (e.kind === 'const') throw E('상수에 값을 대입할수 없습니다.');
      if (e.kind !== 'var') notVar(name);
      e.set(v);
      return null;
    },
    $gRemove(name) { if (entry(name) === undefined) return false; removed.add(name); return true; },
    $grammar(line, msg) { throw new GrammarSignal(line, msg); },
    $noValue: noValue, $unknownVar: unknownVar, $unknownCall: unknownCall, $notVar: notVar,
    $constAssign() { throw E('상수에 값을 대입할수 없습니다.'); },
    $noSubstitute: noSubstitute,
    $noRemove() { throw E('런타임에서 변수/함수 삭제 연산을 허용하지 않습니다.'); },
    $cannotProcess() { throw E('처리할수 없습니다.'); },
    $parenError() { throw E("괄호 '(' 다음에는 ')'로 끝나야만 합니다."); },
    $badIndexArgs() { throw E("배열/리스트는 '(이름) (인덱스)' 또는 '(이름) (인덱스) (값)' 형식으로만 쓸수 있습니다."); },
    $forSyntax() { throw E("for는 'for (이름) (배열/리스트/문자열)' 형식으로만 쓸수 있습니다."); },
    $forArity() { throw E('for 다음에는 변수 이름과 순회할 값 하나만 와야 합니다.'); },
    $funcSyntax() { throw E('func 다음에는 함수 이름 하나만 와야 합니다.'); },
    $paramSyntax() { throw E('param 다음에는 파라미터 이름 하나만 와야 합니다.'); },
    $localSyntax() { throw E('local 다음에는 변수 이름이 와야 합니다.'); },
    $localForm() { throw E("local은 'local (이름)' 또는 'local (이름) = (값)' 형식으로만 쓸수 있습니다."); },
    $gotoMissing() { throw E('이동할 값을 넣지 않았습니다.'); },
    $gotoFail(v, line) {
      const n = tryInt(v);
      if (n === undefined) throw E('실행 위치는 음이 아닌 정수여야 합니다.');
      if (n < 0) throw E('실행 위치를 음수로 이동할수 없습니다.');
      if (n > compiled.lineCount) throw E('실행 위치가 스크립트의 범위를 벗어났습니다.');
      const o = n < compiled.lineCount ? compiled.owner[Number(n)] : -1;
      if (o !== compiled.owner[line]) throw E('goto로 함수 안팎을 넘나들수 없습니다.');
      throw E(`Native JS 제약: goto로 ${n}번 줄로 이동할수 없습니다. (컴파일할 때 알수 있는 레이블/줄 번호만 가능)`, 'NativeJsRestriction');
    },
    $tooDeep() { throw E('함수 호출이 너무 깊습니다. (최대 200번)'); },
  };
}

// 생성 코드가 호스트 함수/변수를 가져가는 통로
function hostApi(host) {
  const get = (name) => {
    const e = host.get(name);
    if (!e) throw new Error(`호스트에 ${name}이/가 없습니다.`);
    return e;
  };
  return {
    fn: (name) => get(name).fn,
    var: (name) => { const e = get(name); return new HostVar(e.get, e.set); },
    wrap: (name) => { const f = get(name).fn; return (...a) => f(a); },
    holder: (name) => {
      const e = get(name);
      if (e.kind === 'const') return new HostVar(() => e.value, () => { throw E('상수에 값을 대입할수 없습니다.'); });
      return new HostVar(e.get, e.set);
    },
  };
}

// 오류가 난 Jyuno 줄: 스택 트레이스에서 생성 코드의 가장 안쪽 프레임을 찾아서 줄 대응표로 바꿈 (실행 중에는 비용 없음)
function errorLine(e, compiled) {
  const stack = typeof e?.stack === 'string' ? e.stack : '';
  const off = calibrate();
  const re = /jyuno-program\.js:(\d+):\d+/g;
  let m;
  while ((m = re.exec(stack))) {
    const js = +m[1] - 1 - off;
    const l = compiled.lineMap[js];
    if (l === -2) continue; // 함수 머리(호출 깊이 검사): 호출한 줄로
    if (l !== undefined && l >= 0) return l;
  }
  return -1;
}

/** 컴파일한 코드를 한번 실행 (판정마다 새 호스트로 여러번 실행할수 있음) */
export function runCompiled(compiled, host) {
  const X = helpers(compiled, host);
  const main = compiled.factory(R, X, hostApi(host), compiled.consts);
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  try {
    const value = main();
    return { status: 'ok', value };
  } catch (e) {
    if (e instanceof GrammarSignal) return { status: 'grammar', message: e.message, line: e.line };
    const line = errorLine(e, compiled);
    if (e && e.hostAbort) return { status: 'abort', error: e, line }; // 출력 제한 등은 호스트가 처리
    if (e instanceof JyunoError) return { status: 'error', message: e.message, line, exceptionType: e.netType };
    if (e instanceof RangeError && /string length/i.test(e.message)) return { status: 'error', message: 'Insufficient memory to continue the execution of the program.', line, exceptionType: 'OutOfMemoryException' };
    return { status: 'error', message: String(e?.message ?? e), line, exceptionType: e?.name ?? 'Error' };
  } finally {
    Error.stackTraceLimit = limit;
  }
}
