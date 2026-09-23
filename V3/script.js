// --------- STATE ---------
// Match formats offered in the format dropdown. setsToWin is what the
// scoring engine reads; superTiebreak swaps games/sets for a single race
// to SUPER_TIEBREAK_POINTS (win by 2).
const MATCH_FORMATS = {
    'one-set':        { label: '1 Set',           detail: '6 games, tiebreak at 6-6', badge: '1',  setsToWin: 1 },
    'best-of-3':      { label: 'Best of 3',       detail: 'First to win 2 sets',               badge: '3',  setsToWin: 2 },
    'best-of-5':      { label: 'Best of 5',       detail: 'First to win 3 sets',               badge: '5',  setsToWin: 3 },
    'super-tiebreak': { label: 'Super Tie-break', detail: 'First to 10 points, win by 2',      badge: '10', setsToWin: 1, superTiebreak: true }
};
const SUPER_TIEBREAK_POINTS = 10;

function newPlayer(name) {
    // tbHistory runs parallel to setHistory: the loser's tiebreak points for a
    // set decided 7-6, otherwise null.
    return { name: name, points: 0, games: 0, sets: 0, setHistory: [], tbHistory: [] };
}

function newPlayerStats() {
    return { points: 0, servePlayed: 0, serveWon: 0, bpChances: 0, bpWon: 0, serviceGames: 0, holds: 0, streak: 0, bestStreak: 0 };
}

function newMatchStats() {
    return { startedAt: null, endedAt: null, p1: newPlayerStats(), p2: newPlayerStats() };
}

let matchState = {
    p1: newPlayer("Player 1"),
    p2: newPlayer("Player 2"),
    server: 1, 
    isTiebreak: false,
    history: [],
    format: 'one-set',
    setsToWin: 1, // Number of sets needed to win match (1 = 1 set, 2 = Best of 3)
    superTiebreak: false,
    stats: newMatchStats(),
    activeTournamentMatch: null // stores bracket path like { round: 0, matchIndex: 1 } if in tournament
};

const POINT_STRINGS = ["0", "15", "30", "40"];

try { Store.migrate(); } catch (e) { console.error('Profile migration failed:', e); }
let tournamentData = Store.load('tournament', []) || [];
if(!Array.isArray(tournamentData)) tournamentData = tournamentData ? [tournamentData] : [];
// Legacy migration: ensure all existing loaded tournaments have an ID
tournamentData.forEach(t => {
    if (!t.id) t.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
});
let leaderboardData = Store.load('leaderboard', {}) || {};
let activeTournamentId = null;

// --------- DOM ELEMENTS ---------
// Tabs & Views
const navTabs = document.querySelectorAll('.nav-tab');
const views = document.querySelectorAll('.view-section');
const headerControls = {
    live: document.getElementById('live-controls'),
    lb: document.getElementById('leaderboard-controls')
};

// Match Trackers
const elUndo = document.getElementById("btn-undo");
const elReset = document.getElementById("btn-reset");
const elEndMatch = document.getElementById("btn-end-match");
const winTargetIndicator = document.getElementById("win-target-indicator");
const p1NameInput = document.getElementById("p1-name");
const p2NameInput = document.getElementById("p2-name");
const lblP1Name = document.getElementById("lbl-p1-name");
const lblP2Name = document.getElementById("lbl-p2-name");
const p1PointsEl = document.getElementById("p1-points");
const p2PointsEl = document.getElementById("p2-points");
const p1GamesEl = document.getElementById("p1-games");
const p2GamesEl = document.getElementById("p2-games");
const p1SetsContainerEl = document.getElementById("p1-sets-container");
const p2SetsContainerEl = document.getElementById("p2-sets-container");
const p1ServeIndicator = document.getElementById("p1-serve");
const p2ServeIndicator = document.getElementById("p2-serve");
const gameStatusIndicator = document.getElementById("game-status");
const btnP1Point = document.getElementById("btn-p1-point");
const btnP2Point = document.getElementById("btn-p2-point");
const toastContainer = document.getElementById("toast-container");

// Leaderboard Elements (tournament elements live in tournament.js)
const leaderboardListEl = document.getElementById('leaderboard-list');
const btnResetLeaderboard = document.getElementById('btn-reset-leaderboard');

// --------- INITIALIZATION ---------
function init() {
    updateMatchUI();
    initTournament();
    renderTournament();
    renderLeaderboard();
    attachEventListeners();
    initWalkthrough();
    initFormatPicker();
    initMatchSummary();
    try {
        initInstallPrompt();
    } catch (e) {
        console.error('Install prompt failed to start:', e);
    }
    // Last, and isolated: tracking a match matters more than the profile chip,
    // so a failure here must not take the whole app down with it.
    try {
        initProfiles();
    } catch (e) {
        console.error('Profile UI failed to start:', e);
    }
}

function attachEventListeners() {
    // Nav 
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.target));
    });

    // Inputs sync
    p1NameInput.addEventListener("input", (e) => { matchState.p1.name = e.target.value || "Player 1"; lblP1Name.textContent = matchState.p1.name; });
    p2NameInput.addEventListener("input", (e) => { matchState.p2.name = e.target.value || "Player 2"; lblP2Name.textContent = matchState.p2.name; });

    // Live Match Controls
    btnP1Point.addEventListener("click", () => handlePoint(1));
    btnP2Point.addEventListener("click", () => handlePoint(2));
    elUndo.addEventListener("click", undoLastAction);
    
    elEndMatch.addEventListener("click", () => openMatchSummary());

    btnResetLeaderboard.addEventListener("click", () => {
        showConfirm("Clear all ranking points?", () => {
            leaderboardData = {}; Store.clear('leaderboard'); renderLeaderboard();
            showToast("Leaderboard Cleared");
        }, null, "Reset Leaderboard");
    });
}

// --------- SPA NAVIGATION ---------
function switchView(targetViewId) {
    views.forEach(v => v.classList.remove('active-view'));
    navTabs.forEach(t => t.classList.remove('active'));
    
    // Show target view
    document.getElementById(targetViewId).classList.add('active-view');
    document.querySelector(`.nav-tab[data-target="${targetViewId}"]`).classList.add('active');
    
    // Evaluate if we should stretch out using the smart width engine
    updateWideMode();

    // Header Controls logic
    headerControls.live.style.display = targetViewId === 'view-live' ? 'flex' : 'none';
    headerControls.lb.style.display = targetViewId === 'view-leaderboard' ? 'flex' : 'none';
    
    if(targetViewId === 'view-leaderboard') renderLeaderboard();
}

