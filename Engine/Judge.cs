using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;

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
            JudgeCase run = JyunoHost.RunCase(lines , test , problem.TimeLimitMs);
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
