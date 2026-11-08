# Jyuno Native JS (연구용 프로토타입)

Jyuno 1.3.2 코드를 JavaScript 함수로 컴파일해서 실행하는 트랜스파일러입니다.
JyunoWeb의 웹 워커에서 .NET 런타임 대신 쓸 수 있는지 알아보기 위해 만들었으며, 아직 앱에는 연결되어 있지 않습니다.
(JyunoWeb.csproj는 이 폴더를 빌드에서 제외합니다.)

```js
import { compileJyuno, runCompiled } from './src/index.mjs';
import { judgeHost } from './src/host.mjs';

const { host, output } = judgeHost('입력');
const compiled = compileJyuno('console.writeline (add 1 2)', { host });
const result = runCompiled(compiled, host); // { status: 'ok' | 'error' | 'grammar' | 'abort', value, message, line }
console.log(output());
```

## 구성

| 경로 | 내용 |
|---|---|
| `src/tokenizer.mjs` | C# Parser.Tokenizer를 옮긴 것 |
| `src/compiler.mjs` | 블록 구조/스코프/goto 분석과 JS 코드 생성 |
| `src/runtime.mjs` | 값 표현, 연산, 내장 함수, .NET 숫자 출력과 서식 |
| `src/index.mjs` | 컴파일·실행, 오류 줄 번호 찾기 |
| `src/host.mjs` | JyunoWeb 호스트(콘솔, 수학, 예시 함수) |
| `ref/RefRunner` | C# 1.3.2 기준 실행기 (차등 테스트, 벤치마크) |
| `test/` | C#과 결과를 비교하는 테스트 |
| `bench/` | Node / 브라우저 벤치마크 |

## 언어 제약 (Jyuno/Web 프로필)

1. goto는 같은 블록이나 바깥 블록의 줄/레이블로만 이동할 수 있습니다. 블록 안쪽으로 들어가거나 레이블이 아닌 줄로 계산된 goto는 실행할 때 `Native JS 제약` 오류가 납니다.
2. 블록 짝 오류(end/else 누락 등)는 실행 전에 보고합니다.
3. 호스트 함수는 JS로 제공해야 합니다. (`console.read`는 한 글자 문자열을 돌려줌, `file.*`는 없음)

## 테스트 실행

```sh
# 기준 실행기 빌드 (../../Jyuno 에 Jyuno 소스가 있어야 함, JyunoSource=경로 로 바꿀 수 있음)
dotnet build ref/RefRunner -c Release
R=ref/RefRunner/bin/Release/net10.0/RefRunner.dll
dotnet $R problems > test/data/problems.json
dotnet $R examples > test/data/examples.json

node test/jyuno-tests.mjs          # Jyuno.Tests 스크립트 299개
JYUNO_SOLUTIONS=풀이폴더 node test/judge.mjs   # 채점 문제 (풀이 파일 <id>.jyuno 필요)
node test/examples.mjs             # 플레이그라운드 예제
node test/fuzz.mjs 2000 1          # 무작위 프로그램 2000개, 씨앗 1
```

## 벤치마크

```sh
node bench/node-bench.mjs 100                      # Node, 정상 상태
node bench/node-bench.mjs --cold fib_20            # 새 프로세스 첫 실행
dotnet $R bench bench/programs 30                  # .NET JIT 기준
# 브라우저: JyunoWeb을 두 번 publish (기본, -p:RunAOTCompilation=true) 한 뒤
INTERP_ROOT=…/wwwroot AOT_ROOT=…/wwwroot node bench/browser/run.mjs njs interp aot
```
