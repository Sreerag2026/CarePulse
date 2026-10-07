// Pure helpers shared by the page (window.CarePulseCore) and the unit tests (module.exports).
// Nothing in here touches the DOM, storage or the network.
(function(){
  // ---------------- Routes ----------------
  const ROLES = ['parent', 'doctor'];

  function parseRoute(hash){
    const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    const [first, second, extra] = parts;

    if (!first) return { name: 'home', params: {} };
    if ((first === 'login' || first === 'register') && !extra){
      if (!second) return { name: first, params: { role: 'parent' } };
      if (ROLES.includes(second)) return { name: first, params: { role: second } };
    }
    if (first === 'patients' && !extra){
      if (!second) return { name: 'patients', params: {} };
      return { name: 'patient', params: { patientId: decodeURIComponent(second) } };
    }
    if (parts.length === 1){
      if (first === 'reset-password') return { name: 'reset', params: {} };
      if (first === 'dashboard' || first === 'settings') return { name: first, params: {} };
    }
    return { name: 'notFound', params: {} };
  }

  function routeHash(name, params = {}){
    switch (name){
      case 'login':
      case 'register':
        return params.role === 'doctor' ? `#/${name}/doctor` : `#/${name}`;
      case 'reset': return '#/reset-password';
      case 'dashboard': return '#/dashboard';
      case 'patients': return '#/patients';
      case 'patient': return `#/patients/${encodeURIComponent(params.patientId || '')}`;
      case 'settings': return '#/settings';
      default: return '#/';
    }
  }

  const HOME_FOR_ROLE = { parent: '#/dashboard', doctor: '#/patients' };

  function guardRoute(route, session){
    const role = session && session.role;

    if (route.name === 'notFound') return { redirect: '#/', reason: null };

    if (route.name === 'dashboard'){
      if (!role) return { redirect: '#/login', reason: 'login-required' };
      if (role !== 'parent') return { redirect: HOME_FOR_ROLE[role], reason: 'wrong-role' };
    }

    if (route.name === 'patients' || route.name === 'patient'){
      if (!role) return { redirect: '#/login/doctor', reason: 'login-required' };
      if (role !== 'doctor') return { redirect: HOME_FOR_ROLE[role], reason: 'wrong-role' };
    }

    // Already signed in: the login page has nothing to offer, so go to your own dashboard.
    if (route.name === 'login' && HOME_FOR_ROLE[role]) return { redirect: HOME_FOR_ROLE[role], reason: null };

    return { redirect: null, reason: null };
  }

  // ---------------- Display formatting ----------------
  const TITLES = /^(dr|mr|mrs|ms|miss|prof)\.?$/i;
  const NAME_WORD = /^\p{L}[\p{L}'.-]*$/u;

  function initials(name){
    const words = String(name || '').trim().split(/\s+/)
      .filter(word => NAME_WORD.test(word) && !TITLES.test(word));
    if (!words.length) return '?';
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  function hasValue(value){
    return value !== null && value !== undefined && value !== '';
  }

  function formatVital(value, suffix){
    return hasValue(value) ? `${value}${suffix}` : '—';
  }

  // ---------------- Readings ----------------
  function lastReadingTime(patient){
    if (!patient) return null;
    const readings = patient.readings || [];
    return patient.lastReadingAt || (readings.length ? readings[readings.length - 1].recordedAt : null);
  }

  function recentReadings(patient, limit = 10){
    const readings = (patient && patient.readings) || [];
    return readings.slice(-limit).reverse();
  }

  function heartRateSummary(patient){
    const rates = ((patient && patient.readings) || [])
      .map(reading => Number(reading.heartRate))
      .filter(rate => Number.isFinite(rate) && rate > 0);

    if (rates.length){
      const average = Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length);
      return `${average} bpm avg (${rates.length} reading${rates.length === 1 ? '' : 's'})`;
    }
    return patient && hasValue(patient.heartRate) ? `${patient.heartRate} bpm (latest)` : 'No readings yet';
  }

  // ---------------- Patients ----------------
  function filterPatients(patients, query){
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return patients.slice();
    return patients.filter(patient =>
      String(patient.patientName || '').toLowerCase().includes(needle) ||
      String(patient.patientId || '').toLowerCase().includes(needle));
  }

  function ageFromDob(dob, now = new Date()){
    if (!dob) return '';
    const birth = new Date(dob + 'T00:00:00');
    if (Number.isNaN(birth.getTime())) return '';
    let age = now.getFullYear() - birth.getFullYear();
    const monthDifference = now.getMonth() - birth.getMonth();
    if (monthDifference < 0 || (monthDifference === 0 && now.getDate() < birth.getDate())){
      age--;
    }
    return age >= 0 ? age : '';
  }

  function formatDob(dob){
    if (!dob) return '';
    const parts = dob.split('-');
    if (parts.length !== 3) return dob;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  const api = {
    parseRoute, routeHash, guardRoute,
    initials, hasValue, formatVital,
    lastReadingTime, recentReadings, heartRateSummary,
    filterPatients, ageFromDob, formatDob
  };

  if (typeof module !== 'undefined') module.exports = api;
  else window.CarePulseCore = api;
})();
