import { ProgramError, expressionToSource, parseExpressionText, parseProgram, programToSource, runProgram, runtimeLimits } from "./runtime.js";
import { lessons } from "./lessons.js";

const STORAGE_KEY = "info1-programming-lab-v1";
const $ = (id) => document.getElementById(id);
const code = $("code");
const state = {
  records: [],
  trace: [],
  traceIndex: -1,
  blockAst: [],
  blocksValid: true,
  blockSelection: null,
  blockDragEnd: 0,
  exprTarget: null,
  lastBlockField: null,
  history: [],
  historyIndex: -1,
  historyTimer: null,
  saveTimer: null,
  toastTimer: null,
  playTimer: null,
  currentOutput: "",
  currentLessonId: null,
};
const el = (tag, attrs = {}, text = "") => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "attrs") for (const [name, attrValue] of Object.entries(value)) node.setAttribute(name, attrValue);
    else node[key] = value;
  }
  if (text !== "") node.textContent = text;
  return node;
};

const defaultCode = [
  "Data = [3, 1, 4]",
  "goukei = 0",
  "i を 0 から 要素数(Data) - 1 まで 1 ずつ増やしながら繰り返す:",
  "  goukei = goukei + Data[i]",
  "表示する(\"合計：\", goukei)",
].join("\n");
const previousDefaultCode = [
  "A = [3, 1, 4]",
  "合計 = 0",
  "i を 1 から 要素数(A) まで 1 ずつ増やしながら繰り返す:",
  "  合計 = 合計 + A[i]",
  "表示する(\"合計：\", 合計)",
].join("\n");

function readSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || typeof saved.code !== "string" || saved.code.length > runtimeLimits.sourceLength) return null;
    const migrateStarter = saved.title === "配列の合計を求める" && saved.code === previousDefaultCode && saved.arrayBase === 1;
    return {
      code: migrateStarter ? defaultCode : saved.code,
      title: typeof saved.title === "string" ? saved.title.slice(0, 80) : "新しいプログラム",
      inputValues: typeof saved.inputValues === "string" ? saved.inputValues.slice(0, 20_000) : "",
      prediction: typeof saved.prediction === "string" ? saved.prediction.slice(0, 20_000) : "",
      skipPrediction: saved.skipPrediction === true,
      arrayBase: migrateStarter ? 0 : saved.arrayBase === 1 ? 1 : 0,
      records: Array.isArray(saved.records) ? saved.records.slice(0, 10) : [],
      lessonId: lessons.some((lesson) => lesson.id === saved.lessonId) ? saved.lessonId : null,
    };
  } catch {
    return null;
  }
}

function currentState() {
  return {
    version: 1,
    code: code.value,
    title: $("program-title").value.slice(0, 80),
    inputValues: $("input-values").value,
    prediction: $("prediction").value,
    skipPrediction: $("skip-prediction").checked,
    arrayBase: Number($("array-base").value) === 0 ? 0 : 1,
    records: state.records.slice(0, 10),
    lessonId: state.currentLessonId,
  };
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function saveState(manual = false) {
  if (!$("blocks-view").hidden && !state.blocksValid) {
    $("save-status").textContent = "ブロックの入力を直してから保存してください";
    if (manual) showToast("式のエラーを直してから保存してください。エラー中の編集内容はまだコードに反映されていません。");
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState()));
    $("save-status").textContent = "保存済み（この端末）";
    if (manual) showToast("この端末に保存しました。");
    return true;
  } catch {
    $("save-status").textContent = "保存できません。書き出してください。";
    if (manual) showToast("保存容量が足りません。書き出しでバックアップしてください。");
    return false;
  }
}

function scheduleSave() {
  $("save-status").textContent = "保存中…";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveState(false), 350);
}

function commitHistory() {
  clearTimeout(state.historyTimer);
  const value = code.value;
  if (state.history[state.historyIndex] === value) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(value);
  if (state.history.length > 100) state.history.shift();
  state.historyIndex = state.history.length - 1;
}

function scheduleHistory() {
  clearTimeout(state.historyTimer);
  state.historyTimer = setTimeout(commitHistory, 400);
}

function resetHistory() {
  clearTimeout(state.historyTimer);
  state.history = [code.value];
  state.historyIndex = 0;
}

function setCode(value, { history = true, save = true, resetTrace = true } = {}) {
  code.value = value;
  updateLineNumbers();
  if (history) scheduleHistory();
  if (save) scheduleSave();
  if (resetTrace) clearTrace();
}

function countLines(value) {
  return Math.max(1, value.split("\n").length);
}

function updateLineNumbers(activeLine = -1) {
  const count = countLines(code.value);
  $("line-count").textContent = count + "行";
  const gutter = $("line-numbers");
  gutter.replaceChildren();
  for (let line = 1; line <= count; line += 1) {
    const span = el("span", { className: line === activeLine ? "line-number current" : "line-number" }, String(line));
    gutter.append(span);
  }
}

function currentHasContent() {
  return code.value.trim().length > 0 || $("input-values").value.length > 0 || $("prediction").value.length > 0 || $("program-title").value !== "新しいプログラム" || (!$("blocks-view").hidden && state.blockAst.length > 0);
}

function confirmReplacement(action) {
  if (!currentHasContent()) return true;
  return window.confirm("現在のプログラムを置き換えて「" + action + "」しますか？ 保存済みでもこの確認が表示されます。");
}

function replaceDocument(data, action) {
  if (!confirmReplacement(action)) return false;
  state.blockAst = [];
  state.blocksValid = true;
  state.currentLessonId = lessons.some((lesson) => lesson.id === data.lessonId) ? data.lessonId : null;
  renderLessonContext();
  $("blocks-view").hidden = true;
  $("code-view").hidden = false;
  $("blocks-mode").classList.remove("active");
  $("code-mode").classList.add("active");
  $("blocks-mode").setAttribute("aria-pressed", "false");
  $("code-mode").setAttribute("aria-pressed", "true");
  updateModeActions();
  $("program-title").value = data.title || "新しいプログラム";
  $("input-values").value = data.inputValues || "";
  $("prediction").value = data.prediction || "";
  $("skip-prediction").checked = data.skipPrediction === true;
  $("array-base").value = String(data.arrayBase === 1 ? 1 : 0);
  setCode(data.code || "", { history: false, save: false });
  resetHistory();
  if (!saveState(false)) showToast("この端末への保存に失敗しました。ページを閉じる前に書き出してください。");
  switchToBlocks();
  return true;
}

function insertAtCursor(text) {
  if (!$("blocks-view").hidden) {
    const field = state.lastBlockField;
    if (!field?.isConnected) {
      showToast("先にブロックの入力欄をタップしてください。");
      return;
    }
    field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    return;
  }
  const start = code.selectionStart;
  const end = code.selectionEnd;
  code.setRangeText(text, start, end, "end");
  code.dispatchEvent(new Event("input", { bubbles: true }));
  code.focus();
}

function lineIndexAt(source, offset) {
  return source.slice(0, offset).split("\n").length - 1;
}

function lineStart(lines, index) {
  return lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
}

