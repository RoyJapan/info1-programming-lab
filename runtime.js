const LIMITS = Object.freeze({
  sourceLength: 20_000,
  nesting: 30,
  expressionDepth: 100,
  arrayLength: 1_000,
  steps: 10_000,
  outputLength: 20_000,
  traceRows: 2_000,
  traceCells: 100_000,
});

export class ProgramError extends Error {
  constructor(message, line = 1) {
    super(message);
    this.name = "ProgramError";
    this.line = line;
  }
}

function isLetter(char) { return /[\p{L}_]/u.test(char); }
function isWord(char) { return /[\p{L}\p{N}_]/u.test(char); }

function tokenizeExpression(source, line) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) { i += 1; continue; }
    const start = i;
    const ch = source[i];
    if (/\d/u.test(ch) || (ch === "." && /\d/u.test(source[i + 1] ?? ""))) {
      i += 1;
      while (i < source.length && /[\d.]/u.test(source[i])) i += 1;
      const raw = source.slice(start, i);
      if (!/^\d+(?:\.\d+)?$|^\.\d+$/u.test(raw)) throw new ProgramError("数値の書き方を確認してください。", line);
      tokens.push({ type: "number", value: Number(raw), line });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let value = "";
      let closed = false;
      while (i < source.length) {
        const current = source[i++];
        if (current === quote) { closed = true; break; }
        if (current === "\\") {
          if (i >= source.length) break;
          const escaped = source[i++];
          const escapes = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'" };
          value += escapes[escaped] ?? escaped;
        } else value += current;
      }
      if (!closed) throw new ProgramError("文字列の引用符が閉じていません。", line);
      tokens.push({ type: "string", value, line });
      continue;
    }
    if (isLetter(ch)) {
      i += 1;
      while (i < source.length && isWord(source[i])) i += 1;
      const value = source.slice(start, i);
      tokens.push({ type: "word", value, line });
      continue;
    }
    if (ch === "【") {
      const close = source.indexOf("】", i);
      if (close < 0) throw new ProgramError("「【」が閉じていません。", line);
      const label = source.slice(i + 1, close).trim();
      if (label !== "外部からの入力") throw new ProgramError(`空欄「【${label}】」が残っています。式に書き換えてください。`, line);
      tokens.push({ type: "input", value: "【外部からの入力】", line });
      i = close + 1;
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (["**", "==", "!=", "<=", ">="].includes(pair)) {
      tokens.push({ type: "op", value: pair, line });
      i += 2;
      continue;
    }
    if ("+-*/÷%<>()[],".includes(ch)) {
      tokens.push({ type: "op", value: ch, line });
      i += 1;
      continue;
    }
    throw new ProgramError(`式に使えない記号「${ch}」があります。`, line);
  }
  tokens.push({ type: "eof", value: "", line });
  return tokens;
}

const PRECEDENCE = { or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "÷": 5, "%": 5, "**": 6 };

