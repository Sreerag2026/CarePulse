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
    logout('Your session has expired. Please log in again.', '#/login');
    const error = new Error('Session expired');
    error.handled = true;
    throw error;
  }

  if (!response.ok){
    throw new Error(data.message || `Request failed (error ${response.status}). Please try again.`);
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
  clearSession();
  navigate(redirect);
  showToast(message);
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

  document.title = PAGE_TITLES[route.name] ? `${PAGE_TITLES[route.name]} · CarePulse` : 'CarePulse';
  window.scrollTo(0, 0);

  // Move focus to the new page's heading so screen readers announce the change.
  const heading = document.querySelector(`.page[data-page="${route.name}"] h1`);
  if (heading){
    heading.setAttribute('tabindex', '-1');
    if (hasRendered) heading.focus({ preventScroll: true });
  }
  hasRendered = true;

  const page = pages[route.name];
  if (page && page.render) await page.render(route.params);
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
