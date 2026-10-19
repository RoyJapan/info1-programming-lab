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
    const pair = source.slice(i, i + 2);
    if (["**", "==", "!=", "<=", ">="].includes(pair)) {
      tokens.push({ type: "op", value: pair, line });
      i += 2;
      continue;
    }
    if ("+-*/%<>()[],".includes(ch)) {
      tokens.push({ type: "op", value: ch, line });
      i += 1;
      continue;
    }
    throw new ProgramError(`式に使えない記号「${ch}」があります。`, line);
  }
  tokens.push({ type: "eof", value: "", line });
  return tokens;
}

const PRECEDENCE = { or: 1, and: 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5, "**": 6 };

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
        const index = expression(0);
        expect("]");
        value = { type: "index", target: value, index, line };
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

function parseTarget(source, line) {
  const raw = source.trim();
  const indexed = raw.match(/^([\p{L}_][\p{L}\p{N}_]*)\s*\[([\s\S]+)\]$/u);
  if (indexed) return { type: "index", name: indexed[1], indexText: indexed[2].trim(), line };
  if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(raw)) return { type: "variable", name: raw, line };
  throw new ProgramError("代入先は変数名または配列の要素にしてください。", line);
}

export function parseProgram(source) {
  if (source.length > LIMITS.sourceLength) throw new ProgramError("ソースが20,000文字の上限を超えています。", 1);
  const lines = source.replace(/\r\n?/gu, "\n").split("\n").map((raw, index) => {
    const expanded = raw.replace(/\t/gu, "  ");
    const spaces = expanded.match(/^ */u)[0].length;
    if (spaces % 2) throw new ProgramError("字下げは半角スペース2個単位にしてください。", index + 1);
    return { raw: expanded, text: expanded.slice(spaces).trimEnd(), indent: spaces, line: index + 1 };
  });
  let position = 0;

  function parseBlock(indent, depth) {
    if (depth > LIMITS.nesting) throw new ProgramError("構文の入れ子は30段までです。", lines[Math.max(position - 1, 0)]?.line ?? 1);
    const body = [];
    while (position < lines.length) {
      const row = lines[position];
      if (!row.text) { position += 1; continue; }
      if (row.indent < indent) break;
      if (row.indent > indent) throw new ProgramError("予期しない字下げです。ブロックは2スペースずつ字下げしてください。", row.line);
      if (row.text === "そうでなければ:") throw new ProgramError("「そうでなければ」は「もし」の後に置いてください。", row.line);
      position += 1;
      body.push(parseStatement(row, depth));
    }
    return body;
  }

  function requireBlock(indent, line, depth) {
    if (position < lines.length && lines[position].text && !lines[position].text.startsWith("#") && lines[position].indent > indent + 2) {
      throw new ProgramError("字下げは2スペースずつにしてください。", lines[position].line);
    }
    return parseBlock(indent + 2, depth + 1);
  }

  function parseStatement(row, depth) {
    if (depth > LIMITS.nesting) throw new ProgramError("構文の入れ子は30段までです。", row.line);
    let match = row.text.match(/^もし\s+(.+?)\s+ならば\s*:\s*$/u);
    if (match) {
      const node = { type: "if", condition: match[1].trim(), then: requireBlock(row.indent, row.line, depth), otherwise: [], line: row.line };
      const next = lines[position];
      if (next?.indent === row.indent && next.text === "そうでなければ:") {
        position += 1;
        node.otherwise = requireBlock(row.indent, row.line, depth);
      }
      parseExpression(node.condition, row.line);
      return node;
    }
    match = row.text.match(/^([\p{L}_][\p{L}\p{N}_]*)\s+を\s+(.+?)\s+から\s+(.+?)\s+まで\s+(.+?)\s+ずつ増やしながら繰り返す\s*:\s*$/u);
    if (match) {
      const node = { type: "for", name: match[1], start: match[2].trim(), end: match[3].trim(), step: match[4].trim(), body: requireBlock(row.indent, row.line, depth), line: row.line };
      parseExpression(node.start, row.line); parseExpression(node.end, row.line); parseExpression(node.step, row.line);
      return node;
    }
    match = row.text.match(/^(.+?)\s+の間繰り返す\s*:\s*$/u);
    if (match) {
      const node = { type: "while", condition: match[1].trim(), body: requireBlock(row.indent, row.line, depth), line: row.line };
      parseExpression(node.condition, row.line);
      return node;
    }
    match = row.text.match(/^表示する\s*\(([\s\S]*)\)\s*$/u);
    if (match) {
      const args = splitArguments(match[1], row.line).map((part) => parseExpression(part, row.line));
      return { type: "print", argsText: splitArguments(match[1], row.line), line: row.line, args };
    }
    const assignment = row.text.match(/^(.+?)\s*=\s*([\s\S]+)$/u);
    if (assignment) {
      const target = parseTarget(assignment[1], row.line);
      const expression = assignment[2].trim();
      parseExpression(expression, row.line);
      if (target.type === "index") parseExpression(target.indexText, row.line);
      return { type: "assign", target, expression, line: row.line };
    }
    throw new ProgramError("この行はまだ対応していません。代入、表示、条件、繰返しを確認してください。", row.line);
  }

  const body = parseBlock(0, 0);
  return body;
}

