// --------- TOURNAMENTS ---------
// Hub, setup and bracket views. Loaded before script.js; everything that
// touches the live match (matchState, showToast, switchView...) is only used
// inside functions, which run after script.js has defined it.
//
// Data model (persisted per profile under 'tournament'):
//   { id, name, category, format, status: 'active'|'completed', createdAt,
//     completedAt, finalWinner, seeds: { name: seedNumber },
//     rounds: [[{ p1, p2, winner, score }]] }
// Players are identified by name, so setup keeps names unique.

const TOURNEY_CATEGORIES = ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"];
const BYE = "BYE";
const MAX_TOURNEY_PLAYERS = 64;

const tourneyHubEl = document.getElementById('tourney-hub');
const tourneySetupEl = document.getElementById('tourney-setup');
const tourneyActiveViewEl = document.getElementById('tourney-active-view');
const tourneyBracketEl = document.getElementById('tourney-bracket');
const tourneyTabsEl = document.getElementById('tourney-round-tabs');
const tourneyMenuEl = document.getElementById('tourney-menu');
const btnTourneyMenu = document.getElementById('btn-tourney-menu');
const btnStartTourney = document.getElementById('btn-start-tourney');

// Which round tab is showing, per tournament (mobile shows one round at a time).
const selectedRoundByTourney = {};

// seeds: names in seed order (index 0 is seed 1).
let setupState = { players: [], seeds: [], category: TOURNEY_CATEGORIES[0], format: 'one-set' };

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function saveTournament() {
    if (!Store.save('tournament', tournamentData)) warnStorageFull();
}

function activeTourney() {
    if (sharedTourney && activeTournamentId === 'shared') return sharedTourney;
    return tournamentData.find(t => t.id === activeTournamentId) || null;
}

// --------- ROUND NAMING ---------
function roundLabel(matchesInRound) {
    if (matchesInRound === 1) return "Finals";
    if (matchesInRound === 2) return "Semifinals";
    if (matchesInRound === 4) return "Quarterfinals";
    return "Round of " + (matchesInRound * 2);
}

function roundShort(matchesInRound) {
    if (matchesInRound === 1) return "Final";
    if (matchesInRound === 2) return "SF";
    if (matchesInRound === 4) return "QF";
    return "R" + (matchesInRound * 2);
}

// "Final", "Semifinal 2", "Round of 16 · Match 3"
function matchName(t, r, m) {
    const n = t.rounds[r].length;
    if (n === 1) return "Final";
    if (n === 2) return "Semifinal " + (m + 1);
    if (n === 4) return "Quarterfinal " + (m + 1);
    return roundLabel(n) + " · Match " + (m + 1);
}

function matchCode(t, r, m) {
    const n = t.rounds[r].length;
    return n === 1 ? "Final" : roundShort(n) + " " + (m + 1);
}

// --------- BRACKET MATHS ---------
function isByeMatch(match) {
    return match.p1 === BYE || match.p2 === BYE;
}

function realPlayers(t) {
    return t.rounds[0].reduce((list, match) => {
        [match.p1, match.p2].forEach(p => { if (p && p !== BYE) list.push(p); });
        return list;
    }, []);
}

function tourneyProgress(t) {
    const total = Math.max(realPlayers(t).length - 1, 0); // knockout: one match eliminates one player
    let played = 0;
    t.rounds.forEach(round => round.forEach(match => {
        if (match.winner && !isByeMatch(match)) played++;
    }));
    return { played: Math.min(played, total), total: total };
}

// First round that still has an undecided match; the final once it's all done.
function currentRoundIndex(t) {
    for (let r = 0; r < t.rounds.length; r++) {
        if (t.rounds[r].some(match => !match.winner)) return r;
    }
    return t.rounds.length - 1;
}

function isPlayable(t, match) {
    return !t.readOnly && t.status === 'active' && !t.finalWinner && !match.winner &&
        match.p1 && match.p2 && !isByeMatch(match);
}

function nextPlayableMatch(t) {
    for (let r = 0; r < t.rounds.length; r++) {
        for (let m = 0; m < t.rounds[r].length; m++) {
            if (isPlayable(t, t.rounds[r][m])) return { r: r, m: m, match: t.rounds[r][m] };
        }
    }
    return null;
}

function isLiveMatch(t, r, m) {
    if (t.readOnly) return !!t.live && t.live.r === r && t.live.m === m;
    const live = matchState.activeTournamentMatch;
    return !!live && live.tId === t.id && live.r === r && live.m === m && matchHasStarted();
}

function runnerUp(t) {
    const final = t.rounds[t.rounds.length - 1][0];
    if (!final || !final.winner) return null;
    return final.winner === final.p1 ? final.p2 : final.p1;
}

// "6-4, 7-6(5)" -> [{ a: 6, b: 4 }, { a: 7, b: 6, tb: 5 }]. Handles "(Ret)" and "Walkover".
function parseScore(score) {
    const out = { sets: [], retired: false, walkover: score === 'Walkover' };
    if (!score || out.walkover) return out;
    score.split(',').forEach(part => {
        const m = part.trim().match(/^(\d+)-(\d+)(?:\((\d+)\))?\s*(\(Ret\))?$/i);
        if (!m) return;
        out.sets.push({ a: Number(m[1]), b: Number(m[2]), tb: m[3] !== undefined ? Number(m[3]) : null });
        if (m[4]) out.retired = true;
    });
    return out;
}

// Standard draw positions: seed order for a bracket of `size` slots, e.g.
// 8 -> [1, 8, 5, 4, 3, 6, 7, 2]. Slots pair up in order (1 v 8, 5 v 4, ...):
// seed 1 on the top line, seed 2 on the bottom, 3 and 4 in the inner quarters.
function seedOrder(size) {
    if (size < 2) return [1];
    let order = [1, 2];
    while (order.length < size) {
        const sum = order.length * 2 + 1;
        order = order.flatMap((s, i) => i % 2 === 0 ? [s, sum - s] : [sum - s, s]);
    }
    return order;
}

