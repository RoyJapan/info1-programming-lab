import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function setupFontSize() {");
const setup = app.slice(start, app.indexOf("\nfunction ", start + 1));
const key = "info1-programming-lab-font-size";

function controls(saved = null, storageFails = false) {
  const storage = new Map(saved === null ? [] : [[key, saved]]);
  const properties = new Map();
  const events = {};
  const messages = [];
  const gutter = { scrollTop: 0 };
  const field = {
    value: "17", defaultValue: "17",
    get valueAsNumber() { return Number(this.value); },
    checkValidity() { return this.value !== "" && Number.isInteger(this.valueAsNumber) && this.valueAsNumber >= 16 && this.valueAsNumber <= 32; },
    addEventListener(name, callback) { events[name] = callback; },
  };
  runInNewContext(setup + "\nsetupFontSize();", {
    $: (id) => id === "program-font-size" ? field : gutter,
    document: { documentElement: { style: {
      setProperty: (name, value) => properties.set(name, value),
      getPropertyValue: (name) => properties.get(name),
    } } },
    code: { scrollTop: 145 },
    localStorage: {
      getItem(name) { if (storageFails) throw new Error("unavailable"); return storage.get(name) ?? null; },
      setItem(name, value) { if (storageFails) throw new Error("unavailable"); storage.set(name, value); },
    },
    showToast: (message) => messages.push(message),
  });
  return { field, events, storage, properties, gutter, messages };
}

test("文字サイズは保存値を復元し、不正な保存値は初期値に戻す", () => {
  for (const [saved, expected] of [[null, 17], ["16", 16], ["24", 24], ["32", 32], ["", 17], ["NaN", 17], ["15", 17], ["33", 17], ["20.5", 17]]) {
    const ui = controls(saved);
    assert.equal(ui.field.value, String(expected));
    assert.equal(ui.properties.get("--code-size"), expected + "px");
    assert.equal(ui.gutter.scrollTop, 145);
  }
});

test("文字サイズは入力直後に反映・保存し、不正な入力では直前のサイズを保つ", () => {
  const ui = controls();
  ui.field.value = "24";
  ui.events.input();
  assert.equal(ui.properties.get("--code-size"), "24px");
  assert.deepEqual([...ui.storage], [[key, "24"]]);
  assert.equal(controls(ui.storage.get(key)).field.value, "24");
  for (const invalid of ["", "15", "33", "20.5"]) {
    ui.field.value = invalid;
    ui.events.input();
    assert.equal(ui.properties.get("--code-size"), "24px");
    assert.equal(ui.storage.get(key), "24");
    ui.events.blur();
    assert.equal(ui.field.value, "24");
  }
});

test("保存領域が使えなくても文字サイズは変更でき、保存できないことを知らせる", () => {
  const ui = controls(null, true);
  assert.equal(ui.field.value, "17");
  ui.field.value = "20";
  ui.events.input();
  assert.equal(ui.properties.get("--code-size"), "20px");
  assert.match(ui.messages.at(-1), /保存できません/u);
});
