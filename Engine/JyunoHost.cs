using System.Collections;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Globalization;
using System.Text;
using Jyuno;
using Jyuno.Language;

namespace JyunoWeb.Engine;

/// <summary>
/// 이 사이트(C# 호스트)가 Jyuno 런타임에 추가하는 함수들과 채점 로직.
/// 브라우저 API(JSImport/JSExport)에 의존하지 않으므로, 브라우저 밖에서도 그대로 테스트할수 있습니다.
/// </summary>
internal static class JyunoHost
{
    /// <summary>
    /// 스크립트가 붙잡고 있을수 있는 메모리의 대략적인 최대 크기 (Jyuno 1.7.0의 Interpreter.MemoryLimit).
    /// 브라우저 탭은 메모리가 가득 차면 예외 없이 통째로 죽으므로, 그 전에 Jyuno 오류로 멈춥니다. (Native JS의 기본 한도와 같음)
    /// </summary>
    internal const long MemoryLimit = 256L * 1024 * 1024;

    internal static void AddConsole(Runtime runtime , IConsoleSink output , StringReader input , Action exhausted)
    {
        runtime.AddFunction("console.write" , args => {
            if (args.Length is 0)
                return null;
            //형식 문자열이 null이면 "null" (Jyuno의 console.write와 같음)
            output.Write(args.Length is 1 ? Text(args[0]) ?? "null" : Format(args[0] ?? "null" , args));
            return null;
        });
        runtime.AddFunction("console.writeline" , args => {
            if (args.Length is 0)
                output.Write("\n");
            else if (args.Length is 1)
                output.Write((Text(args[0]) ?? string.Empty) + "\n");
            else
                output.Write(Format(args[0] ?? throw JyunoCommands.null_exception , args) + "\n");
            return null;
        });
        runtime.AddFunction("console.readline" , args => {
            string? line = input.ReadLine();
            if (line is null)
                exhausted();
            else
                output.Echo(line + "\n");
            return line;
        });
        //읽은 글자 하나를 문자열로, 입력이 끝났다면 null (Jyuno 1.6.2의 console.read와 같음, 이전에는 .NET의 char)
        runtime.AddFunction("console.read" , args => {
            int c = input.Read();
            if (c < 0)
            {
                exhausted();
                return null;
            }
            string text = ((char)c).ToString();
            output.Echo(text);
            return text;
        });
        runtime.AddFunction("console.clear" , args => {
            output.Clear();
            return null;
        });
        string title = "Jyuno";
        runtime.AddVariable("console.title" , () => title , v => {
            title = Text(v) ?? throw JyunoCommands.null_exception;
            output.Title(title);
        });
    }

