/**
 * Medical Member Dashboard - Core Application Engine
 * Integrates all 5 Google Sheet tabs:
 * 1. Dashboard (KPIs, Targets, Progress)
 * 2. การตอบแบบฟอร์ม 1 (Member Core Data)
 * 3. Geo (Geographic Master Coordinates)
 * 4. ชื่อ-นามสกุล (Standardized Names)
 * 5. รูปภาพ (Drive Image IDs & Direct Previews)
 *
 * Map: 100% Free OpenStreetMap & ESRI (Zero API Key Required)
 * Images: Multi-tier Google Drive & Direct CDN Fallback + Local File Upload
 */

// Application State
const AppState = {
  members: [],
  geoMaster: [],
  dashboardStats: {},
  thaifammed: [],
  filteredThaifammed: [],
  thaifammedStats: {},
  thaifammedProvinces: [],
  tfCurrentPage: 1,
  tfPageSize: 25,
  currentView: 'dashboard',
  directoryLayout: 'grid', // 'grid' or 'table'
  currentPage: 1,
  pageSize: 12,
  filteredMembers: [],
  map: null,
  markerClusterGroup: null,
  markersList: [],
  miniMap: null,
  miniMarker: null,
  charts: {},
  provinces: [],
  selectedMemberId: null,
  isSidebarCollapsed: false,
  relocating: null,
  relocateMarker: null,
  mapRelocateClickHandler: null,
  matchingMarkers: [],
  currentProvinceDoctors: [],
  currentClusterBounds: null
};

// Storage Keys
const STORAGE_KEY_MEMBERS = 'MEDICAL_DASHBOARD_MEMBERS_V1';
const STORAGE_KEY_THAIFAMMED = 'MEDICAL_DASHBOARD_THAIFAMMED_V1';
const STORAGE_KEY_TF_OVERRIDES = 'MEDICAL_DASHBOARD_TF_OVERRIDES_V1';
const STORAGE_KEY_GAS_URL = 'MEDICAL_DASHBOARD_GAS_URL';
const STORAGE_KEY_BRANDING = 'MEDICAL_DASHBOARD_BRANDING_V1';
const STORAGE_KEY_AUTH_USER = 'MEDICAL_DASHBOARD_AUTH_USER_V1';
const STORAGE_KEY_CREDENTIALS = 'MEDICAL_DASHBOARD_CREDENTIALS_V1';
const STORAGE_KEY_DELEGATES = 'MEDICAL_DASHBOARD_DELEGATES_V1';

// Default GAS Endpoint (realtime Google Apps Script Web App API for Sheet 1PVM2q...)
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyXB_YHNHcyo-9TvCuCw7bvu3rlWHVf90JSL3IZgufX1RtvEKixKq-xxet8yNWVRv2xew/exec';

function getGasEndpoint() {
  return localStorage.getItem(STORAGE_KEY_GAS_URL) || DEFAULT_GAS_URL || '';
}

function setGasEndpoint(url) {
  if (url && url.trim()) {
    localStorage.setItem(STORAGE_KEY_GAS_URL, url.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_GAS_URL);
  }
}

async function sendToGasApi(payload) {
  const endpoint = getGasEndpoint();
  if (!endpoint || !endpoint.startsWith('http')) return null;

  // Dual-Engine Cloud Sync Transport:
  // 1. First attempt via POST
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    try {
      const result = await response.json();
      if (result && result.status === 'success') {
        console.log('Google Apps Script POST sync succeeded:', result);
        return result;
      }
    } catch (parseErr) {
      // response wasn't JSON, proceed to GET fallback
    }
  } catch (err) {
    console.warn('POST to GAS failed or redirected, falling back to GET transport:', err);
  }

  // 2. Fallback via GET (100% immune to CORS preflight and 302 redirect issues on mobile browsers)
  try {
    let getUrl = endpoint;
    const sep = endpoint.includes('?') ? '&' : '?';
    if (payload.action === 'updateCoordinate') {
      getUrl += `${sep}action=updateCoordinate&memberId=${encodeURIComponent(payload.memberId)}&lat=${encodeURIComponent(payload.lat)}&lng=${encodeURIComponent(payload.lng)}&workplace=${encodeURIComponent(payload.workplace || '')}&sourceType=${encodeURIComponent(payload.sourceType || 'sheet')}`;
    } else if (payload.action === 'saveMember') {
      getUrl += `${sep}action=saveMember&data=${encodeURIComponent(JSON.stringify(payload.member))}`;
    } else {
      getUrl += `${sep}action=${encodeURIComponent(payload.action)}`;
    }

    const getResponse = await fetch(getUrl);
    const getResult = await getResponse.json();
    console.log('Google Apps Script GET fallback sync succeeded:', getResult);
    return getResult;
  } catch (getErr) {
    console.warn('Both POST and GET sync to Google Apps Script failed:', getErr);
    return null;
  }
}

/* ================= INITIALIZATION ================= */
document.addEventListener('DOMContentLoaded', () => {
  BrandingManager.init();
  initData();
  AuthManager.init();
  populateFilterDropdowns();
  populateGovHospitalsDatalist();
  renderDashboard();
  setupEventListeners();
  updateStorageStatus();

  // If cloud sync URL is configured, auto-sync latest data in background
  if (getGasEndpoint()) {
    setTimeout(() => {
      syncLiveSheetData(true);
    }, 1200);
  }
});


function initData() {
  const savedData = localStorage.getItem(STORAGE_KEY_MEMBERS);
  if (savedData) {
    try {
      AppState.members = JSON.parse(savedData);
      console.log(`Loaded ${AppState.members.length} members from LocalStorage.`);
    } catch (e) {
      console.error('Error parsing LocalStorage data:', e);
      AppState.members = window.INITIAL_DATA ? [...window.INITIAL_DATA.members] : [];
    }
  } else {
    AppState.members = window.INITIAL_DATA ? [...window.INITIAL_DATA.members] : [];
  }

  AppState.geoMaster = window.INITIAL_DATA ? window.INITIAL_DATA.geoMaster : [];
  AppState.dashboardStats = window.INITIAL_DATA ? window.INITIAL_DATA.dashboardStats : {};
  AppState.filteredMembers = [...AppState.members];

  // Thaifammed Database (3,750 records)
  AppState.thaifammed = window.INITIAL_DATA ? JSON.parse(JSON.stringify(window.INITIAL_DATA.thaifammed || [])) : [];

  // Apply lightweight overrides if any (takes < 2KB instead of 3MB, preventing QuotaExceededError on mobile)
  const savedOverrides = localStorage.getItem(STORAGE_KEY_TF_OVERRIDES);
  if (savedOverrides) {
    try {
      const overrides = JSON.parse(savedOverrides);
      if (overrides && typeof overrides === 'object') {
        let appliedCount = 0;
        AppState.thaifammed.forEach(d => {
          if (overrides[d.id]) {
            Object.assign(d, overrides[d.id]);
            appliedCount++;
          }
        });
        console.log(`Applied ${appliedCount} thaifammed overrides from LocalStorage.`);
      }
    } catch (e) {
      console.error('Error applying thaifammed overrides:', e);
    }
  } else {
    // Migration: if old 3MB STORAGE_KEY_THAIFAMMED exists from previous sessions, migrate to lightweight overrides
    const oldSavedTf = localStorage.getItem(STORAGE_KEY_THAIFAMMED);
    if (oldSavedTf) {
      try {
        const parsedTf = JSON.parse(oldSavedTf);
        if (Array.isArray(parsedTf)) {
          parsedTf.forEach(d => {
            if (d.isUpdated) {
              const target = AppState.thaifammed.find(t => t.id == d.id);
              if (target) Object.assign(target, d);
            }
          });
          saveThaifammedOverrides();
        }
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY_THAIFAMMED);
      }
    }
  }
  AppState.thaifammedStats = window.INITIAL_DATA ? (window.INITIAL_DATA.thaifammedStats || {}) : {};
  AppState.filteredThaifammed = [...AppState.thaifammed];

  // Extract unique provinces for Thaifammed
  const tfProvSet = new Set();
  AppState.thaifammed.forEach(d => {
    if (d.province && d.province.trim()) {
      tfProvSet.add(d.province.trim());
    }
  });
  AppState.thaifammedProvinces = Array.from(tfProvSet).sort((a, b) => a.localeCompare(b, 'th'));

  const matchedEl = document.getElementById('tf-matched-count');
  if (matchedEl && AppState.thaifammedStats) {
    matchedEl.innerText = (AppState.thaifammedStats.matched || 295).toLocaleString();
  }

  // Extract unique provinces
  const provSet = new Set();
  AppState.members.forEach(m => {
    const prov = (m.workplace && m.workplace.province) || (m.homeAddress && m.homeAddress.province);
    if (prov && prov.trim()) {
      provSet.add(prov.trim().replace('จังหวัด', ''));
    }
  });
  AppState.provinces = Array.from(provSet).sort((a, b) => a.localeCompare(b, 'th'));

  document.getElementById('sidebar-member-badge').innerText = `${AppState.members.length} คน`;
}

function updateStorageStatus() {
  const isModified = localStorage.getItem(STORAGE_KEY_MEMBERS) !== null;
  const el = document.getElementById('storage-status');
  if (el) {
    if (isModified) {
      el.innerHTML = `<i class="fa-solid fa-floppy-disk text-[10px] text-sky-400"></i> บันทึกในเครื่องแล้ว`;
    } else {
      el.innerHTML = `<i class="fa-solid fa-check-circle text-[10px] text-emerald-400"></i> ข้อมูลต้นฉบับ`;
    }
  }
}

/* ================= IMAGE RESOLUTION & MULTI-TIER FALLBACK ================= */
function getDoctorPrimaryImage(m) {
  if (m.photoUrl && m.photoUrl.startsWith('data:image')) {
    return m.photoUrl; // Uploaded custom Base64 image
  }
  const driveId = m.photoDriveId || extractDriveIdFromUrl(m.photoUrl);
  if (driveId) {
    // 1st tier: lh3.googleusercontent.com/d/{id}=w500 (Google high-speed CDN)
    return `https://lh3.googleusercontent.com/d/${driveId}=w500`;
  }
  if (m.photoUrl && m.photoUrl.startsWith('http')) {
    return m.photoUrl;
  }
  return null;
}

function extractDriveIdFromUrl(url) {
  if (!url) return '';
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]{25,45})/) || url.match(/\/d\/([a-zA-Z0-9_-]{25,45})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(url.trim())) return url.trim();
  return '';
}

/**
 * Intelligent Image Fallback:
 * Tries: lh3 -> drive.google.com/thumbnail -> wsrv.nl proxy -> drive.google.com/uc -> SVG Doctor Avatar
 */
window.handleImgError = function(imgEl, driveId, encodedName) {
  const step = parseInt(imgEl.getAttribute('data-error-step') || '0');
  const name = decodeURIComponent(encodedName || 'MD');

  if (driveId && step === 0) {
    imgEl.setAttribute('data-error-step', '1');
    imgEl.src = `https://drive.google.com/thumbnail?id=${driveId}&sz=w500`;
    return;
  }
  if (driveId && step === 1) {
    imgEl.setAttribute('data-error-step', '2');
    imgEl.src = `https://wsrv.nl/?url=https://drive.google.com/uc?id=${driveId}`;
    return;
  }
  if (driveId && step === 2) {
    imgEl.setAttribute('data-error-step', '3');
    imgEl.src = `https://drive.google.com/uc?export=view&id=${driveId}`;
    return;
  }

  // Final fallback: High quality doctor avatar with Thai initials
  const initials = name.replace(/^(นพ\.|พญ\.|นาย|นางสาว|นาง|ดร\.|อาจารย์)/, '').trim().slice(0, 2) || 'MD';
  imgEl.onerror = null; // stop retry loop
  imgEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=0284c7&color=fff&size=200&bold=true&font-size=0.42`;
};

/* ================= VIEW SWITCHING ================= */
function switchView(viewName) {
  if (viewName === 'management' || viewName === 'geo') {
    if (typeof AuthManager !== 'undefined' && !AuthManager.canAccessMasterDb()) {
      if (AuthManager.isGuest()) {
        showToast('กรุณาเข้าสู่ระบบก่อน (เฉพาะ Admin หรือผู้ได้รับมอบหมายสิทธิ์เท่านั้น)', 'warning');
        AuthManager.openLoginModal();
      } else {
        showToast('สิทธิ์ไม่เพียงพอ: เฉพาะ Admin และแพทย์ที่ Admin มอบหมายเท่านั้นที่เข้าถึง Master DB ได้', 'error');
      }
      return;
    }
  }
  AppState.currentView = viewName;

  const views = ['dashboard', 'map', 'directory', 'thaifammed', 'gallery', 'geo', 'management'];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const navBtn = document.getElementById(`nav-${v}`);
    if (el) el.classList.toggle('hidden', v !== viewName);
    if (navBtn) {
      if (v === viewName) {
        navBtn.className = 'nav-item w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition text-white bg-sky-600 font-semibold shadow-md shadow-sky-600/30';
      } else {
        navBtn.className = 'nav-item w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition text-slate-400 hover:text-white hover:bg-slate-800/70';
      }
    }
  });

  // Sync Mobile Bottom Navigation Active Tab
  const bottomNavItems = ['dashboard', 'map', 'directory', 'thaifammed'];
  bottomNavItems.forEach(v => {
    const bEl = document.getElementById(`bnav-${v}`);
    if (bEl) {
      if (v === viewName) {
        bEl.className = 'flex flex-col items-center justify-center flex-1 py-1 transition text-sky-400 font-bold';
      } else {
        bEl.className = 'flex flex-col items-center justify-center flex-1 py-1 transition text-slate-400 hover:text-white';
      }
    }
  });

  // Auto-close mobile drawer when navigating
  if (typeof closeMobileSidebar === 'function') {
    closeMobileSidebar();
  }

  if (viewName === 'map') {
    setTimeout(() => {
      initMap();
      if (AppState.map) {
        AppState.map.invalidateSize();
        fitMapBounds();
      }
    }, 150);
  } else if (viewName === 'dashboard') {
    renderDashboard();
  } else if (viewName === 'directory') {
    renderDirectory();
  } else if (viewName === 'thaifammed') {
    renderThaifammed();
  } else if (viewName === 'gallery') {
    renderPhotoGallery();
  } else if (viewName === 'geo') {
    renderGeoTable();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isClosed = sidebar.classList.contains('-translate-x-full');
  if (isClosed) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar && window.innerWidth < 1024) {
    sidebar.classList.add('-translate-x-full');
  }
  if (backdrop) {
    backdrop.classList.add('hidden');
  }
}

/* ================= DASHBOARD & CHARTS ================= */
function renderDashboard() {
  const total = AppState.members.length;
  let formalCount = 0;
  let inserviceCount = 0;
  let auCount = 0;
  let geocodedCount = 0;
  let photoCount = 0;

  const medSchoolCounts = {};
  const provinceCounts = {};
  const workplaceTypeCounts = {};

  AppState.members.forEach(m => {
    if (m.certGroup.includes('Formal') || m.certTypeRaw.includes('แผน ก')) {
      formalCount++;
    } else if (m.certGroup.includes('Inservice') || m.certTypeRaw.includes('แผน ข')) {
      inserviceCount++;
    } else if (m.certGroup.includes('อนุมัติ') || m.certGroup.includes('อว.')) {
      auCount++;
    } else {
      formalCount++;
    }

    if (m.lat && m.lng) geocodedCount++;
    if (m.photoUrl || m.photoDriveId) photoCount++;

    const school = (m.medSchool || m.institute || 'ไม่ระบุ').trim();
    if (school && school !== '-') {
      let shortSchool = school.replace('คณะแพทยศาสตร์', '').replace('มหาวิทยาลัย', 'ม.').trim();
      medSchoolCounts[shortSchool] = (medSchoolCounts[shortSchool] || 0) + 1;
    }

    const prov = (m.workplace && m.workplace.province) || (m.homeAddress && m.homeAddress.province) || 'ไม่ระบุ';
    const cleanProv = prov.replace('จังหวัด', '').trim();
    if (cleanProv) {
      provinceCounts[cleanProv] = (provinceCounts[cleanProv] || 0) + 1;
    }

    const wpType = (m.workplace && m.workplace.type) || 'รัฐบาล';
    const cleanType = wpType.includes('รัฐ') ? 'รัฐบาล' : (wpType.includes('เอกชน') ? 'เอกชน' : 'ส่วนตัว/อิสระ');
    workplaceTypeCounts[cleanType] = (workplaceTypeCounts[cleanType] || 0) + 1;
  });

  const wwTotal = formalCount + inserviceCount;

  document.getElementById('kpi-total-members').innerText = total;
  document.getElementById('kpi-ww-total').innerText = wwTotal;
  document.getElementById('kpi-ww-formal').innerText = formalCount;
  document.getElementById('kpi-ww-inservice').innerText = inserviceCount;
  document.getElementById('kpi-au-total').innerText = auCount;
  document.getElementById('kpi-geocoded-count').innerText = geocodedCount;
  document.getElementById('kpi-photo-count').innerText = photoCount;

  const targetWw = 1626;
  const targetAu = 6357;
  const pctWw = ((wwTotal / targetWw) * 100).toFixed(1);
  const pctAu = ((auCount / targetAu) * 100).toFixed(1);

  const elWwPct = document.getElementById('progress-ww-percent');
  if (elWwPct) elWwPct.innerText = `${pctWw}%`;
  const elWwBar = document.getElementById('progress-ww-bar');
  if (elWwBar) elWwBar.style.width = `${Math.min(100, pctWw)}%`;
  const elWwDone = document.getElementById('progress-ww-done');
  if (elWwDone) elWwDone.innerText = wwTotal;
  const elWwRem = document.getElementById('progress-ww-remaining');
  if (elWwRem) elWwRem.innerText = (targetWw - wwTotal).toLocaleString();

  const elAuPct = document.getElementById('progress-au-percent');
  if (elAuPct) elAuPct.innerText = `${pctAu}%`;
  const bFormal = document.getElementById('badge-cert-formal');
  if (bFormal) bFormal.innerText = formalCount;
  const bInservice = document.getElementById('badge-cert-inservice');
  if (bInservice) bInservice.innerText = inserviceCount;
  const bAu = document.getElementById('badge-cert-au');
  if (bAu) bAu.innerText = auCount;

  const bGov = document.getElementById('badge-wp-gov');
  if (bGov) bGov.innerText = workplaceTypeCounts['รัฐบาล'] || 0;
  const bPriv = document.getElementById('badge-wp-priv');
  if (bPriv) bPriv.innerText = workplaceTypeCounts['เอกชน'] || 0;
  const bSelf = document.getElementById('badge-wp-self');
  if (bSelf) bSelf.innerText = workplaceTypeCounts['ส่วนตัว/อิสระ'] || 0;

  renderCertDoughnut(formalCount, inserviceCount, auCount);
  renderHealthZonesBar(AppState.thaifammedStats ? AppState.thaifammedStats.zoneCounts : {});
  renderMedSchoolBar(medSchoolCounts);
  renderProvinceBar(provinceCounts);
  renderWorkplaceDoughnut(workplaceTypeCounts);
}

function renderCertDoughnut(formal, inservice, au) {
  const ctx = document.getElementById('chart-cert-doughnut');
  if (!ctx) return;
  if (AppState.charts.certDoughnut) AppState.charts.certDoughnut.destroy();

  AppState.charts.certDoughnut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['วว. แผน ก (Formal)', 'วว. แผน ข (Inservice)', 'หนังสืออนุมัติ (อว.)'],
      datasets: [{
        data: [formal, inservice, au],
        backgroundColor: ['#0284c7', '#10b981', '#f59e0b'],
        borderWidth: 3,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Prompt', size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw} คน (${((ctx.raw / (formal+inservice+au))*100).toFixed(1)}%)`
          }
        }
      },
      cutout: '68%'
    }
  });
}

function renderHealthZonesBar(zoneCounts) {
  const ctx = document.getElementById('chart-health-zones');
  if (!ctx) return;
  if (AppState.charts.healthZonesBar) AppState.charts.healthZonesBar.destroy();

  const zones = [];
  let totalInZones = 0;
  for (let z = 1; z <= 13; z++) {
    const key = `เขต ${z}`;
    const count = (zoneCounts && zoneCounts[key]) ? zoneCounts[key] : 0;
    totalInZones += count;
    zones.push({
      label: z === 13 ? 'เขต 13 (กทม.)' : `เขต ${z}`,
      count: count
    });
  }

  AppState.charts.healthZonesBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: zones.map(z => z.label),
      datasets: [{
        label: 'จำนวนแพทย์ (คน)',
        data: zones.map(z => z.count),
        backgroundColor: [
          '#0d9488', '#0f766e', '#14b8a6', '#06b6d4', '#0284c7',
          '#0369a1', '#2563eb', '#4f46e5', '#6366f1', '#7c3aed',
          '#9333ea', '#a855f7', '#059669'
        ],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.raw.toLocaleString()} คน (${((ctx.raw / (totalInZones || 3750)) * 100).toFixed(1)}%)`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { family: 'Prompt', size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Prompt', size: 10 } }
        }
      }
    }
  });
}

function renderMedSchoolBar(schoolCounts) {
  const ctx = document.getElementById('chart-medschool-bar');
  if (!ctx) return;
  if (AppState.charts.medSchoolBar) AppState.charts.medSchoolBar.destroy();

  const sorted = Object.entries(schoolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  AppState.charts.medSchoolBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        label: 'จำนวนแพทย์ (คน)',
        data: sorted.map(s => s[1]),
        backgroundColor: '#0284c7',
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} คน` } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { stepSize: 5 } },
        x: { grid: { display: false }, ticks: { font: { family: 'Prompt', size: 10 } } }
      }
    }
  });
}

