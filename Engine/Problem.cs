using System.Text;

namespace JyunoWeb.Engine;

public sealed record TestCase(string Input , string Output , bool IsSample);

/// <summary>
/// 온라인 저지 문제 하나. 예제와 숨겨진 테스트의 정답은 C#으로 작성한 풀이(Solve)로 만듭니다.
/// </summary>
public sealed class Problem
{
    public required int Id { get; init; }
    public required string Title { get; init; }
    /// <summary>1 입문, 2 쉬움, 3 보통, 4 어려움</summary>
    public required int Level { get; init; }
    public required string[] Tags { get; init; }
    public required string Description { get; init; }
    public required string InputSpec { get; init; }
    public required string OutputSpec { get; init; }
    /// <summary>예제 입력 (줄바꿈으로 구분)</summary>
    public required string[] Samples { get; init; }
    /// <summary>숨겨진 테스트 입력을 만드는 함수 (문제 번호를 씨앗으로 쓰므로 항상 같은 테스트가 나옴)</summary>
    public required Func<Random , IEnumerable<string>> Tests { get; init; }
    public required Func<Input , string> Solve { get; init; }
    public string? Hint { get; init; }
    public int TimeLimitMs { get; init; } = 2000;

    IReadOnlyList<TestCase>? samples, all;

    public IReadOnlyList<TestCase> SampleCases => samples ??= Samples.Select(s => Case(s , true)).ToList();

    public IReadOnlyList<TestCase> AllCases => all ??= SampleCases.Concat(Tests(new Random(Id)).Select(s => Case(s , false))).ToList();

    TestCase Case(string input , bool sample)
    {
        input = input.Replace("\r\n" , "\n");
        if (!input.EndsWith('\n') && input.Length > 0)
            input += "\n";
        return new TestCase(input , Solve(new Input(input)) , sample);
    }

    public string LevelName => LevelNames[Level];
    public static readonly string[] LevelNames = { "" , "입문" , "쉬움" , "보통" , "어려움" };
}

/// <summary>풀이 함수가 입력을 한 줄씩 읽기 위한 도구</summary>
public sealed class Input
{
    readonly string[] lines;
    int index;

    public Input(string text)
    {
        lines = text.Replace("\r\n" , "\n").Split('\n');
    }

    public string Str() => lines[index++];
    public long Long() => long.Parse(Str().Trim());
    public int Int() => (int)Long();
}

/// <summary>입력/출력 문자열을 만드는 도구</summary>
static class Text
{
    public static string Lines(params object[] values) => string.Join("\n" , values.Select(v => Convert.ToString(v , System.Globalization.CultureInfo.InvariantCulture)));
    public static string Lines<T>(IEnumerable<T> values) => string.Join("\n" , values);
    public static string Words<T>(IEnumerable<T> values) => string.Join(" " , values);

    public static string ListInput(IList<long> values) => Lines(new object[] { values.Count }.Concat(values.Cast<object>()).ToArray());

    public static long Next(this Random random , long min , long max) => random.NextInt64(min , max + 1);

    public static string Word(this Random random , int length , string alphabet = "abcdefghijklmnopqrstuvwxyz")
    {
        var sb = new StringBuilder();
        for (int i = 0 ; i < length ; i++)
            sb.Append(alphabet[random.Next(alphabet.Length)]);
        return sb.ToString();
    }
}
