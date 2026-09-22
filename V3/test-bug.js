const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html);
const window = dom.window;
const document = window.document;

let tournamentData = [{
    id: "1",
    name: "Test",
    category: "Mens Singles",
    status: "completed",
    finalWinner: "Alice",
    rounds: [
        [ { p1: "Alice", p2: "Bob", winner: "Alice", score: "6-0" } ]
    ]
}];

let activeTournamentId = "1";

const tourneyHubEl = document.getElementById('tourney-hub');
const tourneySetupEl = document.getElementById('tourney-setup');
const tourneyActiveViewEl = document.getElementById('tourney-active-view');
const tourneyBracketEl = document.getElementById('tourney-bracket');
const appContainer = document.createElement('div');
appContainer.className = 'app-container';
document.body.appendChild(appContainer);

function checkAndResolveByes(tourney) {
    if(!tourney || tourney.status === 'completed') return false;
    return false;
}

function updateWideMode() {
    console.log("updateWideMode called");
}

function createMatchCard(activeTourney, matchInfo, roundIndex, matchIndex) {
    let mCard = document.createElement('div'); 
    mCard.innerHTML = "Card";
    return mCard;
}

function renderTournament() {
    let activeTourney = tournamentData.find(t => t.id === activeTournamentId);
    if (!activeTourney) {
        console.log("Not found");
        return;
    }
    
    while(checkAndResolveByes(activeTourney)) {}

    tourneyHubEl.classList.add('hide');
    tourneySetupEl.classList.add('hide'); 
    tourneyActiveViewEl.classList.remove('hide');
    
    updateWideMode();
    
    document.getElementById('th-name').textContent = activeTourney.name;
    document.getElementById('th-cat').textContent = activeTourney.category;
    
    tourneyBracketEl.innerHTML = '';
    
    if(activeTourney.finalWinner) {
        let champBanner = document.createElement('div');
        champBanner.className = 'glass-panel text-center mb-4 rank-1';
        champBanner.innerHTML = `<h3 class="lb-rank" style="width:100%; margin-bottom: 8px;">CHAMPION</h3><span class="view-title">${activeTourney.finalWinner}</span><br/><small class="text-muted">+250 ATP points awarded</small>`;
        tourneyBracketEl.appendChild(champBanner);
    }

    const totalRoundsNum = activeTourney.rounds.length;
    
    let outerWrapper = document.createElement('div');
    outerWrapper.style.display = 'flex';
    
    activeTourney.rounds.forEach((round, roundIndex) => {
        let roundDiv = document.createElement('div'); 
        let labelDiv = document.createElement('div'); 
        roundDiv.appendChild(labelDiv);

        let matchContainer = document.createElement('div');

        for (let i = 0; i < round.length; i += 2) {
            if (i + 1 < round.length) {
                let pairDiv = document.createElement('div');
                let wrapper1 = document.createElement('div');
                wrapper1.appendChild(createMatchCard(activeTourney, round[i], roundIndex, i));
                
                let wrapper2 = document.createElement('div');
                wrapper2.appendChild(createMatchCard(activeTourney, round[i+1], roundIndex, i+1));

                pairDiv.appendChild(wrapper1);
                pairDiv.appendChild(wrapper2);
                matchContainer.appendChild(pairDiv);
            } else {
                let singleDiv = document.createElement('div');
                singleDiv.appendChild(createMatchCard(activeTourney, round[i], roundIndex, i));
                matchContainer.appendChild(singleDiv);
            }
        }
        
        roundDiv.appendChild(matchContainer);
        outerWrapper.appendChild(roundDiv);
    });
    
    tourneyBracketEl.appendChild(outerWrapper);
    console.log("Success rendered");
}

renderTournament();