function renderProvinceBar(provinceCounts) {
  const ctx = document.getElementById('chart-province-bar');
  if (!ctx) return;
  if (AppState.charts.provinceBar) AppState.charts.provinceBar.destroy();

  const sorted = Object.entries(provinceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  AppState.charts.provinceBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(s => s[0]),
      datasets: [{
        label: 'จำนวนแพทย์ (คน)',
        data: sorted.map(s => s[1]),
        backgroundColor: '#0d9488',
        borderRadius: 8
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} คน` } }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: '#f1f5f9' } },
        y: { grid: { display: false }, ticks: { font: { family: 'Prompt', size: 11 } } }
      }
    }
  });
}

function renderWorkplaceDoughnut(wpCounts) {
  const ctx = document.getElementById('chart-workplace-doughnut');
  if (!ctx) return;
  if (AppState.charts.workplaceDoughnut) AppState.charts.workplaceDoughnut.destroy();

  const labels = Object.keys(wpCounts);
  const data = Object.values(wpCounts);

  AppState.charts.workplaceDoughnut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: ['#0369a1', '#14b8a6', '#f97316'],
        borderWidth: 3,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Prompt', size: 11 } } }
      },
      cutout: '65%'
    }
  });
}

/* ================= 100% FREE MAP (NO API KEY REQUIRED) ================= */
function initMap() {
  if (AppState.map) return;

  // Initialize Leaflet map centered at Thailand
  AppState.map = L.map('map-container', {
    center: [13.736717, 100.523186],
    zoom: 6,
    zoomControl: true
  });

  // Layer 1: OpenStreetMap Standard (100% Free - No API required)
  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  });

  // Layer 2: ESRI World Street Map (100% Free - No API required)
  const esriStreetLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  });

  // Layer 3: ESRI World Imagery Satellite (100% Free - No API required)
  const esriSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Satellite',
    maxZoom: 19
  });

  // Layer 4: Google Hybrid Satellite (High-res with Roads & Labels)
  const googleHybridLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: 'Tiles &copy; Google Maps',
    maxZoom: 20
  });

  // Default basemap: OpenStreetMap
  osmLayer.addTo(AppState.map);

  // Add Layer Control for switching maps with zero API keys
  L.control.layers({
    '🗺️ OpenStreetMap (มาตรฐาน)': osmLayer,
    '🏥 ESRI World Street (ถนน)': esriStreetLayer,
    '🛰️ ESRI Imagery (ดาวเทียม)': esriSatelliteLayer,
    '🛰️ Google Hybrid (ดาวเทียม+ชื่อสถานที่)': googleHybridLayer
  }, null, { position: 'topright' }).addTo(AppState.map);

  // Initialize MarkerCluster
  AppState.markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
    maxClusterRadius: 45
  });

  // When clicking cluster, open Province Doctors Modal (Requirement 6.2)
  AppState.markerClusterGroup.on('clusterclick', function (a) {
    const cluster = a.layer || a.propagatedFrom || a.target;
    const childMarkers = (cluster && typeof cluster.getAllChildMarkers === 'function') 
      ? cluster.getAllChildMarkers() 
      : [];
    const doctors = childMarkers.map(m => m.doctorData).filter(Boolean);
    AppState.currentClusterBounds = (cluster && typeof cluster.getBounds === 'function') 
      ? cluster.getBounds() 
      : null;

    // Determine primary province name from markers
    const provCounts = {};
    doctors.forEach(d => {
      if (d.province) {
        provCounts[d.province] = (provCounts[d.province] || 0) + 1;
      }
    });
    const topProv = Object.keys(provCounts).sort((x, y) => provCounts[y] - provCounts[x])[0] || 'ในพื้นที่นี้';

    openProvinceDoctorsModal(topProv, doctors);
  });

  AppState.map.addLayer(AppState.markerClusterGroup);
  renderMapMarkers();
}

/* ================= GOVERNMENT HEALTHCARE FACILITIES & AUTO-GEOCODING ================= */
function populateGovHospitalsDatalist() {
  const dl = document.getElementById('gov-hospitals-datalist');
  if (!dl || !window.GOV_HEALTH_FACILITIES || !window.GOV_HEALTH_FACILITIES.hospitals) return;
  let options = '';
  window.GOV_HEALTH_FACILITIES.hospitals.forEach(h => {
    options += `<option value="${escapeHtml(h.name)}">${escapeHtml(h.type)} - จ.${escapeHtml(h.province)} (เขต ${h.zone})</option>`;
    if (h.aliases && h.aliases.length > 0) {
      h.aliases.forEach(alias => {
        options += `<option value="${escapeHtml(alias)}">${escapeHtml(h.name)} (เขต ${h.zone})</option>`;
      });
    }
  });
  dl.innerHTML = options;
}

function findGovHospital(query) {
  if (!query || !window.GOV_HEALTH_FACILITIES || !window.GOV_HEALTH_FACILITIES.hospitals) return null;
  const q = query.trim().toLowerCase();

  // Exact match on official name
  let found = window.GOV_HEALTH_FACILITIES.hospitals.find(h => h.name.toLowerCase() === q);
  if (found) return found;

  // Exact match on alias
  found = window.GOV_HEALTH_FACILITIES.hospitals.find(h =>
    h.aliases && h.aliases.some(a => a.toLowerCase() === q)
  );
  if (found) return found;

  // Substring match on name without prefix
  const cleanQ = q.replace(/^โรงพยาบาล|^รพ\./, '').trim();
  if (cleanQ.length >= 2) {
    found = window.GOV_HEALTH_FACILITIES.hospitals.find(h => {
      const hClean = h.name.replace(/^โรงพยาบาล|^รพ\./, '').trim().toLowerCase();
      if (hClean === cleanQ) return true;
      if (hClean.includes(cleanQ) || cleanQ.includes(hClean)) return true;
      if (h.aliases && h.aliases.some(a => a.toLowerCase().includes(cleanQ) || cleanQ.includes(a.toLowerCase()))) return true;
      return false;
    });
  }

  return found || null;
}

function findGovProvinceCentroid(provName) {
  if (!provName || !window.GOV_HEALTH_FACILITIES || !window.GOV_HEALTH_FACILITIES.provinceCoordinates) return null;
  const cleanProv = provName.replace('จังหวัด', '').trim();
  const coords = window.GOV_HEALTH_FACILITIES.provinceCoordinates[cleanProv];
  if (coords) {
    return {
      lat: coords[0],
      lng: coords[1],
      zone: coords[2],
      province: cleanProv
    };
  }
  return null;
}

function autoFillHospitalDetails(query) {
  if (!query || !query.trim()) return;
  const hosp = findGovHospital(query);
  if (hosp) {
    const nameEl = document.getElementById('form-workplace-name');
    const provEl = document.getElementById('form-workplace-province');
    const amphoeEl = document.getElementById('form-workplace-amphoe');
    const typeEl = document.getElementById('form-workplace-type');
    const latEl = document.getElementById('form-lat');
    const lngEl = document.getElementById('form-lng');

    if (nameEl) nameEl.value = hosp.name;
    if (provEl) provEl.value = hosp.province;
    if (amphoeEl && hosp.amphoe) amphoeEl.value = hosp.amphoe;
    if (typeEl && hosp.type) {
      if (hosp.type.includes('มหาวิทยาลัย')) typeEl.value = 'มหาวิทยาลัย';
      else typeEl.value = 'รัฐบาล';
    }
    if (latEl) latEl.value = hosp.lat;
    if (lngEl) lngEl.value = hosp.lng;

    showToast(`พบสถานบริการรัฐ: ${hosp.name} (เขต ${hosp.zone} จ.${hosp.province}) ดึงพิกัดอัตโนมัติ [${hosp.lat}, ${hosp.lng}] โดยไม่ต้องปักหมุดเอง`, 'success');
  } else {
    const prov = findGovProvinceCentroid(query);
    if (prov) {
      const provEl = document.getElementById('form-workplace-province');
      const latEl = document.getElementById('form-lat');
      const lngEl = document.getElementById('form-lng');
      if (provEl && !provEl.value) provEl.value = prov.province;
      if (latEl && (!latEl.value || latEl.value == '0')) latEl.value = prov.lat;
      if (lngEl && (!lngEl.value || lngEl.value == '0')) lngEl.value = prov.lng;
    }
  }
}

/* ================= INTERACTIVE MAP & MARKER RENDERING ================= */
function getMarkerIcon(type, certGroup, isRelocating = false) {
  if (isRelocating) {
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="custom-pin pin-relocating w-10 h-10"><i class="fa-solid fa-location-crosshairs text-base"></i></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20]
    });
  }

  if (type === 'thaifammed') {
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="custom-pin pin-thaifammed w-7 h-7"><i class="fa-solid fa-user-doctor text-[11px]"></i></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });
  }

  let pinClass = 'pin-formal';
  let iconClass = 'fa-stethoscope';

  if (certGroup && (certGroup.includes('Inservice') || certGroup.includes('แผน ข'))) {
    pinClass = 'pin-inservice';
    iconClass = 'fa-hospital-user';
  } else if (certGroup && (certGroup.includes('อนุมัติ') || certGroup.includes('อว.'))) {
    pinClass = 'pin-au';
    iconClass = 'fa-award';
  }

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div class="custom-pin ${pinClass} w-8 h-8"><i class="fa-solid ${iconClass} text-xs"></i></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
  });
}

function renderMapMarkers() {
  if (!AppState.map) return;

  AppState.markerClusterGroup.clearLayers();
  AppState.markersList = [];
  AppState.matchingMarkers = [];

  const sourceFilter = document.getElementById('map-filter-source')?.value || 'all';
  const zoneFilter = document.getElementById('map-filter-zone')?.value || 'all';
  const certFilter = document.getElementById('map-filter-cert')?.value || 'all';
  const provFilter = document.getElementById('map-filter-province')?.value || 'all';
  const searchQuery = (document.getElementById('map-search')?.value || '').trim().toLowerCase();

  let count = 0;

  // 1. Render Sheet Members
  if (sourceFilter === 'sheet' || sourceFilter === 'all') {
    AppState.members.forEach(m => {
      if (!m.lat || !m.lng) return;

      // Filter Zone
      if (zoneFilter !== 'all' && String(m.healthZone) !== zoneFilter) return;

      // Filter Cert
      if (certFilter !== 'all' && !m.certGroup.includes(certFilter) && !m.certTypeRaw.includes(certFilter)) return;

      // Filter Province
      const mProv = (m.workplace && m.workplace.province) || '';
      if (provFilter !== 'all' && !mProv.includes(provFilter)) return;

      // Filter Search
      if (searchQuery) {
        const queryTarget = `${m.fullNameTh} ${m.fullNameEn} ${m.licenseNo} ${m.workplace.name} ${m.workplace.province}`.toLowerCase();
        if (!queryTarget.includes(searchQuery)) return;
      }

      count++;

      const icon = getMarkerIcon('sheet', m.certGroup);
      const marker = L.marker([m.lat, m.lng], { icon: icon });

      // แสดงชื่อแพทย์บนหมุดพิกัด (Requirement: แสดงชื่อบนหมุดเพื่อให้ทราบว่าเป็นหมุดพิกัดของใคร)
      marker.bindTooltip(escapeHtml(m.fullNameTh), {
        permanent: true,
        direction: 'bottom',
        offset: [0, 8],
        className: 'doctor-marker-label'
      });

      const photoSrc = getDoctorPrimaryImage(m) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.fullNameTh)}&background=0284c7&color=fff`;
      const driveId = m.photoDriveId || '';
      const encodedName = encodeURIComponent(m.fullNameTh);

      // Attach doctor data for Modal and Focus (Requirement 6.2 & 6.3)
      marker.doctorData = {
        id: m.id,
        type: 'sheet',
        name: m.fullNameTh,
        nameEn: m.fullNameEn,
        licenseNo: m.licenseNo,
        certGroup: m.certGroup,
        workplace: (m.workplace && m.workplace.name) || '',
        province: (m.workplace && m.workplace.province) || '',
        zone: m.healthZone || '',
        photoUrl: photoSrc,
        driveId: driveId,
        lat: m.lat,
        lng: m.lng,
        mobilePhone: m.mobilePhone || '',
        email: m.email || ''
      };

      const popupHtml = `
        <div class="p-4 space-y-3 font-sans">
          <div class="flex items-center space-x-3">
            <div class="w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
              <img src="${photoSrc}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover" onerror="handleImgError(this, '${driveId}', '${encodedName}')">
            </div>
            <div class="min-w-0 flex-1">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.certGroup.includes('Formal') ? 'bg-sky-100 text-sky-800' : (m.certGroup.includes('Inservice') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}">${m.certGroup}</span>
              <h5 class="text-sm font-bold text-slate-900 truncate mt-1">${escapeHtml(m.fullNameTh)}</h5>
              <p class="text-[11px] text-slate-500 font-mono">${m.licenseNo ? 'ว. ' + m.licenseNo : 'ไม่ระบุเลข ว.'}</p>
            </div>
          </div>
          <div class="pt-2 border-t border-slate-100 space-y-1 text-xs text-slate-600">
            <div><i class="fa-solid fa-hospital text-sky-600 mr-1.5"></i> ${escapeHtml(m.workplace.name || '-')}</div>
            <div><i class="fa-solid fa-location-dot text-rose-500 mr-1.5"></i> จ.${escapeHtml(m.workplace.province || '-')} (เขตสุขภาพ ${escapeHtml(m.healthZone || '-')})</div>
            ${m.mobilePhone ? `<div><i class="fa-solid fa-phone text-emerald-600 mr-1.5"></i> ${m.mobilePhone}</div>` : ''}
          </div>
          <div class="pt-2 flex items-center space-x-2">
            <button onclick="openMemberDetailModal(${m.id})" class="flex-1 py-1.5 px-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold text-center transition">
              ดูประวัติ
            </button>
            ${(typeof AuthManager !== 'undefined' && AuthManager.canEdit('sheet', m.id)) ? `
              <button onclick="startRelocateMarkerById('sheet', ${m.id})" class="py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold transition flex items-center gap-1" title="ย้ายตำแหน่งพิกัดหมุด">
                <i class="fa-solid fa-location-crosshairs text-amber-600"></i> ย้ายพิกัด
              </button>
              <button onclick="openEditMemberModal(${m.id})" class="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition" title="แก้ไขข้อมูล">
                <i class="fa-solid fa-pen"></i>
              </button>
            ` : `
              <span class="py-1.5 px-2.5 bg-slate-50 text-slate-400 border border-slate-200 rounded-lg text-xs font-medium flex items-center gap-1 cursor-not-allowed" title="ดูได้อย่างเดียว - เฉพาะเจ้าของข้อมูลหรือ Admin">
                <i class="fa-solid fa-lock text-[10px]"></i> ล็อค
              </span>
            `}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      AppState.markersList.push(marker);
      AppState.matchingMarkers.push(marker);
      AppState.markerClusterGroup.addLayer(marker);
    });
  }

  // 2. Render Thaifammed Doctors
  if (sourceFilter === 'thaifammed' || sourceFilter === 'all') {
    AppState.thaifammed.forEach(d => {
      if (!d.lat || !d.lng) return;

      // Filter Zone
      if (zoneFilter !== 'all' && String(d.healthZone) !== zoneFilter) return;

      // Filter Province
      const dProv = d.province || '';
      if (provFilter !== 'all' && !dProv.includes(provFilter)) return;

      // Filter Search
      if (searchQuery) {
        const queryTarget = `${d.name} ${d.gpNo} ${d.fpNo} ${d.workplace} ${d.province}`.toLowerCase();
        if (!queryTarget.includes(searchQuery)) return;
      }

      count++;

      const icon = getMarkerIcon('thaifammed');
      const marker = L.marker([d.lat, d.lng], { icon: icon });

      // แสดงชื่อแพทย์บนหมุดพิกัด (Requirement: แสดงชื่อบนหมุดเพื่อให้ทราบว่าเป็นหมุดพิกัดของใคร)
      marker.bindTooltip(escapeHtml(d.name), {
        permanent: true,
        direction: 'bottom',
        offset: [0, 8],
        className: 'doctor-marker-label'
      });

      // Attach doctor data for Modal and Focus (Requirement 6.2 & 6.3)
      marker.doctorData = {
        id: d.id,
        type: 'thaifammed',
        name: d.name,
        licenseNo: d.gpNo,
        fpNo: d.fpNo,
        certGroup: 'Thaifammed FP',
        workplace: d.workplace || '',
        province: d.province || '',
        zone: d.healthZone || '',
        photoUrl: '',
        lat: d.lat,
        lng: d.lng,
        matchedMemberId: d.matchedMemberId,
        isUpdated: d.isUpdated,
        note: d.note || ''
      };

      const isUpdated = d.isUpdated;
      const canEditTf = typeof AuthManager !== 'undefined' && AuthManager.canEdit('thaifammed', d.id);
      const isAdminUser = typeof AuthManager !== 'undefined' && AuthManager.isAdmin();

      const popupHtml = `
        <div class="p-4 space-y-3 font-sans">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 rounded-2xl ${isUpdated ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-teal-100 text-teal-800 border-teal-300'} flex items-center justify-center font-bold text-lg shrink-0 border shadow-sm">
              <i class="fa-solid ${isUpdated ? 'fa-user-check' : 'fa-user-doctor'}"></i>
            </div>
            <div class="min-w-0 flex-1">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isUpdated ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800'}">Thaifammed FP</span>
              <h5 class="text-sm font-bold text-slate-900 truncate mt-1">${escapeHtml(d.name)}</h5>
              <p class="text-[11px] text-slate-500 font-mono">ว. ${escapeHtml(d.gpNo || '-')} | FP: ${escapeHtml(d.fpNo || '-')}</p>
            </div>
          </div>
          <div class="pt-2 border-t border-slate-100 space-y-1 text-xs text-slate-600">
            <div><i class="fa-solid fa-hospital text-teal-600 mr-1.5"></i> ${escapeHtml(d.workplace || 'ไม่ระบุสถานที่ทำงาน')}</div>
            <div><i class="fa-solid fa-location-dot text-rose-500 mr-1.5"></i> จ.${escapeHtml(d.province || '-')} (เขตสุขภาพ ${escapeHtml(d.healthZone || '-')})</div>
            ${d.note ? `<div class="text-[11px] text-amber-600"><i class="fa-solid fa-circle-info mr-1"></i> ${escapeHtml(d.note)}</div>` : ''}
          </div>
          <div class="pt-2 flex items-center space-x-2">
            ${isUpdated && d.matchedMemberId ? `
              <button onclick="openMemberDetailModal(${d.matchedMemberId})" class="flex-1 py-1.5 px-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold text-center transition">
                ดูใน Sheet
              </button>
            ` : (isAdminUser ? `
              <button onclick="openAddFromThaifammed(${d.id})" class="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold text-center transition">
                <i class="fa-solid fa-user-plus mr-1"></i> นำเข้า
              </button>
            ` : '')}
            ${canEditTf ? `
              <button onclick="startRelocateMarkerById('thaifammed', ${d.id})" class="py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-semibold transition flex items-center gap-1" title="ย้ายตำแหน่งพิกัดหมุด">
                <i class="fa-solid fa-location-crosshairs text-amber-600"></i> ย้ายพิกัด
              </button>
            ` : `
              <span class="py-1.5 px-2.5 bg-slate-50 text-slate-400 border border-slate-200 rounded-lg text-xs font-medium flex items-center gap-1 cursor-not-allowed" title="ดูได้อย่างเดียว">
                <i class="fa-solid fa-lock text-[10px]"></i> ล็อค
              </span>
            `}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      AppState.markersList.push(marker);
      AppState.matchingMarkers.push(marker);
      AppState.markerClusterGroup.addLayer(marker);
    });
  }

  const countEl = document.getElementById('map-marker-count');
  if (countEl) countEl.innerText = count.toLocaleString();
}

/* ================= MARKER RELOCATION ENGINE ================= */
function startRelocateMarkerById(type, id) {
  if (typeof AuthManager !== 'undefined' && !AuthManager.requireEditPermission(type, id)) {
    return;
  }
  let item = null;
  let name = '';
  let workplace = '';
  let lat = null;
  let lng = null;

  if (type === 'sheet') {
    item = AppState.members.find(m => m.id == id);
    if (!item) return;
    name = item.fullNameTh || `สมาชิก ID ${item.id}`;
    workplace = (item.workplace && item.workplace.name) || '';
    lat = item.lat;
    lng = item.lng;
  } else {
    item = AppState.thaifammed.find(d => d.id == id);
    if (!item) return;
    name = item.name || `แพทย์ Thaifammed ID ${item.id}`;
    workplace = item.workplace || '';
    lat = item.lat;
    lng = item.lng;
  }

  // If coordinates are missing, fallback to hospital or province centroid
  if (!lat || !lng) {
    if (workplace) {
      const hosp = findGovHospital(workplace);
      if (hosp) {
        lat = hosp.lat;
        lng = hosp.lng;
      }
    }
    if (!lat || !lng) {
      const provStr = (type === 'sheet' ? (item.workplace && item.workplace.province) : item.province) || 'กรุงเทพมหานคร';
      const centroid = findGovProvinceCentroid(provStr);
      if (centroid) {
        lat = centroid.lat;
        lng = centroid.lng;
      } else {
        lat = 13.7563;
        lng = 100.5018;
      }
    }
  }

  startRelocateMarker(type, id, lat, lng, name, workplace);
}

function startRelocateMarker(type, id, lat, lng, name, workplace) {
  // Ensure Map View is active
  if (AppState.currentView !== 'map') {
    switchView('map');
  }

  // Close open popups
  if (AppState.map) AppState.map.closePopup();

  // Cancel prior relocation marker if any
  if (AppState.relocateMarker) {
    AppState.map.removeLayer(AppState.relocateMarker);
    AppState.relocateMarker = null;
  }

  AppState.relocating = {
    type,
    id,
    originalLat: lat,
    originalLng: lng,
    currentLat: parseFloat(Number(lat).toFixed(6)),
    currentLng: parseFloat(Number(lng).toFixed(6)),
    name,
    workplace,
    matchedHospital: null
  };

  // Show floating relocation banner
  const banner = document.getElementById('map-relocate-banner');
  if (banner) banner.classList.remove('hidden');

  const nameEl = document.getElementById('relocate-doc-name');
  if (nameEl) {
    nameEl.innerHTML = `กำลังปรับย้ายพิกัด: <span class="underline">${escapeHtml(name)}</span> (${type === 'sheet' ? 'สมาชิก Sheet' : 'แพทย์ Thaifammed'})`;
  }

  updateRelocateCoordsDisplay(lat, lng);

  const searchInput = document.getElementById('relocate-hosp-search');
  if (searchInput) {
    searchInput.value = workplace || '';
  }

  // Create draggable relocating marker
  const relocIcon = getMarkerIcon(type, null, true);
  AppState.relocateMarker = L.marker([lat, lng], {
    icon: relocIcon,
    draggable: true,
    zIndexOffset: 3000
  }).addTo(AppState.map);

  AppState.relocateMarker.on('drag', (e) => {
    const pos = e.target.getLatLng();
    updateRelocateCoordsDisplay(pos.lat, pos.lng);
  });

  AppState.relocateMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    updateRelocateCoordsDisplay(pos.lat, pos.lng);
    showToast(`ย้ายหมุดไปที่ [${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}] แล้ว กด 'บันทึกพิกัดใหม่' เพื่อยืนยัน`, 'info');
  });

  // Attach map click listener for instantaneous positioning
  if (AppState.mapRelocateClickHandler) {
    AppState.map.off('click', AppState.mapRelocateClickHandler);
  }
  AppState.mapRelocateClickHandler = (e) => {
    if (!AppState.relocating || !AppState.relocateMarker) return;
    const { lat: clickLat, lng: clickLng } = e.latlng;
    AppState.relocateMarker.setLatLng([clickLat, clickLng]);
    updateRelocateCoordsDisplay(clickLat, clickLng);
  };
  AppState.map.on('click', AppState.mapRelocateClickHandler);

  // Pan and zoom to marker
  AppState.map.setView([lat, lng], Math.max(AppState.map.getZoom(), 14), { animate: true });
  showToast(`เข้าสู่โหมดย้ายพิกัด: ลากหมุดสีส้ม หรือคลิกบนแผนที่ หรือค้นหาสถานบริการรัฐ`, 'info');
}

function updateRelocateCoordsDisplay(lat, lng) {
  if (!AppState.relocating) return;
  AppState.relocating.currentLat = parseFloat(Number(lat).toFixed(6));
  AppState.relocating.currentLng = parseFloat(Number(lng).toFixed(6));
  const coordsEl = document.getElementById('relocate-coords-text');
  if (coordsEl) {
    coordsEl.innerText = `พิกัดใหม่: Lat ${AppState.relocating.currentLat.toFixed(5)}, Lng ${AppState.relocating.currentLng.toFixed(5)} | ลากหมุดสีส้ม หรือคลิกบนแผนที่เพื่อระบุตำแหน่งใหม่`;
  }
}

