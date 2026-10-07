# CarePulse Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the CarePulse frontend as a professional "Clinical clean" site: a public home page, split-layout auth pages, and an app layout for the parent and doctor portals. All existing behaviour stays.

**Architecture:** Plain HTML, CSS and JS served as static files from `public/` by the existing Express server. There is no build step. A hash router (`#/…`) shows one page `<section>` at a time and applies role guards. Pure logic (routes, guards, formatting, filtering) lives in `public/core.js`, so `node --test` can test it. DOM and API code lives in `public/app.js`.

**Tech Stack:** HTML5, CSS custom properties, vanilla JS (ES2020), `node:test` on Node ≥20, jsPDF 2.5.1 (CDN, unchanged), Inter from Google Fonts. The Express and MongoDB backend is unchanged.

**Spec:** `docs/superpowers/specs/2026-10-07-site-redesign-design.md`

## Global Constraints

- No backend or API changes. The existing request and response shapes are used as they are.
- No framework, bundler or new npm runtime dependency. Tests use the built-in `node:test`.
- Font: Inter only, weights 400, 500 and 600. Remove Fraunces and IBM Plex Mono.
- Light tokens pinned by the spec:

  | Token | Value |
  | --- | --- |
  | `--bg` | `#F6F8F8` |
  | `--surface` | `#FFFFFF` |
  | `--primary` | `#0F7A6C` |
  | `--border` | `#E2E8E7` |
  | `--text` | `#12313B` |

  Coral is used only for the ECG and alerts.
- Every text and background token pair must have contrast ≥ 4.5:1 in both themes.
- Shapes: radius 8px for controls and 12px for cards; borders 1px. Shadows only on cards and the sticky header.
- Copy rules:
  - no testimonials, user counts or statistics
  - no compliance claims such as HIPAA
  - security copy names only the bcrypt-hashed passwords, parent-only access to their own child, doctor registration codes, and signed sessions that expire after 12 hours
- Team names and the contact email are placeholders, each marked with an HTML comment `<!-- TEAM-PLACEHOLDER -->`.
- With `prefers-reduced-motion: reduce` set, all animation is off.
- The theme preference key `carepulse-theme` and its values `light` / `dark` / `system` stay as in PR #4.
- The inline theme script stays in `<head>`.
- Layout breakpoints:

  | Width | Change |
  | --- | --- |
  | 640px | patient table rows become cards |
  | 768px | navigation becomes a menu |
  | 900px | auth split layout collapses |

## Review Focus

1. **Refresh, or a deep link to `#/dashboard` or `#/patients/…`, while the stored token has expired.** The user should land on `#/login` with "Your session has expired", never on a blank page. Owned by Task 1 (guard test) and Task 5 (browser check).
2. **A patient or parent name that contains HTML, or is very long** (60+ characters). It should render as text and truncate with an ellipsis in table cells and the header chip. Owned by Task 1 (`initials` test) and Task 6 (browser check).
3. **A parent account with no linked patient** (`patientId: null`, legacy data). The dashboard should show "No patient is linked to this account yet", not "undefined's health". Owned by Task 5.
4. **A doctor opening `#/patients/CP000000`** (an unknown ID). The page should show "Patient not found" with a link back to Patients, not a stuck spinner. Owned by Task 6.
5. **A slow first request while Render wakes up** (about 50 seconds). Buttons show a spinner and ignore repeat clicks, and dashboards show a loading state rather than empty values. Owned by Task 4 (auth) and Task 5 (dashboard).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `public/index.html` | Markup only: `<head>` (meta, fonts, theme script, jsPDF), an inline SVG icon sprite, the public nav, the app header, one `<section data-page="…">` per page, the footer and the toast. |
| `public/styles.css` | Tokens (light and dark), base and typography, layout, components and page styles. |
| `public/core.js` | Pure helpers with no DOM access. Exposed as `window.CarePulseCore` in the browser and `module.exports` in Node. |
| `public/app.js` | Router wiring, session, `api()`, toasts, theme, page renderers, form handlers and the PDF report. |
| `tests/core.test.js` | Unit tests for `core.js`. |

