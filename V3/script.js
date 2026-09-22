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

Store.migrate();
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
const tourneyHubEl = document.getElementById('tourney-hub');
const tourneySetupEl = document.getElementById('tourney-setup');
const tourneyBracketEl = document.getElementById('tourney-bracket');
const tourneyActiveViewEl = document.getElementById('tourney-active-view');
const leaderboardListEl = document.getElementById('leaderboard-list');
const btnNewTourney = document.getElementById('btn-new-tourney');
const btnsHubReturn = document.querySelectorAll('.btn-hub-return');
const btnDeleteTourney = document.getElementById('btn-delete-tourney');
const btnCompleteTourney = document.getElementById('btn-complete-tourney');
const btnResetTourney = document.getElementById('btn-reset-tourney');
const btnResetLeaderboard = document.getElementById('btn-reset-leaderboard');

// --------- INITIALIZATION ---------
function init() {
    initProfiles();
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
    
    btnNewTourney.addEventListener("click", () => {
        tourneyHubEl.classList.add('hide');
        tourneySetupEl.classList.remove('hide');
        tourneyActiveViewEl.classList.add('hide');
        updateWideMode();
    });

    btnsHubReturn.forEach(btn => {
        btn.addEventListener("click", () => {
            activeTournamentId = null;
            renderTournamentHub();
            updateWideMode();
        });
    });

    btnDeleteTourney.addEventListener("click", () => {
        showConfirm("Delete this tournament forever?", () => {
            tournamentData = tournamentData.filter(t => t.id !== activeTournamentId);
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("Tournament Deleted");
        }, null, "Delete Tournament");
    });

    btnCompleteTourney.addEventListener("click", () => {
        showConfirm("Mark this tournament as completed? It will be moved to the Champions Archive.", () => {
            let t = tournamentData.find(t => t.id === activeTournamentId);
            if(t) t.status = 'completed';
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("Tournament Completed");
        }, null, "Complete Tournament");
    });
    
    btnResetTourney.addEventListener("click", () => {
        showConfirm("Clear ALL active and archived tournaments? This action cannot be undone.", () => {
            tournamentData = [];
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("All Tournaments Cleared");
        }, null, "Reset Tournaments");
    });

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
    if (targetViewId === 'view-tournament' && !activeTournamentId) {
        headerControls.tourney.style.display = 'flex';
        btnResetTourney.style.display = 'flex';
    } else {
        headerControls.tourney.style.display = 'none';
        btnResetTourney.style.display = 'none';
    }
    headerControls.lb.style.display = targetViewId === 'view-leaderboard' ? 'flex' : 'none';
    
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
function saveTournament() {
    if (!Store.save('tournament', tournamentData)) warnStorageFull();
}
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

function handleStartTournament() {
    let tName = document.getElementById("t-name").value.trim() || "Club Tournament";
    let tCat = document.getElementById("t-category").value;
    let playersRaw = document.getElementById("t-players-list").value.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    
    if (playersRaw.length < 2) {
        showToast("Enter at least 2 players");
        return;
    }

    // Shuffle players randomly for seeding
    let players = playersRaw.sort(() => Math.random() - 0.5);
    
    // Calculate nearest power of 2 for bracket size (2, 4, 8, 16, 32, 64)
    let bracketSize = Math.pow(2, Math.ceil(Math.log2(players.length)));
    
    // Fill the rest with "BYE"
    let numByes = bracketSize - players.length;
    for(let i=0; i < numByes; i++) {
        players.push("BYE");
    }

    // Generate Rounds Array dynamically
    let numRounds = Math.log2(bracketSize);
    let rounds = [];
    
    // Round 1 (Initial Matches)
    let round1 = [];
    for(let i=0; i < bracketSize; i += 2) {
        round1.push({
            p1: players[i], 
            p2: players[i+1], 
            winner: null, 
            score: null
        });
    }
    rounds.push(round1);

    // Subsequent Rounds
    let currentMatchesNum = round1.length;
    for(let i=1; i < numRounds; i++) {
        currentMatchesNum = currentMatchesNum / 2;
        let emptyRound = [];
        for(let m=0; m < currentMatchesNum; m++) {
            emptyRound.push({p1: null, p2: null, winner: null, score: null});
        }
        rounds.push(emptyRound);
    }
    
    let newTournament = {
        id: Date.now().toString(),
        name: tName,
        category: tCat,
        status: 'active',
        rounds: rounds,
        finalWinner: null
    };
    
    tournamentData.push(newTournament);
    activeTournamentId = newTournament.id;
    saveTournament();
    renderTournament();
}

// --------- HUB LOGIC --------- //

function renderTournamentHub() {
    tourneySetupEl.classList.add('hide'); 
    tourneyActiveViewEl.classList.add('hide'); 
    tourneyHubEl.classList.remove('hide');
    headerControls.tourney.style.display = 'flex';
    btnResetTourney.style.display = 'flex';
    updateWideMode();

    const activeList = document.getElementById("hub-active-list");
    const archiveList = document.getElementById("hub-archive-list");
    activeList.innerHTML = ''; archiveList.innerHTML = '';

    let actives = tournamentData.filter(t => t.status === 'active');
    let archives = tournamentData.filter(t => t.status === 'completed');

    if (actives.length === 0) activeList.innerHTML = `<p class="text-muted text-center" style="font-size: 0.9rem;">No active tournaments.</p>`;
    actives.forEach(t => activeList.appendChild(createHubCard(t)));

    if (archives.length === 0) archiveList.innerHTML = `<p class="text-muted text-center" style="font-size: 0.9rem;">No archived tournaments.</p>`;
    archives.forEach(t => archiveList.appendChild(createHubCard(t)));
}

window.openTournament = function(id) {
    activeTournamentId = id;
    renderTournament();
}

function createHubCard(t) {
    let card = document.createElement('div');
    card.className = 'glass-panel';
    card.style.padding = '1rem'; card.style.display = 'flex'; card.style.justifyContent = 'space-between'; card.style.alignItems = 'center';
    
    let isArchived = t.status === 'completed';
    let champText = isArchived && t.finalWinner ? `<div style="color: var(--gold); font-weight: bold; font-size: 0.85rem; margin-top: 4px;">🏆 ${t.finalWinner}</div>` : '';

    card.innerHTML = `
        <div>
            <div class="view-title" style="margin-bottom: 2px; text-align: left; font-size: 1.1rem; color: #fff;">${t.name}</div>
            <div class="text-muted" style="font-size: 0.8rem; text-transform: uppercase;">${t.category}</div>
            ${champText}
        </div>
        <button class="primary-btn" style="padding: 0.5rem 1rem; font-size: 0.9rem;" onclick="openTournament('${t.id}')">${isArchived ? 'View Bracket' : 'Resume'}</button>
    `;
    return card;
}

// Ensure BYEs are auto-resolved 
function checkAndResolveByes(tourney) {
    if(!tourney || tourney.status === 'completed') return false;
    let modified = false;

    // Scan ONLY the active rounds (where both players exist but no winner is declared)
    tourney.rounds.forEach((round, rIndex) => {
        round.forEach((match, mIndex) => {
            if (!match.winner && match.p1 && match.p2) {
                if (match.p1 === "BYE" || match.p2 === "BYE") {
                    // Auto advance the real player
                    let winner = match.p1 === "BYE" ? match.p2 : match.p1;
                    match.winner = winner;
                    match.score = "Walkover";
                    modified = true;

                    // Advance Winner
                    if (rIndex < tourney.rounds.length - 1) {
                        let nextRIdx = rIndex + 1; 
                        let nextMIdx = Math.floor(mIndex / 2); 
                        let isP1Slot = mIndex % 2 === 0;
                        if(isP1Slot) tourney.rounds[nextRIdx][nextMIdx].p1 = winner;
                        else tourney.rounds[nextRIdx][nextMIdx].p2 = winner;
                    } else {
                        tourney.finalWinner = winner;
                        tourney.status = 'completed';
                    }
                }
            }
        });
    });
    
    if(modified) saveTournament();
    return modified;
}

function updateWideMode() {
    const isBracketActive = document.getElementById('view-tournament').classList.contains('active-view') && !document.getElementById('tourney-active-view').classList.contains('hide');
    const appContainer = document.querySelector('.app-container');

    if (isBracketActive && activeTournamentId) {
        let t = tournamentData.find(t => t.id === activeTournamentId);
        if (t) {
            let roundsCount = t.rounds.length;
            let optimalWidth = (roundsCount * 272) + 150;
            appContainer.style.setProperty('--dynamic-max-width', optimalWidth + 'px');
            appContainer.classList.add('wide-mode');
            return;
        }
    }
    appContainer.classList.remove('wide-mode');
    appContainer.style.removeProperty('--dynamic-max-width');
}

function renderTournament() {
    if(!activeTournamentId) return renderTournamentHub();
    
    let activeTourney = tournamentData.find(t => t.id === activeTournamentId);
    if(!activeTourney) return renderTournamentHub();

    // Auto-resolve Byes before rendering. loop until no more cascade.
    while(checkAndResolveByes(activeTourney)) {}

    tourneyHubEl.classList.add('hide');
    tourneySetupEl.classList.add('hide'); 
    tourneyActiveViewEl.classList.remove('hide');
    headerControls.tourney.style.display = 'none';
    btnResetTourney.style.display = 'none';
    
    updateWideMode();
    
    // Set Header
    document.getElementById('th-name').textContent = activeTourney.name;
    document.getElementById('th-cat').textContent = activeTourney.category;
    
    tourneyBracketEl.innerHTML = '';
    
    if(activeTourney.finalWinner) {
        let champBanner = document.createElement('div');
        champBanner.className = 'glass-panel text-center mb-4 rank-1';
        champBanner.innerHTML = `<h3 class="lb-rank" style="width:100%; margin-bottom: 8px;">CHAMPION</h3><span class="view-title">${activeTourney.finalWinner}</span><br/><small class="text-muted">+250 ATP points awarded</small>`;
        tourneyBracketEl.appendChild(champBanner);
    }

    // Calculate dynamic round names based on total rounds
    const totalRoundsNum = activeTourney.rounds.length;
    
    // Add horizontal wrapper for big brackets
    let outerWrapper = document.createElement('div');
    outerWrapper.style.display = 'flex';
    outerWrapper.style.overflowX = 'auto';
    outerWrapper.style.paddingBottom = '1rem';
    outerWrapper.style.paddingRight = '2rem'; // Space for right-most branches

    activeTourney.rounds.forEach((round, roundIndex) => {
        let roundDiv = document.createElement('div'); 
        roundDiv.className = 'bracket-round';
        roundDiv.style.minWidth = '240px';
        roundDiv.style.display = 'flex';
        roundDiv.style.flexDirection = 'column';
        roundDiv.style.flex = '1';
        
        if (roundIndex < totalRoundsNum - 1) {
            roundDiv.style.marginRight = '2rem'; // EXACT space for 2rem C-clamp connectors
        }

        let labelDiv = document.createElement('div'); 
        labelDiv.className = 'bracket-round-header'; 
        
        let matchesInRound = round.length;
        if(matchesInRound === 1) labelDiv.textContent = "Finals";
        else if(matchesInRound === 2) labelDiv.textContent = "Semifinals";
        else if(matchesInRound === 4) labelDiv.textContent = "Quarterfinals";
        else labelDiv.textContent = "Round of " + (matchesInRound * 2);

        roundDiv.appendChild(labelDiv);

        let matchContainer = document.createElement('div');
        matchContainer.style.display = 'flex';
        matchContainer.style.flexDirection = 'column';
        matchContainer.style.flex = '1';

        for (let i = 0; i < round.length; i += 2) {
            if (i + 1 < round.length) {
                // Pair
                let pairDiv = document.createElement('div');
                pairDiv.className = 'bracket-match-pair';
                
                let wrapper1 = document.createElement('div');
                wrapper1.className = 'matchup-wrapper';
                wrapper1.appendChild(createMatchCard(activeTourney, round[i], roundIndex, i));
                
                let wrapper2 = document.createElement('div');
                wrapper2.className = 'matchup-wrapper';
                wrapper2.appendChild(createMatchCard(activeTourney, round[i+1], roundIndex, i+1));

                pairDiv.appendChild(wrapper1);
                pairDiv.appendChild(wrapper2);
                matchContainer.appendChild(pairDiv);
            } else {
                // Single (Finals usually)
                let singleDiv = document.createElement('div');
                singleDiv.className = 'matchup-wrapper';
                singleDiv.appendChild(createMatchCard(activeTourney, round[i], roundIndex, i));
                matchContainer.appendChild(singleDiv);
            }
        }
        
        roundDiv.appendChild(matchContainer);
        outerWrapper.appendChild(roundDiv);
    });
    
    tourneyBracketEl.appendChild(outerWrapper);
}

function createMatchCard(activeTourney, matchInfo, roundIndex, matchIndex) {
    let mCard = document.createElement('div'); 
    mCard.className = 'matchup-card';
    let isPlayable = (!matchInfo.winner && matchInfo.p1 && matchInfo.p2 && matchInfo.p1 !== "BYE" && matchInfo.p2 !== "BYE" && !activeTourney.finalWinner);
    
    let p1Cls = matchInfo.winner === matchInfo.p1 ? "winner" : (matchInfo.winner ? "loser" : "");
    let p2Cls = matchInfo.winner === matchInfo.p2 ? "winner" : (matchInfo.winner ? "loser" : "");

    let p1NameDisp = matchInfo.p1 || 'TBD';
    let p2NameDisp = matchInfo.p2 || 'TBD';
    if(p1NameDisp === "BYE") p1NameDisp = `<span style="opacity: 0.3;">BYE</span>`;
    if(p2NameDisp === "BYE") p2NameDisp = `<span style="opacity: 0.3;">BYE</span>`;

    let scoreHTML = matchInfo.score ? `<div class="match-score text-muted" style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; margin-top: 4px; text-align: right;">${matchInfo.score}</div>` : '';

    let cardStyle = matchInfo.score || isPlayable ? 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;' : '';

    mCard.style.cssText = cardStyle;
    mCard.innerHTML = `
        <div class="player-stack" style="flex-grow: 1;">
            <div class="player ${p1Cls}">${p1NameDisp}</div>
            <div class="player ${p2Cls}">${p2NameDisp}</div>
        </div>
        ${scoreHTML}
        ${isPlayable ? `<button class="play-match-btn" onclick="startTournamentMatch(${roundIndex}, ${matchIndex}, '${matchInfo.p1}', '${matchInfo.p2}')">Play Match</button>` : ''}
    `;
    return mCard;
}

window.startTournamentMatch = function(roundIndex, matchIndex, p1Name, p2Name) {
    fullMatchReset();
    matchState.p1.name = p1Name; matchState.p2.name = p2Name;
    matchState.activeTournamentMatch = { r: roundIndex, m: matchIndex, tId: activeTournamentId };
    matchState.setsToWin = 1; // Default tournaments to 1 set for speed
    updateMatchUI();
    switchView('view-live');
    showToast(`Quarterfinal Started`);
}

function forceEndMatch() {
    if(matchState.activeTournamentMatch && matchState.activeTournamentMatch.tId) {
        let tId = matchState.activeTournamentMatch.tId;
        let activeTourney = tournamentData.find(t => t.id === tId);
        if(!activeTourney) return fullMatchReset();

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

        activeTourney.rounds[rIdx][mIdx].winner = winnerName;
        activeTourney.rounds[rIdx][mIdx].score = scoreString;
        
        // Award Loser Points based on Round
        let pointsToLoser = 0;
        if(rIdx === 0) pointsToLoser = 45; // QF
        if(rIdx === 1) pointsToLoser = 90; // SF
        if(rIdx === 2) pointsToLoser = 150; // Final 
        awardPoints(loserName, pointsToLoser);

        // Advance Winner
        if (rIdx < activeTourney.rounds.length - 1) {
            let nextRIdx = rIdx + 1; let nextMIdx = Math.floor(mIdx / 2); let isP1Slot = mIdx % 2 === 0;
            if(isP1Slot) activeTourney.rounds[nextRIdx][nextMIdx].p1 = winnerName;
            else activeTourney.rounds[nextRIdx][nextMIdx].p2 = winnerName;
        } else {
            // Final finished
            activeTourney.finalWinner = winnerName; 
            activeTourney.status = 'completed';
            awardPoints(winnerName, 250); // Winner gets 250
        }
        
        activeTournamentId = tId;
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
    { targetId: null, title: "Welcome to Racquetback", text: "Let's take a quick guided tour of your new premium tennis club companion." },
    { targetId: "view-live", highlightClass: ".point-scores", title: "Live Tracker", text: "Tap these large point cards to score. The app handles Deuce & Tiebreaks automatically.", view: "view-live" },
    { targetId: "live-controls", highlightClass: "#live-controls", title: "Match Controls", text: "Use these to Undo an accidental tap, or toggle between a 1-Set Match and Best-of-3 Sets.", view: "view-live" },
    { targetId: "nav-tourney", highlightClass: "#nav-tourney", title: "Tournaments", text: "Host an 8-player knockout tournament. Matches played here automatically advance the bracket!", view: "view-tournament" },
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

    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = Store.exportFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup downloaded');
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
    Store.requestPersistence();

    if (!Store.isReliable()) {
        setTimeout(() => showToast('Private mode: progress will not be saved'), 1200);
    }
}


init();
