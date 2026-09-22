// --------- STATE ---------
let matchState = {
    p1: { name: "Player 1", points: 0, games: 0, sets: 0, setHistory: [] },
    p2: { name: "Player 2", points: 0, games: 0, sets: 0, setHistory: [] },
    server: 1, 
    isTiebreak: false,
    history: [],
    setsToWin: 1, // Number of sets needed to win match (1 = 1 set, 2 = Best of 3)
    activeTournamentMatch: null // stores bracket path like { round: 0, matchIndex: 1 } if in tournament
};

const POINT_STRINGS = ["0", "15", "30", "40"];

let tournamentData = JSON.parse(localStorage.getItem('cs_tournament')) || null;
let leaderboardData = JSON.parse(localStorage.getItem('cs_leaderboard')) || {};

// --------- DOM ELEMENTS ---------
// Tabs & Views
const navTabs = document.querySelectorAll('.nav-tab');
const views = document.querySelectorAll('.view-section');
const headerControls = {
    live: document.getElementById('live-controls'),
    tourney: document.getElementById('tourney-controls'),
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

// Tourney & Leaderboard Elements
const btnStartTourney = document.getElementById('btn-start-tourney');
const tourneySetupEl = document.getElementById('tourney-setup');
const tourneyBracketEl = document.getElementById('tourney-bracket');
const leaderboardListEl = document.getElementById('leaderboard-list');
const btnResetTourney = document.getElementById('btn-reset-tourney');
const btnResetLeaderboard = document.getElementById('btn-reset-leaderboard');


// --------- INITIALIZATION ---------
function init() {
    updateMatchUI();
    renderTournament();
    renderLeaderboard();
    attachEventListeners();
    initWalkthrough();
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
    
    // Config toggles (1 Set, Best of 3, Best of 5)
    elReset.addEventListener("click", () => {
        if (matchState.setsToWin === 1) matchState.setsToWin = 2; // Best of 3 (needs 2 sets to win)
        else if (matchState.setsToWin === 2) matchState.setsToWin = 3; // Best of 5 (needs 3 sets)
        else matchState.setsToWin = 1; // Back to 1 set
        
        // Update Indicator UI (Show actual total sets vs "sets to win" for user readability)
        let displayStr = "1";
        if (matchState.setsToWin === 2) displayStr = "3";
        if (matchState.setsToWin === 3) displayStr = "5";

        winTargetIndicator.textContent = displayStr;
        showToast(displayStr === "1" ? "1 Set Match" : `Best of ${displayStr} Sets`);
    });
    
    elEndMatch.addEventListener("click", forceEndMatch);

    // Tourney & Data Controls
    btnStartTourney.addEventListener("click", handleStartTournament);
    btnResetTourney.addEventListener("click", () => {
        showConfirm("Clear current tournament?", () => {
            localStorage.removeItem('cs_tournament'); tournamentData = null; renderTournament();
            showToast("Tournament Cleared");
        }, null, "Reset Tournament");
    });
    btnResetLeaderboard.addEventListener("click", () => {
        showConfirm("Clear all ranking points?", () => {
            localStorage.removeItem('cs_leaderboard'); leaderboardData = []; renderLeaderboard();
            showToast("Leaderboard Cleared");
        }, null, "Reset Leaderboard");
    });
}

// --------- SPA NAVIGATION ---------
function switchView(targetViewId) {
    views.forEach(v => v.classList.remove('active-view'));
    navTabs.forEach(t => t.classList.remove('active'));
    
    document.getElementById(targetViewId).classList.add('active-view');
    document.querySelector(`.nav-tab[data-target="${targetViewId}"]`).classList.add('active');

    // Header Controls logic
    headerControls.live.classList.toggle('hide', targetViewId !== 'view-live');
    headerControls.tourney.classList.toggle('hide', targetViewId !== 'view-tournament');
    headerControls.lb.classList.toggle('hide', targetViewId !== 'view-leaderboard');
    
    if(targetViewId === 'view-leaderboard') renderLeaderboard();
}

// --------- LIVE MATCH CORE LOGIC ---------
function saveState() {
    matchState.history.push(JSON.parse(JSON.stringify({
        p1: matchState.p1, p2: matchState.p2, server: matchState.server, isTiebreak: matchState.isTiebreak
    })));
    if (matchState.history.length > 50) matchState.history.shift();
    elUndo.disabled = matchState.history.length === 0;
}

function handlePoint(playerNum) {
    saveState();
    const pScoring = playerNum === 1 ? matchState.p1 : matchState.p2;
    const pOther = playerNum === 1 ? matchState.p2 : matchState.p1;
    pScoring.points++;

    if (matchState.isTiebreak) {
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
    
    pWinning.games++;
    matchState.p1.points = 0; matchState.p2.points = 0;
    matchState.server = matchState.server === 1 ? 2 : 1;
    
    if ( (pWinning.games >= 6 && pWinning.games - pLosing.games >= 2) || (pWinning.games === 7) ) { handleSetWin(playerNum); return; }
    if (pWinning.games === 6 && pLosing.games === 6) { matchState.isTiebreak = true; showToast("Tiebreak!"); } 
    else { matchState.isTiebreak = false; }
    
    updateMatchUI();
}

function handleSetWin(playerNum) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    showToast(`${pWinning.name} Wins Set`);
    matchState.p1.setHistory.push(matchState.p1.games);
    matchState.p2.setHistory.push(matchState.p2.games);
    pWinning.sets++;
    matchState.p1.games = 0; matchState.p2.games = 0;
    matchState.isTiebreak = false;
    
    // MATCH WIN CONDITION
    if (pWinning.sets >= matchState.setsToWin) {
         showToast(`${pWinning.name} Wins Match!`);
         
         // Highlight end match mechanism actively instead of relying on the user to press it.
         setTimeout(() => {
             showConfirm(`${pWinning.name} has won the match! Conclude match and record score?`, 
             () => {
                 forceEndMatch();
             }, 
             () => {
                 // Reveal Finish Match button to allow manual termination later if they cancel
                 elEndMatch.style.display = 'flex';
                 updateMatchUI();
             }, "Match Complete!");
         }, 500);
         return;
    }
    
    updateMatchUI();
}

function undoLastAction() {
    if (matchState.history.length === 0) return;
    const lastConfig = matchState.history.pop();
    matchState.p1 = lastConfig.p1; matchState.p2 = lastConfig.p2;
    matchState.server = lastConfig.server; matchState.isTiebreak = lastConfig.isTiebreak;
    elUndo.disabled = matchState.history.length === 0;
    elEndMatch.style.display = 'none'; // hide match finish if undone
    updateMatchUI();
}

function fullMatchReset() {
    matchState.p1 = { name: p1NameInput.value, points: 0, games: 0, sets: 0, setHistory: [] };
    matchState.p2 = { name: p2NameInput.value, points: 0, games: 0, sets: 0, setHistory: [] };
    matchState.server = 1; matchState.isTiebreak = false; matchState.history = [];
    matchState.activeTournamentMatch = null;
    elUndo.disabled = true;
    elEndMatch.style.display = 'none';
    updateMatchUI();
}

function updateMatchUI() {
    let pts1 = matchState.p1.points, pts2 = matchState.p2.points;
    if (matchState.isTiebreak) {
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
    renderSetsHistory();
    p1GamesEl.textContent = matchState.p1.games; p2GamesEl.textContent = matchState.p2.games;
    p1ServeIndicator.classList.toggle("active", matchState.server === 1); p2ServeIndicator.classList.toggle("active", matchState.server === 2);
    
    // Highlight if tournament mode active
    if(matchState.activeTournamentMatch) elEndMatch.classList.add('animate-pop');
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

// --------- TOURNAMENT LOGIC ---------
function saveTournament() { localStorage.setItem('cs_tournament', JSON.stringify(tournamentData)); }
function saveLeaderboard() { localStorage.setItem('cs_leaderboard', JSON.stringify(leaderboardData)); }

function handleStartTournament() {
    let players = [];
    for(let i=1; i<=8; i++) {
        let pName = document.getElementById("tp" + i).value.trim();
        players.push(pName || "Unknown");
    }
    
    // Structure: rounds[0] = Quarterfinals(4 matches), rounds[1] = Semifinals(2 matches), rounds[2] = Final(1 match)
    tournamentData = {
        status: 'active',
        rounds: [
            [ {p1: players[0], p2: players[7], winner: null, score: null}, {p1: players[3], p2: players[4], winner: null, score: null}, {p1: players[2], p2: players[5], winner: null, score: null}, {p1: players[1], p2: players[6], winner: null, score: null} ],
            [ {p1: null, p2: null, winner: null, score: null}, {p1: null, p2: null, winner: null, score: null} ],
            [ {p1: null, p2: null, winner: null, score: null} ]
        ],
        finalWinner: null
    };
    saveTournament();
    renderTournament();
}

function renderTournament() {
    if(!tournamentData) {
        tourneySetupEl.classList.remove('hide'); tourneyBracketEl.classList.add('hide'); return;
    }
    tourneySetupEl.classList.add('hide'); tourneyBracketEl.classList.remove('hide');
    tourneyBracketEl.innerHTML = '';
    
    if(tournamentData.finalWinner) {
        let champBanner = document.createElement('div');
        champBanner.className = 'glass-panel text-center mb-4 rank-1';
        champBanner.innerHTML = `<h3 class="lb-rank">CHAMPION</h3><span class="view-title">${tournamentData.finalWinner}</span><br/><small class="text-muted">+250 ATP points awarded</small>`;
        tourneyBracketEl.appendChild(champBanner);
    }

    const roundNames = ["Quarterfinals", "Semifinals", "Finals"];
    tournamentData.rounds.forEach((round, roundIndex) => {
        let roundDiv = document.createElement('div'); roundDiv.className = 'bracket-round';
        let labelDiv = document.createElement('div'); labelDiv.className = 'bracket-round-header'; labelDiv.textContent = roundNames[roundIndex];
        roundDiv.appendChild(labelDiv);

        round.forEach((matchInfo, matchIndex) => {
            let mCard = document.createElement('div'); mCard.className = 'matchup-card';
            let isPlayable = (!matchInfo.winner && matchInfo.p1 && matchInfo.p2 && !tournamentData.finalWinner);
            
            let p1Cls = matchInfo.winner === matchInfo.p1 ? "winner" : (matchInfo.winner ? "loser" : "");
            let p2Cls = matchInfo.winner === matchInfo.p2 ? "winner" : (matchInfo.winner ? "loser" : "");

            let scoreHTML = matchInfo.score ? `<div class="match-score text-muted" style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; margin-top: 4px; text-align: right;">${matchInfo.score}</div>` : '';

            // Layout the card flexbox manually inside string since we're setting innerHTML
            let cardStyle = matchInfo.score || isPlayable ? 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;' : '';

            mCard.style.cssText = cardStyle;
            mCard.innerHTML = `
                <div class="player-stack" style="flex-grow: 1;">
                    <div class="player ${p1Cls}">${matchInfo.p1 || 'TBD'}</div>
                    <div class="player ${p2Cls}">${matchInfo.p2 || 'TBD'}</div>
                </div>
                ${scoreHTML}
                ${isPlayable ? `<button class="play-match-btn" onclick="startTournamentMatch(${roundIndex}, ${matchIndex}, '${matchInfo.p1}', '${matchInfo.p2}')">Play Match</button>` : ''}
            `;
            
            roundDiv.appendChild(mCard);
        });
        tourneyBracketEl.appendChild(roundDiv);
    });
}

window.startTournamentMatch = function(roundIndex, matchIndex, p1Name, p2Name) {
    fullMatchReset();
    matchState.p1.name = p1Name; matchState.p2.name = p2Name;
    matchState.activeTournamentMatch = { r: roundIndex, m: matchIndex };
    matchState.setsToWin = 1; // Default tournaments to 1 set for speed
    updateMatchUI();
    switchView('view-live');
    showToast(`Quarterfinal Started`);
}

function forceEndMatch() {
    if(matchState.activeTournamentMatch) {
        // Tournament Logic
        let rIdx = matchState.activeTournamentMatch.r;
        let mIdx = matchState.activeTournamentMatch.m;
        
        let p1Won = matchState.p1.sets > matchState.p2.sets;
        let winnerName = p1Won ? matchState.p1.name : matchState.p2.name;
        let loserName = p1Won ? matchState.p2.name : matchState.p1.name;
        
        // Format the score string (e.g., "6-4, 7-6" or "1-0 (Ret.)" if ended early)
        let setScores = [];
        let maxSets = Math.max(matchState.p1.setHistory.length, matchState.p2.setHistory.length);
        for(let i=0; i < maxSets; i++) {
            let s1 = matchState.p1.setHistory[i] !== undefined ? matchState.p1.setHistory[i] : (matchState.p1.games);
            let s2 = matchState.p2.setHistory[i] !== undefined ? matchState.p2.setHistory[i] : (matchState.p2.games);
            setScores.push(`${s1}-${s2}`);
        }
        
        // If match ended mid-set, add the current game score to history for display
        if (matchState.p1.games > 0 || matchState.p2.games > 0) {
           setScores.push(`${matchState.p1.games}-${matchState.p2.games} (Ret)`);
        }

        let scoreString = setScores.length > 0 ? setScores.join(', ') : "Walkover";

        tournamentData.rounds[rIdx][mIdx].winner = winnerName;
        tournamentData.rounds[rIdx][mIdx].score = scoreString;
        
        // Award Loser Points based on Round
        let pointsToLoser = 0;
        if(rIdx === 0) pointsToLoser = 45; // QF
        if(rIdx === 1) pointsToLoser = 90; // SF
        if(rIdx === 2) pointsToLoser = 150; // Final 
        awardPoints(loserName, pointsToLoser);

        // Advance Winner
        if (rIdx < 2) {
            let nextRIdx = rIdx + 1; let nextMIdx = Math.floor(mIdx / 2); let isP1Slot = mIdx % 2 === 0;
            if(isP1Slot) tournamentData.rounds[nextRIdx][nextMIdx].p1 = winnerName;
            else tournamentData.rounds[nextRIdx][nextMIdx].p2 = winnerName;
        } else {
            // Final finished
            tournamentData.finalWinner = winnerName; 
            tournamentData.status = 'completed';
            awardPoints(winnerName, 250); // Winner gets 250
        }
        
        saveTournament(); renderTournament();
        showToast("Match Recorded!");
        switchView('view-tournament');
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
    const el = document.createElement("div"); el.className = "toast"; el.textContent = msg; toastContainer.appendChild(el);
    setTimeout(() => { if(toastContainer.contains(el)) toastContainer.removeChild(el); }, 2600);
}

// --------- GUIDED TOUR ---------
const tourSteps = [
    { targetId: null, title: "Welcome to CourtSide", text: "Let's take a quick guided tour of your new premium tennis club companion." },
    { targetId: "view-live", highlightClass: ".point-scores", title: "Live Tracker", text: "Tap these large point cards to score. The app handles Deuce & Tiebreaks automatically.", view: "view-live" },
    { targetId: "live-controls", highlightClass: "#live-controls", title: "Match Controls", text: "Use these to Undo an accidental tap, or toggle between a 1-Set Match and Best-of-3 Sets.", view: "view-live" },
    { targetId: "nav-tourney", highlightClass: "#nav-tourney", title: "Tournaments", text: "Host an 8-player knockout tournament. Matches played here automatically advance the bracket!", view: "view-tournament" },
    { targetId: "nav-lb", highlightClass: "#nav-lb", title: "Leaderboards", text: "Tournament progress awards automatic ATP-style ranking points to players over time.", view: "view-leaderboard" }
];

let currentTourStep = 0;

function initWalkthrough() {
    if (!localStorage.getItem('cs_hasSeenTour')) {
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
    localStorage.setItem('cs_hasSeenTour', 'true');
    switchView('view-live'); 
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

init();
