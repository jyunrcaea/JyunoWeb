namespace JyunoWeb.Engine;

/// <summary>
/// 다른 페이지에서 "플레이그라운드에서 실행" 버튼을 눌렀을 때 넘겨줄 코드를 보관합니다.
/// </summary>
public sealed class PlaygroundState
{
    public string? PendingCode { get; private set; }
    public string? PendingStdin { get; private set; }
    public string? PendingTitle { get; private set; }

    public void Open(string code , string? stdin = null , string? title = null)
    {
        PendingCode = code;
        PendingStdin = stdin;
        PendingTitle = title;
    }

    public (string Code, string? Stdin, string? Title)? Take()
    {
        if (PendingCode is null)
            return null;
        var pending = (PendingCode, PendingStdin, PendingTitle);
        PendingCode = PendingStdin = PendingTitle = null;
        return pending;
    }
}
