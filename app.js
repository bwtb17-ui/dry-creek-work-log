\
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
const state = {
  supabase: null,
  workers: [],
  visits: [],
  selectedWorker: localStorage.getItem("dc_worker") || "",
  activeVisitId: Number(localStorage.getItem("dc_active_visit_id")) || null,
  elapsedTimer: null
};

const configured = SUPABASE_URL.startsWith("https://") &&
  SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

function showToast(message, ms = 3000) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("toast").classList.add("hidden"), ms);
}

function setConnection(text, mode = "") {
  const badge = $("connectionBadge");
  badge.textContent = text;
  badge.className = `badge ${mode}`.trim();
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function minutesBetween(start, end = new Date()) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hrs) return `${mins} min`;
  return `${hrs} hr ${mins} min`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);
}

async function init() {
  if (!configured) {
    $("setupCard").classList.remove("hidden");
    setConnection("Setup needed", "error");
    disableButtons();
    return;
  }

  state.supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  try {
    await Promise.all([loadWorkers(), loadVisits()]);
    setConnection("Shared database ready", "ready");
    renderAll();
  } catch (error) {
    console.error(error);
    setConnection("Database error", "error");
    showToast(error.message || "Unable to connect to Supabase", 6000);
  }

  $("saveWorkerBtn").addEventListener("click", saveWorker);
  $("changeWorkerBtn").addEventListener("click", changeWorker);
  $("startVisitBtn").addEventListener("click", startVisit);
  $("finishVisitBtn").addEventListener("click", finishVisit);
  $("refreshBtn").addEventListener("click", refreshData);
  $("exportBtn").addEventListener("click", exportCsv);
  $("searchInput").addEventListener("input", renderHistory);
  $("workerFilter").addEventListener("change", renderHistory);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
}

function disableButtons() {
  ["saveWorkerBtn", "startVisitBtn", "finishVisitBtn", "refreshBtn", "exportBtn"]
    .forEach(id => $(id).disabled = true);
}

async function loadWorkers() {
  const { data, error } = await state.supabase
    .from("workers")
    .select("id,name")
    .order("name", { ascending: true });
  if (error) throw error;
  state.workers = data || [];
}

async function loadVisits() {
  const { data, error } = await state.supabase
    .from("visits")
    .select("*")
    .order("arrival", { ascending: false })
    .limit(500);
  if (error) throw error;
  state.visits = data || [];

  if (state.activeVisitId && !state.visits.some(v => v.id === state.activeVisitId && !v.departure)) {
    state.activeVisitId = null;
    localStorage.removeItem("dc_active_visit_id");
  }
}

async function refreshData() {
  setConnection("Refreshing…");
  try {
    await Promise.all([loadWorkers(), loadVisits()]);
    renderAll();
    setConnection("Shared database ready", "ready");
    showToast("Shared log refreshed");
  } catch (error) {
    setConnection("Refresh failed", "error");
    showToast(error.message, 5000);
  }
}

function renderAll() {
  renderWorkerControls();
  renderOnSite();
  renderActiveVisit();
  renderStats();
  renderHistory();
}

