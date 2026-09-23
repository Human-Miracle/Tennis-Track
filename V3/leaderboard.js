// --------- LEADERBOARD ---------
// Points live in leaderboardData ({ name: points }, persisted per profile) and
// survive tournaments being deleted. Everything else shown here - titles,
// win/loss, form, results - is derived from the tournaments still saved.
// Loaded after tournament.js (uses escapeHTML, roundLabel, realPlayers...).

const lbListEl = document.getElementById('leaderboard-list');
const lbPodiumEl = document.getElementById('lb-podium');
const lbSearchEl = document.getElementById('lb-search');
const lbPlayerModalEl = document.getElementById('lb-player-modal');

// Most recent ranking, so rows and the player sheet agree.
let lbRanking = [];

function initLeaderboard() {
    document.getElementById('btn-reset-leaderboard').addEventListener('click', () => {
        showConfirm("Reset every player's ranking points to zero? Tournaments and their results are kept.", () => {
            leaderboardData = {};
            Store.clear('leaderboard');
            renderLeaderboard();
            showToast("Rankings reset");
        }, null, "Reset Rankings");
    });

    document.getElementById('lb-empty-cta').addEventListener('click', () => switchView('view-tournament'));

    lbSearchEl.addEventListener('input', renderLeaderboardList);

    // Rows and podium spots open the player sheet.
    document.getElementById('view-leaderboard').addEventListener('click', (e) => {
        const target = e.target.closest('[data-player]');
        if (target) openPlayerSheet(target.dataset.player);
    });

    document.getElementById('lb-player-close').addEventListener('click', closePlayerSheet);
    lbPlayerModalEl.addEventListener('click', (e) => {
        if (e.target === lbPlayerModalEl) { closePlayerSheet(); return; }
        const link = e.target.closest('[data-tourney-link]');
        if (link) {
            closePlayerSheet();
            switchView('view-tournament');
            openTournament(link.dataset.tourneyLink);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !lbPlayerModalEl.classList.contains('hide')) closePlayerSheet();
    });
}

// --------- STATS ---------
function finishLabel(t, player, lostInRound) {
    if (t.finalWinner === player) return 'Champion';
    if (lostInRound === null) return t.status === 'active' ? 'Still in the draw' : 'Archived';
    const n = t.rounds[lostInRound].length;
    if (n === 1) return 'Runner-up';
    if (n === 2) return 'Semifinalist';
    if (n === 4) return 'Quarterfinalist';
    return roundLabel(n);
}

// Bracket scores are stored p1-first; show them from this player's side.
function scoreFor(match, player) {
    const parsed = parseScore(match.score);
    if (!parsed.sets.length) return '';
    const flip = player === match.p2;
    return parsed.sets.map(set => {
        const mine = flip ? set.b : set.a, theirs = flip ? set.a : set.b;
        return `${mine}-${theirs}` + (set.tb !== null ? `(${set.tb})` : '');
    }).join(', ') + (parsed.retired ? ' ret.' : '');
}

function buildPlayerStats() {
    const stats = {};
    const get = (name) => stats[name] || (stats[name] = { wins: 0, losses: 0, titles: 0, finals: 0, events: [], form: [] });

    const byDate = tournamentData.slice().sort((a, b) =>
        (a.createdAt || Number(a.id) || 0) - (b.createdAt || Number(b.id) || 0));

    byDate.forEach(t => {
        const lostIn = {};
        realPlayers(t).forEach(p => { lostIn[p] = null; });

        t.rounds.forEach((round, r) => round.forEach((match, m) => {
            if (!match.winner || isByeMatch(match)) return;
            const loser = match.winner === match.p1 ? match.p2 : match.p1;
            if (!loser) return;
            const code = matchCode(t, r, m);
            get(match.winner).wins++;
            get(loser).losses++;
            get(match.winner).form.push({ won: true, opp: loser, where: t.name + ' · ' + code, score: scoreFor(match, match.winner) });
            get(loser).form.push({ won: false, opp: match.winner, where: t.name + ' · ' + code, score: scoreFor(match, loser) });
            lostIn[loser] = r;
        }));

        Object.keys(lostIn).forEach(p => {
            const s = get(p);
            const label = finishLabel(t, p, lostIn[p]);
            if (label === 'Champion') { s.titles++; s.finals++; }
            if (label === 'Runner-up') s.finals++;
            s.events.push({ id: t.id, name: t.name, label: label, date: t.completedAt || t.createdAt || Number(t.id) || 0 });
        });
    });
    return stats;
}

