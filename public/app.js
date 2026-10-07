// CarePulse front end: routing, session, API access and page rendering.
// Pure helpers (routes, guards, formatting) live in core.js as window.CarePulseCore.
const Core = window.CarePulseCore;

// ---------------- Toasts ----------------
let toastTimer = null;

function showToast(message, type = 'info', duration = 4500){
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast(){
  document.getElementById('toast').classList.remove('show');
}

// ---------------- Backend API ----------------
// The Node server serves this page, so API calls go to the same origin.
// Opening the file directly from disk falls back to a local server.
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
const REQUEST_TIMEOUT_MS = 90000;
const SLOW_REQUEST_MS = 4000;

async function api(path, { method = 'GET', body, auth = true } = {}){
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = sessionStorage.getItem('authToken');
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Free hosting puts the server to sleep; the first request can take close to a minute.
  let slowNoticeShown = false;
  const slowNotice = setTimeout(() => {
    slowNoticeShown = true;
    showToast('Waking up the server — this can take up to a minute…', 'info', REQUEST_TIMEOUT_MS);
  }, SLOW_REQUEST_MS);

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error){
    throw new Error(error.name === 'AbortError'
      ? 'The server took too long to respond. Please try again.'
      : 'Unable to reach the CarePulse server. Check your internet connection and try again.');
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowNotice);
    if (slowNoticeShown) hideToast();
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && auth && token){
    // Send doctors back to the Doctor tab, parents to the Parent tab.
    logout('Your session has expired. Please log in again.', Core.loginHash(getSession().role));
    const error = new Error('Session expired');
    error.handled = true;
    throw error;
  }

  if (!response.ok){
    const error = new Error(data.message || `Request failed (error ${response.status}). Please try again.`);
    error.status = response.status;
    throw error;
  }

  return data;
}

