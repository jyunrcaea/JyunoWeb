// 사이트 공용 스크립트: 코드 강조, 복사
import { highlightLine } from './jyuno-highlight.js';

const csharpKeywords = new Set(('abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while').split(' '));

function escape(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCSharp(code) {
    const pattern = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?[LlDdFfMm]?\b)|([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z0-9_"'/]+|\/)/g;
    let html = '';
    let m;
    while ((m = pattern.exec(code)) !== null) {
        const [text, comment, str, num, word] = m;
        if (comment) html += `<span class="tok-comment">${escape(text)}</span>`;
        else if (str) html += `<span class="tok-str">${escape(text)}</span>`;
        else if (num) html += `<span class="tok-num">${escape(text)}</span>`;
        else if (word) {
            if (csharpKeywords.has(word)) html += `<span class="tok-kw">${text}</span>`;
            else if (/^[A-Z]/.test(word)) html += `<span class="tok-type">${text}</span>`;
            else if (code[pattern.lastIndex] === '(') html += `<span class="tok-fn">${text}</span>`;
            else html += text;
        }
        else html += escape(text);
    }
    return html;
}

function highlightShell(code) {
    return code.split('\n').map(line => {
        const m = line.match(/^(\s*)(\S+)(.*)$/);
        return m ? `${m[1]}<span class="tok-fn">${escape(m[2])}</span>${escape(m[3])}` : escape(line);
    }).join('\n');
}

export function highlightElement(el, lang) {
    const code = el.textContent;
    if (lang === 'jyuno') el.innerHTML = code.split('\n').map(highlightLine).join('\n');
    else if (lang === 'csharp') el.innerHTML = highlightCSharp(code);
    else if (lang === 'shell') el.innerHTML = highlightShell(code);
}

export function highlightAll(root) {
    (root || document).querySelectorAll('code[data-lang]:not([data-highlighted])').forEach(el => {
        highlightElement(el, el.dataset.lang);
        el.dataset.highlighted = 'true';
    });
}

export async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