function transformSelectedLines(operation) {
  const source = code.value;
  const lines = source.split("\n");
  const start = code.selectionStart;
  const end = code.selectionEnd;
  const first = lineIndexAt(source, start);
  const last = lineIndexAt(source, end > start ? end - 1 : end);
  const selected = lines.slice(first, last + 1);
  let newFirst = first;

  if (operation === "indent") selected.forEach((line, i) => { selected[i] = "  " + line; });
  if (operation === "outdent") selected.forEach((line, i) => { selected[i] = line.replace(/^ {1,2}/u, ""); });
  if (operation === "duplicate") {
    lines.splice(last + 1, 0, ...selected);
  } else if (operation === "delete") {
    lines.splice(first, last - first + 1);
    if (!lines.length) lines.push("");
  } else if (operation === "up" && first > 0) {
    const above = lines.splice(first - 1, 1)[0];
    lines.splice(last, 0, above);
    newFirst = first - 1;
  } else if (operation === "down" && last < lines.length - 1) {
    const below = lines.splice(last + 1, 1)[0];
    lines.splice(first, 0, below);
    newFirst = first + 1;
  } else if (operation === "indent" || operation === "outdent") {
    lines.splice(first, selected.length, ...selected);
  }

  const next = lines.join("\n");
  setCode(next);
  const selectionStart = lineStart(lines, newFirst);
  const selectionEnd = lineStart(lines, Math.min(newFirst + selected.length - 1, lines.length - 1)) + lines[Math.min(newFirst + selected.length - 1, lines.length - 1)].length;
  code.focus();
  code.setSelectionRange(selectionStart, selectionEnd);
}

function updateRunButtonState() {
  $("run-button").disabled = false;
}

function clearTrace() {
  clearInterval(state.playTimer);
  state.playTimer = null;
  state.trace = [];
  state.traceIndex = -1;
  $("trace-controls").hidden = true;
  $("trace-position").textContent = "実行後にトレースできます";
  $("trace-play").disabled = true;
  $("trace-pause").disabled = true;
  $("trace-next").disabled = true;
  updateLineNumbers();
  markTraceBlock();
  renderTraceTable();
}

// トレースで実行中の行を、ブロック表示のカードにも映す。
// カードは文の順（もしの中→そうでなければの中）に並ぶので、実行するコードを読み直した文と同じ順で行番号を対応させる。
// 1行に並んだ代入はどのカードも同じ行なので、まとめて強調する。
function markTraceBlock(scroll = false) {
  const line = state.trace[state.traceIndex]?.line ?? -1;
  const cards = [...$("block-tree").querySelectorAll(".block-card")];
  const lines = [];
  const walk = (nodes) => nodes.forEach((node) => { lines.push(node.line); walk(node.then ?? node.body ?? []); walk(node.otherwise ?? []); });
  if (line > 0) try { walk(parseProgram(code.value)); } catch { lines.length = 0; }
  const ok = lines.length === cards.length;
  cards.forEach((card, index) => card.classList.toggle("current", ok && lines[index] === line));
  const main = cards.find((card) => card.classList.contains("current"))?.firstElementChild;
  if (!scroll || !main) return;
  // 画面全体は動かさず、ブロックの置き場の中だけをスクロールする。
  const stage = $("block-stage");
  const top = main.getBoundingClientRect().top - stage.getBoundingClientRect().top;
  if (top < 0 || top + main.offsetHeight > stage.clientHeight) stage.scrollTop += top - 12;
}

