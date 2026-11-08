# JyunoWeb

[Jyuno](https://github.com/jyunrcaea/Jyuno)를 소개하고, 브라우저에서 바로 실행해 볼수 있는 플레이그라운드를 제공하는 웹사이트입니다.

**👉 https://jyunrcaea.github.io/JyunoWeb/**

## 페이지
- **소개** (`/`) : Jyuno가 무엇이고 왜 만들었는지
- **문법 가이드** (`/guide`) : 모든 문법과 명령어, 예제마다 "실행해보기" 버튼
- **C#에서 쓰기** (`/csharp`) : Runtime / Interpreter / AddFunction 등 C# 연동 방법
- **플레이그라운드** (`/playground`) : 브라우저 안에서 진짜 Jyuno 인터프리터를 실행
- **문제 풀기** (`/problems`) : Jyuno로 푸는 온라인 저지. 53문제, 제출하면 브라우저 안에서 채점

## 문제 추가하기
문제는 [`Engine/Problems.cs`](Engine/Problems.cs)에 있습니다. 지문과 예제 입력, 숨겨진 테스트 입력을 만드는 함수(`Tests`),
C#으로 작성한 풀이(`Solve`)를 적으면 예제 출력과 테스트 정답은 풀이로 자동 계산됩니다.
1001~1043번은 입력이 한 줄에 값 하나이고, 1044번부터는 한 줄에 여러 값을 공백으로 구분해 주기도 합니다. (`div (console.readline) " "`로 나눠 읽음)
채점은 [`Engine/Judge.cs`](Engine/Judge.cs)가 웹 워커 안에서 [`Engine/JyunoHost.cs`](Engine/JyunoHost.cs)의 `RunCase`로 하며,
줄 끝 공백과 마지막 빈 줄은 무시하고 비교합니다.

## 플레이그라운드는 어떻게 동작하나요?
Blazor WebAssembly 앱이 NuGet의 `Jyuno`, `JyunoSdk.NativeJs` 패키지를 그대로 참조합니다.
스크립트는 **웹 워커** 안에 따로 띄운 .NET 런타임에서 실행되므로 ([`wwwroot/js/jyuno-worker.js`](wwwroot/js/jyuno-worker.js), [`Engine/JyunoSandbox.cs`](Engine/JyunoSandbox.cs)),

- 무한 반복문이 있어도 화면이 멈추지 않고, 중지 버튼으로 워커를 종료할수 있습니다.
- `console.*` 명령어는 화면의 터미널로 출력하도록 웹용으로 다시 구현했고, `console.readline`은 입력 칸의 내용을 한 줄씩 읽습니다.
- 샌드박스 설정에서 명령어 묶음(Console, Math, File)과 `EnableRemoveVariable`, `BlockSubstitute`를 켜고 끌수 있습니다. File 명령어는 브라우저 안의 가상 디스크에서만 동작합니다.
- 호스트 함수(`random`, `time.now`, `text.at`, `text.upper`)는 C# 프로그램이 `runtime.AddFunction`으로 함수를 추가하는 예시입니다. ([`Engine/JyunoHost.cs`](Engine/JyunoHost.cs))
  `less`, `greater`, `and`, `or`, `not`, `length`는 Jyuno 1.3.2부터 기본 명령어입니다. 기본 명령어와 같은 이름은 `AddFunction`이 `false`를 반환하고 무시되니 추가하지 마세요.
- 샌드박스 설정의 **Native JS**를 켜면 C# 인터프리터 대신, [JyunoSdk](https://github.com/jyunrcaea/JyunoSdk)의 `JyunoSdk.NativeJs` 패키지로 코드를 JavaScript로 변환해서 워커의 JS 엔진으로 실행합니다. (기본값은 C#)
  변환은 워커의 .NET이(`JyunoSandbox.CompileNativeJs`), 실행과 호스트 함수는 [`jyuno-worker.js`](wwwroot/js/jyuno-worker.js)가 맡습니다.
  반복문과 함수 호출이 많은 코드에서 훨씬 빠르지만, 삭제(`x =`), 내장 함수 재정의, 블록 안으로 들어가는 goto는 쓸수 없고 File 명령어는 지원하지 않습니다.
- 공유 버튼은 코드를 압축해서 주소(`#code=...`)에 담습니다. 작성 중인 코드는 브라우저에 자동 저장됩니다.

## 로컬에서 실행
.NET 10 SDK가 필요합니다.
```
dotnet watch
```

## 배포
`main` 브랜치에 푸시하면 GitHub Actions([`deploy.yml`](.github/workflows/deploy.yml))가 게시 후 GitHub Pages에 배포합니다.
저장소 Settings → Pages 의 Source가 **GitHub Actions** 여야 합니다.