// --------- LIVE MATCH CORE LOGIC ---------
function saveState() {
    matchState.history.push(JSON.parse(JSON.stringify({
        p1: matchState.p1, p2: matchState.p2, server: matchState.server, isTiebreak: matchState.isTiebreak,
        stats: matchState.stats
    })));
    if (matchState.history.length > 50) matchState.history.shift();
    elUndo.disabled = matchState.history.length === 0;
}

// Called before the point is added, so the score still shows the situation
// the point was played in (needed to spot break points).
function recordPointStats(playerNum) {
    const st = matchState.stats;
    if (!st.startedAt) st.startedAt = Date.now();

    const server = matchState.server;
    const returner = server === 1 ? 2 : 1;
    const srv = st['p' + server], ret = st['p' + returner];

    // Break point: in a regular game, the returner is one point from winning it.
    if (!matchState.isTiebreak && !matchState.superTiebreak) {
        const rp = matchState['p' + returner].points, sp = matchState['p' + server].points;
        if (rp >= 3 && rp - sp >= 1) {
            ret.bpChances++;
            if (playerNum === returner) ret.bpWon++;
        }
    }

    srv.servePlayed++;
    if (playerNum === server) srv.serveWon++;

    const won = st['p' + playerNum], lost = st['p' + (playerNum === 1 ? 2 : 1)];
    won.points++;
    won.streak++;
    lost.streak = 0;
    if (won.streak > won.bestStreak) won.bestStreak = won.streak;
}

function handlePoint(playerNum) {
    if (isMatchDecided()) return;
    saveState();
    recordPointStats(playerNum);
    const pScoring = playerNum === 1 ? matchState.p1 : matchState.p2;
    const pOther = playerNum === 1 ? matchState.p2 : matchState.p1;
    pScoring.points++;

    if (matchState.superTiebreak) {
        if (pScoring.points >= SUPER_TIEBREAK_POINTS && pScoring.points - pOther.points >= 2) { handleSuperTiebreakWin(playerNum); return; }
        if ((matchState.p1.points + matchState.p2.points) % 2 === 1) matchState.server = matchState.server === 1 ? 2 : 1;
    } else if (matchState.isTiebreak) {
        if (pScoring.points >= 7 && pScoring.points - pOther.points >= 2) { handleGameWin(playerNum); return; }
        if ((matchState.p1.points + matchState.p2.points) % 2 === 1) matchState.server = matchState.server === 1 ? 2 : 1;
    } else {
        if (pScoring.points >= 4 && pScoring.points - pOther.points >= 2) { handleGameWin(playerNum); return; }
    }
    updateMatchUI();
    animateScore(playerNum);
}

function handleGameWin(playerNum) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    const pLosing = playerNum === 1 ? matchState.p2 : matchState.p1;
    showToast(`${pWinning.name} Wins Game`);

    // Holds/breaks only make sense for regular games; a tiebreak has no single server.
    const pendingTiebreak = matchState.isTiebreak ? { p1: matchState.p1.points, p2: matchState.p2.points } : null;
    if (!pendingTiebreak) {
        const srv = matchState.stats['p' + matchState.server];
        srv.serviceGames++;
        if (playerNum === matchState.server) srv.holds++;
    }
    
    pWinning.games++;
    matchState.p1.points = 0; matchState.p2.points = 0;
    matchState.server = matchState.server === 1 ? 2 : 1;
    
    if ( (pWinning.games >= 6 && pWinning.games - pLosing.games >= 2) || (pWinning.games === 7) ) { handleSetWin(playerNum, pendingTiebreak); return; }
    if (pWinning.games === 6 && pLosing.games === 6) { matchState.isTiebreak = true; showToast("Tiebreak!"); } 
    else { matchState.isTiebreak = false; }
    
    updateMatchUI();
}

function handleSetWin(playerNum, tiebreakPoints) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    showToast(`${pWinning.name} Wins Set`);
    matchState.p1.setHistory.push(matchState.p1.games);
    matchState.p2.setHistory.push(matchState.p2.games);
    // Record the tiebreak loser's points so the score reads 7-6(5).
    const tbLoser = tiebreakPoints ? Math.min(tiebreakPoints.p1, tiebreakPoints.p2) : null;
    matchState.p1.tbHistory.push(tbLoser);
    matchState.p2.tbHistory.push(tbLoser);
    pWinning.sets++;
    matchState.p1.games = 0; matchState.p2.games = 0;
    matchState.isTiebreak = false;
    
    // MATCH WIN CONDITION
    if (pWinning.sets >= matchState.setsToWin) {
         announceMatchWin(pWinning);
         return;
    }
    
    updateMatchUI();
}

// A super tie-break is the whole match: its final points become the one "set".
function handleSuperTiebreakWin(playerNum) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    matchState.p1.setHistory.push(matchState.p1.points);
    matchState.p2.setHistory.push(matchState.p2.points);
    matchState.p1.tbHistory.push(null);
    matchState.p2.tbHistory.push(null);
    matchState.p1.points = 0; matchState.p2.points = 0;
    pWinning.sets++;
    announceMatchWin(pWinning);
}

function isMatchDecided() {
    return matchState.p1.sets >= matchState.setsToWin || matchState.p2.sets >= matchState.setsToWin;
}

function announceMatchWin(pWinning) {
    matchState.stats.endedAt = Date.now();
    showToast(`${pWinning.name} Wins Match!`);
    // Reveal Finish Match so the result can still be recorded if the summary is dismissed.
    elEndMatch.style.display = 'flex';
    updateMatchUI();
    setTimeout(() => openMatchSummary(), 500);
}

function undoLastAction() {
    if (matchState.history.length === 0) return;
    const lastConfig = matchState.history.pop();
    matchState.p1 = lastConfig.p1; matchState.p2 = lastConfig.p2;
    matchState.server = lastConfig.server; matchState.isTiebreak = lastConfig.isTiebreak;
    matchState.stats = lastConfig.stats;
    elUndo.disabled = matchState.history.length === 0;
    elEndMatch.style.display = 'none'; // hide match finish if undone
    updateMatchUI();
}

// Clears the score but keeps names, format and any tournament match in play.
function resetScore() {
    matchState.p1 = newPlayer(matchState.p1.name);
    matchState.p2 = newPlayer(matchState.p2.name);
    matchState.server = 1; matchState.isTiebreak = false; matchState.history = [];
    matchState.stats = newMatchStats();
    elUndo.disabled = true;
    elEndMatch.style.display = 'none';
    updateMatchUI();
}

