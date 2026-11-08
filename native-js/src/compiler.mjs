// Jyuno → JavaScript 컴파일러 (연구용 프로토타입)
//
// 1. 줄마다 토큰화하고, 인터프리터의 BlockMap과 같은 방법으로 블록 짝을 찾음
// 2. 줄을 문장 트리(if/while/repeat/for/func ...)로 묶음
// 3. 영역 분석: 각 영역(최상위, 함수 호출, for 반복 한번)에서 만들어질수 있는 이름을 모으고,
//    이름마다 JS 지역 변수(칸) 하나를 둠. 칸이 아직 없다는 표시는 U. 이름 해석(지금 영역 → 바깥 영역 → 전역)은
//    "칸이 U가 아닌 가장 가까운 영역"이므로, 인터프리터의 동적인 이름 해석이 JS의 렉시컬 클로저로 바뀜
// 4. 확정 분석: 어느 지점에서 칸이 반드시 있는지(D)/반드시 없는지(U)/모르는지(M)를 추적해서,
//    대부분의 이름 읽기/쓰기를 JS 지역 변수 하나로 만듦
// 5. 내장 함수 이름(add, less ...)을 스크립트 어디서도 다시 정의/삭제하지 않으면, 호출을 빠른 경로 함수로 바꿈
// 6. goto는 같은 블록이나 바깥 블록의 줄로만 이동할수 있다는 제약 아래, 레이블이 붙은 블록을
//    "for(;;) { switch(pc) { case ... } }" 디스패치 루프로 만들어서 continue로 이동
import { tokenize } from './tokenizer.mjs';
import { JDouble } from './runtime.mjs';

export class CompileError extends Error {
  constructor(line, message, kind) { super(message); this.line = line; this.kind = kind; }
}

// ───────────── 식 (LineCompiler.cs의 compile_expression/compile_call/compile_arguments와 같은 구조) ─────────────
const isPrefix = (t, i, ch) => i < t.length && t[i].t === 'prefix' && t[i].v === ch;
function closeNode(inner) { return inner.early ? { k: 'close', inner } : inner; }
function compileExpression(t, start, closed) {
  const end = t.length;
  if (start >= t.length) return [{ k: 'const', v: null }, end];
  const tk = t[start];
  switch (tk.t) {
    case 'const':
      if (isPrefix(t, start + 1, '=') && t.length > start + 2 && t[start + 2].t === 'name') return [{ k: 'mkconst', name: t[start + 2].v, v: tk.v }, end];
      return [{ k: 'const', v: tk.v }, start + 1];
    case 'name': {
      const name = tk.v;
      if (isPrefix(t, start + 1, '=')) {
        if (start + 2 >= t.length || isPrefix(t, start + 2, ')')) return [{ k: 'delete', name }, start + 2];
        const [rhs, e] = compileExpression(t, start + 2, closed);
        return [{ k: 'assign', name, rhs, early: rhs.early }, e];
      }
      if (isPrefix(t, start + 1, ':')) return [{ k: 'label', name }, end];
      return compileCall(t, start, closed);
    }
    case 'prefix':
      if (tk.v === '(') {
        const [inner, ie] = compileExpression(t, start + 1, true);
        if (!isPrefix(t, ie, ')')) return [{ k: 'throwAfter', inner }, end];
        return [closeNode(inner), ie + 1];
      }
      if (tk.v === ')') return [{ k: 'const', v: null }, start];
      return [{ k: 'const', v: null }, end];
    default:
      return [{ k: 'fail' }, end];
  }
}
function compileCall(t, start, closed) {
  const name = t[start].v;
  const hasArgs = start + 1 < t.length && !isPrefix(t, start + 1, ')');
  const [args, end] = compileArguments(t, start + 1);
  return [{ k: 'call', name, args, hasArgs, closed, early: closed && hasArgs }, end];
}
function compileArguments(t, start) {
  const args = [];
  for (let i = start; i < t.length; i++) {
    const tk = t[i];
    if (tk.t === 'const') args.push({ k: 'const', v: tk.v });
    else if (tk.t === 'name') args.push({ k: 'var', name: tk.v });
    else if (tk.t === 'prefix') {
      if (tk.v === '(') {
        const [inner, ie] = compileExpression(t, i + 1, true);
        if (!isPrefix(t, ie, ')')) { args.push({ k: 'throwAfter', inner }); return [args, t.length]; }
        args.push(closeNode(inner));
        i = ie;
      } else if (tk.v === ')') return [args, i];
    }
  }
  return [args, t.length];
}

