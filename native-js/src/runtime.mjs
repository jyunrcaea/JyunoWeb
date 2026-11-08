// Jyuno Native JS 런타임: Jyuno 1.3.2(C#)의 값 모델과 내장 함수를 JavaScript로 옮긴 것
//
// 값 표현 (Jyuno → JS)
//   null            → null
//   bool            → true / false
//   int (C# long)   → 정수인 number (±2^53 안), 그 밖의 long 범위는 BigInt
//   double          → 정수가 아닌 number(NaN, ±Infinity 포함), 정수 값인 double(3.0, -0.0)만 JDouble 상자
//                     → "정수인 number = int"라는 규칙 하나로 int/double을 구별하면서, 흔한 경우는 상자 없이 계산
//   string          → string (C#과 JS 모두 UTF-16이라 길이/인덱스/비교가 같음)
//   배열/리스트       → JList { e: 원소 타입, fixed: 배열인지, a: JS 배열 }
//   func로 만든 함수  → JS 함수 (Jyuno에서 함수는 값으로 넘길수 없으므로 변수 값과 섞이지 않음)

export const U = Symbol('undefined-slot'); // 아직 만들어지지 않았거나 삭제된 변수 칸

export class JDouble { constructor(v) { this.v = v; } }
export class JList { constructor(e, fixed, a) { this.e = e; this.fixed = fixed; this.a = a; } }
export class JConst { constructor(v) { this.v = v; } }   // (상수) = (이름) 으로 만든 상수
export class Early { constructor(v) { this.v = v; } }     // 괄호 안의 식이 ')' 전에 끝남 (C#의 EarlyEnd)
export const EARLY_NULL = new Early(null);

// C#의 JyunoException 및 .NET 예외 (netType: 플레이그라운드에 보여줄 예외 타입 이름, JyunoException이면 null)
export class JyunoError extends Error {
  constructor(message, netType = null) { super(message); this.netType = netType; }
}
export class GrammarSignal extends Error {
  constructor(line, message) { super(message); this.line = line; }
}
export class HostVar { constructor(get, set) { this.get = get; this.set = set; } }

const MAXS = Number.MAX_SAFE_INTEGER;
const BMAX = 9007199254740991n;
const LONG_MIN = -9223372036854775808n;

// BigInt를 long 범위로 순환시키고, 안전한 범위면 number로
export function big2(b) {
  b = BigInt.asIntN(64, b);
  return (b <= BMAX && b >= -BMAX) ? Number(b) : b;
}
// double 연산 결과를 Jyuno double로 (정수 값이면 상자)
export const D = (x) => (Number.isInteger(x) ? new JDouble(x) : x);

export const isInt = (v) => (typeof v === 'number' ? Number.isInteger(v) : typeof v === 'bigint');
// Values.TryGetInteger: 정수면 number|bigint, 아니면 undefined
export function tryInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined;
  if (typeof v === 'bigint') return v;
  return undefined;
}
// Values.TryGetReal: 숫자면 JS number, 아니면 undefined
export function tryReal(v) {
  if (typeof v === 'number') return v;
  if (v instanceof JDouble) return v.v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

export const nullError = () => new JyunoError('null을 처리할수 없습니다.');
const err = (m, t = null) => new JyunoError(m, t);

// ───────────── 문자열 변환 (Convert.ToString(value, InvariantCulture)) ─────────────

// .NET Core 3.0+의 double.ToString(): 가장 짧은 왕복 표현, 지수가 17 이상이거나 -5 이하면 과학 표기 (1E+17, 1E-05)
export function fmtDouble(x) {
  if (x !== x) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const sign = x < 0 ? '-' : '';
  const s = Math.abs(x).toExponential();
  const ei = s.indexOf('e');
  const mant = s.slice(0, ei);
  const e = +s.slice(ei + 1);
  if (e >= 17 || e <= -5) {
    const ae = Math.abs(e);
    return sign + mant + 'E' + (e < 0 ? '-' : '+') + (ae < 10 ? '0' + ae : ae);
  }
  const digits = mant.replace('.', '');
  if (e >= 0) {
    if (digits.length <= e + 1) return sign + digits + '0'.repeat(e + 1 - digits.length);
    return sign + digits.slice(0, e + 1) + '.' + digits.slice(e + 1);
  }
  return sign + '0.' + '0'.repeat(-e - 1) + digits;
}

const ELEM_NAME = { long: 'Int64', double: 'Double', string: 'String', bool: 'Boolean', object: 'Object' };
const ELEM_CS = { long: 'long', double: 'double', string: 'string', bool: 'bool', object: 'object' };
export function listTypeName(l) {
  return l.fixed ? `System.${ELEM_NAME[l.e]}[]` : `System.Collections.Generic.List\`1[System.${ELEM_NAME[l.e]}]`;
}

export function str(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : fmtDouble(v);
  if (v === null || v === undefined) return '';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof JDouble) return fmtDouble(v.v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof JList) return listTypeName(v);
  return String(v);
}
const show = (v) => (v === null ? 'null' : str(v)); // $"{v ?? "null"}"

