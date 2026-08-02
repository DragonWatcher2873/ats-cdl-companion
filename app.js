const STORAGE_KEY = "ats-cdl-companion-v1";
const DAY = 24 * 60 * 60 * 1000;
const COMMUNITY_URL = "https://cdl-lisence-stats.dragonwatcher2873.workers.dev";
const COMMUNITY_SESSION_KEY = "cdl-lisence-community-session";
const AUTH_TOKEN_KEY = "cdl-lisence-auth-token";
const THEME_KEY = "cdl-lisence-theme";
const HEARTBEAT_INTERVAL = 60 * 1000;

const states = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
const stateCodes = Object.fromEntries(states.map((state, index) => [state, "AL AK AZ AR CA CO CT DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ")[index]]));
const endorsements = ["H", "N", "P", "S", "T", "X"];
const cdlClassDescriptions = {
  A: "Combination vehicles with a heavy trailer",
  B: "Heavy single vehicles with a light trailer",
  C: "Passenger or placarded hazmat vehicles"
};
const endorsementDescriptions = {
  H: "Hazardous materials",
  N: "Tank vehicles",
  P: "Passenger vehicles",
  S: "School buses",
  T: "Double/triple trailers",
  X: "Tank and hazardous materials"
};
const oklahomaPointDefaults = {
  dui: 0, controlled: 0, bac: 0, refusal: 0, hitrun: 0, felony: 0, disqualified: 0, fatality: 0, drugFelony: 0, trafficking: 0,
  speeding15: 3, reckless: 4, lane: 2, following: 2, fatalTraffic: 2, noCdl: 2, noPossession: 2, wrongClass: 2,
  texting: 2, phone: 2, railroad: 2, oos: 2, local: 1, collision: 0
};

const offenses = {
  dui: { label: "DUI / under the influence", category: "major", vehicles: "both" },
  controlled: { label: "Under influence of controlled substance", category: "major", vehicles: "both" },
  bac: { label: "BAC 0.04 or greater in a CMV", category: "major", vehicles: "cmv" },
  refusal: { label: "Refusal of required alcohol test", category: "major", vehicles: "both" },
  hitrun: { label: "Leaving the scene of an accident", category: "major", vehicles: "both" },
  felony: { label: "Using vehicle to commit a felony", category: "major", vehicles: "both" },
  disqualified: { label: "Driving CMV while disqualified", category: "major", vehicles: "cmv" },
  fatality: { label: "Negligent CMV operation causing fatality", category: "major", vehicles: "cmv" },
  drugFelony: { label: "Vehicle used in controlled-substance felony", category: "permanent", vehicles: "both" },
  trafficking: { label: "CMV used in severe human trafficking felony", category: "permanent", vehicles: "cmv" },
  speeding15: { label: "Speeding 15 mph or more over limit", category: "serious", vehicles: "both" },
  reckless: { label: "Reckless driving", category: "serious", vehicles: "both" },
  lane: { label: "Improper or erratic lane change", category: "serious", vehicles: "both" },
  following: { label: "Following too closely", category: "serious", vehicles: "both" },
  fatalTraffic: { label: "Traffic violation tied to fatal accident", category: "serious", vehicles: "both" },
  noCdl: { label: "Operating CMV without a CDL", category: "serious", vehicles: "cmv" },
  noPossession: { label: "CDL not in possession", category: "serious", vehicles: "cmv" },
  wrongClass: { label: "Wrong CDL class or endorsement", category: "serious", vehicles: "cmv" },
  texting: { label: "Texting while driving a CMV", category: "serious", vehicles: "cmv" },
  phone: { label: "Handheld phone use in a CMV", category: "serious", vehicles: "cmv" },
  railroad: { label: "Railroad-highway crossing violation", category: "railroad", vehicles: "cmv" },
  oos: { label: "Violating an out-of-service order", category: "oos", vehicles: "cmv" },
  collision: { label: "Traffic collision report", category: "local", vehicles: "both" },
  local: { label: "State/local moving violation (custom)", category: "local", vehicles: "both" }
};

const defaultState = {
  profile: { driverName: "New Driver", driverPhoto: "", homeState: "Oklahoma", cdlClass: "A", endorsements: [], medicalExpiry: "", cash: 100000, defensiveCourseDate: "", oklahomaPriorPointSuspensions: 0, strictMode: true },
  gameDate: localDateValue(),
  localDateMode: true,
  incidents: [],
  reviewedCollisions: [],
  fuelPurchases: [],
  fuelStations: [],
  cargoJobs: []
};

let data = loadData();
let recordFilter = "all";
let pendingCollision = null;
let lastHeartbeatAt = 0;
let account = null;
let cloudRevision = 0;
let cloudReady = false;
let pendingCloudRecord = null;
let cloudSaveTimer = null;
let cloudStatus = { message: "Not signed in", type: "" };
const TELEMETRY_URL = "http://127.0.0.1:38211/status";
const games = {
  ats: { id: "ats", short: "ATS" },
  eut2: { id: "eut2", short: "ETS2" }
};

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return structuredClone(defaultState);
    const record = { ...structuredClone(defaultState), ...saved, profile: { ...defaultState.profile, ...saved.profile } };
    return migrateLegacyUtcDate(record, saved);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  scheduleCloudSave();
}

function authToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function authHeaders(includeJson = false) {
  const headers = {};
  if (authToken()) headers.Authorization = `Bearer ${authToken()}`;
  if (includeJson) headers["Content-Type"] = "application/json";
  return headers;
}

function consumeAuthRedirect() {
  if (!location.hash.startsWith("#auth_")) return "";
  const values = new URLSearchParams(location.hash.slice(1));
  const token = values.get("auth_token");
  const error = values.get("auth_error");
  if (/^[a-f0-9]{64}$/i.test(token || "")) localStorage.setItem(AUTH_TOKEN_KEY, token);
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return error || (token ? "Signed in. Checking your cloud record." : "Sign-in did not complete.");
}

function normalizedRecord(record) {
  const normalized = {
    ...structuredClone(defaultState),
    ...record,
    profile: { ...defaultState.profile, ...(record?.profile || {}) },
    incidents: Array.isArray(record?.incidents) ? record.incidents : [],
    reviewedCollisions: Array.isArray(record?.reviewedCollisions) ? record.reviewedCollisions : [],
    fuelPurchases: Array.isArray(record?.fuelPurchases) ? record.fuelPurchases : [],
    fuelStations: Array.isArray(record?.fuelStations) ? record.fuelStations : [],
    cargoJobs: Array.isArray(record?.cargoJobs) ? record.cargoJobs : []
  };
  return migrateLegacyUtcDate(normalized, record);
}

function browserRecordIsBlank() {
  const profileMatches = JSON.stringify(data.profile) === JSON.stringify(defaultState.profile);
  return profileMatches && !data.incidents.length && !(data.reviewedCollisions || []).length
    && !(data.fuelPurchases || []).length && !(data.fuelStations || []).length && !(data.cargoJobs || []).length;
}