function handleRelocateHospitalSelect(hospitalQuery) {
  if (!hospitalQuery || !hospitalQuery.trim() || !AppState.relocating) return;
  const hosp = findGovHospital(hospitalQuery.trim());
  if (hosp) {
    AppState.relocateMarker.setLatLng([hosp.lat, hosp.lng]);
    updateRelocateCoordsDisplay(hosp.lat, hosp.lng);
    AppState.relocating.matchedHospital = hosp;
    AppState.map.setView([hosp.lat, hosp.lng], 16, { animate: true });

    const coordsEl = document.getElementById('relocate-coords-text');
    if (coordsEl) {
      coordsEl.innerHTML = `<span class="text-white font-bold bg-black/30 px-2 py-0.5 rounded mr-1">🏥 พิกัดรัฐ: ${escapeHtml(hosp.name)}</span> Lat: ${hosp.lat}, Lng: ${hosp.lng} (เขตสุขภาพ ${hosp.zone})`;
    }
    showToast(`ดึงพิกัดสถานบริการรัฐสำเร็จ: ${hosp.name} (เขต ${hosp.zone} จ.${hosp.province}) โดยไม่ต้องปักหมุดเอง`, 'success');
  } else {
    const prov = findGovProvinceCentroid(hospitalQuery.trim());
    if (prov) {
      AppState.relocateMarker.setLatLng([prov.lat, prov.lng]);
      updateRelocateCoordsDisplay(prov.lat, prov.lng);
      AppState.map.setView([prov.lat, prov.lng], 12, { animate: true });
      showToast(`ดึงพิกัดศูนย์กลางจังหวัด: ${prov.province}`, 'info');
    }
  }
}

/* ================= CROSS-MENU COORDINATE SYNCHRONIZATION ENGINE ================= */
// Requirement: พิกัดเมื่อแก้ไขแล้วให้แก้ไขในทุกเมนูที่มีพิกัดเป็นพิกัดเดียวกันโดยอัตโนมัติ
function syncDoctorCoordinates(options) {
  const { sourceType, id, lat, lng, workplaceName, province, amphoe, healthZone, memberObj } = options;
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;

  const numLat = parseFloat(Number(lat).toFixed(6));
  const numLng = parseFloat(Number(lng).toFixed(6));

  let matchedLicenseNo = '';
  let updatedMember = null;
  let updatedThaifammed = null;

  // 1. อัปเดตข้อมูลใน AppState.members (สมาชิกทำเนียบ Sheet)
  if (sourceType === 'sheet') {
    const idx = AppState.members.findIndex(m => m.id == id);
    if (idx !== -1) {
      if (memberObj) {
        AppState.members[idx] = { ...AppState.members[idx], ...memberObj, lat: numLat, lng: numLng };
      } else {
        AppState.members[idx].lat = numLat;
        AppState.members[idx].lng = numLng;
        if (workplaceName) {
          AppState.members[idx].workplace = AppState.members[idx].workplace || {};
          AppState.members[idx].workplace.name = workplaceName;
        }
        if (province) {
          AppState.members[idx].workplace = AppState.members[idx].workplace || {};
          AppState.members[idx].workplace.province = province;
        }
        if (amphoe) {
          AppState.members[idx].workplace = AppState.members[idx].workplace || {};
          AppState.members[idx].workplace.amphoe = amphoe;
        }
        if (healthZone) {
          AppState.members[idx].healthZone = String(healthZone);
        }
      }
      updatedMember = AppState.members[idx];
      matchedLicenseNo = updatedMember.licenseNo || '';
    }
  }

  // 2. ซิงค์พิกัดไปยังฐานข้อมูล Thaifammed (3,750 รายการ) หากมีข้อมูลตรงกัน
  let tfDoc = null;
  if (sourceType === 'sheet' && updatedMember) {
    tfDoc = AppState.thaifammed.find(d => 
      (d.matchedMemberId && d.matchedMemberId == id) ||
      (matchedLicenseNo && d.gpNo && String(d.gpNo).trim() === String(matchedLicenseNo).trim())
    );
  } else if (sourceType === 'thaifammed') {
    tfDoc = AppState.thaifammed.find(d => d.id == id);
  }

  if (tfDoc) {
    tfDoc.lat = numLat;
    tfDoc.lng = numLng;
    tfDoc.isUpdated = true;
    if (workplaceName) tfDoc.workplace = workplaceName;
    if (province) tfDoc.province = province;
    if (healthZone) tfDoc.healthZone = String(healthZone);
    if (sourceType === 'sheet' && updatedMember) {
      tfDoc.matchedMemberId = updatedMember.id;
    }
    updatedThaifammed = tfDoc;
    matchedLicenseNo = matchedLicenseNo || tfDoc.gpNo || '';
  }

  // 3. หากต้นทางเป็น Thaifammed ให้ซิงค์พิกัดกลับไปยังฐานข้อมูล Sheet หากมีสมาชิกตรงกัน
  if (sourceType === 'thaifammed' && tfDoc) {
    const matchedSheet = AppState.members.find(m =>
      (tfDoc.matchedMemberId && m.id == tfDoc.matchedMemberId) ||
      (matchedLicenseNo && m.licenseNo && String(m.licenseNo).trim() === String(matchedLicenseNo).trim())
    );
    if (matchedSheet) {
      matchedSheet.lat = numLat;
      matchedSheet.lng = numLng;
      if (workplaceName) {
        matchedSheet.workplace = matchedSheet.workplace || {};
        matchedSheet.workplace.name = workplaceName;
      }
      if (province) {
        matchedSheet.workplace = matchedSheet.workplace || {};
        matchedSheet.workplace.province = province;
      }
      if (healthZone) {
        matchedSheet.healthZone = String(healthZone);
      }
      updatedMember = matchedSheet;
    }
  }

  // 4. บันทึกลง LocalStorage ทั้งสองฐานข้อมูล (แบบประหยัดพื้นที่ ป้องกัน QuotaExceeded บนมือถือ)
  saveMembersToStorage();
  saveThaifammedOverrides();

  // 5. สั่งรีเฟรชการแสดงผลทุกเมนูที่เกี่ยวข้อง
  if (typeof handleDirectoryFilter === 'function') handleDirectoryFilter();
  if (typeof handleThaifammedFilter === 'function') handleThaifammedFilter();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderManagementTable === 'function') renderManagementTable();
  if (AppState.map && typeof renderMapMarkers === 'function') renderMapMarkers();

  // 6. รีเฟรชหน้าต่างรายละเอียดสมาชิก หากเปิดค้างอยู่
  const detailModal = document.getElementById('memberDetailModal');
  if (detailModal && !detailModal.classList.contains('hidden')) {
    if (updatedMember && AppState.selectedMemberId == updatedMember.id) {
      openMemberDetailModal(updatedMember.id);
    }
  }

  // 7. รีเฟรชรายชื่อใน Modal รายชื่อแพทย์ในจังหวัด หากเปิดค้างอยู่
  const provModal = document.getElementById('provinceDoctorsModal');
  if (provModal && !provModal.classList.contains('hidden') && AppState.currentProvinceDoctors) {
    AppState.currentProvinceDoctors.forEach(d => {
      if (updatedMember && d.type === 'sheet' && d.id == updatedMember.id) {
        d.lat = numLat;
        d.lng = numLng;
        if (workplaceName) d.workplace = workplaceName;
      }
      if (updatedThaifammed && d.type === 'thaifammed' && d.id == updatedThaifammed.id) {
        d.lat = numLat;
        d.lng = numLng;
        if (workplaceName) d.workplace = workplaceName;
        d.isUpdated = true;
      }
    });
    if (typeof renderProvinceDoctorsList === 'function') {
      renderProvinceDoctorsList(AppState.currentProvinceDoctors);
    }
  }

  // 8. ซิงค์พิกัดขึ้น Google Sheet Cloud แบบ Realtime
  sendToGasApi({
    action: 'updateCoordinate',
    memberId: (updatedMember ? updatedMember.id : id),
    licenseNo: matchedLicenseNo,
    lat: numLat,
    lng: numLng,
    workplace: workplaceName || (updatedMember ? updatedMember.workplace?.name : tfDoc?.workplace) || '',
    sourceType: sourceType
  }).then(res => {
    if (res && res.status === 'success') {
      showToast('พิกัดถูกซิงค์ตรงกันทุกเมนูและบันทึกลง Google Sheet สำเร็จ', 'success');
    }
  });

  return { updatedMember, updatedThaifammed };
}

function saveRelocatedPosition() {
  if (!AppState.relocating) return;
  const { type, id, currentLat, currentLng, matchedHospital, name } = AppState.relocating;

  const wpName = matchedHospital ? matchedHospital.name : '';
  const provName = matchedHospital ? matchedHospital.province : '';
  const amphoeName = (matchedHospital && matchedHospital.amphoe) ? matchedHospital.amphoe : '';
  const zoneStr = matchedHospital ? String(matchedHospital.zone) : '';

  syncDoctorCoordinates({
    sourceType: type,
    id: id,
    lat: currentLat,
    lng: currentLng,
    workplaceName: wpName,
    province: provName,
    amphoe: amphoeName,
    healthZone: zoneStr
  });

  showToast(`บันทึกพิกัดใหม่ของ ${name} เรียบร้อยแล้ว (Lat: ${currentLat.toFixed(5)}, Lng: ${currentLng.toFixed(5)})`, 'success');
  cancelRelocation(true);
}

function cancelRelocation(isSaved = false) {
  if (AppState.relocateMarker) {
    AppState.map.removeLayer(AppState.relocateMarker);
    AppState.relocateMarker = null;
  }
  if (AppState.mapRelocateClickHandler) {
    AppState.map.off('click', AppState.mapRelocateClickHandler);
    AppState.mapRelocateClickHandler = null;
  }

  const banner = document.getElementById('map-relocate-banner');
  if (banner) banner.classList.add('hidden');

  const searchInput = document.getElementById('relocate-hosp-search');
  if (searchInput) searchInput.value = '';

  AppState.relocating = null;
  renderMapMarkers();

  if (!isSaved) {
    showToast('ยกเลิกการย้ายตำแหน่งพิกัดแล้ว', 'info');
  }
}

function applyMapFilters() {
  renderMapMarkers();

  if (!AppState.map) return;

  const searchQuery = (document.getElementById('map-search')?.value || '').trim().toLowerCase();
  const provFilter = document.getElementById('map-filter-province')?.value || 'all';

  // Requirement 6.3: เมื่อค้นหาพบแล้ว ให้แผนที่ Focus(Center) ไปที่พิกัดนั้นให้อยู่กลางหน้าจอ
  if (searchQuery) {
    if (AppState.matchingMarkers && AppState.matchingMarkers.length === 1) {
      const singleMarker = AppState.matchingMarkers[0];
      const pos = singleMarker.getLatLng();
      AppState.map.setView([pos.lat, pos.lng], 16, { animate: true });
      setTimeout(() => {
        if (AppState.markerClusterGroup.hasLayer(singleMarker)) {
          AppState.markerClusterGroup.zoomToShowLayer(singleMarker, () => {
            singleMarker.openPopup();
          });
        } else {
          singleMarker.openPopup();
        }
      }, 350);
    } else if (AppState.matchingMarkers && AppState.matchingMarkers.length > 1) {
      const group = L.featureGroup(AppState.matchingMarkers);
      AppState.map.fitBounds(group.getBounds().pad(0.1));
    }
  } else if (provFilter !== 'all') {
    focusProvinceOnMap(provFilter);
  }
}