// C# 컴파일러가 쓰는 타입 이름 (dynamic 연산 오류 메시지용)
function csType(v) {
  if (v === null) return '<null>';
  if (typeof v === 'number') return Number.isInteger(v) ? 'long' : 'double';
  if (typeof v === 'bigint') return 'long';
  if (v instanceof JDouble) return 'double';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof JList) return v.fixed ? `${ELEM_CS[v.e]}[]` : `System.Collections.Generic.List<${ELEM_CS[v.e]}>`;
  return 'object';
}
// .NET 런타임 타입 이름 (형변환 오류 메시지용)
function netType(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? 'System.Int64' : 'System.Double';
  if (typeof v === 'bigint') return 'System.Int64';
  if (v instanceof JDouble) return 'System.Double';
  if (typeof v === 'string') return 'System.String';
  if (typeof v === 'boolean') return 'System.Boolean';
  if (v instanceof JList) return listTypeName(v);
  return 'System.Object';
}
const binderError = (op, a, b) => err(`Operator '${op}' cannot be applied to operands of type '${csType(a)}' and '${csType(b)}'`, 'RuntimeBinderException');

// ───────────── 참/거짓 (Parser.IsTrue) ─────────────
export function truthy(v) {
  if (v === true) return true;
  if (v === false || v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  if (v instanceof JDouble) return v.v !== 0;
  return true;
}

// ───────────── 정수 연산 (long, 넘치면 순환) ─────────────
function iadd(a, b) {
  if (typeof a === 'number' && typeof b === 'number') { const r = a + b; if (r <= MAXS && r >= -MAXS) return r; }
  return big2(BigInt(a) + BigInt(b));
}
function isub(a, b) {
  if (typeof a === 'number' && typeof b === 'number') { const r = a - b; if (r <= MAXS && r >= -MAXS) return r; }
  return big2(BigInt(a) - BigInt(b));
}
function imul(a, b) {
  if (typeof a === 'number' && typeof b === 'number') { const r = a * b; if (r <= MAXS && r >= -MAXS) return r + 0; }
  return big2(BigInt(a) * BigInt(b));
}
const overflow = () => err('Arithmetic operation resulted in an overflow.', 'OverflowException');
function idiv(a, b) { // b != 0
  if (typeof a === 'number' && typeof b === 'number') return (a - a % b) / b + 0;
  a = BigInt(a); b = BigInt(b);
  if (a === LONG_MIN && b === -1n) throw overflow();
  return big2(a / b);
}
function imod(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return (a % b) + 0;
  a = BigInt(a); b = BigInt(b);
  if (a === LONG_MIN && b === -1n) throw overflow();
  return big2(a % b);
}

// Values.Add / Multiply / Divide / Modulo (+ dynamic으로 계산하던 나머지 경우)
export function vadd(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) { const r = a + b; return (r <= MAXS && r >= -MAXS) ? r : big2(BigInt(a) + BigInt(b)); }
    return D(a + b);
  }
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return iadd(ia, ib);
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return D(ra + rb);
  // dynamic: null과 숫자의 덧셈은 null (lifted 연산), 그 외는 오류
  if (a === null && b === null) throw err(`Operator '+=' is ambiguous on operands of type '<null>' and '<null>'`, 'RuntimeBinderException');
  if ((a === null && rb !== undefined) || (b === null && ra !== undefined)) return null;
  if (typeof a === 'string' || typeof b === 'string') return str(a) + str(b);
  throw binderError('+=', a, b);
}
export function vmul(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) { const r = a * b; return (r <= MAXS && r >= -MAXS) ? r + 0 : big2(BigInt(a) * BigInt(b)); }
    return D(a * b);
  }
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return imul(ia, ib);
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return D(ra * rb);
  throw binderError('*=', a, b);
}
function vdiv(a, b) {
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return idiv(ia, ib);
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return D(ra / rb);
  throw binderError('/', a, b);
}
function vmod(a, b) {
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return imod(ia, ib);
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return D(ra % rb);
  throw binderError('%', a, b);
}

