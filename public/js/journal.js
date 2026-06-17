/**
 * OddsOracle - Journal des Paris
 * Enregistrement, affichage, filtrage, statistiques
 */

const JournalModule = (() => {

  // Journal persisté côté serveur (voir /api/journal dans server.js) : permet
  // de partager le journal entre le navigateur et les tâches planifiées
  // (ex: log automatique des pronos FORTE), au lieu de l'ancien localStorage
  // propre à chaque navigateur.
  let bets = [];
  let filters = { sport: 'all', type: 'all', result: 'all' };

  async function load() {
    try {
      const r = await fetch('/api/journal');
      const data = await r.json();
      bets = Array.isArray(data.data) ? data.data : [];
    } catch(e) {
      console.warn('[journal] load:', e.message);
      bets = [];
    }
  }

  async function addBet(bet) {
    try {
      const r = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bet)
      });
      const data = await r.json();
      bets.unshift(data.data); // plus récent en premier
    } catch(e) {
      console.warn('[journal] addBet:', e.message);
      bet.id = Date.now();
      bets.unshift(bet);
    }
  }

  async function updateBetResult(id, result) {
    const b = bets.find(b => b.id === id);
    if (b) b.result = result;
    try {
      await fetch('/api/journal/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result })
      });
    } catch(e) { console.warn('[journal] updateBetResult:', e.message); }
  }

  async function deleteBet(id) {
    bets = bets.filter(b => b.id !== id);
    try {
      await fetch('/api/journal/' + id, { method: 'DELETE' });
    } catch(e) { console.warn('[journal] deleteBet:', e.message); }
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
        const sportIcon = { tennis:'🎾', football:'⚽', basketball:'🏀', hockey:'🏒', baseball:'⚾', mma:'🥊', american_football:'🏈', rugby:'🏉', cricket:'🏏', aussie_rules:'🏉' }[bet.sport] || '🎾';
        return `
          <tr>
            <td>${bet.date}</td>
            <td>${sportIcon}</td>
            <td style="font-weight:500;color:var(--text-primary)">${escHtml(bet.match)}</td>
            <td><span class="type-badge type-${bet.type}">${bet.type === 'live' ? 'LIVE' : 'PRÉ'}</span></td>
            <td>${escHtml(bet.market)}</td>
            <td>${escHtml(bet.selection)}</td>
            <td class="mono">${parseFloat(bet.cote).toFixed(2)}</td>
            <td class="mono">${parseFloat(bet.stake).toFixed(0)} €</td>
            <td class="mono ${bet.edge > 9 ? 'text-green' : bet.edge > 4 ? 'text-cyan' : 'text-muted'}">${bet.edge ? '+' + bet.edge + '%' : '-'}</td>
            <td class="mono ${bet.result === 'win' ? 'pnl-positive' : bet.result === 'loss' ? 'pnl-negative' : 'pnl-pending'}">
              ${bet.result === 'win' ? '+' : ''}${bet.result !== 'pending' ? pnl.toFixed(0) + ' €' : '-'}
            </td>
            <td><span class="result-badge result-${bet.result}">${resultLabel(bet.result)}</span></td>
            <td>
              ${bet.result === 'pending' ? `
                <button class="btn btn-sm btn-secondary" onclick="JournalModule.markResult(${bet.id},'win')">✅</button>
                <button class="btn btn-sm btn-secondary" onclick="JournalModule.markResult(${bet.id},'loss')">❌</button>
              ` : ''}
              ${bet.result === 'win' || bet.result === 'loss' ? `
                <button class="btn btn-sm btn-secondary" onclick="JournalModule.recheckBet(${bet.id})" title="Revérifier le résultat réel">🔄</button>
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

  async function markResult(id, result) {
    const bet = bets.find(b => b.id === id);
    if (!bet) return;
    // Évite un double impact bankroll si le pari est déjà résolu
    // (ex: appel concurrent avec autoCheckPendingBets)
    if (bet.result !== 'pending') { renderTable(); return; }

    await updateBetResult(id, result);

    // Mettre à jour la bankroll
    const pnl = calcPnl({ ...bet, result });
    if (pnl > 0) BankrollManager.recordWin(pnl, bet.type === 'live');
    else if (pnl < 0) BankrollManager.recordLoss(-pnl, bet.type === 'live');

    renderTable();
    DashboardModule.refresh();
  }

  async function removeBet(id) {
    await deleteBet(id);
    renderTable();
    DashboardModule.refresh();
  }

  function getAllBets() { return [...bets]; }

  async function init() {
    await load();
    renderTable();

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

    document.getElementById('btn-save-bet').addEventListener('click', async () => {
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

      await addBet(bet);

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

    // Vérifie automatiquement les paris en attente au démarrage
    setTimeout(autoCheckPendingBets, 2000);
    // Puis re-vérifie périodiquement (utile pour les paris LIVE en cours)
    setInterval(autoCheckPendingBets, 120000); // toutes les 2 minutes
  }

  // -----------------------------------------------------------------------
  // AUTO-CHECK RÉSULTATS : vérifie les paris "pending" via /api/check-result
  // -----------------------------------------------------------------------
  let _autoCheckRunning = false;

  async function autoCheckPendingBets() {
    if (_autoCheckRunning) return;
    _autoCheckRunning = true;

    const pending = bets.filter(b => b.result === 'pending' && b.match && b.selection);
    if (!pending.length) { _autoCheckRunning = false; return; }

    console.log('[journal] Auto-check', pending.length, 'paris en attente...');

    for (const bet of pending) {
      try {
        // Extraire home/away depuis "Home vs Away"
        const parts = bet.match.split(/\s+vs\s+/i);
        if (parts.length < 2) continue;
        const home = parts[0].trim();
        const away = parts[1].trim();

        const params = new URLSearchParams({
          home, away,
          date: bet.date || '',
          selection: bet.selection || '',
          sport: bet.sportKey || bet.sport || ''
        });

        const r = await fetch('/api/check-result?' + params);
        if (!r.ok) continue;
        const data = await r.json();

        if (data.result === 'win' || data.result === 'loss') {
          // Re-vérifie que le pari est toujours en attente (évite double impact
          // bankroll si l'utilisateur l'a déjà résolu manuellement entre-temps)
          const current = bets.find(b => b.id === bet.id);
          if (!current || current.result !== 'pending') continue;

          await updateBetResult(bet.id, data.result);
          // Impact bankroll
          const pnl = calcPnl({ ...bet, result: data.result });
          if (pnl > 0) BankrollManager.recordWin(pnl, bet.type === 'live');
          else if (pnl < 0) BankrollManager.recordLoss(-pnl, bet.type === 'live');
          console.log('[journal] ✅ Résultat auto:', bet.match, '→', data.result, data.score || '');
        }

        // Pause entre requêtes pour ne pas spammer le serveur
        await new Promise(resolve => setTimeout(resolve, 600));
      } catch(e) { /* silencieux */ }
    }

    renderTable();
    DashboardModule.refresh();
    _autoCheckRunning = false;
  }

  // -----------------------------------------------------------------------
  // RE-VÉRIFICATION MANUELLE : recalcule le résultat réel d'un pari déjà
  // marqué Gagné/Perdu (correction d'une erreur de résolution antérieure)
  // -----------------------------------------------------------------------
  const _recheckingIds = new Set();

  async function recheckBet(id) {
    const bet = bets.find(b => b.id === id);
    if (!bet || !bet.match || !bet.selection) return;
    // Empêche un double-clic / double appel concurrent sur le même pari
    // (éviterait une double annulation/réapplication de l'impact bankroll)
    if (_recheckingIds.has(id)) return;
    _recheckingIds.add(id);

    try {
      const parts = bet.match.split(/\s+vs\s+/i);
      if (parts.length < 2) { alert('⚠️ Format du match invalide.'); return; }
      const home = parts[0].trim();
      const away = parts[1].trim();

      const params = new URLSearchParams({
        home, away,
        date: bet.date || '',
        selection: bet.selection || '',
        sport: bet.sportKey || bet.sport || ''
      });

      const r = await fetch('/api/check-result?' + params);
      if (!r.ok) { alert('⚠️ Impossible de vérifier le résultat pour le moment.'); return; }
      const data = await r.json();

      if (data.result !== 'win' && data.result !== 'loss') {
        alert('ℹ️ Match pas encore terminé (statut: ' + (data.status || data.reason || 'inconnu') + ').');
        return;
      }

      if (data.result === bet.result) {
        alert('✅ Résultat confirmé : ' + resultLabel(data.result) + (data.score ? ' (' + data.score + ')' : ''));
        return;
      }

      // Annule l'impact bankroll de l'ancien résultat (incorrect)
      const oldPnl = calcPnl(bet);
      if (oldPnl > 0) BankrollManager.recordLoss(oldPnl, bet.type === 'live');
      else if (oldPnl < 0) BankrollManager.recordWin(-oldPnl, bet.type === 'live');

      // Applique le résultat réel
      await updateBetResult(id, data.result);
      const newPnl = calcPnl(bet);
      if (newPnl > 0) BankrollManager.recordWin(newPnl, bet.type === 'live');
      else if (newPnl < 0) BankrollManager.recordLoss(-newPnl, bet.type === 'live');

      renderTable();
      DashboardModule.refresh();
      alert('🔄 Résultat corrigé : ' + resultLabel(data.result) + (data.score ? ' (' + data.score + ')' : ''));
    } catch(e) {
      alert('⚠️ Erreur lors de la vérification.');
    } finally {
      _recheckingIds.delete(id);
    }
  }

  return { init, renderTable, markResult, removeBet, recheckBet, getAllBets, calcStats, autoCheckPendingBets };
})();
