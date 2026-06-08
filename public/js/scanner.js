/**
 * OddsOracle — Scanner IA
 * Scan automatique de valeur sur tous les sports
 * Algorithme: edge via ligne sharp (Pinnacle) + Kelly automatique
 */

const ScannerModule = (() => {

  let _autoRefreshTimer = null;
  let _lastScanData     = null;
  let _bankroll         = 1000;
  const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 min

  // ── Icônes bookmakers
  const BOOK_ICONS = {
    'Pinnacle':    '📌',
    'Betclic':     '🔵',
    'Unibet':      '🟢',
    'Winamax':     '🟠',
    'Bet365':      '🔴',
  };

  // ── Badges confiance
  const CONF_META = {
    high:   { label: 'Sharp', cls: 'conf-high',   desc: 'Ligne Pinnacle (sharp money)' },
    medium: { label: 'Bon',   cls: 'conf-medium',  desc: '3+ bookmakers disponibles' },
    low:    { label: 'Faible',cls: 'conf-low',     desc: 'Données limitées' },
  };

  // ── Urgence
  const URGENCY_META = {
    live:     { label: 'EN COURS', cls: 'urgency-live' },
    soon:     { label: '< 2h',     cls: 'urgency-soon' },
    today:    { label: 'Aujourd\'hui', cls: 'urgency-today' },
    upcoming: { label: 'À venir',  cls: 'urgency-upcoming' },
  };

  // ──────────────────────────────────────────────
  // KELLY AUTOMATIQUE
  // ──────────────────────────────────────────────
  function autoKelly(trueProb, bestPrice, bankroll, isLive) {
    const p = trueProb / 100;
    const q = 1 - p;
    const b = bestPrice - 1;
    const k = (p * b - q) / b;
    if (k <= 0) return null;
    const frac = isLive ? k / 6 : k / 4;   // 1/4 prematch, 1/6 live
    const liveMult = isLive ? 0.6 : 1;      // -40% en live
    const portion = isLive ? bankroll * 0.3 : bankroll * 0.7;
    const stake = Math.max(1, Math.round(portion * frac * liveMult * 10) / 10);
    return {
      stake,
      pnlWin:  Math.round((stake * (bestPrice - 1)) * 10) / 10,
      pnlLoss: -stake,
      fraction: Math.round(frac * 1000) / 10,
    };
  }

  // ──────────────────────────────────────────────
  // SCAN
  // ──────────────────────────────────────────────
  async function runScan(silent = false) {
    const btn       = document.getElementById('btn-scan');
    const container = document.getElementById('scanner-results');
    const status    = document.getElementById('scanner-status');
    const meta      = document.getElementById('scanner-meta');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Scan en cours...'; }

    if (!silent && container) {
      container.innerHTML = '<div class="scanner-loading"><div class="scanner-spinner"></div><span>Analyse de tous les marchés...</span></div>';
    }

    try {
      const res  = await fetch('/api/scanner');
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Erreur serveur');

      _lastScanData = json.data;
      _bankroll = BankrollManager.get().current || 1000;

      renderResults(json.data, json.scannedAt, json.cached);

      if (status) {
        const t = new Date(json.scannedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        status.textContent = `Dernière analyse: ${t}${json.cached ? ' (cache)' : ''}`;
        status.className   = 'scanner-status ok';
      }

      if (meta && json.data?.meta) {
        const m = json.data.meta;
        meta.textContent = `${m.sportsScanned} sports · ${m.eventsFound} matchs analysés · ${m.totalOpportunities} opportunités trouvées`;
      }

    } catch (err) {
      if (container) {
        container.innerHTML = `
          <div class="scanner-error">
            <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
            <strong>${err.message}</strong>
            <div style="margin-top:.5rem;font-size:.78rem;color:var(--text-muted)">
              ${err.message.includes('ODDS_API_KEY')
                ? 'Configurez votre clé API The Odds API dans les paramètres Render.'
                : 'Vérifiez votre connexion et réessayez.'}
            </div>
          </div>`;
      }
      if (status) { status.textContent = 'Erreur de scan'; status.className = 'scanner-status error'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Scanner maintenant'; }
    }
  }

  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  function renderResults(data, scannedAt, cached) {
    const container = document.getElementById('scanner-results');
    if (!container) return;

    if (!data?.opportunities?.length) {
      container.innerHTML = `
        <div class="scanner-empty">
          <div style="font-size:3rem;margin-bottom:1rem">🔍</div>
          <strong>Aucune opportunité détectée</strong>
          <div style="margin-top:.5rem;color:var(--text-muted);font-size:.8rem">
            Pas de matchs avec edge positif dans les prochaines 48h.<br>
            Réessayez plus tard ou vérifiez que votre clé API est configurée.
          </div>
        </div>`;
      return;
    }

    const opps = data.opportunities;
    const html = opps.map((opp, i) => renderCard(opp, i)).join('');
    container.innerHTML = `<div class="scanner-grid">${html}</div>`;
  }

  function renderCard(opp, rank) {
    const kelly   = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);
    const conf    = CONF_META[opp.confidence] || CONF_META.low;
    const urgency = URGENCY_META[opp.urgency] || URGENCY_META.upcoming;
    const bookIcon = BOOK_ICONS[opp.bestBook] || '📚';
    const edgeCls  = opp.edge >= 10 ? 'edge-very-high' : opp.edge >= 6 ? 'edge-high' : 'edge-medium';

    const matchTime = opp.isLive
      ? '<span class="match-live-tag">● EN COURS</span>'
      : `<span class="match-time">${formatTime(opp.commenceTime)}</span>`;

    const selectionDisplay = opp.selection === opp.homeTeam
      ? `🏠 ${opp.homeTeam}`
      : `✈️ ${opp.awayTeam}`;

    return `
    <div class="scanner-card ${opp.isLive ? 'scanner-card-live' : ''}" data-rank="${rank}">
      <div class="sc-header">
        <div class="sc-rank">#${rank + 1}</div>
        <div class="sc-sport">${opp.sportIcon} ${opp.sportLabel}</div>
        <div class="sc-urgency ${urgency.cls}">${urgency.label}</div>
      </div>

      <div class="sc-match">
        <div class="sc-teams">${opp.homeTeam} <span class="vs-tag">VS</span> ${opp.awayTeam}</div>
        <div class="sc-time">${matchTime}</div>
      </div>

      <div class="sc-selection">
        <span class="sc-sel-label">PARIER SUR</span>
        <span class="sc-sel-name">${selectionDisplay}</span>
      </div>

      <div class="sc-metrics">
        <div class="sc-metric">
          <span class="sc-metric-label">Cote</span>
          <span class="sc-metric-val sc-cote">${opp.bestPrice.toFixed(2)}</span>
          <span class="sc-metric-sub">${bookIcon} ${opp.bestBook}</span>
        </div>
        <div class="sc-metric">
          <span class="sc-metric-label">Prob. vraie</span>
          <span class="sc-metric-val">${opp.trueProb}%</span>
          <span class="sc-metric-sub">Ligne sharp</span>
        </div>
        <div class="sc-metric">
          <span class="sc-metric-label">Edge</span>
          <span class="sc-metric-val sc-edge ${edgeCls}">+${opp.edge}%</span>
          <span class="sc-metric-sub">Valeur attendue</span>
        </div>
        <div class="sc-metric">
          <span class="sc-metric-label">Confiance</span>
          <span class="sc-metric-val"><span class="conf-badge ${conf.cls}">${conf.label}</span></span>
          <span class="sc-metric-sub">${conf.desc}</span>
        </div>
      </div>

      ${kelly ? `
      <div class="sc-kelly">
        <div class="sc-kelly-header">
          <span>🎯 Mise recommandée (Kelly ${opp.isLive ? '1/6' : '1/4'})</span>
          <span class="sc-kelly-mode">${opp.isLive ? 'LIVE -40%' : 'PRÉ-MATCH'}</span>
        </div>
        <div class="sc-kelly-body">
          <div class="sc-kelly-stake">${kelly.stake} €</div>
          <div class="sc-kelly-detail">
            <span>Gain si ✅ : <strong class="text-green">+${kelly.pnlWin} €</strong></span>
            <span>Perte si ❌ : <strong class="text-red">${kelly.pnlLoss} €</strong></span>
            <span>Fraction Kelly : ${kelly.fraction}%</span>
          </div>
        </div>
      </div>` : `
      <div class="sc-kelly sc-kelly-invalid">
        Edge insuffisant pour une mise Kelly positive
      </div>`}

      <div class="sc-footer">
        <button class="btn btn-sm btn-secondary sc-journal-btn" onclick="ScannerModule.addToJournal(${rank})">
          + Journal
        </button>
        <span class="sc-disclaimer">Valeur mathématique — résultats non garantis</span>
      </div>
    </div>`;
  }

  function formatTime(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ──────────────────────────────────────────────
  // FILTRES
  // ──────────────────────────────────────────────
  function applyFilters() {
    if (!_lastScanData?.opportunities) return;
    const sport   = document.getElementById('scan-filter-sport')?.value || 'all';
    const minEdge = parseFloat(document.getElementById('scan-filter-edge')?.value || 0);
    const onlyLive = document.getElementById('scan-filter-live')?.checked || false;

    const filtered = _lastScanData.opportunities.filter(o => {
      if (sport !== 'all' && o.sport !== sport) return false;
      if (o.edge < minEdge) return false;
      if (onlyLive && !o.isLive) return false;
      return true;
    });

    const container = document.getElementById('scanner-results');
    if (!container) return;

    if (!filtered.length) {
      container.innerHTML = '<div class="scanner-empty">Aucune opportunité avec ces filtres</div>';
      return;
    }

    container.innerHTML = `<div class="scanner-grid">${filtered.map((o, i) => renderCard(o, i)).join('')}</div>`;
  }

  // ──────────────────────────────────────────────
  // AJOUTER AU JOURNAL
  // ──────────────────────────────────────────────
  function addToJournal(rank) {
    if (!_lastScanData?.opportunities) return;
    const opp   = _lastScanData.opportunities[rank];
    if (!opp) return;
    const kelly = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);

    // Pré-remplir le formulaire journal
    const tab = document.querySelector('[data-tab="journal"]');
    if (tab) tab.click();

    setTimeout(() => {
      const addBtn = document.getElementById('btn-add-bet');
      if (addBtn) addBtn.click();

      setTimeout(() => {
        const sportMap = {
          tennis_atp: 'tennis', tennis_wta: 'tennis',
          soccer_france_ligue1: 'football', soccer_epl: 'football', soccer_europe_champs: 'football',
          basketball_nba: 'basketball', basketball_euroleague: 'basketball',
        };

        const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
        setVal('j-date',      new Date().toISOString().split('T')[0]);
        setVal('j-sport',     sportMap[opp.sport] || 'tennis');
        setVal('j-match',     `${opp.homeTeam} vs ${opp.awayTeam}`);
        setVal('j-type',      opp.isLive ? 'live' : 'prematch');
        setVal('j-market',    'Vainqueur match');
        setVal('j-selection', opp.selection);
        setVal('j-cote',      opp.bestPrice);
        setVal('j-stake',     kelly?.stake || '');
        setVal('j-edge',      opp.edge);
        setVal('j-reason',    `Scanner IA — Edge ${opp.edge}% · Prob ${opp.trueProb}% · ${opp.bestBook}`);
      }, 200);
    }, 300);
  }

  // ──────────────────────────────────────────────
  // AUTO-REFRESH
  // ──────────────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(() => runScan(true), REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  }

  // ──────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────
  function init() {
    const btn = document.getElementById('btn-scan');
    if (btn) btn.addEventListener('click', () => runScan(false));

    // Filtres
    ['scan-filter-sport', 'scan-filter-edge'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', applyFilters);
    });
    const liveChk = document.getElementById('scan-filter-live');
    if (liveChk) liveChk.addEventListener('change', applyFilters);

    startAutoRefresh();

    // Lancer un premier scan au chargement de l'onglet
    const scanTab = document.querySelector('[data-tab="scanner"]');
    if (scanTab) {
      scanTab.addEventListener('click', () => {
        if (!_lastScanData) runScan(false);
      });
    }
  }

  return { init, runScan, addToJournal, applyFilters };
})();