function fullMatchReset() {
    matchState.p1.name = p1NameInput.value;
    matchState.p2.name = p2NameInput.value;
    matchState.activeTournamentMatch = null;
    resetScore();
}

function updateMatchUI() {
    let pts1 = matchState.p1.points, pts2 = matchState.p2.points;
    if (matchState.superTiebreak) {
        p1PointsEl.textContent = pts1; p2PointsEl.textContent = pts2;
        const bothOnBrink = pts1 >= SUPER_TIEBREAK_POINTS - 1 && pts2 >= SUPER_TIEBREAK_POINTS - 1;
        gameStatusIndicator.textContent = "Super Tie-break · " + (bothOnBrink ? "Win by 2" : "First to " + SUPER_TIEBREAK_POINTS);
    } else if (matchState.isTiebreak) {
        p1PointsEl.textContent = pts1; p2PointsEl.textContent = pts2;
        gameStatusIndicator.textContent = "Tiebreak";
    } else {
        if (pts1 >= 3 && pts2 >= 3) {
            if (pts1 === pts2) { p1PointsEl.textContent = "40"; p2PointsEl.textContent = "40"; gameStatusIndicator.textContent = "Deuce"; }
            else if (pts1 === pts2 + 1) { p1PointsEl.textContent = "AD"; p2PointsEl.textContent = "-"; gameStatusIndicator.textContent = "Ad " + matchState.p1.name; }
            else if (pts2 === pts1 + 1) { p1PointsEl.textContent = "-"; p2PointsEl.textContent = "AD"; gameStatusIndicator.textContent = "Ad " + matchState.p2.name; }
        } else {
            p1PointsEl.textContent = POINT_STRINGS[pts1] || pts1; p2PointsEl.textContent = POINT_STRINGS[pts2] || pts2;
            gameStatusIndicator.textContent = "Set " + (matchState.p1.sets + matchState.p2.sets + 1) + ", Game " + (matchState.p1.games + matchState.p2.games + 1);
        }
    }
    if (isMatchDecided()) gameStatusIndicator.textContent = "Match Complete";
    renderSetsHistory();
    // In a super tie-break there are no games, so the live column tracks points.
    p1GamesEl.textContent = matchState.superTiebreak ? pts1 : matchState.p1.games;
    p2GamesEl.textContent = matchState.superTiebreak ? pts2 : matchState.p2.games;
    p1ServeIndicator.classList.toggle("active", matchState.server === 1); p2ServeIndicator.classList.toggle("active", matchState.server === 2);
    
    renderLiveTournamentContext();
    lblP1Name.textContent = matchState.p1.name; lblP2Name.textContent = matchState.p2.name;
    p1NameInput.value = matchState.p1.name; p2NameInput.value = matchState.p2.name;
}

function renderSetsHistory() {
    Array.from(p1SetsContainerEl.children).forEach(el => { if (!el.classList.contains("current-set")) el.remove(); });
    Array.from(p2SetsContainerEl.children).forEach(el => { if (!el.classList.contains("current-set")) el.remove(); });
    for(let i=0; i < matchState.p1.setHistory.length; i++) {
        let span1 = document.createElement("div"); span1.className = "game-score"; span1.textContent = matchState.p1.setHistory[i]; p1SetsContainerEl.insertBefore(span1, p1GamesEl);
        let span2 = document.createElement("div"); span2.className = "game-score"; span2.textContent = matchState.p2.setHistory[i]; p2SetsContainerEl.insertBefore(span2, p2GamesEl);
    }
}

// --------- PERSISTENCE ---------
function saveLeaderboard() {
    if (!Store.save('leaderboard', leaderboardData)) warnStorageFull();
}

// Surfaced once per session: a silent write failure would look like the app
// simply forgetting a finished match.
let storageWarningShown = false;
function warnStorageFull() {
    if (storageWarningShown) return;
    storageWarningShown = true;
    showToast("Couldn't save - export a backup");
}

function forceEndMatch() {
    if (matchState.activeTournamentMatch && matchState.activeTournamentMatch.tId) {
        recordTournamentMatch();
    } else {
        // Just ending a casual match
        fullMatchReset();
    }
}

// --------- LEADERBOARD LOGIC ---------
function awardPoints(playerName, points) {
    if(!leaderboardData[playerName]) leaderboardData[playerName] = 0;
    leaderboardData[playerName] += points;
    saveLeaderboard();
}

function renderLeaderboard() {
    let sortedList = Object.keys(leaderboardData).map(k => ({name: k, pts: leaderboardData[k]})).sort((a,b) => b.pts - a.pts);
    leaderboardListEl.innerHTML = '';
    
    if(sortedList.length === 0) {
        leaderboardListEl.innerHTML = '<p class="text-center text-muted">No ATP points recorded yet.</p>'; return;
    }

    sortedList.forEach((p, idx) => {
        let row = document.createElement('div'); row.className = `leaderboard-row rank-${idx+1}`;
        row.innerHTML = `
            <div class="lb-rank">${idx+1}</div>
            <div class="lb-name">${p.name}</div>
            <div class="lb-pts">${p.pts}</div>
        `;
        leaderboardListEl.appendChild(row);
    });
}

// --------- UTILS ---------
function animateScore(playerNum) {
    const el = playerNum === 1 ? p1PointsEl : p2PointsEl; el.classList.remove("animate-pop"); void el.offsetWidth; el.classList.add("animate-pop");
}
function showToast(msg) {
    // Rapid scoring fires several toasts at once; keep only the newest two on screen.
    while (toastContainer.children.length >= 2) toastContainer.removeChild(toastContainer.firstChild);
    const el = document.createElement("div"); el.className = "toast"; el.textContent = msg; toastContainer.appendChild(el);
    setTimeout(() => { if(toastContainer.contains(el)) toastContainer.removeChild(el); }, 2600);
}

// --------- GUIDED TOUR ---------
const tourSteps = [
    { targetId: null, title: "Welcome to Racquetback", text: "Let's take a quick guided tour of your new premium tennis club companion." },
    { targetId: "view-live", highlightClass: ".point-scores", title: "Live Tracker", text: "Tap these large point cards to score. The app handles Deuce & Tiebreaks automatically.", view: "view-live" },
    { targetId: "live-controls", highlightClass: "#live-controls", title: "Match Controls", text: "Undo an accidental tap, or tap the target to pick a format: 1 set, best of 3 or 5, or a super tie-break.", view: "view-live" },
    { targetId: "nav-tourney", highlightClass: "#nav-tourney", title: "Tournaments", text: "Run a knockout bracket for any number of players. Results you score here move winners on automatically.", view: "view-tournament" },
    { targetId: "nav-lb", highlightClass: "#nav-lb", title: "Leaderboards", text: "Tournament progress awards automatic ATP-style ranking points to players over time.", view: "view-leaderboard" }
];

