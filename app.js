import { ProgramError, parseProgram, programToSource, runProgram, runtimeLimits } from "./runtime.js";
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
  history: [],
  historyIndex: -1,
  historyTimer: null,
  saveTimer: null,
  toastTimer: null,
  playTimer: null,
  currentOutput: "",
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
    return {
      code: saved.code,
      title: typeof saved.title === "string" ? saved.title.slice(0, 80) : "新しいプログラム",
      inputValues: typeof saved.inputValues === "string" ? saved.inputValues.slice(0, 20_000) : "",
      prediction: typeof saved.prediction === "string" ? saved.prediction.slice(0, 20_000) : "",
      skipPrediction: saved.skipPrediction === true,
      arrayBase: saved.arrayBase === 0 ? 0 : 1,
      records: Array.isArray(saved.records) ? saved.records.slice(0, 10) : [],
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

function scheduleHistory() {
  clearTimeout(state.historyTimer);
  state.historyTimer = setTimeout(() => {
    const value = code.value;
    if (state.history[state.historyIndex] === value) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(value);
    if (state.history.length > 100) state.history.shift();
    state.historyIndex = state.history.length - 1;
  }, 400);
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
  $("blocks-view").hidden = true;
  $("code-view").hidden = false;
  $("blocks-mode").classList.remove("active");
  $("code-mode").classList.add("active");
  $("blocks-mode").setAttribute("aria-pressed", "false");
  $("code-mode").setAttribute("aria-pressed", "true");
  $("program-title").value = data.title || "新しいプログラム";
  $("input-values").value = data.inputValues || "";
  $("prediction").value = data.prediction || "";
  $("skip-prediction").checked = data.skipPrediction === true;
  $("array-base").value = String(data.arrayBase === 0 ? 0 : 1);
  setCode(data.code || "", { history: false, save: false });
  resetHistory();
  if (!saveState(false)) showToast("この端末への保存に失敗しました。ページを閉じる前に書き出してください。");
  return true;
}

function insertAtCursor(text) {
  if (!$("blocks-view").hidden) {
    switchToCode();
    if (!$("blocks-view").hidden) return;
  }
  if (document.activeElement !== code) code.setSelectionRange(code.value.length, code.value.length);
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
  if ($("tab-trace-help").getAttribute("aria-selected") === "true") renderAssist("trace");
}

function formatVariable(value) {
  if (Array.isArray(value)) return "[" + value.map(formatVariable).join(", ") + "]";
  if (typeof value === "string") return "\"" + value + "\"";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function renderTraceTable() {
  const content = $("assist-content");
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
  $("trace-position").textContent = (state.traceIndex + 1) + " / " + state.trace.length + " 件 ・ " + row.line + "行目";
  $("trace-next").disabled = state.traceIndex >= state.trace.length - 1;
  $("trace-play").disabled = state.traceIndex >= state.trace.length - 1;
  $("trace-pause").disabled = !state.playTimer;
  if (updateOutput) $("output").textContent = row.output || "（この時点ではまだ出力がありません）";
  if ($("tab-trace-help").getAttribute("aria-selected") === "true") renderTraceTable();
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
  if (name === "trace") renderTraceTable();
  else if (name === "help") renderInputHelp();
  else renderPalette();
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
  content.append(el("p", { className: "assist-note" }, "ボタンを押すと、選択中のカーソル位置に入力します。"));
  appendPaletteGroup(content, "変数・配列", [
    { label: "x = 0", value: "x = 0" },
    { label: "配列 = []", value: "配列 = []" },
    { label: "配列[1]", value: "配列[1]" },
  ]);
  appendPaletteGroup(content, "演算子", ["+", "-", "*", "/", "%", "**", "==", "!=", "<", "<=", ">", ">=", "and", "or", "not"].map((value) => ({ label: value, value: " " + value + " " })));
  appendPaletteGroup(content, "関数・表示", [
    { label: "表示する()", value: "表示する()" },
    { label: "要素数()", value: "要素数()" },
    { label: "最大値()", value: "最大値()" },
    { label: "最小値()", value: "最小値()" },
    { label: "整数()", value: "整数()" },
    { label: "乱数()", value: "乱数()" },
    { label: "入力()", value: "入力()" },
  ]);
  appendPaletteGroup(content, "制御", [
    { label: "もし", value: "もし 条件 ならば:\n  \n" },
    { label: "繰返し", value: "i を 1 から 3 まで 1 ずつ増やしながら繰り返す:\n  \n" },
    { label: "条件繰返し", value: "条件 の間繰り返す:\n  \n" },
  ]);
}

function renderInputHelp() {
  const content = $("assist-content");
  content.replaceChildren();
  content.append(el("p", { className: "assist-note" }, "実行時に読む値は、下の「入力」タブに1行ずつ入力します。"));
  const button = el("button", { type: "button", className: "primary-button" }, "入力() を挿入");
  button.addEventListener("click", () => insertAtCursor("入力()"));
  content.append(button);
  const note = el("div", { className: "palette-group" });
  note.append(el("div", { className: "palette-name" }, "入力順"));
  note.append(el("div", { className: "palette-items" }, "上の行から順に読みます。数値は数値として、それ以外は文字列として扱います。値が不足すると、その行で停止します。"));
  content.append(note);
  const funcs = el("div", { className: "palette-group" });
  funcs.append(el("div", { className: "palette-name" }, "関数"));
  funcs.append(el("div", { className: "palette-items" }, "要素数(A) ・ 最大値(a, b) ・ 最小値(a, b) ・ 整数(x) ・ 乱数()（0以上1未満）"));
  content.append(funcs);
}

function makeBlock(type) {
  if (type === "assign") return { type, target: { type: "variable", name: "x", line: 1 }, expression: "0", line: 1 };
  if (type === "print") return { type, argsText: ['"こんにちは"'], args: [], line: 1 };
  if (type === "if") return { type, condition: "x == 1", then: [], otherwise: [], line: 1 };
  if (type === "for") return { type, name: "i", start: "1", end: "3", step: "1", body: [], line: 1 };
  return { type: "while", condition: "x < 3", body: [], line: 1 };
}

function commitBlockTree(rerender = false) {
  const source = programToSource(state.blockAst);
  try {
    parseProgram(source);
    state.blocksValid = true;
    $("blocks-message").textContent = "ブロックとコードは同期しています。";
    $("blocks-message").className = "muted blocks-message";
    if (source !== code.value) setCode(source);
    if (rerender) renderBlockTree();
    return true;
  } catch (error) {
    state.blocksValid = false;
    $("blocks-message").textContent = "入力中の式を確認してください。 " + error.line + "行目: " + error.message;
    $("blocks-message").className = "blocks-message error-message";
    return false;
  }
}

function editBlockField(node, label, value, update) {
  const field = el("input", { className: "block-field", type: "text", value, attrs: { "aria-label": label } });
  field.addEventListener("input", () => {
    update(field.value);
    commitBlockTree(false);
  });
  return field;
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
  remove.addEventListener("click", () => {
    const node = nodes[index];
    const hasChildren = (node.then?.length || node.otherwise?.length || node.body?.length);
    if (hasChildren && !window.confirm("中にあるブロックも削除しますか？")) return;
    nodes.splice(index, 1);
    commitBlockTree(true);
  });
  actions.append(up, down, remove);
  container.append(actions);
}

function addChildSection(parent, nodes, title) {
  const branch = el("div", { className: "block-children" });
  branch.append(el("div", { className: "block-label" }, title));
  nodes.forEach((node, index) => branch.append(renderBlockCard(node, nodes, index)));
  const add = el("button", { className: "block-add-child", type: "button" }, "＋ " + title + " にブロック");
  add.addEventListener("click", () => {
    nodes.push(makeBlock($("new-block-type").value));
    commitBlockTree(true);
  });
  branch.append(add);
  parent.append(branch);
}

function renderBlockCard(node, nodes, index) {
  const card = el("article", { className: "block-card", dataset: { kind: node.type } });
  const main = el("div", { className: "block-main" });
  const labels = { assign: "代入", print: "表示", if: "条件分岐", for: "回数繰返し", while: "条件繰返し" };
  main.append(el("span", { className: "block-label" }, labels[node.type] || "ブロック"));
  if (node.type === "assign") {
    const target = node.target.type === "variable" ? node.target.name : node.target.name + "[" + node.target.indexText + "]";
    const fields = el("div", { className: "block-fields" });
    fields.append(editBlockField(node, "代入先", target, (value) => {
      const indexed = value.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*\[([\s\S]+)\]$/u);
      node.target = indexed
        ? { type: "index", name: indexed[1], indexText: indexed[2].trim(), line: node.line }
        : { type: "variable", name: value.trim(), line: node.line };
    }));
    fields.append(el("span", { className: "block-equals" }, "="));
    fields.append(editBlockField(node, "代入する式", node.expression, (value) => { node.expression = value; }));
    main.append(fields);
  } else if (node.type === "print") {
    main.append(editBlockField(node, "表示する値", node.argsText.join(", "), (value) => { node.argsText = [value]; }));
  } else if (node.type === "if" || node.type === "while") {
    main.append(editBlockField(node, "条件式", node.condition, (value) => { node.condition = value; }));
  } else if (node.type === "for") {
    const header = node.name + " を " + node.start + " から " + node.end + " まで " + node.step + " ずつ";
    main.append(editBlockField(node, "繰返しの範囲", header, (value) => {
      const match = value.match(/^([\p{L}_][\p{L}\p{N}_]*)\s+を\s+(.+?)\s+から\s+(.+?)\s+まで\s+(.+?)\s+ずつ$/u);
      if (match) { node.name = match[1]; node.start = match[2]; node.end = match[3]; node.step = match[4]; }
      else node.name = value;
    }));
  }
  addNodeButtons(main, nodes, index);
  card.append(main);
  if (node.type === "if") {
    addChildSection(card, node.then, "条件が真のとき");
    if (node.otherwise.length) addChildSection(card, node.otherwise, "そうでなければ");
    else {
      const addElse = el("button", { className: "block-add-child", type: "button" }, "＋ そうでなければ を追加");
      addElse.addEventListener("click", () => { node.otherwise = []; node.otherwise.push(makeBlock($("new-block-type").value)); commitBlockTree(true); });
      card.append(addElse);
    }
  } else if (node.type === "for" || node.type === "while") addChildSection(card, node.body, "繰返しの中");
  return card;
}

function renderBlockTree() {
  const tree = $("block-tree");
  tree.replaceChildren();
  state.blockAst.forEach((node, index) => tree.append(renderBlockCard(node, state.blockAst, index)));
  if (!state.blockAst.length) tree.append(el("p", { className: "muted" }, "ブロックを追加してプログラムを作れます。"));
}

function switchToBlocks() {
  try {
    state.blockAst = parseProgram(code.value);
    state.blocksValid = true;
    $("blocks-message").textContent = "対応している構文をブロックで編集できます。";
    $("blocks-message").className = "muted blocks-message";
    $("code-view").hidden = true;
    $("blocks-view").hidden = false;
    $("code-mode").classList.remove("active");
    $("blocks-mode").classList.add("active");
    $("code-mode").setAttribute("aria-pressed", "false");
    $("blocks-mode").setAttribute("aria-pressed", "true");
    renderBlockTree();
  } catch (error) {
    showToast(error.line + "行目: " + error.message + " コードは変更していません。");
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
        code: lesson.code,
        inputValues: lesson.input.join("\n"),
        prediction: "",
        skipPrediction: false,
        arrayBase: 1,
      }, lesson.title)) return;
      $("lesson-dialog").close();
      switchToCode();
      showAssist("palette");
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
    switchResult("result");
    showAssist("trace");
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
    arrayBase: 1,
    records: [],
  };
  $("program-title").value = initial.title;
  $("input-values").value = initial.inputValues;
  $("prediction").value = initial.prediction;
  $("skip-prediction").checked = initial.skipPrediction;
  $("array-base").value = String(initial.arrayBase);
  code.value = initial.code;
  state.records = initial.records;
  updateLineNumbers();
  resetHistory();
  renderRecords();
  renderLessonList();
  renderPalette();
  updateRunButtonState();
}

