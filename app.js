import FitParser from './vendor/fit-parser/fit-parser.js';

const STORAGE_KEY = 'training-history-pwa-v1';
const SOURCE = 'Garmin FIT files analysed in Training History PWA';
const ACTIVITY_KEYS = [
  'id', 'date', 'startTime', 'sport', 'durationSeconds', 'averagePower', 'maxPower',
  'normalizedPower', 'averageCadence', 'averageHeartRate', 'maxHeartRate', 'distanceKm', 'notes'
];

const demoActivities = [
  { id: 'demo-1', date: '2026-06-28', startTime: '2026-06-28T07:15:00+02:00', sport: 'indoor_cycling', durationSeconds: 3120, averagePower: 211, maxPower: 612, normalizedPower: 224, averageCadence: 88, averageHeartRate: 148, maxHeartRate: 174, distanceKm: 31.4, notes: 'Demo – tempo' },
  { id: 'demo-2', date: '2026-06-24', startTime: '2026-06-24T18:05:00+02:00', sport: 'indoor_cycling', durationSeconds: 2700, averagePower: 196, maxPower: 478, normalizedPower: 207, averageCadence: 91, averageHeartRate: 142, maxHeartRate: 166, distanceKm: 26.1, notes: 'Demo – let tur' },
  { id: 'demo-3', date: '2026-06-20', startTime: '2026-06-20T08:30:00+02:00', sport: 'indoor_cycling', durationSeconds: 3900, averagePower: 224, maxPower: 701, normalizedPower: 238, averageCadence: 86, averageHeartRate: 153, maxHeartRate: 181, distanceKm: 38.7, notes: 'Demo – intervaller' },
  { id: 'demo-4', date: '2026-06-15', startTime: '2026-06-15T09:10:00+02:00', sport: 'indoor_cycling', durationSeconds: 3300, averagePower: 205, maxPower: 520, normalizedPower: 216, averageCadence: 89, averageHeartRate: 146, maxHeartRate: 171, distanceKm: 33.2, notes: 'Demo – udholdenhed' }
];

let history = loadHistory();
let pendingActivities = [];
let demoVisible = history.activities.length === 0;
let activeTab = 'overview';
let trendPeriod = 'all';

const $ = selector => document.querySelector(selector);
const elements = {
  fitInput: $('#fitInput'), jsonInput: $('#jsonInput'), preview: $('#previewSection'),
  previewList: $('#previewList'), previewTitle: $('#previewTitle'), comparison: $('#comparisonBox'),
  message: $('#message'), demoNotice: $('#demoNotice'), addButton: $('#addPreviewButton')
};

$('#importFitButton').addEventListener('click', () => elements.fitInput.click());
$('#importJsonButton').addEventListener('click', () => elements.jsonInput.click());
$('#exportButton').addEventListener('click', exportHistory);
$('#clearButton').addEventListener('click', clearHistory);
$('#closePreviewButton').addEventListener('click', closePreview);
$('#addPreviewButton').addEventListener('click', addPendingActivities);
$('#hideDemoButton').addEventListener('click', () => { demoVisible = false; render(); });
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
document.querySelectorAll('[data-target-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.targetTab)));
document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
  trendPeriod = button.dataset.days;
  document.querySelectorAll('[data-days]').forEach(item => item.classList.toggle('is-active', item === button));
  renderCharts(displayActivities());
}));
elements.fitInput.addEventListener('change', importFitSelection);
elements.jsonInput.addEventListener('change', importJsonHistory);
const dropZone = $('#importFitButton');
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('is-dragging'); }));
dropZone.addEventListener('drop', event => {
  const files = event.dataTransfer?.files;
  if (files?.length) importFitSelection({ target: { files, value: '' } });
});
window.addEventListener('online', updateConnectionBadge);
window.addEventListener('offline', updateConnectionBadge);
window.addEventListener('resize', debounce(() => { if (activeTab === 'trends') renderCharts(displayActivities()); }, 120));

$('#topbarDate').textContent = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
render();
updateConnectionBadge();
registerServiceWorker();

function emptyHistory() {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), source: SOURCE, activities: [] };
}