let currentTourStep = 0;

function initWalkthrough() {
    if (!safeGetFlag('cs_hasSeenTour')) {
        setTimeout(() => startTour(), 500);
    }
    
    document.getElementById('tour-btn-next').addEventListener('click', () => {
        if (currentTourStep < tourSteps.length - 1) {
            currentTourStep++;
            showTourStep();
        } else {
            endTour();
        }
    });

    document.getElementById('tour-btn-prev').addEventListener('click', () => {
        if (currentTourStep > 0) {
            currentTourStep--;
            showTourStep();
        }
    });

    document.getElementById('tour-btn-skip').addEventListener('click', endTour);
}

function startTour() {
    currentTourStep = 0;
    document.getElementById('tour-overlay').classList.remove('hide');
    document.getElementById('tour-tooltip').classList.add('show');
    document.getElementById('tour-tooltip').classList.remove('hide');
    showTourStep();
}

function endTour() {
    document.getElementById('tour-overlay').classList.add('hide');
    document.getElementById('tour-tooltip').classList.remove('show');
    setTimeout(() => document.getElementById('tour-tooltip').classList.add('hide'), 300);
    clearTourHighlights();
    safeSetFlag('cs_hasSeenTour', 'true');
    switchView('view-live'); 
    // The install sheet waits for the tour so the two never stack on first visit.
    setTimeout(maybeShowInstallBanner, 800);
}

function clearTourHighlights() {
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
}

function showTourStep() {
    clearTourHighlights();
    const step = tourSteps[currentTourStep];
    
    // Switch view if necessary
    if(step.view) switchView(step.view);

    document.getElementById('tour-tit').textContent = step.title;
    document.getElementById('tour-txt').textContent = step.text;
    
    const btnNext = document.getElementById('tour-btn-next');
    btnNext.textContent = currentTourStep === tourSteps.length - 1 ? "Finish" : "Next";
    document.getElementById('tour-btn-prev').style.display = currentTourStep === 0 ? "none" : "block";

    const tooltip = document.getElementById('tour-tooltip');
    const arrow = document.getElementById('tour-arrow');
    
    if (!step.targetId) {
        // Center on screen
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
        arrow.style.display = 'none';
        return;
    }

    // Delay measurement to allow view transition frame
    setTimeout(() => {
        let targetEl = document.querySelector(step.highlightClass) || document.getElementById(step.targetId);
        if(!targetEl) return;
        
        targetEl.classList.add('tour-highlight');
        
        const rect = targetEl.getBoundingClientRect();
        const ttRect = tooltip.getBoundingClientRect();
        
        tooltip.style.transform = 'none';
        arrow.style.display = 'block';

        let top = rect.top - ttRect.height - 15;
        let left = rect.left + (rect.width / 2) - (ttRect.width / 2);
        
        arrow.className = 'tour-arrow top'; // arrow pointing down

        // If it goes off the top screen, put it below
        if (top < 20) {
            top = rect.bottom + 15;
            arrow.className = 'tour-arrow bottom'; // arrow pointing up
        }

        // Constrain horizontal boundaries
        if (left < 10) left = 10;
        if (left + ttRect.width > window.innerWidth - 10) left = window.innerWidth - ttRect.width - 10;

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        
    }, 50);
}

// --------- CUSTOM CONFIRM MODAL ---------
let confirmCallback = null;
let cancelCallback = null;

function showConfirm(message, onConfirm, onCancel = null, title = "Confirm Action") {
    const modal = document.getElementById('custom-confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    confirmCallback = onConfirm;
    cancelCallback = onCancel;
    
    modal.classList.remove('hide');
}

function closeConfirm() {
    document.getElementById('custom-confirm-modal').classList.add('hide');
    confirmCallback = null;
    cancelCallback = null;
}

document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    if(confirmCallback) confirmCallback();
    closeConfirm();
});
document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
    if(cancelCallback) cancelCallback();
    closeConfirm();
});

// --------- PROFILES & BACKUP ---------

// Device-wide flags (not per profile) still need guarding: localStorage
// throws outright in private mode on some browsers.
function safeGetFlag(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSetFlag(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* non-fatal */ }
}

const profileChipEl = document.getElementById('btn-profile');
const profileInitialsEl = document.getElementById('profile-initials');
const profileModalEl = document.getElementById('profile-modal');
const profileListEl = document.getElementById('profile-list');
const profileImportInput = document.getElementById('profile-import-input');