// Values.Same (equal)
export function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === b) return a === a || typeof a !== 'number';
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return ia == ib; // eslint-disable-line eqeqeq
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return ra === rb;
  return false; // object.Equals: 문자열/논리형은 위의 a === b, 컬렉션은 참조 비교
}

// Values.Compare (less/greater): 음수/0/양수, NaN이 있으면 null
export function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== a || b !== b) return Number.isInteger(a) && Number.isInteger(b) ? 0 : null;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return ia < ib ? -1 : ia > ib ? 1 : 0;
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) {
    if (ra !== ra || rb !== rb) return null;
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  throw err(`'${show(a)}'와/과 '${show(b)}'은/는 크기를 비교할수 없습니다.`);
}

// ───────────── 컬렉션 (Collections.cs) ─────────────
function elemOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? 'long' : 'double';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof JDouble) return 'double';
  if (typeof v === 'bigint') return 'long';
  return 'other';
}
function infer(items) {
  if (items.length === 0 || items[0] === null) return 'object';
  const t = elemOf(items[0]);
  if (t === 'other') return 'object';
  for (let i = 1; i < items.length; i++) if (items[i] === null || elemOf(items[i]) !== t) return 'object';
  return t;
}
export const newArray = (items) => new JList(infer(items), true, items);
export const newList = (items) => new JList(infer(items), false, items);