`core.js` is the one addition to the spec's three files (`index.html`, `styles.css`, `app.js`). It keeps the pure logic separate so `node --test` can test it without a browser.
| `tests/contrast.test.js` | Parses the token blocks in `styles.css` and asserts the contrast pairs. |
| `package.json` | Adds `"test": "node --test tests/"`. |
| `README.md` | Updates the "Project structure" note and documents `npm test`. |

---

### Task 1: Pure core helpers with unit tests

**Files:**
- Create: `public/core.js`, `tests/core.test.js`
- Modify: `package.json` (add the `test` script)

**Interfaces:**
- Produces `CarePulseCore` with the functions below:

| Function | Behaviour |
| --- | --- |
| `parseRoute(hash: string)` | Returns `{ name, params }`. `name` is one of `'home' \| 'login' \| 'register' \| 'reset' \| 'dashboard' \| 'patients' \| 'patient' \| 'settings' \| 'notFound'`. `params` is `{ role?: 'parent'\|'doctor', patientId?: string }`. |
| `routeHash(name: string, params?: object)` | Returns a string; the inverse of `parseRoute`. |
| `guardRoute(route, session: { role: 'parent'\|'doctor'\|null })` | Returns `{ redirect: string\|null, reason: 'login-required'\|'wrong-role'\|null }`. |
| `initials(name: string)` | Returns a string. |
| `formatVital(value, suffix: string)` | Returns a string. |
| `lastReadingTime(patient)` | Returns an ISO string or `null`. |
| `recentReadings(patient, limit = 10)` | Returns readings, newest first. |
| `heartRateSummary(patient)` | Returns a string. |
| `filterPatients(patients: object[], query: string)` | Returns `object[]`. |
| `ageFromDob(dob: string, now: Date = new Date())` | Returns a number or `''`. |
| `formatDob(dob: string)` | Returns a string. |

- [ ] **Step 1: Write the failing tests in `tests/core.test.js`.**
  - The file loads the module with `require('../public/core.js')`.
  - Tests and exact expectations:
    - `parseRoute('')` and `parseRoute('#/')` return `home`.
    - `parseRoute('#/login')` returns `{name:'login', params:{role:'parent'}}`.
    - `parseRoute('#/login/doctor')` gives role `doctor`. The same applies to `#/register` and `#/register/doctor`.
    - `parseRoute('#/patients/CP123456')` returns `{name:'patient', params:{patientId:'CP123456'}}`.
    - `parseRoute('#/nope')` returns `notFound`.
    - `routeHash` round-trips every route above.
    - `guardRoute`:
      - `dashboard` with no session redirects to `'#/login'` with reason `login-required`.
      - `patients` with no session redirects to `'#/login/doctor'`.
      - `patients` as a parent redirects to `'#/dashboard'` with reason `wrong-role`.
      - `dashboard` as a doctor redirects to `'#/patients'`.
      - `login` as a parent redirects to `'#/dashboard'`.
      - `home` and `settings` have a `null` redirect for anyone.
      - `notFound` redirects to `'#/'`.
    - `initials`:

      | Input | Output |
      | --- | --- |
      | `'Anita Menon'` | `'AM'` |
      | `'Dr. Priya Nair'` | `'PN'` |
      | `'riya'` | `'R'` |
      | `''` or whitespace | `'?'` |
      | `'<img src=x>'` | `'?'` (a result of letters only, otherwise `'?'`) |

    - `formatVital`: `(92,' bpm')` gives `'92 bpm'`; `(null,'%')` and `('','%')` give `'—'`; `(0,' bpm')` gives `'0 bpm'`.
    - `recentReadings` returns the newest 10 of 12 readings, newest first.
    - `heartRateSummary` matches today's `app` output: `'91 bpm avg (3 readings)'` for heart rates 84, 91, 97, and `'No readings yet'` with no data.
    - `filterPatients`:
      - `'riya'` matches `'Riya Menon'`.
      - `'cp7746'` matches ID `'CP774693'`.
      - `'  '` returns all patients.
      - The result never mutates its input.
    - `ageFromDob('2020-01-15')` against a fixed "today" (inject `now` as an optional second parameter) gives `6` on `2026-10-07`.
    - `formatDob('2020-01-15')` gives `'15/01/2020'`.