code.addEventListener("input", () => {
  updateLineNumbers();
  scheduleHistory();
  scheduleSave();
  clearTrace();
});
code.addEventListener("scroll", () => { $("line-numbers").scrollTop = code.scrollTop; });
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
$("run-button").addEventListener("click", executeProgram);
$("code-mode").addEventListener("click", switchToCode);
$("blocks-mode").addEventListener("click", switchToBlocks);
$("add-block").addEventListener("click", () => {
  if ($("blocks-view").hidden) switchToBlocks();
  if ($("blocks-view").hidden) return;
  state.blockAst.push(makeBlock($("new-block-type").value));
  commitBlockTree(true);
});
$("tab-block-palette").addEventListener("click", () => showAssist("palette"));
$("tab-input-help").addEventListener("click", () => showAssist("help"));
$("tab-trace-help").addEventListener("click", () => showAssist("trace"));
document.querySelectorAll("[data-result]").forEach((tab) => tab.addEventListener("click", () => switchResult(tab.dataset.result)));
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
  const action = button.dataset.action;
  if (action === "new") {
    if (replaceDocument({ code: "", title: "新しいプログラム", inputValues: "", prediction: "", skipPrediction: false, arrayBase: 1 }, "新規作成")) switchToCode();
  } else if (action === "lessons") openDialog("lesson-dialog");
  else if (action === "open") $("open-file").click();
  else if (action === "paste") {
    try {
      const text = await navigator.clipboard.readText();
      if (text) insertAtCursor(text);
      else showToast("クリップボードにテキストがありません。");
    } catch {
      showToast("貼り付けを許可できませんでした。コード欄で長押しして貼り付けてください。");
    }
  } else if (action === "save") saveState(true);
  else if (action === "export") exportProgram();
  else if (action === "undo") {
    clearTimeout(state.historyTimer);
    if (state.historyIndex > 0) { state.historyIndex -= 1; setCode(state.history[state.historyIndex], { history: false }); }
  } else if (action === "redo") {
    clearTimeout(state.historyTimer);
    if (state.historyIndex < state.history.length - 1) { state.historyIndex += 1; setCode(state.history[state.historyIndex], { history: false }); }
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