function parseExpression(source, line) {
  const tokens = tokenizeExpression(source, line);
  let at = 0;
  let expressionDepth = 0;
  const current = () => tokens[at];
  const take = (value) => {
    if (current().value !== value) return false;
    at += 1;
    return true;
  };
  const expect = (value) => {
    if (!take(value)) throw new ProgramError(`式に「${value}」が必要です。`, line);
  };

  function primary() {
    const token = current();
    if (take("-")) return { type: "unary", op: "-", value: expression(6), line };
    if (take("not")) return { type: "unary", op: "not", value: expression(3), line };
    if (take("(")) {
      const value = expression(0);
      expect(")");
      value.paren = true; // 書いた括弧は、式をコードに戻すときも残す
      return postfix(value);
    }
    if (take("[")) {
      const values = [];
      if (!take("]")) {
        do { values.push(expression(0)); } while (take(","));
        expect("]");
      }
      if (values.length > LIMITS.arrayLength) throw new ProgramError("配列が上限の1,000要素を超えています。", line);
      return postfix({ type: "array", values, line });
    }
    if (token.type === "input") {
      at += 1;
      return { type: "call", name: "入力", args: [], line };
    }
    if (token.type === "number" || token.type === "string") {
      at += 1;
      return { type: "literal", value: token.value, line };
    }
    if (token.type === "word") {
      at += 1;
      if (token.value === "true" || token.value === "false") return { type: "literal", value: token.value === "true", line };
      return postfix({ type: "variable", name: token.value, line });
    }
    throw new ProgramError("式を読み取れません。値や変数を確認してください。", line);
  }

  function postfix(node) {
    let value = node;
    while (true) {
      if (take("[")) {
        do { value = { type: "index", target: value, index: expression(0), line }; } while (take(","));
        expect("]");
      } else if (take("(")) {
        if (value.type !== "variable") throw new ProgramError("呼び出せるのは用意された関数だけです。", line);
        const args = [];
        if (!take(")")) {
          do { args.push(expression(0)); } while (take(","));
          expect(")");
        }
        value = { type: "call", name: value.name, args, line };
      } else break;
    }
    return value;
  }

  function expression(minimum) {
    expressionDepth += 1;
    if (expressionDepth > LIMITS.expressionDepth) {
      expressionDepth -= 1;
      throw new ProgramError("式の入れ子は100段までです。", line);
    }
    try {
      let left = primary();
      while (true) {
        const op = current().value;
        const precedence = PRECEDENCE[op];
        if (precedence === undefined || precedence < minimum) break;
        at += 1;
        const right = expression(precedence + (op === "**" ? 0 : 1));
        left = { type: "binary", op, left, right, line };
      }
      return left;
    } finally {
      expressionDepth -= 1;
    }
  }

  const result = expression(0);
  if (current().type !== "eof") throw new ProgramError(`式の後に「${current().value}」があります。`, line);
  return result;
}

function splitArguments(source, line) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) throw new ProgramError("括弧または引用符が閉じていません。", line);
  if (source.slice(start).trim() || parts.length) parts.push(source.slice(start).trim());
  if (parts.some((part) => !part)) throw new ProgramError("空の値があります。", line);
  return parts;
}

const TARGET = /^([\p{L}_][\p{L}\p{N}_]*)\s*(?:\[([\s\S]+)\])?$/u;

function parseTarget(source, line) {
  const match = source.trim().match(TARGET);
  if (!match) throw new ProgramError("代入先は変数名または配列の要素にしてください。", line);
  if (match[2] === undefined) return { type: "variable", name: match[1], line };
  const indexText = match[2].trim();
  splitArguments(indexText, line).forEach((part) => parseExpression(part, line));
  return { type: "index", name: match[1], indexText, line };
}

// 「==」「<=」などを除いた最初の「=」で、代入先と式に分ける。
function splitAssignment(text) {
  const match = text.match(/^(.+?)\s*(?<![=!<>])=(?!=)\s*([\s\S]+)$/u);
  return match ? { left: match[1], right: match[2].trim() } : null;
}

function isAssignment(text) {
  const assignment = splitAssignment(text);
  return Boolean(assignment && TARGET.test(assignment.left.trim()));
}

function normalizeCode(text) {
  return text.replace(/　/gu, "  ").normalize("NFKC").replace(/[−–]/gu, "-").replace(/×/gu, "*");
}

const QUOTES = { '"': '"', "'": "'", "“": '"', "”": '"', "＂": '"', "＇": "'" };

