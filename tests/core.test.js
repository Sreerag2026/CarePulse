const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../public/core.js");

test("parseRoute: home for empty and root hashes", () => {
  assert.deepEqual(core.parseRoute(""), { name: "home", params: {} });
  assert.deepEqual(core.parseRoute("#/"), { name: "home", params: {} });
});

test("parseRoute: login and register default to the parent role", () => {
  assert.deepEqual(core.parseRoute("#/login"), { name: "login", params: { role: "parent" } });
  assert.deepEqual(core.parseRoute("#/login/doctor"), { name: "login", params: { role: "doctor" } });
  assert.deepEqual(core.parseRoute("#/register"), { name: "register", params: { role: "parent" } });
  assert.deepEqual(core.parseRoute("#/register/doctor"), { name: "register", params: { role: "doctor" } });
});

test("parseRoute: app pages and patient IDs", () => {
  assert.equal(core.parseRoute("#/reset-password").name, "reset");
  assert.equal(core.parseRoute("#/dashboard").name, "dashboard");
  assert.equal(core.parseRoute("#/patients").name, "patients");
  assert.equal(core.parseRoute("#/settings").name, "settings");
  assert.deepEqual(core.parseRoute("#/patients/CP123456"), { name: "patient", params: { patientId: "CP123456" } });
});

test("parseRoute: unknown hashes are notFound", () => {
  assert.equal(core.parseRoute("#/nope").name, "notFound");
  assert.equal(core.parseRoute("#/login/admin").name, "notFound");
});

test("routeHash round-trips every route", () => {
  const hashes = [
    "#/", "#/login", "#/login/doctor", "#/register", "#/register/doctor", "#/reset-password",
    "#/dashboard", "#/patients", "#/patients/CP123456", "#/settings"
  ];
  for (const hash of hashes) {
    const route = core.parseRoute(hash);
    assert.equal(core.routeHash(route.name, route.params), hash, `round-trip of ${hash}`);
  }
});

test("guardRoute: protected pages need a login", () => {
  const none = { role: null };
  assert.deepEqual(core.guardRoute(core.parseRoute("#/dashboard"), none), { redirect: "#/login", reason: "login-required" });
  assert.deepEqual(core.guardRoute(core.parseRoute("#/patients"), none), { redirect: "#/login/doctor", reason: "login-required" });
  assert.deepEqual(core.guardRoute(core.parseRoute("#/patients/CP1"), none), { redirect: "#/login/doctor", reason: "login-required" });
});

test("guardRoute: the wrong role goes to its own dashboard", () => {
  assert.deepEqual(core.guardRoute(core.parseRoute("#/patients"), { role: "parent" }), { redirect: "#/dashboard", reason: "wrong-role" });
  assert.deepEqual(core.guardRoute(core.parseRoute("#/dashboard"), { role: "doctor" }), { redirect: "#/patients", reason: "wrong-role" });
});

test("guardRoute: logged-in users skip the login page", () => {
  assert.equal(core.guardRoute(core.parseRoute("#/login"), { role: "parent" }).redirect, "#/dashboard");
  assert.equal(core.guardRoute(core.parseRoute("#/login/doctor"), { role: "doctor" }).redirect, "#/patients");
});

test("guardRoute: public pages are open and unknown pages go home", () => {
  for (const role of [null, "parent", "doctor"]) {
    assert.deepEqual(core.guardRoute(core.parseRoute("#/"), { role }), { redirect: null, reason: null });
    assert.deepEqual(core.guardRoute(core.parseRoute("#/settings"), { role }), { redirect: null, reason: null });
  }
  assert.deepEqual(core.guardRoute(core.parseRoute("#/nope"), { role: null }), { redirect: "#/", reason: null });
});

test("initials", () => {
  assert.equal(core.initials("Anita Menon"), "AM");
  assert.equal(core.initials("Dr. Priya Nair"), "PN");
  assert.equal(core.initials("riya"), "R");
  assert.equal(core.initials(""), "?");
  assert.equal(core.initials("   "), "?");
  assert.equal(core.initials("<img src=x>"), "?");
  assert.equal(core.initials(undefined), "?");
});

test("formatVital", () => {
  assert.equal(core.formatVital(92, " bpm"), "92 bpm");
  assert.equal(core.formatVital(null, "%"), "—");
  assert.equal(core.formatVital("", "%"), "—");
  assert.equal(core.formatVital(undefined, "%"), "—");
  assert.equal(core.formatVital(0, " bpm"), "0 bpm");
});

function readings(count) {
  return Array.from({ length: count }, (_, i) => ({
    heartRate: 80 + i,
    recordedAt: new Date(Date.UTC(2026, 9, 7, 10, i)).toISOString()
  }));
}

test("recentReadings returns the newest first, capped by limit", () => {
  const patient = { readings: readings(12) };
  const recent = core.recentReadings(patient);
  assert.equal(recent.length, 10);
  assert.equal(recent[0].heartRate, 91);
  assert.equal(recent[9].heartRate, 82);
  assert.equal(patient.readings[0].heartRate, 80, "input not mutated");
  assert.deepEqual(core.recentReadings({}), []);
  assert.equal(core.recentReadings(patient, 3).length, 3);
});

test("lastReadingTime prefers lastReadingAt, then the last reading", () => {
  assert.equal(core.lastReadingTime({ lastReadingAt: "2026-10-07T10:00:00.000Z", readings: readings(2) }), "2026-10-07T10:00:00.000Z");
  assert.equal(core.lastReadingTime({ readings: readings(2) }), readings(2)[1].recordedAt);
  assert.equal(core.lastReadingTime({}), null);
  assert.equal(core.lastReadingTime(null), null);
});

test("heartRateSummary", () => {
  const patient = { readings: [84, 91, 97].map((heartRate) => ({ heartRate })) };
  assert.equal(core.heartRateSummary(patient), "91 bpm avg (3 readings)");
  assert.equal(core.heartRateSummary({ readings: [{ heartRate: 70 }] }), "70 bpm avg (1 reading)");
  assert.equal(core.heartRateSummary({ heartRate: 88, readings: [] }), "88 bpm (latest)");
  assert.equal(core.heartRateSummary({}), "No readings yet");
});

test("filterPatients matches name or ID, case-insensitively, without mutating", () => {
  const patients = [
    { patientName: "Riya Menon", patientId: "CP774693" },
    { patientName: "Aarav Sharma", patientId: "CP123456" }
  ];
  const copy = JSON.parse(JSON.stringify(patients));
  assert.deepEqual(core.filterPatients(patients, "riya").map((p) => p.patientId), ["CP774693"]);
  assert.deepEqual(core.filterPatients(patients, "cp7746").map((p) => p.patientId), ["CP774693"]);
  assert.equal(core.filterPatients(patients, "  ").length, 2);
  assert.equal(core.filterPatients(patients, "zzz").length, 0);
  assert.deepEqual(patients, copy);
});

test("ageFromDob", () => {
  const now = new Date("2026-10-07T12:00:00");
  assert.equal(core.ageFromDob("2020-01-15", now), 6);
  assert.equal(core.ageFromDob("2020-10-08", now), 5);
  assert.equal(core.ageFromDob("", now), "");
  assert.equal(core.ageFromDob("2030-01-01", now), "");
});

test("formatDob", () => {
  assert.equal(core.formatDob("2020-01-15"), "15/01/2020");
  assert.equal(core.formatDob(""), "");
  assert.equal(core.formatDob("not-a-date-x"), "not-a-date-x");
});