// `ranked` is strongest first: seeds in seed order, then everyone else. Slot
// numbers past the player count are byes, so byes go to the top-ranked
// players, and a bye never meets a bye.
function buildRounds(ranked) {
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(ranked.length)));
    const order = seedOrder(bracketSize);

    const rounds = [];
    const first = [];
    for (let m = 0; m < bracketSize / 2; m++) {
        // Higher-ranked player on the top row (a bye always goes underneath).
        const [a, b] = [order[m * 2], order[m * 2 + 1]].sort((x, y) => x - y);
        first.push({ p1: ranked[a - 1] || BYE, p2: ranked[b - 1] || BYE, winner: null, score: null });
    }
    rounds.push(first);
    for (let n = bracketSize / 4; n >= 1; n /= 2) {
        rounds.push(Array.from({ length: n }, () => ({ p1: null, p2: null, winner: null, score: null })));
    }
    return rounds;
}

function drawSizeFor(count) {
    return Math.pow(2, Math.ceil(Math.log2(Math.max(count, 2))));
}

// Seeding more than half the draw can't keep seeds apart; a quarter of the
// draw is the usual number (16-draw -> 4 seeds).
function maxSeeds(count) {
    return Math.max(1, drawSizeFor(count) / 2);
}

function seedOf(t, name) {
    return t.seeds && name ? t.seeds[name] || null : null;
}

function advanceWinner(t, r, m, winner) {
    if (r < t.rounds.length - 1) {
        const next = t.rounds[r + 1][Math.floor(m / 2)];
        if (m % 2 === 0) next.p1 = winner; else next.p2 = winner;
    } else {
        t.finalWinner = winner;
        t.status = 'completed';
        t.completedAt = Date.now();
    }
}

// Auto-advance players drawn against a bye. Returns true if anything changed.
function checkAndResolveByes(t) {
    if (!t || t.readOnly || t.status === 'completed') return false;
    let modified = false;
    t.rounds.forEach((round, r) => {
        round.forEach((match, m) => {
            if (!match.winner && match.p1 && match.p2 && isByeMatch(match)) {
                match.winner = match.p1 === BYE ? match.p2 : match.p1;
                match.score = "Walkover";
                advanceWinner(t, r, m, match.winner);
                modified = true;
            }
        });
    });
    if (modified) saveTournament();
    return modified;
}

// Ranking points for the loser by how far they got; the champion gets 250.
function loserPoints(t, r) {
    const fromFinal = t.rounds.length - 1 - r;
    return [150, 90, 45][fromFinal] || 20;
}

// --------- INIT ---------
function initTournament() {
    document.getElementById('btn-new-tourney').addEventListener('click', openTournamentSetup);
    document.getElementById('btn-new-tourney-empty').addEventListener('click', openTournamentSetup);

    document.querySelectorAll('.btn-hub-return').forEach(btn => btn.addEventListener('click', () => {
        activeTournamentId = null;
        renderTournamentHub();
    }));

    // Hub cards
    ['hub-active-list', 'hub-archive-list'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            const card = e.target.closest('[data-tourney-id]');
            if (card) openTournament(card.dataset.tourneyId);
        });
    });

    document.getElementById('btn-reset-tourney').addEventListener('click', () => {
        showConfirm("Delete every tournament, in progress and archived? Ranking points are kept. This can't be undone.", () => {
            if (matchState.activeTournamentMatch) fullMatchReset();
            tournamentData = [];
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("Tournaments cleared");
        }, null, "Clear All Tournaments");
    });

    initTournamentSetup();
    initTournamentDetail();

    document.getElementById('live-tourney-context').addEventListener('click', () => {
        const live = matchState.activeTournamentMatch;
        if (!live) return;
        switchView('view-tournament');
        openTournament(live.tId);
    });
}

function showTourneyPane(pane) {
    tourneyHubEl.classList.toggle('hide', pane !== 'hub');
    tourneySetupEl.classList.toggle('hide', pane !== 'setup');
    tourneyActiveViewEl.classList.toggle('hide', pane !== 'detail');
    document.getElementById('view-tournament').scrollTop = 0;
    updateWideMode();
}

window.openTournament = function(id) {
    activeTournamentId = id;
    renderTournament();
};

// --------- HUB ---------
function renderTournamentHub() {
    showTourneyPane('hub');

    const actives = tournamentData.filter(t => t.status === 'active');
    const archives = tournamentData.filter(t => t.status === 'completed')
        .sort((a, b) => (b.completedAt || Number(b.id) || 0) - (a.completedAt || Number(a.id) || 0));

    const empty = tournamentData.length === 0;
    document.getElementById('hub-empty').classList.toggle('hide', !empty);
    document.getElementById('btn-reset-tourney').classList.toggle('hide', empty);
    document.getElementById('hub-active-section').classList.toggle('hide', actives.length === 0);
    document.getElementById('hub-archive-section').classList.toggle('hide', archives.length === 0);

    const parts = [];
    if (actives.length) parts.push(actives.length + ' in progress');
    if (archives.length) parts.push(archives.length + ' completed');
    document.getElementById('hub-sub').textContent = parts.length ? parts.join(' · ') : 'Knockout brackets for your club';
    document.getElementById('hub-active-count').textContent = actives.length || '';
    document.getElementById('hub-archive-count').textContent = archives.length || '';

    const activeList = document.getElementById('hub-active-list');
    const archiveList = document.getElementById('hub-archive-list');
    activeList.innerHTML = actives.map(activeHubCard).join('');
    archiveList.innerHTML = archives.map(archiveHubCard).join('');
}