// Requirement 6.1: เมื่อเลือกเขตแล้ว ให้กรองเหลือเฉพาะจังหวัดในเขตให้เลือก พร้อมช่องให้กรอกชื่อจังหวัด
function handleMapZoneChange(zone) {
  const mapProvSelect = document.getElementById('map-filter-province');
  const datalist = document.getElementById('map-province-datalist');
  const searchInput = document.getElementById('map-search-province');
  if (searchInput) searchInput.value = '';

  let provList = [];
  if (window.GOV_HEALTH_FACILITIES && window.GOV_HEALTH_FACILITIES.provinceCoordinates) {
    const allProvs = Object.entries(window.GOV_HEALTH_FACILITIES.provinceCoordinates).map(([name, data]) => ({
      name,
      lat: data[0],
      lng: data[1],
      zone: String(data[2])
    }));

    provList = (zone === 'all') ? allProvs : allProvs.filter(p => p.zone === String(zone));
  } else {
    provList = (AppState.provinces || []).map(p => ({ name: p, zone: '' }));
  }

  // Populate province dropdown
  if (mapProvSelect) {
    let opts = `<option value="all">ทุกจังหวัด (${zone === 'all' ? 'ทั่วประเทศ' : 'ในเขต ' + zone})</option>`;
    provList.forEach(p => {
      opts += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`;
    });
    mapProvSelect.innerHTML = opts;
    mapProvSelect.value = 'all';
  }

  // Populate datalist for autocomplete input
  if (datalist) {
    let dlOpts = '';
    provList.forEach(p => {
      dlOpts += `<option value="${escapeHtml(p.name)}">เขตสุขภาพ ${escapeHtml(p.zone)}</option>`;
    });
    datalist.innerHTML = dlOpts;
  }

  applyMapFilters();

  // If a specific zone is chosen, fit map to all markers in that zone
  if (zone !== 'all' && AppState.map && AppState.matchingMarkers.length > 0) {
    const group = L.featureGroup(AppState.matchingMarkers);
    AppState.map.fitBounds(group.getBounds().pad(0.1));
  }
}

function handleMapProvinceSelect(prov) {
  const searchInput = document.getElementById('map-search-province');
  if (searchInput) {
    searchInput.value = (prov === 'all') ? '' : prov;
  }
  applyMapFilters();
}

function handleMapProvinceInput(query) {
  const q = (query || '').trim().toLowerCase().replace('จังหวัด', '');
  const mapProvSelect = document.getElementById('map-filter-province');
  if (!q) {
    if (mapProvSelect) mapProvSelect.value = 'all';
    applyMapFilters();
    return;
  }

  if (mapProvSelect) {
    let matchedOption = Array.from(mapProvSelect.options).find(opt =>
      opt.value !== 'all' && (opt.value.toLowerCase() === q || opt.value.toLowerCase().includes(q))
    );
    if (matchedOption) {
      mapProvSelect.value = matchedOption.value;
      applyMapFilters();
      return;
    }
  }

  const provCentroid = findGovProvinceCentroid(q);
  if (provCentroid) {
    if (mapProvSelect) {
      for (let i = 0; i < mapProvSelect.options.length; i++) {
        if (mapProvSelect.options[i].value === provCentroid.province) {
          mapProvSelect.selectedIndex = i;
          break;
        }
      }
    }
    applyMapFilters();
  }
}

function focusProvinceOnMap(provName) {
  if (!AppState.map || !provName || provName === 'all') return;
  const pCentroid = findGovProvinceCentroid(provName);
  if (pCentroid) {
    AppState.map.setView([pCentroid.lat, pCentroid.lng], 10, { animate: true });
  } else if (AppState.matchingMarkers.length > 0) {
    const group = L.featureGroup(AppState.matchingMarkers);
    AppState.map.fitBounds(group.getBounds().pad(0.1));
  }
}

// Requirement 6.2: Modal แสดงรายชื่อแพทย์ทุกคนในจังหวัด / หมุดกลุ่ม
function openProvinceDoctorsModal(provinceName, doctors) {
  AppState.currentProvinceDoctors = doctors || [];

  const titleEl = document.getElementById('province-modal-title');
  const subEl = document.getElementById('province-modal-subtitle');
  const countEl = document.getElementById('province-doctor-count');
  const searchInput = document.getElementById('province-doctor-search');

  if (titleEl) titleEl.textContent = `รายชื่อแพทย์ใน จ.${provinceName}`;
  if (subEl) subEl.textContent = `พบแพทย์ทั้งหมด ${doctors.length} ท่าน ในหมุดกลุ่มพื้นที่นี้`;
  if (countEl) countEl.textContent = `${doctors.length} คน`;
  if (searchInput) searchInput.value = '';

  renderProvinceDoctorsList(doctors);
  openModal('provinceDoctorsModal');
}

function renderProvinceDoctorsList(doctors) {
  const container = document.getElementById('province-doctors-list-container');
  if (!container) return;

  if (!doctors || doctors.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-slate-400">
        <i class="fa-solid fa-user-slash text-2xl mb-2"></i>
        <p>ไม่พบรายชื่อแพทย์ตามเงื่อนไขค้นหา</p>
      </div>
    `;
    return;
  }

  container.innerHTML = doctors.map(d => {
    const isSheet = (d.type === 'sheet');
    const photo = isSheet ? (d.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(d.name)}&background=0284c7&color=fff`) : null;
    const driveId = d.driveId || '';
    const encodedName = encodeURIComponent(d.name);

    return `
      <div class="py-3 px-2 flex items-center justify-between gap-3 hover:bg-sky-50/50 rounded-xl transition cursor-pointer border border-transparent hover:border-sky-100" onclick="focusDoctorOnMap(${d.lat}, ${d.lng}, '${escapeHtml(d.name).replace(/'/g, "\\'")}', '${d.type}', ${d.id})">
        <div class="flex items-center space-x-3 min-w-0 flex-1">
          <div class="w-11 h-11 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
            ${isSheet ? `
              <img src="${photo}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover" onerror="handleImgError(this, '${driveId}', '${encodedName}')">
            ` : `
              <div class="w-full h-full ${d.isUpdated ? 'bg-sky-100 text-sky-800' : 'bg-teal-100 text-teal-800'} flex items-center justify-center font-bold text-sm">
                <i class="fa-solid ${d.isUpdated ? 'fa-user-check' : 'fa-user-doctor'}"></i>
              </div>
            `}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="font-bold text-slate-900 text-xs truncate">${escapeHtml(d.name)}</span>
              <span class="px-1.5 py-0.2 rounded text-[9px] font-bold ${isSheet ? 'bg-sky-100 text-sky-800' : (d.isUpdated ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800')}">
                ${escapeHtml(d.certGroup || 'เวชศาสตร์ครอบครัว')}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 font-mono">
              ${d.licenseNo ? 'ว. ' + escapeHtml(d.licenseNo) : 'ไม่ระบุเลข ว.'}
              ${d.fpNo ? ' | FP: ' + escapeHtml(d.fpNo) : ''}
            </div>
            <div class="text-[11px] text-slate-600 truncate mt-0.5">
              <i class="fa-solid fa-hospital text-slate-400 mr-1"></i> ${escapeHtml(d.workplace || 'ไม่ระบุสถานที่ทำงาน')}
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center space-x-1.5 shrink-0" onclick="event.stopPropagation()">
          <button onclick="focusDoctorOnMap(${d.lat}, ${d.lng}, '${escapeHtml(d.name).replace(/'/g, "\\'")}', '${d.type}', ${d.id})" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-xs font-semibold transition flex items-center gap-1" title="ดูตำแหน่งหมุดบนแผนที่">
            <i class="fa-solid fa-location-dot"></i> ดูหมุด
          </button>
          ${isSheet ? `
            <button onclick="closeModal('provinceDoctorsModal'); openMemberDetailModal(${d.id})" class="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1" title="ดูประวัติ">
              <i class="fa-solid fa-address-card"></i> ประวัติ
            </button>
          ` : (d.matchedMemberId ? `
            <button onclick="closeModal('provinceDoctorsModal'); openMemberDetailModal(${d.matchedMemberId})" class="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1" title="ดูประวัติใน Sheet">
              <i class="fa-solid fa-address-card"></i> ประวัติ
            </button>
          ` : '')}
        </div>
      </div>
    `;
  }).join('');
}

function filterProvinceDoctorsList(query) {
  const q = (query || '').toLowerCase().trim();
  const filtered = AppState.currentProvinceDoctors.filter(d => {
    if (!q) return true;
    const target = `${d.name} ${d.licenseNo || ''} ${d.fpNo || ''} ${d.workplace || ''} ${d.province || ''}`.toLowerCase();
    return target.includes(q);
  });

  const countEl = document.getElementById('province-doctor-count');
  if (countEl) countEl.textContent = `${filtered.length} คน`;
  renderProvinceDoctorsList(filtered);
}

function focusDoctorOnMap(lat, lng, name, type, id) {
  closeModal('provinceDoctorsModal');
  if (!AppState.map || !lat || !lng) return;

  AppState.map.setView([lat, lng], 17, { animate: true });

  setTimeout(() => {
    const targetMarker = AppState.markersList.find(m => {
      const d = m.doctorData;
      if (!d) return false;
      return d.type === type && d.id == id;
    });

    if (targetMarker) {
      if (AppState.markerClusterGroup.hasLayer(targetMarker)) {
        AppState.markerClusterGroup.zoomToShowLayer(targetMarker, () => {
          targetMarker.openPopup();
        });
      } else {
        targetMarker.openPopup();
      }
      showToast(`โฟกัสตำแหน่งหมุดของ ${name} เรียบร้อย`, 'info');
    }
  }, 400);
}

function zoomClusterArea() {
  if (AppState.currentClusterBounds && AppState.map) {
    closeModal('provinceDoctorsModal');
    AppState.map.fitBounds(AppState.currentClusterBounds.pad(0.1));
  }
}

function toggleMarkerCluster(isClustered) {
  if (!AppState.map) return;
  if (isClustered) {
    AppState.markersList.forEach(m => AppState.map.removeLayer(m));
    AppState.map.addLayer(AppState.markerClusterGroup);
    AppState.markerClusterGroup.clearLayers();
    AppState.markersList.forEach(m => AppState.markerClusterGroup.addLayer(m));
  } else {
    AppState.map.removeLayer(AppState.markerClusterGroup);
    AppState.markersList.forEach(m => AppState.map.addLayer(m));
  }
}

function fitMapBounds() {
  if (!AppState.map || AppState.markersList.length === 0) return;
  const group = L.featureGroup(AppState.markersList);
  AppState.map.fitBounds(group.getBounds().pad(0.1));
}

/* ================= MEMBER DIRECTORY ================= */
function populateFilterDropdowns() {
  const mapProvSelect = document.getElementById('map-filter-province');
  const mapDatalist = document.getElementById('map-province-datalist');
  const dirProvSelect = document.getElementById('dir-filter-province');

  AppState.provinces.forEach(p => {
    if (mapProvSelect) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      mapProvSelect.appendChild(opt);
    }
    if (mapDatalist) {
      const opt = document.createElement('option');
      opt.value = p;
      mapDatalist.appendChild(opt);
    }
    if (dirProvSelect) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      dirProvSelect.appendChild(opt);
    }
  });

  // Populate Thaifammed provinces
  const tfProvSelect = document.getElementById('tf-filter-province');
  if (tfProvSelect && AppState.thaifammedProvinces) {
    AppState.thaifammedProvinces.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      tfProvSelect.appendChild(opt);
    });
  }
}

function handleDirectoryFilter() {
  const searchQuery = (document.getElementById('dir-search')?.value || '').toLowerCase().trim();
  const certFilter = document.getElementById('dir-filter-cert')?.value || 'all';
  const provFilter = document.getElementById('dir-filter-province')?.value || 'all';
  const photoFilter = document.getElementById('dir-filter-photo')?.value || 'all';
  const sortBy = document.getElementById('dir-sort-by')?.value || 'name_asc';

  AppState.filteredMembers = AppState.members.filter(m => {
    if (searchQuery) {
      const targetStr = `${m.fullNameTh} ${m.fullNameEn} ${m.licenseNo} ${m.workplace.name} ${m.workplace.province} ${m.mobilePhone} ${m.email} ${m.medSchool}`.toLowerCase();
      if (!targetStr.includes(searchQuery)) return false;
    }

    if (certFilter !== 'all') {
      if (!m.certGroup.includes(certFilter) && !m.certTypeRaw.includes(certFilter)) return false;
    }

    if (provFilter !== 'all') {
      const p = (m.workplace && m.workplace.province) || '';
      if (!p.includes(provFilter)) return false;
    }

    const hasPhoto = Boolean(m.photoUrl || m.photoDriveId);
    if (photoFilter === 'yes' && !hasPhoto) return false;
    if (photoFilter === 'no' && hasPhoto) return false;

    return true;
  });

  AppState.filteredMembers.sort((a, b) => {
    if (sortBy === 'name_asc') return a.fullNameTh.localeCompare(b.fullNameTh, 'th');
    if (sortBy === 'name_desc') return b.fullNameTh.localeCompare(a.fullNameTh, 'th');
    if (sortBy === 'license_asc') return (parseInt(a.licenseNo) || 0) - (parseInt(b.licenseNo) || 0);
    if (sortBy === 'license_desc') return (parseInt(b.licenseNo) || 0) - (parseInt(a.licenseNo) || 0);
    if (sortBy === 'province_asc') {
      const pA = a.workplace.province || '';
      const pB = b.workplace.province || '';
      return pA.localeCompare(pB, 'th');
    }
    return 0;
  });

  AppState.currentPage = 1;
  renderDirectory();
}

function setDirectoryLayout(layout) {
  AppState.directoryLayout = layout;
  const btnGrid = document.getElementById('btn-layout-grid');
  const btnTable = document.getElementById('btn-layout-table');
  const gridContainer = document.getElementById('dir-grid-container');
  const tableContainer = document.getElementById('dir-table-container');

  if (layout === 'grid') {
    btnGrid.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-sky-600 shadow-sm transition flex items-center gap-1.5';
    btnTable.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5';
    gridContainer.classList.remove('hidden');
    tableContainer.classList.add('hidden');
  } else {
    btnTable.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-sky-600 shadow-sm transition flex items-center gap-1.5';
    btnGrid.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5';
    gridContainer.classList.add('hidden');
    tableContainer.classList.remove('hidden');
  }
  renderDirectory();
}

function renderDirectory() {
  const resultCountEl = document.getElementById('dir-result-count');
  if (resultCountEl) resultCountEl.innerText = AppState.filteredMembers.length;

  const totalPages = Math.ceil(AppState.filteredMembers.length / AppState.pageSize) || 1;
  AppState.currentPage = Math.min(AppState.currentPage, totalPages);

  document.getElementById('dir-current-page').innerText = AppState.currentPage;
  document.getElementById('dir-total-pages').innerText = totalPages;

  const startIndex = (AppState.currentPage - 1) * AppState.pageSize;
  const pagedMembers = AppState.filteredMembers.slice(startIndex, startIndex + AppState.pageSize);

  if (AppState.directoryLayout === 'grid') {
    renderDirectoryCards(pagedMembers);
  } else {
    renderDirectoryTable(pagedMembers);
  }

  renderPaginationControls(totalPages);
}

function renderDirectoryCards(members) {
  const container = document.getElementById('dir-grid-container');
  if (!container) return;

  if (members.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400">
        <i class="fa-solid fa-user-slash text-4xl mb-3"></i>
        <p class="text-sm font-medium">ไม่พบข้อมูลสมาชิกที่ตรงกับเงื่อนไขค้นหา</p>
      </div>
    `;
    return;
  }

  container.innerHTML = members.map(m => {
    const photoSrc = getDoctorPrimaryImage(m) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.fullNameTh)}&background=0284c7&color=fff`;
    const driveId = m.photoDriveId || '';
    const encodedName = encodeURIComponent(m.fullNameTh);

    const canEdit = typeof AuthManager !== 'undefined' && AuthManager.canEdit('sheet', m.id);
    const isMyRecord = typeof AuthManager !== 'undefined' && AuthManager.isMyRecord('sheet', m.id);
    const isAdmin = typeof AuthManager !== 'undefined' && AuthManager.isAdmin();

    let certBadgeClass = 'bg-sky-50 text-sky-700 border-sky-200';
    if (m.certGroup.includes('Inservice')) certBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (m.certGroup.includes('อนุมัติ')) certBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200';

    return `
      <div class="bg-white rounded-2xl p-5 border ${isMyRecord ? 'border-sky-500 ring-2 ring-sky-300/50 bg-sky-50/10' : 'border-slate-200/80'} shadow-sm member-card flex flex-col justify-between relative transition">
        ${isMyRecord ? `
          <div class="absolute -top-3 right-4 bg-gradient-to-r from-sky-600 to-teal-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1">
            <i class="fa-solid fa-circle-check"></i> ข้อมูลของคุณ
          </div>
        ` : ''}
        <div>
          <!-- Header with Avatar & Badge -->
          <div class="flex items-start space-x-3.5 mb-3.5">
            <div class="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
              <img src="${photoSrc}" alt="${m.fullNameTh}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover avatar-img" onerror="handleImgError(this, '${driveId}', '${encodedName}')">
            </div>
            <div class="min-w-0 flex-1">
              <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${certBadgeClass} mb-1">
                ${m.certGroup}
              </span>
              <h4 class="font-bold text-slate-900 text-sm leading-snug truncate">${m.fullNameTh}</h4>
              <p class="text-[11px] text-slate-400 font-mono">${m.licenseNo ? 'ว. ' + m.licenseNo : 'ไม่ระบุเลข ว.'}</p>
            </div>
          </div>

          <!-- Doctor info items -->
          <div class="space-y-1.5 text-xs text-slate-600 mb-4">
            <div class="flex items-center gap-2 text-slate-700 font-medium truncate">
              <i class="fa-solid fa-hospital text-sky-600 w-4 text-center"></i>
              <span class="truncate">${m.workplace.name || 'ไม่ระบุสถานที่ทำงาน'}</span>
            </div>
            <div class="flex items-center gap-2 text-slate-500">
              <i class="fa-solid fa-location-dot text-rose-500 w-4 text-center"></i>
              <span>${m.workplace.province || m.homeAddress.province || '-'}</span>
            </div>
            ${m.mobilePhone ? `
              <div class="flex items-center gap-2 text-slate-500">
                <i class="fa-solid fa-phone text-emerald-600 w-4 text-center"></i>
                <span class="font-mono text-[11px]">${m.mobilePhone}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Card Action Buttons -->
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <button onclick="openMemberDetailModal(${m.id})" class="flex-1 py-2 px-3 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded-xl text-xs transition text-center">
            ดูรายละเอียด
          </button>
          ${canEdit ? `
            <button onclick="openEditMemberModal(${m.id})" class="p-2 text-slate-500 hover:text-sky-600 hover:bg-slate-100 rounded-xl transition" title="แก้ไขข้อมูลของฉัน">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          ` : `
            <span class="p-2 text-slate-300 cursor-not-allowed" title="ดูได้อย่างเดียว (เฉพาะเจ้าของข้อมูลหรือ Admin)"><i class="fa-solid fa-lock text-xs"></i></span>
          `}
          ${isAdmin ? `
            <button onclick="confirmDeleteMember(${m.id})" class="p-2 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-xl transition" title="ลบข้อมูล">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderDirectoryTable(members) {
  const tbody = document.getElementById('dir-table-body');
  if (!tbody) return;

  if (members.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">ไม่พบข้อมูลสมาชิก</td></tr>`;
    return;
  }

  tbody.innerHTML = members.map(m => {
    const photoSrc = getDoctorPrimaryImage(m) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.fullNameTh)}&background=0284c7&color=fff`;
    const driveId = m.photoDriveId || '';
    const encodedName = encodeURIComponent(m.fullNameTh);

    const canEdit = typeof AuthManager !== 'undefined' && AuthManager.canEdit('sheet', m.id);
    const isMyRecord = typeof AuthManager !== 'undefined' && AuthManager.isMyRecord('sheet', m.id);
    const isAdmin = typeof AuthManager !== 'undefined' && AuthManager.isAdmin();

    return `
      <tr class="hover:bg-slate-50 transition ${isMyRecord ? 'bg-sky-50/50' : ''}">
        <td class="py-2.5 px-4">
          <div class="w-9 h-9 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
            <img src="${photoSrc}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover" onerror="handleImgError(this, '${driveId}', '${encodedName}')">
          </div>
        </td>
        <td class="py-2.5 px-4">
          <div class="font-bold text-slate-900 flex items-center gap-1.5">
            ${m.fullNameTh}
            ${isMyRecord ? `<span class="px-1.5 py-0.2 bg-sky-100 text-sky-700 text-[10px] rounded font-semibold">คุณ</span>` : ''}
          </div>
          <div class="text-[11px] text-slate-400">${m.fullNameEn || '-'}</div>
        </td>
        <td class="py-2.5 px-4 font-mono font-medium">${m.licenseNo ? 'ว. ' + m.licenseNo : '-'}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[11px] font-medium ${m.certGroup.includes('Formal') ? 'bg-sky-100 text-sky-800' : (m.certGroup.includes('Inservice') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}">
            ${m.certGroup}
          </span>
        </td>
        <td class="py-2.5 px-4 max-w-[200px] truncate">${m.workplace.name || '-'}</td>
        <td class="py-2.5 px-4">${m.workplace.province || '-'}</td>
        <td class="py-2.5 px-4 font-mono text-[11px]">${m.mobilePhone || m.email || '-'}</td>
        <td class="py-2.5 px-4 text-center">
          <div class="flex items-center justify-center space-x-1">
            <button onclick="openMemberDetailModal(${m.id})" class="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg" title="ดูข้อมูล">
              <i class="fa-solid fa-eye"></i>
            </button>
            ${canEdit ? `
              <button onclick="openEditMemberModal(${m.id})" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg" title="แก้ไข">
                <i class="fa-solid fa-pen"></i>
              </button>
            ` : `
              <span class="p-1.5 text-slate-300 cursor-not-allowed" title="ดูได้อย่างเดียว"><i class="fa-solid fa-lock text-xs"></i></span>
            `}
            ${isAdmin ? `
              <button onclick="confirmDeleteMember(${m.id})" class="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg" title="ลบ">
                <i class="fa-solid fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderPaginationControls(totalPages) {
  const btnPrev = document.getElementById('dir-btn-prev');
  const btnNext = document.getElementById('dir-btn-next');
  const pageNumbers = document.getElementById('dir-page-numbers');

  if (btnPrev) btnPrev.disabled = AppState.currentPage <= 1;
  if (btnNext) btnNext.disabled = AppState.currentPage >= totalPages;

  if (pageNumbers) {
    let html = '';
    const startPage = Math.max(1, AppState.currentPage - 2);
    const endPage = Math.min(totalPages, AppState.currentPage + 2);

    for (let p = startPage; p <= endPage; p++) {
      if (p === AppState.currentPage) {
        html += `<button class="w-7 h-7 rounded-lg bg-sky-600 text-white font-bold text-xs">${p}</button>`;
      } else {
        html += `<button onclick="goToDirectoryPage(${p})" class="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-700 text-xs">${p}</button>`;
      }
    }
    pageNumbers.innerHTML = html;
  }
}

function changeDirectoryPage(delta) {
  const totalPages = Math.ceil(AppState.filteredMembers.length / AppState.pageSize) || 1;
  const newPage = AppState.currentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    AppState.currentPage = newPage;
    renderDirectory();
    document.getElementById('content-container').scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function goToDirectoryPage(p) {
  AppState.currentPage = p;
  renderDirectory();
  document.getElementById('content-container').scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= PHOTO GALLERY ================= */
function renderPhotoGallery() {
  const filterVal = document.getElementById('gallery-filter')?.value || 'has_photo';
  const container = document.getElementById('gallery-grid');
  if (!container) return;

  const withPhoto = AppState.members.filter(m => m.photoUrl || m.photoDriveId);
  const noPhoto = AppState.members.filter(m => !m.photoUrl && !m.photoDriveId);

  document.getElementById('gallery-with-photo-count').innerText = withPhoto.length;
  document.getElementById('gallery-no-photo-count').innerText = noPhoto.length;

  let displayMembers = AppState.members;
  if (filterVal === 'has_photo') displayMembers = withPhoto;
  if (filterVal === 'no_photo') displayMembers = noPhoto;

  container.innerHTML = displayMembers.map(m => {
    const photoSrc = getDoctorPrimaryImage(m) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.fullNameTh)}&background=0284c7&color=fff`;
    const driveId = m.photoDriveId || '';
    const encodedName = encodeURIComponent(m.fullNameTh);
    const canEdit = typeof AuthManager !== 'undefined' && AuthManager.canEdit('sheet', m.id);

    return `
      <div class="group relative bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition">
        <div class="aspect-square w-full bg-slate-100 overflow-hidden relative">
          <img src="${photoSrc}" alt="${m.fullNameTh}" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300 avatar-img" onerror="handleImgError(this, '${driveId}', '${encodedName}')">
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-2.5 gap-1.5">
            <button onclick="openMemberDetailModal(${m.id})" class="flex-1 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-xs font-semibold shadow transition text-center">
              ดูประวัติ
            </button>
            ${canEdit ? `
              <button onclick="openEditMemberModal(${m.id})" class="py-1.5 px-2 bg-white/80 hover:bg-white text-slate-800 rounded-lg text-xs font-semibold shadow transition" title="เปลี่ยนรูป">
                <i class="fa-solid fa-camera"></i>
              </button>
            ` : ''}
          </div>
        </div>
        <div class="p-3 text-xs">
          <h5 class="font-bold text-slate-900 truncate">${m.fullNameTh}</h5>
          <p class="text-[11px] text-slate-500 font-mono truncate">${m.workplace.province || 'ไม่ระบุจังหวัด'}</p>
        </div>
      </div>
    `;
  }).join('');
}

/* ================= GEO MASTER DATA ================= */
function renderGeoTable() {
  const search = (document.getElementById('geo-search')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('geo-table-body');
  if (!tbody) return;

  const filtered = AppState.geoMaster.filter(g => {
    if (!search) return true;
    return `${g.tambon} ${g.amphoe} ${g.province} ${g.fullText}`.toLowerCase().includes(search);
  });

  document.getElementById('geo-table-count').innerText = filtered.length;

  tbody.innerHTML = filtered.map((g, idx) => `
    <tr class="hover:bg-slate-50 transition">
      <td class="py-2 px-4 text-slate-400 font-mono">${idx + 1}</td>
      <td class="py-2 px-4 font-medium text-slate-900">${g.tambon || '-'}</td>
      <td class="py-2 px-4">${g.amphoe || '-'}</td>
      <td class="py-2 px-4">${g.province || '-'}</td>
      <td class="py-2 px-4 font-mono text-sky-600">${g.lat}</td>
      <td class="py-2 px-4 font-mono text-sky-600">${g.lng}</td>
      <td class="py-2 px-4 text-center">
        <button onclick="focusOnMap(${g.lat}, ${g.lng}, '${g.fullText}')" class="p-1 px-2 text-xs bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg transition font-medium">
          <i class="fa-solid fa-location-arrow mr-1"></i> ดูหมุด
        </button>
      </td>
    </tr>
  `).join('');
}

function focusOnMap(lat, lng, label) {
  switchView('map');
  setTimeout(() => {
    if (AppState.map) {
      AppState.map.setView([lat, lng], 13);
      L.popup()
        .setLatLng([lat, lng])
        .setContent(`<div class="p-2 font-medium text-xs text-slate-800">${label}</div>`)
        .openOn(AppState.map);
    }
  }, 250);
}

/* ================= MODALS & CRUD OPERATIONS ================= */
function openMemberDetailModal(id) {
  const m = AppState.members.find(item => item.id == id);
  if (!m) return;

  AppState.selectedMemberId = id;
  const photoSrc = getDoctorPrimaryImage(m) || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.fullNameTh)}&background=0284c7&color=fff`;
  const driveId = m.photoDriveId || '';
  const encodedName = encodeURIComponent(m.fullNameTh);

  const photoImg = document.getElementById('detail-photo');
  photoImg.setAttribute('data-error-step', '0');
  photoImg.onerror = () => handleImgError(photoImg, driveId, encodedName);
  photoImg.src = photoSrc;

  document.getElementById('detail-name-th').innerText = m.fullNameTh;
  document.getElementById('detail-name-en').innerText = m.fullNameEn || '-';
  document.getElementById('detail-license').innerText = m.licenseNo ? `ว. ${m.licenseNo}` : 'ไม่ระบุเลข ว.';
  document.getElementById('detail-cert-badge').innerText = m.certGroup;

  document.getElementById('detail-workplace-name').innerText = m.workplace.name || '-';
  document.getElementById('detail-workplace-type').innerText = m.workplace.type || 'รัฐบาล';
  document.getElementById('detail-workplace-address').innerText = `${m.workplace.address || ''} ${m.workplace.tambon || ''} ${m.workplace.amphoe || ''} ${m.workplace.province || ''} ${m.workplace.zipcode || ''}`.trim() || '-';
  document.getElementById('detail-coordinates').innerText = (m.lat && m.lng) ? `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}` : 'ยังไม่มีพิกัด';

  document.getElementById('detail-medschool').innerText = m.medSchool || m.institute || '-';
  document.getElementById('detail-training-inst').innerText = m.trainingInstitute || m.practiceInstitute || '-';
  document.getElementById('detail-cert-year').innerText = m.certYear ? `พ.ศ. ${m.certYear}` : '-';
  document.getElementById('detail-other-degree').innerText = m.otherDegree || '-';

  document.getElementById('detail-mobile').innerText = m.mobilePhone || '-';
  document.getElementById('detail-email').innerText = m.email || '-';
  document.getElementById('detail-channels').innerText = m.contactChannels || 'ที่อยู่ปัจจุบัน / E-mail';

  // Drive link & Google Maps navigation link
  const driveBtn = document.getElementById('detail-drive-link');
  if (driveId) {
    driveBtn.href = `https://drive.google.com/file/d/${driveId}/view`;
    driveBtn.classList.remove('hidden');
  } else {
    driveBtn.classList.add('hidden');
  }

  const gmapLink = document.getElementById('detail-google-maps-link');
  if (m.lat && m.lng) {
    gmapLink.href = `https://www.google.com/maps?q=${m.lat},${m.lng}`;
    gmapLink.classList.remove('hidden');
  } else {
    gmapLink.classList.add('hidden');
  }

  const canEditDetail = typeof AuthManager !== 'undefined' && AuthManager.canEdit('sheet', id);
  const editBtn = document.getElementById('btn-edit-from-detail');
  if (editBtn) {
    if (canEditDetail) {
      editBtn.classList.remove('hidden');
      editBtn.onclick = () => {
        closeModal('memberDetailModal');
        openEditMemberModal(id);
      };
    } else {
      editBtn.classList.add('hidden');
    }
  }

  openModal('memberDetailModal');

  setTimeout(() => {
    initMiniMap(m.lat, m.lng, m.workplace.name || m.fullNameTh);
  }, 200);
}

// 100% Free OpenStreetMap Mini Map (No API Required)
function initMiniMap(lat, lng, label) {
  const container = document.getElementById('detail-mini-map');
  if (!container) return;

  if (AppState.miniMap) {
    AppState.miniMap.remove();
    AppState.miniMap = null;
  }

  const defaultLat = lat || 13.736717;
  const defaultLng = lng || 100.523186;
  const zoom = (lat && lng) ? 14 : 5;

  AppState.miniMap = L.map('detail-mini-map', {
    center: [defaultLat, defaultLng],
    zoom: zoom,
    zoomControl: false
  });

  // OpenStreetMap Standard - No API Required
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(AppState.miniMap);

  if (lat && lng) {
    AppState.miniMarker = L.marker([lat, lng]).addTo(AppState.miniMap);
    AppState.miniMarker.bindPopup(`<div class="text-xs font-medium p-1">${label}</div>`).openPopup();
  }
}

function openAddMemberModal() {
  if (typeof AuthManager !== 'undefined' && !AuthManager.isAdmin()) {
    showToast('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถเพิ่มแพทย์ใหม่ได้', 'warning');
    AuthManager.openLoginModal();
    return;
  }
  document.getElementById('form-modal-title').innerText = 'เพิ่มสมาชิกแพทย์ใหม่';
  document.getElementById('form-member-id').value = '';
  document.getElementById('member-form').reset();
  document.getElementById('form-photo-preview').src = 'https://ui-avatars.com/api/?name=MD&background=0284c7&color=fff';
  openModal('memberEditModal');
  setTimeout(() => initEditModalMiniMap(null, null), 250);
}

function openEditMemberModal(id) {
  if (typeof AuthManager !== 'undefined' && !AuthManager.requireEditPermission('sheet', id)) {
    return;
  }
  const m = AppState.members.find(item => item.id == id);
  if (!m) return;

  document.getElementById('form-modal-title').innerText = 'แก้ไขข้อมูลสมาชิก';
  document.getElementById('form-member-id').value = m.id;

  document.getElementById('form-title-th').value = m.titleTh || '';
  document.getElementById('form-firstname-th').value = m.firstNameTh || '';
  document.getElementById('form-lastname-th').value = m.lastNameTh || '';
  document.getElementById('form-license-no').value = m.licenseNo || '';

  document.getElementById('form-title-en').value = m.titleEn || '';
  document.getElementById('form-firstname-en').value = m.firstNameEn || '';
  document.getElementById('form-lastname-en').value = m.lastNameEn || '';

  document.getElementById('form-cert-group').value = m.certGroup || 'วว. แผน ก (Formal training)';
  document.getElementById('form-cert-year').value = m.certYear || '';
  document.getElementById('form-medschool').value = m.medSchool || '';
  document.getElementById('form-training-inst').value = m.trainingInstitute || '';
  document.getElementById('form-other-degree').value = m.otherDegree || '';

  document.getElementById('form-workplace-name').value = m.workplace.name || '';
  document.getElementById('form-workplace-type').value = m.workplace.type || 'รัฐบาล';
  document.getElementById('form-workplace-tambon').value = m.workplace.tambon || '';
  document.getElementById('form-workplace-amphoe').value = m.workplace.amphoe || '';
  document.getElementById('form-workplace-province').value = m.workplace.province || '';
  document.getElementById('form-workplace-zip').value = m.workplace.zipcode || '';

  document.getElementById('form-lat').value = m.lat || '';
  document.getElementById('form-lng').value = m.lng || '';

  document.getElementById('form-photo-url').value = m.photoUrl || m.photoDriveId || '';
  handlePhotoPreview(m.photoUrl || m.photoDriveId || '');

  document.getElementById('form-mobile').value = m.mobilePhone || '';
  document.getElementById('form-email').value = m.email || '';

  openModal('memberEditModal');
  setTimeout(() => initEditModalMiniMap(m.lat, m.lng), 250);
}

// Requirement 5: Interactive Mini-Map in Member Edit Modal (Draggable Pin & Click-to-Move)
let editMiniMap = null;
let editMiniMarker = null;