const NOFIT = Symbol('nofit');
function fit(v, e) {
  if (e === 'object') return v;
  if (v === null) return e === 'string' ? null : NOFIT;
  switch (e) {
    case 'long': return isInt(v) ? v : NOFIT;
    case 'double':
      if (typeof v === 'number') return Number.isInteger(v) ? new JDouble(v) : v;
      if (v instanceof JDouble) return v;
      if (typeof v === 'bigint') return D(Number(v));
      return NOFIT;
    case 'string': return typeof v === 'string' ? v : NOFIT;
    case 'bool': return typeof v === 'boolean' ? v : NOFIT;
  }
  return NOFIT;
}
function createLike(origin, items) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const f = fit(items[i], origin.e);
    if (f === NOFIT) return origin.fixed ? newArray(items) : newList(items);
    out[i] = f;
  }
  return new JList(origin.e, origin.fixed, out);
}
function colAdd(first, args, start) {
  const items = first.a.slice();
  for (let i = start; i < args.length; i++) {
    const v = args[i];
    if (v instanceof JList) { for (const x of v.a) items.push(x); } else items.push(v);
  }
  return createLike(first, items);
}
// SameComparer와 같은 기준의 키 (NaN은 어떤 값과도 같지 않음)
function sameKey(v) {
  if (v === null) return 'z';
  if (typeof v === 'number') return v !== v ? null : 'n' + v;
  if (v instanceof JDouble) return 'n' + (v.v === 0 ? 0 : Number.isSafeInteger(v.v) ? v.v : BigInt(v.v).toString());
  if (typeof v === 'bigint') return 'n' + v.toString();
  if (typeof v === 'string') return 's' + v;
  if (typeof v === 'boolean') return 'b' + v;
  return v; // 컬렉션은 참조
}
function colSub(first, remove) {
  const set = new Set();
  const add = (x) => { const k = sameKey(x); if (k !== null) set.add(k); };
  if (remove instanceof JList) remove.a.forEach(add); else add(remove);
  const items = [];
  for (const x of first.a) { const k = sameKey(x); if (k === null || !set.has(k)) items.push(x); }
  return createLike(first, items);
}
function indexOf(list, index) {
  const i = tryInt(index);
  if (i === undefined) throw err(`인덱스는 정수여야 합니다. ('${show(index)}')`);
  if (i < 0 || i >= list.a.length) throw err(`인덱스 ${i}은/는 범위를 벗어났습니다. (길이: ${list.a.length})`);
  return Number(i);
}
export function listGet(list, index) {
  if (typeof index === 'number' && index >= 0 && index < list.a.length && Number.isInteger(index)) return list.a[index];
  return list.a[indexOf(list, index)];
}
export function listSet(list, index, value) {
  const i = indexOf(list, index);
  const f = fit(value, list.e);
  if (f === NOFIT) throw err(`'${show(value)}'은/는 이 컬렉션의 원소 타입(${ELEM_NAME[list.e]})에 넣을수 없습니다.`);
  list.a[i] = f;
  return null;
}
// for 문의 순회 대상 (시작할 때 복사)
export function forItems(v) {
  if (typeof v === 'string') { const r = new Array(v.length); for (let i = 0; i < v.length; i++) r[i] = v[i]; return r; }
  if (v instanceof JList) return v.a.slice();
  throw err(`'${show(v)}'은/는 순회할수 없습니다. (배열/리스트/문자열만 가능)`);
}
// repeat 횟수 (자연수가 아니면 0)
export function repeatCount(args) {
  if (args.length === 0) return 0;
  const n = tryInt(args[0]);
  return n !== undefined && n > 0 ? Number(n) : 0;
}