function initialsFor(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function updateProfileChip() {
    const profile = Store.activeProfile();
    const name = profile ? profile.name : '?';
    profileInitialsEl.textContent = initialsFor(name);
    profileChipEl.title = 'Profile: ' + name;
    profileChipEl.setAttribute('aria-label', 'Profile: ' + name + '. Switch or back up.');
}

// Pull the active profile's data into the live app state and repaint.
function reloadProfileData() {
    tournamentData = Store.load('tournament', []) || [];
    if (!Array.isArray(tournamentData)) tournamentData = tournamentData ? [tournamentData] : [];
    tournamentData.forEach(t => {
        if (!t.id) t.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    });
    leaderboardData = Store.load('leaderboard', {}) || {};
    activeTournamentId = null;

    fullMatchReset();
    renderTournamentHub();
    renderLeaderboard();
    updateProfileChip();
}

function openProfileModal() {
    renderProfileList();
    profileModalEl.classList.remove('hide');
}

function closeProfileModal() {
    profileModalEl.classList.add('hide');
}

function renderProfileList() {
    const profiles = Store.listProfiles();
    const currentId = Store.activeId();
    profileListEl.innerHTML = '';

    profiles.forEach(profile => {
        const isActive = profile.id === currentId;
        const row = document.createElement('div');
        row.className = 'profile-row' + (isActive ? ' is-active' : '');

        const pick = document.createElement('button');
        pick.className = 'profile-pick';
        pick.innerHTML =
            '<span class="profile-avatar">' + initialsFor(profile.name) + '</span>' +
            '<span class="profile-meta">' +
                '<span class="profile-name"></span>' +
                '<span class="profile-sub">' + (isActive ? 'Active now' : 'Tap to switch') + '</span>' +
            '</span>';
        // Names are user input - set as text, never as markup.
        pick.querySelector('.profile-name').textContent = profile.name;
        pick.addEventListener('click', () => {
            if (isActive) return;
            Store.switchProfile(profile.id);
            reloadProfileData();
            closeProfileModal();
            showToast('Switched to ' + profile.name);
        });

        const rename = document.createElement('button');
        rename.className = 'profile-action';
        rename.title = 'Rename';
        rename.setAttribute('aria-label', 'Rename ' + profile.name);
        rename.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
        rename.addEventListener('click', () => {
            const next = prompt('Rename profile', profile.name);
            if (next === null) return;
            Store.renameProfile(profile.id, next);
            renderProfileList();
            updateProfileChip();
        });

        row.appendChild(pick);
        row.appendChild(rename);

        if (profiles.length > 1) {
            const del = document.createElement('button');
            del.className = 'profile-action danger';
            del.title = 'Delete';
            del.setAttribute('aria-label', 'Delete ' + profile.name);
            del.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
            del.addEventListener('click', () => {
                closeProfileModal();
                showConfirm(
                    'Delete "' + profile.name + '" and every tournament saved under it? This cannot be undone.',
                    () => {
                        Store.deleteProfile(profile.id);
                        reloadProfileData();
                        showToast('Profile deleted');
                        openProfileModal();
                    },
                    () => openProfileModal(),
                    'Delete Profile'
                );
            });
            row.appendChild(del);
        }

        profileListEl.appendChild(row);
    });
}

function handleExportBackup() {
    let payload;
    try {
        payload = JSON.stringify(Store.exportAll(), null, 2);
    } catch (e) {
        showToast('Could not build backup');
        return;
    }

    downloadBlob(new Blob([payload], { type: 'application/json' }), Store.exportFilename());
    showToast('Backup downloaded');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleImportBackup(file) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = () => {
        let added;
        try {
            added = Store.importAll(JSON.parse(reader.result));
        } catch (e) {
            showToast(e.message || 'Could not read that file');
            return;
        }
        reloadProfileData();
        renderProfileList();
        showToast('Restored ' + added + (added === 1 ? ' profile' : ' profiles'));
    };

    reader.onerror = () => showToast('Could not read that file');
    reader.readAsText(file);
}

function initProfiles() {
    updateProfileChip();

    profileChipEl.addEventListener('click', openProfileModal);
    document.getElementById('profile-close-btn').addEventListener('click', closeProfileModal);
    profileModalEl.addEventListener('click', (e) => {
        if (e.target === profileModalEl) closeProfileModal();
    });

    document.getElementById('profile-add-btn').addEventListener('click', () => {
        const name = prompt('Name this profile', '');
        if (name === null) return;
        const profile = Store.createProfile(name);
        reloadProfileData();
        renderProfileList();
        showToast('Now tracking as ' + profile.name);
    });

    document.getElementById('profile-export-btn').addEventListener('click', handleExportBackup);
    document.getElementById('profile-import-btn').addEventListener('click', () => profileImportInput.click());
    profileImportInput.addEventListener('change', (e) => {
        handleImportBackup(e.target.files[0]);
        e.target.value = '';
    });

    // Ask the browser to exempt this site from routine storage eviction.
    try { Store.requestPersistence(); } catch (e) { /* best effort only */ }

    if (!Store.isReliable()) {
        setTimeout(() => showToast('Private mode: progress will not be saved'), 1200);
    }
}

// --------- SCORE FORMATTING ---------
// ["6-4", "7-6(5)"], plus the unfinished set marked "(Ret)" if the match was cut short.
function formatSetScores(state) {
    const out = state.p1.setHistory.map((g1, i) => {
        const tb = state.p1.tbHistory ? state.p1.tbHistory[i] : null;
        return `${g1}-${state.p2.setHistory[i]}` + (tb !== null && tb !== undefined ? `(${tb})` : '');
    });
    const cur1 = state.superTiebreak ? state.p1.points : state.p1.games;
    const cur2 = state.superTiebreak ? state.p2.points : state.p2.games;
    if (cur1 > 0 || cur2 > 0) out.push(`${cur1}-${cur2} (Ret)`);
    return out;
}

// Empty for anything under a minute - not worth showing.
function formatDuration(ms) {
    if (!ms || ms < 60000) return '';
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
}

// --------- MATCH FORMAT PICKER ---------
const formatPickerEl = document.querySelector('.format-picker');
const formatMenuEl = document.getElementById('format-menu');

function initFormatPicker() {
    Object.keys(MATCH_FORMATS).forEach(key => {
        const fmt = MATCH_FORMATS[key];
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'format-option';
        opt.dataset.format = key;
        opt.setAttribute('role', 'menuitemradio');
        opt.innerHTML =
            '<span class="format-badge">' + fmt.badge + '</span>' +
            '<span class="format-text">' +
                '<span class="format-label">' + fmt.label + '</span>' +
                '<span class="format-detail">' + fmt.detail + '</span>' +
            '</span>' +
            '<svg class="format-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        opt.addEventListener('click', () => selectMatchFormat(key));
        formatMenuEl.appendChild(opt);
    });

    elReset.addEventListener('click', (e) => {
        e.stopPropagation();
        if (formatMenuEl.classList.contains('hide')) openFormatMenu(); else closeFormatMenu(true);
    });
    document.addEventListener('click', (e) => {
        if (!formatMenuEl.classList.contains('hide') && !formatPickerEl.contains(e.target)) closeFormatMenu(false);
    });
    formatMenuEl.addEventListener('keydown', (e) => {
        const opts = Array.from(formatMenuEl.querySelectorAll('.format-option'));
        const idx = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); opts[(idx + 1) % opts.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(idx - 1 + opts.length) % opts.length].focus(); }
        else if (e.key === 'Escape' || e.key === 'Tab') { closeFormatMenu(e.key === 'Escape'); }
    });
    renderFormatIndicator();
}

