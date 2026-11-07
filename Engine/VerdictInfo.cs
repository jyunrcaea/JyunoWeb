namespace JyunoWeb.Engine;

public static class VerdictInfo
{
    public static string Name(string? verdict) => verdict switch {
        Verdicts.Accepted => "맞았습니다!!",
        Verdicts.WrongAnswer => "틀렸습니다",
        Verdicts.TimeLimit => "시간 초과",
        Verdicts.RuntimeError => "런타임 에러",
        Verdicts.GrammarError => "문법 오류",
        Verdicts.OutputLimit => "출력 초과",
        _ => "채점 중"
    };

    public static string Css(string? verdict) => "verdict verdict-" + (verdict ?? "pending").ToLowerInvariant();

    public static string LevelCss(int level) => $"level level-{level}";
}