// ───────────── 숫자 변환 (Values.ToInteger / ToReal) ─────────────
const INT_RE = /^[\t\n\v\f\r ]*([+-]?[0-9]+)[\t\n\v\f\r ]*$/;
function toInteger(v) {
  const i = tryInt(v);
  if (i !== undefined) return i;
  const r = tryReal(v);
  if (r !== undefined) {
    const t = Math.trunc(r);
    if (t >= -9223372036854775808 && t < 9223372036854775808) return big2(BigInt(t));
    return null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  const m = INT_RE.exec(str(v));
  if (!m) return null;
  const b = BigInt(m[1]);
  return b > 9223372036854775807n || b < LONG_MIN ? null : big2(b);
}
const REAL_RE = /^[\t\n\v\f\r ]*([+-]?)((?:[0-9][0-9,]*)?(?:\.[0-9]*)?)(?:[eE]([+-]?[0-9]+))?[\t\n\v\f\r ]*$/;
function toReal(v) {
  const r = tryReal(v);
  if (r !== undefined) return D(r);
  if (typeof v === 'boolean') return D(v ? 1 : 0);
  const s = str(v);
  const m = REAL_RE.exec(s);
  if (m && /[0-9]/.test(m[2]) && !m[2].startsWith(',')) return D(parseFloat(m[1] + m[2].replace(/,/g, '') + (m[3] !== undefined ? 'e' + m[3] : '')));
  const t = s.trim().toLowerCase();
  if (t === 'nan' || t === '+nan' || t === '-nan') return NaN;
  if (t === 'infinity' || t === '+infinity' || t === '∞') return Infinity;
  if (t === '-infinity' || t === '-∞') return -Infinity;
  return null;
}

// ───────────── 내장 함수 (JyunoCommands.AddDefault) ─────────────
// 인자 배열을 받는 일반형: 이름이 다시 정의될수 있는 자리나 인자 개수가 많은 호출에서 사용
export const builtins = {
  int(args) { if (args.length === 0) return 0; if (args.length === 1) { if (args[0] === null) throw nullError(); return toInteger(args[0]); } return null; },
  double(args) { if (args.length === 0) return new JDouble(0); if (args.length === 1) { if (args[0] === null) throw nullError(); return toReal(args[0]); } return null; },
  string(args) { if (args.length === 0) return ''; if (args[0] === null) throw nullError(); return str(args[0]); },
  array(args) { return newArray(args.slice()); },
  list(args) { return newList(args.slice()); },
  length(args) {
    if (args.length === 0) throw err('길이를 구할 값이 필요합니다.');
    return length1(args[0]);
  },
  add(args) {
    if (args.length === 0) throw err('덧셈을 할 값들을 넣지 않았습니다.');
    if (args[0] instanceof JList) return colAdd(args[0], args, 1);
    if (args.length === 1) return args[0];
    for (const a of args) if (typeof a === 'string') { let s = ''; for (const x of args) s += str(x); return s; }
    let sum = args[0];
    for (let i = 1; i < args.length; i++) sum = vadd(sum, args[i]);
    return sum;
  },
  sub(args) {
    if (args.length < 2) throw err('뺄셈 할 값 2개가 필요합니다.');
    return sub2(args[0], args[1]);
  },
  mul(args) {
    if (args.length === 0) return 1;
    if (typeof args[0] === 'string') {
      if (args.length === 1) return args[0];
      return repeatString(args[0], args[1]);
    }
    let m = 1;
    for (const a of args) { if (a === null) throw nullError(); m = vmul(m, a); }
    return m;
  },
  div(args) { if (args.length < 2) throw err('나눗셈 할 값 2개가 필요합니다.'); return div2(args[0], args[1]); },
  mod(args) { if (args.length < 2) throw err('모듈로 연산 할 값 2개가 필요합니다.'); return mod2(args[0], args[1]); },
  equal(args) {
    if (args.length < 2) throw err('비교할 대상이 최소 2개 이상 있어야 합니다.');
    for (let i = 1; i < args.length; i++) if (!same(args[i - 1], args[i])) return false;
    return true;
  },
  less(args) { return ordered(args, 'less', -1); },
  greater(args) { return ordered(args, 'greater', 1); },
  and(args) {
    if (args.length === 0) throw err('and 연산을 할 값이 필요합니다.');
    const b = bitwise(args, 'and');
    if (b !== undefined) return b;
    for (const a of args) if (!truthy(a)) return false;
    return true;
  },
  or(args) {
    if (args.length === 0) throw err('or 연산을 할 값이 필요합니다.');
    const b = bitwise(args, 'or');
    if (b !== undefined) return b;
    for (const a of args) if (truthy(a)) return true;
    return false;
  },
  not(args) { if (args.length === 0) throw err('not 연산을 할 값이 필요합니다.'); return not1(args[0]); },
  bool(args) { return args.length > 0 && truthy(args[0]); },
};

function ordered(args, name, sign) {
  if (args.length === 0) throw err(`${name} 비교를 할 값이 필요합니다.`);
  let result = true;
  for (let i = 1; i < args.length; i++) {
    const o = compare(args[i - 1], args[i]);
    if (o === null || (sign < 0 ? !(o < 0) : !(o > 0))) result = false;
  }
  return result;
}
function bitwise(args, op) {
  let r;
  for (let i = 0; i < args.length; i++) {
    const v = tryInt(args[i]);
    if (v === undefined) return undefined;
    if (i === 0) { r = v; continue; }
    if (typeof r === 'number' && typeof v === 'number' && r === (r | 0) && v === (v | 0)) r = op === 'and' ? (r & v) : (r | v);
    else r = big2(op === 'and' ? (BigInt(r) & BigInt(v)) : (BigInt(r) | BigInt(v)));
  }
  return r;
}
function repeatString(s, count) {
  if (count === null) throw nullError();
  const n = tryInt(count);
  if (n === undefined) throw err('문자열을 반복할 횟수는 정수여야 합니다.');
  if (n <= 0) return '';
  const k = Number(n > 2147483647 ? 2147483647 : n);
  if (s.length * k > 1 << 29) throw err('Insufficient memory to continue the execution of the program.', 'OutOfMemoryException');
  return s.repeat(k);
}

// ───────────── 인자 개수가 정해진 빠른 경로 (이름이 내장 함수로 고정된 호출 자리에서 사용) ─────────────
export function add2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) { const r = a + b; return (r <= MAXS && r >= -MAXS) ? r : big2(BigInt(a) + BigInt(b)); }
    return D(a + b);
  }
  if (typeof a === 'string') return typeof b === 'string' ? a + b : a + str(b);
  if (a instanceof JList) return colAdd(a, [a, b], 1);
  if (typeof b === 'string') return str(a) + b;
  return vadd(a, b);
}
export function sub2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) { const r = a - b; return (r <= MAXS && r >= -MAXS) ? r : big2(BigInt(a) - BigInt(b)); }
    return D(a - b);
  }
  if (a instanceof JList) return colSub(a, b);
  if (typeof a === 'string') {
    if (b === null) throw nullError();
    if (typeof b !== 'string') throw err(`Unable to cast object of type '${netType(b)}' to type 'System.String'.`, 'InvalidCastException');
    if (b === '') throw err("The value cannot be an empty string. (Parameter 'oldValue')", 'ArgumentException');
    return a.split(b).join('');
  }
  const ia = tryInt(a), ib = tryInt(b);
  if (ia !== undefined && ib !== undefined) return isub(ia, ib);
  const ra = tryReal(a), rb = tryReal(b);
  if (ra !== undefined && rb !== undefined) return D(ra - rb);
  throw err('숫자 또는 문자열 이외에는 뺄셈 연산을 할수 없습니다.');
}
export function mul2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(a) && Number.isInteger(b)) { const r = a * b; return (r <= MAXS && r >= -MAXS) ? r + 0 : big2(BigInt(a) * BigInt(b)); }
    return D(a * b);
  }
  return builtins.mul([a, b]);
}
export function div2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(b)) {
      if (b === 0) throw err('0으로 나눌수 없습니다.');
      if (Number.isInteger(a)) return (a - a % b) / b + 0;
    }
    return D(a / b);
  }
  if (typeof a === 'string') {
    if (b === null) throw nullError();
    const sep = str(b);
    return new JList('string', true, sep === '' ? [a] : a.split(sep));
  }
  if (b === null) throw nullError();
  if (tryInt(b) == 0 && isInt(b)) throw err('0으로 나눌수 없습니다.'); // eslint-disable-line eqeqeq
  if (a === null) throw nullError();
  return vdiv(a, b);
}
export function mod2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isInteger(b)) {
      if (b === 0) throw err('0으로 나눌수 없습니다.');
      if (Number.isInteger(a)) return (a % b) + 0;
    }
    return D(a % b);
  }
  if (b === null) throw nullError();
  if (tryInt(b) == 0 && isInt(b)) throw err('0으로 나눌수 없습니다.'); // eslint-disable-line eqeqeq
  if (a === null) throw nullError();
  return vmod(a, b);
}
export const equal2 = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a === b : same(a, b));
export function less2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  const o = compare(a, b);
  return o !== null && o < 0;
}
export function greater2(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  const o = compare(a, b);
  return o !== null && o > 0;
}
export function and2(a, b) {
  if (typeof a === 'number' && typeof b === 'number' && a === (a | 0) && b === (b | 0)) return a & b;
  return builtins.and([a, b]);
}
export function or2(a, b) {
  if (typeof a === 'number' && typeof b === 'number' && a === (a | 0) && b === (b | 0)) return a | b;
  return builtins.or([a, b]);
}
export function not1(a) {
  if (typeof a === 'number' && Number.isInteger(a)) { const r = -a - 1; return r >= -MAXS ? r : big2(~BigInt(a)); }
  if (typeof a === 'bigint') return big2(~a);
  return !truthy(a);
}
export function length1(v) {
  if (typeof v === 'string') return v.length;
  if (v instanceof JList) return v.a.length;
  if (v === null) throw nullError();
  throw err(`'${str(v)}'은/는 문자열 또는 배열/리스트가 아니므로 길이를 구할수 없습니다.`);
}