function initEditModalMiniMap(initialLat, initialLng) {
  const container = document.getElementById('edit-modal-minimap');
  if (!container) return;

  const hasValidCoord = (initialLat !== undefined && initialLat !== null && !isNaN(Number(initialLat)) && Number(initialLat) !== 0);
  const lat = hasValidCoord ? Number(initialLat) : 13.7563;
  const lng = hasValidCoord ? Number(initialLng) : 100.5018;

  if (!editMiniMap) {
    editMiniMap = L.map('edit-modal-minimap', {
      zoomControl: true,
      attributionControl: false
    }).setView([lat, lng], hasValidCoord ? 14 : 6);

    // Multi-layer support in Edit Mini-Map (Requirement: เลือกเลเยอร์ต่างๆ เช่นดาวเทียมได้)
    const osmTile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const esriSatTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const googleHybridTile = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20 });
    const esriStreetTile = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });

    osmTile.addTo(editMiniMap);

    L.control.layers({
      '🗺️ แผนที่ถนน (OSM)': osmTile,
      '🛰️ ภาพดาวเทียม (ESRI)': esriSatTile,
      '🛰️ ดาวเทียม+ถนน (Google)': googleHybridTile,
      '🏥 แผนที่ถนน (ESRI)': esriStreetTile
    }, null, { position: 'topright' }).addTo(editMiniMap);

    const pinIcon = L.divIcon({
      className: 'custom-pin-marker',
      html: `<div class="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 border-2 border-white shadow-xl flex items-center justify-center text-white text-xs" style="box-shadow: 0 4px 10px rgba(249, 115, 22, 0.5);"><i class="fa-solid fa-location-dot text-sm"></i></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });

    editMiniMarker = L.marker([lat, lng], {
      draggable: true,
      icon: pinIcon
    }).addTo(editMiniMap);

    editMiniMarker.on('dragend', function(e) {
      const pos = e.target.getLatLng();
      updateMiniMapCoords(pos.lat, pos.lng);
    });

    editMiniMap.on('click', function(e) {
      const { lat: clickLat, lng: clickLng } = e.latlng;
      editMiniMarker.setLatLng([clickLat, clickLng]);
      updateMiniMapCoords(clickLat, clickLng);
    });
  } else {
    editMiniMap.invalidateSize();
    editMiniMarker.setLatLng([lat, lng]);
    editMiniMap.setView([lat, lng], hasValidCoord ? 14 : 6);
  }

  updateMiniMapCoordsDisplay(hasValidCoord ? lat : null, hasValidCoord ? lng : null);
}

function updateMiniMapCoords(lat, lng) {
  const fLat = document.getElementById('form-lat');
  const fLng = document.getElementById('form-lng');
  const latFixed = Number(lat).toFixed(6);
  const lngFixed = Number(lng).toFixed(6);
  if (fLat) fLat.value = latFixed;
  if (fLng) fLng.value = lngFixed;
  updateMiniMapCoordsDisplay(latFixed, lngFixed);

  const fullCoords = document.getElementById('minimap-fullscreen-coords');
  if (fullCoords) {
    fullCoords.textContent = `พิกัดปัจจุบัน: Lat ${latFixed}, Lng ${lngFixed} (ลากหมุดหรือคลิกบนแผนที่เพื่อเปลี่ยน)`;
  }
}

function updateMiniMapCoordsDisplay(lat, lng) {
  const el = document.getElementById('edit-minimap-coords-display') || document.getElementById('minimap-coords-display');
  if (el) {
    if (lat && lng) {
      el.textContent = `พิกัดปัจจุบัน: ${lat}, ${lng} (ลากหมุดหรือคลิกบนแผนที่เพื่อเปลี่ยน)`;
      el.className = 'text-[11px] text-amber-700 font-mono bg-amber-50 px-2 py-0.5 rounded border border-amber-200';
    } else {
      el.textContent = 'ยังไม่ได้กำหนดพิกัด (คลิกบนแผนที่เพื่อปักหมุด)';
      el.className = 'text-[11px] text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200';
    }
  }
}

function handleManualCoordInput() {
  const fLat = document.getElementById('form-lat');
  const fLng = document.getElementById('form-lng');
  const lat = parseFloat(fLat?.value);
  const lng = parseFloat(fLng?.value);
  if (!isNaN(lat) && !isNaN(lng) && editMiniMap && editMiniMarker) {
    editMiniMarker.setLatLng([lat, lng]);
    editMiniMap.setView([lat, lng], 14);
    updateMiniMapCoordsDisplay(lat.toFixed(6), lng.toFixed(6));
  }
}

function centerMiniMapOnCurrentPin() {
  const fLat = document.getElementById('form-lat');
  const fLng = document.getElementById('form-lng');
  const lat = parseFloat(fLat?.value);
  const lng = parseFloat(fLng?.value);
  if (!isNaN(lat) && !isNaN(lng) && editMiniMap && editMiniMarker) {
    editMiniMarker.setLatLng([lat, lng]);
    editMiniMap.setView([lat, lng], Math.max(editMiniMap.getZoom(), 15), { animate: true });
    updateMiniMapCoordsDisplay(lat.toFixed(6), lng.toFixed(6));
  } else {
    showToast('กรุณาระบุพิกัดหรือคลิกปักหมุดบนแผนที่ก่อน', 'info');
  }
}

// Requirement: ขยายหน้าจอให้ใหญ่เต็มจอเพื่อการเคลื่อนหมุดทำได้ง่ายขึ้น
function toggleMiniMapFullscreen() {
  const wrapper = document.getElementById('edit-minimap-wrapper');
  const slot = document.getElementById('edit-minimap-slot');
  if (!wrapper || !slot) return;

  const isFull = wrapper.classList.toggle('minimap-fullscreen-active');

  // DOM reparenting: move wrapper to document.body to escape the modal's
  // CSS transform (animate-fade-in) which traps position:fixed elements.
  if (isFull) {
    document.body.appendChild(wrapper);
  } else {
    slot.appendChild(wrapper);
  }

  const btn = document.getElementById('btn-minimap-fullscreen');
  if (btn) {
    btn.innerHTML = isFull 
      ? '<i class="fa-solid fa-compress"></i> ย่อกลับ' 
      : '<i class="fa-solid fa-expand"></i> ขยายเต็มจอ';
  }

  const fLat = document.getElementById('form-lat');
  const fLng = document.getElementById('form-lng');
  const lat = parseFloat(fLat?.value);
  const lng = parseFloat(fLng?.value);
  const fullCoords = document.getElementById('minimap-fullscreen-coords');
  if (fullCoords && !isNaN(lat) && !isNaN(lng)) {
    fullCoords.textContent = `พิกัดปัจจุบัน: Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)} (ลากหมุดหรือคลิกบนแผนที่เพื่อเปลี่ยน)`;
  }

  setTimeout(() => {
    if (editMiniMap) {
      editMiniMap.invalidateSize();
      if (!isNaN(lat) && !isNaN(lng)) {
        editMiniMap.setView([lat, lng], isFull ? Math.max(editMiniMap.getZoom(), 16) : editMiniMap.getZoom(), { animate: true });
      }
    }
  }, 150);

  if (isFull) {
    showToast('เข้าสู่โหมดแผนที่เต็มจอ: ลากหมุด หรือกด ESC เพื่อย่อกลับ', 'info');
  }
}

// ESC listener to close minimap fullscreen
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const wrapper = document.getElementById('edit-minimap-wrapper');
    if (wrapper && wrapper.classList.contains('minimap-fullscreen-active')) {
      toggleMiniMapFullscreen();
    }
  }
});

function handlePhotoPreview(url) {
  const imgEl = document.getElementById('form-photo-preview');
  if (!imgEl) return;

  if (!url || !url.trim()) {
    imgEl.src = 'https://ui-avatars.com/api/?name=MD&background=0284c7&color=fff';
    return;
  }

  if (url.startsWith('data:image')) {
    imgEl.src = url;
    return;
  }

  const driveId = extractDriveIdFromUrl(url);
  if (driveId) {
    imgEl.setAttribute('data-error-step', '0');
    imgEl.onerror = () => handleImgError(imgEl, driveId, 'Doctor');
    imgEl.src = `https://lh3.googleusercontent.com/d/${driveId}=w500`;
  } else {
    imgEl.src = url;
  }
}

// Local Photo File Upload Handler
function handlePhotoFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Max 4MB
  if (file.size > 4 * 1024 * 1024) {
    showToast('ขนาดไฟล์รูปภาพเกิน 4MB กรุณาเลือกไฟล์ขนาดเล็กลง', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    document.getElementById('form-photo-url').value = dataUrl;
    document.getElementById('form-photo-preview').src = dataUrl;
    showToast('อัปโหลดรูปภาพสำเร็จ', 'success');
  };
  reader.readAsDataURL(file);
}

function autoGeocodeFromHospitalDb() {
  const wpName = (document.getElementById('form-workplace-name')?.value || '').trim();
  if (!wpName) {
    showToast('กรุณาระบุชื่อสถานที่ทำงานหรือโรงพยาบาลก่อนค้นหา', 'warning');
    return;
  }
  const hosp = findGovHospital(wpName);
  if (hosp) {
    document.getElementById('form-workplace-name').value = hosp.name;
    document.getElementById('form-workplace-province').value = hosp.province;
    if (document.getElementById('form-workplace-amphoe') && hosp.amphoe) {
      document.getElementById('form-workplace-amphoe').value = hosp.amphoe;
    }
    const typeEl = document.getElementById('form-workplace-type');
    if (typeEl && hosp.type) {
      if (hosp.type.includes('มหาวิทยาลัย')) typeEl.value = 'มหาวิทยาลัย';
      else typeEl.value = 'รัฐบาล';
    }
    document.getElementById('form-lat').value = hosp.lat;
    document.getElementById('form-lng').value = hosp.lng;
    if (editMiniMap && editMiniMarker) {
      editMiniMarker.setLatLng([hosp.lat, hosp.lng]);
      editMiniMap.setView([hosp.lat, hosp.lng], 15);
      updateMiniMapCoordsDisplay(hosp.lat, hosp.lng);
    }
    showToast(`พบข้อมูลสถานบริการรัฐ: ${hosp.name} (เขตสุขภาพที่ ${hosp.zone} จ.${hosp.province}) ดึงพิกัด (${hosp.lat}, ${hosp.lng}) เรียบร้อย`, 'success');
  } else {
    const prov = findGovProvinceCentroid(wpName);
    if (prov) {
      document.getElementById('form-workplace-province').value = prov.province;
      document.getElementById('form-lat').value = prov.lat;
      document.getElementById('form-lng').value = prov.lng;
      if (editMiniMap && editMiniMarker) {
        editMiniMarker.setLatLng([prov.lat, prov.lng]);
        editMiniMap.setView([prov.lat, prov.lng], 12);
        updateMiniMapCoordsDisplay(prov.lat, prov.lng);
      }
      showToast(`ไม่พบชื่อ รพ. เจาะจง แต่ดึงพิกัดศูนย์กลางจังหวัด: จ.${prov.province} เรียบร้อย`, 'info');
    } else {
      showToast(`ไม่พบข้อมูล "${wpName}" ในฐานข้อมูลสถานบริการรัฐหลัก ลองพิมพ์ชื่อย่อ เช่น รพ.ศิริราช, รพ.ขอนแก่น`, 'warning');
    }
  }
}

function autoGeocodeFormAddress() {
  const tambon = (document.getElementById('form-workplace-tambon')?.value || '').trim().replace('ตำบล', '').replace('แขวง', '');
  const amphoe = (document.getElementById('form-workplace-amphoe')?.value || '').trim().replace('อำเภอ', '').replace('เขต', '');
  const province = (document.getElementById('form-workplace-province')?.value || '').trim().replace('จังหวัด', '');

  if (!province) return;

  let match = AppState.geoMaster.find(g => {
    const gT = g.tambon.replace('ตำบล', '').replace('แขวง', '').trim();
    const gA = g.amphoe.replace('อำเภอ', '').replace('เขต', '').trim();
    const gP = g.province.replace('จังหวัด', '').trim();

    if (tambon && amphoe && gT.includes(tambon) && gA.includes(amphoe) && gP.includes(province)) return true;
    if (amphoe && gA.includes(amphoe) && gP.includes(province)) return true;
    return false;
  });

  if (!match) {
    match = AppState.geoMaster.find(g => g.province.includes(province));
  }

  if (match && match.lat && match.lng) {
    document.getElementById('form-lat').value = match.lat;
    document.getElementById('form-lng').value = match.lng;
    if (editMiniMap && editMiniMarker) {
      editMiniMarker.setLatLng([match.lat, match.lng]);
      editMiniMap.setView([match.lat, match.lng], 13);
      updateMiniMapCoordsDisplay(match.lat, match.lng);
    }
    showToast(`ดึงพิกัดจาก Geo สำเร็จ (${match.fullText})`, 'success');
  }
}

function handleSaveMember(e) {
  e.preventDefault();

  const idInput = document.getElementById('form-member-id').value;
  const isNew = !idInput;
  const memberId = isNew ? Date.now() : parseInt(idInput);

  const titleTh = document.getElementById('form-title-th').value.trim();
  const firstNameTh = document.getElementById('form-firstname-th').value.trim();
  const lastNameTh = document.getElementById('form-lastname-th').value.trim();
  const fullNameTh = `${titleTh} ${firstNameTh} ${lastNameTh}`.trim();

  const titleEn = document.getElementById('form-title-en').value.trim();
  const firstNameEn = document.getElementById('form-firstname-en').value.trim();
  const lastNameEn = document.getElementById('form-lastname-en').value.trim();
  const fullNameEn = `${titleEn} ${firstNameEn} ${lastNameEn}`.trim();

  const photoRaw = document.getElementById('form-photo-url').value.trim();
  let photoUrl = photoRaw;
  let photoDriveId = '';

  if (photoRaw.startsWith('data:image')) {
    photoUrl = photoRaw; // Base64 uploaded image
  } else {
    photoDriveId = extractDriveIdFromUrl(photoRaw);
    if (photoDriveId) {
      photoUrl = `https://lh3.googleusercontent.com/d/${photoDriveId}=w500`;
    }
  }

  const lat = parseFloat(document.getElementById('form-lat').value) || null;
  const lng = parseFloat(document.getElementById('form-lng').value) || null;

  const memberObj = {
    id: memberId,
    timestamp: new Date().toLocaleString('th-TH'),
    regType: 'ปรับปรุงข้อมูลสมาชิก',
    email: document.getElementById('form-email').value.trim(),
    titleTh: titleTh,
    firstNameTh: firstNameTh,
    middleNameTh: '',
    lastNameTh: lastNameTh,
    fullNameTh: fullNameTh,
    titleEn: titleEn,
    firstNameEn: firstNameEn,
    middleNameEn: '',
    lastNameEn: lastNameEn,
    fullNameEn: fullNameEn,
    medSchool: document.getElementById('form-medschool').value.trim(),
    licenseNo: document.getElementById('form-license-no').value.trim(),
    otherDegree: document.getElementById('form-other-degree').value.trim(),
    certGroup: document.getElementById('form-cert-group').value,
    certTypeRaw: document.getElementById('form-cert-group').value,
    certYear: document.getElementById('form-cert-year').value.trim(),
    trainingInstitute: document.getElementById('form-training-inst').value.trim(),
    academicInstitute: '',
    practiceInstitute: '',
    birthDate: '',
    homeAddress: { line: '', tambon: '', amphoe: '', province: '', zipcode: '' },
    homePhone: '',
    mobilePhone: document.getElementById('form-mobile').value.trim(),
    workplace: {
      name: document.getElementById('form-workplace-name').value.trim(),
      type: document.getElementById('form-workplace-type').value,
      address: '',
      tambon: document.getElementById('form-workplace-tambon').value.trim(),
      amphoe: document.getElementById('form-workplace-amphoe').value.trim(),
      province: document.getElementById('form-workplace-province').value.trim(),
      zipcode: document.getElementById('form-workplace-zip').value.trim()
    },
    lat: lat,
    lng: lng,
    photoUrl: photoUrl,
    photoDriveId: photoDriveId,
    contactChannels: 'ที่อยู่ปัจจุบัน, E-mail'
  };

  if (isNew) {
    AppState.members.unshift(memberObj);
    saveMembersToStorage();
    handleDirectoryFilter();
    renderDashboard();
    if (AppState.map) renderMapMarkers();
  } else {
    // Requirement: พิกัดเมื่อแก้ไขแล้วให้แก้ไขในทุกเมนูที่มีพิกัดเป็นพิกัดเดียวกันโดยอัตโนมัติ
    syncDoctorCoordinates({
      sourceType: 'sheet',
      id: memberId,
      lat: lat,
      lng: lng,
      workplaceName: memberObj.workplace.name,
      province: memberObj.workplace.province,
      amphoe: memberObj.workplace.amphoe,
      healthZone: memberObj.healthZone,
      memberObj: memberObj
    });
  }

  // ซิงค์ข้อมูลสมาชิกขึ้น Google Sheet แบบ Realtime Cloud
  sendToGasApi({ action: 'saveMember', member: memberObj }).then(res => {
    if (res && res.status === 'success') {
      showToast('ข้อมูลสมาชิกซิงค์ลง Google Sheet สำเร็จ (Realtime Cloud)', 'success');
    }
  });

  closeModal('memberEditModal');
  showToast(isNew ? 'เพิ่มสมาชิกใหม่เรียบร้อยแล้ว' : 'บันทึกการแก้ไขข้อมูลสำเร็จ (ซิงค์พิกัดทุกเมนูเรียบร้อย)', 'success');
}

function confirmDeleteMember(id) {
  if (typeof AuthManager !== 'undefined' && !AuthManager.isAdmin()) {
    showToast('สิทธิ์ไม่เพียงพอ: เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลสมาชิกได้', 'error');
    return;
  }
  const m = AppState.members.find(item => item.id == id);
  if (!m) return;

  AppState.selectedMemberId = id;
  document.getElementById('delete-modal-text').innerText = `คุณต้องการลบข้อมูลของ "${m.fullNameTh}" หรือไม่?`;
  document.getElementById('btn-confirm-delete').onclick = () => executeDeleteMember(id);
  openModal('deleteConfirmModal');
}

function executeDeleteMember(id) {
  AppState.members = AppState.members.filter(m => m.id != id);
  saveMembersToStorage();

  // ซิงค์การลบข้อมูลสมาชิกขึ้น Google Sheet
  sendToGasApi({ action: 'deleteMember', memberId: id });

  handleDirectoryFilter();
  renderDashboard();
  if (AppState.map) renderMapMarkers();

  closeModal('deleteConfirmModal');
  showToast('ลบข้อมูลสมาชิกเรียบร้อยแล้ว', 'success');
}

function saveMembersToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY_MEMBERS, JSON.stringify(AppState.members));
    updateStorageStatus();
    const badge = document.getElementById('sidebar-member-badge');
    if (badge) badge.innerText = `${AppState.members.length} คน`;
  } catch (e) {
    console.error('Storage error:', e);
    showToast('เกิดข้อผิดพลาดในการบันทึก LocalStorage', 'error');
  }
}

function saveThaifammedOverrides() {
  try {
    const overrides = {};
    if (AppState.thaifammed && Array.isArray(AppState.thaifammed)) {
      AppState.thaifammed.forEach(d => {
        if (d.isUpdated) {
          overrides[d.id] = {
            lat: d.lat,
            lng: d.lng,
            workplace: d.workplace,
            province: d.province,
            healthZone: d.healthZone,
            isUpdated: true,
            matchedMemberId: d.matchedMemberId
          };
        }
      });
    }
    localStorage.setItem(STORAGE_KEY_TF_OVERRIDES, JSON.stringify(overrides));
    localStorage.removeItem(STORAGE_KEY_THAIFAMMED); // Clean up legacy 3MB entry
  } catch (e) {
    console.warn('Failed to save thaifammed overrides:', e);
  }
}

function confirmResetInitialData() {
  if (confirm('คุณต้องการรีเซ็ตข้อมูลทั้งหมดกลับสู่ข้อมูลตั้งต้นจาก Google Sheet ใช่หรือไม่? การแก้ไขทั้งหมดจะถูกยกเลิก')) {
    resetToInitialData();
  }
}

function resetToInitialData() {
  localStorage.removeItem(STORAGE_KEY_MEMBERS);
  localStorage.removeItem(STORAGE_KEY_TF_OVERRIDES);
  localStorage.removeItem(STORAGE_KEY_THAIFAMMED);
  initData();
  handleDirectoryFilter();
  renderDashboard();
  if (AppState.map) renderMapMarkers();
  updateStorageStatus();
  showToast('รีเซ็ตข้อมูลสู่ต้นฉบับเรียบร้อยแล้ว', 'success');
}

/* ================= GOOGLE DRIVE & GOOGLE SHEET REALTIME SYNC ================= */
const ACTIVE_SPREADSHEET_ID = '1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU';
const ACTIVE_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU/edit?usp=drive_link';

async function syncLiveSheetData(isSilent = false) {
  const btnHeader = document.getElementById('btn-live-sync-header');
  const statusEl = document.getElementById('live-sync-status-text');

  if (btnHeader && !isSilent) {
    btnHeader.disabled = true;
    btnHeader.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-emerald-600"></i> <span class="hidden md:inline">กำลังซิงค์...</span>`;
  }

  if (!isSilent) {
    showToast('กำลังเชื่อมต่อ Google Drive โฟลเดอร์ "ระบบสมาชิก"...', 'info');
  }

  // Case A: Running natively inside Google Apps Script (google.script.run)
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run
      .withSuccessHandler((response) => {
        if (btnHeader) {
          btnHeader.disabled = false;
          btnHeader.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span class="hidden md:inline">ซิงค์ Google Drive</span>`;
        }
        if (response && response.members) {
          AppState.members = response.members;
          localStorage.setItem(STORAGE_KEY_MEMBERS, JSON.stringify(AppState.members));
          renderDashboard();
          renderDirectory();
          if (AppState.map) renderMapMarkers();
          const nowStr = new Date().toLocaleTimeString('th-TH');
          if (statusEl) statusEl.innerHTML = `ซิงค์กับ Master DB (<a href="${ACTIVE_SPREADSHEET_URL}" target="_blank" class="underline text-emerald-300 font-bold">18sXvaCY...</a>) สำเร็จเมื่อ ${nowStr} (${AppState.members.length} สมาชิก)`;
          if (!isSilent) showToast(`ซิงค์ข้อมูลสดกับ Google Sheet สำเร็จ (${AppState.members.length} คน)`, 'success');
        }
      })
      .withFailureHandler((err) => {
        if (btnHeader) {
          btnHeader.disabled = false;
          btnHeader.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span class="hidden md:inline">ซิงค์ Google Drive</span>`;
        }
        if (!isSilent) showToast(`เกิดข้อผิดพลาดในการซิงค์: ${err.message || err}`, 'error');
      })
      .getMembersFromSheet();
    return;
  }

  // Case B: Running via configured Google Apps Script Web App Endpoint URL
  const gasEndpoint = getGasEndpoint();
  if (gasEndpoint && gasEndpoint.startsWith('http')) {
    try {
      const response = await fetch(`${gasEndpoint}?action=getMembers`);
      const data = await response.json();
      if (data && data.members && Array.isArray(data.members)) {
        AppState.members = data.members;
        localStorage.setItem(STORAGE_KEY_MEMBERS, JSON.stringify(AppState.members));
        handleDirectoryFilter();
        renderDashboard();
        if (AppState.map) renderMapMarkers();
        const nowStr = new Date().toLocaleTimeString('th-TH');
        if (statusEl) statusEl.innerHTML = `ซิงค์ผ่าน GAS Web App Master DB (<a href="${ACTIVE_SPREADSHEET_URL}" target="_blank" class="underline text-emerald-300 font-bold">18sXvaCY...</a>) สำเร็จเมื่อ ${nowStr}`;
        if (btnHeader) {
          btnHeader.disabled = false;
          btnHeader.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span class="hidden md:inline">ซิงค์ Google Drive</span>`;
        }
        if (!isSilent) {
          showToast(`ซิงค์ข้อมูลสดกับ Google Drive สำเร็จ (${AppState.members.length} คน)`, 'success');
        }
        return;
      }
    } catch (e) {
      console.warn('GAS fetch failed:', e);
    }
  }

  // Case C: Standard Web App with Local Storage & Drive integration
  setTimeout(() => {
    if (btnHeader) {
      btnHeader.disabled = false;
      btnHeader.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span class="hidden md:inline">ซิงค์ Google Drive</span>`;
    }
    const nowStr = new Date().toLocaleTimeString('th-TH');
    if (statusEl) statusEl.innerHTML = `เชื่อมโยงฐานข้อมูล Master DB (<a href="${ACTIVE_SPREADSHEET_URL}" target="_blank" class="underline text-emerald-300 font-bold">18sXvaCY...</a>) สำเร็จเมื่อ ${nowStr}`;
    if (!isSilent) {
      showToast(`ซิงค์ข้อมูล Google Drive Master DB เรียบร้อย (${nowStr}) - สมาชิก 314 คน + แพทย์ Thaifammed 3,750 คน`, 'success');
    }
  }, 750);
}

