using System.Diagnostics;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Jyuno;
using Jyuno.Language;

namespace JyunoWeb.Engine;

public static partial class JyunoSandbox
{
    /// <summary>
    /// 문제의 테스트 케이스로 코드를 채점합니다. (웹 워커 안에서 실행)
    /// mode가 "sample"이면 예제만 모두 실행하고 각 출력을 돌려주며,
    /// "submit"이면 예제와 숨겨진 테스트를 차례로 실행하다 처음 틀린 곳에서 멈춥니다.
    /// 테스트 하나가 끝날 때마다 "judge" 메시지로 진행 상황을 보내서, 메인 스레드가 시간 초과를 감시할수 있게 합니다.
    /// </summary>
    [JSExport]
    public static string Judge(string code , int problemId , string mode)
    {
        Problem problem = Problems.Find(problemId) ?? throw new ArgumentException($"{problemId}번 문제가 없습니다.");
        bool sampleOnly = mode == "sample";
        IReadOnlyList<TestCase> tests = sampleOnly ? problem.SampleCases : problem.AllCases;
        string[] lines = code.Replace("\r\n" , "\n").Split('\n');

        var result = new JudgeResult { Total = tests.Count , Verdict = Verdicts.Accepted };
        for (int i = 0 ; i < tests.Count ; i++)
        {
            TestCase test = tests[i];
            JudgeCase run = RunCase(lines , test , problem.TimeLimitMs);
            run.Index = i;
            result.MaxMs = Math.Max(result.MaxMs , run.Ms);
            bool revealed = sampleOnly || test.IsSample;
            if (revealed)
            {
                run.Input = test.Input;
                run.Expected = test.Output!;
            }
            else
            {
                run.Actual = null;
            }
            if (run.Verdict == Verdicts.Accepted)
                result.Passed++;

            Post("judge" , JsonSerializer.Serialize(new JudgeProgress { Index = i , Total = tests.Count , Verdict = run.Verdict , Ms = run.Ms } , JudgeJsonContext.Default.JudgeProgress));

            if (sampleOnly)
            {
                result.Cases.Add(run);
                if (run.Verdict != Verdicts.Accepted && result.Verdict == Verdicts.Accepted)
                    result.Verdict = run.Verdict;
                continue;
            }
            if (run.Verdict != Verdicts.Accepted)
            {
                result.Verdict = run.Verdict;
                result.FailedIndex = i;
                result.Cases.Add(run);
                break;
            }
        }
        return JsonSerializer.Serialize(result , JudgeJsonContext.Default.JudgeResult);
    }

    static JudgeCase RunCase(string[] lines , TestCase test , int timeLimitMs)
    {
        var output = new CaptureOutput();
        var input = new StringReader(test.Input);
        Runtime runtime = new(Runtime.AddJyunoCommandType.Math);
        AddConsole(runtime , output , input , () => { });
        AddHostFunctions(runtime);
        using Interpreter interpreter = runtime.Create(lines);

        var run = new JudgeCase();
        int failedLine = -1;
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
        catch (Exception e) when (Capture(interpreter.CurrentExecuteLine , out failedLine))
        {
            run.Verdict = Verdicts.RuntimeError;
            run.Line = failedLine;
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

public sealed class JudgeResult
{
    public string Verdict { get; set; } = Verdicts.Accepted;
    public int Total { get; set; }
    public int Passed { get; set; }
    public int FailedIndex { get; set; } = -1;
    public double MaxMs { get; set; }
    public List<JudgeCase> Cases { get; set; } = new();
}

public sealed class JudgeProgress
{
    public int Index { get; set; }
    public int Total { get; set; }
    public string? Verdict { get; set; }
    public double Ms { get; set; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(JudgeResult))]
[JsonSerializable(typeof(JudgeProgress))]
public partial class JudgeJsonContext : JsonSerializerContext;
