using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using Jyuno;
using Jyuno.Language;

namespace JyunoWeb.Engine;

/// <summary>
/// 웹 워커 안에서 Jyuno 스크립트를 실행합니다.
/// 메인(UI) 스레드와 분리된 워커에서 실행하므로, 무한 반복문이 있어도 화면이 멈추지 않고
/// 워커를 종료하는 것으로 언제든 실행을 중단할수 있습니다.
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class JyunoSandbox
{
    /// <summary>워커의 메시지 채널로 출력 조각을 보냅니다. (kind: out, input, clear, title)</summary>
    [JSImport("globalThis.jyunoHost.post")]
    private static partial void Post(string kind , string text);

    /// <summary>
    /// 스크립트를 실행하고, 결과를 JSON 문자열로 돌려줍니다.
    /// </summary>
    [JSExport]
    public static string Run(string code , string stdin , string optionsJson)
    {
        var options = JsonSerializer.Deserialize(optionsJson , SandboxJsonContext.Default.SandboxOptions) ?? new SandboxOptions();
        var output = new OutputBuffer(Post);
        var input = new StringReader(stdin.Replace("\r\n" , "\n"));
        bool inputExhausted = false;

        var flags = Runtime.AddJyunoCommandType.Essential;
        if (options.Math)
            flags |= Runtime.AddJyunoCommandType.Math;
        if (options.File)
            flags |= Runtime.AddJyunoCommandType.File;
        Runtime runtime = new(flags);

        // 콘솔 명령어는 브라우저용으로 직접 구현 (System.Console 대신 화면의 터미널에 출력)
        if (options.Console)
            JyunoHost.AddConsole(runtime , output , input , () => inputExhausted = true);
        // C# 프로그램이 자신만의 함수를 추가하는 예시
        if (options.Host)
            JyunoHost.AddHostFunctions(runtime);

        string[] lines = code.Replace("\r\n" , "\n").Split('\n');
        using Interpreter interpreter = runtime.Create(lines);
        interpreter.EnableRemoveVariable = options.EnableRemoveVariable;
        interpreter.BlockSubstitute = options.BlockSubstitute;

        var result = new SandboxResult();
        int failedLine = -1;
        var stopwatch = Stopwatch.StartNew();
        try
        {
            object? value = interpreter.Run();
            if (value is GrammarError grammar)
            {
                result.Status = "grammar";
                result.Message = grammar.Message;
                result.Line = grammar.Line;
            }
            else
            {
                result.Status = "ok";
                result.Value = Describe(value);
                result.ValueType = TypeName(value);
            }
        }
        catch (Exception e) when (JyunoHost.Capture(interpreter.CurrentExecuteLine , out failedLine))
        {
            result.Status = "error";
            result.Line = failedLine;
            result.Message = JyunoHost.Unwrap(e);
            result.ExceptionType = e is JyunoException ? null : e.GetType().Name;
        }
        stopwatch.Stop();
        output.Flush();

        result.ElapsedMs = stopwatch.Elapsed.TotalMilliseconds;
        result.InputExhausted = inputExhausted;
        return JsonSerializer.Serialize(result , SandboxJsonContext.Default.SandboxResult);
    }

    /// <summary>워커가 준비되었는지 확인하기 위한 함수 (런타임 버전도 함께 알려줌)</summary>
    [JSExport]
    public static string Ping()
        => $"{typeof(Runtime).Assembly.GetName().Version?.ToString(3)} on .NET {Environment.Version}";

    static string Describe(object? value) => value switch {
        null => "null",
        string s => JsonSerializer.Serialize(s , SandboxJsonContext.Default.String),
        bool b => b ? "true" : "false",
        _ => Convert.ToString(value , CultureInfo.InvariantCulture) ?? "null"
    };

    static string TypeName(object? value) => value switch {
        null => "null",
        long => "int",
        double => "double",
        string => "string",
        bool => "bool",
        _ => value.GetType().Name
    };

    /// <summary>
    /// 출력을 모아서 보냅니다. 반복문에서 한 글자씩 메시지를 보내면 매우 느려지므로
    /// 일정 크기나 시간이 지나면 한꺼번에 보냅니다.
    /// </summary>
    sealed class OutputBuffer : IConsoleSink
    {
        public OutputBuffer(Action<string , string> post)
        {
            this.post = post;
        }
        readonly Action<string , string> post;
        readonly StringBuilder buffer = new();
        readonly Stopwatch clock = Stopwatch.StartNew();
        long total;
        bool truncated;
        // 출력이 너무 많으면 브라우저가 느려지므로 제한
        const long MaxOutput = 2_000_000;

        public void Write(string text)
        {
            if (truncated)
                return;
            total += text.Length;
            if (total > MaxOutput)
            {
                truncated = true;
                Flush();
                post("notice" , "출력이 너무 많아서 2,000,000자 이후로는 표시하지 않습니다.");
                return;
            }
            buffer.Append(text);
            if (buffer.Length > 16_384 || clock.ElapsedMilliseconds > 50)
                Flush();
        }

        public void Echo(string text)
        {
            Flush();
            post("input" , text);
        }

        public void Clear()
        {
            buffer.Clear();
            total = 0;
            truncated = false;
            post("clear" , string.Empty);
        }

        public void Title(string title)
        {
            Flush();
            post("title" , title);
        }

        public void Flush()
        {
            if (buffer.Length > 0)
            {
                post("out" , buffer.ToString());
                buffer.Clear();
            }
            clock.Restart();
        }
    }
}

public sealed class SandboxOptions
{
    public bool Console { get; set; } = true;
    public bool Math { get; set; } = true;
    public bool File { get; set; }
    public bool Host { get; set; } = true;
    public bool EnableRemoveVariable { get; set; } = true;
    public bool BlockSubstitute { get; set; }
}

public sealed class SandboxResult
{
    public string Status { get; set; } = "ok";
    public string? Value { get; set; }
    public string? ValueType { get; set; }
    public string? Message { get; set; }
    public string? ExceptionType { get; set; }
    public int Line { get; set; } = -1;
    public double ElapsedMs { get; set; }
    public bool InputExhausted { get; set; }
}

[System.Text.Json.Serialization.JsonSourceGenerationOptions(PropertyNamingPolicy = System.Text.Json.Serialization.JsonKnownNamingPolicy.CamelCase)]
[System.Text.Json.Serialization.JsonSerializable(typeof(SandboxOptions))]
[System.Text.Json.Serialization.JsonSerializable(typeof(SandboxResult))]
[System.Text.Json.Serialization.JsonSerializable(typeof(string))]
public partial class SandboxJsonContext : System.Text.Json.Serialization.JsonSerializerContext;