// Disables the button and shows a spinner while the request runs; errors become a toast.
async function withBusy(button, task){
  if (button && button.disabled) return;
  if (button){
    button.disabled = true;
    button.classList.add('is-busy');
  }
  try {
    return await task();
  } catch (error){
    console.error(error);
    if (!error.handled) showToast(error.message, 'error', 6000);
  } finally {
    if (button){
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }
}

// ---------------- Session ----------------
const SESSION_KEYS = ['authToken', 'role', 'parentName', 'patientName', 'patientId', 'doctorName', 'reportPatient'];
let currentReportPatient = null;

function saveSession(values){
  Object.entries(values).forEach(([key, value]) => sessionStorage.setItem(key, value ?? ''));
}

function clearSession(){
  SESSION_KEYS.forEach(key => sessionStorage.removeItem(key));
  currentReportPatient = null;
}

function getSession(){
  const token = sessionStorage.getItem('authToken');
  return {
    token,
    role: token ? (sessionStorage.getItem('role') || null) : null,
    parentName: sessionStorage.getItem('parentName') || '',
    patientName: sessionStorage.getItem('patientName') || '',
    patientId: sessionStorage.getItem('patientId') || '',
    doctorName: sessionStorage.getItem('doctorName') || ''
  };
}

function logout(message = 'You have been logged out.', redirect = '#/'){
  // Drop any page load still in flight, so its response can't write data back after logout.
  renderSeq += 1;
  clearSession();
  resetPrivatePages();
  navigate(redirect);
  showToast(message);
}

// Logout must not leave one user's patients, contacts or search behind for the next person.
function resetPrivatePages(){
  allPatients = [];
  document.getElementById('patients-body').replaceChildren();
  document.getElementById('patient-search').value = '';
  const count = document.getElementById('patients-count');
  count.textContent = '';
  count.hidden = true;
  ['doctor-greeting', 'patient-crumb', 'dash-patient-id', 'dash-status', 'user-initials', 'user-name', 'user-role']
    .forEach(id => { document.getElementById(id).textContent = ''; });
  document.getElementById('patient-title').textContent = 'Patient';
  document.getElementById('dash-title').textContent = "Your child's health";
  ['patient-meta', 'patient-vitals', 'patient-ecg', 'patient-readings', 'patient-contact', 'patient-summary',
    'dash-vitals', 'dash-ecg', 'dash-readings']
    .forEach(id => document.getElementById(id).replaceChildren());
}

// The report patient feeds the PDF; clear it whenever a page starts loading someone else.
function clearReportPatient(){
  currentReportPatient = null;
  sessionStorage.removeItem('reportPatient');
}

function setCurrentReportPatient(patient){
  currentReportPatient = patient;
  if (patient){
    sessionStorage.setItem('reportPatient', JSON.stringify(patient));
  }
}

function getCurrentReportPatient(){
  if (currentReportPatient) return currentReportPatient;
  try {
    return JSON.parse(sessionStorage.getItem('reportPatient') || 'null');
  } catch {
    return null;
  }
}

// ---------------- Theme ----------------
// Saved per device. The <head> script applies it before the first paint; this keeps it in sync.
const THEME_STORAGE_KEY = 'carepulse-theme';
const systemDarkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themePreference = readStoredTheme();

function readStoredTheme(){
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(){
  const dark = themePreference === 'dark' ||
    (themePreference === 'system' && Boolean(systemDarkQuery && systemDarkQuery.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0B1517' : '#0F7A6C';
}

function setThemePreference(preference){
  themePreference = preference;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be blocked (e.g. private browsing); the theme still applies for this visit.
  }
  applyTheme();
}

// In System mode, follow the device when it switches between light and dark.
if (systemDarkQuery){
  systemDarkQuery.addEventListener('change', () => {
    if (themePreference === 'system') applyTheme();
  });
}
applyTheme();

// ---------------- Router ----------------
const pages = {};
const APP_PAGES = ['dashboard', 'patients', 'patient'];
const PAGE_TITLES = {
  login: 'Sign in',
  register: 'Create an account',
  reset: 'Reset password',
  dashboard: 'Dashboard',
  patients: 'Patients',
  patient: 'Patient',
  settings: 'Settings'
};
let hasRendered = false;
// Increments on every navigation (and on logout). A page load whose number is no longer current
// is stale: the user has moved on, so its response must not touch the page.
let renderSeq = 0;
// Pages shown in this visit; Settings' Back button uses it to know whether there's somewhere to go back to.
let renderedRoutes = 0;

function registerPage(name, options = {}){
  pages[name] = options;
}

function navigate(hash){
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

async function renderRoute(){
  const route = Core.parseRoute(location.hash);
  const session = getSession();
  const { redirect, reason } = Core.guardRoute(route, session);

  if (redirect){
    if (reason === 'login-required') showToast('Please log in to continue.');
    // Replace, so Back doesn't bounce the user into the same redirect again.
    location.replace(redirect);
    return;
  }

  document.querySelectorAll('.page').forEach(section => {
    section.hidden = section.dataset.page !== route.name;
  });

  // Signed-in users keep the app header on settings too.
  const inApp = APP_PAGES.includes(route.name) || (route.name === 'settings' && Boolean(session.role));
  document.querySelector('.site-nav').hidden = inApp;
  document.querySelector('.app-header').hidden = !inApp;
  document.querySelector('.site-footer').hidden = route.name !== 'home';
  document.getElementById('app-home-link').setAttribute('href', session.role === 'doctor' ? '#/patients' : '#/dashboard');
  if (inApp) renderAppHeader(session);

  document.title = PAGE_TITLES[route.name] ? `${PAGE_TITLES[route.name]} · CarePulse` : 'CarePulse';
  window.scrollTo(0, 0);

  // Move focus to the new page's heading so screen readers announce the change.
  const heading = document.querySelector(`.page[data-page="${route.name}"] h1`);
  if (heading){
    heading.setAttribute('tabindex', '-1');
    if (hasRendered) heading.focus({ preventScroll: true });
  }
  hasRendered = true;
  renderedRoutes += 1;

  const seq = ++renderSeq;
  const isStale = () => seq !== renderSeq;

  const page = pages[route.name];
  if (page && page.render) await page.render(route.params, isStale);
}

window.addEventListener('hashchange', renderRoute);

// ---------------- Public navigation ----------------
const navToggle = document.querySelector('.nav-toggle');
const siteMenu = document.getElementById('site-menu');
let pendingSectionScroll = null;

function setMenuOpen(open){
  siteMenu.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  navToggle.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
}

navToggle.addEventListener('click', () => setMenuOpen(!siteMenu.classList.contains('open')));
window.addEventListener('hashchange', () => setMenuOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && siteMenu.classList.contains('open')){
    setMenuOpen(false);
    navToggle.focus();
  }
});

// Section links (Features, How it works, …) scroll on the home page without changing the route.
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-scroll]');
  if (!link) return;
  event.preventDefault();
  setMenuOpen(false);

  if (Core.parseRoute(location.hash).name === 'home'){
    document.getElementById(link.dataset.scroll).scrollIntoView({ block: 'start' });
  } else {
    pendingSectionScroll = link.dataset.scroll;
    navigate('#/');
  }
});

