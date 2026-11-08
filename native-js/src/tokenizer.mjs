// Jyuno 1.3.2 Parser.Tokenizer를 그대로 옮긴 것
import { big2, JDouble } from './runtime.mjs';

const PREFIXES = new Set([':', '[', ']', '+', '-', '*', '/', '~', '@', '=', '<', '>', '(', ')']);
export const KEYWORDS = new Set(['if', 'return', 'repeat', 'goto', 'func', 'end', 'else', 'while', 'break', 'param', 'endfunc', 'local', 'for']);

// C#의 string.Trim()과 같은 공백 (char.IsWhiteSpace; JS의 trim()과 달리 U+FEFF는 공백이 아니고 U+0085는 공백)
const CS_WS = '[\\t\\n\\v\\f\\r \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const TRIM_RE = new RegExp(`^${CS_WS}+|${CS_WS}+$`, 'g');

const isDigit = (c) => c >= '0' && c <= '9';
const LONG_MAX = 9223372036854775807n;
const LONG_MIN = -9223372036854775808n;

// 토큰: { t: 'const' | 'prefix' | 'kw' | 'name' | 'error', v }
export function tokenize(text) {
  text = text.replace(TRIM_RE, '');
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === ' ') continue;
    if (isDigit(c) || (c === '-' && i + 1 < text.length && isDigit(text[i + 1]))) {
      const begin = i;
      while (++i < text.length && isDigit(text[i])) { /* 숫자 */ }
      const real = i < text.length && text[i] === '.';
      if (real) while (++i < text.length && isDigit(text[i])) { /* 소수부 */ }
      const num = text.slice(begin, i);
      i--;
      if (real) {
        const d = parseFloat(num);
        out.push({ t: 'const', v: Number.isInteger(d) ? new JDouble(d) : d });
        continue;
      }
      const b = BigInt(num);
      if (b > LONG_MAX || b < LONG_MIN) {
        out.push({ t: 'error', v: `정수 ${num}은/는 long 범위를 벗어납니다.` });
        return out;
      }
      out.push({ t: 'const', v: big2(b) });
      continue;
    }
    if (PREFIXES.has(c)) { out.push({ t: 'prefix', v: c }); continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let sb = '';
      while (++i < text.length && text[i] !== q) {
        if (text[i] === '\\') {
          if (++i >= text.length) { out.push({ t: 'error', v: '문자열은 항상 따옴표로 끝나야 합니다.' }); return out; }
          if (text[i] === 'n') { sb += '\n'; continue; }
          if (text[i] === 'r') { sb += '\r'; continue; }
        }
        sb += text[i];
      }
      if (i >= text.length) { out.push({ t: 'error', v: '문자열은 항상 따옴표로 끝나야 합니다.' }); return out; }
      out.push({ t: 'const', v: sb });
      continue;
    }
    let name = '';
    for (; i < text.length && !PREFIXES.has(c = text[i]) && c !== ' ' && c !== '"' && c !== "'"; i++) name += c;
    i--;
    out.push(KEYWORDS.has(name) ? { t: 'kw', v: name } : { t: 'name', v: name });
  }
  return out;
}