// 文字列の外だけを半角にそろえ、「#」以降をコメントとして切り出す。
// 全角や“”で始めた文字列は半角の引用符に置き換え、文字列の中身は変えない。
function splitLine(raw) {
  let code = "";
  let plain = "";
  let quote = "";
  let closers = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === "\\" && i + 1 < raw.length) code += ch + raw[++i];
      else if (closers.includes(ch)) { code += quote; quote = ""; }
      else code += ch;
    } else if (QUOTES[ch]) {
      quote = QUOTES[ch];
      closers = ch === quote ? ch : quote === '"' ? '"“”＂' : "'＇";
      code += normalizeCode(plain) + quote;
      plain = "";
    } else if (ch === "#" || ch === "＃") {
      return { code: code + normalizeCode(plain), comment: raw.slice(i + 1).trimEnd() };
    } else plain += ch;
  }
  return { code: code + normalizeCode(plain), comment: null };
}

function commentOf(row) {
  return row.comment === null ? {} : { comment: row.comment };
}

export function parseProgram(source) {
  if (source.length > LIMITS.sourceLength) throw new ProgramError("ソースが20,000文字の上限を超えています。", 1);
  const lines = source.replace(/\r\n?/gu, "\n").split("\n").map((raw, index) => {
    const { code, comment } = splitLine(raw.replace(/\t/gu, "  "));
    const spaces = code.match(/^ */u)[0].length;
    const text = code.slice(spaces).trimEnd();
    if (text && spaces % 2) throw new ProgramError("字下げは半角スペース2個単位にしてください。", index + 1);
    return { text, comment, indent: spaces, line: index + 1 };
  });
  let position = 0;

  function nextCodeRow(from) {
    return lines.slice(from).find((row) => row.text);
  }

  function parseBlock(indent, depth) {
    if (depth > LIMITS.nesting) throw new ProgramError("構文の入れ子は30段までです。", lines[Math.max(position - 1, 0)]?.line ?? 1);
    const body = [];
    while (position < lines.length) {
      const row = lines[position];
      if (!row.text) {
        // コメントだけの行は、次のコードと同じブロックに入れる。
        if (row.comment !== null) {
          if (row.indent < indent && (nextCodeRow(position + 1)?.indent ?? -1) < indent) break;
          body.push({ type: "comment", text: row.comment, line: row.line });
        }
        position += 1;
        continue;
      }
      if (row.indent < indent) break;
      if (row.indent > indent) throw new ProgramError("予期しない字下げです。ブロックは2スペースずつ字下げしてください。", row.line);
      if (/^そうでな(?:ければ|くもし)/u.test(row.text)) throw new ProgramError("「そうでなければ」「そうでなくもし」は「もし」の後に、同じ字下げで置いてください。", row.line);
      position += 1;
      body.push(...parseLine(row, depth));
    }
    return body;
  }

  function requireBlock(indent, depth) {
    const next = nextCodeRow(position);
    if (next && next.indent > indent + 2) throw new ProgramError("字下げは2スペースずつにしてください。", next.line);
    return parseBlock(indent + 2, depth + 1);
  }

  // 「a = 1 , b = 2」のように1行に並んだ代入は、別々の文として読む。
  function parseLine(row, depth) {
    let parts = [];
    if (row.text.includes(",")) {
      try { parts = splitArguments(row.text, row.line); } catch { parts = []; }
    }
    if (parts.length > 1 && parts.every(isAssignment)) {
      const nodes = parts.map((part) => parseSimple(part, row));
      Object.assign(nodes.at(-1), commentOf(row));
      return nodes;
    }
    return [parseStatement(row, depth)];
  }

  function parseIf(condition, row, depth) {
    parseExpression(condition, row.line);
    const node = { type: "if", condition, then: requireBlock(row.indent, depth), otherwise: [], line: row.line, ...commentOf(row) };
    const next = lines[position];
    if (next?.indent !== row.indent) return node;
    const elseIf = next.text.match(/^そうでなくもし\s*(.+?)\s*ならば\s*:$/u);
    if (elseIf) {
      position += 1;
      node.otherwise = [parseIf(elseIf[1], next, depth)];
      node.elseIf = true;
    } else if (/^そうでなければ\s*:$/u.test(next.text)) {
      position += 1;
      node.otherwise = requireBlock(row.indent, depth);
      if (next.comment !== null) node.elseComment = next.comment;
    }
    return node;
  }

  function parseSimple(text, row) {
    let match = text.match(/^表示する\s*\(([\s\S]*)\)$/u);
    if (match) {
      const argsText = splitArguments(match[1], row.line);
      return { type: "print", argsText, args: argsText.map((part) => parseExpression(part, row.line)), line: row.line };
    }
    match = text.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*のすべての値を\s*(.+?)\s*にする$/u);
    if (match) {
      parseExpression(match[2], row.line);
      return { type: "fill", name: match[1], expression: match[2], line: row.line };
    }
    const assignment = splitAssignment(text);
    if (!assignment) return null;
    const target = parseTarget(assignment.left, row.line);
    parseExpression(assignment.right, row.line);
    return { type: "assign", target, expression: assignment.right, line: row.line };
  }

  function parseStatement(row, depth) {
    if (depth > LIMITS.nesting) throw new ProgramError("構文の入れ子は30段までです。", row.line);
    let match = row.text.match(/^もし\s*(.+?)\s*ならば\s*:$/u);
    if (match) return parseIf(match[1], row, depth);
    match = row.text.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*を\s*(.+?)\s*から\s*(.+?)\s*まで\s*(.+?)\s*ずつ(増や|減ら)しながら繰り返す\s*:$/u);
    if (match) {
      const [, name, start, end, step, way] = match;
      [start, end, step].forEach((part) => parseExpression(part, row.line));
      return { type: "for", name, start, end, step, down: way === "減ら", body: requireBlock(row.indent, depth), line: row.line, ...commentOf(row) };
    }
    match = row.text.match(/^(.+?)\s*の間繰り返す\s*:$/u);
    if (match) {
      parseExpression(match[1], row.line);
      return { type: "while", condition: match[1], body: requireBlock(row.indent, depth), line: row.line, ...commentOf(row) };
    }
    const simple = parseSimple(row.text, row);
    if (simple) return { ...simple, ...commentOf(row) };
    throw new ProgramError("この行はまだ対応していません。代入、表示、条件、繰返しを確認してください。", row.line);
  }

  return parseBlock(0, 0);
}

