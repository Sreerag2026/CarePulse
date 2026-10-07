# CarePulse site redesign: design

**Date:** 2026-10-07
**Status:** Awaiting review
**Direction chosen:** A, "Clinical clean"

## Goal

Make CarePulse look and work like a professional health-tech website. The same site has to serve three audiences:

1. **Evaluators** of a project presentation.
2. **Investors or partners** watching a product pitch.
3. **Parents and doctors** using it day to day.

The public home page explains the product, and the parent and doctor portals behave like a clean web app.

## What changes, in one paragraph

Today the site is a phone-app mock-up shown on a desktop, with a fake status-bar clock and a fixed-height frame. It also has no home page. The redesign adds a real public home page and a proper top navigation bar. It gives the portals an app layout with an app header, and it uses one consistent visual system in light and dark mode. Every existing feature and API call stays: registration, logins, password reset, doctor registration with a code, dashboards, PDF reports and settings.

## Pages and addresses

Hash-based routes, so the browser's Back and Forward buttons, refresh and shared links all work. Routes that need a login send you to sign-in, and routes for the wrong role send you to your own dashboard.

| Address | Page | Who |
| --- | --- | --- |
| `#/` | Home | Everyone |
| `#/login` | Sign in, Parent tab | Everyone |
| `#/login/doctor` | Sign in, Doctor tab | Everyone |
| `#/register` | Parent registration | Everyone |
| `#/register/doctor` | Doctor registration (needs the code) | Everyone |
| `#/reset-password` | Parent password reset | Everyone |
| `#/dashboard` | Parent dashboard | Parent |
| `#/patients` | Doctor's patient list | Doctor |
| `#/patients/:patientId` | Patient page | Doctor |
| `#/settings` | Settings (Appearance) | Everyone |

**Removed screens:**
- The **Live ECG** and **Medical report** screens move into the patient page.
- The welcome screen is replaced by the home page.

## Public pages

**Top navigation (sticky):**
- the logo (heart mark and "CarePulse")
- the links Features · How it works · Security · Team, which scroll to sections on the home page
- on the right: ⚙ Settings, **Log in** and a primary **Get started** button, which goes to `#/register`
- under 768px wide, the links collapse into a ☰ menu

**Home page sections:**
1. **Hero:**
   - the eyebrow line "Remote patient monitoring"
   - the headline "Continuous care, visible to the people who matter"
   - a one-line subline
   - buttons for **Parent portal** (`#/login`) and **Doctor portal** (`#/login/doctor`)
   - on the right, a dashboard preview card: vitals tiles and an animated ECG, labelled "Sample data"
2. **Features:** four cards, each with an icon:
   - Live vitals
   - Doctor dashboard
   - One-click PDF reports
   - Private and secure
3. **How it works:** three numbered steps:
   1. Register your child.
   2. The monitoring device sends readings.
   3. Parents and doctors see updates and download reports.
4. **Security and privacy:** only claims the code backs up:
   - passwords are hashed with bcrypt
   - parents see only their own child
   - doctor accounts need a hospital registration code
   - sessions are signed and expire after 12 hours

   No compliance claims such as HIPAA.
5. **Team:**
   - cards with an initials avatar, name and role
   - a line for the college or organisation
   - placeholder content, marked with `TEAM-PLACEHOLDER` comments, until the real details arrive
6. **Closing call to action:** "Ready to get started?", with **Register as a parent** and **Doctor sign in**.
7. **Footer:**
   - the logo and tagline
   - link columns: Product · Portals · Contact
   - the contact email, a placeholder `TEAM-PLACEHOLDER` until the real one arrives
   - "© 2026 CarePulse"
   - "Not a substitute for professional medical advice."

The page has no made-up testimonials, user counts or statistics.

## Portal pages

**Sign in, register and reset (split layout):**
- On desktop: a teal brand panel on the left (logo, tagline, three short benefit lines) and the form card on the right.
- Under 900px: the form only, with the logo above it.
- Sign in has a **Parent | Doctor** switch. Parent shows "Forgot password?" and "Create an account". Doctor shows "Register with a code".
- Registration groups fields under the headings "Patient details", "Your details" and "Account". Pairs sit side by side on desktop: DOB and Age, Phone and Email, Password and Confirm.
- The validation rules, messages and API calls stay as they are today.