    /// <summary>
    /// C# 프로그램이 runtime.AddFunction으로 자신만의 함수를 추가하는 예시.
    /// (1.3.2부터 less, greater, not, length는 Jyuno 기본 명령어이므로 여기서 추가하지 않습니다.
    /// 기본 명령어와 이름이 같으면 AddFunction이 false를 반환하고 기본 명령어가 쓰입니다.)
    /// </summary>
    internal static void AddHostFunctions(Runtime runtime)
    {
        runtime.AddFunction("random" , args => {
            // random → 0 이상 1 미만의 실수, random (최대) → 0 이상 최대 미만의 정수, random (최소) (최대) → 최소 이상 최대 미만의 정수
            if (args.Length is 0)
                return Random.Shared.NextDouble();
            long min = 0, max;
            if (args.Length is 1)
                max = ToLong(args[0]);
            else
            {
                min = ToLong(args[0]);
                max = ToLong(args[1]);
            }
            if (max <= min)
                throw new JyunoException("random의 최댓값은 최솟값보다 커야 합니다.");
            return Random.Shared.NextInt64(min , max);
        });
        runtime.AddFunction("time.now" , args => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        runtime.AddFunction("text.at" , args => {
            // text.at (문자열) (위치) → 위치(0부터)에 있는 글자 하나
            if (args.Length < 2 || args[0] is not string s)
                throw new JyunoException("text.at 에는 문자열과 위치가 필요합니다.");
            long index = ToLong(args[1]);
            if (index < 0 || index >= s.Length)
                throw new JyunoException($"위치 {index}은/는 문자열의 범위(0 ~ {s.Length - 1})를 벗어났습니다.");
            return s[(int)index].ToString();
        });
        runtime.AddFunction("text.upper" , args => {
            if (args.Length is 0 || args[0] is not string s)
                throw new JyunoException("대문자로 바꿀 문자열이 필요합니다.");
            return s.ToUpperInvariant();
        });
    }

    /// <summary>테스트 케이스 하나를 실행하고 채점합니다.</summary>
    internal static JudgeCase RunCase(string[] lines , TestCase test , int timeLimitMs)
    {
        var output = new CaptureOutput();
        var input = new StringReader(test.Input);
        Runtime runtime = new(Runtime.AddJyunoCommandType.Math);
        AddConsole(runtime , output , input , () => { });
        AddHostFunctions(runtime);
        using Interpreter interpreter = runtime.Create(lines);
        interpreter.MemoryLimit = MemoryLimit;

        var run = new JudgeCase();
        var stopwatch = Stopwatch.StartNew();
        try
        {
            object? value = interpreter.Run();
            if (value is GrammarError grammar)
            {
                run.Verdict = Verdicts.GrammarError;
                run.Message = grammar.Message;
                run.Line = grammar.Line;
            }
        }
        catch (OutputLimitException)
        {
            run.Verdict = Verdicts.OutputLimit;
        }
        catch (JyunoLimitException e) when (IsMemoryLimit(e))
        {
            run.Verdict = Verdicts.MemoryLimit;
            run.Line = ErrorLine(interpreter , e);
            run.Message = e.Message;
        }
        catch (Exception e)
        {
            run.Verdict = Verdicts.RuntimeError;
            run.Line = ErrorLine(interpreter , e);
            run.Message = Unwrap(e);
        }
        stopwatch.Stop();
        run.Ms = Math.Round(stopwatch.Elapsed.TotalMilliseconds , 1);
        run.Actual = output.Text;

        if (run.Verdict is null)
        {
            if (run.Ms > timeLimitMs)
                run.Verdict = Verdicts.TimeLimit;
            else
                run.Verdict = Normalize(output.Text) == Normalize(test.Output) ? Verdicts.Accepted : Verdicts.WrongAnswer;
        }
        return run;
    }

    /// <summary>줄 끝 공백과 마지막 빈 줄은 무시하고 비교 (온라인 저지의 일반적인 규칙)</summary>
    internal static string Normalize(string text)
    {
        var lines = text.Replace("\r\n" , "\n").Split('\n').Select(l => l.TrimEnd()).ToList();
        while (lines.Count > 0 && lines[^1].Length == 0)
            lines.RemoveAt(lines.Count - 1);
        return string.Join("\n" , lines);
    }

    // 오류가 난 줄 (Jyuno 1.6.2부터 JyunoException.Line과 Interpreter.LastErrorLine, 알수 없다면 -1)
    internal static int ErrorLine(Interpreter interpreter , Exception e)
        => e is JyunoException { Line: >= 0 } jyuno ? jyuno.Line : interpreter.LastErrorLine;

    // 메모리 한도를 넘은 오류 (JyunoLimitException은 함수 호출 깊이 등 다른 한도에도 쓰이므로 메시지로 구별)
    internal static bool IsMemoryLimit(JyunoLimitException e) => e.Message.StartsWith("메모리 한도를 넘었습니다" , StringComparison.Ordinal);

    internal static string Unwrap(Exception e)
    {
        while (e is System.Reflection.TargetInvocationException && e.InnerException is not null)
            e = e.InnerException;
        return e.Message;
    }

    static long ToLong(object? value) => value switch {
        long l => l,
        int i => i,
        double d => (long)d,
        _ => throw new JyunoException($"'{Show(value)}'은/는 정수가 아닙니다.")
    };

    // Jyuno의 string 함수와 같은 방식으로 문자열로 바꿈 (null은 null, 1.6.2부터 배열/리스트는 [1, 2, 3])
    static string? Text(object? value) => value switch {
        null => null,
        string s => s,
        IList list => ListText(list , new(ReferenceEqualityComparer.Instance)),
        _ => Convert.ToString(value , CultureInfo.InvariantCulture)
    };
    static string Show(object? value) => Text(value) ?? "null";
    // 원소의 null은 "null", 자기 자신을 담은 배열/리스트는 [...]
    static string ListText(IList list , HashSet<object> visiting)
    {
        if (!visiting.Add(list))
            return "[...]";
        if (!RuntimeHelpers.TryEnsureSufficientExecutionStack())
            throw new JyunoException("값이 너무 깊게 중첩되어 있어서 문자열로 바꿀수 없습니다.");
        StringBuilder builder = new("[");
        for (int i = 0 ; i < list.Count ; i++)
        {
            if (i > 0)
                builder.Append(", ");
            builder.Append(list[i] is IList inner ? ListText(inner , visiting) : Show(list[i]));
        }
        visiting.Remove(list);
        return builder.Append(']').ToString();
    }

    // Console.Write(format, args)와 동일하게, 첫번째 인자(형식 문자열)도 {0}으로 포함 (Jyuno 1.6.2의 console.write와 같은 오류)
    static string Format(object format , object?[] args)
    {
        if (format is not string text)
            throw new JyunoException($"형식 문자열은 문자열이어야 합니다. ('{Show(format)}')");
        try
        {
            return string.Format(CultureInfo.InvariantCulture , text , args.Select(o => o is IList ? Text(o) : o).ToArray());
        }
        catch (FormatException)
        {
            throw new JyunoException($"형식 문자열이 올바르지 않습니다: \"{text}\"");
        }
    }

    sealed class OutputLimitException : Exception;

    sealed class CaptureOutput : IConsoleSink
    {
        readonly StringBuilder buffer = new();
        const int Limit = 1_000_000;

        public string Text => buffer.ToString();

        public void Write(string text)
        {
            buffer.Append(text);
            if (buffer.Length > Limit)
                throw new OutputLimitException();
        }

        // 채점할 때는 입력을 출력에 섞지 않음
        public void Echo(string text) { }
        public void Clear() => buffer.Clear();
        public void Title(string title) { }
    }
}

public static class Verdicts
{
    public const string Accepted = "AC";
    public const string WrongAnswer = "WA";
    public const string TimeLimit = "TLE";
    public const string RuntimeError = "RE";
    public const string GrammarError = "GE";
    public const string OutputLimit = "OLE";
    public const string MemoryLimit = "MLE";
}

public sealed class JudgeCase
{
    public int Index { get; set; }
    public string? Verdict { get; set; }
    public double Ms { get; set; }
    public string? Input { get; set; }
    public string? Expected { get; set; }
    public string? Actual { get; set; }
    public string? Message { get; set; }
    public int Line { get; set; } = -1;
}

/// <summary>console.* 명령어의 출력 대상</summary>
internal interface IConsoleSink
{
    void Write(string text);
    /// <summary>console.readline으로 읽은 입력 (화면에는 보여주지만 채점 출력에는 포함하지 않음)</summary>
    void Echo(string text);
    void Clear();
    void Title(string title);
}
