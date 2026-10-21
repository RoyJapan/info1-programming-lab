import test from "node:test";
import assert from "node:assert/strict";
import { expressionToSource, parseExpressionText, parseProgram, programToSource, runProgram } from "../runtime.js";
import { lessons } from "../lessons.js";

function run(source, options = {}) {
  const result = runProgram(source, options);
  if (result.error) assert.fail(`${result.error.line}行目: ${result.error.message}`);
  return result.output;
}

function errorOf(source, options = {}) {
  try {
    const result = runProgram(source, options);
    return result.error;
  } catch (error) {
    return error;
  }
}

function roundTrip(source) {
  return programToSource(parseProgram(source));
}

// 大学入試センター「令和7年度 試作問題『情報』の概要」p.19 の二分探索の例（字下げは｜⎿の代わりに空白）
const officialSample = [
  'Data=[3,18,29,33,48,52,62,77,89,97]',
  'kazu=要素数(Data)',
  '表示する("0～99の数字を入力してください")',
  'atai=【外部からの入力】',
  'hidari=0 , migi=kazu-1',
  'owari=0',
  'hidari <= migi and owari==0 の間繰り返す:',
  '  aida=(hidari+migi)÷2 # 演算子÷は商の整数値を返す',
  '  もし Data[aida]==atai ならば:',
  '    表示する(atai,"は",aida,"番目にありました")',
  '    owari=1',
  '  そうでなくもし Data[aida]<atai ならば:',
  '    hidari=aida+1',
  '  そうでなければ:',
  '    migi=aida-1',
  'もし owari==0 ならば:',
  '  表示する(atai,"は見つかりませんでした")',
  '表示する("添字"," ","要素")',
  'iを0からkazu-1まで1ずつ増やしながら繰り返す:',
  '  表示する(i," ",Data[ i])',
].join("\n");

const table = [3, 18, 29, 33, 48, 52, 62, 77, 89, 97].map((value, index) => `${index} ${value}\n`).join("");

test("公式サンプル: 見つかる場合", () => {
  assert.equal(run(officialSample, { inputValues: ["52"] }),
    "0～99の数字を入力してください\n52は5番目にありました\n添字 要素\n" + table);
});

test("公式サンプル: 見つからない場合", () => {
  assert.equal(run(officialSample, { inputValues: ["85"] }),
    "0～99の数字を入力してください\n85は見つかりませんでした\n添字 要素\n" + table);
});

