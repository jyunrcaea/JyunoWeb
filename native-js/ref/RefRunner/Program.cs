using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jyuno;
using Jyuno.Language;
using JyunoWeb.Engine;

// 사용법
//   RefRunner problems            → JyunoWeb 문제의 모든 테스트 케이스(입력/정답)를 JSON으로 출력
//   RefRunner examples            → 플레이그라운드 예제를 JSON으로 출력
//   RefRunner run < jobs.json     → 스크립트들을 Jyuno 1.3.2로 실행한 결과를 JSON으로 출력
//   RefRunner bench <dir> [반복]  → <dir>/*.jyuno 벤치마크를 반복 실행한 시간(ms)을 JSON으로 출력
var command = args.Length > 0 ? args[0] : "run";
var options = new JsonSerializerOptions { WriteIndented = false, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
switch (command)
{
    case "problems":
    {
        var arr = new JsonArray();
        foreach (var p in Problems.All)
        {
            var cases = new JsonArray();
            foreach (var c in p.AllCases)
                cases.Add(new JsonObject { ["input"] = c.Input, ["output"] = c.Output, ["sample"] = c.IsSample });
            arr.Add(new JsonObject { ["id"] = p.Id, ["title"] = p.Title, ["timeLimitMs"] = p.TimeLimitMs, ["cases"] = cases });
        }
        Console.WriteLine(arr.ToJsonString(options));
        break;
    }
    case "examples":
    {
        var arr = new JsonArray();
        foreach (var e in Examples.All)
            arr.Add(new JsonObject { ["id"] = e.Id, ["code"] = e.Code, ["stdin"] = e.Stdin,
                ["options"] = e.Options is null ? null : JsonSerializer.SerializeToNode(e.Options) });
        Console.WriteLine(arr.ToJsonString(options));
        break;
    }
    case "run":
    {
        var jobs = JsonNode.Parse(Console.In.ReadToEnd())!.AsArray();
        var results = new JsonArray();
        foreach (var job in jobs)
            results.Add(Ref.Run(job!));
        Console.WriteLine(results.ToJsonString(options));
        break;
    }
    case "bench":
    {
        string dir = args[1];
        int iterations = args.Length > 2 ? int.Parse(args[2]) : 30;
        string? only = args.Length > 3 ? args[3] : null;
        foreach (var file in Directory.GetFiles(dir , "*.jyuno").OrderBy(f => f))
        {
            string name = Path.GetFileNameWithoutExtension(file);
            if (only is not null && !only.Split(',').Contains(name)) continue;
            string[] lines = File.ReadAllText(file).Replace("\r\n" , "\n").TrimEnd('\n').Split('\n');
            var times = new JsonArray();
            object? result = null;
            for (int i = 0 ; i < iterations ; i++)
            {
                var sw = Stopwatch.StartNew();
                Runtime runtime = new(Runtime.AddJyunoCommandType.Math);
                using Interpreter interpreter = runtime.Create(lines);
                result = interpreter.Run();
                sw.Stop();
                times.Add(sw.Elapsed.TotalMilliseconds);
            }
            Console.WriteLine(new JsonObject { ["bench"] = name, ["runtime"] = ".NET " + Environment.Version, ["result"] = Ref.Ser(result), ["times"] = times }.ToJsonString(options));
        }
        break;
    }
}

static class Ref
{
    public static JsonNode Run(JsonNode job)
    {
        string code = (string)job["code"]!;
        string stdin = (string?)job["stdin"] ?? "";
        string host = (string?)job["host"] ?? "web";
        var opt = job["options"];
        bool Opt(string key , bool def) => opt?[key] is JsonNode n ? (bool)n : def;
        var output = new Capture();
        var outValues = new JsonArray();
        Runtime runtime;
        string[] lines;
        if (host == "test")
        {
            // Jyuno.Tests의 Script.Run과 같은 환경 (기본 명령어 + out 함수)
            runtime = new Runtime(Runtime.AddJyunoCommandType.Math);
            JyunoHost.AddConsole(runtime , output , new StringReader(stdin) , () => { });
            runtime.AddFunction("out" , a => {
                if (outValues.Count >= 1000)
                    throw new InvalidOperationException("출력이 너무 많습니다. (무한 루프?)");
                outValues.Add(Ser(a.Length > 0 ? a[0] : null));
                return null;
            });
            lines = job["lines"] is JsonArray la ? la.Select(x => (string)x!).ToArray() : code.Split('\n');
        }
        else
        {
            // JyunoSandbox.Run과 같은 환경
            var flags = Runtime.AddJyunoCommandType.Essential;
            if (Opt("math" , true)) flags |= Runtime.AddJyunoCommandType.Math;
            runtime = new Runtime(flags);
            if (Opt("console" , true))
                JyunoHost.AddConsole(runtime , output , new StringReader(stdin.Replace("\r\n" , "\n")) , () => { });
            if (Opt("host" , true))
                JyunoHost.AddHostFunctions(runtime);
            lines = code.Replace("\r\n" , "\n").Split('\n');
        }
        using Interpreter interpreter = runtime.Create(lines);
        interpreter.EnableRemoveVariable = Opt("enableRemoveVariable" , true);
        interpreter.BlockSubstitute = Opt("blockSubstitute" , false);
        var result = new JsonObject { ["id"] = job["id"]?.DeepClone() };
        int failedLine = -1;
        var sw = Stopwatch.StartNew();
        // 무한 반복 대비: 별도 스레드에서 실행하고 시간 제한
        var task = Task.Run(() => {
            try
            {
                object? value = interpreter.Run();
                if (value is GrammarError g)
                {
                    result["status"] = "grammar"; result["message"] = g.Message; result["line"] = g.Line;
                }
                else
                {
                    result["status"] = "ok"; result["value"] = Ser(value);
                }
            }
            catch (Exception e) when (JyunoHost.Capture(interpreter.CurrentExecuteLine , out failedLine))
            {
                result["status"] = "error";
                result["line"] = failedLine;
                result["message"] = JyunoHost.Unwrap(e);
                result["exceptionType"] = e is JyunoException ? null : e.GetType().Name;
            }
        });
        int limit = job["timeoutMs"] is JsonNode t ? (int)t : 10000;
        if (!task.Wait(limit))
        {
            result["status"] = "timeout";
            Console.Error.WriteLine($"timeout: {job["id"]}");
            Console.Out.Flush();
            // 멈추지 않는 스크립트는 프로세스를 끝낼 수밖에 없음
            Console.WriteLine("[" + result.ToJsonString() + "]");
            Environment.Exit(3);
        }
        sw.Stop();
        result["ms"] = sw.Elapsed.TotalMilliseconds;
        result["out"] = output.Text;
        if (host == "test") result["outValues"] = outValues;
        return result;
    }

    // 값을 타입 정보와 함께 JSON으로
    public static JsonNode? Ser(object? v) => v switch {
        null => new JsonObject { ["t"] = "null" },
        long l => new JsonObject { ["t"] = "int" , ["v"] = l.ToString(CultureInfo.InvariantCulture) },
        double d => new JsonObject { ["t"] = "double" , ["v"] = d.ToString(CultureInfo.InvariantCulture) },
        string s => new JsonObject { ["t"] = "string" , ["v"] = s },
        bool b => new JsonObject { ["t"] = "bool" , ["v"] = b },
        char c => new JsonObject { ["t"] = "char" , ["v"] = c.ToString() },
        System.Collections.IList list => new JsonObject {
            ["t"] = list is Array ? "array" : "list",
            ["e"] = ElementName(list),
            ["v"] = new JsonArray(list.Cast<object?>().Select(Ser).ToArray()) },
        _ => new JsonObject { ["t"] = v.GetType().Name , ["v"] = Convert.ToString(v , CultureInfo.InvariantCulture) }
    };

    static string ElementName(System.Collections.IList list)
    {
        Type type = list.GetType();
        if (type.IsArray) return type.GetElementType()!.Name;
        foreach (Type i in type.GetInterfaces())
            if (i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IList<>))
                return i.GetGenericArguments()[0].Name;
        return "Object";
    }

    sealed class Capture : IConsoleSink
    {
        readonly StringBuilder sb = new();
        public string Text => sb.ToString();
        public void Write(string text) { sb.Append(text); if (sb.Length > 2_000_000) throw new InvalidOperationException("출력 제한"); }
        public void Echo(string text) { }
        public void Clear() => sb.Clear();
        public void Title(string title) { }
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