registerPage('home', {
  render(){
    if (!pendingSectionScroll) return;
    const target = document.getElementById(pendingSectionScroll);
    pendingSectionScroll = null;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
});

// ---------------- Form validation ----------------
function fieldValue(id){
  return document.getElementById(id).value.trim();
}

function validateField(input, showMessage){
  const rule = input.dataset.validate;
  const val = input.value.trim();
  let valid = val.length > 0;
  let message = 'Required';

  if (rule === 'email'){
    valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    message = val.length === 0 ? 'Required' : 'Enter a valid email address with @ and a domain such as .com';
  } else if (rule === 'password'){
    valid = val.length >= 8;
    message = val.length === 0 ? 'Required' : 'Password must contain at least 8 characters';
  } else if (rule === 'dob'){
    const selectedDate = new Date(val + 'T00:00:00');
    valid = Boolean(val) && !Number.isNaN(selectedDate.getTime()) && selectedDate <= new Date();
    message = val.length === 0 ? 'Required' : 'Enter a valid date of birth';
  } else if (rule === 'phone'){
    valid = /^\d{10}$/.test(val.replace(/\D/g, ''));
    message = val.length === 0 ? 'Required' : 'Invalid phone number. Enter exactly 10 digits';
  } else if (rule === 'confirm'){
    const target = document.getElementById(input.dataset.confirmTarget);
    valid = val.length > 0 && input.value === (target ? target.value : '');
    message = val.length === 0 ? 'Required' : 'Passwords don’t match';
  }

  input.classList.toggle('invalid', !valid);
  input.setAttribute('aria-invalid', String(!valid));

  const msgEl = input.closest('.field').querySelector('.field-msg');
  if (msgEl) msgEl.textContent = (!valid && showMessage) ? message : '';
  return valid;
}

function validateForm(form){
  let firstInvalid = null;
  form.querySelectorAll('[data-validate]').forEach(input => {
    if (!validateField(input, true) && !firstInvalid) firstInvalid = input;
  });
  if (firstInvalid) firstInvalid.focus();
  return !firstInvalid;
}

// Fresh pages start neutral; errors appear once the user interacts or submits.
function resetValidation(container){
  container.querySelectorAll('[data-validate]').forEach(input => {
    input.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
    const msgEl = input.closest('.field').querySelector('.field-msg');
    if (msgEl) msgEl.textContent = '';
  });
}

document.addEventListener('input', (event) => {
  const input = event.target;
  if (input.type === 'tel') input.value = input.value.replace(/\D/g, '').slice(0, 10);
  if (!input.matches('[data-validate]')) return;

  // Re-check only fields that were already flagged, so nobody is told off mid-typing.
  if (input.classList.contains('invalid')) validateField(input, true);
  if (input.id){
    document.querySelectorAll(`[data-confirm-target="${input.id}"]`).forEach(confirm => {
      if (confirm.value) validateField(confirm, true);
    });
  }
});

document.addEventListener('focusout', (event) => {
  if (event.target.matches('[data-validate]') && event.target.value.trim()){
    validateField(event.target, true);
  }
});

// Runs a form's handler on submit (Enter or button), with validation and a busy button.
function onSubmit(formId, handler){
  const form = document.getElementById(formId);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateForm(form)) return;
    withBusy(form.querySelector('[type="submit"]'), () => handler(form));
  });
}

// ---------------- Auth pages ----------------
const brandTemplate = document.getElementById('auth-brand-template');
document.querySelectorAll('[data-auth-brand]').forEach(slot => slot.appendChild(brandTemplate.content.cloneNode(true)));