function indent(level) { return "  ".repeat(level); }

export function programToSource(program) {
  const lines = [];
  function write(nodes, depth) {
    for (const node of nodes) {
      const pad = indent(depth);
      if (node.type === "assign") {
        const target = node.target.type === "variable" ? node.target.name : `${node.target.name}[${node.target.indexText}]`;
        lines.push(`${pad}${target} = ${node.expression}`);
      } else if (node.type === "print") lines.push(`${pad}表示する(${node.argsText.join(", ")})`);
      else if (node.type === "if") {
        lines.push(`${pad}もし ${node.condition} ならば:`);
        write(node.then, depth + 1);
        if (node.otherwise.length) { lines.push(`${pad}そうでなければ:`); write(node.otherwise, depth + 1); }
      } else if (node.type === "for") {
        lines.push(`${pad}${node.name} を ${node.start} から ${node.end} まで ${node.step} ずつ増やしながら繰り返す:`);
        write(node.body, depth + 1);
      } else if (node.type === "while") {
        lines.push(`${pad}${node.condition} の間繰り返す:`);
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

export function runProgram(source, { arrayBase = 1, inputValues = [] } = {}) {
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
    const cellCount = [...environment.values()].reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 1), 0);
    traceCells += cellCount;
    if (traceCells > LIMITS.traceCells) throw new ProgramError("トレースの変数データが100,000件の上限に達しました。", node.line);
    trace.push({ line: node.line, variables: snapshotState(environment), output: output.join("") });
  }

  function evaluate(node) {
    if (node.type === "literal") return node.value;
    if (node.type === "variable") {
      if (!environment.has(node.name)) throw new ProgramError(`変数「${node.name}」に値がありません。`, node.line);
      return environment.get(node.name);
    }
    if (node.type === "array") {
      if (node.values.length > LIMITS.arrayLength) throw new ProgramError("配列が上限の1,000要素を超えています。", node.line);
      const values = node.values.map(evaluate);
      if (values.some(Array.isArray)) throw new ProgramError("配列は一次元だけに対応しています。", node.line);
      return values;
    }
    if (node.type === "index") {
      const array = evaluate(node.target);
      if (!Array.isArray(array)) throw new ProgramError("配列の要素を指定してください。", node.line);
      const index = numberValue(evaluate(node.index), node.line);
      if (!Number.isInteger(index)) throw new ProgramError("配列の添字には整数を使ってください。", node.line);
      const internal = index - arrayBase;
      if (internal < 0 || internal >= array.length) throw new ProgramError(`配列の範囲外です（${arrayBase}始まり、${arrayBase}～${arrayBase + array.length - 1}）。`, node.line);
      return array[internal];
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
      if (node.op === "/") {
        if (b === 0) throw new ProgramError("0で割ることはできません。", node.line);
        return a / b;
      }
      if (node.op === "%") {
        if (b === 0) throw new ProgramError("0で割ることはできません。", node.line);
        return a % b;
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
          if (!environment.has(node.target.name) || !Array.isArray(environment.get(node.target.name))) throw new ProgramError(`配列「${node.target.name}」に値がありません。`, node.line);
          const array = [...environment.get(node.target.name)];
          const index = numberValue(evaluate(parseExpression(node.target.indexText, node.line)), node.line);
          if (!Number.isInteger(index)) throw new ProgramError("配列の添字には整数を使ってください。", node.line);
          const internal = index - arrayBase;
          if (internal < 0 || internal >= array.length) throw new ProgramError(`配列の範囲外です（${arrayBase}始まり）。`, node.line);
          if (Array.isArray(value)) throw new ProgramError("配列の中に配列は入れられません。", node.line);
          array[internal] = copyValue(value);
          environment.set(node.target.name, array);
        }
        record(node);
      } else if (node.type === "print") {
        tick(node);
        const rendered = node.args.map((arg) => showValue(evaluate(arg))).join(" ") + "\n";
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
        for (let value = start; value <= end; value += step) {
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