function renderWorkerControls() {
  const options = ['<option value="">Choose a worker…</option>']
    .concat(state.workers.map(w => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`))
    .join("");
  $("workerSelect").innerHTML = options;
  $("workerFilter").innerHTML = '<option value="">All workers</option>' +
    state.workers.map(w => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join("");

  if (state.selectedWorker && state.workers.some(w => w.name === state.selectedWorker)) {
    $("workerPicker").classList.add("hidden");
    $("selectedWorker").classList.remove("hidden");
    $("changeWorkerBtn").classList.remove("hidden");
    $("selectedWorkerName").textContent = state.selectedWorker;
  } else {
    state.selectedWorker = "";
    localStorage.removeItem("dc_worker");
    $("workerPicker").classList.remove("hidden");
    $("selectedWorker").classList.add("hidden");
    $("changeWorkerBtn").classList.add("hidden");
  }
}

function saveWorker() {
  const value = $("workerSelect").value;
  if (!value) return showToast("Select your name first");
  state.selectedWorker = value;
  localStorage.setItem("dc_worker", value);
  renderWorkerControls();
  renderActiveVisit();
}

function changeWorker() {
  if (state.activeVisitId) return showToast("Finish your active visit before changing workers");
  state.selectedWorker = "";
  localStorage.removeItem("dc_worker");
  renderWorkerControls();
}

function renderOnSite() {
  const active = state.visits.filter(v => !v.departure);
  $("statOnSite").textContent = active.length;
  $("onSiteList").innerHTML = active.length ? active.map(v => `
    <div class="on-site-item">
      <div>
        <div class="item-title"><span class="status-dot"></span>${escapeHtml(v.worker || "Unknown")}</div>
        <div class="item-meta">Arrived ${formatDateTime(v.arrival)} · Crew ${v.crew_size || 1}</div>
      </div>
      <strong>${formatDuration(minutesBetween(v.arrival))}</strong>
    </div>
  `).join("") : '<p class="empty">No one is currently checked in.</p>';
}

function activeVisit() {
  return state.visits.find(v => v.id === state.activeVisitId && !v.departure) || null;
}

function renderActiveVisit() {
  const visit = activeVisit();
  if (!visit) {
    $("activeCard").classList.add("hidden");
    $("startCard").classList.remove("hidden");
    stopElapsedTimer();
    return;
  }

  $("startCard").classList.add("hidden");
  $("activeCard").classList.remove("hidden");
  $("activeWorker").textContent = visit.worker;
  $("activeArrival").textContent = formatDateTime(visit.arrival);
  $("crewSizeFinish").value = String(Math.min(5, visit.crew_size || 1));
  $("equipmentFinish").value = visit.equipment || "";
  $("notesFinish").value = visit.notes || "";
  updateElapsed(visit);
  stopElapsedTimer();
  state.elapsedTimer = setInterval(() => updateElapsed(visit), 30000);
}

function updateElapsed(visit) {
  $("elapsedTime").textContent = formatDuration(minutesBetween(visit.arrival));
}

function stopElapsedTimer() {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

async function startVisit() {
  if (!state.selectedWorker) return showToast("Select your worker name first");
  if (state.activeVisitId) return showToast("This device already has an active visit");

  const payload = {
    worker: state.selectedWorker,
    arrival: new Date().toISOString(),
    departure: null,
    duration_minutes: null,
    crew_size: Number($("crewSizeStart").value || 1),
    equipment: $("equipmentStart").value.trim() || null,
    notes: $("notesStart").value.trim() || null,
    photo_urls: null
  };

  $("startVisitBtn").disabled = true;
  try {
    const { data, error } = await state.supabase
      .from("visits")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    state.activeVisitId = data.id;
    localStorage.setItem("dc_active_visit_id", String(data.id));
    $("notesStart").value = "";
    $("equipmentStart").value = "";
    await loadVisits();
    renderAll();
    showToast("Visit started");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to start visit", 6000);
  } finally {
    $("startVisitBtn").disabled = false;
  }
}

async function finishVisit() {
  const visit = activeVisit();
  if (!visit) return showToast("No active visit was found");

  const departure = new Date();
  const payload = {
    departure: departure.toISOString(),
    duration_minutes: minutesBetween(visit.arrival, departure),
    crew_size: Number($("crewSizeFinish").value || 1),
    equipment: $("equipmentFinish").value.trim() || null,
    notes: $("notesFinish").value.trim() || null
  };

  $("finishVisitBtn").disabled = true;
  try {
    const { error } = await state.supabase
      .from("visits")
      .update(payload)
      .eq("id", visit.id);
    if (error) throw error;

    state.activeVisitId = null;
    localStorage.removeItem("dc_active_visit_id");
    await loadVisits();
    renderAll();
    showToast(`Visit finished — ${formatDuration(payload.duration_minutes)}`);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to finish visit", 6000);
  } finally {
    $("finishVisitBtn").disabled = false;
  }
}

function renderStats() {
  const today = new Date();
  const completedToday = state.visits.filter(v => {
    if (!v.departure) return false;
    const d = new Date(v.departure);
    return d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
  });
  $("statCompleted").textContent = completedToday.length;
  const laborMinutes = completedToday.reduce((sum, v) =>
    sum + (Number(v.duration_minutes) || 0) * (Number(v.crew_size) || 1), 0);
  $("statHours").textContent = (laborMinutes / 60).toFixed(1);
}

function filteredCompletedVisits() {
  const q = $("searchInput").value.trim().toLowerCase();
  const worker = $("workerFilter").value;
  return state.visits.filter(v => v.departure)
    .filter(v => !worker || v.worker === worker)
    .filter(v => {
      if (!q) return true;
      return [v.worker, v.notes, v.equipment, formatDateTime(v.arrival)]
        .some(x => String(x || "").toLowerCase().includes(q));
    });
}

function renderHistory() {
  const visits = filteredCompletedVisits();
  $("historyList").innerHTML = visits.length ? visits.map(v => `
    <article class="history-item">
      <div class="section-heading">
        <div>
          <div class="item-title">${escapeHtml(v.worker || "Unknown")}</div>
          <div class="item-meta">${formatDateTime(v.arrival)} → ${formatDateTime(v.departure)}</div>
        </div>
        <strong>${formatDuration(Number(v.duration_minutes) || 0)}</strong>
      </div>
      <div class="item-meta">Crew: ${v.crew_size || 1}${v.equipment ? ` · Equipment: ${escapeHtml(v.equipment)}` : ""}</div>
      ${v.notes ? `<div class="item-notes">${escapeHtml(v.notes)}</div>` : ""}
    </article>
  `).join("") : '<p class="empty">No completed visits match the current filter.</p>';
}

function exportCsv() {
  const rows = filteredCompletedVisits();
  if (!rows.length) return showToast("There are no completed visits to export");

  const headers = ["Worker","Arrival","Departure","Duration Minutes","Crew Size","Labor Minutes","Equipment","Notes"];
  const lines = [headers, ...rows.map(v => [
    v.worker || "",
    v.arrival || "",
    v.departure || "",
    v.duration_minutes || 0,
    v.crew_size || 1,
    (v.duration_minutes || 0) * (v.crew_size || 1),
    v.equipment || "",
    v.notes || ""
  ])].map(row => row.map(csvEscape).join(","));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dry-creek-visits-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

init();
