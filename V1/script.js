// State Variables
let matchState = {
    p1: { name: "Player 1", points: 0, games: 0, sets: 0, setHistory: [] },
    p2: { name: "Player 2", points: 0, games: 0, sets: 0, setHistory: [] },
    server: 1, // 1 for p1, 2 for p2
    isTiebreak: false,
    history: [] // For undo functionality
};

const POINT_STRINGS = ["0", "15", "30", "40"];

// DOM Elements
const elUndo = document.getElementById("btn-undo");
const elReset = document.getElementById("btn-reset");
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

// Initialize
function init() {
    updateUI();
    attachEventListeners();
}

function attachEventListeners() {
    // Inputs sync
    p1NameInput.addEventListener("input", (e) => {
        matchState.p1.name = e.target.value || "Player 1";
        lblP1Name.textContent = matchState.p1.name;
    });
    
    p2NameInput.addEventListener("input", (e) => {
        matchState.p2.name = e.target.value || "Player 2";
        lblP2Name.textContent = matchState.p2.name;
    });

    // Score buttons
    btnP1Point.addEventListener("click", () => handlePoint(1));
    btnP2Point.addEventListener("click", () => handlePoint(2));

    // Control buttons
    elUndo.addEventListener("click", undoLastAction);
    elReset.addEventListener("click", resetMatchConfimation);
}