// ───────────── 블록 짝 (Interpreter.BlockMap) ─────────────
function blockMap(toks) {
  const n = toks.length;
  const Pair = new Array(n).fill(-1), Errors = new Array(n).fill(null), Owner = new Array(n).fill(-1), ParamIndex = new Array(n).fill(0);
  const opened = [];
  const breaks = [];
  const paramCounts = new Map();
  const kw = (l) => (toks[l].length > 0 && toks[l][0].t === 'kw' ? toks[l][0].v : null);
  const unclosed = (l) => {
    if (kw(l) === 'func') { Errors[l] = 'func 키워드는 endfunc 키워드로 종료 표시가 있어야 합니다.'; return; }
    Errors[l] = '모든 조건문(if, while 등) 키워드는 end 키워드로 종료 표시가 있어야 합니다.';
    if (Pair[l] >= 0) Errors[Pair[l]] = Errors[l];
  };
  for (let line = 0; line < n; line++) {
    Owner[line] = -1;
    for (let i = opened.length - 1; i >= 0; i--) if (kw(opened[i]) === 'func') { Owner[line] = opened[i]; break; }
    const k = kw(line);
    if (k === null) continue;
    if (k === 'func' || k === 'if' || k === 'while' || k === 'repeat' || k === 'for') { opened.push(line); continue; }
    switch (k) {
      case 'else': {
        const o = opened.at(-1);
        if (opened.length && kw(o) === 'if' && Pair[o] < 0) Pair[o] = line;
        else Errors[line] = 'else는 if와 end 사이에 한번만 쓸수 있습니다.';
        break;
      }
      case 'end': {
        if (!opened.length || kw(opened.at(-1)) === 'func') { Errors[line] = 'end와 짝이 되는 if, while, repeat, for 키워드가 없습니다.'; break; }
        const o = opened.pop();
        if (Pair[o] >= 0) Pair[Pair[o]] = line; else Pair[o] = line;
        Pair[line] = o;
        break;
      }
      case 'endfunc': {
        const f = Owner[line];
        if (f < 0) { Errors[line] = 'endfunc와 짝이 되는 func 키워드가 없습니다.'; break; }
        while (opened.at(-1) !== f) unclosed(opened.pop());
        opened.pop();
        Pair[f] = line; Pair[line] = f;
        break;
      }
      case 'break': {
        let loop = -1;
        for (let i = opened.length - 1; i >= 0; i--) {
          const kk = kw(opened[i]);
          if (kk === 'func') break;
          if (kk !== 'if') { loop = opened[i]; break; }
        }
        if (loop < 0) Errors[line] = 'break는 반복문(while, repeat, for) 안에서만 쓸수 있습니다.';
        else breaks.push([line, loop]);
        break;
      }
      case 'param': {
        if (Owner[line] < 0) { Errors[line] = 'param은 func와 endfunc 사이에서만 쓸수 있습니다.'; break; }
        const idx = paramCounts.get(Owner[line]) ?? 0;
        ParamIndex[line] = idx;
        paramCounts.set(Owner[line], idx + 1);
        break;
      }
    }
  }
  for (let i = opened.length - 1; i >= 0; i--) unclosed(opened[i]);
  for (const [line, loop] of breaks) { if (Errors[loop] === null) Pair[line] = Pair[loop]; else Errors[line] = Errors[loop]; }
  return { Pair, Errors, Owner, ParamIndex, paramCounts, kw };
}

// ───────────── 문장 트리 ─────────────
function buildTree(toks, bm) {
  const { Pair, ParamIndex, paramCounts, kw } = bm;
  const errOf = (l) => { const t = toks[l]; return t.length && t[t.length - 1].t === 'error' ? t[t.length - 1].v : null; };
  const args = (t, from) => compileArguments(t, from)[0];
  function seq(from, to) {
    const out = [];
    for (let i = from; i < to;) {
      const t = toks[i];
      const k = kw(i);
      const err = errOf(i);
      if (k === null) {
        out.push(err ? { k: 'grammar', line: i, msg: err } : t.length ? { k: 'expr', line: i, e: compileExpression(t, 0, false)[0] } : { k: 'empty', line: i });
        i++;
        continue;
      }
      switch (k) {
        case 'if': {
          const p = Pair[i];
          let elseLine = -1, endLine = p;
          if (kw(p) === 'else') { elseLine = p; endLine = Pair[p]; }
          out.push({
            k: 'if', line: i, err, args: err ? [] : args(t, 1),
            then: seq(i + 1, elseLine >= 0 ? elseLine : endLine),
            else: elseLine >= 0 ? seq(elseLine + 1, endLine) : null,
            elseLine, endLine, elseErr: elseLine >= 0 ? errOf(elseLine) : null, endErr: errOf(endLine),
          });
          i = endLine + 1;
          break;
        }
        case 'while': case 'repeat': case 'for': {
          const endLine = Pair[i];
          const st = { k, line: i, err, endLine, endErr: errOf(endLine), body: seq(i + 1, endLine) };
          if (k === 'for') { st.var = t.length >= 3 && t[1].t === 'name' ? t[1].v : null; st.args = err ? [] : args(t, 2); }
          else st.args = err ? [] : args(t, 1);
          out.push(st);
          i = endLine + 1;
          break;
        }
        case 'func': {
          const endLine = Pair[i];
          out.push({ k: 'func', line: i, err, name: t.length === 2 && t[1].t === 'name' ? t[1].v : null, endLine, nparams: paramCounts.get(i) ?? 0, body: seq(i + 1, endLine) });
          i = endLine + 1;
          break;
        }
        case 'return': case 'goto':
          out.push({ k, line: i, err, args: err ? [] : args(t, 1) });
          i++;
          break;
        case 'break':
          out.push({ k: 'break', line: i, err, loopLine: Pair[Pair[i]] });
          i++;
          break;
        case 'param':
          out.push({ k: 'param', line: i, err, name: t.length === 2 && t[1].t === 'name' ? t[1].v : null, index: ParamIndex[i] });
          i++;
          break;
        case 'local': {
          const st = { k: 'local', line: i, err, name: t.length >= 2 && t[1].t === 'name' ? t[1].v : null, value: null, bad: false };
          if (t.length > 2) {
            if (t.length > 3 && isPrefix(t, 2, '=')) st.value = compileExpression(t, 3, false)[0];
            else st.bad = true;
          }
          out.push(st);
          i++;
          break;
        }
        default:
          throw new CompileError(i, `내부 오류: 예상하지 못한 ${k}`, 'internal');
      }
    }
    return out;
  }
  return seq(0, toks.length);
}