function loadHistory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return emptyHistory();
    const parsed = JSON.parse(stored);
    const result = validateHistory(parsed);
    return result.valid ? normalizeHistory(parsed) : emptyHistory();
  } catch (error) {
    console.warn('Kunne ikke læse lokal historik', error);
    return emptyHistory();
  }
}

function saveHistory() {
  history.updatedAt = new Date().toISOString();
  history.activities = sortNewest(history.activities);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function normalizeHistory(input) {
  return {
    schemaVersion: 1,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    source: SOURCE,
    activities: sortNewest(input.activities.map(activity => normalizeActivity(activity)))
  };
}

function normalizeActivity(activity) {
  const normalized = {};
  for (const key of ACTIVITY_KEYS) normalized[key] = activity[key] === undefined ? null : activity[key];
  normalized.id = String(activity.id);
  normalized.date = activity.date;
  normalized.startTime = activity.startTime ?? null;
  normalized.sport = 'indoor_cycling';
  normalized.notes = typeof activity.notes === 'string' ? activity.notes : '';
  for (const key of ['durationSeconds', 'averagePower', 'maxPower', 'normalizedPower', 'averageCadence', 'averageHeartRate', 'maxHeartRate', 'distanceKm']) {
    normalized[key] = finiteNumber(activity[key]);
  }
  return normalized;
}

async function importFitSelection(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  setBusy(true);
  showMessage(`Analyserer ${files.length} fil${files.length === 1 ? '' : 'er'}…`);
  try {
    const fitFiles = [];
    for (const file of files) {
      const extension = file.name.split('.').pop().toLowerCase();
      if (extension === 'fit') {
        fitFiles.push({ name: file.name, buffer: await file.arrayBuffer() });
      } else if (extension === 'zip') {
        fitFiles.push(...await extractFitFiles(file));
      } else {
        throw new Error(`${file.name} er ikke en FIT- eller ZIP-fil.`);
      }
    }
    if (!fitFiles.length) throw new Error('ZIP-filen indeholder ingen .fit-filer.');
    const parsed = [];
    const failures = [];
    for (const fitFile of fitFiles) {
      try { parsed.push(...await parseFitFile(fitFile)); }
      catch (error) { failures.push(`${fitFile.name}: ${error.message || error}`); }
    }
    if (!parsed.length) throw new Error(`Ingen FIT-filer kunne læses. ${failures.join(' ')}`);
    pendingActivities = parsed;
    showPreview(parsed, failures);
    showMessage(`${parsed.length} aktivitet${parsed.length === 1 ? '' : 'er'} fundet${failures.length ? `; ${failures.length} fil(er) kunne ikke læses` : ''}.`);
  } catch (error) {
    showMessage(error.message || 'Filen kunne ikke analyseres.', true);
  } finally {
    setBusy(false);
  }
}

async function extractFitFiles(file) {
  if (!window.fflate?.unzipSync) throw new Error('ZIP-biblioteket blev ikke indlæst.');
  let entries;
  try { entries = window.fflate.unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new Error(`${file.name} kunne ikke åbnes som ZIP-fil.`); }
  return Object.entries(entries)
    .filter(([name]) => name.toLowerCase().endsWith('.fit'))
    .map(([name, bytes]) => ({ name: name.split('/').pop(), buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
}

async function parseFitFile(file) {
  const parser = new FitParser({ force: true, speedUnit: 'km/h', lengthUnit: 'km', elapsedRecordField: true, mode: 'list' });
  let data;
  try { data = await parser.parseAsync(file.buffer); }
  catch (error) { throw new Error(typeof error === 'string' ? error : 'Ugyldig eller beskadiget FIT-fil.'); }
  const sessions = Array.isArray(data.sessions) && data.sessions.length ? data.sessions : [data.activity || {}];
  const records = Array.isArray(data.records) ? data.records : [];
  const fileBase = file.name.replace(/\.fit$/i, '').replace(/[^a-z0-9_-]+/gi, '-');
  const numericId = file.name.match(/\d{6,}/)?.[0];
  return sessions.map((session, index) => fitSessionToActivity(session, sessions.length === 1 ? records : [], numericId || fileBase, file.name, index, sessions.length));
}

function fitSessionToActivity(session, records, baseId, fileName, index, sessionCount) {
  const start = validDate(session.start_time) || validDate(session.timestamp) || validDate(records[0]?.timestamp);
  const startTime = start ? start.toISOString() : null;
  const duration = firstNumber(session.total_timer_time, session.timer_time);
  const distance = firstNumber(session.total_distance);
  const recordPower = records.length ? safeAverage(records.map(record => record.power)) : null;
  const recordCadence = records.length ? safeAverage(records.map(record => record.cadence)) : null;
  const recordHeart = records.length ? safeAverage(records.map(record => record.heart_rate)) : null;
  const activity = {
    id: sessionCount > 1 ? `${baseId}-${index + 1}` : String(baseId),
    date: startTime ? startTime.slice(0, 10) : dateFromFilename(fileName),
    startTime,
    sport: 'indoor_cycling',
    durationSeconds: duration === null ? null : Math.round(duration),
    averagePower: rounded(firstNumber(session.avg_power, recordPower)),
    maxPower: rounded(firstNumber(session.max_power, safeMax(records.map(record => record.power)))),
    normalizedPower: rounded(firstNumber(session.normalized_power)),
    averageCadence: rounded(firstNumber(session.avg_cadence, recordCadence)),
    averageHeartRate: rounded(firstNumber(session.avg_heart_rate, recordHeart)),
    maxHeartRate: rounded(firstNumber(session.max_heart_rate, safeMax(records.map(record => record.heart_rate)))),
    distanceKm: distance === null ? null : round(distance, 2),
    notes: `Importeret fra ${fileName}`
  };
  if (!activity.date) throw new Error('FIT-filen mangler en sikker dato.');
  return activity;
}

function dateFromFilename(name) {
  const match = name.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null;
}

function showPreview(activities, failures = []) {
  switchTab('import');
  elements.previewTitle.textContent = `${activities.length} aktivitet${activities.length === 1 ? '' : 'er'} fundet`;
  elements.previewList.innerHTML = activities.map(activity => {
    const duplicate = findDuplicate(activity, history.activities);
    return `<article class="preview-item"><div><strong>${escapeHtml(formatDate(activity.date))} · ${formatDuration(activity.durationSeconds)}</strong><p>${formatMetric(activity.averagePower, 'W')} · ${formatMetric(activity.averageHeartRate, 'bpm')} · ${formatMetric(activity.distanceKm, 'km')}</p></div><span class="preview-tag">${duplicate ? 'DUBLET' : 'NY'}</span></article>`;
  }).join('') + failures.map(failure => `<article class="preview-item"><div><strong>Kunne ikke læses</strong><p>${escapeHtml(failure)}</p></div></article>`).join('');
  elements.comparison.innerHTML = comparisonMarkup(activities[0]);
  elements.addButton.disabled = activities.every(activity => findDuplicate(activity, history.activities));
  elements.preview.hidden = false;
  $('#noImportYet').hidden = true;
  $('#importReady').textContent = 'Preview klar';
  elements.preview.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function comparisonMarkup(activity) {
  const previous = sortNewest(history.activities).find(item => !findDuplicate(activity, [item]));
  if (!previous) return '<div><span>Sammenligning</span><strong>Ingen tidligere tur</strong></div>';
  return [
    ['Watt', difference(activity.averagePower, previous.averagePower, 'W')],
    ['Puls', difference(activity.averageHeartRate, previous.averageHeartRate, 'bpm')],
    ['Distance', difference(activity.distanceKm, previous.distanceKm, 'km', 1)],
    ['Varighed', difference(activity.durationSeconds, previous.durationSeconds, 'min', 0, 60)]
  ].map(([label, value]) => `<div><span>${label} fra forrige tur</span><strong>${value}</strong></div>`).join('');
}

function difference(current, previous, unit, decimals = 0, divisor = 1) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 'Ikke nok data';
  const value = (current - previous) / divisor;
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)} ${unit}`;
}

function addPendingActivities() {
  let added = 0;
  let duplicates = 0;
  for (const activity of pendingActivities) {
    if (findDuplicate(activity, history.activities)) duplicates++;
    else { history.activities.push(activity); added++; }
  }
  saveHistory();
  demoVisible = false;
  closePreview();
  render();
  showMessage(`${added} ny${added === 1 ? '' : 'e'} aktivitet${added === 1 ? '' : 'er'} tilføjet${duplicates ? ` · ${duplicates} dublet${duplicates === 1 ? '' : 'ter'} sprunget over` : ''}.`);
}

async function importJsonHistory(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const validation = validateHistory(imported);
    if (!validation.valid) throw new Error(`JSON-filen er ikke gyldig: ${validation.errors[0]}`);
    let added = 0;
    let duplicates = 0;
    for (const activity of imported.activities.map(normalizeActivity)) {
      if (findDuplicate(activity, history.activities)) duplicates++;
      else { history.activities.push(activity); added++; }
    }
    saveHistory();
    demoVisible = false;
    render();
    showMessage(`${added} aktivitet${added === 1 ? '' : 'er'} importeret · ${duplicates} dublet${duplicates === 1 ? '' : 'ter'} sprunget over.`);
  } catch (error) { showMessage(error.message || 'JSON-filen kunne ikke importeres.', true); }
}

function exportHistory() {
  const exportData = normalizeHistory(history);
  exportData.updatedAt = new Date().toISOString();
  const validation = validateHistory(exportData);
  if (!validation.valid) { showMessage(`Eksport stoppet: ${validation.errors.join(' ')}`, true); return; }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'training-history.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMessage(`${exportData.activities.length} aktivitet${exportData.activities.length === 1 ? '' : 'er'} eksporteret i gyldigt JSON-format.`);
}

function clearHistory() {
  if (!history.activities.length) { showMessage('Den lokale historik er allerede tom.'); return; }
  if (!window.confirm('Vil du permanent rydde al lokalt gemt træningshistorik?')) return;
  localStorage.removeItem(STORAGE_KEY);
  history = emptyHistory();
  demoVisible = false;
  closePreview();
  render();
  showMessage('Den lokale historik er ryddet.');
}

function validateHistory(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['Roden skal være et JSON-objekt.'] };
  if (value.schemaVersion !== 1) errors.push('schemaVersion skal være 1.');
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) errors.push('updatedAt skal være en gyldig ISO-8601-dato.');
  if (value.source !== SOURCE) errors.push(`source skal være "${SOURCE}".`);
  if (!Array.isArray(value.activities)) errors.push('activities skal være en liste.');
  else value.activities.forEach((activity, index) => {
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)) { errors.push(`Aktivitet ${index + 1} er ugyldig.`); return; }
    const missing = ACTIVITY_KEYS.filter(key => !(key in activity));
    if (missing.length) errors.push(`Aktivitet ${index + 1} mangler: ${missing.join(', ')}.`);
    if (typeof activity.id !== 'string' || !activity.id.trim()) errors.push(`Aktivitet ${index + 1} har ugyldigt id.`);
    if (typeof activity.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(activity.date)) errors.push(`Aktivitet ${index + 1} har ugyldig date.`);
    if (activity.startTime !== null && (typeof activity.startTime !== 'string' || Number.isNaN(Date.parse(activity.startTime)))) errors.push(`Aktivitet ${index + 1} har ugyldig startTime.`);
    if (activity.sport !== 'indoor_cycling') errors.push(`Aktivitet ${index + 1} skal have sport indoor_cycling.`);
    for (const key of ['durationSeconds', 'averagePower', 'maxPower', 'normalizedPower', 'averageCadence', 'averageHeartRate', 'maxHeartRate', 'distanceKm']) {
      if (activity[key] !== null && (typeof activity[key] !== 'number' || !Number.isFinite(activity[key]))) errors.push(`Aktivitet ${index + 1}: ${key} skal være et tal eller null.`);
    }
    if (typeof activity.notes !== 'string') errors.push(`Aktivitet ${index + 1} har ugyldige notes.`);
  });
  return { valid: errors.length === 0, errors };
}

function findDuplicate(activity, list) {
  return list.find(existing =>
    existing.id === activity.id ||
    (activity.startTime && existing.startTime && existing.startTime === activity.startTime) ||
    (existing.date === activity.date && Number.isFinite(activity.durationSeconds) && existing.durationSeconds === activity.durationSeconds)
  );
}

function displayActivities() { return history.activities.length ? history.activities : (demoVisible ? demoActivities : []); }

function switchTab(tabName) {
  const panel = $(`#tab-${tabName}`);
  const button = $(`[data-tab="${tabName}"]`);
  if (!panel || !button) return;
  activeTab = tabName;
  document.querySelectorAll('.tab-panel').forEach(item => {
    const active = item === panel;
    item.hidden = !active;
    item.classList.toggle('is-active', active);
  });
  document.querySelectorAll('[data-tab]').forEach(item => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (tabName === 'trends') requestAnimationFrame(() => renderCharts(displayActivities()));
}

function renderLegacy() {
  const activities = sortNewest(displayActivities());
  const latest = activities[0];
  elements.demoNotice.hidden = !(demoVisible && history.activities.length === 0);
  $('#latestDate').textContent = latest ? formatDate(latest.date) : 'Ingen træning endnu';
  $('#latestPower').innerHTML = `${latest?.averagePower ?? '—'}<small>W</small>`;
  $('#latestDuration').textContent = latest ? formatDuration(latest.durationSeconds) : '—';
  $('#latestDistance').textContent = latest ? formatMetric(latest.distanceKm, 'km') : '—';
  $('#latestHeartRate').textContent = latest ? formatMetric(latest.averageHeartRate, 'bpm') : '—';
  $('#latestCadence').textContent = latest ? formatMetric(latest.averageCadence, 'rpm') : '—';
  $('#totalActivities').textContent = activities.length;
  $('#totalDuration').textContent = formatTotalDuration(sum(activities, 'durationSeconds'));
  $('#totalDistance').textContent = `${round(sum(activities, 'distanceKm'), 1)} km`;
  $('#overallPower').textContent = formatMetric(safeAverage(activities.map(item => item.averagePower)), 'W');
  renderCharts(activities);
}

function renderCharts(activities) {
  const filtered = filterActivitiesByPeriod(activities);
  const chronological = sortNewest(filtered).slice(0, 18).reverse();
  const withMinutes = chronological.map(item => ({ ...item, durationMinutes: Number.isFinite(item.durationSeconds) ? item.durationSeconds / 60 : null }));
  $('#powerChartValue').textContent = formatMetric(safeAverage(filtered.map(item => item.averagePower)), 'W');
  $('#heartChartValue').textContent = formatMetric(safeAverage(filtered.map(item => item.averageHeartRate)), 'bpm');
  $('#distanceChartValue').textContent = formatMetric(safeAverage(filtered.map(item => item.distanceKm)), 'km');
  $('#durationChartValue').textContent = formatDuration(safeAverage(filtered.map(item => item.durationSeconds)));
  $('#cadenceChartValue').textContent = formatMetric(safeAverage(filtered.map(item => item.averageCadence)), 'rpm');
  drawChart($('#powerChart'), chronological, 'averagePower', '#2563eb');
  drawChart($('#heartChart'), chronological, 'averageHeartRate', '#e11d48');
  drawChart($('#distanceChart'), chronological, 'distanceKm', '#0891b2');
  drawChart($('#durationChart'), withMinutes, 'durationMinutes', '#16a34a');
  drawChart($('#cadenceChart'), chronological, 'averageCadence', '#7c3aed');
}

function filterActivitiesByPeriod(activities) {
  if (trendPeriod === 'all') return activities;
  const days = Number(trendPeriod);
  if (!Number.isFinite(days)) return activities;
  const cutoff = Date.now() - days * 86400000;
  return activities.filter(activity => activityTime(activity) >= cutoff);
}

function drawChart(canvas, data, key, color) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(155 * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const width = rect.width, height = 155, pad = { top: 13, right: 8, bottom: 23, left: 27 };
  ctx.clearRect(0, 0, width, height);
  const points = data.map((item, index) => ({ index, value: item[key], date: item.date })).filter(point => Number.isFinite(point.value));
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) { const y = pad.top + i * ((height - pad.top - pad.bottom) / 2); ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); }
  if (!points.length) { ctx.fillStyle = '#94a3b8'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Ingen data i perioden', width / 2, height / 2); return; }
  const values = points.map(point => point.value); let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; } else { const margin = (max - min) * .12; min -= margin; max += margin; }
  const x = index => pad.left + (data.length === 1 ? (width - pad.left - pad.right) / 2 : index * (width - pad.left - pad.right) / (data.length - 1));
  const y = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom); gradient.addColorStop(0, `${color}45`); gradient.addColorStop(1, `${color}00`);
  ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(x(point.index), y(point.value)) : ctx.moveTo(x(point.index), y(point.value)));
  ctx.lineTo(x(points.at(-1).index), height - pad.bottom); ctx.lineTo(x(points[0].index), height - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(x(point.index), y(point.value)) : ctx.moveTo(x(point.index), y(point.value))); ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
  points.forEach(point => { ctx.beginPath(); ctx.arc(x(point.index), y(point.value), 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
  const labels = data.length < 5 ? data : data.filter((_, index) => index === 0 || index === data.length - 1 || index === Math.floor(data.length / 2));
  labels.forEach(item => { const index = data.indexOf(item); ctx.fillText(item.date?.slice(5) || '', x(index), height - 7); });
}

function closePreview() { elements.preview.hidden = true; pendingActivities = []; }
function showMessage(text, error = false) { elements.message.textContent = text; elements.message.classList.toggle('error', error); elements.message.hidden = false; $('#noImportYet').hidden = true; $('#importReady').textContent = error ? 'Kræver opmærksomhed' : 'Status opdateret'; }
function setBusyLegacy(busy) { $('#importFitButton').disabled = busy; $('#importFitButton').textContent = busy ? 'Analyserer…' : '＋ Importer Garmin ZIP/FIT'; }
function updateConnectionBadge() { $('#offlineBadge').textContent = navigator.onLine ? 'Klar' : 'Offline'; }
function registerServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker kunne ikke registreres', error)); }
function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function firstNumber(...values) { return values.find(value => typeof value === 'number' && Number.isFinite(value)) ?? null; }
function rounded(value) { return Number.isFinite(value) ? Math.round(value) : null; }
function safeAverage(values) { const valid = values.filter(Number.isFinite); return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null; }
function safeMax(values) { const valid = values.filter(Number.isFinite); return valid.length ? Math.max(...valid) : null; }
function sum(items, key) { return items.reduce((total, item) => total + (Number.isFinite(item[key]) ? item[key] : 0), 0); }
function round(value, decimals = 0) { const factor = 10 ** decimals; return Math.round(value * factor) / factor; }
function validDate(value) { if (!value) return null; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function sortNewest(items) { return [...items].sort((a, b) => activityTime(b) - activityTime(a)); }
function activityTime(activity) { return Date.parse(activity.startTime || `${activity.date}T00:00:00Z`) || 0; }
function formatDate(date) { if (!date) return 'Ukendt dato'; return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)); }
function formatTime(startTime) { if (!startTime) return 'Tidspunkt ukendt'; const date = new Date(startTime); return Number.isNaN(date.getTime()) ? 'Tidspunkt ukendt' : new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' }).format(date); }
function formatDuration(seconds) { if (!Number.isFinite(seconds)) return '—'; const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)} t ${minutes % 60} min` : `${minutes} min`; }
function formatTotalDuration(seconds) { if (!Number.isFinite(seconds) || seconds === 0) return '0 t'; const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return `${hours} t ${minutes} min`; }
function formatCompactTotalDuration(seconds) { if (!Number.isFinite(seconds) || seconds === 0) return '0 t'; const hours = Math.floor(seconds / 3600); const minutes = Math.round((seconds % 3600) / 60); return `${hours}t ${minutes}m`; }
function formatMetric(value, unit) { return Number.isFinite(value) ? `${round(value, unit === 'km' ? 1 : 0)} ${unit}` : '—'; }
function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

function render() {
  const activities = sortNewest(displayActivities());
  const latest = activities[0];
  const isDemo = demoVisible && history.activities.length === 0;
  elements.demoNotice.hidden = !isDemo;
  $('#latestDate').textContent = latest ? formatDate(latest.date) : 'Ingen træning endnu';
  $('#latestPower').innerHTML = `${latest?.averagePower ?? '—'}<small>W</small>`;
  $('#latestDuration').textContent = latest ? formatDuration(latest.durationSeconds) : '—';
  $('#latestDistance').textContent = latest ? formatMetric(latest.distanceKm, 'km') : '—';
  $('#latestHeartRate').textContent = latest ? formatMetric(latest.averageHeartRate, 'bpm') : '—';
  $('#latestCadence').textContent = latest ? formatMetric(latest.averageCadence, 'rpm') : '—';
  $('#totalActivities').textContent = activities.length;
  $('#totalDuration').textContent = formatCompactTotalDuration(sum(activities, 'durationSeconds'));
  $('#totalDistance').textContent = `${round(sum(activities, 'distanceKm'), 0)} km`;
  $('#overallPower').textContent = formatMetric(safeAverage(activities.map(item => item.averagePower)), 'W');
  $('#overallHeart').textContent = formatMetric(safeAverage(activities.map(item => item.averageHeartRate)), 'bpm');
  $('#bestPower').textContent = formatMetric(safeMax(activities.map(item => item.averagePower)), 'W');
  $('#longestRide').textContent = formatDuration(safeMax(activities.map(item => item.durationSeconds)));
  $('#highlightLowHeart').textContent = formatMetric(safeMin(activities.map(item => item.averageHeartRate)), 'bpm');
  $('#highlightCount').textContent = activities.length;

  const hasActivities = activities.length > 0;
  $('#overviewEmpty').hidden = hasActivities;
  $('.latest-card').hidden = !hasActivities;
  $('.summary-card').hidden = !hasActivities;
  $('.highlight-grid').closest('section').hidden = !hasActivities;
  $('#sinceLastSection').hidden = activities.length < 2;
  if (activities.length >= 2) $('#overviewTrendGrid').innerHTML = trendMarkup(activities[0], activities[1]);

  $('#ridesDataMode').textContent = isDemo ? 'Demo-data' : '';
  $('#trendsDataMode').textContent = isDemo ? 'Demo-data' : '';
  renderRides(activities);
  renderTrendCards(activities);
  if (activeTab === 'trends') requestAnimationFrame(() => renderCharts(activities));
}

function renderRides(activities) {
  $('#ridesCount').textContent = `${activities.length} ${activities.length === 1 ? 'tur' : 'ture'}`;
  $('#ridesEmpty').hidden = activities.length > 0;
  const carousel = $('#ridesCarousel');
  carousel.hidden = activities.length === 0;
  $('#rideDots').hidden = activities.length === 0;
  $('#activitiesSection').hidden = activities.length === 0;
  if (!activities.length) {
    carousel.innerHTML = '';
    $('#rideDots').innerHTML = '';
    $('#activitiesList').innerHTML = '';
    return;
  }

  const bestPowerValue = safeMax(activities.map(item => item.averagePower));
  const longestValue = safeMax(activities.map(item => item.durationSeconds));
  const lowestHeartValue = safeMin(activities.map(item => item.averageHeartRate));
  carousel.innerHTML = activities.map((activity, index) => {
    const badges = [];
    if (index === 0) badges.push('<span class="ride-badge">Nyeste</span>');
    if (Number.isFinite(bestPowerValue) && activity.averagePower === bestPowerValue) badges.push('<span class="ride-badge">Bedste watt</span>');
    if (Number.isFinite(longestValue) && activity.durationSeconds === longestValue) badges.push('<span class="ride-badge blue">Længste tur</span>');
    if (Number.isFinite(lowestHeartValue) && activity.averageHeartRate === lowestHeartValue) badges.push('<span class="ride-badge blue">Laveste puls</span>');
    return `<article class="ride-card" aria-label="Tur ${index + 1} af ${activities.length}">
      <div class="ride-top"><div><span class="ride-date">${escapeHtml(activity.date)}</span><strong class="ride-day">${escapeHtml(formatDate(activity.date))}</strong></div><span class="ride-number">#${String(activities.length - index).padStart(2, '0')}</span></div>
      <div class="ride-power"><strong>${activity.averagePower ?? '—'}</strong><span>gns. watt</span></div>
      <div class="ride-primary"><div><span>Varighed</span><strong>${formatDuration(activity.durationSeconds)}</strong></div><div><span>Distance</span><strong>${formatMetric(activity.distanceKm, 'km')}</strong></div></div>
      <div class="ride-metrics">
        <div><span>NP</span><strong>${formatMetric(activity.normalizedPower, 'W')}</strong></div>
        <div><span>Gns. puls</span><strong>${formatMetric(activity.averageHeartRate, 'bpm')}</strong></div>
        <div><span>Kadence</span><strong>${formatMetric(activity.averageCadence, 'rpm')}</strong></div>
        <div><span>Maks. watt</span><strong>${formatMetric(activity.maxPower, 'W')}</strong></div>
        <div><span>Maks. puls</span><strong>${formatMetric(activity.maxHeartRate, 'bpm')}</strong></div>
      </div>
      <p class="ride-notes">${activity.notes ? escapeHtml(activity.notes) : 'Ingen noter til denne tur.'}</p>
      <div class="badge-row">${badges.join('')}</div>
    </article>`;
  }).join('');
  $('#rideDots').innerHTML = activities.slice(0, 12).map(() => '<i></i>').join('');
  $('#activitiesList').innerHTML = activities.map(activity => {
    const date = new Date(`${activity.date}T12:00:00Z`);
    const day = new Intl.DateTimeFormat('da-DK', { day: '2-digit' }).format(date);
    const month = new Intl.DateTimeFormat('da-DK', { month: 'short' }).format(date).replace('.', '');
    return `<article class="activity-row"><span class="activity-date">${day}<br>${month}</span><div><strong>${formatDuration(activity.durationSeconds)} · ${formatMetric(activity.distanceKm, 'km')}</strong><small>${formatTime(activity.startTime)}${activity.notes ? ` · ${escapeHtml(activity.notes)}` : ''}</small></div><span class="activity-power">${formatMetric(activity.averagePower, 'W')}</span><b aria-hidden="true">›</b></article>`;
  }).join('');
}

function renderTrendCards(activities) {
  const hasActivities = activities.length > 0;
  $('#trendsEmpty').hidden = hasActivities;
  $('.chart-grid').hidden = !hasActivities;
  $('#trendCardsTitle').closest('section').hidden = !hasActivities;
  $('#trendCards').innerHTML = activities.length >= 2
    ? trendMarkup(activities[0], activities[1])
    : '<div><span>Seneste ændring</span><strong>Kræver mindst 2 ture</strong></div>';
}

function trendMarkup(current, previous) {
  const trends = [
    ['Watt', difference(current.averagePower, previous.averagePower, 'W')],
    ['Puls', difference(current.averageHeartRate, previous.averageHeartRate, 'bpm')],
    ['Distance', difference(current.distanceKm, previous.distanceKm, 'km', 1)],
    ['Varighed', difference(current.durationSeconds, previous.durationSeconds, 'min', 0, 60)]
  ];
  return trends.map(([label, value]) => {
    const numeric = !value.startsWith('Ikke');
    const cssClass = numeric && value.startsWith('+') ? 'positive' : numeric && value.startsWith('-') ? 'negative' : '';
    return `<div><span>${label} fra forrige</span><strong class="${cssClass}">${value}</strong></div>`;
  }).join('');
}

function setBusy(busy) {
  const button = $('#importFitButton');
  button.disabled = busy;
  button.innerHTML = busy
    ? '<span class="upload-icon" aria-hidden="true">◌</span><strong>Analyserer filen…</strong><small>Data bliver på enheden</small>'
    : '<span class="upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 18a5 5 0 0 1 .4-10A7 7 0 0 1 21 10a4 4 0 0 1-1 7.9M12 12v8m-3-5 3-3 3 3"/></svg></span><strong>Vælg en ZIP- eller FIT-fil</strong><small>Tryk for at vælge · eller slip filen her</small>';
}

function safeMin(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}
