namespace JyunoWeb.Engine;

public sealed record Example(string Id , string Title , string Description , string Code , string Stdin = "" , SandboxOptions? Options = null);

public static class Examples
{
    public static readonly Example Hello = new(
        "hello" ,
        "안녕, Jyuno!" ,
        "한 줄에 명령어 하나. 함수 이름 뒤에 인자를 공백으로 나열하면 됩니다." ,
        """
        console.writeline "안녕하세요, Jyuno!"
        name = "Jyunni"
        console.writeline "반가워요, {1}님!" name
        console.writeline "오늘의 숫자는 {1} 입니다." (add 600 14)
        """);

    public static readonly Example Arithmetic = new(
        "arithmetic" ,
        "변수와 계산" ,
        "연산자 대신 add, sub, mul, div, mod 함수를 씁니다. 문자열이 섞이면 문자열로 이어 붙여요." ,
        """
        a = 17
        b = 5
        console.writeline "a + b = {1}" (add a b)
        console.writeline "a - b = {1}" (sub a b)
        console.writeline "a * b = {1}" (mul a b)
        console.writeline "a / b = {1}" (div a b)
        console.writeline "a % b = {1}" (mod a b)
        console.writeline "실수 나눗셈: {1}" (div (double a) b)
        console.writeline "숫자 + 문자열: {1}" (add 1 "2")
        console.writeline "문자열 빼기: {1}" (sub "Jyunni" "n")
        console.writeline (mul "=-" 15)
        """);

    public static readonly Example Gugudan = new(
        "gugudan" ,
        "구구단 (repeat)" ,
        "repeat (횟수) ... end 로 정해진 횟수만큼 반복합니다. 반복문은 얼마든지 중첩할수 있어요." ,
        """
        dan = 2
        repeat 8
            console.writeline "── {1}단 ──" dan
            i = 1
            repeat 9
                console.writeline "{1} x {2} = {3}" dan i (mul dan i)
                i = add i 1
            end
            dan = add dan 1
        end
        """);

    public static readonly Example FizzBuzz = new(
        "fizzbuzz" ,
        "FizzBuzz (while, if)" ,
        "while은 값이 참인 동안 반복합니다. null, false, 0, 빈 문자열이 아니면 모두 참이에요." ,
        """
        n = 1
        left = 30
        while left
            if (equal (mod n 15) 0)
                console.writeline "FizzBuzz"
            else
                if (equal (mod n 3) 0)
                    console.writeline "Fizz"
                else
                    if (equal (mod n 5) 0)
                        console.writeline "Buzz"
                    else
                        console.writeline n
                    end
                end
            end
            n = add n 1
            left = sub left 1
        end
        """);

    public static readonly Example Functions = new(
        "functions" ,
        "함수와 재귀" ,
        "func 이름 ... endfunc 로 함수를 만들고, param 으로 인자를 받습니다. 재귀 호출도 됩니다." ,
        """
        func fact
            param n
            if (equal n 0)
                return 1
            end
            return (mul n (fact (sub n 1)))
        endfunc

        func fib
            param n
            if (equal n 0)
                return 0
            end
            if (equal n 1)
                return 1
            end
            return (add (fib (sub n 1)) (fib (sub n 2)))
        endfunc

        console.writeline "10! = {1}" (fact 10)
        console.write "피보나치: "
        i = 0
        repeat 15
            console.write "{1} " (fib i)
            i = add i 1
        end
        console.writeline
        """);

    public static readonly Example Goto = new(
        "goto" ,
        "레이블과 goto" ,
        "이름: 으로 레이블을 만들고 goto 로 그 줄로 이동합니다. 줄 번호는 0부터 셉니다." ,
        """
        count = 5
        loop:
        console.writeline "카운트다운: {1}" count
        count = sub count 1
        if count
            goto loop
        end
        console.writeline "발사! 🚀"
        """);

    public static readonly Example Stars = new(
        "stars" ,
        "트리 그리기" ,
        "mul 에 문자열과 정수를 넣으면 문자열을 반복합니다." ,
        """
        size = 8
        i = 1
        repeat size
            spaces = mul " " (sub size i)
            stars = mul "*" (sub (mul i 2) 1)
            console.writeline (add spaces stars)
            i = add i 1
        end
        console.writeline (add (mul " " (sub size 2)) "|||")
        """);

    public static readonly Example Input = new(
        "input" ,
        "입력 받기" ,
        "console.readline 은 오른쪽 아래 '입력' 칸에 적은 내용을 한 줄씩 읽어옵니다." ,
        """
        console.write "이름을 입력하세요: "
        name = console.readline
        console.write "나이를 입력하세요: "
        age = int (console.readline)
        console.writeline "{1}님, 10년 뒤에는 {2}살이네요!" name (add age 10)
        """ ,
        "Jyunni\n20");