const CHEVRON = '<svg class="t-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
const TROPHY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"></path><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"></path></svg>';

function formatLabelFor(t) {
    return (MATCH_FORMATS[t.format] || MATCH_FORMATS['one-set']).label;
}

function formatShortDate(ts) {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
}

function activeHubCard(t) {
    const prog = tourneyProgress(t);
    const pctDone = prog.total ? Math.round(prog.played / prog.total * 100) : 0;
    const stage = roundLabel(t.rounds[currentRoundIndex(t)].length);
    const next = nextPlayableMatch(t);
    const live = matchState.activeTournamentMatch && matchState.activeTournamentMatch.tId === t.id && matchHasStarted();
    const nextLine = next
        ? `<div class="t-hub-next">${live ? '<span class="t-live-dot"></span>Match in progress' : 'Up next'}<span class="t-hub-next-names">${escapeHTML(next.match.p1)} vs ${escapeHTML(next.match.p2)}</span></div>`
        : '';

    return `
        <button class="t-hub-card" type="button" data-tourney-id="${escapeHTML(t.id)}">
            <div class="t-hub-row">
                <span class="t-hub-name">${escapeHTML(t.name)}</span>
                ${CHEVRON}
            </div>
            <div class="t-hub-meta">
                <span class="t-chip">${escapeHTML(t.category)}</span>
                <span>${realPlayers(t).length} players</span>
                <span class="t-dot-sep">·</span>
                <span>${escapeHTML(formatLabelFor(t))}</span>
            </div>
            <div class="t-hub-progress">
                <span class="t-hub-stage">${escapeHTML(stage)}</span>
                <span class="t-hub-count">${prog.played}/${prog.total} played</span>
            </div>
            <div class="t-bar-track"><i style="width:${pctDone}%"></i></div>
            ${nextLine}
        </button>`;
}

function archiveHubCard(t) {
    const hasChamp = !!t.finalWinner;
    const second = runnerUp(t);
    const when = formatShortDate(t.completedAt || Number(t.id));
    const detail = hasChamp
        ? (second ? 'def. ' + escapeHTML(second) + ' in the final' : 'Champion')
        : 'Archived before the final';
    return `
        <button class="t-hub-card is-archived${hasChamp ? '' : ' no-champ'}" type="button" data-tourney-id="${escapeHTML(t.id)}">
            <span class="t-archive-medal">${TROPHY}</span>
            <span class="t-archive-body">
                <span class="t-archive-name">${escapeHTML(t.name)}</span>
                <span class="t-archive-champ">${hasChamp ? escapeHTML(t.finalWinner) : 'No champion'}</span>
                <span class="t-archive-detail">${detail}</span>
                <span class="t-archive-foot">${escapeHTML(t.category)}${when ? ' · ' + escapeHTML(when) : ''}</span>
            </span>
            ${CHEVRON}
        </button>`;
}

