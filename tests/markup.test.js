// Page-level guarantees that live in index.html rather than in code.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("the app's scripts don't wait for the PDF library to download", () => {
  // Deferred scripts run in document order, so jsPDF must come after app.js.
  const app = html.indexOf('src="app.js"');
  const pdf = html.indexOf("jspdf.umd.min.js");
  assert.ok(app > -1, "app.js script tag missing");
  assert.ok(pdf > app, "jsPDF is loaded before app.js, so a slow CDN would delay the whole page");
});

test("browsers without JavaScript get a message instead of a blank page", () => {
  assert.match(html, /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
});
