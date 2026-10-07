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