test("公式サンプル: コード→ブロック→コードで同じ結果になり、コメントも残る", () => {
  const source = roundTrip(officialSample);
  assert.match(source, /# 演算子÷は商の整数値を返す/u);
  assert.match(source, /そうでなくもし Data\[aida\]<atai ならば:/u);
  for (const input of ["52", "85", "3", "97"]) {
    assert.equal(run(source, { inputValues: [input] }), run(officialSample, { inputValues: [input] }));
  }
  assert.equal(roundTrip(source), source);
});

test("既定の配列添字は0始まり", () => {
  assert.equal(run("Data = [3, 1, 4]\ngoukei = 0\ni を 0 から 要素数(Data) - 1 まで 1 ずつ増やしながら繰り返す:\n  goukei = goukei + Data[i]\n表示する(goukei)"), "8\n");
});

test("教材は問題文で指定された配列添字を使う", () => {
  assert.equal(lessons.find((lesson) => lesson.id === "past-r7-task-assignment").arrayBase, 1);
  assert.equal(lessons.find((lesson) => lesson.id === "past-r8-wait-time").arrayBase, 1);
  assert.equal(lessons.find((lesson) => lesson.id === "forecast-2027-count-days").arrayBase ?? 0, 0);
});

test("教材はすべて期待出力どおりで、往復してもコードが変わらない", () => {
  for (const lesson of lessons) {
    assert.equal(run(lesson.code, { arrayBase: lesson.arrayBase ?? 0, inputValues: lesson.input }).trimEnd(), lesson.expected, lesson.id);
    assert.equal(roundTrip(lesson.code), lesson.code, lesson.id);
  }
});

test("1始まりは配列の設定で選べる", () => {
  assert.equal(run("A = [3, 8]\n表示する(A[1], A[2])", { arrayBase: 1 }), "38\n");
});

test("コメント: 行全体、行末、文字列の中の#", () => {
  const source = '# はじめ\nx = 1 # 行末\nもし x == 1 ならば:\n  # 中\n  表示する("#は記号")\n# おわり';
  assert.equal(run(source), "#は記号\n");
  assert.equal(roundTrip(source), source);
});

test("そうでなくもし: 複数の分岐", () => {
  const source = "もし x < 0 ならば:\n  表示する(\"負\")\nそうでなくもし x == 0 ならば:\n  表示する(\"零\")\nそうでなくもし x < 10 ならば:\n  表示する(\"小\")\nそうでなければ:\n  表示する(\"大\")";
  const outputs = [-1, 0, 5, 20].map((x) => run(`x = ${x}\n${source}`));
  assert.deepEqual(outputs, ["負\n", "零\n", "小\n", "大\n"]);
  assert.equal(roundTrip(source), source);
});

test("そうでなくもし は もし の後にだけ置ける", () => {
  assert.match(errorOf("x = 1\nそうでなくもし x == 1 ならば:\n  表示する(x)").message, /もし/u);
});

test("減らしながら繰り返す", () => {
  const source = "i を 5 から 1 まで 2 ずつ減らしながら繰り返す:\n  表示する(i)";
  assert.equal(run(source), "5\n3\n1\n");
  assert.equal(roundTrip(source), source);
});

test("÷は商の整数部分、％は余り", () => {
  assert.equal(run("表示する(7 ÷ 2, 7 ％ 2, 6 ÷ 3)"), "312\n");
  assert.match(errorOf("表示する(1 ÷ 0)").message, /0で割る/u);
});

test("【外部からの入力】は入力値を順に読む", () => {
  assert.equal(run("a = 【外部からの入力】\nb = 【外部からの入力】\n表示する(a + b)", { inputValues: ["2", "3"] }), "5\n");
  assert.match(errorOf("a = 【外部からの入力】").message, /入力値が足りません/u);
  assert.match(errorOf("a = 【ア】").message, /【ア】/u);
});

test("1行に複数の代入を書ける", () => {
  assert.equal(run('a = 1 , b = 2, s = "x,y"\n表示する(a, b, s)'), "12x,y\n");
  assert.equal(run("A = [1, 2], n = 要素数(A)\n表示する(n)"), "2\n");
});

test("スペースを省いた書き方", () => {
  assert.equal(run("xを1から3まで1ずつ増やしながら繰り返す:\n  もしx==2ならば:\n    表示する(x)"), "2\n");
});

test("全角の記号・数字・空白を半角として読む（文字列の中はそのまま）", () => {
  assert.equal(run("ｘ ＝ １２\nもし ｘ ＞ ３ ならば：\n　表示する（ｘ ％ ５, \"＝ＯＫ\"）"), "2＝ＯＫ\n");
  assert.equal(run("表示する(5 − 2, 5 – 1)"), "34\n");
});

test("“”で囲んだ文字列も読み、半角の\"の中の“”はそのまま", () => {
  assert.equal(run('表示する("彼は“はい”と言った", “全角”, ＂A＂, \'I’ll\')'), "彼は“はい”と言った全角AI’ll\n");
});

test("二次元配列: 読み出し、書き込み、要素数", () => {
  const source = "Data = [[1, 2, 3], [4, 5, 6]]\nData[1, 2] = 9\n表示する(Data[0, 1], Data[1, 2], 要素数(Data), 要素数(Data[0]))";
  assert.equal(run(source, { arrayBase: 0 }), "2923\n");
  assert.equal(roundTrip(source), source);
  assert.match(errorOf("D = [[1], [2]]\n表示する(D[0, 1])", { arrayBase: 0 }).message, /範囲外/u);
  assert.match(errorOf("D = [[[1]]]").message, /二次元/u);
});

test("配列のすべての値を同じ値にする", () => {
  const source = "Tokuten = [5, 6, 7]\nTokutenのすべての値を0にする\n表示する(Tokuten)\nM = [[1, 2], [3, 4]]\nMのすべての値を1にする\n表示する(M)";
  assert.equal(run(source), "[0, 0, 0]\n[[1, 1], [1, 1]]\n");
  assert.equal(roundTrip(source), source);
  assert.match(errorOf("xのすべての値を0にする").message, /配列/u);
});

// 式の木から行やline情報を除き、意味だけを比べる。
function shape(node) {
  return JSON.parse(JSON.stringify(node, (key, value) => (key === "line" || key === "paren" ? undefined : value)));
}

function expressionsOf(nodes, list = []) {
  for (const node of nodes) {
    list.push(node.expression, node.condition, node.start, node.end, node.step, node.target?.indexText, ...(node.argsText ?? []));
    for (const child of [node.then, node.otherwise, node.body]) if (child) expressionsOf(child, list);
  }
  return list.filter((text) => typeof text === "string");
}

test("式をブロックからコードに戻しても意味が変わらない", () => {
  const sources = [officialSample, ...lessons.map((lesson) => lesson.code)].flatMap((source) => expressionsOf(parseProgram(source)));
  sources.push("(not b) == c", "not b == c", "(-a) ** 2", "-a ** 2", "a - (b - c)", "(a - b) - c", "(a ** b) ** c", "a ** b ** c", "-a + b",
    "a * -b", "a + (not b)", "(a < b) == c", "a / b ÷ c % d", String.raw`"引用\"符\\と\n改行"`, "A[i, j]", "A[i][j + 1]", "(A[0])[1]", "【外部からの入力】",
    "最大値(a + 1, 要素数(B))", "[[1, 2], [3, -4]]", "true and not false or x != 3", "((i + r - 2) % n) + 1");
  for (const source of sources) {
    const tree = parseExpressionText(source);
    const text = expressionToSource(tree);
    assert.deepEqual(shape(parseExpressionText(text)), shape(tree), source + " → " + text);
  }
  assert.equal(expressionToSource(parseExpressionText("((i + r - 2) % n) + 1")), "((i + r - 2) % n) + 1");
  assert.equal(expressionToSource({ type: "binary", op: "*", left: parseExpressionText("a + b"), right: parseExpressionText("c") }), "(a + b) * c");
  assert.equal(expressionToSource({ type: "binary", op: "==", left: { type: "unary", op: "not", value: parseExpressionText("b") }, right: parseExpressionText("c") }), "(not b) == c");
});

test("ブロックの入力欄は全角や×も読む", () => {
  assert.equal(expressionToSource(parseExpressionText("ｘ＋１×２")), "x + 1 * 2");
  assert.throws(() => parseExpressionText("x # メモ"), /#/u);
});
