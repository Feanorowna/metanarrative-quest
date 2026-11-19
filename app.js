(function () {
  "use strict";

  // ==================== STATE & CONSTANTS ====================
  const KNOCKOUT_THRESHOLD = 12; // Out of 19 (12 + 7)
  const MAX_TOTAL = 38;          // 12 + 7 + 7 + 6 + 6

  let db = null;
  let auth = null;
  let currentUserUid = null;
  let isFirebaseReady = false;

  const state = {
    name: "",
    room: "",
    scores: { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 },
    total: 0,
    phase: "login",
    eliminated: false,
    finished: false,
    trapCaught: false,
    finalGameAnswers: {}
  };

  // ==================== INITIALIZATION ====================
  document.addEventListener("DOMContentLoaded", () => {
    initFirebase();
    routeMode();
    bindEvents();
  });

  function initFirebase() {
    const cfg = window.FIREBASE_CONFIG;

    if (!cfg || !cfg.apiKey || cfg.apiKey.includes("PASTE_")) {
      setSyncStatus(false, "Config missing (Local preview only)");
      return;
    }

    try {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.database();
      isFirebaseReady = true;
      setSyncStatus(true, "Connected");
    } catch (err) {
      console.error("Firebase init error:", err);
      setSyncStatus(false, "Connection Error");
    }
  }

  function setSyncStatus(ok, text) {
    const syncEl = document.getElementById("sync-status");
    if (!syncEl) return;
    syncEl.textContent = (ok ? "● " : "▲ ") + text;
    syncEl.classList.toggle("offline", !ok);
  }

  function routeMode() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const roomParam = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (mode === "teacher") {
      showView("view-teacher");
      if (roomParam) {
        document.getElementById("teacher-room-input").value = roomParam;
        loadTeacherRoom(roomParam);
      }
    } else if (mode === "collect") {
      showView("view-collect");
    } else {
      showView("view-login");
      if (roomParam) {
        document.getElementById("input-room").value = roomParam;
      }
      renderAllExercises();
    }
  }

  function showView(viewId) {
    document.querySelectorAll(".view-section").forEach(el => el.classList.add("hidden"));
    const target = document.getElementById(viewId);
    if (target) target.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ==================== RENDER EXERCISES ====================
  function renderAllExercises() {
    const data = window.QUEST_CONTENT;
    if (!data) return;

    // 1A. Vocabulary Flip Cards
    const deckGrid = document.getElementById("vocab-deck-grid");
    deckGrid.innerHTML = data.vocab.map(item => `
      <div class="flip-card" onclick="this.classList.toggle('flipped')">
        <div class="flip-card-inner">
          <div class="flip-card-front">
            <div class="card-icon">${item.icon}</div>
            <div class="card-category">${item.category}</div>
            <div class="card-term">${item.term}</div>
            <div class="flip-hint">Tap to flip ↻</div>
          </div>
          <div class="flip-card-back">
            <div class="back-def">${item.definition}</div>
            <div class="back-example"><span>Literary / Biographical Quote:</span>${item.monographQuote}</div>
            <div class="back-example"><span>Everyday Context:</span>${item.simpleExample}</div>
          </div>
        </div>
      </div>
    `).join("");

    // 1B. Matching Dropdowns
    const allTerms = data.vocab.map(v => v.term);
    const shuffledTerms = [...allTerms].sort(() => Math.random() - 0.5);
    const matchContainer = document.getElementById("matching-container");

    matchContainer.innerHTML = data.stage1Matching.map(item => `
      <div class="q-item">
        <div class="q-prompt">${item.prompt}</div>
        <select id="match-${item.id}" data-answer="${escapeHtml(item.answer)}">
          <option value="">-- Choose expression --</option>
          ${shuffledTerms.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
    `).join("");

    // 2. Multiple Choice
    const mcContainer = document.getElementById("mc-container");
    mcContainer.innerHTML = data.stage2MC.map(item => `
      <div class="q-item">
        <div class="q-prompt">${item.question}</div>
        <div class="mc-options">
          ${item.options.map(opt => `
            <label class="mc-label">
              <input type="radio" name="${item.id}" value="${escapeHtml(opt)}">
              <span>${escapeHtml(opt)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `).join("");

    // 3. Gap-Fill Review
    const gapContainer = document.getElementById("gapfill-container");
    const shuffledChoices = [...data.stage3GapFill.choices].sort(() => Math.random() - 0.5);
    gapContainer.innerHTML = data.stage3GapFill.segments.map(seg => {
      if (seg.text) return `<span>${seg.text}</span>`;
      return `
        <select id="gap-${seg.id}" class="inline-select">
          <option value="">-- select --</option>
          ${shuffledChoices.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>
        <span class="underlined-cue">(${seg.cue})</span>
      `;
    }).join("");

    // 4. Key-Word Transformation
    const transContainer = document.getElementById("transform-container");
    transContainer.innerHTML = data.stage4Transform.map(item => `
      <div class="q-item">
        <div class="q-prompt">${item.original} <span class="key-badge">${item.keyWord}</span></div>
        <p>${item.prefix} <input type="text" id="trans-${item.id}" class="transform-input" placeholder="Type missing words here..." autocomplete="off"> ${item.suffix}</p>
      </div>
    `).join("");

    // 5. Final Game Cards
    const fgContainer = document.getElementById("finalgame-container");
    fgContainer.innerHTML = data.stage5FinalGame.cards.map(card => `
      <div class="media-card">
        <div>
          <div class="media-tag">${card.tag}</div>
          <div class="media-text">${card.text}</div>
        </div>
        <div>
          <label for="fg-${card.id}" style="font-size:0.85rem; font-weight:600;">Choose label:</label>
          <select id="fg-${card.id}" style="margin-top:0.35rem;">
            <option value="">-- Select metanarrative label --</option>
            ${data.stage5FinalGame.labels.map(lbl => `<option value="${escapeHtml(lbl)}">${escapeHtml(lbl)}</option>`).join("")}
          </select>
        </div>
      </div>
    `).join("");
  }

  // ==================== EVENT BINDINGS ====================
  function bindEvents() {
    // Student Login
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById("input-name").value.trim();
        const roomInput = document.getElementById("input-room").value.trim().toUpperCase();
        const errEl = document.getElementById("login-error");

        if (!nameInput || !/^[A-Z0-9]{2,8}$/.test(roomInput)) {
          errEl.textContent = "Please enter your name and a valid room code (2–8 letters/numbers).";
          errEl.classList.remove("hidden");
          return;
        }

        errEl.classList.add("hidden");
        const btn = document.getElementById("btn-start");
        btn.disabled = true;
        btn.textContent = "Connecting...";

        state.name = nameInput;
        state.room = roomInput;
        state.phase = "stage1";

        if (isFirebaseReady) {
          try {
            const cred = await auth.signInAnonymously();
            currentUserUid = cred.user.uid;
            await syncProgressToFirebase();
          } catch (err) {
            console.error("Auth error:", err);
            setSyncStatus(false, "Sign-in failed (Offline mode)");
          }
        }

        document.getElementById("display-player-name").textContent = state.name;
        document.getElementById("display-room-code").textContent = "Room: " + state.room;
        document.getElementById("top-bar").classList.remove("hidden");
        updateTopBar(15);
        showView("view-level-1");
      });
    }

    // Submit Stage 1 (Matching)
    const btnL1 = document.getElementById("btn-submit-l1");
    if (btnL1) {
      btnL1.addEventListener("click", async () => {
        const items = window.QUEST_CONTENT.stage1Matching;
        let score = 0;
        for (const item of items) {
          const val = document.getElementById("match-" + item.id).value;
          if (!val) {
            alert("Please complete all 12 matching items before continuing.");
            return;
          }
          if (val === item.answer) score++;
        }

        state.scores.s1 = score;
        recalcTotal();
        state.phase = "stage2";
        updateTopBar(35);
        await syncProgressToFirebase();
        showView("view-level-2");
      });
    }

    // Submit Stage 2 (Multiple Choice -> Knockout Checkpoint)
    const btnL2 = document.getElementById("btn-submit-l2");
    if (btnL2) {
      btnL2.addEventListener("click", async () => {
        const items = window.QUEST_CONTENT.stage2MC;
        let score = 0;
        for (const item of items) {
          const checked = document.querySelector(`input[name="${item.id}"]:checked`);
          if (!checked) {
            alert("Please answer all 7 questions before checking your Knockout status.");
            return;
          }
          if (checked.value === item.answer) score++;
        }

        state.scores.s2 = score;
        recalcTotal();

        const combined = state.scores.s1 + state.scores.s2;
        state.eliminated = combined < KNOCKOUT_THRESHOLD;
        state.phase = "knockout";

        updateTopBar(55);
        renderKnockoutBanner(combined);
await syncProgressToFirebase();
showView("view-knockout");
});
}
// Continue from Knockout to Stage 3
const btnContL3 = document.getElementById("btn-continue-l3");
if (btnContL3) {
btnContL3.addEventListener("click", async () => {
state.phase = "stage3";
await syncProgressToFirebase();
showView("view-level-3");
});
}
// Submit Stage 3 (Gap-Fill Review)
const btnL3 = document.getElementById("btn-submit-l3");
if (btnL3) {
btnL3.addEventListener("click", async () => {
const gaps = window.QUEST_CONTENT.stage3GapFill.segments.filter(s => s.id);
let score = 0;
for (const g of gaps) {
const val = document.getElementById("gap-" + g.id).value;
if (!val) {
alert("Please fill in all 7 gaps in the review.");
return;
}
if (val === g.answer) score++;
}
state.scores.s3 = score;
recalcTotal();
state.phase = "stage4";
updateTopBar(75);
await syncProgressToFirebase();
showView("view-level-4");
});
}
// Submit Stage 4 (Transformation)
const btnL4 = document.getElementById("btn-submit-l4");
if (btnL4) {
btnL4.addEventListener("click", async () => {
const items = window.QUEST_CONTENT.stage4Transform;
let score = 0;
for (const item of items) {
const raw = document.getElementById("trans-" + item.id).value;
if (!raw.trim()) {
alert("Please complete all 6 sentence transformations.");
return;
}
const cleaned = raw.trim().toLowerCase().replace(/[.,!?;:'"]+/g, "").replace(/\s+/g, " ");
if (item.accepted.includes(cleaned)) score++;
}
state.scores.s4 = score;
recalcTotal();
state.phase = "stage5";
updateTopBar(90);
await syncProgressToFirebase();
showView("view-level-5");
});
}
// Submit Stage 5 (Final Game -> Results & Debrief)
const btnL5 = document.getElementById("btn-submit-l5");
if (btnL5) {
btnL5.addEventListener("click", async () => {
const cards = window.QUEST_CONTENT.stage5FinalGame.cards;
let score = 0;
let trapCaught = false;
for (const card of cards) {
const val = document.getElementById("fg-" + card.id).value;
if (!val) {
alert("Please select a label for all 6 media cards.");
return;
}
state.finalGameAnswers[card.id] = val;
if (val === card.answer) {
score++;
if (card.isTrap) trapCaught = true;
}
}
state.scores.s5 = score;
state.trapCaught = trapCaught;
recalcTotal();
state.phase = "finished";
state.finished = true;
updateTopBar(100);
await syncProgressToFirebase(true);
renderResultsAndDebrief();
showView("view-results");
subscribeLeaderboard();
});
}
// Student Export Button
const btnExport = document.getElementById("btn-export-student");
if (btnExport) {
btnExport.addEventListener("click", () => {
const payload = JSON.stringify({
name: state.name,
room: state.room,
scores: state.scores,
total: state.total,
eliminated: state.eliminated,
trapCaught: state.trapCaught,
exportedAt: new Date().toISOString()
});
if (navigator.clipboard) {
navigator.clipboard.writeText(payload).catch(function (err) {
console.warn("Clipboard write failed:", err);
});
}
document.getElementById("export-notice").classList.remove("hidden");
const blob = new Blob([payload], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = quest-result-${state.name.replace(/\s+/g, "_")}.json;
a.click();
URL.revokeObjectURL(url);
});
}
// Teacher View Controls
const btnTeacherLoad = document.getElementById("btn-teacher-load");
if (btnTeacherLoad) {
btnTeacherLoad.addEventListener("click", () => {
const r = document.getElementById("teacher-room-input").value.trim().toUpperCase();
if (/^[A-Z0-9]{2,8}$/.test(r)) {
loadTeacherRoom(r);
} else {
alert("Enter a valid room code (2–8 letters or numbers).");
}
});
}
const btnTeacherCsv = document.getElementById("btn-teacher-csv");
if (btnTeacherCsv) {
btnTeacherCsv.addEventListener("click", exportTeacherCSV);
}
// Offline Collector Controls
initCollectMode();
}
// ==================== HELPERS & UI UPDATES ====================
function recalcTotal() {
const s = state.scores;
state.total = s.s1 + s.s2 + s.s3 + s.s4 + s.s5;
document.getElementById("display-total-score").textContent = state.total;
}
function updateTopBar(percent) {
document.getElementById("progress-fill").style.width = percent + "%";
const statusBadge = document.getElementById("display-race-status");
if (state.eliminated) {
statusBadge.textContent = "Eliminated (Still Learning)";
statusBadge.className = "badge badge-eliminated";
} else {
statusBadge.textContent = "Survivor";
statusBadge.className = "badge badge-survivor";
}
}
function renderKnockoutBanner(combined) {
const box = document.getElementById("knockout-banner");
if (!state.eliminated) {
box.className = "knockout-box survivor";
box.innerHTML = `
🏆
You Survived the Knockout Checkpoint!
You scored \({combined} out of 19</strong> (minimum required: \){KNOCKOUT_THRESHOLD}).
You remain in the main race for the top spots on the class leaderboard. Keep going!
; } else { box.className = "knockout-box eliminated"; box.innerHTML = 
🧭
Eliminated from the Race — Keep Learning!
You scored \({combined} out of 19</strong> (minimum required to stay in the race: \){KNOCKOUT_THRESHOLD}).
You are out of the competitive race, but you still complete Stages 3, 4, and 5 to earn points and unlock the full answer debrief.
`;
}
}
function renderResultsAndDebrief() {
const pct = Math.round((state.total / MAX_TOTAL) * 100);
document.getElementById("final-greeting").textContent = Well done, ${state.name}!;
document.getElementById("res-total").textContent = ${state.total} / ${MAX_TOTAL};
document.getElementById("res-percent").textContent = ${pct}%;
document.getElementById("res-status").textContent = state.eliminated ? "Eliminated" : "Survivor";
document.getElementById("res-s1").textContent = ${state.scores.s1}/12;
document.getElementById("res-s2").textContent = ${state.scores.s2}/7;
document.getElementById("res-s3").textContent = ${state.scores.s3}/7;
document.getElementById("res-s4").textContent = ${state.scores.s4}/6;
document.getElementById("res-s5").textContent = ${state.scores.s5}/6;
// Build Debrief
const debriefEl = document.getElementById("debrief-container");
const data = window.QUEST_CONTENT;
let html = "Stage 5: Media Cards & Trap Breakdown";
data.stage5FinalGame.cards.forEach(card => {
const userAns = state.finalGameAnswers[card.id] || "No answer";
const isOk = userAns === card.answer;
html += `
<div class="debrief-item ${isOk ? "correct" : "wrong"} ${card.isTrap ? "trap-card" : ""}">
${card.tag} — Your choice: ${escapeHtml(userAns)} ${isOk ? "✅" : "❌"}
${card.debrief}
`;
});
html += "Stage 4: Transformation Model Answers";
data.stage4Transform.forEach(t => {
html += <li style="margin-bottom:0.4rem;">${t.prefix} <strong>${t.modelAnswer}</strong> ${t.suffix}</li>;
});
html += "";
debriefEl.innerHTML = html;
}
// ==================== FIREBASE SYNC & LEADERBOARD ====================
async function syncProgressToFirebase(isFinal = false) {
if (!isFirebaseReady || !currentUserUid || !state.room) return;
const record = {
name: state.name,
scores: state.scores,
total: state.total,
phase: state.phase,
eliminated: state.eliminated,
finished: state.finished,
trapCaught: state.trapCaught,
updatedAt: firebase.database.ServerValue.TIMESTAMP
};
try {
await db.ref(rooms/${state.room}/players/${currentUserUid}).set(record);
if (isFinal) {
await db.ref(rooms/${state.room}/submissions/${currentUserUid}).set(record);
}
setSyncStatus(true, "Saved to cloud");
} catch (err) {
console.error("Firebase write failed:", err);
setSyncStatus(false, "Save failed — export result at end");
}
}
function subscribeLeaderboard() {
if (!isFirebaseReady || !state.room) return;
db.ref(rooms/${state.room}/players).on("value", snap => {
const val = snap.val() || {};
const list = Object.values(val).sort((a, b) => (b.total || 0) - (a.total || 0));
const tbody = document.getElementById("leaderboard-body");
tbody.innerHTML = list.map((p, idx) => `
#${idx + 1}
${escapeHtml(p.name)}${escapeHtml(p.phase)}${p.eliminated ? "Eliminated" : "Survivor"}\({p.total || 0} / \){MAX_TOTAL}`).join("");
});
}
// ==================== TEACHER VIEW ====================
let currentTeacherRows = [];
async function loadTeacherRoom(roomCode) {
if (!isFirebaseReady) {
alert("Firebase is not configured yet. Please check firebase-config.js.");
return;
}
try {
if (!auth.currentUser) {
await auth.signInAnonymously();
}
} catch (e) {
console.warn("Teacher anon auth warning:", e);
}
db.ref(rooms/${roomCode}/players).off();
db.ref(rooms/${roomCode}/players).on("value", snap => {
const val = snap.val() || {};
const rows = Object.values(val).sort((a, b) => (b.total || 0) - (a.total || 0));
currentTeacherRows = rows;
const totalCount = rows.length;
const survivors = rows.filter(r => !r.eliminated).length;
const eliminated = rows.filter(r => r.eliminated).length;
const finishedList = rows.filter(r => r.finished);
const trapYes = finishedList.filter(r => r.trapCaught).length;
const trapPct = finishedList.length ? Math.round((trapYes / finishedList.length) * 100) : 0;
document.getElementById("stat-count").textContent = totalCount;
document.getElementById("stat-survivors").textContent = survivors;
document.getElementById("stat-eliminated").textContent = eliminated;
document.getElementById("stat-trap").textContent = ${trapPct}% (${trapYes}/${finishedList.length});
const tbody = document.getElementById("teacher-table-body");
if (!rows.length) {
tbody.innerHTML = <tr><td colspan="10">No students in room ${escapeHtml(roomCode)} yet.</td></tr>;
return;
}
tbody.innerHTML = rows.map(r => {
const s = r.scores || { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 };
const pct = Math.round(((r.total || 0) / MAX_TOTAL) * 100);
const statusText = r.finished
? (r.eliminated ? "Finished (Eliminated)" : "Finished (Survivor)")
: ${r.phase} (${r.eliminated ? "Eliminated" : "In Race"});
return `
${escapeHtml(r.name)}
${escapeHtml(statusText)}${s.s1 || 0}${s.s2 || 0}${s.s3 || 0}${s.s4 || 0}${s.s5 || 0}${r.total || 0}${pct}%${r.finished ? (r.trapCaught ? "Yes" : "No") : "—"}`;
}).join("");
});
}
function exportTeacherCSV() {
if (!currentTeacherRows.length) {
alert("No student data to export.");
return;
}
const headers = ["Name", "Status", "Stage1_Match", "Stage2_MC", "Stage3_Review", "Stage4_Transform", "Stage5_FinalGame", "Total_38", "Percent", "Trap_Caught"];
const lines = [headers.join(",")];
currentTeacherRows.forEach(r => {
const s = r.scores || {};
const pct = Math.round(((r.total || 0) / MAX_TOTAL) * 100);
const status = r.eliminated ? "Eliminated" : "Survivor";
lines.push([
"${(r.name || "").replace(/"/g, '""')}",
status,
s.s1 || 0,
s.s2 || 0,
s.s3 || 0,
s.s4 || 0,
s.s5 || 0,
r.total || 0,
pct + "%",
r.trapCaught ? "Yes" : "No"
].join(","));
});
downloadCSV(lines.join("\n"), "metanarrative-quest-grades.csv");
}
// ==================== COLLECT FALLBACK PAGE ====================
function initCollectMode() {
const collected = [];
const btnAdd = document.getElementById("btn-collect-add");
if (btnAdd) {
btnAdd.addEventListener("click", () => {
const raw = document.getElementById("collect-input").value.trim();
if (!raw) return;
try {
const obj = JSON.parse(raw);
collected.push(obj);
document.getElementById("collect-input").value = "";
const tbody = document.getElementById("collect-table-body");
tbody.innerHTML = collected.map(c => `
${escapeHtml(c.name || "Unknown")}
${escapeHtml(c.room || "—")}\({c.total || 0} / \){MAX_TOTAL}${c.eliminated ? "Eliminated" : "Survivor"}Pasted JSON`).join("");
} catch (err) {
alert("Invalid result format. Please paste the exact JSON text exported by the student.");
}
});
}
const btnCsv = document.getElementById("btn-collect-csv");
if (btnCsv) {
btnCsv.addEventListener("click", () => {
if (!collected.length) return;
const lines = ["Name,Room,Total,Status,Source"];
collected.forEach(c => {
lines.push("${(c.name || "").replace(/"/g, '""')}",${c.room || ""},${c.total || 0},${c.eliminated ? "Eliminated" : "Survivor"},Pasted);
});
downloadCSV(lines.join("\n"), "collected-fallback-grades.csv");
});
}
}
function downloadCSV(csvContent, filename) {
const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url);
}
function escapeHtml(str) {
return String(str)
.replace(/&/g, "&")
.replace(/</g, "<")
.replace(/>/g, ">")
.replace(/"/g, """);
}
})();