// ブロックの入力欄1つ分の式を、コードの行と同じ表記ゆれ処理をしてから読む。
export function parseExpressionText(source) {
  const { code, comment } = splitLine(source);
  if (comment !== null) throw new ProgramError("式に使えない記号「#」があります。", 1);
  return parseExpression(code, 1);
}

const PREFIX_LEVEL = { "-": 6, not: 3 };

function quoteString(value) {
  return '"' + value.replace(/[\\"]/gu, "\\$&").replace(/\n/gu, "\\n").replace(/\r/gu, "\\r").replace(/\t/gu, "\\t") + '"';
}

// 式の木をコードに戻す。優先順位に必要な括弧と、元のコードに書かれていた括弧を付ける。
// raw はブロックで入力途中の文字列で、そのまま出す。
export function expressionToSource(node) {
  function format(node, minimum = 0, leftOf = 0) {
    if (node.type === "raw") return node.text;
    let text;
    let level = 9;
    if (node.type === "literal") text = typeof node.value === "string" ? quoteString(node.value) : String(node.value);
    else if (node.type === "variable") text = node.name;
    else if (node.type === "array") text = "[" + node.values.map((value) => format(value)).join(", ") + "]";
    else if (node.type === "call") text = node.name === "入力" && !node.args.length ? "【外部からの入力】" : node.name + "(" + node.args.map((arg) => format(arg)).join(", ") + ")";
    else if (node.type === "index") {
      const indexes = [];
      let target = node;
      while (target.type === "index" && (target === node || !target.paren)) {
        indexes.unshift(format(target.index));
        target = target.target;
      }
      text = format(target, 9) + "[" + indexes.join(", ") + "]";
    } else if (node.type === "unary") {
      level = PREFIX_LEVEL[node.op];
      text = (node.op === "-" ? "-" : "not ") + format(node.value, level);
    } else {
      level = PRECEDENCE[node.op];
      const right = node.op === "**";
      text = format(node.left, right ? level + 1 : level, level) + " " + node.op + " " + format(node.right, right ? level : level + 1);
    }
    // 前置の - や not は右へ広く掛かるので、左側の項に置くときは括弧で閉じる。
    const wrap = node.paren || level < minimum || (node.type === "unary" && leftOf >= level);
    return wrap ? "(" + text + ")" : text;
  }
  return format(node);
}

function indent(level) { return "  ".repeat(level); }

export function programToSource(program) {
  const lines = [];
  const note = (comment) => (comment == null ? "" : " #" + comment);
  function writeIf(node, depth, keyword) {
    const pad = indent(depth);
    lines.push(`${pad}${keyword} ${node.condition} ならば:${note(node.comment)}`);
    write(node.then, depth + 1);
    if (node.elseIf && node.otherwise.length === 1 && node.otherwise[0].type === "if") writeIf(node.otherwise[0], depth, "そうでなくもし");
    else if (node.otherwise.length) {
      lines.push(`${pad}そうでなければ:${note(node.elseComment)}`);
      write(node.otherwise, depth + 1);
    }
  }
  function write(nodes, depth) {
    for (const node of nodes) {
      const pad = indent(depth);
      if (node.type === "comment") lines.push(`${pad}#${node.text}`);
      else if (node.type === "assign") {
        const target = node.target.type === "variable" ? node.target.name : `${node.target.name}[${node.target.indexText}]`;
        lines.push(`${pad}${target} = ${node.expression}${note(node.comment)}`);
      } else if (node.type === "fill") lines.push(`${pad}${node.name}のすべての値を${node.expression}にする${note(node.comment)}`);
      else if (node.type === "print") lines.push(`${pad}表示する(${node.argsText.join(", ")})${note(node.comment)}`);
      else if (node.type === "if") writeIf(node, depth, "もし");
      else if (node.type === "for") {
        lines.push(`${pad}${node.name} を ${node.start} から ${node.end} まで ${node.step} ずつ${node.down ? "減らし" : "増やし"}ながら繰り返す:${note(node.comment)}`);
        write(node.body, depth + 1);
      } else if (node.type === "while") {
        lines.push(`${pad}${node.condition} の間繰り返す:${note(node.comment)}`);
        write(node.body, depth + 1);
      }
    }
  }
  write(program, 0);
  return lines.join("\n");
}

function copyValue(value) {
  return Array.isArray(value) ? value.map(copyValue) : value;
}

function dimensions(value) {
  return Array.isArray(value) ? 1 + Math.max(0, ...value.map(dimensions)) : 0;
}

function showValue(value) {
  if (Array.isArray(value)) return `[${value.map(showValue).join(", ")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "未定義";
  return String(value);
}

function numberValue(value, line) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ProgramError("数値が必要な場所に数値以外の値があります。", line);
  return value;
}

function booleanValue(value, line) {
  if (typeof value !== "boolean") throw new ProgramError("条件には true または false になる式を使ってください。", line);
  return value;
}

function snapshotState(environment) {
  return Object.fromEntries([...environment.entries()].map(([key, value]) => [key, copyValue(value)]));
}

export function runProgram(source, { inputValues = [] } = {}) {
  const program = parseProgram(source);
  const environment = new Map();
  const inputs = [...inputValues];
  const trace = [];
  const output = [];
  let steps = 0;
  let outputSize = 0;
  let traceCells = 0;

  function tick(node) {
    steps += 1;
    if (steps > LIMITS.steps) throw new ProgramError("実行が10,000ステップの上限に達しました。", node.line);
    if (trace.length >= LIMITS.traceRows) throw new ProgramError("トレースが2,000件の上限に達しました。", node.line);
  }

  function record(node) {
    const cellCount = [...environment.values()].reduce((sum, value) => sum + (Array.isArray(value) ? value.flat().length : 1), 0);
    traceCells += cellCount;
    if (traceCells > LIMITS.traceCells) throw new ProgramError("トレースの変数データが100,000件の上限に達しました。", node.line);
    trace.push({ line: node.line, variables: snapshotState(environment), output: output.join("") });
  }

  function elementIndex(array, value, line) {
    if (!Array.isArray(array)) throw new ProgramError("配列の要素を指定してください。", line);
    const index = numberValue(value, line);
    if (!Number.isInteger(index)) throw new ProgramError("配列の要素の番号には整数を使ってください。", line);
    if (index < 0 || index >= array.length) throw new ProgramError(`配列の範囲外です（要素の番号は0～${array.length - 1}）。`, line);
    return index;
  }

  function evaluate(node) {
    if (node.type === "literal") return node.value;
    if (node.type === "variable") {
      if (!environment.has(node.name)) throw new ProgramError(`変数「${node.name}」に値がありません。`, node.line);
      return environment.get(node.name);
    }
    if (node.type === "array") {
      if (node.values.length > LIMITS.arrayLength) throw new ProgramError("配列が上限の1,000要素を超えています。", node.line);
      const values = node.values.map((value) => copyValue(evaluate(value)));
      if (dimensions(values) > 2) throw new ProgramError("配列は二次元までです。", node.line);
      return values;
    }
    if (node.type === "index") {
      const array = evaluate(node.target);
      return array[elementIndex(array, evaluate(node.index), node.line)];
    }
    if (node.type === "unary") {
      const value = evaluate(node.value);
      if (node.op === "-") return -numberValue(value, node.line);
      return !booleanValue(value, node.line);
    }
    if (node.type === "call") {
      const args = node.args.map(evaluate);
      if (node.name === "要素数" && args.length === 1 && (Array.isArray(args[0]) || typeof args[0] === "string")) return args[0].length;
      if (node.name === "最大値" && args.length === 2) return Math.max(numberValue(args[0], node.line), numberValue(args[1], node.line));
      if (node.name === "最小値" && args.length === 2) return Math.min(numberValue(args[0], node.line), numberValue(args[1], node.line));
      if (node.name === "整数" && args.length === 1) return Math.trunc(numberValue(args[0], node.line));
      if (node.name === "乱数" && args.length === 0) return Math.random();
      if (node.name === "入力" && args.length === 0) {
        if (!inputs.length) throw new ProgramError("入力値が足りません。入力タブに値を追加してください。", node.line);
        const raw = inputs.shift();
        const trimmed = String(raw).trim();
        if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(trimmed)) return Number(trimmed);
        return String(raw);
      }
      throw new ProgramError(`関数「${node.name}」の名前または引数の数を確認してください。`, node.line);
    }
    if (node.type === "binary") {
      const left = evaluate(node.left);
      if (node.op === "and") return booleanValue(left, node.line) && booleanValue(evaluate(node.right), node.line);
      if (node.op === "or") return booleanValue(left, node.line) || booleanValue(evaluate(node.right), node.line);
      const right = evaluate(node.right);
      if (node.op === "==") return Array.isArray(left) || Array.isArray(right) ? JSON.stringify(left) === JSON.stringify(right) : left === right;
      if (node.op === "!=") return Array.isArray(left) || Array.isArray(right) ? JSON.stringify(left) !== JSON.stringify(right) : left !== right;
      if (["<", "<=", ">", ">="].includes(node.op)) {
        if (typeof left !== typeof right || !["number", "string"].includes(typeof left)) throw new ProgramError("比較する値の種類をそろえてください。", node.line);
        if (node.op === "<") return left < right;
        if (node.op === "<=") return left <= right;
        if (node.op === ">") return left > right;
        return left >= right;
      }
      if (node.op === "+" && (typeof left === "string" || typeof right === "string")) return showValue(left) + showValue(right);
      const a = numberValue(left, node.line);
      const b = numberValue(right, node.line);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      if (node.op === "/" || node.op === "÷" || node.op === "%") {
        if (b === 0) throw new ProgramError("0で割ることはできません。", node.line);
        if (node.op === "/") return a / b;
        return node.op === "÷" ? Math.trunc(a / b) : a % b;
      }
      const result = a ** b;
      if (!Number.isFinite(result)) throw new ProgramError("計算結果が大きすぎます。", node.line);
      return result;
    }
    throw new ProgramError("式を実行できません。", node.line);
  }

  function execute(nodes) {
    for (const node of nodes) {
      if (node.type === "assign") {
        tick(node);
        const value = evaluate(parseExpression(node.expression, node.line));
        if (node.target.type === "variable") environment.set(node.target.name, copyValue(value));
        else {
          const root = environment.get(node.target.name);
          if (!Array.isArray(root)) throw new ProgramError(`配列「${node.target.name}」に値がありません。`, node.line);
          const indices = splitArguments(node.target.indexText, node.line).map((part) => evaluate(parseExpression(part, node.line)));
          let array = root;
          indices.slice(0, -1).forEach((index) => { array = array[elementIndex(array, index, node.line)]; });
          array[elementIndex(array, indices.at(-1), node.line)] = copyValue(value);
          if (dimensions(root) > 2) throw new ProgramError("配列は二次元までです。", node.line);
        }
        record(node);
      } else if (node.type === "fill") {
        tick(node);
        const array = environment.get(node.name);
        if (!Array.isArray(array)) throw new ProgramError(`配列「${node.name}」に値がありません。`, node.line);
        const value = evaluate(parseExpression(node.expression, node.line));
        if (Array.isArray(value)) throw new ProgramError("すべての値には配列以外の値を指定してください。", node.line);
        const fill = (items) => items.map((item) => (Array.isArray(item) ? fill(item) : value));
        environment.set(node.name, fill(array));
        record(node);
      } else if (node.type === "print") {
        tick(node);
        const rendered = node.args.map((arg) => showValue(evaluate(arg))).join("") + "\n";
        outputSize += rendered.length;
        if (outputSize > LIMITS.outputLength) throw new ProgramError("表示が20,000文字の上限に達しました。", node.line);
        output.push(rendered);
        record(node);
      } else if (node.type === "if") {
        tick(node);
        const condition = booleanValue(evaluate(parseExpression(node.condition, node.line)), node.line);
        record(node);
        execute(condition ? node.then : node.otherwise);
      } else if (node.type === "for") {
        const start = numberValue(evaluate(parseExpression(node.start, node.line)), node.line);
        const end = numberValue(evaluate(parseExpression(node.end, node.line)), node.line);
        const step = numberValue(evaluate(parseExpression(node.step, node.line)), node.line);
        if (![start, end, step].every(Number.isInteger) || step <= 0) throw new ProgramError("繰返しの開始・終了・増分には整数を使い、増分は1以上にしてください。", node.line);
        for (let value = start; node.down ? value >= end : value <= end; value += node.down ? -step : step) {
          tick(node);
          environment.set(node.name, value);
          record(node);
          execute(node.body);
        }
      } else if (node.type === "while") {
        while (true) {
          tick(node);
          const condition = booleanValue(evaluate(parseExpression(node.condition, node.line)), node.line);
          record(node);
          if (!condition) break;
          execute(node.body);
        }
      }
    }
  }

  try {
    execute(program);
    return { output: output.join(""), trace, steps, variables: snapshotState(environment), error: null };
  } catch (error) {
    const resultError = error instanceof ProgramError ? error : new ProgramError("実行中にエラーが発生しました。", 1);
    return { output: output.join(""), trace, steps, variables: snapshotState(environment), error: resultError };
  }
}

export const runtimeLimits = LIMITS;