// ───────────── 영역 분석 ─────────────
let scopeSeq = 0;
class Scope {
  constructor(kind, parent, owner) {
    this.kind = kind; this.parent = parent; this.owner = owner;
    this.id = scopeSeq++;
    this.cand = new Map(); // 이름 → Set('var' | 'func' | 'const')
  }
  add(name, kind) { let s = this.cand.get(name); if (!s) this.cand.set(name, s = new Set()); s.add(kind); }
}

function analyze(tree, top) {
  const deleted = new Set();
  const owners = [];
  function walkExpr(e, scope) {
    switch (e.k) {
      case 'assign': scope.add(e.name, 'var'); walkExpr(e.rhs, scope); break;
      case 'mkconst': scope.add(e.name, 'const'); break;
      case 'label': scope.add(e.name, 'var'); break;
      case 'delete': deleted.add(e.name); break;
      case 'call': e.args.forEach((a) => walkExpr(a, scope)); break;
      case 'close': case 'throwAfter': walkExpr(e.inner, scope); break;
    }
  }
  function walk(stmts, scope, owner, parentSeq) {
    stmts.forEach((s, idx) => {
      s.seq = stmts; s.idx = idx; s.parentStmt = parentSeq; s.owner = owner; s.scope = scope;
      switch (s.k) {
        case 'expr': walkExpr(s.e, scope); break;
        case 'if':
          s.args.forEach((a) => walkExpr(a, scope));
          walk(s.then, scope, owner, s);
          if (s.else) walk(s.else, scope, owner, s);
          break;
        case 'while': case 'repeat':
          s.args.forEach((a) => walkExpr(a, scope));
          walk(s.body, scope, owner, s);
          break;
        case 'for': {
          s.args.forEach((a) => walkExpr(a, scope));
          s.inner = new Scope('for', scope, owner);
          if (s.var !== null) s.inner.add(s.var, 'var');
          walk(s.body, s.inner, owner, s);
          break;
        }
        case 'func': {
          if (s.name !== null && !s.err) scope.add(s.name, 'func');
          s.inner = new Scope('func', scope, s);
          s.gotos = [];
          owners.push(s);
          walk(s.body, s.inner, s, s);
          break;
        }
        case 'return': case 'goto':
          s.args.forEach((a) => walkExpr(a, scope));
          if (s.k === 'goto') owner.gotos.push(s);
          break;
        case 'param': if (s.name !== null) scope.add(s.name, 'var'); break;
        case 'local':
          if (s.name !== null) scope.add(s.name, 'var');
          if (s.value) walkExpr(s.value, scope);
          break;
      }
    });
  }
  top.gotos = [];
  owners.push(top);
  walk(tree, top.scope, top, null);
  return { deleted, owners };
}

// 문장들이 지금 영역에 만들수 있는(또는 지울수 있는) 이름 (안쪽 for/func 영역은 제외)
function createdIn(stmts, out = new Set()) {
  const ex = (e) => {
    switch (e.k) {
      case 'assign': out.add(e.name); ex(e.rhs); break;
      case 'mkconst': case 'label': case 'delete': out.add(e.name); break;
      case 'call': e.args.forEach(ex); break;
      case 'close': case 'throwAfter': ex(e.inner); break;
    }
  };
  for (const s of stmts) {
    switch (s.k) {
      case 'expr': ex(s.e); break;
      case 'if': s.args.forEach(ex); createdIn(s.then, out); if (s.else) createdIn(s.else, out); break;
      case 'while': case 'repeat': s.args.forEach(ex); createdIn(s.body, out); break;
      case 'for': case 'return': case 'goto': s.args.forEach(ex); break;
      case 'func': case 'param': if (s.name !== null) out.add(s.name); break;
      case 'local': if (s.name !== null) out.add(s.name); if (s.value) ex(s.value); break;
    }
  }
  return out;
}