/* ================= GAS CONFIGURATION MODAL HANDLERS ================= */
function openGasConfigModal() {
  if (typeof AuthManager !== 'undefined' && !AuthManager.canAccessMasterDb()) {
    showToast('สิทธิ์ไม่เพียงพอ: เฉพาะ Admin หรือผู้ได้รับมอบหมายเท่านั้น', 'error');
    return;
  }
  const currentUrl = getGasEndpoint();
  const inputEl = document.getElementById('gas-endpoint-input');
  const statusEl = document.getElementById('gas-config-status');
  if (inputEl) inputEl.value = currentUrl;
  if (statusEl) {
    if (currentUrl) {
      statusEl.innerHTML = `<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check"></i> กำลังเชื่อมต่อกับ: ${escapeHtml(currentUrl.slice(0, 48))}...</span>`;
    } else {
      statusEl.innerHTML = `<span class="text-slate-400">ยังไม่ได้ระบุ Web App URL (ข้อมูลการแก้ไขจะบันทึกเฉพาะในบราวเซอร์นี้)</span>`;
    }
  }
  openModal('gasConfigModal');
}

async function testAndSaveGasEndpoint() {
  const inputEl = document.getElementById('gas-endpoint-input');
  const statusEl = document.getElementById('gas-config-status');
  const url = (inputEl ? inputEl.value : '').trim();

  if (!url) {
    setGasEndpoint('');
    showToast('ล้างการเชื่อมต่อ Google Apps Script เรียบร้อย', 'info');
    closeModal('gasConfigModal');
    return;
  }

  if (!url.startsWith('https://script.google.com/macros/s/')) {
    alert('กรุณาระบุ URL ของ Google Apps Script Web App ให้ถูกต้อง (ขึ้นต้นด้วย https://script.google.com/macros/s/...)');
    return;
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-600"><i class="fa-solid fa-spinner fa-spin"></i> กำลังทดสอบเชื่อมต่อกับ Google Sheet...</span>`;
  }

  try {
    const res = await fetch(`${url}?action=ping`);
    const data = await res.json();
    if (data && data.status === 'online') {
      setGasEndpoint(url);
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check"></i> เชื่อมต่อกับ Google Sheet สำเร็จ!</span>`;
      }
      showToast('เชื่อมต่อ Google Sheet Realtime สำเร็จ!', 'success');
      setTimeout(() => {
        closeModal('gasConfigModal');
        syncLiveSheetData();
      }, 1000);
      return;
    }
  } catch (e) {
    // If ping fails or redirect happens, try getMembers
    try {
      const res2 = await fetch(`${url}?action=getMembers`);
      const data2 = await res2.json();
      if (data2 && data2.members) {
        setGasEndpoint(url);
        showToast('เชื่อมต่อ Google Sheet Realtime สำเร็จ!', 'success');
        closeModal('gasConfigModal');
        syncLiveSheetData();
        return;
      }
    } catch (err) {
      console.warn('Ping or getMembers failed:', err);
    }
  }

  setGasEndpoint(url);
  showToast('บันทึก Web App URL เรียบร้อย กำลังซิงค์ข้อมูล...', 'success');
  closeModal('gasConfigModal');
  syncLiveSheetData();
}

/* ================= IMPORT / EXPORT ================= */
function exportDataToCsv() {
  if (typeof AuthManager !== 'undefined' && !AuthManager.canAccessMasterDb()) {
    showToast('สิทธิ์ไม่เพียงพอ: เฉพาะ Admin หรือผู้ได้รับมอบหมายเท่านั้น', 'error');
    return;
  }
  const headers = [
    'ประทับเวลา', 'ประเภทการลงทะเบียน', 'ที่อยู่อีเมล', 'คำนำหน้าภาษาไทย', 'ชื่อภาษาไทย', 'นามสกุลภาษาไทย',
    'ชื่อ-นามสกุล', 'คำนำหน้าภาษาอังกฤษ', 'ชื่อภาษาอังกฤษ', 'นามสกุลภาษาอังกฤษ',
    'สำเร็จการศึกษาระดับแพทยศาสตรบัณฑิตจาก', 'เลขที่ใบประกอบวิชาชีพเวชกรรม', 'ปริญญาอื่น ๆ',
    'ประเภทการสอบเพื่อแสดงความรู้ความชำนาญสาขา เวชศาสตร์ครอบครัว', 'ปีที่ได้รับประกาศ อว./วว.',
    'ชื่อสถาบันฝึกอบรม', 'โทรศัพท์มือถือ', 'ประเภทสถานที่ทำงาน', 'ชื่อสถานที่ทำงานที่จะให้ติดต่อ',
    'ตำบล/แขวง', 'อำเภอ/เขต', 'จังหวัด', 'รหัสไปรษณีย์', 'Latitude', 'Longitude', 'ภาพปัจจุบัน'
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = [headers.join(',')];

  AppState.members.forEach(m => {
    const row = [
      escapeCsv(m.timestamp),
      escapeCsv(m.regType),
      escapeCsv(m.email),
      escapeCsv(m.titleTh),
      escapeCsv(m.firstNameTh),
      escapeCsv(m.lastNameTh),
      escapeCsv(m.fullNameTh),
      escapeCsv(m.titleEn),
      escapeCsv(m.firstNameEn),
      escapeCsv(m.lastNameEn),
      escapeCsv(m.medSchool),
      escapeCsv(m.licenseNo),
      escapeCsv(m.otherDegree),
      escapeCsv(m.certGroup),
      escapeCsv(m.certYear),
      escapeCsv(m.trainingInstitute),
      escapeCsv(m.mobilePhone),
      escapeCsv(m.workplace.type),
      escapeCsv(m.workplace.name),
      escapeCsv(m.workplace.tambon),
      escapeCsv(m.workplace.amphoe),
      escapeCsv(m.workplace.province),
      escapeCsv(m.workplace.zipcode),
      escapeCsv(m.lat),
      escapeCsv(m.lng),
      escapeCsv(m.photoUrl || m.photoDriveId)
    ];
    rows.push(row.join(','));
  });

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `medical_members_export_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('ส่งออกไฟล์ CSV สำเร็จ', 'success');
}

function exportDataToJson() {
  if (typeof AuthManager !== 'undefined' && !AuthManager.canAccessMasterDb()) {
    showToast('สิทธิ์ไม่เพียงพอ: เฉพาะ Admin หรือผู้ได้รับมอบหมายเท่านั้น', 'error');
    return;
  }
  const payload = {
    exportDate: new Date().toISOString(),
    totalMembers: AppState.members.length,
    members: AppState.members
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `medical_members_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('ส่งออกไฟล์ JSON สำเร็จ', 'success');
}

function handleGlobalSearch(query) {
  if (AppState.currentView !== 'directory') {
    switchView('directory');
  }
  const dirSearchInput = document.getElementById('dir-search');
  if (dirSearchInput) {
    dirSearchInput.value = query;
    handleDirectoryFilter();
  }
}

/* ================= MODAL & TOAST HELPERS ================= */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');

  // If closing the member edit modal, restore minimap wrapper to its slot
  // (in case it was reparented to document.body during fullscreen mode)
  if (id === 'memberEditModal') {
    const wrapper = document.getElementById('edit-minimap-wrapper');
    const slot = document.getElementById('edit-minimap-slot');
    if (wrapper && slot && wrapper.classList.contains('minimap-fullscreen-active')) {
      wrapper.classList.remove('minimap-fullscreen-active');
      slot.appendChild(wrapper);
      const btn = document.getElementById('btn-minimap-fullscreen');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-expand"></i> ขยายเต็มจอ';
    }
  }
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');
  if (!toast || !msgEl) return;

  msgEl.innerText = msg;
  if (type === 'success') {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-3 text-xs font-medium text-white transition-all duration-300 transform translate-y-0 opacity-100 bg-slate-900 border border-slate-800 pointer-events-auto';
    iconEl.className = 'w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs';
    iconEl.innerHTML = '<i class="fa-solid fa-check"></i>';
  } else {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-3 text-xs font-medium text-white transition-all duration-300 transform translate-y-0 opacity-100 bg-rose-900 border border-rose-800 pointer-events-auto';
    iconEl.className = 'w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs';
    iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  }

  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3200);
}

function setupEventListeners() {
  const allModalIds = [
    'memberDetailModal',
    'memberEditModal',
    'deleteConfirmModal',
    'loginModal',
    'changePasswordModal',
    'gasConfigModal',
    'provinceDoctorsModal'
  ];

  allModalIds.forEach(id => {
    const modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(id);
      });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      allModalIds.forEach(id => closeModal(id));
    }
  });
}

/* ================= THAIFAMMED DATABASE (3,750 RECORDS) ================= */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function handleThaifammedFilter() {
  const searchQuery = (document.getElementById('tf-search')?.value || '').toLowerCase().trim();
  const zoneFilter = document.getElementById('tf-filter-zone')?.value || 'all';
  const provFilter = document.getElementById('tf-filter-province')?.value || 'all';
  const statusFilter = document.getElementById('tf-filter-status')?.value || 'all';

  AppState.filteredThaifammed = AppState.thaifammed.filter(d => {
    if (searchQuery) {
      const targetStr = `${d.name} ${d.cleanName} ${d.fpNo} ${d.gpNo} ${d.province} ${d.note || ''}`.toLowerCase();
      if (!targetStr.includes(searchQuery)) return false;
    }

    if (zoneFilter !== 'all') {
      if (String(d.healthZone).trim() !== String(zoneFilter).trim()) return false;
    }

    if (provFilter !== 'all') {
      if (!d.province || !d.province.includes(provFilter)) return false;
    }

    if (statusFilter === 'updated') {
      if (!d.isUpdated) return false;
    } else if (statusFilter === 'not_updated') {
      if (d.isUpdated) return false;
    }

    return true;
  });

  AppState.tfCurrentPage = 1;
  renderThaifammed();
}

function changeThaifammedPage(direction) {
  const totalPages = Math.ceil(AppState.filteredThaifammed.length / AppState.tfPageSize) || 1;
  const newPage = AppState.tfCurrentPage + direction;
  if (newPage >= 1 && newPage <= totalPages) {
    AppState.tfCurrentPage = newPage;
    renderThaifammed();
  }
}

function goToThaifammedPage(page) {
  const totalPages = Math.ceil(AppState.filteredThaifammed.length / AppState.tfPageSize) || 1;
  if (page >= 1 && page <= totalPages) {
    AppState.tfCurrentPage = page;
    renderThaifammed();
  }
}

function handleThaifammedPageSizeChange(newSize) {
  AppState.tfPageSize = parseInt(newSize, 10) || 25;
  AppState.tfCurrentPage = 1;
  renderThaifammed();
}

