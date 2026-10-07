// Every text colour must stay readable: WCAG contrast of at least 4.5:1 in both themes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

function tokens(block) {
  const values = {};
  for (const [, name, hex] of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) values[name] = hex;
  return values;
}

function themeBlock(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} block missing from styles.css`);
  return css.slice(start, css.indexOf("}", start));
}

const light = tokens(themeBlock(":root{"));
const dark = { ...light, ...tokens(themeBlock(':root[data-theme="dark"]{')) };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS = [
  ["text", "surface"], ["text", "surface-muted"], ["text", "bg"],
  ["text-muted", "surface"], ["text-faint", "surface"], ["text-faint", "surface-muted"],
  ["primary-text", "surface"],
  ["danger", "surface"],
  ["on-primary", "primary"], ["on-primary", "primary-hover"],
  ["badge-text", "badge-bg"],
  ["toast-text", "toast-bg"],
  ["#FFFFFF", "toast-error-bg"], ["#FFFFFF", "toast-success-bg"]
];

for (const [themeName, theme] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg] of PAIRS) {
    test(`${themeName}: ${fg} on ${bg} is at least 4.5:1`, () => {
      const fgHex = fg.startsWith("#") ? fg : theme[fg];
      const bgHex = theme[bg];
      assert.ok(fgHex, `--${fg} is not defined as a hex colour`);
      assert.ok(bgHex, `--${bg} is not defined as a hex colour`);
      const ratio = contrast(fgHex, bgHex);
      assert.ok(ratio >= 4.5, `${fgHex} on ${bgHex} is ${ratio.toFixed(2)}:1`);
    });
  }
}