function openFormatMenu() {
    formatMenuEl.querySelectorAll('.format-option').forEach(opt => {
        const selected = opt.dataset.format === matchState.format;
        opt.classList.toggle('is-selected', selected);
        opt.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    formatMenuEl.classList.remove('hide');
    elReset.setAttribute('aria-expanded', 'true');
    const current = formatMenuEl.querySelector('.format-option.is-selected');
    if (current) current.focus({ preventScroll: true });
}

function closeFormatMenu(returnFocus) {
    formatMenuEl.classList.add('hide');
    elReset.setAttribute('aria-expanded', 'false');
    if (returnFocus) elReset.focus({ preventScroll: true });
}

function matchHasStarted() {
    const a = matchState.p1, b = matchState.p2;
    return a.points + b.points + a.games + b.games + a.setHistory.length > 0;
}

function selectMatchFormat(key) {
    closeFormatMenu(true);
    if (key === matchState.format) return;
    const next = MATCH_FORMATS[key];
    const toastText = next.superTiebreak ? next.label : (next.setsToWin === 1 ? "1 Set Match" : `${next.label} Sets`);

    // Moving between games-based scoring and a points race, or to a target
    // someone has already reached, can't carry the current score over.
    const needsRestart = matchHasStarted() && (
        next.superTiebreak || matchState.superTiebreak ||
        Math.max(matchState.p1.sets, matchState.p2.sets) >= next.setsToWin
    );

    if (needsRestart) {
        showConfirm(`Switching to ${next.label} restarts the current score. Continue?`, () => {
            applyMatchFormat(key);
            resetScore();
            showToast(toastText);
        }, null, "Change Format");
        return;
    }
    applyMatchFormat(key);
    updateMatchUI();
    showToast(toastText);
}

function applyMatchFormat(key) {
    const fmt = MATCH_FORMATS[key] || MATCH_FORMATS['one-set'];
    matchState.format = MATCH_FORMATS[key] ? key : 'one-set';
    matchState.setsToWin = fmt.setsToWin;
    matchState.superTiebreak = !!fmt.superTiebreak;
    if (!isMatchDecided()) elEndMatch.style.display = 'none';
    renderFormatIndicator();
}

function renderFormatIndicator() {
    const fmt = MATCH_FORMATS[matchState.format];
    winTargetIndicator.textContent = fmt.badge;
    winTargetIndicator.classList.toggle('is-wide', fmt.badge.length > 1);
    elReset.setAttribute('aria-label', 'Match format: ' + fmt.label);
    elReset.title = 'Match Format: ' + fmt.label;
}

// --------- MATCH SUMMARY & SHARING ---------
const summaryModalEl = document.getElementById('match-summary-modal');
let currentSummary = null;
let summaryShareFile = null;

function initMatchSummary() {
    document.getElementById('summary-share-btn').addEventListener('click', shareMatchSummary);
    document.getElementById('summary-keep-btn').addEventListener('click', () => {
        closeMatchSummary();
        undoLastAction();
    });
    document.getElementById('summary-done-btn').addEventListener('click', () => {
        closeMatchSummary();
        forceEndMatch();
    });
    document.getElementById('summary-close-btn').addEventListener('click', closeMatchSummary);
    summaryModalEl.addEventListener('click', (e) => {
        if (e.target === summaryModalEl) closeMatchSummary();
    });
}

function pct(won, played) {
    return played ? Math.round((won / played) * 100) : 0;
}

// Snapshot of the finished match: everything the summary, the share text and
// the share image need, detached from the live state.
function buildMatchSummary() {
    const s = matchState;
    const winner = s.p1.sets > s.p2.sets ? 1 : 2;
    const st = s.stats;
    const end = st.endedAt || Date.now();
    const fmt = MATCH_FORMATS[s.format];

    let context = null;
    if (s.activeTournamentMatch) {
        const t = tournamentData.find(t => t.id === s.activeTournamentMatch.tId);
        if (t) context = t.name + ' · ' + matchName(t, s.activeTournamentMatch.r, s.activeTournamentMatch.m);
    }

    const side = (n) => {
        const p = s['p' + n], ps = st['p' + n], opp = st['p' + (n === 1 ? 2 : 1)];
        return {
            name: p.name,
            sets: p.setHistory.slice(),
            tbs: (p.tbHistory || []).slice(),
            points: ps.points,
            servePct: pct(ps.serveWon, ps.servePlayed),
            returnPct: pct(opp.servePlayed - opp.serveWon, opp.servePlayed),
            bp: `${ps.bpWon}/${ps.bpChances}`,
            bpWon: ps.bpWon,
            holds: `${ps.holds}/${ps.serviceGames}`,
            holdsWon: ps.holds,
            bestStreak: ps.bestStreak
        };
    };

    const summary = {
        winner: winner,
        p1: side(1),
        p2: side(2),
        formatLabel: fmt.label,
        superTiebreak: s.superTiebreak,
        score: formatSetScores(s).join(', '),
        duration: st.startedAt ? end - st.startedAt : 0,
        playedAt: end,
        context: context
    };

    summary.rows = [
        { label: 'Points won', a: summary.p1.points, b: summary.p2.points },
        { label: 'Service points won', a: summary.p1.servePct + '%', b: summary.p2.servePct + '%', va: summary.p1.servePct, vb: summary.p2.servePct },
        { label: 'Return points won', a: summary.p1.returnPct + '%', b: summary.p2.returnPct + '%', va: summary.p1.returnPct, vb: summary.p2.returnPct }
    ];
    if (!summary.superTiebreak) {
        summary.rows.push({ label: 'Break points won', a: summary.p1.bp, b: summary.p2.bp, va: summary.p1.bpWon, vb: summary.p2.bpWon });
        summary.rows.push({ label: 'Service games held', a: summary.p1.holds, b: summary.p2.holds, va: summary.p1.holdsWon, vb: summary.p2.holdsWon });
    }
    summary.rows.push({ label: 'Longest point streak', a: summary.p1.bestStreak, b: summary.p2.bestStreak });
    summary.rows.forEach(r => {
        if (r.va === undefined) { r.va = r.a; r.vb = r.b; }
    });
    return summary;
}

function openMatchSummary() {
    closeFormatMenu(false);
    const summary = buildMatchSummary();
    currentSummary = summary;
    renderMatchSummary(summary);
    summaryModalEl.classList.remove('hide');

    // Render the image now so the Share tap can call navigator.share straight
    // away - Safari drops the share if it waits on async work after the tap.
    summaryShareFile = null;
    renderShareImage(summary).then(blob => {
        if (currentSummary !== summary || !blob) return;
        try {
            summaryShareFile = new File([blob], shareFileName(summary), { type: 'image/png' });
        } catch (e) {
            summaryShareFile = blob; // very old engines: no File constructor
        }
    }).catch(() => { /* text-only share still works */ });
}

function closeMatchSummary() {
    summaryModalEl.classList.add('hide');
}

function renderMatchSummary(summary) {
    const winner = summary['p' + summary.winner];
    const loser = summary['p' + (summary.winner === 1 ? 2 : 1)];

    document.getElementById('summary-kicker').textContent = summary.context || 'Match Complete';
    const winnerEl = document.getElementById('summary-winner');
    winnerEl.textContent = winner.name + ' wins';
    winnerEl.className = 'summary-winner ' + (summary.winner === 1 ? 'is-p1' : 'is-p2');
    document.getElementById('summary-meta').textContent =
        ['def. ' + loser.name, summary.formatLabel, formatDuration(summary.duration)].filter(Boolean).join(' · ');

    const board = document.getElementById('summary-scoreboard');
    board.innerHTML = '';
    [1, 2].forEach(n => {
        const p = summary['p' + n];
        const row = document.createElement('div');
        row.className = 'summary-score-row p' + n + (summary.winner === n ? ' is-winner' : '');
        const name = document.createElement('span');
        name.className = 'summary-score-name';
        name.textContent = p.name;
        row.appendChild(name);
        const sets = document.createElement('span');
        sets.className = 'summary-score-sets';
        p.sets.forEach((g, i) => {
            const cell = document.createElement('span');
            const other = summary['p' + (n === 1 ? 2 : 1)].sets[i];
            cell.className = 'summary-set' + (g > other ? ' won' : '');
            cell.textContent = g;
            // Tiebreak points belong to the set's loser, shown as 6(5).
            if (p.tbs[i] !== null && p.tbs[i] !== undefined && g < other) {
                const sup = document.createElement('sup');
                sup.textContent = p.tbs[i];
                cell.appendChild(sup);
            }
            sets.appendChild(cell);
        });
        row.appendChild(sets);
        board.appendChild(row);
    });

    const statsEl = document.getElementById('summary-stats');
    statsEl.innerHTML = '';
    summary.rows.forEach(r => {
        const total = (Number(r.va) || 0) + (Number(r.vb) || 0);
        const share = total ? (Number(r.va) || 0) / total * 100 : 50;
        const row = document.createElement('div');
        row.className = 'summary-stat';
        row.innerHTML =
            '<span class="summary-stat-val p1"></span>' +
            '<span class="summary-stat-label"></span>' +
            '<span class="summary-stat-val p2"></span>' +
            '<span class="summary-stat-bar"><i class="p1" style="width:' + share + '%"></i><i class="p2"></i></span>';
        row.querySelector('.summary-stat-val.p1').textContent = r.a;
        row.querySelector('.summary-stat-label').textContent = r.label;
        row.querySelector('.summary-stat-val.p2').textContent = r.b;
        statsEl.appendChild(row);
    });

    document.getElementById('summary-done-btn').textContent = matchState.activeTournamentMatch ? 'Record result' : 'New match';
}

function shareFileName(summary) {
    const slug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
    return `racquetback-${slug(summary.p1.name)}-vs-${slug(summary.p2.name)}.png`;
}

function buildShareText(summary) {
    const winner = summary['p' + summary.winner];
    const loser = summary['p' + (summary.winner === 1 ? 2 : 1)];
    const lines = [];
    lines.push(`🎾 ${winner.name} def. ${loser.name} ${summary.score}`.trim());
    lines.push([summary.context, summary.formatLabel, formatDuration(summary.duration)].filter(Boolean).join(' · '));
    lines.push('');
    lines.push(`Stats (${summary.p1.name} – ${summary.p2.name})`);
    summary.rows.forEach(r => lines.push(`${r.label}: ${r.a} – ${r.b}`));
    lines.push('');
    const url = /^https?:/.test(location.protocol) ? ' ' + location.origin : '';
    lines.push('Tracked with Racquetback' + url);
    return lines.join('\n');
}

async function shareMatchSummary() {
    const summary = currentSummary;
    if (!summary) return;
    const text = buildShareText(summary);
    const file = summaryShareFile;

    if (navigator.share) {
        const data = { title: 'Match result', text: text };
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
        try {
            await navigator.share(data);
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return; // user closed the share sheet
            // Otherwise fall through to copy + download.
        }
    }

    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    } catch (e) { /* clipboard blocked */ }

    let image = file;
    if (!image) {
        try { image = await renderShareImage(summary); } catch (e) { image = null; }
    }
    if (image) downloadBlob(image, shareFileName(summary));

    if (copied && image) showToast('Copied & image saved');
    else if (copied) showToast('Result copied');
    else if (image) showToast('Image saved');
    else showToast("Couldn't share on this device");
}

// Canvas mirrors the app's tokens (see :root in style.css).
const SHARE_COLORS = {
    bg: '#020617', panel: 'rgba(30, 41, 59, 0.75)', border: 'rgba(255, 255, 255, 0.08)',
    text: '#f8fafc', muted: '#94a3b8', p1: '#d9f99d', p2: '#7dd3fc', track: 'rgba(255, 255, 255, 0.08)'
};

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

async function renderShareImage(summary) {
    const W = 1080, H = 1350, PAD = 80;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Use the app fonts when they're available; fall back quietly offline.
    if (document.fonts && document.fonts.load) {
        await Promise.race([
            Promise.all([
                document.fonts.load('800 80px Outfit'), document.fonts.load('600 40px Outfit'),
                document.fonts.load('400 40px Outfit'), document.fonts.load('700 48px "JetBrains Mono"')
            ]).catch(() => null),
            new Promise(r => setTimeout(r, 1500))
        ]);
    }
    const SANS = "Outfit, 'Segoe UI', system-ui, sans-serif";
    const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";
    const C = SHARE_COLORS;

    // Background with the app's two corner glows.
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    [[0, 0, 'rgba(217, 249, 157, 0.28)'], [W, H, 'rgba(125, 211, 252, 0.28)']].forEach(([x, y, c]) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, W * 0.75);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(2, 6, 23, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    });

    // Header: logo + date.
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 52px ${SANS}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.fillText('Racquet', PAD, 140);
    ctx.fillStyle = C.p1;
    ctx.fillText('back', PAD + ctx.measureText('Racquet').width, 140);
    ctx.font = `400 30px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.fillText(new Date(summary.playedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), W - PAD, 140);

    // Headline.
    const winner = summary['p' + summary.winner];
    const loser = summary['p' + (summary.winner === 1 ? 2 : 1)];
    const winColor = summary.winner === 1 ? C.p1 : C.p2;
    ctx.textAlign = 'left';
    ctx.font = `600 28px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, ((summary.context ? summary.context + ' · ' : 'Match result · ') + summary.formatLabel).toUpperCase(), W - PAD * 2), PAD, 250);
    let size = 92;
    ctx.font = `800 ${size}px ${SANS}`;
    while (size > 56 && ctx.measureText(winner.name).width > W - PAD * 2) { size -= 4; ctx.font = `800 ${size}px ${SANS}`; }
    ctx.fillStyle = winColor;
    ctx.fillText(fitText(ctx, winner.name, W - PAD * 2), PAD, 350);
    ctx.font = `400 40px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(fitText(ctx, 'def. ' + loser.name, W - PAD * 2), PAD, 415);

    // Scoreboard panel.
    const boardY = 470, boardH = 260;
    roundedRect(ctx, PAD, boardY, W - PAD * 2, boardH, 36);
    ctx.fillStyle = C.panel; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.stroke();

    const cellW = 96;
    const setsCount = Math.max(summary.p1.sets.length, 1);
    const cellsLeft = W - PAD - 40 - cellW * setsCount;
    [1, 2].forEach((n, idx) => {
        const p = summary['p' + n], other = summary['p' + (n === 1 ? 2 : 1)];
        const y = boardY + 105 + idx * 105;
        const isWinner = summary.winner === n;
        ctx.fillStyle = n === 1 ? C.p1 : C.p2;
        ctx.beginPath(); ctx.arc(PAD + 52, y - 15, 10, 0, Math.PI * 2); ctx.fill();
        ctx.font = `${isWinner ? 800 : 600} 44px ${SANS}`;
        ctx.fillStyle = isWinner ? C.text : C.muted;
        ctx.textAlign = 'left';
        ctx.fillText(fitText(ctx, p.name, cellsLeft - (PAD + 82) - 20), PAD + 82, y);
        p.sets.forEach((g, i) => {
            const cx = cellsLeft + cellW * i + cellW / 2;
            const won = g > other.sets[i];
            ctx.font = `700 52px ${MONO}`;
            ctx.fillStyle = won ? C.text : C.muted;
            ctx.textAlign = 'center';
            ctx.fillText(String(g), cx, y);
            if (p.tbs[i] !== null && p.tbs[i] !== undefined && !won) {
                ctx.font = `700 24px ${MONO}`;
                ctx.textAlign = 'left';
                ctx.fillText(String(p.tbs[i]), cx + ctx.measureText(String(g)).width / 2 + 22, y - 30);
            }
        });
    });

    // Stat rows with split bars.
    const rowH = 80;
    const statsTop = 795;
    summary.rows.forEach((r, i) => {
        const y = statsTop + i * rowH;
        ctx.font = `700 40px ${MONO}`;
        ctx.textAlign = 'left'; ctx.fillStyle = C.p1;
        ctx.fillText(String(r.a), PAD, y);
        ctx.textAlign = 'right'; ctx.fillStyle = C.p2;
        ctx.fillText(String(r.b), W - PAD, y);
        ctx.font = `600 28px ${SANS}`;
        ctx.textAlign = 'center'; ctx.fillStyle = C.muted;
        ctx.fillText(r.label, W / 2, y - 4);

        const total = (Number(r.va) || 0) + (Number(r.vb) || 0);
        const share = total ? (Number(r.va) || 0) / total : 0.5;
        const barY = y + 20, barW = W - PAD * 2, barH = 10;
        roundedRect(ctx, PAD, barY, barW, barH, 5);
        ctx.fillStyle = C.track; ctx.fill();
        ctx.save();
        roundedRect(ctx, PAD, barY, barW, barH, 5);
        ctx.clip();
        ctx.fillStyle = C.p1; ctx.fillRect(PAD, barY, barW * share - 3, barH);
        ctx.fillStyle = C.p2; ctx.fillRect(PAD + barW * share + 3, barY, barW * (1 - share), barH);
        ctx.restore();
    });

    // Footer.
    ctx.font = `400 28px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'left';
    const duration = formatDuration(summary.duration);
    if (duration) ctx.fillText('Duration ' + duration, PAD, H - 70);
    ctx.textAlign = 'right';
    ctx.fillText('Tracked with Racquetback', W - PAD, H - 70);

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// --------- ADD TO HOME SCREEN ---------
// Chromium fires beforeinstallprompt (captured in index.html so the browser's
// own bar never shows); iOS Safari has no API, so we explain the Share menu.
const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const installBannerEl = document.getElementById('install-banner');
const installBtnEl = document.getElementById('install-btn');
const installIosStepsEl = document.getElementById('install-ios-steps');
let deferredInstallPrompt = window.__installPromptEvent || null;