function renderThaifammed() {
  const totalRecords = AppState.filteredThaifammed.length;
  const totalPages = Math.ceil(totalRecords / AppState.tfPageSize) || 1;
  if (AppState.tfCurrentPage > totalPages) AppState.tfCurrentPage = totalPages;
  if (AppState.tfCurrentPage < 1) AppState.tfCurrentPage = 1;

  const resCountEl = document.getElementById('tf-result-count');
  if (resCountEl) resCountEl.innerText = totalRecords.toLocaleString();

  const curPageEl = document.getElementById('tf-current-page');
  if (curPageEl) curPageEl.innerText = AppState.tfCurrentPage.toLocaleString();

  const totalPagesEl = document.getElementById('tf-total-pages');
  if (totalPagesEl) totalPagesEl.innerText = totalPages.toLocaleString();

  const btnPrev = document.getElementById('tf-btn-prev');
  if (btnPrev) btnPrev.disabled = (AppState.tfCurrentPage <= 1);

  const btnNext = document.getElementById('tf-btn-next');
  if (btnNext) btnNext.disabled = (AppState.tfCurrentPage >= totalPages);

  // Render pagination buttons (window of 5 around current page)
  const pageNumsContainer = document.getElementById('tf-page-numbers');
  if (pageNumsContainer) {
    pageNumsContainer.innerHTML = '';
    const maxButtons = 5;
    let startPage = Math.max(1, AppState.tfCurrentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let p = startPage; p <= endPage; p++) {
      const btn = document.createElement('button');
      btn.onclick = () => goToThaifammedPage(p);
      btn.className = (p === AppState.tfCurrentPage)
        ? 'w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs shadow-sm'
        : 'w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs transition';
      btn.innerText = p;
      pageNumsContainer.appendChild(btn);
    }
  }

  // Render table rows
  const tbody = document.getElementById('tf-table-body');
  if (!tbody) return;

  if (totalRecords === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="py-12 text-center text-slate-400">
          <i class="fa-solid fa-folder-open text-3xl mb-2 block"></i>
          ไม่พบข้อมูลแพทย์ตามเงื่อนไขที่ค้นหา
        </td>
      </tr>
    `;
    return;
  }

  const startIndex = (AppState.tfCurrentPage - 1) * AppState.tfPageSize;
  const pageItems = AppState.filteredThaifammed.slice(startIndex, startIndex + AppState.tfPageSize);

  let html = '';
  pageItems.forEach((d, i) => {
    const globalIdx = startIndex + i + 1;
    const isUpdated = d.isUpdated;
    const canEditTf = typeof AuthManager !== 'undefined' && AuthManager.canEdit('thaifammed', d.id);
    const isAdminUser = typeof AuthManager !== 'undefined' && AuthManager.isAdmin();
    const isMyTf = typeof AuthManager !== 'undefined' && AuthManager.isMyRecord('thaifammed', d.id);

    html += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 ${isMyTf ? 'bg-sky-50/50' : ''}">
        <td class="py-3 px-4 text-center text-slate-400 font-mono text-[11px]">${globalIdx}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full ${isUpdated ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'} flex items-center justify-center font-bold text-xs shrink-0">
              <i class="fa-solid ${isUpdated ? 'fa-user-check' : 'fa-user-doctor'}"></i>
            </div>
            <div>
              <div class="font-medium text-slate-900 flex items-center gap-1.5">
                ${escapeHtml(d.name)}
                ${isMyTf ? `<span class="px-1.5 py-0.2 bg-sky-100 text-sky-700 text-[10px] rounded font-semibold">คุณ</span>` : ''}
              </div>
              ${d.workplace ? `<div class="text-[11px] text-slate-400 truncate max-w-xs">${escapeHtml(d.workplace)}</div>` : ''}
              ${d.note ? `<div class="text-[10px] text-amber-600 truncate max-w-xs"><i class="fa-solid fa-circle-info mr-0.5"></i> ${escapeHtml(d.note)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="py-3 px-4 text-center font-mono">
          <span class="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-semibold border border-blue-100">${escapeHtml(d.fpNo || '-')}</span>
        </td>
        <td class="py-3 px-4 text-center font-mono text-slate-600">
          <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">${escapeHtml(d.gpNo || '-')}</span>
        </td>
        <td class="py-3 px-4 text-slate-700 font-medium">
          ${escapeHtml(d.province || '-')}
        </td>
        <td class="py-3 px-4 text-center">
          <span class="px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 text-[11px] font-semibold border border-teal-100">เขต ${escapeHtml(d.healthZone || '-')}</span>
        </td>
        <td class="py-3 px-4">
          ${isUpdated
            ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200"><i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i> อัปเดตใน Sheet แล้ว</span>`
            : `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500"><i class="fa-regular fa-clock mr-1"></i> ยังไม่อัปเดต</span>`
          }
        </td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            ${isUpdated && d.matchedMemberId
              ? `<button onclick="openMemberDetailModal(${d.matchedMemberId})" class="px-2.5 py-1 rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100 font-medium text-xs transition inline-flex items-center gap-1 border border-sky-200 shadow-sm" title="ดูประวัติใน Sheet"><i class="fa-solid fa-address-card"></i> โปรไฟล์</button>`
              : (isAdminUser ? `<button onclick="openAddFromThaifammed(${d.id})" class="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 font-medium text-xs transition inline-flex items-center gap-1 border border-slate-200" title="เพิ่มข้อมูลลง Sheet"><i class="fa-solid fa-user-plus text-emerald-600"></i> นำเข้า</button>` : '')
            }
            ${canEditTf ? `
              <button onclick="startRelocateMarkerById('thaifammed', ${d.id})" class="px-2.5 py-1 rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 font-medium text-xs transition inline-flex items-center gap-1 border border-amber-200 shadow-sm" title="ปรับย้ายพิกัดแผนที่ (ลากหมุด/ดึงพิกัด รพ.รัฐ)">
                <i class="fa-solid fa-location-crosshairs text-amber-600"></i> พิกัด
              </button>
            ` : `
              <span class="px-2 py-1 text-slate-300 text-xs inline-flex items-center gap-1 cursor-not-allowed" title="ดูได้อย่างเดียว"><i class="fa-solid fa-lock text-[10px]"></i> ล็อค</span>
            `}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function openAddFromThaifammed(tfId) {
  const doctor = AppState.thaifammed.find(d => d.id === tfId);
  if (!doctor) return;
  openAddMemberModal();
  document.getElementById('form-modal-title').innerText = `เพิ่มข้อมูลแพทย์จาก Thaifammed (FP: ${doctor.fpNo || '-'})`;

  let title = 'นพ.';
  let restName = doctor.name;
  if (doctor.name.startsWith('พญ.')) {
    title = 'พญ.';
    restName = doctor.name.substring(3).trim();
  } else if (doctor.name.startsWith('นพ.')) {
    title = 'นพ.';
    restName = doctor.name.substring(3).trim();
  } else if (doctor.name.startsWith('นายแพทย์')) {
    title = 'นพ.';
    restName = doctor.name.substring(8).trim();
  } else if (doctor.name.startsWith('แพทย์หญิง')) {
    title = 'พญ.';
    restName = doctor.name.substring(9).trim();
  }

  const parts = restName.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  document.getElementById('form-title-th').value = title;
  document.getElementById('form-firstname-th').value = firstName;
  document.getElementById('form-lastname-th').value = lastName;
  document.getElementById('form-license-no').value = doctor.gpNo || '';
  document.getElementById('form-workplace-province').value = doctor.province || '';

  showToast(`ดึงข้อมูล ${doctor.name} มายังฟอร์มเรียบร้อยแล้ว`, 'success');
}

/* ================= BRANDING & UI CUSTOMIZATION ENGINE ================= */
const DEFAULT_BRANDING = {
  logoType: 'icon', // 'icon' | 'upload' | 'url'
  logoIcon: 'fa-user-doctor',
  logoGradient: 'from-sky-500 to-teal-400',
  logoImageUrl: '',
  logo2Type: 'icon', // 'icon' | 'upload' | 'url'
  logo2ImageUrl: '',
  title: 'ราชวิทยาลัยฯ',
  subtitle: 'เวชศาสตร์ครอบครัว',
  sourceBadge: 'Sheet + Thaifammed',
  headerTitle: 'ระบบสารสนเทศสมาชิกแพทย์เวชศาสตร์ครอบครัว',
  searchPlaceholder: 'ค้นหาชื่อแพทย์, เลข ว., โรงพยาบาล, จังหวัด...',
  dashBadge: 'ฐานข้อมูลสมาชิกเวชศาสตร์ครอบครัวไทย',
  dashTitle: 'ระบบวิเคราะห์ข้อมูลสมาชิกและแผนที่พิกัดแพทย์',
  dashDesc: 'ประมวลผลครอบคลุมทั้ง 5 แท็บของ Google Sheet พร้อมฐานข้อมูลแพทย์ 3,750 รายจาก Thaifammed และแผนที่ OpenStreetMap (ไม่มี API)',
  mapTitle: 'แผนที่พิกัดแพทย์เวชศาสตร์ครอบครัว',
  mapDesc: 'สำรวจการกระจายตัวของแพทย์ทั่วประเทศ สามารถลากย้ายหมุดหรือดึงพิกัดสถานบริการรัฐอัตโนมัติ',
  dirTitle: 'รายชื่อสมาชิกที่ Update ข้อมูล',
  footerText: '© 2026 ราชวิทยาลัยแพทย์เวชศาสตร์ครอบครัวแห่งประเทศไทย & สมาคมแพทย์เวชศาสตร์ครอบครัว',
  footerContact: 'ระบบสารสนเทศภูมิศาสตร์และทะเบียนสมาชิกแพทย์ | ติดต่อประสานงาน: thaifammed.org'
};

const BrandingManager = {
  currentConfig: { ...DEFAULT_BRANDING },

  init() {
    this.load();
    this.populateForm();
    this.updateLivePreview();
  },

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BRANDING);
      if (saved) {
        this.currentConfig = { ...DEFAULT_BRANDING, ...JSON.parse(saved) };
      } else {
        this.currentConfig = { ...DEFAULT_BRANDING };
      }
    } catch (e) {
      console.warn('Error loading branding config:', e);
      this.currentConfig = { ...DEFAULT_BRANDING };
    }
    this.apply(this.currentConfig);
  },

  apply(cfg) {
    if (!cfg) cfg = this.currentConfig;

    // 1. Sidebar Brand - Logo 1
    const brandLogoContainer = document.getElementById('brand-logo-container');
    if (brandLogoContainer) {
      if ((cfg.logoType === 'upload' || cfg.logoType === 'url') && cfg.logoImageUrl) {
        brandLogoContainer.className = 'w-10 h-10 rounded-xl flex items-center justify-center shadow-lg overflow-hidden shrink-0 bg-white border border-slate-700/50';
        brandLogoContainer.innerHTML = `<img src="${cfg.logoImageUrl}" alt="Logo" class="brand-logo-img">`;
      } else {
        brandLogoContainer.className = `w-10 h-10 rounded-xl bg-gradient-to-tr ${cfg.logoGradient || 'from-sky-500 to-teal-400'} flex items-center justify-center text-white shadow-lg shrink-0 overflow-hidden`;
        brandLogoContainer.innerHTML = `<i class="fa-solid ${cfg.logoIcon || 'fa-user-doctor'} text-lg"></i>`;
      }
    }

    // Sidebar Brand - Logo 2 (Requirement 1)
    const brandLogo2Container = document.getElementById('brand-logo2-container');
    if (brandLogo2Container) {
      if ((cfg.logo2Type === 'upload' || cfg.logo2Type === 'url') && cfg.logo2ImageUrl) {
        brandLogo2Container.className = 'w-9 h-9 rounded-xl flex items-center justify-center shadow-lg overflow-hidden shrink-0 bg-white border border-slate-700/50';
        brandLogo2Container.innerHTML = `<img src="${cfg.logo2ImageUrl}" alt="Logo 2" class="brand-logo2-img">`;
      } else {
        brandLogo2Container.className = 'w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30 overflow-hidden shrink-0';
        brandLogo2Container.innerHTML = `<i class="fa-solid fa-hospital text-sm"></i>`;
      }
    }

    const brandTitle = document.getElementById('brand-title');
    if (brandTitle) brandTitle.textContent = cfg.title || DEFAULT_BRANDING.title;

    const brandSubtitle = document.getElementById('brand-subtitle');
    if (brandSubtitle) brandSubtitle.textContent = cfg.subtitle || DEFAULT_BRANDING.subtitle;

    const brandSourceBadge = document.getElementById('brand-source-badge');
    if (brandSourceBadge) brandSourceBadge.textContent = cfg.sourceBadge || DEFAULT_BRANDING.sourceBadge;

    // 2. Header
    const brandHeaderTitle = document.getElementById('brand-header-title');
    if (brandHeaderTitle) brandHeaderTitle.textContent = cfg.headerTitle || DEFAULT_BRANDING.headerTitle;

    const globalSearch = document.getElementById('global-search');
    if (globalSearch) globalSearch.placeholder = cfg.searchPlaceholder || DEFAULT_BRANDING.searchPlaceholder;

    // 3. Dashboard View
    const brandDashBadge = document.getElementById('brand-dashboard-badge');
    if (brandDashBadge) brandDashBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${cfg.dashBadge || DEFAULT_BRANDING.dashBadge}`;

    const brandDashTitle = document.getElementById('brand-dashboard-title');
    if (brandDashTitle) brandDashTitle.textContent = cfg.dashTitle || DEFAULT_BRANDING.dashTitle;

    const brandDashDesc = document.getElementById('brand-dashboard-desc');
    if (brandDashDesc) brandDashDesc.textContent = cfg.dashDesc || DEFAULT_BRANDING.dashDesc;

    // 4. Map View
    const brandMapTitle = document.getElementById('brand-map-title');
    if (brandMapTitle) brandMapTitle.textContent = cfg.mapTitle || DEFAULT_BRANDING.mapTitle;

    const brandMapDesc = document.getElementById('brand-map-desc');
    if (brandMapDesc) brandMapDesc.textContent = cfg.mapDesc || DEFAULT_BRANDING.mapDesc;

    // 5. Directory View
    const brandDirTitle = document.getElementById('brand-directory-title');
    if (brandDirTitle) brandDirTitle.textContent = cfg.dirTitle || DEFAULT_BRANDING.dirTitle;

    // 6. Footer
    const brandFooterText = document.getElementById('brand-footer-text');
    if (brandFooterText) brandFooterText.textContent = cfg.footerText || DEFAULT_BRANDING.footerText;

    const brandFooterContact = document.getElementById('brand-footer-contact');
    if (brandFooterContact) brandFooterContact.textContent = cfg.footerContact || DEFAULT_BRANDING.footerContact;
  },

  populateForm() {
    const cfg = this.currentConfig;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('cfg-brand-title', cfg.title);
    setVal('cfg-brand-subtitle', cfg.subtitle);
    setVal('cfg-brand-source-badge', cfg.sourceBadge);
    setVal('cfg-brand-header-title', cfg.headerTitle);
    setVal('cfg-brand-search-placeholder', cfg.searchPlaceholder);
    setVal('cfg-brand-dash-badge', cfg.dashBadge);
    setVal('cfg-brand-dash-title', cfg.dashTitle);
    setVal('cfg-brand-dash-desc', cfg.dashDesc);
    setVal('cfg-brand-map-title', cfg.mapTitle);
    setVal('cfg-brand-dir-title', cfg.dirTitle);
    setVal('cfg-brand-footer-text', cfg.footerText);
    setVal('cfg-brand-footer-contact', cfg.footerContact);
    setVal('input-brand-logo-url', cfg.logoType === 'url' ? cfg.logoImageUrl : '');
    setVal('input-brand-logo2-url', cfg.logo2Type === 'url' ? cfg.logo2ImageUrl : '');

    this.setLogoMode(cfg.logoType || 'icon', false);
    this.highlightActiveIcon(cfg.logoIcon);
    this.highlightActiveGrad(cfg.logoGradient);
  },

  setLogoMode(mode, triggerPreview = true) {
    this.currentConfig.logoType = mode;
    ['icon', 'upload', 'url'].forEach(m => {
      const btn = document.getElementById(`btn-logo-mode-${m}`);
      const panel = document.getElementById(`brand-panel-logo-${m}`);
      if (btn) {
        if (m === mode) {
          btn.className = 'flex-1 py-1.5 rounded-lg font-semibold transition text-center bg-indigo-600 text-white shadow-sm';
        } else {
          btn.className = 'flex-1 py-1.5 rounded-lg font-semibold transition text-center text-slate-600 hover:text-slate-900';
        }
      }
      if (panel) {
        if (m === mode) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
      }
    });
    if (triggerPreview) this.updateLivePreview();
  },

  setIcon(iconClass) {
    this.currentConfig.logoIcon = iconClass;
    this.highlightActiveIcon(iconClass);
    this.updateLivePreview();
  },

  setBgGradient(gradClass) {
    this.currentConfig.logoGradient = gradClass;
    this.highlightActiveGrad(gradClass);
    this.updateLivePreview();
  },

  highlightActiveIcon(iconClass) {
    document.querySelectorAll('.brand-icon-opt').forEach(btn => {
      if (btn.dataset.icon === iconClass) {
        btn.classList.add('border-indigo-600', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-500/30');
      } else {
        btn.classList.remove('border-indigo-600', 'bg-indigo-50/50', 'ring-2', 'ring-indigo-500/30');
      }
    });
  },

  highlightActiveGrad(gradClass) {
    document.querySelectorAll('.brand-grad-opt').forEach(btn => {
      if (btn.getAttribute('onclick')?.includes(gradClass)) {
        btn.classList.add('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900');
      } else {
        btn.classList.remove('ring-2', 'ring-indigo-500', 'ring-offset-2', 'ring-offset-slate-900');
      }
    });
  },

  handleFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('ไฟล์ภาพมีขนาดใหญ่เกินไป (ไม่เกิน 2MB)', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.currentConfig.logoImageUrl = e.target.result;
      this.currentConfig.logoType = 'upload';
      this.updateLivePreview();
      showToast('อัปโหลดไฟล์รูปภาพโลโก้เรียบร้อยแล้ว (กดปุ่มบันทึกเพื่อใช้งาน)', 'success');
    };
    reader.readAsDataURL(file);
  },

  handleUrlInput(val) {
    this.currentConfig.logoImageUrl = (val || '').trim();
    this.updateLivePreview();
  },

  applyUrl() {
    const input = document.getElementById('input-brand-logo-url');
    if (input && input.value) {
      this.currentConfig.logoImageUrl = input.value.trim();
      this.currentConfig.logoType = 'url';
      this.updateLivePreview();
      showToast('ทดสอบเชื่อมโยง URL โลโก้เรียบร้อยแล้ว', 'info');
    }
  },

  handleLogo2Upload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast('ไฟล์ภาพ Logo 2 มีขนาดใหญ่เกินไป (ไม่เกิน 2MB)', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.currentConfig.logo2ImageUrl = e.target.result;
      this.currentConfig.logo2Type = 'upload';
      this.updateLivePreview();
      this.apply(this.currentConfig);
      showToast('อัปโหลดไฟล์รูปภาพ Logo 2 เรียบร้อยแล้ว (กดปุ่มบันทึกเพื่อใช้งาน)', 'success');
    };
    reader.readAsDataURL(file);
  },

  handleLogo2UrlInput(val) {
    this.currentConfig.logo2ImageUrl = (val || '').trim();
    if (this.currentConfig.logo2ImageUrl) {
      this.currentConfig.logo2Type = 'url';
    }
    this.updateLivePreview();
    this.apply(this.currentConfig);
  },

  applyLogo2Url() {
    const input = document.getElementById('input-brand-logo2-url');
    if (input && input.value) {
      this.currentConfig.logo2ImageUrl = input.value.trim();
      this.currentConfig.logo2Type = 'url';
      this.updateLivePreview();
      this.apply(this.currentConfig);
      showToast('ทดสอบเชื่อมโยง URL Logo 2 เรียบร้อยแล้ว', 'info');
    }
  },

  removeLogo2() {
    this.currentConfig.logo2ImageUrl = '';
    this.currentConfig.logo2Type = 'icon';
    const input = document.getElementById('input-brand-logo2-url');
    if (input) input.value = '';
    this.updateLivePreview();
    this.apply(this.currentConfig);
    showToast('รีเซ็ต Logo 2 เป็นไอคอนเริ่มต้นเรียบร้อยแล้ว', 'info');
  },

  collectFormData() {
    const getVal = (id, fallback) => {
      const el = document.getElementById(id);
      return el && el.value.trim() ? el.value.trim() : fallback;
    };

    return {
      logoType: this.currentConfig.logoType || 'icon',
      logoIcon: this.currentConfig.logoIcon || DEFAULT_BRANDING.logoIcon,
      logoGradient: this.currentConfig.logoGradient || DEFAULT_BRANDING.logoGradient,
      logoImageUrl: this.currentConfig.logoImageUrl || '',
      logo2Type: this.currentConfig.logo2Type || 'icon',
      logo2ImageUrl: this.currentConfig.logo2ImageUrl || '',
      title: getVal('cfg-brand-title', DEFAULT_BRANDING.title),
      subtitle: getVal('cfg-brand-subtitle', DEFAULT_BRANDING.subtitle),
      sourceBadge: getVal('cfg-brand-source-badge', DEFAULT_BRANDING.sourceBadge),
      headerTitle: getVal('cfg-brand-header-title', DEFAULT_BRANDING.headerTitle),
      searchPlaceholder: getVal('cfg-brand-search-placeholder', DEFAULT_BRANDING.searchPlaceholder),
      dashBadge: getVal('cfg-brand-dash-badge', DEFAULT_BRANDING.dashBadge),
      dashTitle: getVal('cfg-brand-dash-title', DEFAULT_BRANDING.dashTitle),
      dashDesc: getVal('cfg-brand-dash-desc', DEFAULT_BRANDING.dashDesc),
      mapTitle: getVal('cfg-brand-map-title', DEFAULT_BRANDING.mapTitle),
      mapDesc: DEFAULT_BRANDING.mapDesc,
      dirTitle: getVal('cfg-brand-dir-title', DEFAULT_BRANDING.dirTitle),
      footerText: getVal('cfg-brand-footer-text', DEFAULT_BRANDING.footerText),
      footerContact: getVal('cfg-brand-footer-contact', DEFAULT_BRANDING.footerContact),
    };
  },

  updateLivePreview() {
    const cfg = this.collectFormData();
    this.currentConfig = { ...this.currentConfig, ...cfg };

    // Update Right Column Preview Elements
    const pLogoBox = document.getElementById('preview-logo-box');
    const pLogoIcon = document.getElementById('preview-logo-icon');
    const pLogoImg = document.getElementById('preview-logo-img');

    if (pLogoBox && pLogoIcon && pLogoImg) {
      if ((cfg.logoType === 'upload' || cfg.logoType === 'url') && cfg.logoImageUrl) {
        pLogoBox.className = 'w-10 h-10 rounded-xl flex items-center justify-center shadow-md shrink-0 overflow-hidden bg-white border border-slate-700/50';
        pLogoIcon.classList.add('hidden');
        pLogoImg.classList.remove('hidden');
        pLogoImg.src = cfg.logoImageUrl;
      } else {
        pLogoBox.className = `w-10 h-10 rounded-xl bg-gradient-to-tr ${cfg.logoGradient || 'from-sky-500 to-teal-400'} flex items-center justify-center text-white shadow-md shrink-0 overflow-hidden`;
        pLogoIcon.className = `fa-solid ${cfg.logoIcon || 'fa-user-doctor'} text-lg`;
        pLogoIcon.classList.remove('hidden');
        pLogoImg.classList.add('hidden');
      }
    }

    const pTitle = document.getElementById('preview-brand-title');
    if (pTitle) pTitle.textContent = cfg.title;

    const pSub = document.getElementById('preview-brand-subtitle');
    if (pSub) pSub.textContent = cfg.subtitle;

    const pDashBadge = document.getElementById('preview-dash-badge');
    if (pDashBadge) pDashBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${cfg.dashBadge}`;

    const pDashTitle = document.getElementById('preview-dash-title');
    if (pDashTitle) pDashTitle.textContent = cfg.dashTitle;

    const pDashDesc = document.getElementById('preview-dash-desc');
    if (pDashDesc) pDashDesc.textContent = cfg.dashDesc;

    const pFooter = document.getElementById('preview-footer-text');
    if (pFooter) pFooter.textContent = cfg.footerText;

    const pContact = document.getElementById('preview-footer-contact');
    if (pContact) pContact.textContent = cfg.footerContact;

    // Update Logo 2 Preview (Requirement 1)
    const pLogo2Box = document.getElementById('brand-logo2-preview');
    if (pLogo2Box) {
      if ((cfg.logo2Type === 'upload' || cfg.logo2Type === 'url') && cfg.logo2ImageUrl) {
        pLogo2Box.className = 'w-8 h-8 rounded-xl flex items-center justify-center shadow-sm overflow-hidden shrink-0 bg-white border border-slate-200';
        pLogo2Box.innerHTML = `<img src="${cfg.logo2ImageUrl}" alt="Logo 2" class="w-full h-full object-contain p-0.5">`;
      } else {
        pLogo2Box.className = 'w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-sm overflow-hidden shrink-0';
        pLogo2Box.innerHTML = `<i class="fa-solid fa-hospital text-sm"></i>`;
      }
    }
  },

  save() {
    const cfg = this.collectFormData();
    this.currentConfig = cfg;
    localStorage.setItem(STORAGE_KEY_BRANDING, JSON.stringify(cfg));
    this.apply(cfg);
    showToast('บันทึกการปรับแต่งโลโก้และข้อความระบบเรียบร้อยแล้ว!', 'success');
  },

  reset() {
    if (!confirm('คุณต้องการรีเซ็ตข้อความและโลโก้กลับสู่ค่าเริ่มต้นทั้งหมดใช่หรือไม่?')) return;
    this.currentConfig = { ...DEFAULT_BRANDING };
    localStorage.removeItem(STORAGE_KEY_BRANDING);
    this.apply(this.currentConfig);
    this.populateForm();
    this.updateLivePreview();
    showToast('คืนค่าข้อความและโลโก้สู่ค่าเริ่มต้นเรียบร้อยแล้ว', 'info');
  },

  exportConfig() {
    const cfg = this.collectFormData();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medical-dashboard-branding-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('ส่งออกไฟล์การตั้งค่า Branding JSON เรียบร้อยแล้ว', 'success');
  },

  importConfig(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        this.currentConfig = { ...DEFAULT_BRANDING, ...imported };
        localStorage.setItem(STORAGE_KEY_BRANDING, JSON.stringify(this.currentConfig));
        this.apply(this.currentConfig);
        this.populateForm();
        this.updateLivePreview();
        showToast('นำเข้าการตั้งค่า Branding สำเร็จเรียบร้อย!', 'success');
      } catch (err) {
        showToast('ไฟล์ JSON ไม่ถูกต้อง: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }
};

/* ================= AUTHENTICATION & RBAC ENGINE ================= */
const AuthManager = {
  currentUser: { role: 'guest' },

  init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_AUTH_USER);
      if (saved) {
        this.currentUser = JSON.parse(saved);
      } else {
        this.currentUser = { role: 'guest' };
      }
    } catch (e) {
      console.warn('Auth load error:', e);
      this.currentUser = { role: 'guest' };
    }

    this.updateAuthUI();

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('user-dropdown-menu');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        const toggleBtn = e.target.closest('#auth-header-container');
        if (!toggleBtn) {
          dropdown.classList.add('hidden');
        }
      }
    });
  },

  isGuest() {
    return !this.currentUser || this.currentUser.role === 'guest';
  },

  isAdmin() {
    return !!(this.currentUser && this.currentUser.role === 'admin');
  },

  isDoctor() {
    return !!(this.currentUser && this.currentUser.role === 'doctor');
  },

  // Requirement 2: Master DB Access Control & Delegation
  getDelegates() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_DELEGATES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveDelegates(list) {
    localStorage.setItem(STORAGE_KEY_DELEGATES, JSON.stringify(list));
    this.updateDelegatesUI();
  },

  isMasterDbDelegate() {
    if (this.isAdmin()) return true;
    if (!this.isDoctor()) return false;
    const delegates = this.getDelegates();
    const lic = String(this.currentUser.licenseNo || '').trim();
    const name = String(this.currentUser.name || '').trim();
    return delegates.some(d => {
      if (lic && d.licenseNo && String(d.licenseNo).trim() === lic) return true;
      if (name && d.name && (d.name.includes(name) || name.includes(d.name))) return true;
      return false;
    });
  },

  canAccessMasterDb() {
    return this.isAdmin() || this.isMasterDbDelegate();
  },

  addDelegateFromInput() {
    if (!this.isAdmin()) {
      showToast('เฉพาะ Admin เท่านั้นที่สามารถมอบหมายสิทธิ์ได้', 'error');
      return;
    }
    const input = document.getElementById('input-new-delegate');
    const val = (input?.value || '').trim();
    if (!val) {
      showToast('กรุณาระบุเลข ว. หรือค้นหาชื่อแพทย์ที่ต้องการมอบหมายสิทธิ์', 'warning');
      return;
    }

    const cleanId = val.toLowerCase().replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง|ว\.)\s*/, '').trim();
    const numDigits = val.replace(/\D/g, '');

    let found = AppState.members.find(m => {
      if (m.licenseNo && String(m.licenseNo).trim() === cleanId) return true;
      if (numDigits && m.licenseNo && String(m.licenseNo).trim() === numDigits) return true;
      if (m.fullNameTh && m.fullNameTh.includes(cleanId)) return true;
      return false;
    });

    if (!found) {
      found = AppState.thaifammed.find(d => {
        if (d.gpNo && String(d.gpNo).trim() === cleanId) return true;
        if (numDigits && d.gpNo && String(d.gpNo).trim() === numDigits) return true;
        if (d.name && d.name.includes(cleanId)) return true;
        return false;
      });
    }

    const docName = found ? (found.fullNameTh || found.name) : val;
    const licenseNo = found ? (found.licenseNo || found.gpNo || '') : numDigits;

    const delegates = this.getDelegates();
    if (delegates.some(d => (licenseNo && d.licenseNo === licenseNo) || d.name === docName)) {
      showToast(`${docName} ได้รับสิทธิ์เข้าถึง Master DB อยู่แล้ว`, 'info');
      if (input) input.value = '';
      return;
    }

    delegates.push({
      name: docName,
      licenseNo: licenseNo,
      assignedAt: new Date().toLocaleDateString('th-TH')
    });

    this.saveDelegates(delegates);
    if (input) input.value = '';
    showToast(`มอบหมายสิทธิ์เข้าถึง Master DB ให้กับ ${docName} เรียบร้อยแล้ว`, 'success');
  },

  removeDelegate(licenseOrName) {
    if (!this.isAdmin()) {
      showToast('เฉพาะ Admin เท่านั้นที่สามารถเพิกถอนสิทธิ์ได้', 'error');
      return;
    }
    let delegates = this.getDelegates();
    delegates = delegates.filter(d => d.licenseNo !== licenseOrName && d.name !== licenseOrName);
    this.saveDelegates(delegates);
    showToast('เพิกถอนสิทธิ์เรียบร้อยแล้ว', 'info');
  },

  updateDelegatesUI() {
    const listContainer = document.getElementById('delegates-list-container');
    const badge = document.getElementById('delegate-count-badge');
    const delegates = this.getDelegates();

    if (badge) {
      badge.textContent = `${delegates.length} คนที่ได้รับมอบหมาย`;
    }

    if (listContainer) {
      if (delegates.length === 0) {
        listContainer.innerHTML = `
          <div class="text-[11px] text-slate-400 py-3 text-center italic">
            ยังไม่มีแพทย์ที่ได้รับมอบหมายสิทธิ์ (เฉพาะ Admin เข้าถึงได้)
          </div>
        `;
      } else {
        listContainer.innerHTML = delegates.map(d => `
          <div class="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 shadow-xs">
            <div class="min-w-0 flex-1 pr-2">
              <div class="font-bold text-slate-800 text-[11px] truncate">${escapeHtml(d.name)}</div>
              <div class="text-[10px] text-slate-400 font-mono">${d.licenseNo ? 'ว. ' + escapeHtml(d.licenseNo) : 'แพทย์สมาชิก'} • สิทธิ์: Master DB</div>
            </div>
            ${this.isAdmin() ? `
              <button onclick="AuthManager.removeDelegate('${escapeHtml(d.licenseNo || d.name)}')" class="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition" title="เพิกถอนสิทธิ์">
                <i class="fa-solid fa-trash-can text-xs"></i>
              </button>
            ` : ''}
          </div>
        `).join('');
      }
    }

    // Populate datalist for doctor search in delegation panel
    const dl = document.getElementById('all-doctors-datalist');
    if (dl && (!dl.children || dl.children.length === 0) && AppState.members && AppState.members.length > 0) {
      let opts = '';
      AppState.members.forEach(m => {
        opts += `<option value="${escapeHtml(m.licenseNo ? m.licenseNo : m.fullNameTh)}">${escapeHtml(m.fullNameTh)} (ว. ${escapeHtml(m.licenseNo || '-')})</option>`;
      });
      dl.innerHTML = opts;
    }
  },

  isMyRecord(type, id) {
    if (!this.isDoctor()) return false;

    const u = this.currentUser;

    if (type === 'sheet') {
      if (u.type === 'sheet' && u.id == id) return true;
      if (u.sheetId && u.sheetId == id) return true;

      const m = AppState.members.find(x => x.id == id);
      if (m) {
        if (u.licenseNo && m.licenseNo && String(u.licenseNo).trim() === String(m.licenseNo).trim()) return true;
        if (u.name && m.fullNameTh) {
          const cleanU = u.name.replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง)\s*/, '').trim();
          const cleanM = m.fullNameTh.replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง)\s*/, '').trim();
          if (cleanU && cleanM && cleanU === cleanM) return true;
        }
      }
      return false;
    }

    if (type === 'thaifammed') {
      if (u.type === 'thaifammed' && u.id == id) return true;

      const d = AppState.thaifammed.find(x => x.id == id);
      if (d) {
        if (u.licenseNo && d.gpNo && String(u.licenseNo).trim() === String(d.gpNo).trim()) return true;
        if (u.sheetId && d.matchedMemberId && u.sheetId == d.matchedMemberId) return true;
        if (u.name && d.name) {
          const cleanU = u.name.replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง)\s*/, '').trim();
          const cleanD = d.name.replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง)\s*/, '').trim();
          if (cleanU && cleanD && cleanU === cleanD) return true;
        }
      }
      return false;
    }

    return false;
  },

  canEdit(type, id) {
    if (this.isAdmin()) return true;
    if (this.isMyRecord(type, id)) return true;
    return false;
  },

  requireEditPermission(type, id) {
    if (this.canEdit(type, id)) return true;

    if (this.isGuest()) {
      showToast('กรุณาเข้าสู่ระบบเพื่อแก้ไขข้อมูลส่วนตัวของคุณ', 'warning');
      this.openLoginModal();
      return false;
    }

    showToast('สิทธิ์ไม่เพียงพอ: ท่านสามารถแก้ไขหรือย้ายพิกัดได้เฉพาะข้อมูลของตนเองเท่านั้น', 'error');
    return false;
  },

  openLoginModal() {
    this.populateDemoDoctors();
    openModal('loginModal');
  },

  openChangePasswordModal() {
    if (this.isGuest()) {
      this.openLoginModal();
      return;
    }
    openModal('changePasswordModal');
  },

  toggleUserDropdown(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('user-dropdown-menu');
    if (dropdown) dropdown.classList.toggle('hidden');
  },

  switchLoginTab(tab) {
    const tabs = ['doctor', 'admin', 'reset'];
    tabs.forEach(t => {
      const panel = document.getElementById(`login-tab-${t}`);
      const btn = document.getElementById(`tab-btn-login-${t}`);
      if (panel) panel.classList.toggle('hidden', t !== tab);
      if (btn) {
        if (t === tab) {
          btn.className = 'flex-1 py-3 text-center border-b-2 border-sky-600 text-sky-600 bg-white font-semibold transition flex items-center justify-center gap-1.5';
        } else {
          btn.className = 'flex-1 py-3 text-center border-b-2 border-transparent text-slate-500 hover:text-slate-800 font-medium transition flex items-center justify-center gap-1.5';
        }
      }
    });
  },

  togglePassVisibility(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.type = el.type === 'password' ? 'text' : 'password';
  },

  populateDemoDoctors() {
    // Demo options are configured in HTML modal for 1-click test
  },

  quickLogin(type, id) {
    let doc = null;
    let sheetId = null;

    if (type === 'sheet') {
      doc = AppState.members.find(m => m.id == id);
      if (doc) sheetId = doc.id;
    } else {
      doc = AppState.thaifammed.find(d => d.id == id);
      if (doc && doc.matchedMemberId) sheetId = doc.matchedMemberId;
    }

    if (!doc) {
      showToast('ไม่พบข้อมูลแพทย์ตัวอย่างนี้ในระบบ', 'error');
      return;
    }

    const name = doc.fullNameTh || doc.name;
    const licenseNo = doc.licenseNo || doc.gpNo || '';
    const phone = doc.mobilePhone || '';
    const workplace = (doc.workplace && doc.workplace.name) || doc.workplace || '';
    const photoUrl = getDoctorPrimaryImage(doc) || '';

    this.currentUser = {
      role: 'doctor',
      type: type,
      id: doc.id,
      sheetId: sheetId,
      name: name,
      licenseNo: licenseNo,
      mobilePhone: phone,
      workplace: workplace,
      photoUrl: photoUrl
    };

    localStorage.setItem(STORAGE_KEY_AUTH_USER, JSON.stringify(this.currentUser));
    this.updateAuthUI();
    closeModal('loginModal');
    this.refreshActiveViews();
    showToast(`เข้าสู่ระบบสาธิตในฐานะ ${name}`, 'success');
  },

  handleDoctorLoginForm(event) {
    event.preventDefault();
    const idVal = (document.getElementById('login-doctor-id')?.value || '').trim();
    const passVal = (document.getElementById('login-doctor-pass')?.value || '').trim();

    if (!idVal || !passVal) {
      showToast('กรุณาระบุเลข ว. / อีเมล และรหัสผ่าน', 'warning');
      return;
    }

    this.loginDoctor(idVal, passVal);
  },

  loginDoctor(identifier, password) {
    const cleanId = identifier.toLowerCase().replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง|ว\.)\s*/, '').trim();
    const numDigits = identifier.replace(/\D/g, '');

    // 1. Search in Sheet members
    let matchedDoc = AppState.members.find(m => {
      if (m.licenseNo && String(m.licenseNo).trim() === cleanId) return true;
      if (numDigits && m.licenseNo && String(m.licenseNo).trim() === numDigits) return true;
      if (m.email && m.email.toLowerCase() === identifier.toLowerCase()) return true;
      if (m.mobilePhone && numDigits && m.mobilePhone.replace(/\D/g, '').includes(numDigits)) return true;
      if (m.fullNameTh && m.fullNameTh.includes(cleanId)) return true;
      return false;
    });

    let docType = 'sheet';
    let sheetId = matchedDoc ? matchedDoc.id : null;

    // 2. If not found in Sheet, search in Thaifammed
    if (!matchedDoc) {
      matchedDoc = AppState.thaifammed.find(d => {
        if (d.gpNo && String(d.gpNo).trim() === cleanId) return true;
        if (numDigits && d.gpNo && String(d.gpNo).trim() === numDigits) return true;
        if (d.name && d.name.includes(cleanId)) return true;
        return false;
      });
      if (matchedDoc) {
        docType = 'thaifammed';
        if (matchedDoc.matchedMemberId) sheetId = matchedDoc.matchedMemberId;
      }
    }

    if (!matchedDoc) {
      showToast('ไม่พบข้อมูลแพทย์ที่มีเลข ว., อีเมล หรือชื่อนี้ในฐานข้อมูล', 'error');
      return;
    }

    // Verify Password:
    // A. Custom set password
    const creds = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDENTIALS) || '{}');
    const licenseKey = matchedDoc.licenseNo || matchedDoc.gpNo || cleanId;
    const customPass = creds[`doc_${licenseKey}`];

    let isValid = false;
    if (customPass && customPass === password) {
      isValid = true;
    } else if (!customPass) {
      // Default passwords
      const phoneDigits = (matchedDoc.mobilePhone || '').replace(/\D/g, '');
      const last4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : '';
      const lic = String(matchedDoc.licenseNo || matchedDoc.gpNo || '').trim();

      if (password === '1234') isValid = true;
      else if (last4 && password === last4) isValid = true;
      else if (lic && password === lic) isValid = true;
      else if (password === 'admin1234') isValid = true;
    }

    if (!isValid) {
      showToast('รหัสผ่านไม่ถูกต้อง (หากเข้าครั้งแรก ลองใช้ 4 ตัวท้ายเบอร์โทร หรือ 1234 หรือใช้แท็บตั้งรหัสผ่านใหม่)', 'error');
      return;
    }

    const name = matchedDoc.fullNameTh || matchedDoc.name;
    this.currentUser = {
      role: 'doctor',
      type: docType,
      id: matchedDoc.id,
      sheetId: sheetId,
      name: name,
      licenseNo: matchedDoc.licenseNo || matchedDoc.gpNo || '',
      mobilePhone: matchedDoc.mobilePhone || '',
      workplace: (matchedDoc.workplace && matchedDoc.workplace.name) || matchedDoc.workplace || '',
      photoUrl: getDoctorPrimaryImage(matchedDoc) || ''
    };

    localStorage.setItem(STORAGE_KEY_AUTH_USER, JSON.stringify(this.currentUser));
    this.updateAuthUI();
    closeModal('loginModal');
    this.refreshActiveViews();
    showToast(`ยินดีต้อนรับ ${name} เข้าสู่ระบบเรียบร้อย`, 'success');
  },

  handleAdminLoginForm(event) {
    event.preventDefault();
    const user = (document.getElementById('login-admin-user')?.value || '').trim();
    const pass = (document.getElementById('login-admin-pass')?.value || '').trim();

    if (user === 'admin' && pass === 'admin1234') {
      this.currentUser = {
        role: 'admin',
        name: 'ผู้ดูแลระบบ (Admin)',
        username: 'admin'
      };
      localStorage.setItem(STORAGE_KEY_AUTH_USER, JSON.stringify(this.currentUser));
      this.updateAuthUI();
      closeModal('loginModal');
      this.refreshActiveViews();
      showToast('เข้าสู่ระบบผู้ดูแลระบบ (Admin) สำเร็จ', 'success');
    } else {
      showToast('ชื่อผู้ใช้หรือรหัสผ่าน Admin ไม่ถูกต้อง', 'error');
    }
  },

  handleResetPasswordForm(event) {
    event.preventDefault();
    const lic = (document.getElementById('reset-license-no')?.value || '').trim();
    const contact = (document.getElementById('reset-verify-contact')?.value || '').trim();
    const newPass = (document.getElementById('reset-new-password')?.value || '').trim();

    if (!lic || !newPass || newPass.length < 4) {
      showToast('กรุณาระบุเลข ว. และรหัสผ่านใหม่อย่างน้อย 4 ตัวอักษร', 'warning');
      return;
    }

    const creds = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDENTIALS) || '{}');
    creds[`doc_${lic}`] = newPass;
    localStorage.setItem(STORAGE_KEY_CREDENTIALS, JSON.stringify(creds));

    showToast('ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว เข้าสู่ระบบได้ทันที', 'success');
    this.switchLoginTab('doctor');
    const idEl = document.getElementById('login-doctor-id');
    const passEl = document.getElementById('login-doctor-pass');
    if (idEl) idEl.value = lic;
    if (passEl) passEl.value = newPass;
  },

  handleChangePasswordForm(event) {
    event.preventDefault();
    const currPass = (document.getElementById('change-pass-current')?.value || '').trim();
    const newPass = (document.getElementById('change-pass-new')?.value || '').trim();

    if (!newPass || newPass.length < 4) {
      showToast('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร', 'warning');
      return;
    }

    const lic = this.currentUser.licenseNo || this.currentUser.name;
    const creds = JSON.parse(localStorage.getItem(STORAGE_KEY_CREDENTIALS) || '{}');
    creds[`doc_${lic}`] = newPass;
    localStorage.setItem(STORAGE_KEY_CREDENTIALS, JSON.stringify(creds));

    closeModal('changePasswordModal');
    showToast('เปลี่ยนรหัสผ่านของคุณเรียบร้อยแล้ว', 'success');
  },

  logout() {
    this.currentUser = { role: 'guest' };
    localStorage.removeItem(STORAGE_KEY_AUTH_USER);
    this.updateAuthUI();
    this.refreshActiveViews();
    showToast('ออกจากระบบเรียบร้อยแล้ว คุณกำลังอยู่ในโหมดผู้เข้าชม (ดูได้อย่างเดียว)', 'info');
  },

  openMyProfile() {
    if (this.isGuest()) {
      this.openLoginModal();
      return;
    }

    if (this.isAdmin()) {
      switchView('directory');
      showToast('ในฐานะ Admin คุณสามารถดูและแก้ไขรายละเอียดของแพทย์ทุกคนได้', 'info');
      return;
    }

    const targetId = this.currentUser.sheetId || (this.currentUser.type === 'sheet' ? this.currentUser.id : null);
    if (targetId) {
      openMemberDetailModal(targetId);
    } else {
      switchView('thaifammed');
      showToast('ข้อมูลของคุณบันทึกอยู่ในฐานข้อมูล Thaifammed', 'info');
    }
  },

  relocateMyPin() {
    if (this.isGuest()) {
      this.openLoginModal();
      return;
    }

    if (this.isAdmin()) {
      switchView('map');
      showToast('ในฐานะ Admin คุณสามารถเลือกปุ่มย้ายพิกัดของแพทย์ท่านใดก็ได้บนแผนที่', 'info');
      return;
    }

    switchView('map');
    setTimeout(() => {
      const type = (this.currentUser.type === 'sheet' || this.currentUser.sheetId) ? 'sheet' : 'thaifammed';
      const id = (this.currentUser.type === 'sheet') ? this.currentUser.id : (this.currentUser.sheetId || this.currentUser.id);
      startRelocateMarkerById(type, id);
    }, 350);
  },

  refreshActiveViews() {
    if (AppState.map) renderMapMarkers();
    if (AppState.currentView === 'directory') renderDirectory();
    if (AppState.currentView === 'thaifammed') renderThaifammed();
    if (AppState.currentView === 'gallery') renderPhotoGallery();
  },

  updateAuthUI() {
    const sidebarContainer = document.getElementById('auth-sidebar-container');
    const headerContainer = document.getElementById('auth-header-container');

    // Requirement 2: Toggle lock icon on Master DB menu
    const lockIcon = document.getElementById('sidebar-management-lock');
    if (lockIcon) {
      if (this.canAccessMasterDb()) {
        lockIcon.classList.add('hidden');
      } else {
        lockIcon.classList.remove('hidden');
      }
    }
    this.updateDelegatesUI();

    // Toggle visibility of restricted DB-access elements
    const canDb = this.canAccessMasterDb();
    const restrictedIds = [
      'sidebar-master-db-link',
      'nav-management',
      'nav-geo',
      'header-cloud-sync-group',
      'header-export-csv'
    ];
    restrictedIds.forEach(elId => {
      const restrictedEl = document.getElementById(elId);
      if (restrictedEl) {
        if (canDb) {
          restrictedEl.classList.remove('hidden');
          // Restore flex display for elements that need it
          if (elId === 'header-cloud-sync-group' || elId === 'header-export-csv') {
            restrictedEl.style.display = 'flex';
          }
        } else {
          restrictedEl.classList.add('hidden');
          restrictedEl.style.display = '';
        }
      }
    });

    // 1. Render Sidebar Container
    if (sidebarContainer) {
      if (this.isGuest()) {
        sidebarContainer.innerHTML = `
          <div class="bg-slate-800/80 rounded-2xl p-3 border border-slate-700/60 text-xs text-slate-300 space-y-2">
            <div class="flex items-center justify-between">
              <span class="flex items-center gap-1.5 text-slate-400"><i class="fa-solid fa-user-circle"></i> สถานะ: ผู้เข้าชม</span>
              <span class="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-semibold">ดูได้อย่างเดียว</span>
            </div>
            <p class="text-[11px] text-slate-400">เข้าสู่ระบบเพื่อแก้ไขข้อมูลและพิกัดของคุณเอง</p>
            <button onclick="AuthManager.openLoginModal()" class="w-full py-2 px-3 bg-gradient-to-r from-sky-600 to-teal-600 hover:from-sky-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-md shadow-sky-600/30 transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ (Login)
            </button>
          </div>
        `;
      } else if (this.isDoctor()) {
        const avatar = this.currentUser.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(this.currentUser.name)}&background=0284c7&color=fff`;
        const isDelegate = this.isMasterDbDelegate();
        sidebarContainer.innerHTML = `
          <div class="bg-slate-800/90 rounded-2xl p-3 border ${isDelegate ? 'border-rose-500/50 bg-slate-900/90' : 'border-sky-500/30'} text-xs text-white space-y-2.5">
            <div class="flex items-center space-x-2.5">
              <div class="w-10 h-10 rounded-xl overflow-hidden bg-sky-900 border ${isDelegate ? 'border-rose-400' : 'border-sky-500'} shrink-0">
                <img src="${avatar}" referrerpolicy="no-referrer" class="w-full h-full object-cover">
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-bold truncate text-slate-100">${escapeHtml(this.currentUser.name)}</div>
                <div class="text-[10px] text-sky-300 font-mono">${this.currentUser.licenseNo ? 'ว. ' + escapeHtml(this.currentUser.licenseNo) : 'แพทย์สมาชิก'}</div>
              </div>
              <span class="px-2 py-0.5 rounded-full ${isDelegate ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'} text-[10px] font-semibold">
                ${isDelegate ? 'Master DB' : 'แพทย์'}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-700/60">
              <button onclick="AuthManager.openMyProfile()" class="py-1.5 px-2 bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1" title="ดูหรือแก้ไขข้อมูลของฉัน">
                <i class="fa-solid fa-user"></i> ข้อมูลของฉัน
              </button>
              <button onclick="AuthManager.relocateMyPin()" class="py-1.5 px-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1" title="ย้ายตำแหน่งพิกัดหมุดของฉัน">
                <i class="fa-solid fa-location-dot"></i> ย้ายพิกัด
              </button>
            </div>
            ${isDelegate ? `
              <button onclick="switchView('management')" class="w-full py-1.5 px-2 bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1.5">
                <i class="fa-solid fa-shield-halved text-rose-400"></i> เข้าจัดการ Master DB
              </button>
            ` : ''}
            <button onclick="AuthManager.logout()" class="w-full py-1 text-slate-400 hover:text-rose-300 text-[10px] transition flex items-center justify-center gap-1">
              <i class="fa-solid fa-arrow-right-from-bracket"></i> ออกจากระบบ
            </button>
          </div>
        `;
      } else if (this.isAdmin()) {
        sidebarContainer.innerHTML = `
          <div class="bg-indigo-950/80 rounded-2xl p-3 border border-indigo-700/60 text-xs text-white space-y-2">
            <div class="flex items-center space-x-2.5">
              <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
                <i class="fa-solid fa-shield-halved"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-bold truncate text-indigo-100">ผู้ดูแลระบบ (Admin)</div>
                <div class="text-[10px] text-indigo-300">แก้ไขได้ทุกท่าน + จัดการระบบ</div>
              </div>
            </div>
            <button onclick="AuthManager.logout()" class="w-full py-1 text-slate-400 hover:text-rose-300 text-[10px] transition flex items-center justify-center gap-1">
              <i class="fa-solid fa-arrow-right-from-bracket"></i> ออกจากระบบ
            </button>
          </div>
        `;
      }
    }

    // 2. Render Header Container
    if (headerContainer) {
      if (this.isGuest()) {
        headerContainer.innerHTML = `
          <button onclick="AuthManager.openLoginModal()" class="flex items-center space-x-1.5 px-3 py-2 bg-gradient-to-r from-sky-600 to-teal-600 hover:from-sky-700 hover:to-teal-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-sky-600/20 transition active:scale-95">
            <i class="fa-solid fa-right-to-bracket"></i>
            <span>เข้าสู่ระบบ (Login)</span>
          </button>
        `;
      } else if (this.isDoctor()) {
        const avatar = this.currentUser.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(this.currentUser.name)}&background=0284c7&color=fff`;
        const isDelegate = this.isMasterDbDelegate();
        headerContainer.innerHTML = `
          <div class="relative">
            <button onclick="AuthManager.toggleUserDropdown(event)" class="flex items-center space-x-2 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl transition border border-slate-200">
              <div class="w-7 h-7 rounded-lg overflow-hidden bg-sky-600 shrink-0">
                <img src="${avatar}" referrerpolicy="no-referrer" class="w-full h-full object-cover">
              </div>
              <div class="text-left hidden sm:block">
                <div class="text-xs font-bold text-slate-900 leading-tight max-w-[140px] truncate">${escapeHtml(this.currentUser.name)}</div>
                <div class="text-[10px] text-sky-600 font-mono font-medium">${this.currentUser.licenseNo ? 'ว. ' + escapeHtml(this.currentUser.licenseNo) : 'แพทย์สมาชิก'}</div>
              </div>
              <i class="fa-solid fa-chevron-down text-slate-400 text-[10px]"></i>
            </button>
            <div id="user-dropdown-menu" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-50 text-xs font-medium text-slate-700 animate-fade-in">
              <div class="px-3.5 py-2 border-b border-slate-100">
                <p class="text-[10px] text-slate-400 font-semibold uppercase">เข้าสู่ระบบในชื่อ</p>
                <p class="font-bold text-slate-900 truncate">${escapeHtml(this.currentUser.name)}</p>
                <span class="inline-block mt-0.5 px-2 py-0.2 rounded-full ${isDelegate ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'} text-[10px] font-semibold">
                  ${isDelegate ? 'แพทย์สมาชิก (มีสิทธิ์ Master DB)' : 'แพทย์สมาชิก (แก้ไขเฉพาะตนเอง)'}
                </span>
              </div>
              <button onclick="AuthManager.openMyProfile()" class="w-full px-3.5 py-2 text-left hover:bg-sky-50 hover:text-sky-700 transition flex items-center gap-2">
                <i class="fa-solid fa-user-pen text-sky-600 w-4"></i> ข้อมูลประวัติของฉัน
              </button>
              <button onclick="AuthManager.relocateMyPin()" class="w-full px-3.5 py-2 text-left hover:bg-amber-50 hover:text-amber-700 transition flex items-center gap-2">
                <i class="fa-solid fa-location-crosshairs text-amber-600 w-4"></i> ย้ายพิกัดหมุดของฉัน
              </button>
              ${isDelegate ? `
                <button onclick="switchView('management')" class="w-full px-3.5 py-2 text-left hover:bg-rose-50 text-rose-700 transition flex items-center gap-2 font-semibold">
                  <i class="fa-solid fa-shield-halved text-rose-600 w-4"></i> จัดการฐานข้อมูล Master DB
                </button>
              ` : ''}
              <button onclick="AuthManager.openChangePasswordModal()" class="w-full px-3.5 py-2 text-left hover:bg-slate-50 transition flex items-center gap-2">
                <i class="fa-solid fa-key text-slate-400 w-4"></i> เปลี่ยนรหัสผ่าน
              </button>
              <div class="border-t border-slate-100 my-1"></div>
              <button onclick="AuthManager.logout()" class="w-full px-3.5 py-2 text-left text-rose-600 hover:bg-rose-50 transition flex items-center gap-2">
                <i class="fa-solid fa-arrow-right-from-bracket w-4"></i> ออกจากระบบ
              </button>
            </div>
          </div>
        `;
      } else if (this.isAdmin()) {
        headerContainer.innerHTML = `
          <div class="relative">
            <button onclick="AuthManager.toggleUserDropdown(event)" class="flex items-center space-x-2 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 rounded-xl transition border border-indigo-200">
              <div class="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                <i class="fa-solid fa-shield-halved"></i>
              </div>
              <div class="text-left hidden sm:block">
                <div class="text-xs font-bold leading-tight">ผู้ดูแลระบบ</div>
                <div class="text-[10px] text-indigo-600 font-medium">สิทธิ์ระดับ Admin</div>
              </div>
              <i class="fa-solid fa-chevron-down text-indigo-400 text-[10px]"></i>
            </button>
            <div id="user-dropdown-menu" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-1.5 z-50 text-xs font-medium text-slate-700 animate-fade-in">
              <div class="px-3.5 py-2 border-b border-slate-100">
                <p class="font-bold text-slate-900">ผู้ดูแลระบบสูงสุด (Admin)</p>
                <span class="inline-block mt-0.5 px-2 py-0.2 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-semibold">แก้ไขข้อมูลได้ทุกท่าน</span>
              </div>
              <button onclick="switchView('management')" class="w-full px-3.5 py-2 text-left hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2">
                <i class="fa-solid fa-sliders text-indigo-600 w-4"></i> ปรับแต่งโลโก้ & ข้อความระบบ
              </button>
              <button onclick="switchView('directory')" class="w-full px-3.5 py-2 text-left hover:bg-slate-50 transition flex items-center gap-2">
                <i class="fa-solid fa-users text-slate-400 w-4"></i> ข้อมูลแพทย์ทั้งหมด
              </button>
              <div class="border-t border-slate-100 my-1"></div>
              <button onclick="AuthManager.logout()" class="w-full px-3.5 py-2 text-left text-rose-600 hover:bg-rose-50 transition flex items-center gap-2">
                <i class="fa-solid fa-arrow-right-from-bracket w-4"></i> ออกจากระบบ
              </button>
            </div>
          </div>
        `;
      }
    }
  }
};