// ───────────── goto 대상 계산 ─────────────
// 대상 줄이 goto와 같은 블록 또는 바깥 블록에 있을 때만 허용 (블록 안으로 들어가는 goto는 제약)
let dispatchSeq = 0;
function resolveGotos(owner, bm, lineCount) {
  const body = owner === owner.top ? owner.tree : owner.body;
  const stmtAt = new Map(); // 줄 → 그 줄에서 시작하는 문장 (같은 함수 안, 안쪽 함수 제외)
  const index = (stmts) => stmts.forEach((s) => {
    stmtAt.set(s.line, s);
    if (s.k === 'if') { index(s.then); if (s.else) index(s.else); }
    else if (s.k === 'while' || s.k === 'repeat' || s.k === 'for') index(s.body);
  });
  index(body);
  const labelsByName = new Map();
  for (const [line, s] of stmtAt) if (s.k === 'expr' && s.e.k === 'label') {
    if (!labelsByName.has(s.e.name)) labelsByName.set(s.e.name, []);
    labelsByName.get(s.e.name).push(line);
  }
  const gOwnerLine = owner === owner.top ? -1 : owner.line;
  for (const g of owner.gotos) {
    g.targets = [];
    if (g.err || g.args.length === 0) continue;
    // goto를 감싸는 블록(문장 배열)과 문장
    const enclSeqs = [], enclStmts = [];
    for (let s = g; ;) {
      enclSeqs.push(s.seq);
      const p = s.parentStmt;
      if (!p || p === owner) break;
      enclStmts.push(p);
      s = p;
    }
    const a = g.args[0];
    let lines;
    if (a.k === 'const') lines = typeof a.v === 'number' && Number.isInteger(a.v) ? [a.v] : []; // 정수가 아닌 상수는 실행할 때 인터프리터와 같은 오류
    else if (a.k === 'var' && labelsByName.has(a.name)) lines = labelsByName.get(a.name);
    else lines = [...labelsByName.values()].flat(); // 계산한 대상: 이 함수의 레이블 줄 중 하나일 때만 이동 가능
    for (const T of lines) {
      if (T < 0 || T > lineCount) continue; // 실행할 때 인터프리터와 같은 오류
      const tOwner = T < lineCount ? bm.Owner[T] : -1;
      if (tOwner !== gOwnerLine) continue;
      let pos;
      if (T === lineCount || (owner !== owner.top && T === owner.endLine)) pos = { kind: 'exit' };
      else if (stmtAt.has(T)) pos = { kind: 'before', stmt: stmtAt.get(T) };
      else {
        // else/end 줄: 인터프리터가 그 줄을 실행했을 때와 같은 위치
        const opener = [...stmtAt.values()].find((s) => s.k !== 'func' && (s.endLine === T || s.elseLine === T));
        if (!opener) continue;
        if (opener.k === 'if') pos = { kind: 'after', stmt: opener };
        else if (opener.k === 'while') pos = { kind: 'before', stmt: opener };
        else pos = enclStmts.includes(opener) ? { kind: 'continue', stmt: opener } : { kind: 'after', stmt: opener };
      }
      if (pos.kind === 'before' || pos.kind === 'after') {
        const seq = pos.stmt.seq;
        // 블록 안으로 들어가는 대상은 건너뜀 (실행할 때 그 줄로 가려고 하면 제약 오류)
        if (!enclSeqs.includes(seq)) continue;
        if (!seq.targets) { seq.targets = new Map(); seq.dispatchId = ++dispatchSeq; }
        const k = pos.kind === 'before' ? pos.stmt.idx : pos.stmt.idx + 1;
        if (!seq.targets.has(k)) seq.targets.set(k, seq.targets.size + 1);
        pos.seq = seq;
        pos.case = seq.targets.get(k);
      }
      g.targets.push({ line: T, pos });
    }
  }
}