// --------- SETUP ---------
function initTournamentSetup() {
    const categoryEl = document.getElementById('t-category');
    categoryEl.innerHTML = TOURNEY_CATEGORIES.map(c =>
        `<button type="button" class="t-chip-btn" role="radio" data-value="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('');
    categoryEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.t-chip-btn');
        if (!chip) return;
        setupState.category = chip.dataset.value;
        renderSetupChips();
    });

    const formatEl = document.getElementById('t-format');
    formatEl.innerHTML = Object.keys(MATCH_FORMATS).map(key =>
        `<button type="button" class="t-chip-btn" role="radio" data-value="${key}">${escapeHTML(MATCH_FORMATS[key].label)}</button>`).join('');
    formatEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.t-chip-btn');
        if (!chip) return;
        setupState.format = chip.dataset.value;
        renderSetupChips();
    });

    const input = document.getElementById('t-player-input');
    document.getElementById('t-player-form').addEventListener('submit', (e) => {
        e.preventDefault();
        addSetupPlayers(input.value);
        input.value = '';
        input.focus();
    });
    // Pasting a column of names adds them all.
    input.addEventListener('paste', (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\n\r\t]/.test(text)) return;
        e.preventDefault();
        addSetupPlayers(text);
        input.value = '';
    });

    document.getElementById('t-player-list').addEventListener('click', (e) => {
        const remove = e.target.closest('[data-remove]');
        if (remove) {
            const [name] = setupState.players.splice(Number(remove.dataset.remove), 1);
            setupState.seeds = setupState.seeds.filter(n => n !== name);
            renderSetupPlayers();
            return;
        }
        const seedBtn = e.target.closest('[data-seed]');
        if (seedBtn) toggleSeed(setupState.players[Number(seedBtn.dataset.seed)]);
    });

    document.getElementById('t-seed-rankings').addEventListener('click', seedFromRankings);
    document.getElementById('t-seed-clear').addEventListener('click', () => {
        setupState.seeds = [];
        renderSetupPlayers();
    });

    document.getElementById('t-shuffle').addEventListener('change', renderShuffleHint);

    btnStartTourney.addEventListener('click', handleStartTournament);
}

function openTournamentSetup() {
    setupState = { players: [], seeds: [], category: TOURNEY_CATEGORIES[0], format: 'one-set' };
    document.getElementById('t-name').value = '';
    document.getElementById('t-player-input').value = '';
    document.getElementById('t-shuffle').checked = true;
    renderShuffleHint();
    showSetupError('');
    renderSetupChips();
    renderSetupPlayers();
    activeTournamentId = null;
    showTourneyPane('setup');
}

function renderSetupChips() {
    [['t-category', setupState.category], ['t-format', setupState.format]].forEach(([id, value]) => {
        document.querySelectorAll('#' + id + ' .t-chip-btn').forEach(chip => {
            const on = chip.dataset.value === value;
            chip.classList.toggle('is-selected', on);
            chip.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    });
}

function showSetupError(msg) {
    const el = document.getElementById('t-player-error');
    el.textContent = msg;
    el.classList.toggle('hide', !msg);
}

function addSetupPlayers(raw) {
    const names = String(raw).split(/[\n\r\t]+/).map(n => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const skipped = [];
    names.forEach(name => {
        const key = name.toLowerCase();
        if (key === BYE.toLowerCase()) { skipped.push(`"${name}" is reserved`); return; }
        if (setupState.players.some(p => p.toLowerCase() === key)) { skipped.push(`${name} is already in`); return; }
        if (setupState.players.length >= MAX_TOURNEY_PLAYERS) { skipped.push(`max ${MAX_TOURNEY_PLAYERS} players`); return; }
        setupState.players.push(name);
    });
    showSetupError(skipped.length ? 'Skipped: ' + Array.from(new Set(skipped)).join(', ') : '');
    renderSetupPlayers();
}

function renderShuffleHint() {
    document.getElementById('t-shuffle-sub').textContent = document.getElementById('t-shuffle').checked
        ? 'Unseeded players are shuffled into the draw'
        : 'Unseeded players go in list order, strongest first';
}

// Tapping the star makes a player the next seed; tapping a seed removes it
// and the seeds below move up.
function toggleSeed(name) {
    if (!name) return;
    const at = setupState.seeds.indexOf(name);
    if (at >= 0) {
        setupState.seeds.splice(at, 1);
    } else if (setupState.seeds.length >= maxSeeds(setupState.players.length)) {
        showToast(`Up to ${maxSeeds(setupState.players.length)} seeds for this draw`);
        return;
    } else {
        setupState.seeds.push(name);
    }
    renderSetupPlayers();
}

function rankedSetupPlayers() {
    return setupState.players
        .filter(name => (leaderboardData[name] || 0) > 0)
        .sort((a, b) => leaderboardData[b] - leaderboardData[a]);
}

function seedFromRankings() {
    const ranked = rankedSetupPlayers();
    if (!ranked.length) { showToast('No ranking points yet'); return; }
    const count = Math.max(1, drawSizeFor(setupState.players.length) / 4);
    setupState.seeds = ranked.slice(0, count);
    renderSetupPlayers();
    showToast(`Seeded ${setupState.seeds.length} from rankings`);
}

const STAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>';

function renderSetupPlayers() {
    const list = document.getElementById('t-player-list');
    const players = setupState.players;
    // Removing players can shrink the draw below the seeds already chosen.
    setupState.seeds = setupState.seeds.filter(n => players.includes(n)).slice(0, maxSeeds(players.length));

    list.innerHTML = players.map((name, i) => {
        const seed = setupState.seeds.indexOf(name) + 1;
        return `
        <li class="t-player-item${seed ? ' is-seeded' : ''}">
            <button type="button" class="t-seed-btn" data-seed="${i}" aria-pressed="${seed ? 'true' : 'false'}"
                aria-label="${seed ? `Seed ${seed}: remove seeding for ` : 'Seed '}${escapeHTML(name)}">${seed ? seed : STAR_SVG}</button>
            <span class="t-player-name">${escapeHTML(name)}</span>
            ${leaderboardData[name] ? `<span class="t-player-pts">${leaderboardData[name]} pts</span>` : ''}
            <button type="button" class="t-player-remove" data-remove="${i}" aria-label="Remove ${escapeHTML(name)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </li>`;
    }).join('');
    list.classList.toggle('hide', players.length === 0);
    document.getElementById('t-player-hint').classList.toggle('hide', players.length > 0);
    document.getElementById('t-player-count').textContent = players.length + (players.length === 1 ? ' player' : ' players');

    const tools = document.getElementById('t-seed-tools');
    tools.classList.toggle('hide', players.length < 2);
    document.getElementById('t-seed-rankings').classList.toggle('hide', rankedSetupPlayers().length === 0);
    document.getElementById('t-seed-clear').classList.toggle('hide', setupState.seeds.length === 0);
    document.getElementById('t-seed-summary').textContent = setupState.seeds.length
        ? `${setupState.seeds.length} seeded`
        : 'Tap ☆ to seed your strongest players';

    const preview = document.getElementById('t-draw-preview');
    if (players.length < 2) {
        preview.textContent = players.length === 1 ? 'Add 1 more player to make a bracket' : 'Add at least 2 players';
        btnStartTourney.disabled = true;
        return;
    }
    const size = drawSizeFor(players.length);
    const byes = size - players.length;
    const seeds = setupState.seeds.length;
    let byeText = '';
    if (byes) {
        const byeWord = byes === 1 ? 'bye' : 'byes';
        if (!seeds) byeText = ` · ${byes} ${byeWord} by draw`;
        else if (seeds >= byes) byeText = ` · ${byes} ${byeWord} → seed${byes === 1 ? ' 1' : 's 1–' + byes}`;
        else byeText = ` · ${byes} ${byeWord} → seed${seeds === 1 ? ' 1' : 's 1–' + seeds}, ${byes - seeds} by draw`;
    }
    preview.innerHTML = `<strong>${size}-player draw</strong> · starts at ${escapeHTML(roundLabel(size / 2))}${escapeHTML(byeText)}`;
    btnStartTourney.disabled = false;
}

