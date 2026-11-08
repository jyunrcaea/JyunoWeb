// 무작위 Jyuno 프로그램 생성기: 대부분 타입이 맞는 식을 만들고, 가끔 일부러 틀린 식(오류 경로)을 섞음
export function makeGenerator(seed) {
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  const int = (n) => Math.floor(rnd() * n);
  const pick = (a) => a[int(a.length)];
  const chance = (p) => rnd() < p;
  const INTS = ['0', '1', '2', '3', '-1', '7', '10', '-13', '255', '1000000007', '9007199254740991', '4611686018427387904', '9223372036854775807', '-9223372036854775808', '4294967296', '2147483647', '-2147483648'];
  const REALS = ['0.5', '2.0', '-0.0', '0.1', '3.75', '-2.5', '0.000001', '100000000000000000.0', '1.0', '0.0', '1234567.125'];
  const STRS = ["'ab'", "''", "'3'", "' 12 '", "'1,000.5'", "'x y z'", "'가나'", "'-7'", "'1e3'", "'NaN'", "'A'", "'b'"];
  const NUMV = ['a', 'b', 'c', 'x', 'y'];
  let errRate = 0.04;
  const any = (d) => (chance(errRate * 3) ? wild(d) : pick([num, num, num, str, bool, list])(d));
  function wild(d) { // 아무 타입이나 (오류 경로)
    return pick([() => pick(['null', 'true', "'z'", 'l', 'm', 's', '2.5']), () => `(${pick(['add', 'sub', 'mul', 'div', 'mod', 'less', 'and'])} ${any(d - 1)} ${any(d - 1)})`, () => `(l ${num(d - 1)})`, () => `(${pick(['int', 'double', 'length', 'not', 'math.abs'])} ${any(d - 1)})`])();
  }
  function num(d) {
    if (chance(errRate)) return wild(d);
    if (d <= 0 || chance(0.3)) return chance(0.5) ? pick(NUMV) : chance(0.7) ? pick(INTS) : pick(REALS);
    const r = rnd();
    if (r < 0.4) return `(${pick(['add', 'sub', 'mul'])} ${num(d - 1)} ${num(d - 1)}${chance(0.1) ? ' ' + num(d - 1) : ''})`;
    if (r < 0.52) return `(${pick(['div', 'mod'])} ${num(d - 1)} ${pick(['2', '3', '7', '-4', '2.5', '0.0', num(d - 1)])})`;
    if (r < 0.6) return `(${pick(['and', 'or'])} ${num(d - 1)} ${num(d - 1)})`;
    if (r < 0.64) return `(not ${num(d - 1)})`;
    if (r < 0.7) return `(int ${pick([num(d - 1), str(d - 1)])})`;
    if (r < 0.74) return `(double ${pick([num(d - 1), str(d - 1)])})`;
    if (r < 0.78) return `(length ${pick([str(d - 1), list(d - 1)])})`;
    if (r < 0.82) return `(math.abs ${num(d - 1)})`;
    if (r < 0.85) return `(math.pow ${num(d - 1)} ${pick(['2', '0.5', '-1', '3.0'])})`;
    if (r < 0.92) return `(l ${pick(['0', '1', '2', '(sub (length l) 1)'])})`;
    if (r < 0.96 && funcs.length) return call(d);
    return `(${pick(NUMV)} = ${num(d - 1)})`;
  }
  function str(d) {
    if (chance(errRate)) return wild(d);
    if (d <= 0 || chance(0.4)) return chance(0.4) ? 's' : pick(STRS);
    const r = rnd();
    if (r < 0.35) return `(add ${str(d - 1)} ${chance(errRate * 5) ? any(d - 1) : num(d - 1)})`;
    if (r < 0.5) return `(string ${chance(errRate * 5) ? any(d - 1) : num(d - 1)})`;
    if (r < 0.6) return `(mul ${str(d - 1)} ${pick(['0', '2', '3', '-1'])})`;
    if (r < 0.7) return `(sub ${str(d - 1)} ${pick(["'a'", "' '", "'1'"])})`;
    if (r < 0.8) return `(m ${pick(['0', '1'])})`;
    return `(add ${pick(STRS)} ${num(d - 1)})`;
  }
  function bool(d) {
    if (chance(errRate)) return wild(d);
    if (d <= 0 || chance(0.2)) return pick(['true', 'false']);
    const r = rnd();
    if (r < 0.3) return `(${pick(['less', 'greater'])} ${num(d - 1)} ${num(d - 1)}${chance(0.15) ? ' ' + num(d - 1) : ''})`;
    if (r < 0.45) return `(less ${chance(0.5) ? 's' : pick(STRS)} ${pick(STRS)})`;
    if (r < 0.65) return `(equal ${any(d - 1)} ${any(d - 1)})`; // 타입이 달라도 오류 없음
    if (r < 0.8) return `(${pick(['and', 'or'])} ${bool(d - 1)} ${any(d - 1)})`;
    if (r < 0.9) return `(not ${bool(d - 1)})`;
    return `(bool ${any(d - 1)})`;
  }
  function list(d) {
    if (d <= 0 || chance(0.4)) return pick(['l', 'm']);
    const r = rnd();
    if (r < 0.3) return `(${pick(['array', 'list'])} ${num(d - 1)} ${num(d - 1)}${chance(0.3) ? ' ' + any(d - 1) : ''})`;
    if (r < 0.55) return `(add ${list(d - 1)} ${any(d - 1)}${chance(0.3) ? ' ' + list(d - 1) : ''})`;
    if (r < 0.75) return `(sub ${list(d - 1)} ${any(d - 1)})`;
    return `(div ${pick(STRS)} ${pick(["' '", "','", "''"])})`;
  }
  let funcs = [];
  const call = (d) => { const f = pick(funcs); return `(${f.name}${Array.from({ length: Math.max(0, f.params + int(3) - 1) }, () => ' ' + num(d - 1)).join('')})`; };

  let counter = 0;
  function stmts(n, depth, ctx, ind) { const o = []; for (let i = 0; i < n; i++) o.push(...stmt(depth, ctx, ind)); return o; }
  function stmt(depth, ctx, p) {
    const r = rnd();
    if (r < 0.2) return [`${p}${pick(NUMV)} = ${num(3)}`];
    if (r < 0.25) return [`${p}s = ${str(2)}`];
    if (r < 0.37) return [`${p}console.writeline ${any(3)}`];
    if (r < 0.43) return [`${p}console.writeline "{1}|{2}" ${any(2)} ${any(2)}`];
    if (r < 0.48) return [`${p}l ${pick(['0', '1', '(sub (length l) 1)'])} ${num(2)}`];
    if (r < 0.5) return [`${p}${pick(['l', 'm'])} = ${list(2)}`];
    if (depth > 0 && r < 0.58) {
      const lines = [`${p}if ${bool(2)}`, ...stmts(1 + int(3), depth - 1, ctx, p + '  ')];
      if (chance(0.5)) lines.push(`${p}else`, ...stmts(1 + int(2), depth - 1, ctx, p + '  '));
      lines.push(`${p}end`);
      return lines;
    }
    if (depth > 0 && r < 0.64) {
      const body = stmts(1 + int(3), depth - 1, ctx, p + '  ');
      if (chance(0.3)) body.splice(int(body.length), 0, `${p}  if ${bool(1)}`, `${p}    break`, `${p}  end`);
      return [`${p}repeat ${pick(['0', '1', '2', '3', '2.0', "'2'", 'null', '(length l)'])}`, ...body, `${p}end`];
    }
    if (depth > 0 && r < 0.7) {
      const w = `w${counter++}`;
      return [`${p}${w} = 0`, `${p}while (less ${w} ${1 + int(3)})`, ...stmts(1 + int(3), depth - 1, ctx, p + '  '), `${p}  ${w} = add ${w} 1`, `${p}end`];
    }
    if (depth > 0 && r < 0.77) {
      const v = pick(['x', 'it', 'k']);
      return [`${p}for ${v} ${pick(['l', 'm', "'abc'", "(array 1 2.5 'q')", "(div 'a b' ' ')", list(1)])}`, ...stmts(1 + int(3), depth - 1, ctx, p + '  '), `${p}end`];
    }
    if (r < 0.785) { const v = pick(NUMV); return chance(0.6) ? [`${p}${v} =`, `${p}${v} = ${num(1)}`] : [`${p}${v} =`]; }
    if (r < 0.82) return [`${p}local ${pick(NUMV)}${chance(0.7) ? ' = ' + num(2) : ''}`];
    if (r < 0.86 && funcs.length) { const f = pick(funcs); return [`${p}${f.name}${Array.from({ length: f.params }, () => ' ' + num(1)).join('')}`]; }
    if (depth > 0 && r < 0.89 && !ctx.inFunc) {
      const g = counter++;
      return [`${p}g${g} = 0`, `${p}lbl${g}:`, ...stmts(1 + int(2), depth - 1, ctx, p), `${p}g${g} = add g${g} 1`, `${p}if (less g${g} ${2 + int(2)})`, `${p}  goto lbl${g}`, `${p}end`];
    }
    if (r < 0.9) return [`${p}console.writeline ${chance(0.5) ? 'kc' : `(f${int(4)} 1 2)`}`];
    return [`${p}console.write ${any(2)}`];
  }
  return function program() {
    funcs = [];
    counter = 0;
    errRate = pick([0, 0, 0, 0.01, 0.03]);
    const lines = [];
    for (const v of NUMV) lines.push(`${v} = ${chance(0.75) ? pick(INTS) : pick(REALS)}`);
    if (chance(0.3)) lines.push(`${pick(['7', "'k'", '2.5'])} = kc`);
    lines.push(`s = ${pick(STRS)}`);
    lines.push(pick(['l = list 1 2 3', 'l = array 4 5 6', 'l = list 1.5 2 3', 'l = array 1 2 3']));
    lines.push(`m = ${pick(["array 'p' 'q'", "list 'p' 'q'"])}`);
    const nf = int(4);
    for (let i = 0; i < nf; i++) {
      const name = chance(0.08) ? pick(['add', 'less', 'length', 'not']) : `f${i}`;
      const params = int(3);
      lines.push(`func ${name}`);
      for (let k = 0; k < params; k++) lines.push(`  param ${pick(['p', 'q', 'x', 'a'])}`);
      lines.push(...stmts(1 + int(4), 2, { inFunc: true }, '  '));
      lines.push(`  return ${num(2)}`);
      lines.push('endfunc');
      funcs.push({ name, params });
    }
    if (chance(0.3)) {
      lines.push('func rec', '  param n', '  if (less n 1)', '    return 0', '  end', '  local t = rec (sub n 1)', '  return (add t n)', 'endfunc');
      lines.push(`console.writeline (rec ${pick(['5', '20', '199', '30', '7', chance(0.1) ? '250' : '3'])})`);
    }
    lines.push(...stmts(4 + int(10), 3, { inFunc: false }, ''));
    if (chance(0.5)) lines.push(`return ${any(2)}`);
    if (chance(0.08)) lines.push(...pick([['add ='], ['less ='], ['func add', '  param p', '  return 42', 'endfunc'], ['local not = 1']]), 'console.writeline (add 1 2)');
    return lines.join('\n');
  };
}