function formatVariable(value) {
  if (Array.isArray(value)) return "[" + value.map(formatVariable).join(", ") + "]";
  if (typeof value === "string") return "\"" + value + "\"";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function renderTraceTable() {
  const content = $("trace-content");
  content.replaceChildren();
  if (!state.trace.length) {
    content.append(el("p", { className: "assist-note" }, "プログラムを実行すると、行ごとの変数と配列の変化を表示します。"));
    return;
  }
  const scroll = el("div", { className: "trace-scroll" });
  const table = el("table", { className: "trace-table" });
  const head = el("thead");
  const headRow = el("tr");
  ["#", "行", "変数の値"].forEach((name) => headRow.append(el("th", {}, name)));
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  state.trace.forEach((row, index) => {
    const tr = el("tr", { className: index === state.traceIndex ? "current" : "" });
    tr.append(el("td", {}, String(index + 1)), el("td", {}, String(row.line)));
    const stateText = Object.entries(row.variables).map(([name, value]) => name + " = " + formatVariable(value)).join("\n") || "（まだ変数はありません）";
    tr.append(el("td", {}, stateText));
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", (index + 1) + "件目、" + row.line + "行目");
    tr.addEventListener("click", () => renderTraceStep(index));
    tr.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") renderTraceStep(index); });
    body.append(tr);
  });
  table.append(body);
  scroll.append(table);
  content.append(el("p", { className: "assist-note" }, "各行の実行後状態。行を選ぶとその時点の出力を見られます。"));
  content.append(scroll);
}

function renderTraceStep(index, updateOutput = true) {
  if (!state.trace.length) return;
  state.traceIndex = Math.max(0, Math.min(index, state.trace.length - 1));
  const row = state.trace[state.traceIndex];
  updateLineNumbers(row.line);
  markTraceBlock(true);
  $("trace-position").textContent = (state.traceIndex + 1) + " / " + state.trace.length + " 件 ・ " + row.line + "行目";
  $("trace-next").disabled = state.traceIndex >= state.trace.length - 1;
  $("trace-play").disabled = state.traceIndex >= state.trace.length - 1;
  $("trace-pause").disabled = !state.playTimer;
  if (updateOutput) $("output").textContent = row.output || "（この時点ではまだ出力がありません）";
  if (document.querySelector('[data-result="trace"]').getAttribute("aria-selected") === "true") renderTraceTable();
}

function runTrace() {
  clearInterval(state.playTimer);
  if (!state.trace.length) return;
  if (state.traceIndex >= state.trace.length - 1) renderTraceStep(0);
  $("trace-play").disabled = true;
  $("trace-pause").disabled = false;
  state.playTimer = setInterval(() => {
    if (state.traceIndex >= state.trace.length - 1) {
      clearInterval(state.playTimer);
      state.playTimer = null;
      renderTraceStep(state.traceIndex);
      $("trace-pause").disabled = true;
      return;
    }
    renderTraceStep(state.traceIndex + 1);
  }, 600);
}

function showAssist(name) {
  document.querySelectorAll("[data-assist]").forEach((tab) => {
    const active = tab.dataset.assist === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  const selected = document.querySelector('[data-assist="' + name + '"]');
  $("assist-content").setAttribute("aria-labelledby", selected.id);
  if (name === "help") renderInputHelp();
  else renderPalette();
}

function renderLessonContext() {
  const lesson = lessons.find((item) => item.id === state.currentLessonId);
  $("lesson-context").hidden = !lesson;
  if (!lesson) return;
  $("lesson-context-title").textContent = lesson.title;
  $("lesson-context-prompt").textContent = lesson.prompt;
}

function updateModeActions() {
  const blockMode = !$("blocks-view").hidden;
  $("line-actions").hidden = blockMode;
  $("tab-block-palette").hidden = blockMode;
  if (blockMode && $("tab-block-palette").getAttribute("aria-selected") === "true") showAssist("help");
}

function appendPaletteGroup(container, title, items) {
  const group = el("div", { className: "palette-group" });
  group.append(el("div", { className: "palette-name" }, title));
  const buttons = el("div", { className: "palette-items" });
  items.forEach((item) => {
    const button = el("button", { type: "button" }, item.label);
    button.addEventListener("click", () => insertAtCursor(item.value));
    buttons.append(button);
  });
  group.append(buttons);
  container.append(group);
}

function renderPalette() {
  const content = $("assist-content");
  content.replaceChildren();
  content.append(el("p", { className: "assist-note" }, "構文を選ぶと、カーソル位置に挿入します。"));
  appendPaletteGroup(content, "変数・配列", [
    { label: "x = 0", value: "x = 0" },
    { label: "A = []", value: "A = []" },
    { label: "A[0]", value: "A[0]" },
  ]);
  appendPaletteGroup(content, "演算子", OPERATORS.map((item) => ({ label: item.op + " " + item.short, value: " " + item.op + " " })));
  appendPaletteGroup(content, "関数・表示", [
    { label: "表示する()", value: "表示する()" },
    { label: "要素数()", value: "要素数()" },
    { label: "最大値()", value: "最大値()" },
    { label: "最小値()", value: "最小値()" },
    { label: "整数()", value: "整数()" },
    { label: "乱数()", value: "乱数()" },
    { label: "【外部からの入力】", value: "【外部からの入力】" },
  ]);
  appendPaletteGroup(content, "制御", [
    { label: "もし", value: "もし 条件 ならば:\n  \n" },
    { label: "そうでなくもし", value: "そうでなくもし 条件 ならば:\n  \n" },
    { label: "繰返し", value: "i を 0 から 2 まで 1 ずつ増やしながら繰り返す:\n  \n" },
    { label: "減らす繰返し", value: "i を 2 から 0 まで 1 ずつ減らしながら繰り返す:\n  \n" },
    { label: "条件繰返し", value: "条件 の間繰り返す:\n  \n" },
    { label: "すべての値を", value: "Aのすべての値を0にする" },
    { label: "# コメント", value: "# " },
  ]);
}

function renderInputHelp() {
  const content = $("assist-content");
  content.replaceChildren();
  content.append(el("p", { className: "assist-note" }, "実行時に読む値は、下の「入力」タブに1行ずつ入力します。"));
  const button = el("button", { type: "button", className: "primary-button" }, "【外部からの入力】 を挿入");
  button.addEventListener("click", () => insertAtCursor("【外部からの入力】"));
  content.append(button);
  const note = el("div", { className: "palette-group" });
  note.append(el("div", { className: "palette-name" }, "入力順"));
  note.append(el("div", { className: "palette-items" }, "上の行から順に読みます。数値は数値として、それ以外は文字列として扱います。値が不足すると、その行で停止します。入力() と書いても同じです。"));
  content.append(note);
  const funcs = el("div", { className: "palette-group" });
  funcs.append(el("div", { className: "palette-name" }, "関数"));
  funcs.append(el("div", { className: "palette-items" }, "要素数(A) ・ 最大値(a, b) ・ 最小値(a, b) ・ 整数(x) ・ 乱数()（0以上1未満）"));
  content.append(funcs);
}

// ブロックの種類。置き場（パレット）とカードの見出しに使う。
const BLOCK_LABELS = { assign: "代入", fill: "すべての値", print: "表示", if: "もし", for: "回数繰返し", while: "条件繰返し", comment: "コメント" };
const STATEMENT_ITEMS = [
  { type: "assign", kind: "assign", text: "x = 0" },
  { type: "fill", kind: "fill", text: "A のすべての値を 0 にする" },
  { type: "print", kind: "print", text: "表示する( )" },
  { type: "if", kind: "if", text: "○ ならば" },
  { type: "ifelse", kind: "if", text: "○ ならば ／ そうでなければ" },
  { type: "for", kind: "for", text: "i を 0 から 2 まで 1 ずつ増やしながら" },
  { type: "while", kind: "while", text: "○ の間繰り返す" },
  { type: "comment", kind: "comment", text: "# メモ" },
];
// 演算子は情報Ⅰ（共通テスト）の表記のまま表示し、意味と例を説明として添える。
const OPERATORS = [
  { op: "+", short: "たし算", help: "たし算。3 + 2 → 5", group: "calc" },
  { op: "-", short: "ひき算", help: "ひき算。3 - 2 → 1", group: "calc" },
  { op: "*", short: "かけ算（×）", help: "かけ算。算数の × です。3 * 2 → 6", group: "calc" },
  { op: "/", short: "わり算（÷）", help: "わり算。算数の ÷ です。7 / 2 → 3.5", group: "calc" },
  { op: "÷", short: "商（整数）", help: "わり算の商の整数部分。7 ÷ 2 → 3（算数の ÷ とは違い、小数にならない）", group: "calc" },
  { op: "%", short: "余り", help: "わり算の余り。7 % 2 → 1", group: "calc" },
  { op: "**", short: "べき乗", help: "べき乗。2 ** 3 → 8（2の3乗）", group: "calc" },
  { op: "==", short: "等しい", help: "左右が等しいとき真（算数の ＝）。3 == 3 → true", group: "logic" },
  { op: "!=", short: "等しくない", help: "左右が等しくないとき真（≠）。3 != 2 → true", group: "logic" },
  { op: "<", short: "より小さい", help: "左が右より小さいとき真。2 < 3 → true", group: "logic" },
  { op: "<=", short: "以下", help: "左が右以下のとき真（≦）。3 <= 3 → true", group: "logic" },
  { op: ">", short: "より大きい", help: "左が右より大きいとき真。3 > 2 → true", group: "logic" },
  { op: ">=", short: "以上", help: "左が右以上のとき真（≧）。3 >= 3 → true", group: "logic" },
  { op: "and", short: "かつ", help: "両方とも真のとき真。x > 0 and x < 10", group: "logic" },
  { op: "or", short: "または", help: "どちらかが真のとき真。x < 0 or x > 10", group: "logic" },
  { op: "not", short: "ではない", help: "真と偽を反対にする。not x == 0 は「x が 0 ではない」", group: "logic" },
];
const OPERATOR_INFO = Object.fromEntries(OPERATORS.map((item) => [item.op, item]));
const FUNCTION_ITEMS = [
  { name: "要素数", arity: 1 }, { name: "最大値", arity: 2 }, { name: "最小値", arity: 2 }, { name: "整数", arity: 1 },
  { name: "乱数", arity: 0 }, { name: "入力", arity: 0, text: "【外部からの入力】" },
];
const PALETTE_TABS = [
  { id: "statements", label: "命令" },
  { id: "calc", label: "計算" },
  { id: "logic", label: "条件" },
  { id: "functions", label: "関数・入力" },
];
const blockStacks = new WeakMap(); // .block-tree / .block-children 要素 → その中身の配列
const blockNodes = new WeakMap(); // .block-card 要素 → { node, nodes }
const exprSlots = new WeakMap(); // 式の入力欄・演算ブロック → { get, set, ctx }
let blockDrag = null;

function operatorLabel(item) {
  return item.op === "not" ? "not ○" : "○ " + item.op + " ○";
}

// 演算子の記号。マウスを重ねると説明が出る（タップ時は下の案内欄に出す）。
function operatorWord(op) {
  return el("span", { className: "block-word rb-op", attrs: { title: op + " … " + OPERATOR_INFO[op].help } }, op);
}

function makeBlock(type) {
  if (type === "assign") return { type, target: { type: "variable", name: "x", line: 1 }, expression: "0", line: 1 };
  if (type === "print") return { type, argsText: ['"こんにちは"'], args: [], line: 1 };
  if (type === "if" || type === "ifelse") return { type: "if", condition: "x == 1", then: [], otherwise: [], showElse: type === "ifelse", line: 1 };
  if (type === "for") return { type, name: "i", start: "0", end: "2", step: "1", body: [], line: 1 };
  if (type === "fill") return { type, name: "A", expression: "0", line: 1 };
  if (type === "comment") return { type, text: " メモ", line: 1 };
  return { type: "while", condition: "x < 3", body: [], line: 1 };
}

function commitBlockTree(rerender = false) {
  // 構造を変えたときは、式が未完成でも画面を配列に合わせる。
  if (rerender) renderBlockTree();
  const source = programToSource(state.blockAst);
  try {
    parseProgram(source);
    state.blocksValid = true;
    $("blocks-message").textContent = "ブロックとコードは同期しています。";
    $("blocks-message").className = "muted blocks-message";
    if (source !== code.value) setCode(source);
    return true;
  } catch (error) {
    state.blocksValid = false;
    clearTrace();
    const blank = [...$("block-tree").querySelectorAll(".rb-leaf")].some((field) => !field.value.trim());
    $("blocks-message").textContent = blank ? "「?」の空欄に値を入れてください。" : "入力中の式を確認してください。 " + error.line + "行目: " + error.message;
    $("blocks-message").className = "blocks-message error-message";
    return false;
  }
}

// 全角は2文字分として、入力欄の幅を中身に合わせる。
function fitBlockField(field) {
  const width = [...field.value].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  field.style.width = `calc(${Math.max(width, 1) + 1}ch + 22px)`;
}

function blockInput(label, value, onInput) {
  const field = el("input", { className: "block-field", type: "text", value, attrs: { "aria-label": label, autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false" } });
  fitBlockField(field);
  field.addEventListener("input", () => {
    fitBlockField(field);
    onInput(field.value);
  });
  return field;
}

function editBlockField(label, value, update) {
  return blockInput(label, value, (text) => { update(text); commitBlockTree(false); });
}

function blockWord(text) {
  return el("span", { className: "block-word" }, text);
}

// 演算を含まない値（変数、数、文字列、Data[i]、要素数(A) など）は1つの入力欄で編集する。
function isSimpleExpression(node) {
  if (node.type === "unary") return node.op === "-" && node.value.type === "literal";
  if (node.type === "binary") return false;
  return [node.target, node.index, ...(node.args ?? []), ...(node.values ?? [])].every((child) => !child || isSimpleExpression(child));
}

function leafNode(text) {
  try { return parseExpressionText(text); } catch { return { type: "raw", text }; }
}

function renderExpression(node, set, ctx) {
  if (node.type === "raw" || isSimpleExpression(node)) {
    let current = node;
    const leaf = blockInput(ctx.label, node.type === "raw" ? node.text : expressionToSource(node), (text) => {
      current = leafNode(text);
      set(current);
      ctx.commit();
    });
    leaf.classList.add("rb-leaf");
    leaf.placeholder = "?";
    exprSlots.set(leaf, { get: () => current, set: (value) => { current = value; set(value); }, ctx });
    return leaf;
  }
  const pill = el("span", { className: "rb" });
  const part = (child, assign) => renderExpression(child, assign, ctx);
  if (node.type === "binary") {
    pill.dataset.op = node.op;
    pill.append(part(node.left, (value) => { node.left = value; }), operatorWord(node.op), part(node.right, (value) => { node.right = value; }));
  } else if (node.type === "unary") {
    if (node.op === "not") pill.dataset.op = "not";
    pill.append(node.op === "not" ? operatorWord("not") : blockWord("-"), part(node.value, (value) => { node.value = value; }));
  } else if (node.type === "call") {
    pill.append(blockWord(node.name + "("));
    node.args.forEach((arg, index) => {
      if (index) pill.append(blockWord(","));
      pill.append(part(arg, (value) => { node.args[index] = value; }));
    });
    pill.append(blockWord(")"));
  } else if (node.type === "index") {
    pill.append(part(node.target, (value) => { node.target = value; }), blockWord("["), part(node.index, (value) => { node.index = value; }), blockWord("]"));
  } else if (node.type === "array") {
    pill.append(blockWord("["));
    node.values.forEach((value, index) => {
      if (index) pill.append(blockWord(","));
      pill.append(part(value, (next) => { node.values[index] = next; }));
    });
    pill.append(blockWord("]"));
  }
  if (node.type === "binary" || node.type === "unary" || node.type === "call") {
    // 演算を外して、最初の値だけを残す。
    const remove = el("button", { className: "rb-remove", type: "button", attrs: { "aria-label": "この演算を外す" } }, "×");
    remove.addEventListener("click", () => {
      set(node.left ?? node.value ?? node.args[0] ?? { type: "raw", text: "" });
      ctx.commit();
      state.blockSelection = ctx.owner;
      commitBlockTree(true);
    });
    pill.append(remove);
  }
  exprSlots.set(pill, { get: () => node, set, ctx });
  return pill;
}

// 空欄のある式は文字列から読み直せないため、編集中の式の木をブロックに残しておく。
function expressionField(owner, key, label, text, update) {
  owner.exprTrees ??= {};
  const cached = owner.exprTrees[key];
  let tree = cached && expressionToSource(cached) === text ? cached : leafNode(text);
  owner.exprTrees[key] = tree;
  const ctx = { owner, label, commit: () => { owner.exprTrees[key] = tree; update(expressionToSource(tree)); commitBlockTree(false); } };
  return renderExpression(tree, (value) => { tree = value; }, ctx);
}

function wrapExpression(spec, node) {
  const empty = () => ({ type: "raw", text: "" });
  if (spec.op === "not") return { type: "unary", op: "not", value: node };
  if (spec.op) return { type: "binary", op: spec.op, left: node, right: empty() };
  if (!spec.arity) return { type: "call", name: spec.name, args: [] };
  return { type: "call", name: spec.name, args: spec.arity === 2 ? [node, empty()] : [node] };
}

function applyExpressionItem(spec, slot) {
  const info = exprSlots.get(slot);
  if (!info || !slot.isConnected) {
    showToast("先にブロックの式の入力欄（白い枠）をタップしてください。");
    return;
  }
  info.set(wrapExpression(spec, info.get()));
  info.ctx.commit();
  state.blockSelection = info.ctx.owner;
  commitBlockTree(true);
  const fields = $("block-stage").querySelector(".block-card.selected > .block-main")?.querySelectorAll(".rb-leaf") ?? [];
  [...fields].find((field) => !field.value)?.focus();
}

function removeBlock(nodes, index) {
  const node = nodes[index];
  const hasChildren = node.then?.length || node.otherwise?.length || node.body?.length;
  if (hasChildren && !window.confirm("中にあるブロックも削除しますか？")) return false;
  nodes.splice(index, 1);
  return true;
}

function addNodeButtons(container, nodes, index) {
  const actions = el("div", { className: "block-actions" });
  const up = el("button", { type: "button", attrs: { "aria-label": "ブロックを上へ" } }, "↑");
  const down = el("button", { type: "button", attrs: { "aria-label": "ブロックを下へ" } }, "↓");
  const remove = el("button", { type: "button", attrs: { "aria-label": "ブロックを削除" } }, "×");
  up.disabled = index === 0;
  down.disabled = index === nodes.length - 1;
  up.addEventListener("click", () => {
    [nodes[index - 1], nodes[index]] = [nodes[index], nodes[index - 1]];
    commitBlockTree(true);
  });
  down.addEventListener("click", () => {
    [nodes[index + 1], nodes[index]] = [nodes[index], nodes[index + 1]];
    commitBlockTree(true);
  });
  remove.addEventListener("click", () => { if (removeBlock(nodes, index)) commitBlockTree(true); });
  actions.append(up, down, remove);
  container.append(actions);
}

function addChildSection(parent, nodes, title) {
  const branch = el("div", { className: "block-children" });
  blockStacks.set(branch, nodes);
  if (state.blockSelection === nodes) branch.classList.add("selected");
  branch.append(el("div", { className: "block-label" }, title));
  nodes.forEach((node, index) => branch.append(renderBlockCard(node, nodes, index)));
  const add = el("button", { className: "block-add-child", type: "button" }, "＋ " + title + " に追加");
  add.addEventListener("click", () => {
    selectBlockTarget(branch);
    $("blocks-message").textContent = "上の置き場のブロックをタップすると「" + title + "」の最後に追加します。";
    $("blocks-message").className = "muted blocks-message";
  });
  branch.append(add);
  parent.append(branch);
}

function renderBlockCard(node, nodes, index) {
  const card = el("article", { className: "block-card", dataset: { kind: node.type } });
  if (state.blockSelection === node) card.classList.add("selected");
  blockNodes.set(card, { node, nodes });
  const main = el("div", { className: "block-main" });
  const handle = el("span", { className: "block-label", attrs: { title: "ドラッグで移動" } }, BLOCK_LABELS[node.type] || "ブロック");
  const line = el("div", { className: "block-line" });
  if (node.type === "assign") {
    const target = node.target.type === "variable" ? node.target.name : node.target.name + "[" + node.target.indexText + "]";
    line.append(editBlockField("代入先", target, (value) => {
      const indexed = value.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*\[([\s\S]+)\]$/u);
      node.target = indexed
        ? { type: "index", name: indexed[1], indexText: indexed[2].trim(), line: node.line }
        : { type: "variable", name: value.trim(), line: node.line };
    }), blockWord("="), expressionField(node, "expression", "代入する値", node.expression, (value) => { node.expression = value; }));
  } else if (node.type === "fill") {
    line.append(editBlockField("配列名", node.name, (value) => { node.name = value.trim(); }), blockWord("のすべての値を"),
      expressionField(node, "expression", "入れる値", node.expression, (value) => { node.expression = value; }), blockWord("にする"));
  } else if (node.type === "print") {
    line.append(blockWord("表示する("));
    node.argsText.forEach((text, argIndex) => {
      if (argIndex) line.append(blockWord(","));
      const field = expressionField(node, "arg" + argIndex, "表示する値", text, (value) => { node.argsText[argIndex] = value; });
      // 空にした値は、ほかに値があれば取り除く。
      if (field.matches("input")) field.addEventListener("change", () => {
        if (field.value.trim() || node.argsText.length < 2) return;
        node.argsText.splice(argIndex, 1);
        commitBlockTree(true);
      });
      line.append(field);
    });
    const more = el("button", { className: "block-more", type: "button", attrs: { "aria-label": "表示する値を増やす" } }, "＋");
    more.addEventListener("click", () => { node.argsText.push('""'); state.blockSelection = node; commitBlockTree(true); });
    line.append(blockWord(")"), more);
  } else if (node.type === "if") {
    line.append(expressionField(node, "condition", "条件", node.condition, (value) => { node.condition = value; }), blockWord("ならば"));
  } else if (node.type === "while") {
    line.append(expressionField(node, "condition", "条件", node.condition, (value) => { node.condition = value; }), blockWord("の間繰り返す"));
  } else if (node.type === "for") {
    const way = el("select", { className: "block-field block-select", attrs: { "aria-label": "増やすか減らすか" } });
    way.append(el("option", { value: "up" }, "増やし"), el("option", { value: "down" }, "減らし"));
    way.value = node.down ? "down" : "up";
    way.addEventListener("change", () => { node.down = way.value === "down"; commitBlockTree(false); });
    line.append(editBlockField("変数", node.name, (value) => { node.name = value.trim(); }), blockWord("を"),
      expressionField(node, "start", "はじめの値", node.start, (value) => { node.start = value; }), blockWord("から"),
      expressionField(node, "end", "おわりの値", node.end, (value) => { node.end = value; }), blockWord("まで"),
      expressionField(node, "step", "増やす量", node.step, (value) => { node.step = value; }), blockWord("ずつ"),
      way, blockWord("ながら繰り返す"));
  } else if (node.type === "comment") {
    line.append(editBlockField("コメント", node.text.trim(), (value) => { node.text = " " + value; }));
  }
  main.append(handle, line);
  addNodeButtons(main, nodes, index);
  main.addEventListener("pointerdown", (event) => beginBlockDrag(event, { node, nodes, element: card }));
  card.append(main);
  if (node.type === "if") {
    addChildSection(card, node.then, "ならば");
    if (node.otherwise.length || node.showElse) addChildSection(card, node.otherwise, "そうでなければ");
    else {
      const addElse = el("button", { className: "block-add-child", type: "button" }, "＋ そうでなければ を付ける");
      addElse.addEventListener("click", () => { node.showElse = true; commitBlockTree(true); });
      card.append(addElse);
    }
  } else if (node.type === "for" || node.type === "while") addChildSection(card, node.body, "繰返しの中");
  return card;
}

function renderBlockTree() {
  const tree = $("block-tree");
  tree.replaceChildren();
  blockStacks.set(tree, state.blockAst);
  tree.classList.toggle("selected", state.blockSelection === state.blockAst);
  state.blockAst.forEach((node, index) => tree.append(renderBlockCard(node, state.blockAst, index)));
  markTraceBlock();
}

function renderBlockPalette(tab = "statements") {
  const tabs = $("block-palette-tabs");
  tabs.replaceChildren(...PALETTE_TABS.map((item) => {
    const button = el("button", { type: "button", className: item.id === tab ? "tab active" : "tab", attrs: { "aria-pressed": String(item.id === tab) } }, item.label);
    button.addEventListener("click", () => renderBlockPalette(item.id));
    return button;
  }));
  let items;
  if (tab === "statements") items = STATEMENT_ITEMS.map((item) => ({ spec: { type: item.type }, kind: item.kind, label: BLOCK_LABELS[item.kind], text: item.text }));
  else if (tab === "functions") items = FUNCTION_ITEMS.map((item) => ({ spec: item, text: item.text ?? item.name + "(" + (item.arity === 2 ? "○, ○" : item.arity ? "○" : "") + ")" }));
  else items = OPERATORS.filter((item) => item.group === tab).map((item) => ({ spec: item, text: operatorLabel(item), note: item.short, help: item.op + " … " + item.help }));
  $("block-palette-items").replaceChildren(...items.map(({ spec, kind, label, text, note, help }) => {
    const button = el("button", { type: "button", className: kind ? "palette-block" : "palette-block palette-reporter", dataset: kind ? { kind } : {} });
    if (help) button.title = help;
    if (label) button.append(el("b", {}, label));
    button.append(blockWord(text));
    if (note) button.append(el("small", { className: "palette-note" }, note));
    button.addEventListener("pointerdown", (event) => beginBlockDrag(event, { spec, element: button }));
    button.addEventListener("click", () => {
      if (performance.now() - state.blockDragEnd < 400) return;
      if (spec.type) addBlockAt(spec.type, blockInsertionPoint());
      else applyExpressionItem(spec, state.exprTarget);
    });
    return button;
  }));
}

// タップで選んだブロックの後ろ、または選んだ「中」の末尾。未選択ならプログラムの末尾。
function blockInsertionPoint() {
  const selected = $("block-stage").querySelector(".selected");
  if (selected && blockStacks.has(selected)) {
    const nodes = blockStacks.get(selected);
    return { nodes, index: nodes.length };
  }
  if (selected && blockNodes.has(selected)) {
    const { node, nodes } = blockNodes.get(selected);
    return { nodes, index: nodes.indexOf(node) + 1 };
  }
  return { nodes: state.blockAst, index: state.blockAst.length };
}

function addBlockAt(type, { nodes, index }) {
  const node = makeBlock(type);
  nodes.splice(index, 0, node);
  state.blockSelection = node;
  commitBlockTree(true);
  $("block-stage").querySelector(".block-card.selected")?.scrollIntoView({ block: "nearest" });
}

function selectBlockTarget(target) {
  $("block-stage").querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
  target.classList.add("selected");
  state.blockSelection = blockNodes.get(target)?.node ?? blockStacks.get(target);
}

function setExpressionTarget(slot) {
  $("block-stage").querySelectorAll(".rb.active").forEach((item) => item.classList.remove("active"));
  state.exprTarget = slot;
  const pill = slot?.classList.contains("rb") ? slot : slot?.parentElement.closest(".rb");
  pill?.classList.add("active");
  // タッチでは title が見えないので、選んだ演算の説明を案内欄に出す。
  const info = OPERATOR_INFO[pill?.dataset.op];
  if (info && state.blocksValid) {
    $("blocks-message").textContent = info.op + " … " + info.help;
    $("blocks-message").className = "muted blocks-message";
  }
}

function beginBlockDrag(event, source) {
  if (blockDrag || event.button > 0 || event.target.closest("input, select, .block-actions, .block-add-child, .block-more, .rb-remove")) return;
  blockDrag = { ...source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
}

function blockDropTarget(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  if (hit.closest("#block-palette")) return { remove: true };
  if (!hit.closest("#block-stage")) return null;
  if (blockDrag.spec && !blockDrag.spec.type) {
    const slot = hit.closest(".rb-leaf, .rb");
    return slot && exprSlots.has(slot) ? { slot } : null;
  }
  const stack = hit.closest(".block-children, .block-tree") ?? $("block-tree");
  // 自分の中へは入れられない（入れ子が循環するため）
  if (blockDrag.element.contains(stack)) return null;
  const cards = [...stack.children].filter((child) => blockNodes.has(child));
  let index = cards.findIndex((child) => {
    const rect = child.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  if (index < 0) index = cards.length;
  return { stack, nodes: blockStacks.get(stack), index, before: cards[index] ?? null, last: cards.at(-1) ?? null };
}

function showDropMarker(target) {
  const marker = $("block-drop-marker");
  $("block-palette").classList.toggle("trash", Boolean(target?.remove && blockDrag?.node));
  $("block-stage").querySelectorAll(".drop-target").forEach((item) => item.classList.remove("drop-target"));
  if (target?.slot) target.slot.classList.add("drop-target");
  if (!target?.stack) { marker.hidden = true; return; }
  const stackRect = target.stack.getBoundingClientRect();
  const top = target.before ? target.before.getBoundingClientRect().top - 5
    : target.last ? target.last.getBoundingClientRect().bottom + 2
    : stackRect.top + 4;
  marker.hidden = false;
  marker.style.left = stackRect.left + 8 + "px";
  marker.style.width = Math.max(stackRect.width - 16, 60) + "px";
  marker.style.top = top + "px";
}

function moveBlockDrag(event) {
  if (!blockDrag || event.pointerId !== blockDrag.pointerId) return;
  if (!blockDrag.ghost) {
    if (Math.hypot(event.clientX - blockDrag.x, event.clientY - blockDrag.y) < 8) return;
    const rect = blockDrag.element.getBoundingClientRect();
    blockDrag.dx = Math.min(blockDrag.x - rect.left, 60);
    blockDrag.dy = Math.min(blockDrag.y - rect.top, 30);
    blockDrag.ghost = blockDrag.element.cloneNode(true);
    blockDrag.ghost.classList.remove("selected");
    blockDrag.ghost.classList.add("block-ghost");
    blockDrag.ghost.style.width = Math.min(rect.width, 420) + "px";
    document.body.append(blockDrag.ghost);
    if (blockDrag.node) blockDrag.element.classList.add("block-dragging");
  }
  event.preventDefault();
  blockDrag.ghost.style.left = event.clientX - blockDrag.dx + "px";
  blockDrag.ghost.style.top = event.clientY - blockDrag.dy + "px";
  // 端に近づいたら作業場をスクロールする
  const stage = $("block-stage");
  const area = stage.getBoundingClientRect();
  if (event.clientY < area.top + 40 && event.clientY > area.top - 10) stage.scrollTop -= 16;
  else if (event.clientY > area.bottom - 40) stage.scrollTop += 16;
  showDropMarker(blockDropTarget(event.clientX, event.clientY));
}

function endBlockDrag(event) {
  if (!blockDrag || event.pointerId !== blockDrag.pointerId) return;
  const drag = blockDrag;
  const target = drag.ghost && event.type === "pointerup" ? blockDropTarget(event.clientX, event.clientY) : null;
  showDropMarker(null);
  blockDrag = null;
  if (!drag.ghost) return; // 動かしていなければタップとして扱う
  drag.ghost.remove();
  drag.element.classList.remove("block-dragging");
  state.blockDragEnd = performance.now();
  if (!target) return;
  if (target.slot) { applyExpressionItem(drag.spec, target.slot); return; }
  if (target.remove) {
    if (drag.node && removeBlock(drag.nodes, drag.nodes.indexOf(drag.node))) commitBlockTree(true);
    return;
  }
  let { index } = target;
  let node = drag.node;
  if (node) {
    const from = drag.nodes.indexOf(node);
    drag.nodes.splice(from, 1);
    if (drag.nodes === target.nodes && from < index) index -= 1;
  } else node = makeBlock(drag.spec.type);
  target.nodes.splice(index, 0, node);
  state.blockSelection = node;
  commitBlockTree(true);
}

function switchToBlocks() {
  try {
    state.blockAst = parseProgram(code.value);
    state.blocksValid = true;
    state.blockSelection = null;
    $("blocks-message").textContent = "ブロックを置き場からドラッグして積もう。タップで選んだ位置にも追加できます。";
    $("blocks-message").className = "muted blocks-message";
    $("code-view").hidden = true;
    $("blocks-view").hidden = false;
    $("code-mode").classList.remove("active");
    $("blocks-mode").classList.add("active");
    $("code-mode").setAttribute("aria-pressed", "false");
    $("blocks-mode").setAttribute("aria-pressed", "true");
    updateModeActions();
    renderBlockTree();
  } catch (error) {
    showToast(error.line + "行目: " + error.message + " コードは変更していません。");
  }
}

// コードの履歴をたどったあと、ブロック表示を同じ内容に合わせる。
function refreshBlocksFromCode() {
  if ($("blocks-view").hidden) return;
  try {
    state.blockAst = parseProgram(code.value);
    state.blocksValid = true;
    renderBlockTree();
    $("blocks-message").textContent = "ブロックとコードは同期しています。";
    $("blocks-message").className = "muted blocks-message";
  } catch (error) {
    state.blocksValid = true;
    switchToCode();
    showToast(error.line + "行目: " + error.message + " コード表示で直してください。");
  }
}

function switchToCode() {
  if (!state.blocksValid) {
    showToast("ブロックの入力エラーを直してからコードに戻してください。");
    return;
  }
  $("blocks-view").hidden = true;
  $("code-view").hidden = false;
  $("blocks-mode").classList.remove("active");
  $("code-mode").classList.add("active");
  $("blocks-mode").setAttribute("aria-pressed", "false");
  $("code-mode").setAttribute("aria-pressed", "true");
  updateModeActions();
  code.focus();
}

function renderLessonList(filter = "all") {
  const list = $("lesson-list");
  list.replaceChildren();
  lessons.filter((lesson) => filter === "all" || lesson.kind === filter).forEach((lesson) => {
    const card = el("article", { className: "lesson-card" });
    card.append(el("h3", {}, lesson.title));
    const meta = el("div", { className: "lesson-meta" });
    meta.append(el("span", { className: "lesson-chip" }, lesson.year), el("span", { className: "lesson-chip" }, lesson.level));
    if (lesson.arrayBase === 1) meta.append(el("span", { className: "lesson-chip" }, "添字は1から（問題文指定）"));
    lesson.tags.forEach((tag) => meta.append(el("span", { className: "lesson-chip" }, tag)));
    card.append(meta, el("p", {}, lesson.prompt), el("p", {}, lesson.explanation), el("p", {}, lesson.rationale));
    const source = el("p", { className: "lesson-source" });
    source.append(document.createTextNode("出典: "));
    const link = el("a", { href: lesson.sourceUrl, target: "_blank", rel: "noopener noreferrer" }, lesson.sourceLabel);
    source.append(link);
    card.append(source);
    const reveal = el("details");
    reveal.append(el("summary", {}, "コード・期待出力・解説を見る"));
    reveal.append(el("pre", {}, lesson.code));
    reveal.append(el("p", { className: "lesson-source" }, "期待出力:"));
    reveal.append(el("pre", {}, lesson.expected));
    reveal.append(el("p", {}, lesson.answer));
    card.append(reveal);
    const actions = el("div", { className: "lesson-actions" });
    const load = el("button", { className: "primary-button", type: "button" }, "エディターに追加");
    load.addEventListener("click", () => {
      if (!replaceDocument({
        title: lesson.title,
        lessonId: lesson.id,
        code: lesson.code,
        inputValues: lesson.input.join("\n"),
        prediction: "",
        skipPrediction: false,
        arrayBase: lesson.arrayBase ?? 0,
      }, lesson.title)) return;
      $("lesson-dialog").close();
      showToast("「" + lesson.title + "」を追加しました。");
    });
    actions.append(load);
    card.append(actions);
    list.append(card);
  });
}

function validateImport(value) {
  if (!value || typeof value !== "object" || value.version !== 1 || typeof value.code !== "string") return null;
  if (value.code.length > runtimeLimits.sourceLength) return null;
  if (typeof value.title !== "string" || value.title.length > 80) return null;
  if (typeof value.inputValues !== "string" || value.inputValues.length > 20_000) return null;
  if (typeof value.prediction !== "string" || value.prediction.length > 20_000) return null;
  if (value.arrayBase !== 0 && value.arrayBase !== 1) return null;
  if (typeof value.skipPrediction !== "boolean") return null;
  return value;
}

function exportProgram() {
  if (!$("blocks-view").hidden && !state.blocksValid) {
    showToast("ブロックの式を直してから書き出してください。");
    return;
  }
  const data = currentState();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: (data.title || "program").replace(/[\\/:*?"<>|]/gu, "_") + ".json" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("JSONファイルを書き出しました。");
}

async function openProgramFile(file) {
  if (!file) return;
  if (file.size > 100_000) { showToast("ファイルが大きすぎます。100KB以下のJSONを選んでください。"); return; }
  try {
    const parsed = JSON.parse(await file.text());
    const data = validateImport(parsed);
    if (!data) { showToast("このファイル形式には対応していません。現在の内容は変更していません。"); return; }
    if (replaceDocument(data, "ファイルを開く")) showToast("ファイルを開きました。");
  } catch {
    showToast("JSONを読み取れません。現在の内容は変更していません。");
  } finally {
    $("open-file").value = "";
  }
}

function parseInputValues() {
  const raw = $("input-values").value;
  if (raw === "") return [];
  return raw.replace(/\r\n?/gu, "\n").split("\n");
}

function normalizeOutput(value) {
  return value.replace(/\r\n?/gu, "\n").replace(/\s+$/u, "");
}

function switchResult(name) {
  document.querySelectorAll("[data-result]").forEach((tab) => {
    const active = tab.dataset.result === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".result-view").forEach((view) => {
    const active = view.dataset.view === name;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  if (name === "trace") renderTraceTable();
}

function addRunRecord(result) {
  state.records.unshift({
    title: $("program-title").value || "新しいプログラム",
    at: new Date().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }),
    output: result.output.slice(0, 400),
    error: result.error ? result.error.line + "行目: " + result.error.message : "",
  });
  state.records = state.records.slice(0, 10);
  renderRecords();
  scheduleSave();
}

function renderRecords() {
  const list = $("run-records");
  list.replaceChildren();
  if (!state.records.length) {
    list.append(el("li", { className: "muted" }, "まだ実行記録はありません。"));
    return;
  }
  state.records.forEach((record) => {
    const item = el("li");
    const summary = el("strong", {}, record.title + " ・ " + record.at);
    item.append(summary, el("br"));
    item.append(el("span", { className: record.error ? "error-text" : "" }, record.error || record.output || "出力なし"));
    list.append(item);
  });
}

function executeProgram() {
  if (!$("blocks-view").hidden && !state.blocksValid) {
    showToast("ブロックの入力エラーを直してから実行してください。");
    return;
  }
  clearInterval(state.playTimer);
  state.playTimer = null;
  try {
    const result = runProgram(code.value, {
      arrayBase: Number($("array-base").value),
      inputValues: parseInputValues(),
    });
    state.trace = result.trace;
    state.traceIndex = state.trace.length ? 0 : -1;
    state.currentOutput = result.output;
    $("result-dot").classList.toggle("has-output", Boolean(result.output || result.error));
    const outputText = result.output || "（出力はありません）";
    $("output").textContent = result.error
      ? "エラー: " + result.error.line + "行目\n" + result.error.message + (result.output ? "\n\nここまでの出力:\n" + result.output : "")
      : outputText;
    const prediction = $("prediction").value;
    const comparison = $("comparison");
    comparison.className = "comparison";
    if (result.error) comparison.textContent = "エラーを確認して修正してください。";
    else if ($("skip-prediction").checked) comparison.textContent = "予想を省略して実行しました。";
    else if (!prediction.trim()) comparison.textContent = "出力を予想欄に書くと、実行結果と比較できます。";
    else if (normalizeOutput(prediction) === normalizeOutput(result.output)) {
      comparison.textContent = "予想どおりです。";
      comparison.classList.add("match");
    } else {
      comparison.textContent = "予想と実行結果が異なります。";
      comparison.classList.add("mismatch");
    }
    $("trace-controls").hidden = state.trace.length === 0;
    $("trace-next").disabled = state.trace.length <= 1;
    $("trace-play").disabled = state.trace.length <= 1;
    $("trace-pause").disabled = true;
    $("trace-position").textContent = state.trace.length ? "0 / " + state.trace.length + " 件" : "記録できる処理がありません";
    if (state.trace.length) renderTraceStep(0, false);
    renderTraceTable();
    switchResult("result");
    addRunRecord(result);
  } catch (error) {
    const failure = error instanceof ProgramError ? error : new ProgramError("プログラムを読み取れません。", 1);
    $("output").textContent = "エラー: " + failure.line + "行目\n" + failure.message;
    $("comparison").textContent = "コードを確認してください。";
    $("comparison").className = "comparison mismatch";
    $("trace-controls").hidden = true;
    clearTrace();
    showAssist("help");
    switchResult("result");
    showToast(failure.line + "行目: " + failure.message);
  }
}

function openDialog(id) {
  const dialog = $(id);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function renderInitialState() {
  const saved = readSavedState();
  const initial = saved || {
    code: defaultCode,
    title: "配列の合計を求める",
    inputValues: "",
    prediction: "",
    skipPrediction: false,
    arrayBase: 0,
    records: [],
  };
  $("program-title").value = initial.title;
  $("input-values").value = initial.inputValues;
  $("prediction").value = initial.prediction;
  $("skip-prediction").checked = initial.skipPrediction;
  $("array-base").value = String(initial.arrayBase);
  code.value = initial.code;
  state.records = initial.records;
  state.currentLessonId = initial.lessonId || null;
  renderLessonContext();
  updateLineNumbers();
  resetHistory();
  renderRecords();
  renderLessonList();
  renderPalette();
  renderBlockPalette();
  updateRunButtonState();
  switchToBlocks();
}

code.addEventListener("input", () => {
  updateLineNumbers();
  scheduleHistory();
  scheduleSave();
  clearTrace();
});
code.addEventListener("scroll", () => { $("line-numbers").scrollTop = code.scrollTop; });
$("blocks-view").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    executeProgram();
  }
});
code.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    insertAtCursor("  ");
  } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    executeProgram();
  }
});

$("program-title").addEventListener("input", scheduleSave);
$("input-values").addEventListener("input", scheduleSave);
$("prediction").addEventListener("input", scheduleSave);
$("skip-prediction").addEventListener("change", scheduleSave);
$("array-base").addEventListener("change", () => { clearTrace(); scheduleSave(); });
// 添字の説明: タップで開閉し、外側のタップやEscで閉じる
function setIndexInfo(open) {
  $("index-info").closest(".info-tip").classList.toggle("open", open);
  $("index-info").setAttribute("aria-expanded", String(open));
}
$("index-info").addEventListener("click", () => setIndexInfo($("index-info").getAttribute("aria-expanded") !== "true"));
document.addEventListener("click", (event) => { if (!event.target.closest(".info-tip")) setIndexInfo(false); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setIndexInfo(false); });
$("run-button").addEventListener("click", executeProgram);
$("code-mode").addEventListener("click", switchToCode);
$("blocks-mode").addEventListener("click", switchToBlocks);
$("block-stage").addEventListener("click", (event) => {
  if (performance.now() - state.blockDragEnd < 400 || event.target.closest("button, select")) return;
  const pill = event.target.closest(".rb");
  if (!event.target.closest("input")) setExpressionTarget(pill);
  selectBlockTarget(event.target.closest(".block-card, .block-children") ?? $("block-tree"));
});
$("block-stage").addEventListener("focusin", (event) => {
  if (!event.target.matches("input, select")) return;
  if (event.target.matches("input")) state.lastBlockField = event.target;
  setExpressionTarget(event.target.classList.contains("rb-leaf") ? event.target : null);
  const card = event.target.closest(".block-card");
  if (card && !card.classList.contains("selected")) selectBlockTarget(card);
});
window.addEventListener("pointermove", moveBlockDrag, { passive: false });
window.addEventListener("pointerup", endBlockDrag);
window.addEventListener("pointercancel", endBlockDrag);
$("tab-block-palette").addEventListener("click", () => showAssist("palette"));
$("tab-input-help").addEventListener("click", () => showAssist("help"));
document.querySelectorAll("[data-result]").forEach((tab) => tab.addEventListener("click", () => switchResult(tab.dataset.result)));
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  button.closest("details")?.removeAttribute("open");
  const action = button.dataset.action;
  if (action === "new") {
    replaceDocument({ code: "", title: "新しいプログラム", inputValues: "", prediction: "", skipPrediction: false, arrayBase: 0 }, "新規作成");
  } else if (action === "lessons") openDialog("lesson-dialog");
  else if (action === "open") $("open-file").click();
  else if (action === "paste") {
    try {
      const text = await navigator.clipboard.readText();
      if (text.includes("\n") && !$("blocks-view").hidden) switchToCode();
      if (text) insertAtCursor(text);
      else showToast("クリップボードにテキストがありません。");
    } catch {
      showToast("貼り付けを許可できませんでした。コード欄で長押しして貼り付けてください。");
    }
  } else if (action === "save") saveState(true);
  else if (action === "export") exportProgram();
  else if (action === "undo") {
    commitHistory();
    if (state.historyIndex > 0) { state.historyIndex -= 1; setCode(state.history[state.historyIndex], { history: false }); refreshBlocksFromCode(); }
  } else if (action === "redo") {
    commitHistory();
    if (state.historyIndex < state.history.length - 1) { state.historyIndex += 1; setCode(state.history[state.historyIndex], { history: false }); refreshBlocksFromCode(); }
  } else if (action === "duplicate") transformSelectedLines("duplicate");
  else if (action === "delete") transformSelectedLines("delete");
  else if (action === "move-up") transformSelectedLines("up");
  else if (action === "move-down") transformSelectedLines("down");
  else if (action === "indent") transformSelectedLines("indent");
  else if (action === "outdent") transformSelectedLines("outdent");
}));
$("open-file").addEventListener("change", (event) => openProgramFile(event.target.files?.[0]));
$("clear-records").addEventListener("click", () => {
  if (!state.records.length || !window.confirm("この端末に保存した実行記録を消去しますか？")) return;
  state.records = [];
  renderRecords();
  scheduleSave();
});
$("help-button").addEventListener("click", () => openDialog("help-dialog"));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
document.querySelectorAll("[data-lesson-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-lesson-filter]").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderLessonList(button.dataset.lessonFilter);
}));
$("trace-play").addEventListener("click", runTrace);
$("trace-pause").addEventListener("click", () => {
  clearInterval(state.playTimer);
  state.playTimer = null;
  $("trace-pause").disabled = true;
  $("trace-play").disabled = state.traceIndex >= state.trace.length - 1;
});
$("trace-next").addEventListener("click", () => renderTraceStep(state.traceIndex + 1));

renderInitialState();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