// Logic implementations
function saveState() {
    matchState.history.push(JSON.parse(JSON.stringify({
        p1: matchState.p1,
        p2: matchState.p2,
        server: matchState.server,
        isTiebreak: matchState.isTiebreak
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
        // Tiebreak rules
        // Win by reaching 7 with a 2 point lead
        if (pScoring.points >= 7 && pScoring.points - pOther.points >= 2) {
            handleGameWin(playerNum);
            return;
        }
        
        // Serve switches every odd total points in tiebreak
        let totalPoints = matchState.p1.points + matchState.p2.points;
        if (totalPoints % 2 === 1) {
            matchState.server = matchState.server === 1 ? 2 : 1;
        }

    } else {
        // Normal game rules
        // Win game by having >= 4 points (score 40+) and leading by 2
        if (pScoring.points >= 4 && pScoring.points - pOther.points >= 2) {
            handleGameWin(playerNum);
            return;
        }
    }

    updateUI();
    animateScore(playerNum);
}

function handleGameWin(playerNum) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    const pLosing = playerNum === 1 ? matchState.p2 : matchState.p1;
    
    showToast(`${pWinning.name} Wins Game`);
    
    pWinning.games++;
    matchState.p1.points = 0;
    matchState.p2.points = 0;
    
    // Switch server generally after a game, unless it was just the end of a match
    matchState.server = matchState.server === 1 ? 2 : 1;
    
    // Check Set Win condition
    // Win set by 6 games leading by 2 OR by 7 games (after tiebreak)
    if ( (pWinning.games >= 6 && pWinning.games - pLosing.games >= 2) || (pWinning.games === 7) ) {
        handleSetWin(playerNum);
        return;
    }

    // Check Trigger Tiebreak
    if (pWinning.games === 6 && pLosing.games === 6) {
        matchState.isTiebreak = true;
        showToast("Tiebreak!");
    } else {
        matchState.isTiebreak = false;
    }

    updateUI();
}

function handleSetWin(playerNum) {
    const pWinning = playerNum === 1 ? matchState.p1 : matchState.p2;
    showToast(`${pWinning.name} Wins Set`);
    
    // Push completed set score to history
    matchState.p1.setHistory.push(matchState.p1.games);
    matchState.p2.setHistory.push(matchState.p2.games);
    
    pWinning.sets++;
    
    matchState.p1.games = 0;
    matchState.p2.games = 0;
    matchState.isTiebreak = false;
    
    updateUI();
}

function undoLastAction() {
    if (matchState.history.length === 0) return;
    const lastConfig = matchState.history.pop();
    matchState.p1 = lastConfig.p1;
    matchState.p2 = lastConfig.p2;
    matchState.server = lastConfig.server;
    matchState.isTiebreak = lastConfig.isTiebreak;
    
    // Preserve history reference
    elUndo.disabled = matchState.history.length === 0;
    updateUI();
}

function resetMatchConfimation() {
    if(confirm("Are you sure you want to reset the entire match?")) {
        matchState = {
            p1: { name: p1NameInput.value, points: 0, games: 0, sets: 0, setHistory: [] },
            p2: { name: p2NameInput.value, points: 0, games: 0, sets: 0, setHistory: [] },
            server: 1,
            isTiebreak: false,
            history: []
        };
        elUndo.disabled = true;
        updateUI();
        showToast("Match Reset");
    }
}

// UI Updating
function updateUI() {
    // Determine the point display values
    let displayP1, displayP2;

    if (matchState.isTiebreak) {
        // Numeric increment
        displayP1 = matchState.p1.points;
        displayP2 = matchState.p2.points;
    } else {
        // Standard mapping (Love, 15, 30, 40, Deuce, Ad)
        let pts1 = matchState.p1.points;
        let pts2 = matchState.p2.points;

        if (pts1 >= 3 && pts2 >= 3) {
            if (pts1 === pts2) {
                displayP1 = "40"; 
                displayP2 = "40";
                gameStatusIndicator.textContent = "Deuce";
            } else if (pts1 === pts2 + 1) {
                displayP1 = "AD";
                displayP2 = "-";
                gameStatusIndicator.textContent = "Advantage " + matchState.p1.name;
            } else if (pts2 === pts1 + 1) {
                displayP1 = "-";
                displayP2 = "AD";
                gameStatusIndicator.textContent = "Advantage " + matchState.p2.name;
            }
        } else {
            displayP1 = POINT_STRINGS[pts1] || pts1; // fallback
            displayP2 = POINT_STRINGS[pts2] || pts2;
            gameStatusIndicator.textContent = "Set " + (matchState.p1.sets + matchState.p2.sets + 1) + ", Game " + (matchState.p1.games + matchState.p2.games + 1);
        }
    }
    
    if(matchState.isTiebreak) gameStatusIndicator.textContent = "Tiebreak";

    p1PointsEl.textContent = displayP1;
    p2PointsEl.textContent = displayP2;

    // Build Sets history display
    renderSetsHistory();
    
    // Update live games count
    p1GamesEl.textContent = matchState.p1.games;
    p2GamesEl.textContent = matchState.p2.games;

    // Serving Indicator
    p1ServeIndicator.classList.toggle("active", matchState.server === 1);
    p2ServeIndicator.classList.toggle("active", matchState.server === 2);
}

function renderSetsHistory() {
    // Clear out but keep the current-set span
    Array.from(p1SetsContainerEl.children).forEach(el => {
        if (!el.classList.contains("current-set")) el.remove();
    });
    Array.from(p2SetsContainerEl.children).forEach(el => {
        if (!el.classList.contains("current-set")) el.remove();
    });

    for(let i=0; i < matchState.p1.setHistory.length; i++) {
        let span1 = document.createElement("div");
        span1.className = "game-score";
        span1.textContent = matchState.p1.setHistory[i];
        p1SetsContainerEl.insertBefore(span1, p1GamesEl);

        let span2 = document.createElement("div");
        span2.className = "game-score";
        span2.textContent = matchState.p2.setHistory[i];
        p2SetsContainerEl.insertBefore(span2, p2GamesEl);
    }
}

function animateScore(playerNum) {
    const el = playerNum === 1 ? p1PointsEl : p2PointsEl;
    el.classList.remove("animate-pop");
    void el.offsetWidth; // trigger reflow
    el.classList.add("animate-pop");
}

function showToast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
        if(toastContainer.contains(el)) {
            toastContainer.removeChild(el);
        }
    }, 2600);
}

init();