// ───────────── 수학 (JyunoCommands.AddMath) ─────────────
function realArg(v) {
  if (v === null) throw nullError();
  const r = tryReal(v);
  if (r === undefined) throw err(`'${str(v)}'은/는 숫자가 아닙니다.`);
  return r;
}
function netLog(a, b) {
  if (a !== a) return a;
  if (b !== b) return b;
  if (b === 1) return NaN;
  if (a !== 1 && (b === 0 || b === Infinity)) return NaN;
  return Math.log(a) / Math.log(b);
}
export const mathFunctions = {
  'math.sin': (a) => { if (!a.length) throw err('사인 값을 구할 인자가 필요합니다.'); return D(Math.sin(realArg(a[0]))); },
  'math.cos': (a) => { if (!a.length) throw err('코사인 값을 구할 인자가 필요합니다.'); return D(Math.cos(realArg(a[0]))); },
  'math.tan': (a) => { if (!a.length) throw err('탄젠트 값을 구할 인자가 필요합니다.'); return D(Math.tan(realArg(a[0]))); },
  'math.pow': (a) => { if (a.length < 2) throw err('거듭제곱에 필요한 밑과 지수가 누락되었습니다.'); return D(Math.pow(realArg(a[0]), realArg(a[1]))); },
  'math.log': (a) => {
    if (a.length < 1) throw err('로그에 필요한 진수가 누락되었습니다.');
    if (a.length === 1) return D(Math.log10(realArg(a[0])));
    return D(netLog(realArg(a[0]), realArg(a[1])));
  },
  'math.log2': (a) => { if (a.length < 1) throw err('로그에 필요한 진수가 누락되었습니다.'); return D(Math.log2(realArg(a[0]))); },
  'math.abs': (a) => {
    if (!a.length) throw err('절댓값을 구할 값이 필요합니다.');
    const v = a[0];
    if (v === null) throw nullError();
    if (typeof v === 'number') return Number.isInteger(v) ? Math.abs(v) : Math.abs(v);
    if (v instanceof JDouble) return new JDouble(Math.abs(v.v));
    if (typeof v === 'bigint') {
      if (v === LONG_MIN) throw err('Negating the minimum value of a twos complement number is invalid.', 'OverflowException');
      return big2(v < 0n ? -v : v);
    }
    throw err("The best overloaded method match for 'System.Math.Abs(short)' has some invalid arguments", 'RuntimeBinderException');
  },
};
export const mathConstants = { 'math.pi': Math.PI, 'math.nan': NaN, 'math.tau': 2 * Math.PI };

