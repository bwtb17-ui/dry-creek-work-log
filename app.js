import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=4";

const $ = (id) => document.getElementById(id);
const state = {
  workers: [], visits: [],
  selectedWorker: localStorage.getItem("dc_worker") || "",
  activeVisitId: Number(localStorage.getItem("dc_active_visit_id")) || null,
  elapsedTimer: null
};

const configured = SUPABASE_URL.startsWith("https://") && SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

function apiHeaders(extra = {}) {
  return { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`, "Content-Type": "application/json", ...extra };
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: apiHeaders(options.headers || {}),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!response.ok) throw new Error(data?.message || data?.hint || (typeof data === "string" ? data : "") || `Database request failed (${response.status})`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The database connection timed out.");
    throw error;
  } finally { clearTimeout(timer); }
}

function showToast(message, ms = 3500) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("toast").classList.add("hidden"), ms);
}
function setConnection(text, mode = "") { const b=$("connectionBadge"); b.textContent=text; b.className=`badge ${mode}`.trim(); }
function formatDateTime(value) { if(!value) return "—"; return new Date(value).toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}); }
function minutesBetween(start,end=new Date()){ return Math.max(0,Math.round((new Date(end)-new Date(start))/60000)); }
function formatDuration(minutes){ const h=Math.floor(minutes/60),m=minutes%60; return h?`${h} hr ${m} min`:`${m} min`; }
function escapeHtml(value=""){ return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]); }

async function init(){
  bindEvents();
  if(!configured){ $("setupCard").classList.remove("hidden"); setConnection("Setup needed","error"); return; }
  try{
    await Promise.all([loadWorkers(),loadVisits()]);
    setConnection("Shared database ready","ready");
    renderAll();
  }catch(error){
    console.error(error); setConnection("Database error","error");
    $("workerSelect").innerHTML='<option value="">Unable to load workers</option>';
    $("onSiteList").innerHTML=`<p class="empty">${escapeHtml(error.message)}</p>`;
    $("historyList").innerHTML=`<p class="empty">${escapeHtml(error.message)}</p>`;
    showToast(error.message,7000);
  }
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
}
function bindEvents(){
  $("saveWorkerBtn").addEventListener("click",saveWorker); $("changeWorkerBtn").addEventListener("click",changeWorker);
  $("startVisitBtn").addEventListener("click",startVisit); $("finishVisitBtn").addEventListener("click",finishVisit);
  $("refreshBtn").addEventListener("click",refreshData); $("exportBtn").addEventListener("click",exportCsv);
  $("searchInput").addEventListener("input",renderHistory); $("workerFilter").addEventListener("change",renderHistory);
}
async function loadWorkers(){ state.workers=await api("workers?select=id,name&order=name.asc"); }
async function loadVisits(){
  state.visits=await api("visits?select=*&order=arrival.desc&limit=500");
  if(state.activeVisitId&&!state.visits.some(v=>v.id===state.activeVisitId&&!v.departure)){ state.activeVisitId=null; localStorage.removeItem("dc_active_visit_id"); }
}
async function refreshData(){ setConnection("Refreshing…"); try{ await Promise.all([loadWorkers(),loadVisits()]); renderAll(); setConnection("Shared database ready","ready"); showToast("Shared log refreshed"); }catch(e){ setConnection("Refresh failed","error"); showToast(e.message,6000); } }
function renderAll(){ renderWorkerControls(); renderOnSite(); renderActiveVisit(); renderStats(); renderHistory(); }
function renderWorkerControls(){
  const opts=state.workers.map(w=>`<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`).join("");
  $("workerSelect").innerHTML='<option value="">Choose a worker…</option>'+opts;
  const filter=$("workerFilter").value; $("workerFilter").innerHTML='<option value="">All workers</option>'+opts; $("workerFilter").value=filter;
  if(state.selectedWorker&&state.workers.some(w=>w.name===state.selectedWorker)){
    $("workerPicker").classList.add("hidden"); $("selectedWorker").classList.remove("hidden"); $("changeWorkerBtn").classList.remove("hidden"); $("selectedWorkerName").textContent=state.selectedWorker;
  }else{
    state.selectedWorker=""; localStorage.removeItem("dc_worker"); $("workerPicker").classList.remove("hidden"); $("selectedWorker").classList.add("hidden"); $("changeWorkerBtn").classList.add("hidden");
  }
}
function saveWorker(){ const v=$("workerSelect").value; if(!v)return showToast("Select your name first"); state.selectedWorker=v; localStorage.setItem("dc_worker",v); renderWorkerControls(); renderActiveVisit(); }
function changeWorker(){ if(state.activeVisitId)return showToast("Finish your active visit before changing workers"); state.selectedWorker=""; localStorage.removeItem("dc_worker"); renderWorkerControls(); }
function renderOnSite(){
  const active=state.visits.filter(v=>!v.departure); $("statOnSite").textContent=active.length;
  $("onSiteList").innerHTML=active.length?active.map(v=>`<div class="on-site-item"><div><div class="item-title"><span class="status-dot"></span>${escapeHtml(v.worker||"Unknown")}</div><div class="item-meta">Arrived ${formatDateTime(v.arrival)} · Crew ${v.crew_size||1}</div></div><strong>${formatDuration(minutesBetween(v.arrival))}</strong></div>`).join(""):'<p class="empty">No one is currently checked in.</p>';
}
function activeVisit(){ return state.visits.find(v=>v.id===state.activeVisitId&&!v.departure)||null; }
function renderActiveVisit(){
  const v=activeVisit(); if(!v){ $("activeCard").classList.add("hidden"); $("startCard").classList.remove("hidden"); stopElapsedTimer(); return; }
  $("startCard").classList.add("hidden"); $("activeCard").classList.remove("hidden"); $("activeWorker").textContent=v.worker; $("activeArrival").textContent=formatDateTime(v.arrival);
  $("crewSizeFinish").value=String(Math.min(5,v.crew_size||1)); $("equipmentFinish").value=v.equipment||""; $("notesFinish").value=v.notes||"";
  updateElapsed(v); stopElapsedTimer(); state.elapsedTimer=setInterval(()=>updateElapsed(v),30000);
}
function updateElapsed(v){ $("elapsedTime").textContent=formatDuration(minutesBetween(v.arrival)); }
function stopElapsedTimer(){ if(state.elapsedTimer)clearInterval(state.elapsedTimer); state.elapsedTimer=null; }
async function startVisit(){
  if(!state.selectedWorker)return showToast("Select your worker name first"); if(state.activeVisitId)return showToast("This device already has an active visit");
  const payload={worker:state.selectedWorker,arrival:new Date().toISOString(),departure:null,duration_minutes:null,crew_size:Number($("crewSizeStart").value||1),equipment:$("equipmentStart").value.trim()||null,notes:$("notesStart").value.trim()||null,photo_urls:null};
  $("startVisitBtn").disabled=true;
  try{
    const data=await api("visits",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)}); const visit=Array.isArray(data)?data[0]:data;
    if(!visit?.id)throw new Error("The visit was saved, but no visit ID was returned.");
    state.activeVisitId=visit.id; localStorage.setItem("dc_active_visit_id",String(visit.id)); $("notesStart").value=""; $("equipmentStart").value="";
    await loadVisits(); renderAll(); showToast("Visit started");
  }catch(e){ console.error(e); showToast(e.message,7000); }finally{ $("startVisitBtn").disabled=false; }
}
async function finishVisit(){
  const v=activeVisit(); if(!v)return showToast("No active visit was found"); const departure=new Date();
  const payload={departure:departure.toISOString(),duration_minutes:minutesBetween(v.arrival,departure),crew_size:Number($("crewSizeFinish").value||1),equipment:$("equipmentFinish").value.trim()||null,notes:$("notesFinish").value.trim()||null};
  $("finishVisitBtn").disabled=true;
  try{ await api(`visits?id=eq.${v.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)}); state.activeVisitId=null; localStorage.removeItem("dc_active_visit_id"); await loadVisits(); renderAll(); showToast(`Visit finished — ${formatDuration(payload.duration_minutes)}`); }
  catch(e){ console.error(e); showToast(e.message,7000); }finally{ $("finishVisitBtn").disabled=false; }
}
function renderStats(){
  const today=new Date(); const done=state.visits.filter(v=>{ if(!v.departure)return false; const d=new Date(v.departure); return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate(); });
  $("statCompleted").textContent=done.length; const mins=done.reduce((s,v)=>s+(Number(v.duration_minutes)||0)*(Number(v.crew_size)||1),0); $("statHours").textContent=(mins/60).toFixed(1);
}
function filteredCompletedVisits(){ const q=$("searchInput").value.trim().toLowerCase(),worker=$("workerFilter").value; return state.visits.filter(v=>v.departure).filter(v=>!worker||v.worker===worker).filter(v=>!q||[v.worker,v.notes,v.equipment,formatDateTime(v.arrival)].some(x=>String(x||"").toLowerCase().includes(q))); }
function renderHistory(){ const rows=filteredCompletedVisits(); $("historyList").innerHTML=rows.length?rows.map(v=>`<article class="history-item"><div class="section-heading"><div><div class="item-title">${escapeHtml(v.worker||"Unknown")}</div><div class="item-meta">${formatDateTime(v.arrival)} → ${formatDateTime(v.departure)}</div></div><strong>${formatDuration(Number(v.duration_minutes)||0)}</strong></div><div class="item-meta">Crew: ${v.crew_size||1}${v.equipment?` · Equipment: ${escapeHtml(v.equipment)}`:""}</div>${v.notes?`<div class="item-notes">${escapeHtml(v.notes)}</div>`:""}</article>`).join(""):'<p class="empty">No completed visits match the current filter.</p>'; }
function exportCsv(){ const rows=filteredCompletedVisits(); if(!rows.length)return showToast("There are no completed visits to export"); const headers=["Worker","Arrival","Departure","Duration Minutes","Crew Size","Labor Minutes","Equipment","Notes"]; const lines=[headers,...rows.map(v=>[v.worker||"",v.arrival||"",v.departure||"",v.duration_minutes||0,v.crew_size||1,(v.duration_minutes||0)*(v.crew_size||1),v.equipment||"",v.notes||""])].map(r=>r.map(csvEscape).join(",")); const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob),a=document.createElement("a"); a.href=url;a.download=`dry-creek-visits-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url); }
function csvEscape(value){ const t=String(value??""); return `"${t.replace(/"/g,'""')}"`; }
init();