**App header (after login):**
- the logo, linking to the user's own dashboard
- ⚙ Settings
- the user chip: initials, name and role
- a visible **Log out** button

**Parent dashboard (`#/dashboard`):**
- the heading "{Patient name}'s health", with the patient ID and a monitoring-status badge
- four **vital cards**: heart rate, SpO₂, temperature and blood pressure, each with an icon, value, unit and label
- an **ECG card**
- a **Recent readings** table with the 10 newest: time, HR, SpO₂, temperature, BP
- a **Download report** button
- before any readings arrive, an empty state: "Waiting for the first reading from the monitoring device."

**Doctor patient list (`#/patients`):**
- the heading "Patients" with a count
- a **search box** that filters by name or ID in the browser
- a table with patient, ID, age, latest heart rate, last reading and status, where a whole row is clickable
- under 640px, the rows become cards
- an empty state when there are no patients, and another when the search matches nothing

**Patient page (`#/patients/:id`):**
- the breadcrumb "Patients › Name", then ID, age and gender
- the same vitals, ECG and recent-readings blocks as the parent dashboard
- a **Parent contact** card: name, phone and email
- a **Report summary**: the monitoring period and the average heart rate
- **Download report**

**Settings (`#/settings`):** the Appearance choice from PR #4 (Light, Dark, System), restyled to match.

## Visual system

- **Type:** Inter only, loaded from Google Fonts. The Fraunces and IBM Plex Mono fonts are dropped.
  - Scale: 40/32 for the display headline (desktop/mobile), then 28, 20, 16 for body and 14 and 12 for small text.
  - Weights 400, 500 and 600.
  - Vitals and tables use tabular numerals.
- **Colour tokens:** a refined set of the existing tokens, keeping the light and dark palettes from PR #4. In light mode:

  | Role | Light value |
  | --- | --- |
  | Page background | `#F6F8F8` |
  | Surfaces | white |
  | Primary | teal `#0F7A6C` |
  | Coral | ECG and alerts only |
  | Borders | `#E2E8E7` |
  | Text | ink `#12313B` |

  - **Contrast:** every text and background pair is at least 4.5:1 in both themes, including the small labels that are 2.6–3:1 today.
- **Components:**
  - **Buttons:** primary (filled teal), secondary (outline) and ghost.
  - **Shapes:** 8px radius for controls, 12px for cards, 1px borders.
  - **Shadows:** a soft shadow on cards and the sticky header only.
  - **Also included:** badges, a segmented control, tables, empty states and toasts (kept).
- **Icons:** a small inline SVG icon set in the Lucide line style, built into the page with no extra downloads. It covers heart, activity, droplet, thermometer, gauge, file, shield, lock, users, settings, log-out, search, menu, chevrons and arrow.
- **Motion:**
  - short 150–200ms transitions
  - the ECG line animates
  - with `prefers-reduced-motion` set, animations are turned off

## Technical approach

- **Files:** `public/index.html` (markup), `public/styles.css` (all styles) and `public/app.js` (all behaviour). The inline theme script that prevents a flash stays in `<head>`.
- **No framework and no build step.** Express keeps serving `public/` as-is, and nothing changes on Render.
- **Routing:** a small hash router maps routes to page sections, runs route guards, and moves focus to the page heading on navigation, which helps accessibility.
- **API:** the same calls and request bodies as today. `api()`, the session and token handling, `withBusy` and the toasts carry over unchanged.
- **The PDF report** generator is unchanged. It still reads the current patient object, which every page that offers **Download report** sets.
- **No server changes.** `GET /api/patients` and `GET /api/patient/:id` already return everything the new pages show.

## Testing

- Re-run all 68 API checks; they must still pass.
- In the browser, in light and dark at 1280px, 768px and 375px widths:
  - every route
  - the full flows: parent register → login → dashboard → PDF → logout, and doctor register → login → search → patient page → logout
  - password reset
  - route guards and the Back/Forward/refresh behaviour
  - empty states
  - session expiry
- Compute text contrast for every token pair in both themes; all must be at least 4.5:1.
- No console errors and no sideways scrolling at any width.

## Out of scope

- Real team names and the contact email (placeholders until supplied).
- Any new backend features, such as live streaming of ECG data, editing patients, or email-based password reset.
- A multi-page framework rewrite.