function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function handleStartTournament() {
    // A name typed but not yet added still counts.
    const pending = document.getElementById('t-player-input').value;
    if (pending.trim()) {
        addSetupPlayers(pending);
        document.getElementById('t-player-input').value = '';
    }
    if (setupState.players.length < 2) {
        showToast("Add at least 2 players");
        return;
    }

    const seeds = setupState.seeds.slice();
    const unseeded = setupState.players.filter(p => !seeds.includes(p));
    const ranked = seeds.concat(document.getElementById('t-shuffle').checked ? shuffled(unseeded) : unseeded);
    const t = {
        id: Date.now().toString(),
        name: document.getElementById('t-name').value.trim() || "Club Tournament",
        category: setupState.category,
        format: setupState.format,
        status: 'active',
        createdAt: Date.now(),
        completedAt: null,
        seeds: seeds.reduce((map, name, i) => { map[name] = i + 1; return map; }, {}),
        rounds: buildRounds(ranked),
        finalWinner: null
    };

    tournamentData.push(t);
    saveTournament();
    activeTournamentId = t.id;
    renderTournament();
    showToast("Bracket ready");
}

// --------- DETAIL / BRACKET ---------
function initTournamentDetail() {
    btnTourneyMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = tourneyMenuEl.classList.contains('hide');
        tourneyMenuEl.classList.toggle('hide', !open);
        btnTourneyMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
        if (!tourneyMenuEl.classList.contains('hide') && !e.target.closest('.t-menu-wrap')) closeTourneyMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !tourneyMenuEl.classList.contains('hide')) closeTourneyMenu();
    });

    document.getElementById('btn-complete-tourney').addEventListener('click', () => {
        closeTourneyMenu();
        const t = activeTourney();
        if (!t) return;
        showConfirm("Move this tournament to the archive? Matches that haven't been played stay unplayed.", () => {
            t.status = 'completed';
            t.completedAt = Date.now();
            if (matchState.activeTournamentMatch && matchState.activeTournamentMatch.tId === t.id) fullMatchReset();
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("Moved to archive");
        }, null, "Archive Tournament");
    });

    document.getElementById('btn-delete-tourney').addEventListener('click', () => {
        closeTourneyMenu();
        const t = activeTourney();
        if (!t) return;
        showConfirm(`Delete "${t.name}" and its bracket? Ranking points already earned are kept.`, () => {
            if (matchState.activeTournamentMatch && matchState.activeTournamentMatch.tId === t.id) fullMatchReset();
            tournamentData = tournamentData.filter(x => x.id !== t.id);
            saveTournament();
            activeTournamentId = null;
            renderTournamentHub();
            showToast("Tournament deleted");
        }, null, "Delete Tournament");
    });

    document.getElementById('btn-share-tourney').addEventListener('click', shareTournament);
    document.getElementById('btn-leave-shared').addEventListener('click', leaveSharedView);

    tourneyTabsEl.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-round]');
        if (tab) selectRound(Number(tab.dataset.round));
    });

    tourneyBracketEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-play]');
        if (!btn) return;
        const [r, m] = btn.dataset.play.split('-').map(Number);
        startTournamentMatch(r, m);
    });

    // Swipe between rounds on phones.
    let touchStart = null;
    tourneyBracketEl.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    tourneyBracketEl.addEventListener('touchend', (e) => {
        if (!touchStart || window.matchMedia('(min-width: 768px)').matches) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
        touchStart = null;
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const tourney = activeTourney();
        if (!tourney) return;
        const current = selectedRoundByTourney[tourney.id] || 0;
        const next = Math.max(0, Math.min(tourney.rounds.length - 1, current + (dx < 0 ? 1 : -1)));
        if (next !== current) selectRound(next);
    }, { passive: true });
}

function closeTourneyMenu() {
    tourneyMenuEl.classList.add('hide');
    btnTourneyMenu.setAttribute('aria-expanded', 'false');
}

