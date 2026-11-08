// 차등 테스트 공통: Jyuno 값 직렬화(RefRunner와 같은 형식), 결과 비교
import { JDouble, JList, fmtDouble, isInt } from '../src/runtime.mjs';
const ELEM = { long: 'Int64', double: 'Double', string: 'String', bool: 'Boolean', object: 'Object' };
export function ser(v, withElem = true) {
  if (v === null || v === undefined) return { t: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { t: 'int', v: String(v) } : { t: 'double', v: fmtDouble(v) };
  if (typeof v === 'bigint') return { t: 'int', v: v.toString() };
  if (v instanceof JDouble) return { t: 'double', v: fmtDouble(v.v) };
  if (typeof v === 'string') return { t: 'string', v };
  if (typeof v === 'boolean') return { t: 'bool', v };
  if (v instanceof JList) return withElem ? { t: v.fixed ? 'array' : 'list', e: ELEM[v.e], v: v.a.map((x) => ser(x, withElem)) } : { t: v.fixed ? 'array' : 'list', v: v.a.map((x) => ser(x, withElem)) };
  return { t: typeof v, v: String(v) };
}
void isInt;