    public static readonly Example Constants = new(
        "constants" ,
        "상수와 삭제" ,
        "(값) = (이름) 은 상수 선언, (이름) = 은 삭제입니다. 마지막 줄은 상수에 대입해서 일부러 오류를 냅니다." ,
        """
        3.14 = pi
        console.writeline "pi = {1}" pi
        temp = 100
        console.writeline "temp 삭제: {1}" (temp =)
        console.writeline "한번 더 삭제: {1}" (temp =)
        console.writeline "이제 상수 pi에 값을 대입해볼게요..."
        pi = 3
        """);

    public static readonly Example Math = new(
        "math" ,
        "수학 명령어" ,
        "Math 명령어 묶음을 켜면 math.* 함수와 상수를 쓸수 있습니다." ,
        """
        console.writeline "원주율: {1}" math.pi
        console.writeline "sin(π/2) = {1}" (math.sin (div math.pi 2))
        console.writeline "2^10 = {1}" (math.pow 2 10)
        console.writeline "log10(1000) = {1}" (math.log 1000)
        console.writeline "log2(1024) = {1}" (math.log2 1024)
        console.writeline "|-614| = {1}" (math.abs -614)
        """);

    public static readonly Example Sandbox = new(
        "sandbox" ,
        "샌드박스: 없는 명령어" ,
        "호스트가 제공하지 않은 명령어는 존재하지 않는 함수일 뿐입니다. 설정에서 '파일'을 켜고 다시 실행해 보세요. (브라우저 안의 가상 디스크라 안전해요)" ,
        """
        console.writeline "스크립트가 파일에 접근해 보려고 합니다..."
        file.write "/tmp/secret.txt" "몰래 쓴 내용"
        console.writeline "파일 쓰기 성공: {1}" (file.read "/tmp/secret.txt")
        """);

    public static readonly Example Host = new(
        "host" ,
        "호스트 함수: 숫자 맞히기" ,
        "random 은 Jyuno 기본 명령어가 아니라 이 웹사이트(C#)가 runtime.AddFunction 으로 추가한 함수입니다. (less 는 1.3.2부터 기본 명령어예요)" ,
        """
        secret = random 1 101
        low = 1
        high = 100
        tries = 0
        console.writeline "1부터 100 사이의 숫자를 이분 탐색으로 맞혀볼게요."
        while true
            guess = div (add low high) 2
            tries = add tries 1
            if (equal guess secret)
                console.writeline "{1}? 정답! {2}번 만에 맞혔어요." guess tries
                break
            end
            if (less guess secret)
                console.writeline "{1}? 더 커요" guess
                low = add guess 1
            else
                console.writeline "{1}? 더 작아요" guess
                high = sub guess 1
            end
        end
        """);

    public static readonly Example Infinite = new(
        "infinite" ,
        "무한 반복과 중지" ,
        "Jyuno는 웹 워커에서 돌아가서 무한 반복에도 화면이 멈추지 않아요. 중지 버튼을 눌러 보세요." ,
        """
        i = 0
        while true
            i = add i 1
            if (equal (mod i 5000) 0)
                console.writeline "{1}번째 반복 중... (중지 버튼을 눌러보세요)" i
            end
        end
        """);

    public static readonly Example Arrays = new(
        "arrays" ,
        "배열과 리스트 (1.2.0)" ,
        "array / list 로 만들고, '변수 인덱스'로 읽고 '변수 인덱스 값'으로 씁니다. add 는 이어붙이기, sub 는 차집합이에요." ,
        """
        scores = array 90 75 100 60
        console.writeline "학생 수: {1}" (length scores)
        console.writeline "첫번째 점수: {1}" (scores 0)
        scores 1 80
        console.writeline "고친 두번째 점수: {1}" (scores 1)

        func show
            param items
            local text = ""
            for x items
                text = add text x " "
            end
            return text
        endfunc

        console.writeline "점수: {1}" (show scores)
        more = add scores (array 85 95) 70
        console.writeline "이어붙이기: {1}" (show more)
        console.writeline "차집합: {1}" (show (sub (array 1 2 3 2 4) (array 2 4)))

        names = list "jyunni" "jyuno"
        names = add names "playground"
        console.writeline "리스트: {1}({2}개)" (show names) (length names)
        """);

    public static readonly Example Split = new(
        "split" ,
        "문자열 나누기와 for (1.3.0)" ,
        "div (문자열) (구분자) 는 문자열을 나눈 배열을 돌려줍니다. for 는 배열, 리스트, 문자열을 차례로 순회해요." ,
        """
        line = "apple banana cherry jyuno"
        words = div line " "
        console.writeline "단어 {1}개" (length words)
        for w words
            console.writeline "- {1} ({2}글자)" w (length w)
        end

        sum = 0
        for n (div "3,1,4,1,5,9,2,6" ",")
            sum = add sum (int n)
        end
        console.writeline "3,1,4,1,5,9,2,6 의 합: {1}" sum

        count = 0
        for ch "hello jyuno"
            if (equal ch "o")
                count = add count 1
            end
        end
        console.writeline "hello jyuno 에 o 는 {1}번" count
        """);