- [ ] **Step 2: Add `"test": "node --test tests/"` to `package.json`.** Run `npm test`. Expected: FAIL, "Cannot find module '../public/core.js'".
- [ ] **Step 3: Implement `public/core.js`.**
  - Wrap it in an IIFE.
  - At the end: `if (typeof module !== 'undefined') module.exports = api; else window.CarePulseCore = api;`.
  - Port `heartRateSummary`, `lastReadingTime`, `ageFromDob` and `formatDob` from the current `public/index.html` script, so the results are identical.
- [ ] **Step 4: Run `npm test`.** Expected: all `core` tests PASS.
- [ ] **Step 5: Commit.** `git add public/core.js tests/core.test.js package.json && git commit -m "Add tested core helpers for routing, guards and formatting"`

### Task 2: Foundation (design tokens, components, page shell, router)

**Files:**
- Create: `public/styles.css`, `public/app.js`, `tests/contrast.test.js`
- Modify: `public/index.html` (replace with the new shell; remove the inline `<style>` and the old screens' script)

**Interfaces:**
- Consumes: `CarePulseCore.parseRoute`, `routeHash` and `guardRoute`.
- Produces, in `app.js`:

  | Function | Behaviour |
  | --- | --- |
  | `navigate(hash: string)` | Sets `location.hash`. |
  | `renderRoute()` | Runs on `hashchange` and on load. |
  | `registerPage(name: string, { render?: (params) => void\|Promise })` | Registers a page renderer. |
  | `api(path, { method, body, auth })` | Carried over unchanged. |
  | `withBusy(button, task)` | Carried over unchanged. |
  | `showToast(message, type, duration)` | Carried over unchanged. |
  | `hideToast()` | Carried over unchanged. |
  | `saveSession(values)`, `clearSession()` | Carried over unchanged. |
  | `getSession()` | Returns `{ role, token, parentName, patientName, patientId, doctorName }`. |
  | `logout(message?)` | Navigates to `'#/'`. |
  | `setThemePreference(value)` | Theme functions carried over from PR #4. |
  | `setCurrentReportPatient(patient)`, `getCurrentReportPatient()` | Carried over unchanged. |
  | `downloadReportPdf()` | Carried over unchanged; Tasks 5 and 6 call it. |

- Produces, in `index.html`:
  - one `<section class="page" data-page="NAME" hidden>` per route name
  - `<header class="site-nav">` for public pages and `<header class="app-header">` for the parent and doctor pages
  - `<footer class="site-footer">` shown only on `home`
  - the icon sprite, used as `<svg class="icon"><use href="#i-NAME"/></svg>`. `NAME` is one of `heart, activity, droplet, thermometer, gauge, file, shield, lock, users, settings, log-out, search, menu, x, chevron-right, arrow-right, check`.
- Produces, in `styles.css`, these tokens in `:root` and `:root[data-theme="dark"]`:

  `--bg --surface --surface-muted --surface-hover --border --border-strong --text --text-muted --text-faint --primary --primary-hover --primary-text --on-primary --accent --ecg-line --ecg-bg --ecg-grid --danger --danger-bg --success --success-bg --badge-bg --badge-text --focus-ring --shadow-sm --shadow-md --toast-bg --toast-text --toast-error-bg --toast-success-bg`

  Component classes:

  `.btn .btn-primary .btn-secondary .btn-ghost .btn-sm .is-busy .field .field-row .input .field-msg .card .badge .segmented .table .empty-state .toast .container .icon`

- [ ] **Step 1: Write `tests/contrast.test.js`.**
  - It reads `public/styles.css` and extracts the `:root{…}` and `:root[data-theme="dark"]{…}` blocks with a regex.
  - It resolves the hex values, then asserts a WCAG ratio of at least 4.5 for each pair in both themes:
    - `text/surface`, `text/surface-muted`, `text/bg`
    - `text-muted/surface`, `text-faint/surface`, `text-faint/surface-muted`
    - `primary-text/surface`
    - `danger/surface`
    - `on-primary/primary`, `on-primary/primary-hover`
    - `badge-text/badge-bg`
    - `toast-text/toast-bg`
    - `#FFFFFF/toast-error-bg`, `#FFFFFF/toast-success-bg`
- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `styles.css` doesn't exist.
- [ ] **Step 3: Write `public/styles.css`.**
  - Light values: the pinned values from Global Constraints. Dark values: start from PR #4's palette.
  - Make the token values pass the contrast test.
  - Base: Inter, a 16px body, a type scale of 40/32 (display), 28, 20, 16, 14, 12, `font-variant-numeric: tabular-nums` on `.table` and `.vital-value`, and the reduced-motion rule.
  - Components: as listed in Interfaces.
- [ ] **Step 4: Write the new `public/index.html` shell.**
  - Head: Inter only, the theme script carried over verbatim from PR #4, and `<link rel="stylesheet" href="styles.css">`. At the end of body: `core.js`, then `app.js`, both with `defer`.
  - Body: the icon sprite, both headers, empty page sections and the footer.
- [ ] **Step 5: Write the `public/app.js` skeleton.**
  - Carry over `api`, `withBusy`, the toasts, the session functions and the theme functions from the current `index.html`.
  - The router:
    - shows the matching section and hides the others
    - toggles `site-nav` / `app-header` / `site-footer`
    - sets `document.title` to `"{Page} · CarePulse"` (`"CarePulse"` for home)
    - moves focus to the section's `h1` (with `tabindex="-1"`)
    - scrolls to the top
  - Guard redirects with reason `login-required` show the toast "Please log in to continue." The 401 handler in `api()` calls `logout('Your session has expired. Please log in again.')`, which routes to `#/login`.
- [ ] **Step 6: Run `npm test`.** Expected: the `core` and `contrast` tests PASS.
- [ ] **Step 7: Browser check.**
  - Start the fake-DB server (scratchpad `run-tests.sh` pattern, port 3110).
  - Visit `#/`, `#/login`, `#/settings`, `#/dashboard` with no session, and `#/garbage`.
  - Expected:
    - the matching section is visible
    - `#/dashboard` redirects to `#/login` with the toast
    - `#/garbage` redirects to `#/`
    - there are no console errors
- [ ] **Step 8: Commit.** `git add public/ tests/contrast.test.js && git commit -m "Add design tokens, components, page shell and hash router"`

### Task 3: Home page and public navigation

**Files:**
- Modify: `public/index.html` (the home section, `site-nav` and `site-footer`), `public/styles.css` (home styles)
- Modify: `public/app.js` (the mobile menu toggle, in-page section links, and the hero preview ECG)

**Interfaces:**
- Consumes: `registerPage('home')`, `navigate()`, the icon sprite and the component classes.
- Produces: in-page anchors `#features`, `#how-it-works`, `#security` and `#team`. The nav links scroll to these with `scrollIntoView` and leave the route hash unchanged.

- [ ] **Step 1: Build the nav.**
  - Left: the logo. Middle: the four section links. Right: `⚙` (settings), `Log in` (`#/login`) and `Get started` (`#/register`, primary).
  - Under 768px, a ☰ button toggles a dropdown panel and sets `aria-expanded`.
- [ ] **Step 2: Build the home sections in this order, using the spec's exact copy.**
  1. **Hero:**
     - the eyebrow line "Remote patient monitoring"
     - the h1 "Continuous care, visible to the people who matter"
     - the subline "Live vitals for parents. A clear patient list for doctors."
     - buttons for Parent portal (`#/login`) and Doctor portal (`#/login/doctor`)
     - a preview card: four sample vitals tiles and an animated ECG, labelled "Sample data"
  2. **Features:** four cards with icons `activity`, `users`, `file` and `shield`.
  3. **How it works:** three numbered steps.
  4. **Security:** the four claims, exactly as Global Constraints lists them.
  5. **Team:** three placeholder cards, each with `<!-- TEAM-PLACEHOLDER -->`, plus a placeholder organisation line.
  6. **Closing call to action:** "Ready to get started?", with buttons for Register as a parent (`#/register`) and Doctor sign in (`#/login/doctor`).
  7. **Footer:**
     - columns for Product, Portals and Contact
     - the placeholder email `<!-- TEAM-PLACEHOLDER -->`
     - "© 2026 CarePulse"
     - "Not a substitute for professional medical advice."
- [ ] **Step 3: Browser check at 1280px, 768px and 375px, in light and dark.**
  - Expected:
    - no sideways scroll (`document.documentElement.scrollWidth === innerWidth`)
    - the menu opens and closes at 375px
    - each nav link scrolls to its section
    - the hero buttons route correctly
    - `grep -c "TEAM-PLACEHOLDER" public/index.html` is 4 or more
- [ ] **Step 4: Commit.** `git commit -am "Add home page and public navigation"`

### Task 4: Auth pages (sign in, parent and doctor registration, reset)

**Files:**
- Modify: `public/index.html` (the `login`, `register` and `reset` sections), `public/styles.css` (`.auth-layout`, `.auth-brand`, `.auth-card`), `public/app.js`

**Interfaces:**
- Consumes: `api`, `withBusy`, `saveSession`, `clearSession`, `navigate`, `showToast`.
- Produces:
  - `validateField(input, showMessage)` and `validateForm(form)`, carried over with the same rules: `email`, `password` (8+ characters), `dob` (not in the future), `phone` (10 digits) and `confirm`
  - one `<form novalidate>` per page, so Enter submits natively and the old global Enter handler goes away
  - successful logins call `navigate('#/dashboard')` for parents and `navigate('#/patients')` for doctors

- [ ] **Step 1: Build the split layout.**
  - The brand panel has the logo, the tagline, and three benefit lines with `check` icons.
  - The card holds the form. Under 900px it's a single column.
- [ ] **Step 2: Build the sign-in page.**
  - A **Parent | Doctor** segmented control that routes between `#/login` and `#/login/doctor`.
  - The parent form (email, password) with links to `#/reset-password` and `#/register`.
  - The doctor form (hospital ID, doctor ID, password) with a link to `#/register/doctor`.
- [ ] **Step 3: Build the registration pages.**
  - The parent form groups its fields: "Patient details" (name, DOB and auto age, gender), "Your details" (parent name; phone and email side by side) and "Account" (password and confirm side by side).
  - The doctor form is grouped the same way, plus the registration code.
  - The reset form has email, phone, patient ID, new password and confirm.
  - The API bodies, success messages, the patient ID alert after parent registration, and the field prefill on returning to login all stay identical to today.
- [ ] **Step 4: Browser check against the fake-DB server.**
  - Flows:
    - parent registration → sign in with Enter → lands on `#/dashboard`
    - wrong password → the "Incorrect email or password." toast
    - the doctor tab → a wrong registration code → "Invalid registration code." → the right code → back on `#/login/doctor` with the IDs filled in
    - reset password → "Password updated" → sign in with the new password
  - Review Focus 5: throttle `api` with `await new Promise(r=>setTimeout(r,3000))` in the console. Double-clicking Log in sends one request (check `read_network_requests` for exactly 1 POST `/api/parent-login`).
- [ ] **Step 5: Commit.** `git commit -am "Rebuild sign-in, registration and reset pages"`

### Task 5: App header and parent dashboard

**Files:**
- Modify: `public/index.html` (`app-header` and the `dashboard` section), `public/styles.css`, `public/app.js`

**Interfaces:**
- Consumes: `CarePulseCore.formatVital`, `recentReadings`, `lastReadingTime`, `initials`, `api`, `getSession`, `setCurrentReportPatient`, `downloadReportPdf`.
- Produces, as shared blocks that Task 6 reuses:

  | Function | Renders |
  | --- | --- |
  | `renderVitalCards(container: Element, patient)` | The four vital cards. |
  | `renderReadingsTable(container: Element, patient)` | The recent readings, or the empty state "Waiting for the first reading from the monitoring device." |
  | `renderEcgCard(container: Element, patient)` | The ECG card. |

- [ ] **Step 1: Build the app header.**
  - The logo links to the user's own dashboard.
  - ⚙ links to `#/settings`.
  - The user chip shows the initials, the name and the role ("Parent" / "Doctor"), truncated with an ellipsis at 180px.
  - **Log out** is a `.btn-secondary.btn-sm` that calls `logout()`.
- [ ] **Step 2: Build the dashboard.**
  - Show a loading state ("Loading…" placeholders in the vital cards) until `GET /api/patient/:id` resolves.
  - Then show:
    - the h1 "{patientName}'s health", the patient ID badge and the status badge
    - the vital cards, the ECG card and the readings table
    - a Download report button
  - If `patientId` is null, show the empty state "No patient is linked to this account yet." (Review Focus 3).
  - All user-supplied strings go in via `textContent`.
- [ ] **Step 3: Browser checks.**
  - The dashboard with 3 readings shows the 4 vitals and 3 table rows. With 0 readings it shows the empty state.
  - The PDF is generated: hook `jsPDF.API.save` and expect the file name `CarePulse_Report_…pdf`.
  - Logging out lands on `#/`.
  - Review Focus 1: set `sessionStorage.authToken='bad'`, then reload `#/dashboard`. Expected: `#/login` and the "session has expired" toast.
  - Review Focus 3: register a parent through the API and clear `patientId` in the fake DB file. Expected: the "No patient is linked" state.
- [ ] **Step 4: Commit.** `git commit -am "Add app header and parent dashboard"`

### Task 6: Doctor patient list and patient page

**Files:**
- Modify: `public/index.html` (the `patients` and `patient` sections), `public/styles.css`, `public/app.js`

**Interfaces:**
- Consumes: `CarePulseCore.filterPatients`, `ageFromDob`, `heartRateSummary`, plus `renderVitalCards`, `renderReadingsTable` and `renderEcgCard` from Task 5.

- [ ] **Step 1: Build the patient list.**
  - The h1 "Patients" with a count badge.
  - A search input that filters on every keystroke through `filterPatients`.
  - A `.table` with the columns Patient, ID, Age, Heart rate, Last reading and Status. The whole row is a link to `#/patients/:id`.
  - Under 640px, the rows become cards.
  - Empty states: "No patients registered yet." and "No patients match "{query}"."
- [ ] **Step 2: Build the patient page.**
  - A breadcrumb "Patients › {name}", then the h1 with name, ID, age and gender.
  - The vital cards, ECG and readings table.
  - A **Parent contact** card with name, phone (`tel:` link) and email (`mailto:` link).
  - A **Report summary** card with the monitoring period and `heartRateSummary`.
  - A Download report button.
  - An unknown ID shows "Patient not found" with a link to `#/patients` (Review Focus 4).
- [ ] **Step 3: Browser checks.**
  - Search for "riya" and then "CP".
  - Click a row, then use Back to return to the list, and Forward.
  - Refresh on `#/patients/:id` and confirm the page reloads.
  - Review Focus 2: a patient named `<img src=x onerror=alert(1)>` plus a 60+ character name.
    - Expected: text only, ellipsis in the table cell, no layout overflow at 375px, and `window.__xss` undefined.
  - Review Focus 4: `#/patients/CP000000` shows the not-found state.
- [ ] **Step 4: Commit.** `git commit -am "Add doctor patient list and patient page"`

### Task 7: Settings, cleanup, docs and full regression

**Files:**
- Modify: `public/index.html` (the `settings` section), `public/styles.css`, `public/app.js`, `README.md`

- [ ] **Step 1: Restyle Settings.**
  - An Appearance card with three radio cards (Light / Dark / System), using the PR #4 behaviour and key.
  - Settings is reachable from both headers.
  - **Back** uses `history.back()` when there's history, and falls back to `#/`.
- [ ] **Step 2: Remove dead code.**
  - Remove the old `navStack`, the `screen-*` ids, the unused CSS and the unused fonts.
  - `grep -n "screen-\|navStack\|Fraunces\|Plex" public/` returns nothing.
- [ ] **Step 3: Update the README.** Add a short "Project structure" list of the four public files, and `npm test`.
- [ ] **Step 4: Run the full regression.**
  - `npm test`: PASS.
  - The scratchpad `run-tests.sh` (68 API checks): PASS.
  - A browser matrix of every route at 1280, 768 and 375px in light and dark. Expected: no console errors and no sideways scroll.
  - Reduced motion: emulate it, and the ECG animation is off.
- [ ] **Step 5: Commit, push and open the PR.** Base `main`, head `adwaithas-2004:feature/site-redesign`. The description lists the TEAM-PLACEHOLDER spots and notes that PR #4 should be merged first.