function setCloudStatus(message, type = "") {
  cloudStatus = { message, type };
  const status = document.querySelector("#syncStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `sync-status ${type}`.trim();
}

function renderAccount() {
  const button = document.querySelector("#accountButton");
  const identities = account?.identities || [];
  const primaryIdentity = identities[0];
  const displayName = primaryIdentity?.display_name || "Sign in";
  button.classList.toggle("signed-in", Boolean(account));
  button.title = account ? `Signed in as ${displayName}` : "Open companion account";
  document.querySelector("#accountButtonLabel").textContent = displayName;
  document.querySelector("#accountHeading").textContent = account
    ? `Signed in as ${displayName}`
    : "Sign in to sync this record";
  document.querySelector("#accountMessage").textContent = account
    ? "Your companion record can sync between browsers. Link the other provider below to use either login for this same account."
    : "Choose Discord or Steam. Login identifies your companion account; CDL Lisence still reads game activity through the installed local plugin.";
  const linked = new Set(identities.map(identity => identity.provider));
  const providers = [
    { id: "discord", icon: "message-circle", title: account ? "Link Discord" : "Continue with Discord", detail: "Uses your Discord identity" },
    { id: "steam", icon: "gamepad-2", title: account ? "Link Steam" : "Sign in through Steam", detail: "Uses your verified SteamID" }
  ];
  const available = providers.filter(provider => !linked.has(provider.id));
  const providerActions = document.querySelector("#providerActions");
  providerActions.classList.toggle("hidden", account && available.length === 0);
  providerActions.innerHTML = available.map(provider => `<button class="provider-button ${provider.id}-provider" type="button" data-auth-provider="${provider.id}"><i data-lucide="${provider.icon}"></i><span><strong>${provider.title}</strong><small>${provider.detail}</small></span></button>`).join("");
  const identityList = document.querySelector("#identityList");
  identityList.classList.toggle("hidden", !account);
  identityList.innerHTML = identities.map(identity => `<div class="identity-row"><i data-lucide="${identity.provider === "discord" ? "message-circle" : "gamepad-2"}"></i><span><strong>${escapeHtml(identity.display_name)}</strong><small>${escapeHtml(identity.provider)}</small></span><span>Linked</span></div>`).join("");
  document.querySelector("#accountDialogActions").classList.toggle("hidden", !account);
  document.querySelector("#syncConflict").classList.toggle("hidden", !pendingCloudRecord);
  setCloudStatus(cloudStatus.message, cloudStatus.type);
  if (window.lucide) lucide.createIcons({ nodes: [button, providerActions, identityList, document.querySelector("#accountDialogActions")] });
}

async function startLogin(provider) {
  setCloudStatus(`Opening ${provider === "discord" ? "Discord" : "Steam"}...`);
  try {
    const response = await fetch(`${COMMUNITY_URL}/auth/${provider}/start`, {
      method: "POST",
      headers: authHeaders()
    });
    const result = await response.json();
    if (!response.ok || !result.authorizeUrl) throw new Error(result.error || "Sign-in is unavailable");
    location.assign(result.authorizeUrl);
  } catch (error) {
    setCloudStatus(error.message || "Sign-in is unavailable", "error");
  }
}

async function loadAccount() {
  if (!authToken()) {
    account = null;
    cloudReady = false;
    setCloudStatus("Not signed in");
    renderAccount();
    return;
  }
  setCloudStatus("Checking account...");
  try {
    const response = await fetch(`${COMMUNITY_URL}/auth/session`, { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) throw new Error("Session expired");
    account = await response.json();
    renderAccount();
    await reconcileCloudRecord();
  } catch {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    account = null;
    cloudReady = false;
    setCloudStatus("Session expired. Sign in again.", "error");
    renderAccount();
  }
}

async function reconcileCloudRecord() {
  setCloudStatus("Checking cloud record...");
  try {
    const response = await fetch(`${COMMUNITY_URL}/record`, { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) throw new Error("Cloud record could not be loaded");
    const cloud = await response.json();
    cloudRevision = Number(cloud.revision || 0);
    if (!cloud.record) {
      cloudReady = true;
      await uploadCloudRecord();
      return;
    }
    const cloudRecord = normalizedRecord(cloud.record);
    if (JSON.stringify(cloudRecord) === JSON.stringify(normalizedRecord(data))) {
      cloudReady = true;
      setCloudStatus("Cloud record is up to date", "synced");
      return;
    }
    if (browserRecordIsBlank()) {
      applyCloudRecord(cloudRecord);
      return;
    }
    pendingCloudRecord = cloudRecord;
    cloudReady = false;
    setCloudStatus("Cloud and browser records differ. Choose which one to keep.", "error");
    renderAccount();
    document.querySelector("#accountDialog").showModal();
  } catch (error) {
    cloudReady = false;
    setCloudStatus(error.message || "Cloud sync is unavailable", "error");
  }
}

function applyCloudRecord(record) {
  data = normalizedRecord(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  document.querySelector("#gameDateInput").value = data.gameDate;
  pendingCloudRecord = null;
  cloudReady = true;
  render();
  renderAccount();
  setCloudStatus("Cloud record loaded", "synced");
  showToast("Cloud companion record loaded.");
}

async function uploadCloudRecord() {
  if (!account || !cloudReady || pendingCloudRecord) return;
  setCloudStatus("Syncing companion record...");
  try {
    const response = await fetch(`${COMMUNITY_URL}/record`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({ revision: cloudRevision, record: data })
    });
    const result = await response.json();
    if (response.status === 409) {
      cloudReady = false;
      await reconcileCloudRecord();
      return;
    }
    if (!response.ok) throw new Error(result.error || "Cloud sync failed");
    cloudRevision = Number(result.revision);
    setCloudStatus("Synced to cloud", "synced");
  } catch (error) {
    setCloudStatus(error.message || "Cloud sync failed", "error");
  }
}

function scheduleCloudSave() {
  if (!account || !cloudReady || pendingCloudRecord) return;
  clearTimeout(cloudSaveTimer);
  setCloudStatus("Changes waiting to sync...");
  cloudSaveTimer = setTimeout(uploadCloudRecord, 1200);
}

async function logoutAccount() {
  try {
    await fetch(`${COMMUNITY_URL}/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch {}
  localStorage.removeItem(AUTH_TOKEN_KEY);
  account = null;
  cloudReady = false;
  cloudRevision = 0;
  pendingCloudRecord = null;
  setCloudStatus("Signed out. Browser record remains local.");
  renderAccount();
  showToast("Signed out; this browser record was kept.");
}

function preferredTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const button = document.querySelector("#themeButton");
  if (!button) return;
  const nextTheme = isDark ? "light" : "dark";
  const label = `Switch to ${nextTheme} mode`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(isDark));
  button.innerHTML = `<i data-lucide="${isDark ? "sun" : "moon"}"></i>`;
  if (window.lucide) lucide.createIcons({ nodes: [button] });
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

function hasFuelCoordinates(item) {
  return Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z)) && (Number(item.x) !== 0 || Number(item.z) !== 0);
}

function nearestFuelStation(x, z, gameId = "", maximumDistance = 150) {
  let nearest = null;
  let nearestDistance = maximumDistance;
  for (const station of data.fuelStations || []) {
    if (station.game && gameId && station.game !== gameId) continue;
    const distance = Math.hypot(Number(station.x) - Number(x), Number(station.z) - Number(z));
    if (distance <= nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function detectedFuelStopName(item) {
  if (!hasFuelCoordinates(item)) return "Fuel stop";
  return `Fuel stop near ${Math.round(Number(item.x))}, ${Math.round(Number(item.z))}`;
}

const telemetryOffenceMap = {
  crash: { label: "crash fine", points: 3 },
  wrong_way: { label: "wrong-way fine", points: 2 },
  speeding: { label: "speeding fine", points: 2 },
  speeding_camera: { label: "speed-camera fine", points: 2 },
  red_signal: { label: "red-signal fine", points: 2 },
  no_lights: { label: "no-lights fine", points: 1 },
  avoid_weighing: { label: "weigh-station fine", points: 2 },
  avoid_inspection: { label: "inspection fine", points: 2 },
  illegal_trailer: { label: "illegal-trailer fine", points: 2 },
  hard_shoulder_violation: { label: "shoulder-use fine", points: 2 },
  damaged_vehicle_usage: { label: "unsafe-vehicle fine", points: 2 },
  avoid_sleeping: { label: "hours-of-service fine", points: 1 }
};

function communitySessionId() {
  let sessionId = sessionStorage.getItem(COMMUNITY_SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(COMMUNITY_SESSION_KEY, sessionId);
  }
  return sessionId;
}

async function syncCommunityStats() {
  try {
    const response = await fetch(`${COMMUNITY_URL}/stats`, { cache: "no-store" });
    if (!response.ok) return;
    const stats = await response.json();
    document.querySelector("#downloadCount").textContent = Number(stats.downloads || 0).toLocaleString();
    document.querySelector("#activeDriverCount").textContent = Number(stats.activeTotal || 0).toLocaleString();
    document.querySelector("#atsDriverCount").textContent = Number(stats.ats || 0).toLocaleString();
    document.querySelector("#ets2DriverCount").textContent = Number(stats.ets2 || 0).toLocaleString();
  } catch {}
}

async function sendCommunityHeartbeat(gameId) {
  if (!games[gameId] || Date.now() - lastHeartbeatAt < HEARTBEAT_INTERVAL) return;
  lastHeartbeatAt = Date.now();
  try {
    await fetch(`${COMMUNITY_URL}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: communitySessionId(), game: gameId })
    });
  } catch {}
}