// Login and registration pages each hold a parent and a doctor form; show the one for the route's role.
function showRoleForms(pageName, role){
  const section = document.querySelector(`.page[data-page="${pageName}"]`);
  section.querySelectorAll('[data-role-tab]').forEach(tab => {
    if (tab.dataset.roleTab === role) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  section.querySelectorAll('[data-role-form]').forEach(form => {
    form.hidden = form.dataset.roleForm !== role;
  });
  const subtitle = section.querySelector('[data-role-text]');
  if (subtitle) subtitle.textContent = subtitle.dataset[role] || '';
  resetValidation(section);
}

registerPage('login', { render: (params) => showRoleForms('login', params.role) });
registerPage('register', { render: (params) => showRoleForms('register', params.role) });
registerPage('reset', { render: () => resetValidation(document.querySelector('.page[data-page="reset"]')) });

onSubmit('parent-login-form', async () => {
  const data = await api('/api/parent-login', {
    method: 'POST',
    auth: false,
    body: { email: fieldValue('login-email'), password: document.getElementById('login-password').value }
  });

  clearSession();
  saveSession({
    authToken: data.token,
    role: 'parent',
    parentName: data.parentName,
    patientName: data.patientName,
    patientId: data.patientId
  });
  document.getElementById('login-password').value = '';
  navigate('#/dashboard');
  showToast(`Welcome, ${data.parentName || 'back'}!`, 'success');
});

onSubmit('doctor-login-form', async () => {
  const data = await api('/api/doctor-login', {
    method: 'POST',
    auth: false,
    body: {
      hospitalId: fieldValue('doctor-hospital-id'),
      doctorId: fieldValue('doctor-id'),
      password: document.getElementById('doctor-password').value
    }
  });

  clearSession();
  saveSession({ authToken: data.token, role: 'doctor', doctorName: data.doctorName });
  document.getElementById('doctor-password').value = '';
  navigate('#/patients');
  showToast(`Welcome${data.doctorName ? ', ' + data.doctorName : ''}!`, 'success');
});

onSubmit('parent-register-form', async (form) => {
  const email = fieldValue('reg-email');
  const data = await api('/api/register', {
    method: 'POST',
    auth: false,
    body: {
      patientName: fieldValue('patient-name'),
      dob: fieldValue('reg-dob'),
      gender: fieldValue('reg-gender'),
      parentName: fieldValue('parent-name'),
      phone: fieldValue('phone-number'),
      email,
      password: document.getElementById('reg-password').value
    }
  });

  alert(`Registration successful!\n\nPatient ID: ${data.patientId}\n\nPlease note this ID down — you will need it if you ever reset your password.`);
  form.reset();
  document.getElementById('login-email').value = email;
  navigate('#/login');
});

onSubmit('doctor-register-form', async (form) => {
  const hospitalId = fieldValue('dr-reg-hospital-id');
  const doctorId = fieldValue('dr-reg-doctor-id');
  const data = await api('/api/doctor-register', {
    method: 'POST',
    auth: false,
    body: {
      hospitalId,
      doctorId,
      doctorName: fieldValue('dr-reg-name'),
      password: document.getElementById('dr-reg-password').value,
      signupCode: fieldValue('dr-reg-code')
    }
  });

  form.reset();
  document.getElementById('doctor-hospital-id').value = data.hospitalId || hospitalId;
  document.getElementById('doctor-id').value = data.doctorId || doctorId;
  navigate('#/login/doctor');
  showToast('Registration successful. You can log in now.', 'success');
});

onSubmit('reset-form', async (form) => {
  const email = fieldValue('fp-email');
  const data = await api('/api/reset-password', {
    method: 'POST',
    auth: false,
    body: {
      email,
      phone: fieldValue('fp-phone'),
      patientId: fieldValue('fp-patient-id'),
      newPassword: document.getElementById('fp-password').value
    }
  });

  form.reset();
  document.getElementById('login-email').value = email;
  navigate('#/login');
  showToast(data.message || 'Password updated.', 'success');
});

// Date of birth: no future dates, and the age fills itself in.
(function(){
  const dobInput = document.getElementById('reg-dob');
  const ageInput = document.getElementById('reg-age');
  const today = new Date();
  dobInput.max = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const updateAge = () => { ageInput.value = Core.ageFromDob(dobInput.value); };
  dobInput.addEventListener('change', updateAge);
  dobInput.addEventListener('input', updateAge);
})();

// ---------------- DOM helpers ----------------
// Builds an element with text set via textContent, so names typed by users can never become HTML.
function el(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function iconEl(name){
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

function cardHead(title, iconName, note){
  const head = el('div', 'card-head');
  const titleEl = el('h2', 'card-title');
  titleEl.append(iconEl(iconName), title);
  head.appendChild(titleEl);
  if (note) head.appendChild(el('span', 'text-caption', note));
  return head;
}

function formatDateTime(value){
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderStatusBadge(badge, status){
  const active = !status || status.toLowerCase() === 'active';
  badge.className = active ? 'badge badge-dot' : 'badge badge-neutral';
  badge.textContent = `Monitoring ${(status || 'Active').toLowerCase()}`;
}

// ---------------- App header ----------------
function renderAppHeader(session){
  const name = session.role === 'doctor' ? (session.doctorName || 'Doctor') : (session.parentName || 'Parent');
  document.getElementById('user-initials').textContent = Core.initials(name);
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-name').title = name;
  document.getElementById('user-role').textContent = session.role === 'doctor' ? 'Doctor' : 'Parent';
}

// ---------------- Shared patient blocks (parent dashboard and doctor's patient page) ----------------
const VITALS = [
  { key: 'heartRate', label: 'Heart rate', unit: 'bpm', icon: 'heart' },
  { key: 'oxygenLevel', label: 'Oxygen (SpO₂)', unit: '%', icon: 'droplet' },
  { key: 'temperature', label: 'Temperature', unit: '°', icon: 'thermometer' },
  { key: 'bloodPressure', label: 'Blood pressure', unit: 'mmHg', icon: 'gauge' }
];

// patient === null renders the loading state.
function renderVitalCards(container, patient){
  container.replaceChildren(...VITALS.map(vital => {
    const card = el('div', 'card vital-card');
    const icon = el('span', 'vital-icon');
    icon.appendChild(iconEl(vital.icon));
    const value = el('div', 'vital-card-value vital-value');

    if (!patient){
      value.textContent = 'Loading…';
      value.classList.add('is-loading');
    } else if (Core.hasValue(patient[vital.key])){
      value.append(String(patient[vital.key]), el('small', null, vital.unit));
    } else {
      value.textContent = '—';
    }

    card.append(icon, el('span', 'vital-card-label', vital.label), value);
    return card;
  }));
}

function renderEcgCard(container, patient){
  const note = patient && Core.hasValue(patient.heartRate) ? `Latest heart rate: ${patient.heartRate} bpm` : 'Illustrative waveform';
  const panel = el('div', 'ecg-panel ecg-panel-large');
  panel.innerHTML = '<svg class="ecg-line" viewBox="0 0 500 100" preserveAspectRatio="none" aria-hidden="true"><path d="M 0 50 L 30 50 L 40 30 L 50 70 L 60 10 L 70 90 L 80 50 L 120 50 L 130 30 L 140 70 L 150 10 L 160 90 L 170 50 L 210 50 L 220 30 L 230 70 L 240 10 L 250 90 L 260 50 L 300 50 L 310 30 L 320 70 L 330 10 L 340 90 L 350 50 L 390 50 L 400 30 L 410 70 L 420 10 L 430 90 L 440 50 L 500 50"/></svg>';
  container.replaceChildren(cardHead('ECG', 'activity', note), panel);
}

// patient === null renders the loading state.
function renderReadingsTable(container, patient){
  const when = Core.lastReadingTime(patient);
  const head = cardHead('Recent readings', 'clock', when ? `Last reading ${formatDateTime(when)}` : null);

  if (!patient){
    container.replaceChildren(head, el('p', 'is-loading', 'Loading readings…'));
    return;
  }

  const readings = Core.recentReadings(patient, 10);
  if (!readings.length){
    const empty = el('div', 'empty-state');
    const icon = el('div', 'empty-icon');
    icon.appendChild(iconEl('activity'));
    empty.append(icon, el('h3', null, 'Waiting for the first reading from the monitoring device.'),
      el('p', null, 'Readings appear here as soon as the device sends them.'));
    container.replaceChildren(head, empty);
    return;
  }

  const table = el('table', 'table');
  const headRow = el('tr');
  ['Time', 'Heart rate', 'SpO₂', 'Temperature', 'Blood pressure'].forEach(label => headRow.appendChild(el('th', null, label)));
  table.appendChild(el('thead')).appendChild(headRow);

  const body = el('tbody');
  readings.forEach(reading => {
    const row = el('tr');
    row.append(
      el('td', null, reading.recordedAt ? formatDateTime(reading.recordedAt) : '—'),
      el('td', null, Core.formatVital(reading.heartRate, ' bpm')),
      el('td', null, Core.formatVital(reading.oxygenLevel, '%')),
      el('td', null, Core.formatVital(reading.temperature, '°')),
      el('td', null, Core.formatVital(reading.bloodPressure, ' mmHg'))
    );
    body.appendChild(row);
  });
  table.appendChild(body);

  const wrap = el('div', 'table-wrap');
  wrap.appendChild(table);
  container.replaceChildren(head, wrap);
}

// ---------------- Parent dashboard ----------------
registerPage('dashboard', {
  async render(params, isStale){
    const session = getSession();
    const body = document.getElementById('dash-body');
    const empty = document.getElementById('dash-empty');
    const download = document.getElementById('dash-download');
    const title = document.getElementById('dash-title');
    const idBadge = document.getElementById('dash-patient-id');
    const statusBadge = document.getElementById('dash-status');

    // Older accounts can exist without a linked patient record.
    if (!session.patientId){
      title.textContent = `Welcome, ${session.parentName || 'there'}`;
      idBadge.hidden = statusBadge.hidden = download.hidden = body.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    body.hidden = download.hidden = idBadge.hidden = false;
    statusBadge.hidden = true;
    // No report until this patient's data has arrived; an earlier download would be incomplete.
    clearReportPatient();
    download.disabled = true;
    title.textContent = `${session.patientName || 'Your child'}'s health`;
    idBadge.textContent = `Patient ID ${session.patientId}`;
    renderVitalCards(document.getElementById('dash-vitals'), null);
    renderEcgCard(document.getElementById('dash-ecg'), null);
    renderReadingsTable(document.getElementById('dash-readings'), null);

    try {
      const patient = await api(`/api/patient/${encodeURIComponent(session.patientId)}`);
      if (isStale()) return;
      setCurrentReportPatient(patient);
      download.disabled = false;
      title.textContent = `${patient.patientName || 'Your child'}'s health`;
      renderStatusBadge(statusBadge, patient.monitoringStatus);
      statusBadge.hidden = false;
      renderVitalCards(document.getElementById('dash-vitals'), patient);
      renderEcgCard(document.getElementById('dash-ecg'), patient);
      renderReadingsTable(document.getElementById('dash-readings'), patient);
    } catch (error){
      console.error(error);
      if (error.handled || isStale()) return;
      renderVitalCards(document.getElementById('dash-vitals'), {});
      const readings = document.getElementById('dash-readings');
      readings.replaceChildren(cardHead('Recent readings', 'clock'), el('p', 'text-muted', "Couldn't load the latest readings. Refresh the page to try again."));
      showToast(error.message, 'error', 6000);
    }
  }
});

// ---------------- Doctor: patient list ----------------
let allPatients = [];

function patientAge(patient){
  const age = patient.dob ? Core.ageFromDob(patient.dob) : patient.age;
  return Core.hasValue(age) ? age : null;
}

function showPatientsEmpty(title, text){
  document.getElementById('patients-table-wrap').hidden = true;
  document.getElementById('patients-empty').hidden = false;
  document.getElementById('patients-empty-title').textContent = title;
  document.getElementById('patients-empty-text').textContent = text;
}

function cell(text, label){
  const td = el('td', null, text);
  if (label) td.dataset.label = label;
  return td;
}

function renderPatientRows(query){
  const tbody = document.getElementById('patients-body');
  const matches = Core.filterPatients(allPatients, query);

  if (!allPatients.length){
    showPatientsEmpty('No patients registered yet.', 'Patients appear here once their parents register.');
    return;
  }
  if (!matches.length){
    showPatientsEmpty(`No patients match "${query.trim()}".`, 'Check the spelling, or search by patient ID.');
    return;
  }

  document.getElementById('patients-table-wrap').hidden = false;
  document.getElementById('patients-empty').hidden = true;

  tbody.replaceChildren(...matches.map(patient => {
    const href = Core.routeHash('patient', { patientId: patient.patientId });
    const row = el('tr');
    row.addEventListener('click', (event) => {
      if (!event.target.closest('a')) navigate(href);
    });

    const nameCell = el('td', 'patient-col');
    const wrapper = el('div', 'patient-cell');
    const avatar = el('span', 'avatar avatar-sm', Core.initials(patient.patientName));
    avatar.setAttribute('aria-hidden', 'true');
    const text = el('div', 'patient-cell-text');
    const link = el('a', 'patient-link', patient.patientName || 'Unnamed patient');
    link.href = href;
    link.title = patient.patientName || '';
    text.append(link, el('span', 'patient-sub', patient.parentName ? `Parent: ${patient.parentName}` : ''));
    wrapper.append(avatar, text);
    nameCell.appendChild(wrapper);

    const age = patientAge(patient);
    const statusCell = el('td');
    statusCell.dataset.label = 'Status';
    const badge = el('span');
    renderStatusBadge(badge, patient.monitoringStatus);
    statusCell.appendChild(badge);

    row.append(
      nameCell,
      cell(patient.patientId, 'ID'),
      cell(age === null ? '—' : `${age} yrs`, 'Age'),
      cell(Core.formatVital(patient.heartRate, ' bpm'), 'Heart rate'),
      cell(patient.lastReadingAt ? formatDateTime(patient.lastReadingAt) : '—', 'Last reading'),
      statusCell
    );
    return row;
  }));
}

document.getElementById('patient-search').addEventListener('input', (event) => renderPatientRows(event.target.value));

registerPage('patients', {
  async render(params, isStale){
    const session = getSession();
    document.getElementById('doctor-greeting').textContent = session.doctorName ? `Signed in as ${session.doctorName}` : '';
    const search = document.getElementById('patient-search');
    const count = document.getElementById('patients-count');

    document.getElementById('patients-table-wrap').hidden = false;
    document.getElementById('patients-empty').hidden = true;
    const loadingRow = el('tr', 'table-note');
    const loadingCell = el('td', null, 'Loading patients…');
    loadingCell.colSpan = 6;
    loadingRow.appendChild(loadingCell);
    document.getElementById('patients-body').replaceChildren(loadingRow);

    let patients;
    try {
      patients = await api('/api/patients');
    } catch (error){
      console.error(error);
      if (error.handled || isStale()) return;
      showPatientsEmpty("Couldn't load patients.", 'Refresh the page to try again.');
      showToast(error.message, 'error', 6000);
      return;
    }

    if (isStale()) return;
    allPatients = patients;
    count.textContent = String(allPatients.length);
    count.hidden = false;
    renderPatientRows(search.value);
  }
});

// ---------------- Doctor: patient page ----------------
function detailList(rows){
  const list = el('dl', 'detail-list');
  rows.forEach(([label, value]) => {
    const row = el('div');
    const dd = el('dd');
    if (value instanceof Node) dd.appendChild(value);
    else dd.textContent = value;
    row.append(el('dt', null, label), dd);
    list.appendChild(row);
  });
  return list;
}

function contactLink(href, iconName, text){
  const link = el('a');
  link.href = href;
  link.append(iconEl(iconName), text);
  return link;
}

function renderPatientMeta(patient){
  const meta = document.getElementById('patient-meta');
  const badges = [el('span', 'badge badge-neutral', `ID ${patient.patientId}`)];
  const age = patientAge(patient);
  if (age !== null) badges.push(el('span', 'badge badge-neutral', `${age} years`));
  if (patient.gender) badges.push(el('span', 'badge badge-neutral', patient.gender));
  const status = el('span');
  renderStatusBadge(status, patient.monitoringStatus);
  badges.push(status);
  meta.replaceChildren(...badges);
}

function renderPatientContact(patient){
  const phone = String(patient.parentPhone || '').replace(/\D/g, '');
  document.getElementById('patient-contact').replaceChildren(
    cardHead('Parent contact', 'users'),
    detailList([
      ['Name', patient.parentName || '—'],
      ['Phone', phone ? contactLink(`tel:${phone}`, 'phone', phone) : '—'],
      ['Email', patient.parentEmail ? contactLink(`mailto:${patient.parentEmail}`, 'mail', patient.parentEmail) : '—']
    ])
  );
}

function renderPatientSummary(patient){
  const formatDate = value => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const start = patient.createdAt ? formatDate(patient.createdAt) : '—';
  const end = formatDate(Core.lastReadingTime(patient) || Date.now());
  document.getElementById('patient-summary').replaceChildren(
    cardHead('Report summary', 'file'),
    detailList([
      ['Monitoring period', `${start} – ${end}`],
      ['Heart rate', Core.heartRateSummary(patient)]
    ])
  );
}

registerPage('patient', {
  async render(params, isStale){
    const found = document.getElementById('patient-found');
    const missing = document.getElementById('patient-missing');
    const crumb = document.getElementById('patient-crumb');
    const title = document.getElementById('patient-title');
    const download = document.getElementById('patient-download');

    found.hidden = false;
    missing.hidden = true;
    // The previous patient's report must not be downloadable from this patient's page.
    clearReportPatient();
    download.disabled = true;
    crumb.textContent = params.patientId;
    title.textContent = 'Loading patient…';
    document.getElementById('patient-meta').replaceChildren();
    renderVitalCards(document.getElementById('patient-vitals'), null);
    renderEcgCard(document.getElementById('patient-ecg'), null);
    renderReadingsTable(document.getElementById('patient-readings'), null);
    document.getElementById('patient-contact').replaceChildren(cardHead('Parent contact', 'users'), el('p', 'is-loading', 'Loading…'));
    document.getElementById('patient-summary').replaceChildren(cardHead('Report summary', 'file'), el('p', 'is-loading', 'Loading…'));

    let patient;
    try {
      patient = await api(`/api/patient/${encodeURIComponent(params.patientId)}`);
    } catch (error){
      console.error(error);
      if (error.handled || isStale()) return;
      found.hidden = true;
      missing.hidden = false;
      document.getElementById('patient-missing-text').textContent = error.status === 404
        ? `No patient has the ID ${params.patientId}.`
        : "This patient's record couldn't be loaded. Refresh the page to try again.";
      return;
    }

    if (isStale()) return;
    setCurrentReportPatient(patient);
    download.disabled = false;
    const name = patient.patientName || 'Unnamed patient';
    crumb.textContent = name;
    title.textContent = name;
    document.title = `${name} · CarePulse`;
    renderPatientMeta(patient);
    renderVitalCards(document.getElementById('patient-vitals'), patient);
    renderEcgCard(document.getElementById('patient-ecg'), patient);
    renderReadingsTable(document.getElementById('patient-readings'), patient);
    renderPatientContact(patient);
    renderPatientSummary(patient);
  }
});

// ---------------- Settings ----------------
document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener('change', () => setThemePreference(radio.value));
});

document.getElementById('settings-back').addEventListener('click', () => {
  // Opened from another page in this visit: go back there. Opened directly: go somewhere sensible.
  if (renderedRoutes > 1) history.back();
  else navigate(Core.guardRoute(Core.parseRoute('#/login'), getSession()).redirect || '#/');
});

registerPage('settings', {
  render(){
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.checked = radio.value === themePreference;
    });
  }
});

// ---------------- PDF report ----------------
function downloadReportPdf(){
  try {
    const jsPDF = window.jspdf ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!jsPDF) {
      showToast('PDF library failed to load — check your connection and try again.', 'error');
      return;
    }

    const patient = getCurrentReportPatient() || {
      patientId: sessionStorage.getItem('patientId') || '—',
      patientName: sessionStorage.getItem('patientName') || 'Patient'
    };

    const patientId = patient.patientId || '—';
    const patientName = patient.patientName || 'Patient';
    const age = patient.dob ? Core.ageFromDob(patient.dob) : patient.age;
    const patientAge = Core.hasValue(age) ? `${age} years` : 'Not available';
    const patientDOB = patient.dob ? Core.formatDob(patient.dob) : 'Not available';
    const patientGender = patient.gender || 'Not available';
    const status = patient.monitoringStatus || 'Active';
    const noReading = 'No reading available';
    const lastReading = Core.lastReadingTime(patient);

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 48;
    const teal = [15, 122, 108];
    const coral = [232, 115, 79];
    const ink = [18, 49, 59];
    const muted = [91, 107, 105];

    doc.setFillColor(...teal);
    doc.rect(0, 0, pageWidth, 90, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('CarePulse', margin, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('Patient Monitoring — Medical Report', margin, 62);

    const generatedAt = new Date();
    doc.setFontSize(9);
    doc.text('Generated ' + generatedAt.toLocaleString(), pageWidth - margin, 62, { align: 'right' });

    let y = 130;
    const columnX = [margin, pageWidth / 2 + 8];
    const columns = [
      [
        ['Patient ID', patientId],
        ['Patient name', patientName],
        ['Age', patientAge],
        ['Date of birth', patientDOB],
        ['Gender', patientGender],
        ['Monitoring status', status]
      ],
      [
        ['Heart rate', Core.hasValue(patient.heartRate) ? `${patient.heartRate} bpm` : noReading],
        ['Oxygen level (SpO2)', Core.hasValue(patient.oxygenLevel) ? `${patient.oxygenLevel}%` : noReading],
        ['Temperature', Core.hasValue(patient.temperature) ? `${patient.temperature}°` : noReading],
        ['Blood pressure', Core.hasValue(patient.bloodPressure) ? `${patient.bloodPressure} mmHg` : noReading],
        ['Last reading', lastReading ? new Date(lastReading).toLocaleString() : noReading]
      ]
    ];

    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Patient Summary', columnX[0], y);
    doc.text('Latest Readings', columnX[1], y);
    y += 10;
    doc.setDrawColor(217, 228, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 24;

    // Keep long values (e.g. names) from running into the other column.
    const columnWidth = columnX[1] - columnX[0] - 16;
    const fitText = (text) => {
      if (doc.getTextWidth(text) <= columnWidth) return text;
      while (text.length > 1 && doc.getTextWidth(text + '…') > columnWidth) text = text.slice(0, -1);
      return text + '…';
    };

    const rowsTop = y;
    columns.forEach((rows, columnIndex) => {
      let rowY = rowsTop;
      rows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...muted);
        doc.text(label.toUpperCase(), columnX[columnIndex], rowY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...ink);
        doc.text(fitText(String(value)), columnX[columnIndex], rowY + 16);
        rowY += 42;
      });
    });
    y = rowsTop + Math.max(...columns.map(rows => rows.length)) * 42;

    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...ink);
    doc.text('ECG Waveform (illustrative)', margin, y);
    y += 14;

    const ecgTop = y;
    const ecgHeight = 90;
    const ecgWidth = pageWidth - margin * 2;
    doc.setFillColor(255, 247, 242);
    doc.setDrawColor(243, 217, 206);
    doc.roundedRect(margin, ecgTop, ecgWidth, ecgHeight, 6, 6, 'FD');

    const pattern = [0.5,0.5,0.3,0.7,0.1,0.9,0.5,0.5,0.3,0.7,0.1,0.9,0.5,0.5,0.3,0.7,0.1,0.9,0.5,0.5];
    const stepX = ecgWidth / (pattern.length - 1);
    doc.setDrawColor(...coral);
    doc.setLineWidth(1.4);
    for (let i = 0; i < pattern.length - 1; i++){
      const x1 = margin + i * stepX;
      const x2 = margin + (i + 1) * stepX;
      const y1 = ecgTop + ecgHeight - pattern[i] * ecgHeight;
      const y2 = ecgTop + ecgHeight - pattern[i + 1] * ecgHeight;
      doc.line(x1, y1, x2, y2);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(
      'This report is generated from device readings and is not a substitute for clinical judgment.',
      margin,
      ecgTop + ecgHeight + 30,
      { maxWidth: ecgWidth }
    );

    const safeName = patientName.replace(/[^\w.-]+/g, '_');
    doc.save(`CarePulse_Report_${safeName}_${patientId}.pdf`);
  } catch (err) {
    console.error(err);
    showToast('An error occurred while generating the PDF. Please try again.', 'error');
  }
}

// ---------------- Start ----------------
// Page modules register themselves above this line; render the current address last.
renderRoute();