// ───────────── 코드 생성 ─────────────
const IDENT_RE = /[A-Za-z0-9]/;
function mangle(name) {
  let s = '';
  for (const ch of name) {
    if (IDENT_RE.test(ch)) s += ch;
    else if (ch === '_') s += '__';
    else for (let i = 0; i < ch.length; i++) s += '_' + ch.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return s;
}
const slotName = (scope, name) => `$${scope.id}_${mangle(name)}`;
const J = (s) => JSON.stringify(s);

// 인자 개수가 정해진 빠른 경로
const FAST = {
  add: { 2: 'add2' }, sub: { 2: 'sub2' }, mul: { 2: 'mul2' }, div: { 2: 'div2' }, mod: { 2: 'mod2' },
  equal: { 2: 'equal2' }, less: { 2: 'less2' }, greater: { 2: 'greater2' },
  and: { 2: 'and2' }, or: { 2: 'or2' }, not: { 1: 'not1' }, length: { 1: 'length1' },
};
const BOOL_RESULT = new Set(['equal', 'less', 'greater', 'bool']);

export function compile(source, options) {
  scopeSeq = 0;
  dispatchSeq = 0;
  const globals = options.globals; // Map 이름 → { kind: 'builtin'|'func'|'var'|'const', value? }
  const blockSubstitute = !!options.blockSubstitute;
  const enableRemove = options.enableRemoveVariable !== false;
  const lines = source.split('\n');
  const toks = lines.map(tokenize);
  const bm = blockMap(toks);
  const structural = bm.Errors.map((m, l) => (m ? new CompileError(l, m, 'grammar') : null)).filter(Boolean);
  if (structural.length) return { ok: false, errors: structural };
  let tree;
  const top = { top: null, line: -1, gotos: [] };
  top.top = top;
  try {
    tree = buildTree(toks, bm);
  } catch (e) { if (e instanceof CompileError) return { ok: false, errors: [e] }; throw e; }
  top.tree = tree;
  top.scope = new Scope('top', null, top);
  const { deleted, owners } = analyze(tree, top);
  for (const o of owners) o.top = top;
  try {
    for (const o of owners) resolveGotos(o, bm, lines.length);
  } catch (e) { if (e instanceof CompileError) return { ok: false, errors: [e] }; throw e; }

  // 전역 이름 (스크립트 어디서도 삭제하지 않으면 정적으로 결정)
  const hostRefs = new Map(); // 이름 → 생성 코드에서 쓰는 JS 변수
  const hostRef = (name, what) => {
    const key = what + ':' + name;
    if (!hostRefs.has(key)) hostRefs.set(key, { name: `$h${hostRefs.size}`, what, gname: name });
    return hostRefs.get(key).name;
  };
  const glob = (name) => (deleted.has(name) ? { kind: 'dynamic' } : globals.get(name) ?? { kind: 'none' });
  const consts = [];
  const constRef = (v) => { consts.push(v); return `$k${consts.length - 1}`; };

  // 출력
  const out = []; // { code, line }
  const emit = (code, line) => out.push({ code, line });

  // ── 확정 분석 상태 ──
  class Cx {
    constructor(scope, fn, st) { this.scope = scope; this.fn = fn; this.st = st; }
  }
  const getStatus = (cx, X, name) => {
    if (!X.cand.has(name)) return 'U';
    const s = cx.st.get(X)?.get(name) ?? 'M';
    return s === 'D' && deleted.has(name) ? 'M' : s;
  };
  const setStatus = (cx, X, name, s) => { if (X.cand.has(name)) cx.st.get(X).set(name, s); };
  const cloneSt = (st) => { const m = new Map(); for (const [k, v] of st) m.set(k, new Map(v)); return m; };
  const joinSt = (a, b) => {
    const m = cloneSt(a);
    for (const [X, mb] of b) {
      const ma = m.get(X);
      if (!ma) continue;
      for (const [n, sb] of mb) if (ma.get(n) !== sb) ma.set(n, 'M');
    }
    return m;
  };
  const trackable = (scope) => scope.owner.gotos.length === 0;
  const freshStatuses = (scope, forVar) => {
    const m = new Map();
    const t = trackable(scope);
    for (const n of scope.cand.keys()) m.set(n, n === forVar ? 'D' : t ? 'U' : 'M');
    return m;
  };
  const newTemp = (cx) => { const t = `$t${cx.fn.temps++}`; return t; };

  function chain(cx, name) {
    const parts = [];
    for (let X = cx.scope; X; X = X.parent) {
      if (!X.cand.has(name)) continue;
      const s = getStatus(cx, X, name);
      if (s === 'U') continue;
      parts.push({ X, slot: slotName(X, name), def: s === 'D', kinds: X.cand.get(name) });
      if (s === 'D') return { parts, definite: true };
    }
    return { parts, definite: false };
  }
  const onlyVar = (kinds) => kinds.size === 1 && kinds.has('var');

  // 전역 값 읽기
  function globalValue(name) {
    const g = glob(name);
    switch (g.kind) {
      case 'dynamic': return `$gv(${J(name)})`;
      case 'builtin': case 'func': return `$noValue(${J(name)})`;
      case 'const': return literal(g.value);
      case 'var': return `${hostRef(name, 'var')}.get()`;
      default: return `$unknownVar(${J(name)})`;
    }
  }
  function literal(v) {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return J(v);
    if (typeof v === 'bigint') return `(${v}n)`;
    if (v instanceof JDouble) return constRef(v);
    if (typeof v === 'number') {
      if (v !== v) return 'NaN';
      return v < 0 ? `(${v})` : String(v);
    }
    return constRef(v);
  }
  function readVar(cx, name) {
    const { parts, definite } = chain(cx, name);
    let code = definite ? null : globalValue(name);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const v = onlyVar(p.kinds) ? p.slot : `$rv(${p.slot}, ${J(name)})`;
      code = code === null ? v : `(${p.slot} !== U ? ${v} : ${code})`;
    }
    return code;
  }
  // 변수에 대입: 지금 영역부터 찾아서 있으면 바꾸고, 없으면 (전역 변수가 아니라면) 지금 영역에 만듦
  function assignCode(cx, name, t) {
    const { parts, definite } = chain(cx, name);
    const set = (p) => (onlyVar(p.kinds) ? `${p.slot} = ${t}` : `${p.slot} = $chkSet(${p.slot}, ${J(name)}, ${t})`);
    let code = null;
    if (!definite) {
      const g = glob(name);
      const cur = slotName(cx.scope, name);
      switch (g.kind) {
        case 'dynamic': code = `($gHas(${J(name)}) ? $gSet(${J(name)}, ${t}) : (${cur} = ${t}))`; break;
        case 'var': code = `${hostRef(name, 'var')}.set(${t})`; break;
        case 'const': code = `$constAssign()`; break;
        case 'builtin': case 'func': code = `$notVar(${J(name)})`; break;
        default: code = `${cur} = ${t}`;
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      code = code === null ? set(p) : `(${p.slot} !== U ? ${set(p)} : ${code})`;
    }
    // 상태 갱신
    const g = glob(name);
    if (!definite) {
      const cs = getStatus(cx, cx.scope, name);
      if (parts.length === 0 && g.kind === 'none') setStatus(cx, cx.scope, name, 'D');
      else if (cs === 'U' && (g.kind === 'none' || g.kind === 'dynamic')) setStatus(cx, cx.scope, name, 'M');
    }
    return code;
  }

  // 식 → { code, bool(결과가 항상 bool), early(EarlyEnd를 돌려줄수 있음) }
  function gen(cx, e) {
    switch (e.k) {
      case 'const': return { code: literal(e.v) };
      case 'var': return { code: readVar(cx, e.name) };
      case 'fail': return { code: '$cannotProcess()' };
      case 'throwAfter': return { code: `(${gen(cx, e.inner).code}, $parenError())` };
      case 'close': {
        const inner = gen(cx, e.inner);
        if (!inner.early) return inner;
        const t = newTemp(cx);
        return { code: `((${t} = ${inner.code}) instanceof Early ? $parenError() : ${t})` };
      }
      case 'mkconst': {
        const code = `(${slotName(cx.scope, e.name)} = new JConst(${literal(e.v)}), null)`;
        setStatus(cx, cx.scope, e.name, 'D');
        return { code };
      }
      case 'label': {
        const code = `(${slotName(cx.scope, e.name)} = ${cx.line}, null)`;
        setStatus(cx, cx.scope, e.name, 'D');
        return { code };
      }
      case 'delete': {
        if (!enableRemove) return { code: '$noRemove()' };
        const { parts, definite } = chain(cx, e.name);
        let code = definite ? null : `$gRemove(${J(e.name)})`;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          const del = `(${p.slot} = U, true)`;
          code = code === null ? del : `(${p.slot} !== U ? ${del} : ${code})`;
        }
        for (let X = cx.scope; X; X = X.parent) if (X.cand.has(e.name) && getStatus(cx, X, e.name) !== 'U') setStatus(cx, X, e.name, 'M');
        return { code };
      }
      case 'assign': {
        if (blockSubstitute) return { code: '$noSubstitute()' };
        const rhs = gen(cx, e.rhs);
        const t = newTemp(cx);
        if (rhs.early) {
          const a1 = assignCode(cx, e.name, `${t}.v`);
          const a2 = assignCode(cx, e.name, t);
          return { code: `((${t} = ${rhs.code}) instanceof Early ? (${a1}, EARLY_NULL) : (${a2}, null))`, early: true };
        }
        // 흔한 경우: 반드시 있는 변수 칸에 바로 대입
        const { parts, definite } = chain(cx, e.name);
        if (definite && parts.length === 1 && onlyVar(parts[0].kinds)) return { code: `(${parts[0].slot} = ${rhs.code}, null)`, stmt: `${parts[0].slot} = ${rhs.code}` };
        const a = assignCode(cx, e.name, t);
        return { code: `(${t} = ${rhs.code}, ${a}, null)` };
      }
      case 'call': return genCall(cx, e);
    }
    throw new Error('알수없는 식 ' + e.k);
  }
  const genArgs = (cx, args) => args.map((a) => gen(cx, a).code);
  // 조건부로만 계산되는 코드 (상태를 합침)
  function conditional(cx, f) {
    const before = cloneSt(cx.st);
    const r = f();
    cx.st = joinSt(before, cx.st);
    return r;
  }
  // 변수 값 v에 대한 호출: 인자가 있으면 배열/리스트의 인덱스 읽기/쓰기
  function varCall(cx, e, vcode) {
    if (!e.hasArgs) return { code: vcode };
    const t = newTemp(cx);
    const listPart = conditional(cx, () => {
      const a = genArgs(cx, e.args);
      switch (a.length) {
        case 0: return t;
        case 1: return `$lget(${t}, ${a[0]})`;
        case 2: return blockSubstitute ? `(${a[0]}, ${a[1]}, $noSubstitute())` : `$lset(${t}, ${a[0]}, ${a[1]})`;
        default: return `(${a.join(', ')}, $badIndexArgs())`;
      }
    });
    const other = e.closed ? `new Early(${t})` : t;
    return { code: `((${t} = ${vcode}) instanceof JList ? ${listPart} : ${other})`, early: e.closed };
  }
  function genCall(cx, e) {
    const { parts, definite } = chain(cx, e.name);
    const g = definite ? { kind: 'none' } : glob(e.name);
    if (parts.length === 0) {
      switch (g.kind) {
        case 'builtin': {
          const a = genArgs(cx, e.args);
          const f = FAST[e.name]?.[a.length];
          if (f) return { code: `${f}(${a.join(', ')})`, bool: BOOL_RESULT.has(e.name) };
          if (e.name === 'bool' && a.length === 1) return { code: `truthy(${a[0]})`, bool: true };
          return { code: `$B[${J(e.name)}]([${a.join(', ')}])`, bool: BOOL_RESULT.has(e.name) };
        }
        case 'func': return { code: `${hostRef(e.name, 'fn')}([${genArgs(cx, e.args).join(', ')}])` };
        case 'var': return varCall(cx, e, `${hostRef(e.name, 'var')}.get()`);
        case 'const': return varCall(cx, e, literal(g.value));
        case 'none': return { code: `$unknownCall(${J(e.name)})` };
      }
    }
    // 이름이 함수인지 변수인지 실행할 때 정해지는 경우
    const kinds = new Set();
    for (const p of parts) for (const k of p.kinds) kinds.add(k);
    let fallback = null;
    if (!definite) {
      switch (g.kind) {
        case 'builtin': kinds.add('func'); fallback = `$bw[${J(e.name)}]`; break;
        case 'func': kinds.add('func'); fallback = hostRef(e.name, 'wrap'); break;
        case 'var': case 'const': kinds.add('var'); fallback = hostRef(e.name, 'holder'); kinds.add('holder'); break;
        case 'dynamic': kinds.add('func'); kinds.add('holder'); fallback = `$gh(${J(e.name)})`; break;
        default: fallback = `$unknownCall(${J(e.name)})`;
      }
    }
    let holder = fallback;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      holder = holder === null ? p.slot : `(${p.slot} !== U ? ${p.slot} : ${holder})`;
    }
    if (kinds.size === 1 && kinds.has('func')) {
      // 사용자 함수 호출 (인자는 이름을 찾은 다음 계산)
      return { code: `${holder}(${genArgs(cx, e.args).join(', ')})` };
    }
    if (!kinds.has('func') && !kinds.has('const') && !kinds.has('holder')) return varCall(cx, e, holder);
    // 일반형: 함수면 호출, 변수면 값 (인자는 필요할 때만 계산)
    const a = conditional(cx, () => genArgs(cx, e.args));
    return { code: `$call(${holder}, ${e.hasArgs}, ${e.closed}, () => [${a.join(', ')}])`, early: e.closed && e.hasArgs };
  }
  const cond = (cx, args) => {
    if (args.length === 0) return 'false';
    const a = args.map((x) => gen(cx, x));
    if (a.length === 1) return a[0].bool ? a[0].code : `truthy(${a[0].code})`;
    const t = newTemp(cx);
    return `truthy((${t} = ${a[0].code}, ${a.slice(1).map((x) => x.code).join(', ')}, ${t}))`;
  };
  const firstOf = (cx, args) => {
    if (args.length === 0) return 'null';
    const a = genArgs(cx, args);
    if (a.length === 1) return a[0];
    const t = newTemp(cx);
    return `(${t} = ${a[0]}, ${a.slice(1).join(', ')}, ${t})`;
  };

  // ── 문장 ──
  function genSeq(cx, stmts, endLine) {
    if (stmts.targets) {
      const pc = `$pc${stmts.dispatchId}`, label = `$D${stmts.dispatchId}`;
      emit(`{ let ${pc} = 0; ${label}: for (;;) { switch (${pc}) { case 0:`, stmts[0]?.line ?? endLine);
      stmts.forEach((s, i) => {
        if (stmts.targets.has(i)) emit(`case ${stmts.targets.get(i)}:`, s.line);
        genStmt(cx, s);
      });
      if (stmts.targets.has(stmts.length)) emit(`case ${stmts.targets.get(stmts.length)}:`, endLine);
      emit('} break; } }', endLine);
    } else {
      for (const s of stmts) genStmt(cx, s);
    }
  }
  const grammarCode = (line, msg) => `$grammar(${line}, ${J(msg)});`;
  function genStmt(cx, s) {
    cx.line = s.line;
    if (s.err && s.k !== 'if' && s.k !== 'while' && s.k !== 'repeat' && s.k !== 'for' && s.k !== 'func') { emit(grammarCode(s.line, s.err), s.line); return; }
    switch (s.k) {
      case 'empty': return;
      case 'grammar': emit(grammarCode(s.line, s.msg), s.line); return;
      case 'expr': {
        const r = gen(cx, s.e);
        if (options.evalMode && cx.scope === top.scope) { emit(`return ${r.code};`, s.line); return; }
        emit((r.stmt ?? r.code) + ';', s.line);
        return;
      }
      case 'if': {
        if (s.err) { emit(grammarCode(s.line, s.err), s.line); return; }
        emit(`if (${cond(cx, s.args)}) {`, s.line);
        const entry = cloneSt(cx.st);
        genSeq(cx, s.then, s.elseLine >= 0 ? s.elseLine : s.endLine);
        if (s.elseLine >= 0 && s.elseErr) emit(grammarCode(s.elseLine, s.elseErr), s.elseLine);
        if (s.elseLine < 0 && s.endErr) emit(grammarCode(s.endLine, s.endErr), s.endLine);
        const afterThen = cx.st;
        if (s.else) {
          emit('} else {', s.elseLine);
          cx.st = cloneSt(entry);
          genSeq(cx, s.else, s.endLine);
          if (s.endErr) emit(grammarCode(s.endLine, s.endErr), s.endLine);
          cx.st = joinSt(afterThen, cx.st);
        } else cx.st = joinSt(afterThen, entry);
        emit('}', s.endLine);
        return;
      }
      case 'while': case 'repeat': {
        if (s.err) { emit(grammarCode(s.line, s.err), s.line); return; }
        // 반복문 머리: 본문에서 만들수 있는 이름은 '모름'
        for (const n of createdIn(s.body)) if (getStatus(cx, cx.scope, n) === 'U') setStatus(cx, cx.scope, n, 'M');
        const head = cloneSt(cx.st);
        const L = `$L${s.line}`;
        if (s.k === 'while') emit(`${L}: while (${cond(cx, s.args)}) {`, s.line);
        else {
          const n = `$n${s.line}`;
          const a = genArgs(cx, s.args);
          const count = a.length === 1 ? `$rc1(${a[0]})` : `repeatCount([${a.join(', ')}])`;
          emit(`{ let ${n} = ${count}; ${L}: for (; ${n} > 0; ${n}--) {`, s.line);
        }
        const afterHead = cloneSt(cx.st);
        genSeq(cx, s.body, s.endLine);
        if (s.endErr) emit(grammarCode(s.endLine, s.endErr), s.endLine);
        emit(s.k === 'while' ? '}' : '} }', s.endLine);
        cx.st = joinSt(head, afterHead);
        return;
      }
      case 'for': {
        if (s.err) { emit(grammarCode(s.line, s.err), s.line); return; }
        const L = `$L${s.line}`;
        if (s.var === null) { emit(`$forSyntax();`, s.line); return; }
        const a = genArgs(cx, s.args);
        const it = `$it${s.line}`, i = `$i${s.line}`;
        const src = a.length === 1 ? a[0] : `(${a.length ? a.join(', ') + ', ' : ''}$forArity())`;
        const inner = s.inner;
        const innerSt = cloneSt(cx.st);
        innerSt.set(inner, freshStatuses(inner, s.var));
        const icx = new Cx(inner, cx.fn, innerSt);
        const decls = [...inner.cand.keys()].map((n) => (n === s.var ? `${slotName(inner, n)} = ${it}[${i}]` : `${slotName(inner, n)} = U`));
        emit(`{ const ${it} = forItems(${src}); ${L}: for (let ${i} = 0; ${i} < ${it}.length; ${i}++) { let ${decls.join(', ')};`, s.line);
        genSeq(icx, s.body, s.endLine);
        if (s.endErr) emit(grammarCode(s.endLine, s.endErr), s.endLine);
        emit('} }', s.endLine);
        return;
      }
      case 'func': {
        if (s.err) { emit(grammarCode(s.line, s.err), s.line); return; }
        if (s.name === null) { emit('$funcSyntax();', s.line); return; }
        const slot = slotName(cx.scope, s.name);
        setStatus(cx, cx.scope, s.name, 'D');
        // 함수 본문: 바깥 영역의 '없음'은 호출할 때 생길수 있으므로 '모름'
        const st = new Map();
        for (const [X, m] of cx.st) {
          const c = new Map();
          for (const [n, v] of m) c.set(n, v === 'U' ? 'M' : v);
          st.set(X, c);
        }
        st.set(s.inner, freshStatuses(s.inner, null));
        const fn = { temps: 0 };
        const fcx = new Cx(s.inner, fn, st);
        const params = Array.from({ length: s.nparams }, (_, i) => `$a${i}`);
        const decls = [...s.inner.cand.keys()].map((n) => `${slotName(s.inner, n)} = U`);
        emit(`${slot} = function $f_${mangle(s.name).slice(0, 40)}(${params.join(', ')}) {`, s.line);
        emit(`if ($depth >= 200) $tooDeep(); $depth++; try {`, -2);
        const tempAt = out.length;
        emit('', s.line);
        if (decls.length) emit(`let ${decls.join(', ')};`, s.line);
        fcx.params = params;
        genSeq(fcx, s.body, s.endLine);
        emit('return null; } finally { $depth--; } };', s.endLine);
        if (fn.temps) out[tempAt].code = `let ${Array.from({ length: fn.temps }, (_, i) => `$t${i}`).join(', ')};`;
        return;
      }
      case 'return': emit(`return ${firstOf(cx, s.args)};`, s.line); return;
      case 'break': emit(`break $L${s.loopLine};`, s.line); return;
      case 'param': {
        if (s.name === null) { emit('$paramSyntax();', s.line); return; }
        emit(`${slotName(cx.scope, s.name)} = ($a${s.index} === undefined ? null : $a${s.index});`, s.line);
        setStatus(cx, cx.scope, s.name, 'D');
        return;
      }
      case 'local': {
        if (s.name === null) { emit('$localSyntax();', s.line); return; }
        if (blockSubstitute) { emit('$noSubstitute();', s.line); return; }
        if (s.bad) { emit('$localForm();', s.line); return; }
        const v = s.value ? gen(cx, s.value).code : 'null';
        const slot = slotName(cx.scope, s.name);
        const kinds = cx.scope.cand.get(s.name);
        if (onlyVar(kinds)) emit(`${slot} = ${v};`, s.line);
        else emit(`${slot} = $localSet(${slot}, ${J(s.name)}, ${v});`, s.line);
        setStatus(cx, cx.scope, s.name, 'D');
        return;
      }
      case 'goto': {
        if (s.args.length === 0) { emit('$gotoMissing();', s.line); return; }
        const v = firstOf(cx, s.args);
        const tv = `$g${s.line}`;
        let code = `{ const ${tv} = ${v}; `;
        for (const { line, pos } of s.targets) {
          let jump;
          if (pos.kind === 'exit') jump = 'return null;';
          else if (pos.kind === 'continue') jump = `continue $L${pos.stmt.line};`;
          else jump = `{ $pc${pos.seq.dispatchId} = ${pos.case}; continue $D${pos.seq.dispatchId}; }`;
          code += `if (${tv} === ${line}) ${jump} `;
        }
        code += `$gotoFail(${tv}, ${s.line}); }`;
        emit(code, s.line);
        return;
      }
    }
    throw new Error('알수없는 문장 ' + s.k);
  }

  // 최상위
  const topFn = { temps: 0 };
  const topSt = new Map([[top.scope, freshStatuses(top.scope, null)]]);
  const tcx = new Cx(top.scope, topFn, topSt);
  emit('return function $main() {', -1);
  const topTempAt = out.length;
  emit('', -1);
  const topDecls = [...top.scope.cand.keys()].map((n) => `${slotName(top.scope, n)} = U`);
  if (topDecls.length) emit(`let ${topDecls.join(', ')};`, -1);
  genSeq(tcx, tree, lines.length);
  emit('return null; };', -1);
  if (topFn.temps) out[topTempAt].code = `let ${Array.from({ length: topFn.temps }, (_, i) => `$t${i}`).join(', ')};`;

  // 머리말: 런타임/호스트 연결
  const head = [];
  head.push('"use strict";');
  head.push('const { U, JList, JConst, Early, EARLY_NULL, truthy, forItems, repeatCount, add2, sub2, mul2, div2, mod2, equal2, less2, greater2, and2, or2, not1, length1 } = $R;');
  head.push('const { $B, $bw, $rv, $chkSet, $localSet, $call, $lget, $lset, $rc1, $gv, $gh, $gHas, $gSet, $gRemove, $grammar, $noValue, $unknownVar, $unknownCall, $notVar, $constAssign, $noSubstitute, $noRemove, $cannotProcess, $parenError, $badIndexArgs, $forSyntax, $forArity, $funcSyntax, $paramSyntax, $localSyntax, $localForm, $gotoMissing, $gotoFail, $tooDeep } = $X;');
  head.push('let $depth = 0;');
  for (const r of hostRefs.values()) head.push(`const ${r.name} = $H.${r.what}(${J(r.gname)});`);
  consts.forEach((_, i) => head.push(`const $k${i} = $K[${i}];`));
  const all = head.map((code) => ({ code, line: -1 })).concat(out);
  const js = all.map((x) => x.code).join('\n');
  const lineMap = all.map((x) => x.line);
  return { ok: true, js, lineMap, consts, owner: bm.Owner, lineCount: lines.length };
}
