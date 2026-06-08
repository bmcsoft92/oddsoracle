/**
 * OddsOracle — Journal des Paris
 * Enregistrement, affichage, filtrage, statistiques
 */

const JournalModule = (() => {

  const KEY = 'odds_journal';
  let bets = [];
  let filters = { sport: 'all', type: 'all', result: 'all' };

  function load() {
    try {
      const d = localStorage.getItem(KEY);
      bets = d ? JSON.parse(d) : [];
    } catch(e) { bets = []; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(bets)); } catch(e) {}
  }

  function addBet(bet) {
    bet.id = Date.now();
    bets.unshift(bet); // plus récent en premier
    save();
  }

  function updateBetResult(id, result) {
    const b = bets.find(b => b.id === id);
    if (b) { b.result = result; save(); }
  }

  function deleteBet(id) {
    bets = bets.filter(b => b.id !== id);
    save();
  }

  function calcPnl(bet) {
    if (bet.result === 'win') return parseFloat(bet.stake) * (parseFloat(bet.cote) - 1);
    if (bet.result === 'loss') return -parseFloat(bet.stake);
    return 0;
  }

  function getFiltered() {
    return bets.filter(b => {
      if (filters.sport !== 'all'  && b.sport  !== filters.sport)  return false;
      if (filters.type  !== 'all'  && b.type   !== filters.type)   return false;
      if (filters.result !== 'all' && b.result !== filters.result) return false;
      return true;
    });
  }

  function calcStats(list) {
    const resolved = list.filter(b => b.result === 'win' || b.result === 'loss');
    const wins   = resolved.filter(b => b.result === 'win').length;
    const losses = resolved.filter(b => b.result === 'loss').length;
    const totalStaked = list.filter(b => b.result !== 'void').reduce((s, b) => s + parseFloat(b.stake || 0), 0);
    const pnl = resolved.reduce((s, b) => s + calcPnl(b), 0);
    const roi  = totalStaked > 0 ? (pnl / totalStaked) * 100 : 0;
    return { wins, losses, totalStaked, pnl, roi };
  }

  // ── Render table
  function renderTable() {
    const list = getFiltered();
    const tbody = document.getElementById('journal-tbody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="empty-state">Aucun pari trouvé</td></tr>';
    } else {
      tbody.innerHTML = list.map(bet => {
        const pnl = calcPnl(bet);
        const sportIcon = { tennis:'🎾', football:'⚽', basketball:'🏀' }[bet.sport] || '🎾';
        return `
          <tr>
            <td>${bet.date}</td>
            <td>${sportIcon}</td>
            <td style="font-weight:500;color:var(--text-primary)">${bet.match}</td>
            <td><span class="type-badge type-${bet.type}">${bet.type === 'live' ? 'LIVE' : 'PRÉ'}</span></td>
            <td>${bet.market}</td>
            <td>${bet.selection}</td>
            <td class="mono">${parseFloat(bet.cote).toFixed(2)}</td>
            <td class="mono">${parseFloat(bet.stake).toFixed(0)} €</td>
            <td class="mono ${bet.edge > 9 ? 'text-green' : bet.edge > 4 ? 'text-cyan' : 'text-muted'}">${bet.edge ? '+' + bet.edge + '%' : '—'}</td>
            <td class="mono ${bet.result === 'win' ? 'pnl-positive' : bet.result === 'loss' ? 'pnl-negative' : 'pnl-pending'}">
              ${bet.result === 'win' ? '+' : ''}${bet.result !== 'pending' ? pnl.toFixed(0) + ' €' : '—'}
            </td>
            <td><span class="result-badge result-${bet.result}">${resultLabel(bet.result)}</span></td>
            <td>
              ${bet.result === 'pending' ? `
                <button class="btn btn-sm btn-secondary" onclick="JournalModule.markResult(${bet.id},'win')">✅</button>
                <button class="btn btn-sm btn-secondary" onclick="JournalModule.markResult(${bet.id},'loss')">❌</button>
              ` : ''}
              <button class="btn btn-sm btn-danger" onclick="JournalModule.removeBet(${bet.id})">🗑</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Stats
    const stats = calcStats(list);
    document.getElementById('j-total-staked').textContent = stats.totalStaked.toFixed(0) + ' €';
    document.getElementById('j-pnl').textContent = (stats.pnl >= 0 ? '+' : '') + stats.pnl.toFixed(0) + ' €';
    document.getElementById('j-pnl').className = 'stat-value ' + (stats.pnl >= 0 ? 'text-green' : 'text-red');
    document.getElementById('j-roi').textContent = (stats.roi >= 0 ? '+' : '') + stats.roi.toFixed(1) + '%';
    document.getElementById('j-roi').className = 'stat-value ' + (stats.roi >= 0 ? 'text-green' : 'text-red');
    document.getElementById('j-wl').textContent = `${stats.wins} / ${stats.losses}`;
  }

  function resultLabel(r) {
    return { win: '✅ Gagné', loss: '❌ Perdu', pending: '⏳ Attente', void: '↩️ Annulé' }[r] || r;
  }

  function markResult(id, result) {
    updateBetResult(id, result);

    // Mettre à jour la bankroll si résultat défini
    const bet = bets.find(b => b.id === id);
    if (bet) {
      const pnl = calcPnl({ ...bet, result });
      if (pnl > 0) BankrollManager.recordWin(pnl, bet.type === 'live');
      else if (pnl < 0) BankrollManager.recordLoss(-pnl, bet.type === 'live');
    }

    renderTable();
    DashboardModule.refresh();
  }

  function removeBet(id) {
    deleteBet(id);
    renderTable();
    DashboardModule.refresh();
  }

  function getAllBets() { return [...bets]; }

  function init() {
    load();

    // Formulaire ajout pari
    document.getElementById('btn-add-bet').addEventListener('click', () => {
      const form = document.getElementById('add-bet-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
      // Pré-remplir la date
      document.getElementById('j-date').value = new Date().toISOString().split('T')[0];
    });

    document.getElementById('btn-cancel-bet').addEventListener('click', () => {
      document.getElementById('add-bet-form').style.display = 'none';
    });

    document.getElementById('btn-save-bet').addEventListener('click', () => {
      const bet = {
        date:      document.getElementById('j-date').value,
        sport:     document.getElementById('j-sport').value,
        match:     document.getElementById('j-match').value,
        type:      document.getElementById('j-type').value,
        market:    document.getElementById('j-market').value,
        selection: document.getElementById('j-selection').value,
        cote:      document.getElementById('j-cote').value,
        stake:     document.getElementById('j-stake').value,
        edge:      document.getElementById('j-edge').value,
        result:    document.getElementById('j-result').value,
        reason:    document.getElementById('j-reason').value,
      };

      if (!bet.match || !bet.cote || !bet.stake) {
        alert('⚠️ Veuillez renseigner au minimum le match, la cote et la mise.');
        return;
      }

      addBet(bet);

      // Impact bankroll si déjà résolu
      if (bet.result !== 'pending' && bet.result !== 'void') {
        const pnl = calcPnl(bet);
        if (pnl > 0) BankrollManager.recordWin(pnl, bet.type === 'live');
        else if (pnl < 0) BankrollManager.recordLoss(-pnl, bet.type === 'live');
      }

      renderTable();
      document.getElementById('add-bet-form').style.display = 'none';
      document.getElementById('journal-form').reset();
      DashboardModule.refresh();
    });

    // Filtres
    ['filter-sport','filter-type','filter-result'].forEach(id => {
      document.getElementById(id).addEventListener('change', (e) => {
        const key = { 'filter-sport': 'sport', 'filter-type': 'type', 'filter-result': 'result' }[id];
        filters[key] = e.target.value;
        renderTable();
      });
    });

    renderTable();
  }

  return { init, renderTable, markResult, removeBet, getAllBets, calcStats };
})();
