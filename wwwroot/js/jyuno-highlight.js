// Jyuno 문법 강조 (Jyuno의 토크나이저와 같은 규칙으로 한 줄씩 나눔)

export const keywords = new Set(['if', 'else', 'end', 'while', 'repeat', 'for', 'break', 'goto', 'func', 'param', 'endfunc', 'return', 'local', 'struct', 'endstruct']);
const constants = new Set(['null', 'true', 'false', 'math.pi', 'math.tau', 'math.nan']);
// 기호: 이름을 끊는 글자 중 연산자가 아닌 것
const prefixes = new Set([':', '[', ']', '@', '=', '(', ')']);
// 연산자에 쓰이는 글자 (Jyuno 1.6.0부터, 이 글자들도 이름을 끊음)
const operatorChars = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '<', '>', '?', '=']);
// 연산자 기호 (긴 것부터 찾음)
const operators = ['<<=', '>>=', '??=',
    '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '??',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '<', '>', '?'];

export const builtins = new Set([
    'int', 'double', 'string', 'bool', 'add', 'sub', 'mul', 'div', 'mod', 'equal',
    'less', 'greater', 'and', 'or', 'not', 'array', 'list', 'length',
    'console.write', 'console.writeline', 'console.readline', 'console.read', 'console.clear', 'console.title',
    'math.abs', 'math.sin', 'math.cos', 'math.tan', 'math.pow', 'math.log', 'math.log2', 'math.random', 'math.csprng',
    ...['array', 'list'].flatMap((kind) => ['sort', 'reverse', 'shuffle', 'contains', 'indexof', 'slice', 'join', 'new',
        'copy', 'lastindexof', 'count', 'distinct', 'binary_search', 'fill', 'min', 'max', 'sum', 'range'].map((name) => `${kind}.${name}`)),
    'list.push', 'list.pop', 'list.insert', 'list.removeat', 'list.remove', 'list.clear',
    ...['concat', 'join', 'format', 'compare', 'equals', 'isnullorempty', 'isnullorwhitespace', 'indexof', 'lastindexof', 'contains',
        'startswith', 'endswith', 'replace', 'substring', 'insert', 'remove', 'toupper', 'tolower', 'trim', 'trimstart', 'trimend',
        'padleft', 'padright', 'split', 'tochararray', 'charcode', 'fromcharcode'].map((name) => `string.${name}`),
    'file.exist', 'file.read', 'file.write', 'file.remove', 'directory.now', 'directory.exist', 'directory.files', 'directory.list', 'directory.move',
]);

export const hostFunctions = new Set(['random', 'time.now', 'text.at', 'text.upper']);

function escape(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const isDigit = (c) => c >= '0' && c <= '9';

// i 위치의 글자가 값(이름, 숫자, 문자열, ')') 바로 뒤에 붙어 있는지 ('a-1', '(x)-1'의 '-'는 뺄셈)
function afterValue(line, i) {
    if (i === 0) return false;
    const before = line[i - 1];
    if (before === ')') return true;
    return before !== ' ' && before !== '\t' && !prefixes.has(before) && !operatorChars.has(before);
}

/** 한 줄을 [{type, text}] 토큰 목록으로 나눔 (공백도 그대로 보존) */
export function tokenizeLine(line) {
    const tokens = [];
    let i = 0;
    let first = true;
    while (i < line.length) {
        const c = line[i];
        if (c === ' ' || c === '\t') {
            let j = i;
            while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
            tokens.push({ type: 'ws', text: line.slice(i, j) });
            i = j;
            continue;
        }
        // 숫자 (숫자 바로 앞에 붙은 '-'는 음수 부호, 단 값 바로 뒤라면 뺄셈)
        if (isDigit(c) || (c === '-' && isDigit(line[i + 1] ?? '') && !afterValue(line, i))) {
            let j = i + 1;
            while (j < line.length && isDigit(line[j])) j++;
            if (line[j] === '.') {
                j++;
                while (j < line.length && isDigit(line[j])) j++;
            }
            tokens.push({ type: 'num', text: line.slice(i, j) });
            i = j;
            first = false;
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            let closed = false;
            while (j < line.length) {
                if (line[j] === '\\') { j += 2; continue; }
                if (line[j] === c) { closed = true; j++; break; }
                j++;
            }
            j = Math.min(j, line.length);
            tokens.push({ type: closed ? 'str' : 'str bad', text: line.slice(i, j) });
            i = j;
            first = false;
            continue;
        }
        // 주석: '//'부터 줄 끝까지
        if (c === '/' && line[i + 1] === '/') {
            tokens.push({ type: 'comment', text: line.slice(i) });
            break;
        }
        // 연산자 (긴 기호부터, '='만 있다면 대입/삭제 기호)
        if (operatorChars.has(c)) {
            const op = operators.find((o) => line.startsWith(o, i));
            if (op) {
                tokens.push({ type: 'op', text: op });
                i += op.length;
                first = false;
                continue;
            }
        }
        if (prefixes.has(c)) {
            tokens.push({ type: c === '(' || c === ')' ? 'paren' : 'op', text: c });
            i++;
            first = false;
            continue;
        }
        let j = i;
        while (j < line.length && !prefixes.has(line[j]) && !operatorChars.has(line[j]) && line[j] !== ' ' && line[j] !== '\t' && line[j] !== '"' && line[j] !== "'") j++;
        const word = line.slice(i, j);
        let type = 'name';
        if (first && keywords.has(word)) type = 'kw';
        else if (constants.has(word)) type = 'const';
        else if (builtins.has(word)) type = 'fn';
        else if (hostFunctions.has(word)) type = 'host';
        // 레이블 (이름:)
        if (first && line.slice(j).trimStart().startsWith(':') && type === 'name') type = 'label';
        tokens.push({ type, text: word });
        i = j;
        first = false;
    }
    return tokens;
}

export function highlightLine(line) {
    let html = '';
    for (const t of tokenizeLine(line)) {
        if (t.type === 'ws' || t.type === 'name') html += escape(t.text);
        else html += `<span class="tok-${t.type.replace(' ', ' tok-')}">${escape(t.text)}</span>`;
    }
    return html;
}

export function highlight(code) {
    return code.split('\n').map(highlightLine);
}