    public static readonly Example Compare = new(
        "compare" ,
        "비교와 논리 (1.3.2)" ,
        "less, greater 는 크기 비교(셋 이상이면 오름차순/내림차순 검사), and, or, not 은 논리 연산입니다. 인자가 모두 정수면 비트 연산이 돼요." ,
        """
        console.writeline "less 1 2       → {1}" (less 1 2)
        console.writeline "less 1 2 3 4   → {1}" (less 1 2 3 4)
        console.writeline "less 1 3 2     → {1}" (less 1 3 2)
        console.writeline "greater 3 2 1  → {1}" (greater 3 2 1)
        console.writeline "less 'apple' 'banana' → {1}" (less "apple" "banana")

        age = 17
        if (less 12 age 20)
            console.writeline "{1}살은 10대예요." age
        end
        if (or (less age 8) (greater age 64))
            console.writeline "요금 무료"
        else
            console.writeline "요금 1,500원"
        end
        if (not (equal age 20))
            console.writeline "20살이 아니에요."
        end

        console.writeline "and true false → {1}" (and true false)
        console.writeline "and 12 10      → {1} (비트 AND)" (and 12 10)
        console.writeline "or 12 10       → {1} (비트 OR)" (or 12 10)
        console.writeline "not 5          → {1} (비트 NOT)" (not 5)
        console.writeline "not (bool 0)   → {1}" (not (bool 0))
        """);

    public static readonly Example Bits = new(
        "bits" ,
        "비트 플래그 (1.3.2)" ,
        "정수에 and, or, not 을 쓰면 비트 연산이 됩니다. 권한 같은 플래그를 정수 하나에 담아 볼게요." ,
        """
        1 = READ
        2 = WRITE
        4 = EXEC

        func show
            param perm
            local text = ""
            for flag (array READ WRITE EXEC)
                if (and perm flag)
                    text = add text (text.at "rwx" (math.log2 flag))
                else
                    text = add text "-"
                end
            end
            return text
        endfunc

        perm = or READ EXEC
        console.writeline "처음 권한: {1} ({2})" (show perm) perm
        perm = or perm WRITE
        console.writeline "쓰기 추가: {1} ({2})" (show perm) perm
        perm = and perm (not EXEC)
        console.writeline "실행 제거: {1} ({2})" (show perm) perm
        console.writeline "쓰기 가능? {1}" (bool (and perm WRITE))
        """);

    public static readonly Example BubbleSort = new(
        "sort" ,
        "버블 정렬" ,
        "배열의 원소를 읽고(a i) 바꾸는(a i 값) 문법으로 정렬을 구현합니다. 입력 칸에 숫자를 바꿔 넣어 보세요." ,
        """
        a = list
        for x (div (console.readline) " ")
            a = add a (int x)
        end
        n = length a
        repeat n
            i = 0
            repeat (sub n 1)
                j = add i 1
                if (greater (a i) (a j))
                    t = a i
                    a i (a j)
                    a j t
                end
                i = j
            end
        end
        for x a
            console.write "{1} " x
        end
        console.writeline
        """ ,
        "29 3 71 14 58 6 42 -5");

    public static readonly Example Sieve = new(
        "sieve" ,
        "에라토스테네스의 체" ,
        "add 로 배열을 자기 자신과 이어붙이면 길이가 두 배가 됩니다. 이렇게 만든 배열로 100 이하의 소수를 구해요." ,
        """
        n = 100
        p = array true
        while (not (greater (length p) n))
            p = add p p
        end
        i = 2
        while (not (greater (mul i i) n))
            if (p i)
                j = mul i i
                while (not (greater j n))
                    p j false
                    j = add j i
                end
            end
            i = add i 1
        end
        primes = list
        i = 2
        repeat (sub n 1)
            if (p i)
                primes = add primes i
            end
            i = add i 1
        end
        console.writeline "{1} 이하의 소수 {2}개:" n (length primes)
        for x primes
            console.write "{1} " x
        end
        console.writeline
        """);

    public static readonly IReadOnlyList<(string Group, Example[] Items)> Groups = new[] {
        ("기초", new[] { Hello, Arithmetic, Constants, Input }),
        ("흐름 제어", new[] { Gugudan, FizzBuzz, Goto, Stars }),
        ("함수", new[] { Functions, Math }),
        ("배열과 문자열 (NEW)", new[] { Arrays, Split, BubbleSort, Sieve }),
        ("비교와 논리 (NEW)", new[] { Compare, Bits }),
        ("호스트와 보안", new[] { Host, Sandbox, Infinite }),
    };

    public static IEnumerable<Example> All => Groups.SelectMany(g => g.Items);

    public static Example? Find(string? id) => All.FirstOrDefault(e => e.Id == id);
}