async function syncTelemetry() {
  const indicator = document.querySelector("#telemetryStatus");
  try {
    const response = await fetch(TELEMETRY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Bridge unavailable");
    const telemetry = await response.json();
    const game = games[telemetry.game] || games.ats;
    if (telemetry.profileOnline) await sendCommunityHeartbeat(game.id);
    const knownIds = new Set(data.incidents.map(item => item.telemetryId).filter(Boolean));
    let imported = 0;
    for (const event of telemetry.events || []) {
      if (knownIds.has(event.id)) continue;
      const mapping = telemetryOffenceMap[event.offence] || { label: `${event.offence || "generic"} fine`, points: 1 };
      data.incidents.push({
        id: crypto.randomUUID(), telemetryId: event.id, date: data.gameDate,
        outcome: "convicted", offense: "local", vehicle: "cmv", cargo: "general",
        statePoints: mapping.points, fine: Number(event.amount || 0), finePaid: true,
        notes: `${game.short} ${mapping.label} · imported automatically by CDL Lisence`
      });
      knownIds.add(event.id);
      imported += 1;
    }
    let fuelChanged = false;
    for (const purchase of telemetry.fuelPurchases || []) {
      const existing = data.fuelPurchases.find(item => item.telemetryId === purchase.id);
      const liters = Number(purchase.liters || 0);
      const x = Number(purchase.x || 0);
      const y = Number(purchase.y || 0);
      const z = Number(purchase.z || 0);
      if (existing) {
        if (existing.liters !== liters) {
          existing.liters = liters;
          fuelChanged = true;
        }
        existing.x = x;
        existing.y = y;
        existing.z = z;
      } else {
        const station = hasFuelCoordinates({ x, z }) ? nearestFuelStation(x, z, game.id) : null;
        data.fuelPurchases.push({
          id: crypto.randomUUID(), telemetryId: purchase.id, date: data.gameDate,
          game: game.id, liters, pricePerGallon: Number(station?.pricePerGallon || 0),
          priceSource: Number(station?.pricePerGallon || 0) > 0 ? "learned" : "",
          stationName: station?.name || "", x, y, z
        });
        fuelChanged = true;
      }
    }
    let cargoChanged = false;
    for (const job of telemetry.cargoJobs || []) {
      if (data.cargoJobs.some(item => item.telemetryId === job.id)) continue;
      data.cargoJobs.push({
        id: crypto.randomUUID(), telemetryId: job.id, date: data.gameDate,
        cargo: job.cargo || "Unknown cargo", sourceCity: job.sourceCity || "Unknown city",
        sourceCompany: job.sourceCompany || "", destinationCity: job.destinationCity || "Unknown city",
        destinationCompany: job.destinationCompany || "", distanceKm: Number(job.distanceKm || 0),
        income: Number(job.income || 0)
      });
      cargoChanged = true;
    }
    const reviewed = new Set(data.reviewedCollisions || []);
    const collision = (telemetry.collisions || []).find(item => !reviewed.has(item.id));
    if (collision && !pendingCollision && !document.querySelector("dialog[open]")) {
      pendingCollision = collision;
      const percent = (Number(collision.damageDelta || 0) * 100).toFixed(1);
      document.querySelector("#collisionDetail").textContent = `${game.short} reported a sudden ${percent}% increase in vehicle damage.`;
      document.querySelector("#collisionDialog").showModal();
      if (window.lucide) lucide.createIcons();
    }
    indicator.classList.toggle("offline", !telemetry.profileOnline);
    indicator.classList.toggle("waiting", !telemetry.profileOnline);
    indicator.querySelector("span").textContent = telemetry.profileOnline
      ? `${data.profile.driverName || "Driver"} online · ${game.short}`
      : `${game.short} open · select profile`;
    if (imported || fuelChanged || cargoChanged) {
      saveData();
      render();
      if (imported) showToast(`${imported} ${game.short} incident${imported === 1 ? "" : "s"} imported automatically.`);
      else if (cargoChanged) showToast(`${game.short} cargo job added to the cargo report.`);
      else showToast(`${game.short} fill-up added to the fuel report.`);
    }
  } catch {
    indicator.classList.add("offline");
    indicator.classList.remove("waiting");
    indicator.querySelector("span").textContent = "Game offline";
  }
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function migrateLegacyUtcDate(record, source) {
  if (source?.localDateMode === true) return record;
  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10);
  const localDate = localDateValue(now);
  if (record.gameDate === utcDate && utcDate !== localDate) record.gameDate = localDate;
  record.localDateMode = true;
  return record;
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function withinYears(dateValue, referenceValue, years) {
  const date = parseDate(dateValue);
  const reference = parseDate(referenceValue);
  const boundary = new Date(reference);
  boundary.setFullYear(boundary.getFullYear() - years);
  return date >= boundary && date <= reference;
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parseDate(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function formatFuelMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function getConvictions(category, asOfDate, years = null) {
  return data.incidents
    .filter(item => item.outcome === "convicted" && offenses[item.offense]?.category === category)
    .filter(item => !years || withinYears(item.date, asOfDate, years))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateSanctions() {
  const sanctions = [];
  const convictions = data.incidents.filter(item => item.outcome === "convicted").sort((a, b) => a.date.localeCompare(b.date));
  const majorHistory = [];

  convictions.forEach(item => {
    const rule = offenses[item.offense];
    if (!rule) return;

    if (rule.category === "permanent") {
      sanctions.push({ incidentId: item.id, starts: item.date, ends: null, days: Infinity, label: "Lifetime disqualification", category: rule.category });
      return;
    }

    if (rule.category === "major") {
      majorHistory.push(item);
      const days = majorHistory.length >= 2 ? Infinity : item.cargo === "hazmat" ? 1095 : 365;
      sanctions.push({ incidentId: item.id, starts: item.date, ends: Number.isFinite(days) ? addDays(item.date, days) : null, days, label: Number.isFinite(days) ? `${days === 1095 ? 3 : 1}-year disqualification` : "Lifetime disqualification", category: rule.category });
      return;
    }

    if (rule.category === "serious") {
      const count = convictions.filter(other => other.date <= item.date && offenses[other.offense]?.category === "serious" && withinYears(other.date, item.date, 3)).length;
      const days = count >= 3 ? 120 : count === 2 ? 60 : 0;
      if (days) sanctions.push({ incidentId: item.id, starts: item.date, ends: addDays(item.date, days), days, label: `${days}-day disqualification`, category: rule.category });
      return;
    }

    if (rule.category === "railroad") {
      const count = convictions.filter(other => other.date <= item.date && offenses[other.offense]?.category === "railroad" && withinYears(other.date, item.date, 3)).length;
      const days = count >= 3 ? 365 : count === 2 ? 120 : 60;
      sanctions.push({ incidentId: item.id, starts: item.date, ends: addDays(item.date, days), days, label: `${days === 365 ? "1-year" : `${days}-day`} disqualification`, category: rule.category });
      return;
    }

    if (rule.category === "oos") {
      const history = convictions.filter(other => other.date <= item.date && offenses[other.offense]?.category === "oos" && withinYears(other.date, item.date, 10));
      const hazmatInHistory = history.some(other => other.cargo === "hazmat");
      const count = history.length;
      let days = 180;
      if (count >= 3) days = 1095;
      else if (count === 2) days = hazmatInHistory ? 1095 : 730;
      sanctions.push({ incidentId: item.id, starts: item.date, ends: addDays(item.date, days), days, label: `${days >= 365 ? `${days / 365}-year` : `${days}-day`} disqualification`, category: rule.category });
    }
  });

  return sanctions;
}

function subtractPoints(ledger, amount) {
  let remaining = amount;
  while (remaining > 0 && ledger.length) {
    const deduction = Math.min(remaining, ledger[0].points);
    ledger[0].points -= deduction;
    remaining -= deduction;
    if (ledger[0].points === 0) ledger.shift();
  }
}

function calculateOklahoma() {
  if (data.profile.homeState !== "Oklahoma") return { points: 0, sanctions: [], nextThreshold: 10 };

  const convictions = data.incidents
    .filter(item => item.outcome === "convicted" && item.date <= data.gameDate)
    .map(item => ({ ...item, points: Number(item.statePoints ?? oklahomaPointDefaults[item.offense] ?? 0) }))
    .filter(item => item.points > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ledger = [];
  const sanctions = [];
  let previousDate = null;
  let generatedSuspensions = 0;

  convictions.forEach(item => {
    const fiveYearBoundary = parseDate(item.date);
    fiveYearBoundary.setFullYear(fiveYearBoundary.getFullYear() - 5);
    while (ledger.length && parseDate(ledger[0].date) < fiveYearBoundary) ledger.shift();

    if (previousDate) {
      const cleanYears = (parseDate(item.date) - parseDate(previousDate)) / (365.25 * DAY);
      if (cleanYears >= 3) ledger.length = 0;
      else if (cleanYears >= 1) subtractPoints(ledger, 2);
    }

    ledger.push({ date: item.date, points: item.points });
    const total = ledger.reduce((sum, entry) => sum + entry.points, 0);
    if (total >= 10) {
      const sequence = Number(data.profile.oklahomaPriorPointSuspensions || 0) + generatedSuspensions;
      const days = [30, 90, 180, 365][Math.min(sequence, 3)];
      sanctions.push({ starts: item.date, ends: addDays(item.date, days), days, label: `${days}-day Oklahoma point suspension` });
      generatedSuspensions += 1;
      ledger.length = 0;
    }
    previousDate = item.date;
  });

  if (previousDate) {
    const cleanYears = (parseDate(data.gameDate) - parseDate(previousDate)) / (365.25 * DAY);
    if (cleanYears >= 3) ledger.length = 0;
    else if (cleanYears >= 1) subtractPoints(ledger, 2);
  }

  const courseDate = data.profile.defensiveCourseDate;
  if (courseDate && courseDate <= data.gameDate && (!previousDate || courseDate >= previousDate)) subtractPoints(ledger, 2);
  const points = ledger.reduce((sum, entry) => sum + entry.points, 0);
  return { points, sanctions, nextThreshold: Math.max(0, 10 - points) };
}

function getStatus() {
  const gameDate = data.gameDate;
  const sanctions = calculateSanctions();
  const active = sanctions.filter(item => item.starts <= gameDate && (!item.ends || item.ends > gameDate));
  const oklahoma = calculateOklahoma();
  const activeState = oklahoma.sanctions.filter(item => item.starts <= gameDate && item.ends > gameDate);
  const medicalExpired = data.profile.medicalExpiry && data.profile.medicalExpiry < gameDate;

  if (!data.profile.strictMode && (active.length || activeState.length)) {
    if (!active.length) {
      const latestStateEnd = activeState.map(item => item.ends).sort().at(-1);
      return { key: "warning", label: "ADVISORY", detail: `Oklahoma rules would suspend driving privileges through ${formatDate(latestStateEnd)}.`, active: activeState };
    }
    const latestEnd = active.some(item => !item.ends) ? null : active.map(item => item.ends).sort().at(-1);
    return { key: "warning", label: "ADVISORY", detail: latestEnd ? `Federal rules would prohibit CMV operation through ${formatDate(latestEnd)}.` : "Federal rules would impose a lifetime CDL disqualification.", active };
  }
  if (active.some(item => !item.ends)) return { key: "danger", label: "DISQUALIFIED", detail: "Lifetime federal CDL disqualification is active.", active };
  if (active.length) {
    const latestEnd = active.map(item => item.ends).sort().at(-1);
    return { key: "danger", label: "DISQUALIFIED", detail: `CMV operation prohibited through ${formatDate(latestEnd)}.`, active };
  }
  if (activeState.length) {
    const latestStateEnd = activeState.map(item => item.ends).sort().at(-1);
    return { key: "danger", label: "SUSPENDED", detail: `Oklahoma driving privileges suspended through ${formatDate(latestStateEnd)}.`, active: activeState };
  }
  if (medicalExpired) return { key: "warning", label: "NOT CERTIFIED", detail: `Medical certification expired ${formatDate(data.profile.medicalExpiry)}.`, active: [] };
  return { key: "valid", label: "VALID", detail: "No active federal disqualification or Oklahoma suspension.", active: [] };
}

function consequenceFor(item) {
  if (item.outcome !== "convicted") return item.outcome === "pending" ? "No sanction until conviction" : "None";
  const sanction = calculateSanctions().find(entry => entry.incidentId === item.id);
  if (sanction) return sanction.label;
  const category = offenses[item.offense]?.category;
  if (category === "serious") return "Counts toward 3-year threshold";
  if (category === "local") return `${Number(item.statePoints ?? oklahomaPointDefaults[item.offense] ?? 0)} Oklahoma point${Number(item.statePoints ?? oklahomaPointDefaults[item.offense] ?? 0) === 1 ? "" : "s"}`;
  return "Recorded conviction";
}

function render() {
  renderDashboard();
  renderRecord();
  renderFuel();
  renderCargo();
  renderProfile();
  renderRules();
  if (window.lucide) lucide.createIcons();
}

function renderCargo() {
  const jobs = [...(data.cargoJobs || [])].sort((a, b) => b.date.localeCompare(a.date));
  const totalMiles = jobs.reduce((sum, item) => sum + Number(item.distanceKm || 0) * 0.621371, 0);
  const totalValue = jobs.reduce((sum, item) => sum + Number(item.income || 0), 0);
  document.querySelector("#cargoJobCount").textContent = jobs.length;
  document.querySelector("#cargoMileTotal").textContent = Math.round(totalMiles).toLocaleString();
  document.querySelector("#cargoValueTotal").textContent = formatMoney(totalValue);
  document.querySelector("#cargoAverageMiles").textContent = `${jobs.length ? Math.round(totalMiles / jobs.length).toLocaleString() : 0} mi`;
  document.querySelector("#cargoTableBody").innerHTML = jobs.map(item => {
    const miles = Number(item.distanceKm || 0) * 0.621371;
    return `<tr>
      <td>${formatDate(item.date)}</td>
      <td><strong class="cargo-route">${escapeHtml(item.sourceCity || "Unknown city")}</strong><small>${escapeHtml(item.sourceCompany || "Company unavailable")}</small></td>
      <td><strong class="cargo-route">${escapeHtml(item.destinationCity || "Unknown city")}</strong><small>${escapeHtml(item.destinationCompany || "Company unavailable")}</small></td>
      <td><strong>${escapeHtml(item.cargo || "Unknown cargo")}</strong></td>
      <td><strong>${Math.round(miles).toLocaleString()} mi</strong><small>${Number(item.distanceKm || 0).toLocaleString()} km planned</small></td>
      <td><strong class="fuel-amount">${formatMoney(item.income)}</strong><small>Expected payout</small></td>
      <td><div class="row-actions"><button data-delete-cargo="${escapeAttribute(item.id)}" title="Delete cargo job" aria-label="Delete cargo job"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`;
  }).join("");
  document.querySelector("#cargoEmpty").classList.toggle("hidden", jobs.length > 0);
}

function renderFuel() {
  const purchases = [...(data.fuelPurchases || [])].sort((a, b) => b.date.localeCompare(a.date));
  const totalGallons = purchases.reduce((sum, item) => sum + Number(item.liters || 0) * 0.264172, 0);
  const totalSpent = purchases.reduce((sum, item) => sum + Number(item.liters || 0) * 0.264172 * Number(item.pricePerGallon || 0), 0);
  const pricedGallons = purchases.filter(item => Number(item.pricePerGallon) > 0).reduce((sum, item) => sum + Number(item.liters || 0) * 0.264172, 0);
  document.querySelector("#fuelStopCount").textContent = purchases.length;
  document.querySelector("#fuelGallonTotal").textContent = totalGallons.toFixed(1);
  document.querySelector("#fuelSpentTotal").textContent = formatFuelMoney(totalSpent);
  document.querySelector("#fuelAveragePrice").textContent = pricedGallons ? `$${(totalSpent / pricedGallons).toFixed(2)}` : "$0.00";
  const stationNames = [...new Set((data.fuelStations || []).map(item => item.name).filter(Boolean))].sort();
  document.querySelector("#fuelStationOptions").innerHTML = stationNames.map(name => `<option value="${escapeAttribute(name)}"></option>`).join("");
  document.querySelector("#fuelTableBody").innerHTML = purchases.map(item => {
    const gallons = Number(item.liters || 0) * 0.264172;
    const spent = gallons * Number(item.pricePerGallon || 0);
    return `<tr>
      <td>${formatDate(item.date)}</td>
      <td><label><span class="sr-only">Station name</span><input class="station-input" type="text" maxlength="80" list="fuelStationOptions" value="${escapeAttribute(item.stationName || "")}" placeholder="${escapeAttribute(detectedFuelStopName(item))}" data-fuel-station="${escapeAttribute(item.id)}" aria-label="Station name"></label><small>${item.stationName ? "Automatically recognized on return" : hasFuelCoordinates(item) ? "Location detected automatically · name optional" : "Location unavailable for this older fill"}</small></td>
      <td><strong class="fuel-amount">${gallons.toFixed(2)} gal</strong><small>${Number(item.liters || 0).toFixed(1)} liters detected</small></td>
      <td><label><span class="sr-only">Price per gallon</span><input type="number" min="0" step="0.001" value="${Number(item.pricePerGallon || 0).toFixed(3)}" data-fuel-price="${escapeAttribute(item.id)}" aria-label="Price per gallon"></label><small>${item.priceSource === "learned" ? "Last known at this location" : "Optional"}</small></td>
      <td><strong class="fuel-amount">${formatFuelMoney(spent)}</strong></td>
      <td><div class="row-actions"><button data-delete-fuel="${escapeAttribute(item.id)}" title="Delete fill-up" aria-label="Delete fill-up"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`;
  }).join("");
  document.querySelector("#fuelEmpty").classList.toggle("hidden", purchases.length > 0);
}

function renderDashboard() {
  const status = getStatus();
  const statusBand = document.querySelector("#statusBand");
  statusBand.className = `status-band ${status.key === "valid" ? "" : status.key}`;
  statusBand.querySelector(".status-seal").innerHTML = `<i data-lucide="${status.key === "valid" ? "shield-check" : status.key === "warning" ? "shield-alert" : "shield-x"}"></i>`;
  document.querySelector("#licenseStatus").textContent = status.label;
  document.querySelector("#statusDetail").textContent = status.detail;
  document.querySelector("#summaryDriver").textContent = data.profile.driverName || "New Driver";
  document.querySelector("#summaryLicense").textContent = `Class ${data.profile.cdlClass}${data.profile.endorsements.length ? ` · ${data.profile.endorsements.join("")}` : ""}`;
  document.querySelector("#summaryMedical").textContent = data.profile.medicalExpiry ? formatDate(data.profile.medicalExpiry) : "Not set";

  const convictions = data.incidents.filter(item => item.outcome === "convicted");
  const serious = getConvictions("serious", data.gameDate, 3);
  const oklahoma = calculateOklahoma();
  const unpaid = data.incidents.filter(item => !item.finePaid).reduce((total, item) => total + Number(item.fine || 0), 0);
  document.querySelector("#convictionCount").textContent = convictions.length;
  document.querySelector("#seriousCount").textContent = serious.length;
  document.querySelector("#statePointCount").textContent = oklahoma.points;
  document.querySelector("#fineTotal").textContent = formatMoney(unpaid);

  const recent = [...data.incidents].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  document.querySelector("#recentRecord").innerHTML = recent.length ? recent.map(item => {
    const outcome = ["pending", "convicted", "dismissed"].includes(item.outcome) ? item.outcome : "pending";
    return `
    <article class="record-item">
      <span class="record-icon"><i data-lucide="${offenses[item.offense]?.category === "major" || offenses[item.offense]?.category === "permanent" ? "triangle-alert" : "file-text"}"></i></span>
      <div><strong>${escapeHtml(offenses[item.offense]?.label || "Unknown incident")}</strong><small>${formatDate(item.date)} · ${capitalize(offenses[item.offense]?.category || "custom")}</small></div>
      <span class="badge ${outcome}">${outcome}</span>
    </article>`;
  }).join("") : `<div class="empty-state"><i data-lucide="route"></i><strong>Clean record</strong><small>Log an incident to begin the simulation.</small></div>`;

  const watches = [];
  if (serious.length === 1) watches.push({ icon: "gauge", title: "Serious violation threshold", text: "One more conviction within the rolling 3-year window triggers a 60-day disqualification." });
  if (serious.length === 2) watches.push({ icon: "gauge", title: "Third serious violation", text: "Another conviction in the rolling 3-year window raises the disqualification to 120 days." });
  if (!data.profile.medicalExpiry) watches.push({ icon: "stethoscope", title: "Medical certificate not set", text: "Add an expiry date to simulate medical qualification status." });
  else {
    const daysLeft = Math.ceil((parseDate(data.profile.medicalExpiry) - parseDate(data.gameDate)) / DAY);
    if (daysLeft >= 0 && daysLeft <= 30) watches.push({ icon: "stethoscope", title: "Medical renewal due", text: `${daysLeft} game day${daysLeft === 1 ? "" : "s"} remain before the certificate expires.` });
  }
  if (!watches.length) watches.push({ icon: "circle-check", title: "No immediate thresholds", text: "The active record does not show a pending federal CDL trigger." });
  if (data.profile.homeState === "Oklahoma") {
    watches.push({ icon: "map", title: "Oklahoma point cycle", text: `${oklahoma.points} active point${oklahoma.points === 1 ? "" : "s"}; ${oklahoma.nextThreshold} more until state suspension review.` });
  } else {
    watches.push({ icon: "map", title: "Oklahoma pack inactive", text: "Select Oklahoma as the home state to apply its point and suspension rules." });
  }
  document.querySelector("#complianceWatch").innerHTML = watches.map(item => `<div class="watch-item"><i data-lucide="${item.icon}"></i><div><strong>${item.title}</strong><small>${item.text}</small></div></div>`).join("");
}

function renderRecord() {
  const incidents = [...data.incidents]
    .filter(item => recordFilter === "all" || item.outcome === recordFilter)
    .sort((a, b) => b.date.localeCompare(a.date));
  const body = document.querySelector("#recordTableBody");
  body.innerHTML = incidents.map(item => {
    const outcome = ["pending", "convicted", "dismissed"].includes(item.outcome) ? item.outcome : "pending";
    const itemId = escapeAttribute(item.id);
    return `
    <tr>
      <td>${formatDate(item.date)}</td>
      <td><strong>${escapeHtml(offenses[item.offense]?.label || "Unknown")}</strong><small>${escapeHtml(item.notes || (item.vehicle === "cmv" ? "Commercial vehicle" : "Personal vehicle"))}</small></td>
      <td>${capitalize(offenses[item.offense]?.category || "local")}<small>${Number(item.statePoints ?? oklahomaPointDefaults[item.offense] ?? 0)} OK pts</small></td>
      <td><span class="badge ${outcome}">${outcome}</span></td>
      <td><strong>${consequenceFor(item)}</strong><small>${Number(item.fine) ? `${formatMoney(item.fine)} · ${item.finePaid ? "paid" : "unpaid"}` : "No gameplay fine"}</small></td>
      <td><div class="row-actions">${Number(item.fine) > 0 && !item.finePaid ? `<button data-pay="${itemId}" title="Pay gameplay fine" aria-label="Pay gameplay fine"><i data-lucide="circle-dollar-sign"></i></button>` : ""}<button data-delete="${itemId}" title="Delete incident" aria-label="Delete incident"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`;
  }).join("");
  document.querySelector("#recordEmpty").classList.toggle("hidden", incidents.length > 0);
}

function renderProfile() {
  const form = document.querySelector("#profileForm");
  form.elements.driverName.value = data.profile.driverName;
  form.elements.homeState.value = data.profile.homeState;
  form.elements.cdlClass.value = data.profile.cdlClass;
  form.elements.medicalExpiry.value = data.profile.medicalExpiry;
  form.elements.cash.value = data.profile.cash;
  form.elements.defensiveCourseDate.value = data.profile.defensiveCourseDate;
  form.elements.oklahomaPriorPointSuspensions.value = data.profile.oklahomaPriorPointSuspensions;
  form.elements.strictMode.checked = data.profile.strictMode;
  document.querySelectorAll("[name='endorsements']").forEach(input => { input.checked = data.profile.endorsements.includes(input.value); });
  document.querySelector("#cardState").textContent = data.profile.homeState ? stateCode(data.profile.homeState) : "USA";
  const photo = document.querySelector("#cardPhoto");
  const portraitIcon = document.querySelector("#cardPortraitIcon");
  photo.src = data.profile.driverPhoto || "";
  photo.classList.toggle("hidden", !data.profile.driverPhoto);
  portraitIcon.classList.toggle("hidden", Boolean(data.profile.driverPhoto));
  document.querySelector("#removeDriverPhoto").classList.toggle("hidden", !data.profile.driverPhoto);
  document.querySelector("#cardName").textContent = (data.profile.driverName || "New Driver").toUpperCase();
  document.querySelector("#cardClass").textContent = data.profile.cdlClass;
  document.querySelector("#cardClassDescription").textContent = cdlClassDescriptions[data.profile.cdlClass] || "Commercial motor vehicles";
  document.querySelector("#cardEndorsements").textContent = data.profile.endorsements.join(" · ") || "NONE";
  document.querySelector("#cardEndorsementDescriptions").innerHTML = data.profile.endorsements.length
    ? data.profile.endorsements.map(code => `<span><strong>${code}</strong> - ${endorsementDescriptions[code]}</span>`).join("")
    : "<span>No endorsements selected</span>";
}

function renderRules() {
  const groups = [
    { title: "Major offenses", rows: [["First conviction", "1 year"], ["First while hauling hazmat", "3 years"], ["Second major offense", "Lifetime"], ["Drug/trafficking vehicle felony", "Lifetime; no 10-year reinstatement"]] },
    { title: "Serious traffic", rows: [["One conviction", "Record only"], ["Two in separate incidents / 3 years", "60 days"], ["Three in separate incidents / 3 years", "120 days"], ["Examples", "15+ mph, reckless, texting"]] },
    { title: "Rail crossings", rows: [["First / 3 years", "At least 60 days"], ["Second / 3 years", "At least 120 days"], ["Third / 3 years", "At least 1 year"], ["Vehicle", "CMV only"]] },
    { title: "Out-of-service orders", rows: [["First", "180 days minimum"], ["Second / 10 years", "2 years minimum"], ["Second with hazmat involved", "3 years minimum"], ["Third / 10 years", "3 years minimum"]] },
    { title: "Oklahoma points", rows: [["Suspension threshold", "10 points"], ["No point violation / 12 months", "Subtract 2"], ["No point violation / 3 years", "Clear points"], ["Suspension sequence", "30 / 90 / 180 / 365 days"]] },
    { title: "Oklahoma restoration", rows: [["Point-action processing fee", "$25 each"], ["Single reinstatement fee", "$25"], ["Appeal", "District court"], ["Out-of-state convictions", "May count"]] }
  ];
  document.querySelector("#rulesGrid").innerHTML = groups.map(group => `<article class="rule-panel"><h3>${group.title}</h3><dl>${group.rows.map(row => `<div><dt>${row[0]}</dt><dd>${row[1]}</dd></div>`).join("")}</dl></article>`).join("");
}

function populateControls() {
  document.querySelector("#stateSelect").innerHTML = `<option value="">Select state</option>${states.map(state => `<option>${state}</option>`).join("")}`;
  document.querySelector("#endorsementOptions").innerHTML = endorsements.map(code => `<label class="checkbox-pill"><input type="checkbox" name="endorsements" value="${code}"><span>${code}</span></label>`).join("");
  const groups = { major: "Major offenses", permanent: "Permanent disqualifications", serious: "Serious traffic violations", railroad: "Railroad crossings", oos: "Out-of-service orders", local: "State / custom" };
  document.querySelector("#offenseSelect").innerHTML = Object.entries(groups).map(([category, label]) => `<optgroup label="${label}">${Object.entries(offenses).filter(([, rule]) => rule.category === category).map(([key, rule]) => `<option value="${key}">${rule.label}</option>`).join("")}</optgroup>`).join("");
}

function showView(view) {
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === `${view}View`));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  const titles = { dashboard: "Compliance dashboard", record: "Driver record", fuel: "Fuel report", cargo: "Cargo report", profile: "CDL profile", rules: "Rules desk", about: "About & help" };
  document.querySelector("#viewTitle").textContent = titles[view];
  document.querySelector(".sidebar").classList.remove("open");
}

function openIncidentDialog() {
  const form = document.querySelector("#incidentForm");
  form.reset();
  form.elements.date.value = data.gameDate;
  form.elements.date.max = data.gameDate;
  form.elements.statePoints.value = oklahomaPointDefaults[form.elements.offense.value] ?? 0;
  updateImpactPreview();
  document.querySelector("#incidentDialog").showModal();
}

function updateImpactPreview() {
  const form = document.querySelector("#incidentForm");
  const rule = offenses[form.elements.offense.value];
  const outcome = form.elements.outcome.value;
  form.elements.statePoints.value = oklahomaPointDefaults[form.elements.offense.value] ?? 0;
  let text = "Pending and dismissed cases do not trigger a federal disqualification.";
  if (outcome === "convicted" && rule) {
    if (rule.category === "major") text = "Major offense: generally 1 year for a first conviction, 3 years if committed while transporting placarded hazmat, and lifetime for a second major offense.";
    else if (rule.category === "permanent") text = "This conviction triggers a lifetime disqualification with no federal 10-year reinstatement route.";
    else if (rule.category === "serious") text = "This counts toward the rolling 3-year serious-violation threshold: 60 days for two and 120 days for three.";
    else if (rule.category === "railroad") text = "Railroad-crossing convictions trigger at least 60 days, 120 days, then 1 year within a 3-year period.";
    else if (rule.category === "oos") text = "An out-of-service-order conviction triggers at least 180 days; repeat violations use a 10-year lookback.";
    else text = "This custom state/local offense is recorded without an automatic federal sanction.";
  }
  const statePoints = Number(form.elements.statePoints.value || 0);
  document.querySelector("#impactPreview").textContent = `${text} Oklahoma schedule: ${statePoints} point${statePoints === 1 ? "" : "s"}.`;
}

function saveIncident(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  const rule = offenses[values.offense];
  if (rule.vehicles === "cmv" && values.vehicle !== "cmv") {
    showToast("That federal offense requires a commercial vehicle context.");
    return;
  }
  data.incidents.push({ id: crypto.randomUUID(), date: values.date, outcome: values.outcome, offense: values.offense, vehicle: values.vehicle, cargo: values.cargo, statePoints: Number(values.statePoints || 0), fine: Number(values.fine || 0), finePaid: values.finePaid === "true", notes: values.notes.trim() });
  saveData();
  document.querySelector("#incidentDialog").close();
  render();
  showToast("Incident added to the fictional driver record.");
}

function reviewCollision(hitTraffic) {
  if (!pendingCollision) return;
  data.reviewedCollisions = [...new Set([...(data.reviewedCollisions || []), pendingCollision.id])].slice(-256);
  if (hitTraffic) {
    data.incidents.push({
      id: crypto.randomUUID(), collisionId: pendingCollision.id, date: data.gameDate,
      outcome: "pending", offense: "collision", vehicle: "cmv", cargo: "general",
      statePoints: 0, fine: 0, finePaid: true,
      notes: "Traffic collision confirmed by driver · no citation recorded"
    });
  }
  saveData();
  document.querySelector("#collisionDialog").close();
  pendingCollision = null;
  render();
  showToast(hitTraffic ? "Traffic collision report added without a fine or points." : "Damage alert dismissed; nothing was added.");
}

function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  data.profile = {
    driverName: form.elements.driverName.value.trim() || "New Driver",
    driverPhoto: data.profile.driverPhoto || "",
    homeState: form.elements.homeState.value,
    cdlClass: form.elements.cdlClass.value,
    endorsements: [...document.querySelectorAll("[name='endorsements']:checked")].map(input => input.value),
    medicalExpiry: form.elements.medicalExpiry.value,
    cash: Number(form.elements.cash.value || 0),
    defensiveCourseDate: form.elements.defensiveCourseDate.value,
    oklahomaPriorPointSuspensions: Number(form.elements.oklahomaPriorPointSuspensions.value || 0),
    strictMode: form.elements.strictMode.checked
  };
  saveData();
  render();
  showToast("CDL profile saved locally.");
}

async function selectDriverPhoto(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Driver photo must be smaller than 5 MB.");
    const image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.fillStyle = "#d8e5df";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    image.close();
    data.profile.driverPhoto = canvas.toDataURL("image/jpeg", 0.82);
    saveData();
    render();
    showToast("Driver photo added to the CDL profile.");
  } catch (error) {
    showToast(error.message || "Driver photo could not be loaded.");
  }
}

function removeDriverPhoto() {
  data.profile.driverPhoto = "";
  saveData();
  render();
  showToast("Driver photo removed.");
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ats-cdl-record-${data.gameDate}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Driver record exported.");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("Record too large");
    const imported = JSON.parse(await file.text());
    if (!imported.profile || !Array.isArray(imported.incidents)) throw new Error("Invalid record");
    data = { ...structuredClone(defaultState), ...imported, profile: { ...defaultState.profile, ...imported.profile } };
    saveData();
    render();
    showToast("Driver record imported.");
  } catch {
    showToast("That file is not a valid ATS CDL record.");
  } finally {
    event.target.value = "";
  }
}

function resetData() {
  if (!confirm("Reset the fictional CDL profile and delete every incident?")) return;
  data = structuredClone(defaultState);
  saveData();
  document.querySelector("#gameDateInput").value = data.gameDate;
  render();
  showToast("Simulation reset.");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  const displayTime = Math.max(2600, Math.min(7000, message.length * 55));
  showToast.timer = setTimeout(() => toast.classList.remove("show"), displayTime);
}

function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function stateCode(state) { return stateCodes[state] || "USA"; }
function escapeHtml(value) { const element = document.createElement("div"); element.textContent = value; return element.innerHTML; }
function escapeAttribute(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }

function attachEvents() {
  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.goView)));
  document.querySelector("#menuButton").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.querySelector("#accountButton").addEventListener("click", () => {
    renderAccount();
    document.querySelector("#accountDialog").showModal();
  });
  document.querySelector("#closeAccountButton").addEventListener("click", () => document.querySelector("#accountDialog").close());
  document.querySelector("#providerActions").addEventListener("click", event => {
    const button = event.target.closest("[data-auth-provider]");
    if (button) startLogin(button.dataset.authProvider);
  });
  document.querySelector("#useCloudButton").addEventListener("click", () => {
    if (pendingCloudRecord) applyCloudRecord(pendingCloudRecord);
  });
  document.querySelector("#keepBrowserButton").addEventListener("click", async () => {
    pendingCloudRecord = null;
    cloudReady = true;
    renderAccount();
    await uploadCloudRecord();
  });
  document.querySelector("#logoutButton").addEventListener("click", logoutAccount);
  document.querySelector("#syncNowButton").addEventListener("click", async () => {
    if (cloudReady) await uploadCloudRecord();
    else await reconcileCloudRecord();
  });
  document.querySelector("#themeButton").addEventListener("click", toggleTheme);
  document.querySelector("#openIncidentButton").addEventListener("click", openIncidentDialog);
  document.querySelectorAll("[data-close-incident]").forEach(button => button.addEventListener("click", () => document.querySelector("#incidentDialog").close()));
  document.querySelector("#incidentForm").addEventListener("submit", saveIncident);
  document.querySelector("#confirmCollisionButton").addEventListener("click", () => reviewCollision(true));
  document.querySelector("#dismissCollisionButton").addEventListener("click", () => reviewCollision(false));
  document.querySelector("#offenseSelect").addEventListener("change", updateImpactPreview);
  document.querySelector("#incidentForm [name='outcome']").addEventListener("change", updateImpactPreview);
  document.querySelector("#profileForm").addEventListener("submit", saveProfile);
  document.querySelector("#driverPhotoInput").addEventListener("change", selectDriverPhoto);
  document.querySelector("#removeDriverPhoto").addEventListener("click", removeDriverPhoto);
  document.querySelector("#exportButton").addEventListener("click", exportData);
  document.querySelector("#importInput").addEventListener("change", importData);
  document.querySelector("#resetButton").addEventListener("click", resetData);
  document.querySelector("#gameDateInput").addEventListener("change", event => { data.gameDate = event.target.value; saveData(); render(); });
  document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
    recordFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach(item => item.classList.toggle("active", item === button));
    renderRecord();
    if (window.lucide) lucide.createIcons();
  }));
  document.querySelector("#recordTableBody").addEventListener("click", event => {
    const payButton = event.target.closest("[data-pay]");
    if (payButton) {
      const incident = data.incidents.find(item => item.id === payButton.dataset.pay);
      if (!incident) return;
      if (data.profile.cash < incident.fine) {
        showToast(`Insufficient gameplay cash. Available: ${formatMoney(data.profile.cash)}.`);
        return;
      }
      data.profile.cash -= incident.fine;
      incident.finePaid = true;
      saveData();
      render();
      showToast(`${formatMoney(incident.fine)} gameplay fine paid.`);
      return;
    }
    const deleteButton = event.target.closest("[data-delete]");
    if (!deleteButton || !confirm("Delete this incident from the fictional record?")) return;
    data.incidents = data.incidents.filter(item => item.id !== deleteButton.dataset.delete);
    saveData();
    render();
    showToast("Incident deleted.");
  });
  document.querySelector("#fuelTableBody").addEventListener("change", event => {
    const stationInput = event.target.closest("[data-fuel-station]");
    if (stationInput) {
      const purchase = data.fuelPurchases.find(item => item.id === stationInput.dataset.fuelStation);
      if (!purchase) return;
      const name = stationInput.value.trim();
      purchase.stationName = name;
      if (name && hasFuelCoordinates(purchase)) {
        const station = nearestFuelStation(purchase.x, purchase.z, purchase.game);
        if (station) station.name = name;
        else data.fuelStations.push({
          id: crypto.randomUUID(), game: purchase.game || "", name,
          pricePerGallon: Number(purchase.pricePerGallon || 0), x: purchase.x, y: purchase.y, z: purchase.z
        });
      }
      saveData();
      render();
      showToast(name ? "Station saved and will be recognized next time." : "Station name cleared.");
      return;
    }
    const input = event.target.closest("[data-fuel-price]");
    if (!input) return;
    const purchase = data.fuelPurchases.find(item => item.id === input.dataset.fuelPrice);
    if (!purchase) return;
    purchase.pricePerGallon = Math.max(0, Number(input.value || 0));
    purchase.priceSource = purchase.pricePerGallon > 0 ? "entered" : "";
    if (hasFuelCoordinates(purchase)) {
      const station = nearestFuelStation(purchase.x, purchase.z, purchase.game);
      if (station) station.pricePerGallon = purchase.pricePerGallon;
      else data.fuelStations.push({
        id: crypto.randomUUID(), game: purchase.game || "", name: purchase.stationName || "",
        pricePerGallon: purchase.pricePerGallon, x: purchase.x, y: purchase.y, z: purchase.z
      });
    }
    saveData();
    render();
    showToast("Fuel cost updated.");
  });
  document.querySelector("#fuelTableBody").addEventListener("click", event => {
    const button = event.target.closest("[data-delete-fuel]");
    if (!button || !confirm("Delete this fill-up from the fuel report?")) return;
    data.fuelPurchases = data.fuelPurchases.filter(item => item.id !== button.dataset.deleteFuel);
    saveData();
    render();
    showToast("Fill-up deleted.");
  });
  document.querySelector("#cargoTableBody").addEventListener("click", event => {
    const button = event.target.closest("[data-delete-cargo]");
    if (!button || !confirm("Delete this cargo job from the report?")) return;
    data.cargoJobs = data.cargoJobs.filter(item => item.id !== button.dataset.deleteCargo);
    saveData();
    render();
    showToast("Cargo job deleted.");
  });
}

applyTheme(preferredTheme());
populateControls();
attachEvents();
document.querySelector("#gameDateInput").value = data.gameDate;
render();
const authRedirectMessage = consumeAuthRedirect();
renderAccount();
loadAccount();
if (authRedirectMessage) showToast(authRedirectMessage);
syncTelemetry();
syncCommunityStats();
setInterval(syncTelemetry, 3000);
setInterval(syncCommunityStats, 30000);