function isStandalone() {
    try {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* ignore */ }
    return window.navigator.standalone === true;
}

function isIOS() {
    const ua = navigator.userAgent || '';
    // iPadOS reports itself as a Mac; touch support gives it away.
    return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function installSnoozed() {
    const at = Number(safeGetFlag('cs_installDismissedAt'));
    return at && Date.now() - at < INSTALL_SNOOZE_MS;
}

function installMode() {
    if (deferredInstallPrompt) return 'prompt';
    if (isIOS()) return 'ios';
    return null;
}

function maybeShowInstallBanner() {
    if (isStandalone() || installSnoozed()) return;
    if (!installBannerEl.classList.contains('hide')) return;
    // First visit runs the guided tour; endTour() calls back here when it's done.
    if (!safeGetFlag('cs_hasSeenTour') || !document.getElementById('tour-overlay').classList.contains('hide')) return;
    const mode = installMode();
    if (!mode) return;

    installBannerEl.dataset.mode = mode;
    installIosStepsEl.classList.add('hide');
    installBtnEl.textContent = mode === 'ios' ? 'Show me how' : 'Install';
    installBannerEl.classList.remove('hide');
}

function hideInstallBanner() {
    installBannerEl.classList.add('hide');
}

function dismissInstallBanner() {
    safeSetFlag('cs_installDismissedAt', String(Date.now()));
    hideInstallBanner();
}

function initInstallPrompt() {
    if (isStandalone()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        maybeShowInstallBanner();
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        hideInstallBanner();
        showToast('App installed');
    });

    document.getElementById('install-close').addEventListener('click', dismissInstallBanner);
    installBtnEl.addEventListener('click', () => {
        if (installBannerEl.dataset.mode === 'prompt' && deferredInstallPrompt) {
            const promptEvent = deferredInstallPrompt;
            deferredInstallPrompt = null; // a prompt event can only be used once
            hideInstallBanner();
            promptEvent.prompt();
            Promise.resolve(promptEvent.userChoice).then(choice => {
                if (!choice || choice.outcome !== 'accepted') safeSetFlag('cs_installDismissedAt', String(Date.now()));
            }).catch(() => null);
            return;
        }
        // iOS: first tap reveals the steps, second tap closes the sheet.
        if (installIosStepsEl.classList.contains('hide')) {
            installIosStepsEl.classList.remove('hide');
            installBtnEl.textContent = 'Got it';
        } else {
            dismissInstallBanner();
        }
    });

    setTimeout(maybeShowInstallBanner, 1500);
}


init();