// ───────────── 복합 서식 (string.Format) ─────────────
class FormatError extends Error {}
export function composite(format, args) {
  let out = '';
  const n = format.length;
  let i = 0;
  while (i < n) {
    const c = format[i];
    if (c === '}') {
      if (format[i + 1] === '}') { out += '}'; i += 2; continue; }
      throw new FormatError();
    }
    if (c !== '{') { out += c; i++; continue; }
    if (format[i + 1] === '{') { out += '{'; i += 2; continue; }
    i++;
    let idx = '';
    while (i < n && format[i] >= '0' && format[i] <= '9') idx += format[i++];
    if (idx === '') throw new FormatError();
    while (i < n && format[i] === ' ') i++;
    let align = 0;
    if (format[i] === ',') {
      i++;
      while (i < n && format[i] === ' ') i++;
      let a = '';
      if (format[i] === '-') a += format[i++];
      while (i < n && format[i] >= '0' && format[i] <= '9') a += format[i++];
      if (a === '' || a === '-') throw new FormatError();
      align = parseInt(a, 10);
      while (i < n && format[i] === ' ') i++;
    }
    let spec = null;
    if (format[i] === ':') {
      i++;
      spec = '';
      while (i < n && format[i] !== '}') {
        if (format[i] === '{') throw new FormatError();
        spec += format[i++];
      }
    }
    if (format[i] !== '}') throw new FormatError();
    i++;
    const k = parseInt(idx, 10);
    if (k >= args.length) throw new FormatError();
    let s = formatValue(args[k], spec);
    if (Math.abs(align) > s.length) s = align > 0 ? s.padStart(align) : s.padEnd(-align);
    out += s;
  }
  return out;
}
function group(intDigits) { return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function formatValue(v, spec) {
  if (v === null) return '';
  const isNum = typeof v === 'number' || typeof v === 'bigint' || v instanceof JDouble;
  if (!spec || !isNum) return str(v);
  const integer = isInt(v);
  const m = /^([A-Za-z])(\d{0,2})$/.exec(spec);
  if (m) {
    const f = m[1], p = m[2] === '' ? null : +m[2];
    const x = integer ? Number(v) : tryReal(v);
    switch (f.toUpperCase()) {
      case 'D':
        if (!integer) break;
        { const neg = v < 0; const d = (neg ? -BigInt(v) : BigInt(v)).toString(); return (neg ? '-' : '') + (p ? d.padStart(p, '0') : d); }
      case 'X':
        if (!integer) break;
        { let h = BigInt.asUintN(64, BigInt(v)).toString(16); if (f === 'X') h = h.toUpperCase(); return p ? h.padStart(p, '0') : h; }
      case 'F': return fixedOf(x, p ?? 2, false);
      case 'N': return fixedOf(x, p ?? 2, true);
      case 'P': return fixedOf(x * 100, p ?? 2, true) + ' %';
      case 'E': {
        const s = x.toExponential(p ?? 6);
        const [mt, ex] = s.split('e');
        const e = +ex;
        return mt + (f === 'e' ? 'e' : 'E') + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(3, '0');
      }
      case 'G': case 'R': if (p === null || f.toUpperCase() === 'R') return str(v); break;
    }
    throw new JyunoError(`Native JS: 형식 '${spec}'은/는 아직 지원하지 않습니다.`);
  }
  const cm = /^([#0,]*)(?:\.([#0]*))?$/.exec(spec);
  if (cm) {
    const x = integer ? Number(v) : tryReal(v);
    const ip = cm[1], fp = cm[2] ?? '';
    const minFrac = (fp.match(/0/g) || []).length, maxFrac = fp.length;
    let s = Math.abs(x).toFixed(maxFrac);
    if (maxFrac > minFrac) s = s.replace(new RegExp(`0{1,${maxFrac - minFrac}}$`), '').replace(/\.$/, '');
    let [ints, frac] = s.split('.');
    const minInt = (ip.match(/0/g) || []).length;
    if (ints === '0' && minInt === 0) ints = '';
    ints = ints.padStart(minInt, '0');
    if (ip.includes(',')) ints = group(ints);
    const body = frac ? `${ints}.${frac}` : ints;
    return (x < 0 && /[1-9]/.test(body) ? '-' : '') + body;
  }
  throw new JyunoError(`Native JS: 형식 '${spec}'은/는 아직 지원하지 않습니다.`);
}
function fixedOf(x, p, grouping) {
  if (x !== x) return 'NaN';
  if (!isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  let s = Math.abs(x).toFixed(p);
  if (grouping) { const [a, b] = s.split('.'); s = group(a) + (b !== undefined ? '.' + b : ''); }
  return (x < 0 && /[1-9]/.test(s) ? '-' : '') + s;
}
export function formatArgs(args) {
  if (typeof args[0] !== 'string') throw err('형식 문자열은 문자열이어야 합니다.');
  try { return composite(args[0], args); } catch (e) {
    if (e instanceof FormatError) throw err(`형식 문자열이 올바르지 않습니다: "${args[0]}"`);
    throw e;
  }
}

// 플레이그라운드 결과 표시 (JyunoSandbox.Describe / TypeName)
export function describe(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return str(v);
}
export function typeName(v) {
  if (v === null) return 'null';
  if (isInt(v)) return 'int';
  if (typeof v === 'number' || v instanceof JDouble) return 'double';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof JList) return v.fixed ? `${ELEM_NAME[v.e]}[]` : 'List`1';
  return 'object';
}