// Sorted by points; equal points share a rank (1, 2, 2, 4). Titles, then
// name, only order players within a tie.
function buildRanking() {
    const stats = buildPlayerStats();
    const empty = { wins: 0, losses: 0, titles: 0, finals: 0, events: [], form: [] };
    const list = Object.keys(leaderboardData)
        .filter(name => leaderboardData[name] > 0)
        .map(name => ({ name: name, pts: leaderboardData[name], s: stats[name] || empty }))
        .sort((a, b) => b.pts - a.pts || b.s.titles - a.s.titles || a.name.localeCompare(b.name));

    list.forEach((p, i) => {
        p.rank = i > 0 && list[i - 1].pts === p.pts ? list[i - 1].rank : i + 1;
    });
    list.forEach(p => {
        p.tied = list.filter(q => q.rank === p.rank).length > 1;
    });
    return list;
}

function rankText(p) {
    return (p.tied ? 'T' : '') + p.rank;
}

function playerSubline(p) {
    const parts = [];
    if (p.s.titles) parts.push(p.s.titles + (p.s.titles === 1 ? ' title' : ' titles'));
    if (p.s.wins + p.s.losses) parts.push(p.s.wins + '–' + p.s.losses);
    if (!parts.length && p.s.events.length) parts.push(p.s.events.length + (p.s.events.length === 1 ? ' tournament' : ' tournaments'));
    return parts.join(' · ');
}

function avatarHTML(name, cls) {
    return `<span class="lb-avatar${cls ? ' ' + cls : ''}" aria-hidden="true">${escapeHTML(initialsFor(name))}</span>`;
}

// --------- RENDER ---------
function renderLeaderboard() {
    lbRanking = buildRanking();
    const empty = lbRanking.length === 0;
    document.getElementById('lb-empty').classList.toggle('hide', !empty);
    document.getElementById('lb-content').classList.toggle('hide', empty);

    const events = tournamentData.length;
    document.getElementById('lb-sub').textContent = empty
        ? 'Points earned in your tournaments'
        : `${lbRanking.length} ${lbRanking.length === 1 ? 'player' : 'players'}` +
          (events ? ` · ${events} ${events === 1 ? 'tournament' : 'tournaments'}` : '');

    // Search is only worth the space once the list gets long.
    const searchable = lbRanking.length > 8;
    document.getElementById('lb-search-wrap').classList.toggle('hide', !searchable);
    if (!searchable) lbSearchEl.value = '';

    if (empty) {
        lbPodiumEl.innerHTML = '';
        lbListEl.innerHTML = '';
        return;
    }
    renderLeaderboardList();
}

function renderPodium(top) {
    // Visual order: 2nd, 1st, 3rd.
    const order = top.length === 1 ? [0] : top.length === 2 ? [1, 0] : [1, 0, 2];
    const medal = ['gold', 'silver', 'bronze'];
    lbPodiumEl.className = 'lb-podium count-' + top.length;
    lbPodiumEl.innerHTML = order.map(i => {
        const p = top[i];
        return `
            <button type="button" class="lb-spot ${medal[i]}" data-player="${escapeHTML(p.name)}">
                ${i === 0 ? '<svg class="lb-crown" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"/></svg>' : ''}
                ${avatarHTML(p.name, 'ring ' + medal[i])}
                <span class="lb-spot-name">${escapeHTML(p.name)}</span>
                <span class="lb-spot-pts">${p.pts}<small> pts</small></span>
                <span class="lb-spot-block"><span class="lb-spot-rank">${escapeHTML(rankText(p))}</span></span>
            </button>`;
    }).join('');
}