function selectRound(r) {
    const t = activeTourney();
    if (!t) return;
    selectedRoundByTourney[t.id] = r;
    tourneyTabsEl.querySelectorAll('[data-round]').forEach(tab => {
        const on = Number(tab.dataset.round) === r;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    tourneyBracketEl.querySelectorAll('.t-round').forEach(col => {
        col.classList.toggle('is-active', Number(col.dataset.round) === r);
    });
}

function updateWideMode() {
    const appContainer = document.querySelector('.app-container');
    const bracketShowing = document.getElementById('view-tournament').classList.contains('active-view') &&
        !tourneyActiveViewEl.classList.contains('hide');
    const t = bracketShowing ? activeTourney() : null;
    if (t) {
        appContainer.style.setProperty('--dynamic-max-width', (t.rounds.length * 300 + 160) + 'px');
        appContainer.classList.add('wide-mode');
        return;
    }
    appContainer.classList.remove('wide-mode');
    appContainer.style.removeProperty('--dynamic-max-width');
}

function renderTournament() {
    const t = activeTourney();
    if (!t) return renderTournamentHub();

    // Byes can cascade (a walkover feeding another walkover); resolve them all.
    while (checkAndResolveByes(t)) { /* keep resolving */ }

    closeTourneyMenu();
    showTourneyPane('detail');

    document.getElementById('th-name').textContent = t.name;
    document.getElementById('th-cat').textContent = t.category;
    document.getElementById('th-format').textContent = formatLabelFor(t);
    document.getElementById('btn-complete-tourney').classList.toggle('hide', t.status === 'completed');
    document.getElementById('btn-share-tourney').classList.toggle('hide', !!t.readOnly);
    document.querySelector('.t-detail .t-menu-wrap').classList.toggle('hide', !!t.readOnly);
    const banner = document.getElementById('tourney-shared-banner');
    banner.classList.toggle('hide', !t.readOnly);
    if (t.readOnly) {
        const when = t.sharedAt ? new Date(t.sharedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
        document.getElementById('tourney-shared-when').textContent = when ? 'As of ' + when : 'Snapshot';
    } else {
        prepareShareLink(t);
    }

    renderChampion(t);
    renderProgress(t);

    if (selectedRoundByTourney[t.id] === undefined || selectedRoundByTourney[t.id] >= t.rounds.length) {
        selectedRoundByTourney[t.id] = currentRoundIndex(t);
    }
    const selected = selectedRoundByTourney[t.id];

    tourneyTabsEl.innerHTML = t.rounds.map((round, r) => {
        const real = round.filter(match => !isByeMatch(match));
        const done = real.filter(match => match.winner).length;
        const complete = round.every(match => match.winner);
        return `
            <button type="button" class="t-round-tab${r === selected ? ' is-active' : ''}${complete ? ' is-complete' : ''}" role="tab"
                aria-selected="${r === selected}" data-round="${r}">
                <span class="t-round-tab-name">${escapeHTML(roundLabel(round.length))}</span>
                <span class="t-round-tab-count">${complete ? '✓' : done + '/' + (real.length || round.length)}</span>
            </button>`;
    }).join('');

    tourneyBracketEl.innerHTML = '';
    t.rounds.forEach((round, r) => {
        const col = document.createElement('section');
        col.className = 't-round' + (r === selected ? ' is-active' : '') + (r === t.rounds.length - 1 ? ' is-final' : '');
        col.dataset.round = r;

        const head = document.createElement('h3');
        head.className = 't-round-head';
        head.textContent = roundLabel(round.length);
        col.appendChild(head);

        const body = document.createElement('div');
        body.className = 't-round-body';
        for (let m = 0; m < round.length; m += 2) {
            const pair = document.createElement('div');
            pair.className = 't-pair' + (m + 1 < round.length ? '' : ' is-single');
            [m, m + 1].forEach(idx => {
                if (idx >= round.length) return;
                const slot = document.createElement('div');
                slot.className = 't-slot';
                slot.innerHTML = matchCardHTML(t, r, idx);
                pair.appendChild(slot);
            });
            body.appendChild(pair);
        }
        col.appendChild(body);
        tourneyBracketEl.appendChild(col);
    });

    // Keep the chosen round tab in view on narrow screens.
    const activeTab = tourneyTabsEl.querySelector('.is-active');
    if (activeTab) tourneyTabsEl.scrollLeft = Math.max(0, activeTab.offsetLeft - 16);
    updateWideMode();
}

function renderChampion(t) {
    const el = document.getElementById('tourney-champion');
    if (!t.finalWinner) { el.innerHTML = ''; return; }
    const final = t.rounds[t.rounds.length - 1][0];
    const second = runnerUp(t);
    el.innerHTML = `
        <div class="t-champion">
            <div class="t-champion-medal">${TROPHY.replace('width="20" height="20"', 'width="30" height="30"')}</div>
            <div class="t-champion-kicker">Champion</div>
            <div class="t-champion-name">${escapeHTML(t.finalWinner)}</div>
            ${second ? `<div class="t-champion-final">def. ${escapeHTML(second)}${final.score && final.score !== 'Walkover' ? ' · ' + escapeHTML(final.score) : ''}</div>` : ''}
            <div class="t-champion-points">+250 ranking points</div>
        </div>`;
}

function renderProgress(t) {
    const el = document.getElementById('tourney-progress');
    if (t.finalWinner) { el.innerHTML = ''; el.classList.add('hide'); return; }
    el.classList.remove('hide');
    const prog = tourneyProgress(t);
    const pctDone = prog.total ? Math.round(prog.played / prog.total * 100) : 0;
    const stage = t.status === 'completed' ? 'Archived' : roundLabel(t.rounds[currentRoundIndex(t)].length);
    el.innerHTML = `
        <div class="t-progress-row">
            <span class="t-progress-stage">${escapeHTML(stage)}</span>
            <span class="t-progress-count">${prog.played} of ${prog.total} matches played</span>
        </div>
        <div class="t-bar-track"><i style="width:${pctDone}%"></i></div>`;
}

function playerRowHTML(t, r, m, slot) {
    const match = t.rounds[r][m];
    const name = match['p' + slot];
    const other = match['p' + (slot === 1 ? 2 : 1)];
    const isWinner = !!match.winner && match.winner === name;
    const isLoser = !!match.winner && !isWinner;

    let nameHTML;
    let cls = 't-row';
    if (!name) {
        cls += ' is-pending';
        const feeder = r > 0 ? matchCode(t, r - 1, m * 2 + (slot - 1)) : null;
        nameHTML = feeder ? `Winner of ${escapeHTML(feeder)}` : 'TBD';
    } else if (name === BYE) {
        cls += ' is-bye';
        nameHTML = 'Bye';
    } else {
        const seed = seedOf(t, name);
        nameHTML = (seed ? `<span class="t-seed" title="Seed ${seed}">${seed}</span>` : '') + escapeHTML(name);
    }
    if (isWinner) cls += ' is-winner';
    if (isLoser) cls += ' is-loser';

    let setsHTML = '';
    const parsed = parseScore(match.score);
    if (parsed.sets.length && name !== BYE && other !== BYE) {
        setsHTML = '<span class="t-row-sets">' + parsed.sets.map(set => {
            const mine = slot === 1 ? set.a : set.b;
            const theirs = slot === 1 ? set.b : set.a;
            const tb = set.tb !== null && mine < theirs ? `<sup>${set.tb}</sup>` : '';
            return `<span class="t-set${mine > theirs ? ' won' : ''}">${mine}${tb}</span>`;
        }).join('') + '</span>';
    }

    const check = isWinner && other !== BYE
        ? '<svg class="t-row-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-label="Winner"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '';

    return `<div class="${cls}"><span class="t-row-dot p${slot}"></span><span class="t-row-name">${nameHTML}</span>${setsHTML}${check}</div>`;
}

function matchCardHTML(t, r, m) {
    const match = t.rounds[r][m];
    const bye = isByeMatch(match);
    const live = !match.winner && isLiveMatch(t, r, m);
    const playable = isPlayable(t, match);
    const waiting = !match.winner && (!match.p1 || !match.p2);
    const parsed = parseScore(match.score);

    let state = 'is-done', chip = '';
    if (bye) { state = 'is-bye'; chip = '<span class="t-status s-bye">Bye</span>'; }
    else if (live) { state = 'is-live'; chip = '<span class="t-status s-live"><span class="t-live-dot"></span>Live</span>'; }
    else if (playable) { state = 'is-ready'; chip = '<span class="t-status s-ready">Ready</span>'; }
    else if (waiting) { state = 'is-waiting'; chip = '<span class="t-status s-wait">Waiting</span>'; }
    else if (!match.winner) { state = 'is-waiting'; }
    else if (parsed.retired) { chip = '<span class="t-status s-ret">Retired</span>'; }

    let action = '';
    if (live && t.readOnly) action = `<div class="t-live-score"><span class="t-live-dot"></span>On court · ${escapeHTML(t.live.score)}</div>`;
    else if (live) action = `<button type="button" class="t-play-btn is-live" data-play="${r}-${m}">Resume match</button>`;
    else if (playable) action = `<button type="button" class="t-play-btn" data-play="${r}-${m}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z"/></svg>
        Start match</button>`;

    // A bye is a formality: one compact row for the player who goes through.
    if (bye) {
        const through = match.p1 === BYE ? 2 : 1;
        const onward = r < t.rounds.length - 1 ? ' to ' + escapeHTML(matchCode(t, r + 1, Math.floor(m / 2))) : '';
        return `
        <article class="t-match is-bye">
            <header class="t-match-head">
                <span class="t-match-code">${escapeHTML(matchCode(t, r, m))}</span>
                ${chip}
            </header>
            ${match['p' + through] === BYE ? playerRowHTML(t, r, m, 1) : playerRowHTML(t, r, m, through).replace(' is-winner', '')}
            <div class="t-match-note">Advances${onward} with a bye</div>
        </article>`;
    }

    const nextHint = !match.winner && r < t.rounds.length - 1
        ? `<div class="t-match-next">Winner plays ${escapeHTML(matchCode(t, r + 1, Math.floor(m / 2)))}</div>`
        : '';

    return `
        <article class="t-match ${state}">
            <header class="t-match-head">
                <span class="t-match-code">${escapeHTML(matchCode(t, r, m))}</span>
                ${chip}
            </header>
            ${playerRowHTML(t, r, m, 1)}
            ${playerRowHTML(t, r, m, 2)}
            ${action}
            ${nextHint}
        </article>`;
}

// --------- PLAYING A BRACKET MATCH ---------
function startTournamentMatch(r, m) {
    const t = activeTourney();
    if (!t) return;
    const match = t.rounds[r][m];
    if (!isPlayable(t, match)) return;

    // Tapping the match that's already on court just goes back to it.
    const live = matchState.activeTournamentMatch;
    if (live && live.tId === t.id && live.r === r && live.m === m) {
        switchView('view-live');
        return;
    }

    const begin = () => {
        fullMatchReset();
        matchState.p1.name = match.p1;
        matchState.p2.name = match.p2;
        matchState.activeTournamentMatch = { r: r, m: m, tId: t.id };
        applyMatchFormat(t.format || 'one-set');
        updateMatchUI();
        switchView('view-live');
        showToast(matchName(t, r, m));
    };

    if (matchHasStarted()) {
        const current = `${matchState.p1.name} vs ${matchState.p2.name}`;
        const msg = isMatchDecided()
            ? `${current} is finished but hasn't been recorded. Discard it and start ${match.p1} vs ${match.p2}?`
            : `${current} is still in progress. Discard that score and start ${match.p1} vs ${match.p2}?`;
        showConfirm(msg, begin, null, "Start New Match");
        return;
    }
    begin();
}
window.startTournamentMatch = startTournamentMatch;

// Called from forceEndMatch when the live match belongs to a bracket.
function recordTournamentMatch() {
    const live = matchState.activeTournamentMatch;
    const t = tournamentData.find(x => x.id === live.tId);
    if (!t) return fullMatchReset();
    const match = t.rounds[live.r] && t.rounds[live.r][live.m];
    if (!match || match.winner) return fullMatchReset(); // already recorded elsewhere

    const p1Won = matchState.p1.sets > matchState.p2.sets;
    const winnerName = p1Won ? match.p1 : match.p2;
    const loserName = p1Won ? match.p2 : match.p1;
    const setScores = formatSetScores(matchState);

    match.winner = winnerName;
    match.score = setScores.length ? setScores.join(', ') : "Walkover";
    awardPoints(loserName, loserPoints(t, live.r));
    advanceWinner(t, live.r, live.m, winnerName);
    if (t.finalWinner) awardPoints(winnerName, 250);

    saveTournament();
    // Clear the live court so the result can't be recorded twice.
    fullMatchReset();

    activeTournamentId = t.id;
    delete selectedRoundByTourney[t.id]; // jump to wherever play continues
    switchView('view-tournament');
    renderTournament();
    showToast(t.finalWinner ? `${winnerName} wins ${t.name}!` : "Result recorded");
}

// Chip above the live scoreboard linking a tournament match back to its bracket.
function renderLiveTournamentContext() {
    const el = document.getElementById('live-tourney-context');
    if (!el) return;
    const live = matchState.activeTournamentMatch;
    const t = live && tournamentData.find(x => x.id === live.tId);
    if (!t || !t.rounds[live.r]) { el.classList.add('hide'); return; }
    document.getElementById('live-tourney-context-text').textContent = t.name + ' · ' + matchName(t, live.r, live.m);
    el.classList.remove('hide');
}

// --------- SHARING A BRACKET ---------
// There's no server: the whole bracket is packed into the link's #fragment
// (deflate + base64url), so anyone can open it and see a read-only snapshot.
// Fragments never reach the server, so nothing is uploaded anywhere.
const SHARE_PREFIX = '#b=';
let sharedTourney = null;              // the read-only bracket being viewed, if any
let shareLinkCache = { key: null, url: null };

function isSharedLink() {
    return location.hash.startsWith(SHARE_PREFIX);
}

function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function packBytes(bytes, compress) {
    const stream = new Blob([bytes]).stream().pipeThrough(compress ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Score of the match on court right now, e.g. "6-4, 2-1 · 30-15".
function liveScoreText() {
    const s = matchState;
    const sets = s.p1.setHistory.map((g, i) => `${g}-${s.p2.setHistory[i]}`);
    if (s.superTiebreak) sets.push(`${s.p1.points}-${s.p2.points}`);
    else {
        sets.push(`${s.p1.games}-${s.p2.games}`);
        const pts = s.isTiebreak ? `${s.p1.points}-${s.p2.points}` : `${pointLabel(s.p1.points, s.p2.points)}-${pointLabel(s.p2.points, s.p1.points)}`;
        return sets.join(', ') + ' · ' + pts;
    }
    return sets.join(', ');
}

// Compact form: names go in a table and matches refer to them by index.
function packTournament(t) {
    const names = [];
    const ref = (name) => {
        if (!name) return -1;
        if (name === BYE) return -2;
        let i = names.indexOf(name);
        if (i < 0) i = names.push(name) - 1;
        return i;
    };
    const rounds = t.rounds.map(round => round.map(m =>
        [ref(m.p1), ref(m.p2), !m.winner ? 0 : m.winner === m.p1 ? 1 : 2, m.score || '']));
    const live = matchState.activeTournamentMatch;
    const onCourt = live && live.tId === t.id && matchHasStarted() && !isMatchDecided()
        ? [live.r, live.m, liveScoreText()] : null;
    return {
        v: 1, n: t.name, c: t.category, f: t.format || 'one-set', s: t.status, at: Date.now(),
        p: names, r: rounds, sd: Object.keys(t.seeds || {}).map(n => [ref(n), t.seeds[n]]), lv: onCourt
    };
}

function unpackTournament(d) {
    if (!d || d.v !== 1 || !Array.isArray(d.r) || !Array.isArray(d.p)) throw new Error('Unrecognised link');
    const name = (i) => i === -2 ? BYE : i >= 0 ? String(d.p[i]) : null;
    const rounds = d.r.map(round => round.map(([a, b, w, score]) => {
        const p1 = name(a), p2 = name(b);
        return { p1: p1, p2: p2, winner: w === 1 ? p1 : w === 2 ? p2 : null, score: score || null };
    }));
    const final = rounds[rounds.length - 1][0];
    const seeds = {};
    (d.sd || []).forEach(([i, n]) => { if (name(i)) seeds[name(i)] = n; });
    return {
        id: 'shared', readOnly: true, sharedAt: d.at,
        name: String(d.n || 'Tournament'), category: String(d.c || ''), format: MATCH_FORMATS[d.f] ? d.f : 'one-set',
        status: d.s === 'completed' ? 'completed' : 'active',
        finalWinner: final && final.winner ? final.winner : null,
        seeds: seeds, rounds: rounds,
        live: Array.isArray(d.lv) ? { r: d.lv[0], m: d.lv[1], score: String(d.lv[2] || '') } : null
    };
}

async function buildShareLink(t) {
    const json = new TextEncoder().encode(JSON.stringify(packTournament(t)));
    const code = window.CompressionStream ? 'z' + bytesToB64url(await packBytes(json, true)) : 'j' + bytesToB64url(json);
    return location.origin + location.pathname + SHARE_PREFIX + code;
}

// Built ahead of the tap: Safari drops navigator.share if it waits on async work.
function prepareShareLink(t) {
    const key = t.id + ':' + JSON.stringify(t.rounds) + ':' + (matchState.activeTournamentMatch ? liveScoreText() : '');
    if (shareLinkCache.key === key) return;
    shareLinkCache = { key: key, url: null };
    buildShareLink(t).then(url => { if (shareLinkCache.key === key) shareLinkCache.url = url; }).catch(() => null);
}

async function shareTournament() {
    const t = activeTourney();
    if (!t || t.readOnly) return;
    let url = shareLinkCache.url;
    if (!url) { try { url = await buildShareLink(t); } catch (e) { showToast("Couldn't build the link"); return; } }
    const text = `${t.name} — follow the draw and results`;
    if (navigator.share) {
        try { await navigator.share({ title: t.name, text: text, url: url }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
    } catch (e) {
        window.prompt('Copy this link to share the bracket', url);
    }
}

async function openSharedView() {
    const code = location.hash.slice(SHARE_PREFIX.length);
    try {
        const kind = code[0], bytes = b64urlToBytes(code.slice(1));
        let json;
        if (kind === 'z') {
            if (!window.DecompressionStream) throw new Error('Please update your browser to view this bracket');
            json = await packBytes(bytes, false);
        } else if (kind === 'j') json = bytes;
        else throw new Error('Unrecognised link');
        sharedTourney = unpackTournament(JSON.parse(new TextDecoder().decode(json)));
    } catch (e) {
        showToast(e && e.message && e.message.length < 60 ? e.message : "This bracket link doesn't work");
        history.replaceState(null, '', location.pathname);
        return false;
    }
    document.body.classList.add('is-shared');
    document.title = sharedTourney.name + ' · Racquetback';
    switchView('view-tournament');
    activeTournamentId = 'shared';
    renderTournament();
    return true;
}

function leaveSharedView() {
    history.replaceState(null, '', location.pathname);
    location.reload();
}

window.addEventListener('hashchange', () => {
    // Opening another bracket link while the app is already open.
    if (isSharedLink() || sharedTourney) location.reload();
});