function renderLeaderboardList() {
    const query = lbSearchEl.value.trim().toLowerCase();
    const searching = query.length > 0;
    const showPodium = !searching && lbRanking.length > 0;

    lbPodiumEl.classList.toggle('hide', !showPodium);
    if (showPodium) renderPodium(lbRanking.slice(0, 3));

    // With the podium showing, the list picks up from 4th place.
    let rows = showPodium ? lbRanking.slice(3) : lbRanking;
    if (searching) rows = lbRanking.filter(p => p.name.toLowerCase().includes(query));

    const leader = lbRanking.length ? lbRanking[0].pts : 1;
    lbListEl.innerHTML = rows.map(p => `
        <li>
            <button type="button" class="lb-row" data-player="${escapeHTML(p.name)}">
                <span class="lb-row-rank">${escapeHTML(rankText(p))}</span>
                ${avatarHTML(p.name)}
                <span class="lb-row-main">
                    <span class="lb-row-name">${escapeHTML(p.name)}</span>
                    <span class="lb-row-sub">${escapeHTML(playerSubline(p)) || '&nbsp;'}</span>
                    <span class="lb-row-bar"><i style="width:${Math.max(4, Math.round(p.pts / leader * 100))}%"></i></span>
                </span>
                <span class="lb-row-pts">${p.pts}<small>pts</small></span>
            </button>
        </li>`).join('');

    const section = document.getElementById('lb-list-section');
    section.classList.toggle('hide', rows.length === 0 && !searching);
    document.getElementById('lb-list-label').firstChild.textContent = searching ? 'Results ' : 'Full rankings ';
    document.getElementById('lb-count').textContent = searching ? rows.length : '';
    document.getElementById('lb-no-match').classList.toggle('hide', !(searching && rows.length === 0));
}

// --------- PLAYER SHEET ---------
function openPlayerSheet(name) {
    const p = lbRanking.find(x => x.name === name);
    if (!p) return;
    const s = p.s;
    const played = s.wins + s.losses;

    const avatar = document.getElementById('lb-player-avatar');
    avatar.textContent = initialsFor(p.name);
    avatar.className = 'lb-avatar lg' + (p.rank <= 3 ? ' ring ' + ['gold', 'silver', 'bronze'][p.rank - 1] : '');
    document.getElementById('lb-player-name').textContent = p.name;
    document.getElementById('lb-player-rank').textContent = `Ranked ${rankText(p)} of ${lbRanking.length} · ${p.pts} pts`;

    const tile = (value, label, accent) =>
        `<div class="lb-tile${accent ? ' ' + accent : ''}"><span class="lb-tile-val">${value}</span><span class="lb-tile-label">${label}</span></div>`;
    document.getElementById('lb-player-tiles').innerHTML = [
        tile(s.titles, s.titles === 1 ? 'Title' : 'Titles', s.titles ? 'gold' : ''),
        tile(s.finals, s.finals === 1 ? 'Final' : 'Finals'),
        tile(played ? `${s.wins}–${s.losses}` : '–', 'W–L'),
        tile(played ? Math.round(s.wins / played * 100) + '%' : '–', 'Win rate')
    ].join('');

    const recent = s.form.slice(-5).reverse();
    document.getElementById('lb-player-form-wrap').classList.toggle('hide', recent.length === 0);
    document.getElementById('lb-player-form').innerHTML = recent.map(f => `
        <div class="lb-form-row">
            <span class="lb-form-badge ${f.won ? 'win' : 'loss'}">${f.won ? 'W' : 'L'}</span>
            <span class="lb-form-main">
                <span class="lb-form-opp">${f.won ? 'def.' : 'lost to'} ${escapeHTML(f.opp)}</span>
                <span class="lb-form-where">${escapeHTML(f.where)}</span>
            </span>
            <span class="lb-form-score">${escapeHTML(f.score)}</span>
        </div>`).join('');

    const history = s.events.slice().reverse();
    document.getElementById('lb-player-history').innerHTML = history.length
        ? history.map(ev => {
            const exists = tournamentData.some(t => t.id === ev.id);
            return `
            <button type="button" class="lb-history-row${ev.label === 'Champion' ? ' is-champ' : ''}" ${exists ? `data-tourney-link="${escapeHTML(ev.id)}"` : 'disabled'}>
                <span class="lb-history-main">
                    <span class="lb-history-name">${escapeHTML(ev.name)}</span>
                    <span class="lb-history-date">${escapeHTML(formatShortDate(ev.date))}</span>
                </span>
                <span class="lb-history-result">${escapeHTML(ev.label)}</span>
            </button>`;
        }).join('')
        : '<p class="lb-history-empty">Tournament details aren’t saved anymore - only the points remain.</p>';

    lbPlayerModalEl.classList.remove('hide');
}

function closePlayerSheet() {
    lbPlayerModalEl.classList.add('hide');
}
