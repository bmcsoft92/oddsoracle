/**
 * OddsOracle -- Scanner IA v2
 * Scan automatique de valeur sur tous les sports
 * Algorithme: edge via ligne sharp (Pinnacle) + Kelly automatique
 * Nouveautes v2: notifications browser, auto-log journal, coherence sport, watch live
 */

const ScannerModule = (() => {

  let _autoRefreshTimer = null;
  let _lastScanData     = null;
  let _bankroll         = 1000;
  const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 min

  // IDs des opportunités deja notifiees/loggees (evite doublons sur refresh)
  const _seenIds    = new Set();
  const _loggedIds  = new Set();

  // Parametres utilisateur
  let _notifyEnabled  = false;
  let _autoLogEnabled = false;

  // -- Icones bookmakers (ASCII)
  const BOOK_ICONS = {
    'Pinnacle': '[P]',
    'Betclic':  '[BC]',
    'Unibet':   '[UN]',
    'Winamax':  '[WM]',
    'Bet365':   '[B365]',
  };

  // -- Badges confiance
  const CONF_META = {
    high:   { label: 'Sharp', cls: 'conf-high',   desc: 'Ligne Pinnacle (sharp money)' },
    medium: { label: 'Bon',   cls: 'conf-medium',  desc: '3+ bookmakers disponibles' },
    low:    { label: 'Faible',cls: 'conf-low',     desc: 'Donnees limitees' },
  };

  // -- Urgence
  const URGENCY_META = {
    live:     { label: 'EN COURS',    cls: 'urgency-live' },
    soon:     { label: '< 2h',        cls: 'urgency-soon' },
    today:    { label: "Aujourd'hui", cls: 'urgency-today' },
    upcoming: { label: 'A venir',     cls: 'urgency-upcoming' },
  };

  // Map sport key -> groupe pour coherence et streaming
  const SPORT_MAP = {
    tennis_atp:                        'tennis',
    tennis_wta:                        'tennis',
    soccer_france_ligue1:              'football',
    soccer_epl:                        'football',
    soccer_europe_champs:              'football',
    soccer_spain_la_liga:              'football',
    soccer_italy_serie_a:              'football',
    soccer_germany_bundesliga:         'football',
    soccer_portugal_primeira_liga:     'football',
    soccer_netherlands_eredivisie:     'football',
    soccer_usa_mls:                    'football',
    soccer_colombia_primera_a:         'football',
    soccer_brazil_campeonato:          'football',
    soccer_argentina_primera_division: 'football',
    basketball_nba:                    'basketball',
    basketball_nba_championship:       'basketball',
    basketball_wnba:                   'basketball',
    basketball_euroleague:             'basketball',
    basketball_ncaab:                  'basketball',
    baseball_mlb:                      'baseball',
    icehockey_nhl:                     'hockey',
    mma_mixed_martial_arts:            'mma',
    americanfootball_nfl:              'american_football',
  };

  // -----------------------------------------------------------------
  // IDENTIFIANT UNIQUE D'UNE OPPORTUNITE
  // -----------------------------------------------------------------
  function oppId(opp) {
    return `${opp.sport}|${opp.homeTeam}|${opp.awayTeam}|${opp.selection}`;
  }

  // -----------------------------------------------------------------
  // KELLY AUTOMATIQUE
  // -----------------------------------------------------------------
  function autoKelly(trueProb, bestPrice, bankroll, isLive) {
    const p = trueProb / 100;
    const q = 1 - p;
    const b = bestPrice - 1;
    const k = (p * b - q) / b;
    if (k <= 0) return null;
    const frac     = isLive ? k / 6 : k / 4;
    const liveMult = isLive ? 0.6 : 1;
    const portion  = isLive ? bankroll * 0.3 : bankroll * 0.7;
    const stake    = Math.max(1, Math.round(portion * frac * liveMult * 10) / 10);
    return {
      stake,
      pnlWin:   Math.round((stake * (bestPrice - 1)) * 10) / 10,
      pnlLoss:  -stake,
      fraction: Math.round(frac * 1000) / 10,
    };
  }

  // -----------------------------------------------------------------
  // NOTIFICATIONS BROWSER
  // -----------------------------------------------------------------
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('Votre navigateur ne supporte pas les notifications');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }

  function sendBrowserNotification(opp, kelly) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const stakeStr = kelly ? `Mise: ${kelly.stake} EUR | ` : '';
    const body = [
      `${opp.selection} @ ${opp.bestPrice.toFixed(2)}`,
      `${opp.bestBook}`,
      `${stakeStr}Edge: +${opp.edge}%`,
      opp.isLive ? 'MATCH EN COURS' : formatTime(opp.commenceTime),
    ].join('\n');

    const n = new Notification(
      `[BET] ${opp.homeTeam} vs ${opp.awayTeam}`,
      { body, tag: oppId(opp), requireInteraction: true }
    );

    n.onclick = () => {
      window.focus();
      const scanTab = document.querySelector('[data-tab="scanner"]');
      if (scanTab) scanTab.click();
      n.close();
    };
  }

  function updateNotifButton() {
    const btn = document.getElementById('btn-notif-toggle');
    if (!btn) return;
    const perm = ('Notification' in window) ? Notification.permission : 'denied';
    if (!_notifyEnabled) {
      btn.textContent = 'Notifications OFF';
      btn.className   = 'btn btn-sm btn-secondary sc-notif-btn';
    } else if (perm !== 'granted') {
      btn.textContent = 'Autoriser notifications';
      btn.className   = 'btn btn-sm btn-primary sc-notif-btn';
    } else {
      btn.textContent = 'Notifications ON';
      btn.className   = 'btn btn-sm btn-success sc-notif-btn';
    }
  }

  // -----------------------------------------------------------------
  // AUTO-LOG JOURNAL
  // -----------------------------------------------------------------
  function autoLogToJournal(opp, kelly) {
    if (!_autoLogEnabled) return;
    const id = oppId(opp);
    if (_loggedIds.has(id)) return;
    _loggedIds.add(id);

    const bet = {
      date:      new Date().toISOString().split('T')[0],
      sport:     SPORT_MAP[opp.sport] || 'tennis',
      match:     `${opp.homeTeam} vs ${opp.awayTeam}`,
      type:      opp.isLive ? 'live' : 'prematch',
      market:    'Vainqueur match',
      selection: opp.selection,
      cote:      opp.bestPrice,
      stake:     kelly ? kelly.stake : 1,
      edge:      opp.edge,
      result:    'pending',
      reason:    `[AUTO] Scanner IA -- Edge ${opp.edge}% -- ${opp.bestBook} -- Prob ${opp.trueProb}%`,
    };

    JournalModule.addBet(bet);

    const journalTab = document.querySelector('[data-tab="journal"]');
    if (journalTab) {
      let badge = journalTab.querySelector('.nav-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        journalTab.appendChild(badge);
      }
      const count = (parseInt(badge.textContent) || 0) + 1;
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    }
  }

  // -----------------------------------------------------------------
  // COHERENCE SPORT -- sync filtre vers Live et Prematch
  // -----------------------------------------------------------------
  function syncSportToOtherTabs(sportKey) {
    const liveSelect = document.getElementById('live-sport-select');
    if (liveSelect) {
      const opt = Array.from(liveSelect.options).find(o => o.value === sportKey);
      if (opt) liveSelect.value = sportKey;
    }
    const pmSelect = document.getElementById('pm-api-sport');
    if (pmSelect) {
      const opt = Array.from(pmSelect.options).find(o => o.value === sportKey);
      if (opt) pmSelect.value = sportKey;
    }
  }

  // -----------------------------------------------------------------
  // SCAN
  // -----------------------------------------------------------------
  async function runScan(silent = false) {
    const btn       = document.getElementById('btn-scan');
    const container = document.getElementById('scanner-results');
    const status    = document.getElementById('scanner-status');
    const meta      = document.getElementById('scanner-meta');

    if (btn) { btn.disabled = true; btn.textContent = 'Scan en cours...'; }

    if (!silent && container) {
      container.innerHTML = '<div class="scanner-loading"><div class="scanner-spinner"></div><span>Analyse de tous les marches...</span></div>';
    }

    try {
      const res  = await fetch('/api/scanner');
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Erreur serveur');

      _lastScanData = json.data;
      _bankroll = BankrollManager.get
        ? BankrollManager.get().current
        : (BankrollManager.getState ? BankrollManager.getState().current : 1000) || 1000;

      const opps = json.data && json.data.opportunities ? json.data.opportunities : [];
      opps.forEach(opp => {
        const id = oppId(opp);
        if (!_seenIds.has(id)) {
          _seenIds.add(id);
          const kelly = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);
          if (_notifyEnabled) sendBrowserNotification(opp, kelly);
          autoLogToJournal(opp, kelly);
        }
      });

      const badgeEl = document.getElementById('scanner-badge');
      if (badgeEl) {
        const count = opps.length;
        badgeEl.textContent = count;
        badgeEl.style.display = count > 0 ? 'inline-flex' : 'none';
      }

      renderResults(json.data, json.scannedAt, json.cached);

      if (status) {
        const t = new Date(json.scannedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        status.textContent = `Derniere analyse: ${t}${json.cached ? ' (cache)' : ''}`;
        status.className   = 'scanner-status ok';
      }

      if (meta && json.data && json.data.meta) {
        const m = json.data.meta;
        meta.textContent = `${m.sportsScanned} sports -- ${m.eventsFound} matchs -- ${m.totalOpportunities} opportunites`;
      }

    } catch (err) {
      if (container) {
        container.innerHTML = `
          <div class="scanner-error">
            <div style="font-size:2rem;margin-bottom:.75rem">(!)</div>
            <strong>${err.message}</strong>
            <div style="margin-top:.5rem;font-size:.78rem;color:var(--text-muted)">
              ${err.message.includes('ODDS_API_KEY')
                ? 'Configurez votre cle API The Odds API dans les parametres Render.'
                : 'Verifiez votre connexion et reessayez.'}
            </div>
          </div>`;
      }
      if (status) { status.textContent = 'Erreur de scan'; status.className = 'scanner-status error'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Scanner maintenant'; }
    }
  }

  // -----------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------
  function renderResults(data, scannedAt, cached) {
    const container = document.getElementById('scanner-results');
    if (!container) return;

    if (!data || !data.opportunities || !data.opportunities.length) {
      container.innerHTML = `
        <div class="scanner-empty">
          <div style="font-size:3rem;margin-bottom:1rem">[?]</div>
          <strong>Aucune opportunite detectee</strong>
          <div style="margin-top:.5rem;color:var(--text-muted);font-size:.8rem">
            Pas de matchs avec edge positif dans les prochaines 48h.<br>
            Reessayez plus tard ou verifiez que votre cle API est configuree.
          </div>
        </div>`;
      return;
    }

    // -- Déduplication : 1 seule sélection par match, filtre données aberrantes --
    const matchBest = {};
    for (const opp of data.opportunities) {
      const teams = [opp.homeTeam, opp.awayTeam].sort().join('|');
      const matchKey = opp.sport + '|' + teams;
      if (!matchBest[matchKey]) matchBest[matchKey] = { opps: [], impliedSum: 0 };
      matchBest[matchKey].opps.push(opp);
      matchBest[matchKey].impliedSum += opp.bestPrice ? (1 / opp.bestPrice) : 0;
    }
    const dedupedOpps = [];
    for (const mk of Object.values(matchBest)) {
      // Si somme des proba implicites < 85% → cotes erronées, ignorer
      if (mk.opps.length > 1 && mk.impliedSum < 0.85) continue;
      // Garder uniquement le meilleur edge par match
      mk.opps.sort((a, b) => (b.edge || 0) - (a.edge || 0));
      dedupedOpps.push(mk.opps[0]);
    }
    dedupedOpps.sort((a, b) => (b.edge || 0) - (a.edge || 0));

    const opps = dedupedOpps;
    const html = opps.map((opp, i) => renderCard(opp, i)).join('');
    container.innerHTML = `<div class="scanner-grid">${html}</div>`;
  }

  function renderCard(opp, rank) {
    const kelly   = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);
    const conf    = CONF_META[opp.confidence] || CONF_META.low;
    const urgency = URGENCY_META[opp.urgency]  || URGENCY_META.upcoming;
    const edgeCls = opp.edge >= 10 ? 'ev-forte' : opp.edge >= 5 ? 'ev-bonne' : 'ev-ok';
    const predLbl = opp.edge >= 10 ? 'FORTE'    : opp.edge >= 5 ? 'BONNE'    : 'CORRECTE';

    const selLabel = opp.selection === opp.homeTeam
      ? '🏠 ' + opp.homeTeam
      : opp.selection === opp.awayTeam
        ? '✈️ ' + opp.awayTeam
        : '🤝 Nul';

    const homeEsc  = opp.homeTeam.replace(/'/g, "\\'");
    const awayEsc  = opp.awayTeam.replace(/'/g, "\\'");
    const isLogged = _loggedIds.has(oppId(opp));

    // Comparateur de cotes (compact, 1 seule fois)
    const bkHtml = (opp.allBookmakers && opp.allBookmakers.length > 1)
      ? opp.allBookmakers.map(function(bk) {
          const isBest = bk.price === opp.bestPrice;
          const pct    = Math.round(100 / bk.price * 10) / 10;
          const barW   = Math.min(100, Math.round((bk.price - 1) / 4 * 100));
          return '<div class="sc2-bk-row' + (isBest ? ' sc2-bk-best' : '') + '">'
            + '<span class="sc2-bk-name">' + bk.name + (isBest ? ' ★' : '') + '</span>'
            + '<div class="sc2-bk-bar-wrap"><div class="sc2-bk-bar" style="width:' + barW + '%"></div></div>'
            + '<span class="sc2-bk-odds">' + bk.price.toFixed(2) + '</span>'
            + '<span class="sc2-bk-impl">' + pct + '%</span>'
            + '</div>';
        }).join('')
      : '';

    return `
    <div class="sc2-card${opp.isLive ? ' sc2-card--live' : ''}${opp.edge >= 10 ? ' sc2-card--forte' : ''}">

      <div class="sc2-head">
        <span class="sc2-rank">#${rank + 1}</span>
        <span class="sc2-sport">${opp.sportLabel || opp.sport}</span>
        <div class="sc2-badges">
          <span class="sc2-urgency ${urgency.cls}">${urgency.label}</span>
          <span class="sc2-ev-badge ${edgeCls}">${predLbl}</span>
        </div>
      </div>

      <div class="sc2-match">
        <div class="sc2-teams">
          <span class="sc2-team sc2-home">${opp.homeTeam}</span>
          <span class="sc2-vs">VS</span>
          <span class="sc2-team sc2-away">${opp.awayTeam}</span>
        </div>
        <div class="sc2-sel-row">
          <span class="sc2-sel-label">PARIER SUR</span>
          <span class="sc2-sel-name">${selLabel}</span>
          <span class="sc2-time">${opp.isLive ? '<span class="sc2-live-dot"></span>EN COURS' : formatTime(opp.commenceTime)}</span>
        </div>
      </div>

      <div class="sc2-metrics">
        <div class="sc2-metric">
          <span class="sc2-m-val">${opp.bestPrice.toFixed(2)}</span>
          <span class="sc2-m-lbl">COTE</span>
          <span class="sc2-m-sub">${opp.bestBook || '?'}</span>
        </div>
        <div class="sc2-metric">
          <span class="sc2-m-val">${opp.trueProb}%</span>
          <span class="sc2-m-lbl">PROB. VRAIE</span>
          <span class="sc2-m-sub">${conf.label} · ${conf.desc}</span>
        </div>
        <div class="sc2-metric">
          <span class="sc2-m-val sc2-edge-val ${edgeCls}">+${opp.edge}%</span>
          <span class="sc2-m-lbl">EDGE</span>
          <span class="sc2-m-sub">Valeur attendue</span>
        </div>
      </div>

      ${bkHtml ? `<div class="sc2-bk-section"><div class="sc2-bk-title">Comparateur de cotes</div>${bkHtml}</div>` : ''}

      ${kelly ? `
      <div class="sc2-kelly">
        <div class="sc2-kelly-left">
          <span class="sc2-kelly-stake">${kelly.stake} <small>EUR</small></span>
          <span class="sc2-kelly-mode">Kelly 1/${opp.isLive ? '6' : '4'} · ${kelly.fraction}%</span>
        </div>
        <div class="sc2-kelly-right">
          <span class="sc2-kelly-win">+${kelly.pnlWin} EUR</span>
          <span class="sc2-kelly-sep">/</span>
          <span class="sc2-kelly-loss">${kelly.pnlLoss} EUR</span>
        </div>
      </div>` : ''}

      <div class="sc2-footer">
        <button class="sc2-btn sc2-btn-journal${isLogged ? ' sc2-btn-logged' : ''}"
                onclick="ScannerModule.addToJournal(${rank})">
          ${isLogged ? '✓ Loggé' : '+ Journal'}
        </button>
        <div class="sc2-footer-right">
          <button class="sc2-btn sc2-btn-ghost" onclick="ScannerModule.focusSport('${opp.sport}')">Ce sport</button>
          <button class="sc2-btn sc2-btn-watch" onclick="ScannerModule.watchMatch('${homeEsc}','${awayEsc}','${opp.sport}')">&#9654; Watch</button>
        </div>
      </div>

    </div>`;
  }

  // -- Ancienne fonction garder pour compat (non utilisee)
  function _renderCardOld(opp, rank) {
    const kelly    = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);
    const conf     = CONF_META[opp.confidence] || CONF_META.low;
    const urgency  = URGENCY_META[opp.urgency] || URGENCY_META.upcoming;
    const bookName = opp.bestBook || '?';
    const edgeCls  = opp.edge >= 10 ? 'edge-very-high' : opp.edge >= 6 ? 'edge-high' : 'edge-medium';

    const matchTime = opp.isLive
      ? '<span class="match-live-tag">EN COURS</span>'
      : `<span class="match-time">${formatTime(opp.commenceTime)}</span>`;

    const selectionDisplay = opp.selection === opp.homeTeam
      ? 'Dom. ' + opp.homeTeam
      : 'Ext. ' + opp.awayTeam;

    const isLogged = _loggedIds.has(oppId(opp));
    const homeEsc  = opp.homeTeam.replace(/'/g, "\\'");
    const awayEsc  = opp.awayTeam.replace(/'/g, "\\'");

    return `
    <div class="scanner-card ${opp.isLive ? 'scanner-card-live' : ''}" data-rank="${rank}">
      <div class="sc-header">
        <div class="sc-rank">#${rank + 1}</div>
        <div class="sc-sport">${opp.sportLabel || opp.sport}</div>
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
          <span class="sc-metric-sub">${bookName}</span>
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

      ${(opp.allBookmakers && opp.allBookmakers.length > 1) ? `
      <div class="sc-bookmakers">
        <div class="sc-bk-header">Comparateur cotes — ${opp.selection}</div>
        <div class="sc-bk-list">
          ${opp.allBookmakers.map(function(bk) {
            const isBest = bk.price === opp.bestPrice;
            const impliedProb = Math.round(100 / bk.price * 10) / 10;
            return '<div class="sc-bk-row' + (isBest ? ' sc-bk-best' : '') + '">'
              + '<span class="sc-bk-name">' + bk.name + (isBest ? ' [MEILLEUR]' : '') + '</span>'
              + '<span class="sc-bk-price">' + bk.price.toFixed(2) + '</span>'
              + '<span class="sc-bk-implied">' + impliedProb + '%</span>'
              + '</div>';
          }).join('')}
        </div>
      </div>` : ''}

      <div class="sc-prediction">
        <div class="sc-pred-header">Prediction Scanner IA</div>
        <div class="sc-pred-bar-wrap">
          <div class="sc-pred-bar" style="width:${opp.predScore || opp.trueProb}%"></div>
        </div>
        <div class="sc-pred-meta">
          <span class="sc-pred-label sc-pred-${(opp.predLabel || 'CORRECTE').toLowerCase().replace('/','')}">${opp.predLabel || 'CORRECTE'}</span>
          <span>Probabilite reelle: <strong>${opp.trueProb}%</strong></span>
          <span>EV: <strong class="text-green">+${opp.ev}%</strong></span>
        </div>
      </div>

      ${(opp.allBookmakers && opp.allBookmakers.length > 1) ? `
      <div class="sc-bookmakers">
        <div class="sc-bk-header">Comparateur cotes</div>
        <div class="sc-bk-list">
          ${opp.allBookmakers.map(function(bk) {
            const isBest = bk.price === opp.bestPrice;
            const impliedProb = Math.round(100 / bk.price * 10) / 10;
            return '<div class="sc-bk-row' + (isBest ? ' sc-bk-best' : '') + '">'
              + '<span class="sc-bk-name">' + bk.name + (isBest ? ' [BEST]' : '') + '</span>'
              + '<span class="sc-bk-price">' + bk.price.toFixed(2) + '</span>'
              + '<span class="sc-bk-implied">' + impliedProb + '%</span>'
              + '</div>';
          }).join('')}
        </div>
      </div>` : ''}

      <div class="sc-prediction">
        <div class="sc-pred-header">Prediction Scanner IA</div>
        <div class="sc-pred-bar-wrap">
          <div class="sc-pred-bar" style="width:${opp.predScore || opp.trueProb}%"></div>
        </div>
        <div class="sc-pred-meta">
          <span class="sc-pred-label sc-pred-${(opp.predLabel||'CORRECTE').toLowerCase()}">${opp.predLabel||'CORRECTE'}</span>
          <span>Prob. reelle: <strong>${opp.trueProb}%</strong></span>
          <span>EV: <strong class="text-green">+${opp.ev}%</strong></span>
        </div>
      </div>

      ${kelly ? `
      <div class="sc-kelly">
        <div class="sc-kelly-header">
          <span>Mise recommandee (Kelly ${opp.isLive ? '1/6' : '1/4'})</span>
          <span class="sc-kelly-mode">${opp.isLive ? 'LIVE -40%' : 'PRE-MATCH'}</span>
        </div>
        <div class="sc-kelly-body">
          <div class="sc-kelly-stake">${kelly.stake}</div>
          <div class="sc-kelly-detail">
            <span>Gain si gagne: <strong class="text-green">+${kelly.pnlWin} EUR</strong></span>
            <span>Perte si perd: <strong class="text-red">${kelly.pnlLoss} EUR</strong></span>
            <span>Fraction Kelly: ${kelly.fraction}%</span>
          </div>
        </div>
      </div>` : `
      <div class="sc-kelly sc-kelly-invalid">
        Edge insuffisant pour une mise Kelly positive
      </div>`}

      <div class="sc-footer">
        <button class="btn btn-sm btn-secondary sc-journal-btn ${isLogged ? 'btn-logged' : ''}"
                onclick="ScannerModule.addToJournal(${rank})">
          ${isLogged ? 'Logge' : '+ Journal'}
        </button>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-sm btn-ghost sc-sport-btn"
                  onclick="ScannerModule.focusSport('${opp.sport}')">
            Ce sport
          </button>
          <button class="btn btn-sm sc-watch-btn"
                  onclick="ScannerModule.watchMatch('${homeEsc}','${awayEsc}','${opp.sport}')">
            Watch
          </button>
        </div>
      </div>
    </div>`;
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // -----------------------------------------------------------------
  // FILTRES
  // -----------------------------------------------------------------
  function applyFilters() {
    if (!_lastScanData || !_lastScanData.opportunities) return;
    const sportEl  = document.getElementById('scan-filter-sport');
    const edgeEl   = document.getElementById('scan-filter-edge');
    const liveEl   = document.getElementById('scan-filter-live');
    const sport    = sportEl ? sportEl.value : 'all';
    const minEdge  = parseFloat(edgeEl ? edgeEl.value : 0);
    const onlyLive = liveEl ? liveEl.checked : false;

    const filtered = _lastScanData.opportunities.filter(o => {
      if (sport !== 'all' && SPORT_MAP[o.sport] !== sport) return false;
      if (o.edge < minEdge) return false;
      if (onlyLive && !o.isLive) return false;
      return true;
    });

    const container = document.getElementById('scanner-results');
    if (!container) return;

    if (!filtered.length) {
      container.innerHTML = '<div class="scanner-empty">Aucune opportunite avec ces filtres</div>';
      return;
    }

    container.innerHTML = `<div class="scanner-grid">${filtered.map((o, i) => renderCard(o, i)).join('')}</div>`;
  }

  function focusSport(sportKey) {
    const filterSel = document.getElementById('scan-filter-sport');
    if (filterSel) { filterSel.value = sportKey; applyFilters(); }
    syncSportToOtherTabs(sportKey);
    showToast('Sport filtre: ' + sportKey.replace(/_/g, ' '));
  }

  // -----------------------------------------------------------------
  // WATCH -- liens streaming par sport
  // -----------------------------------------------------------------
  const STREAMING_LINKS = {
    tennis: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'Tennis TV (ATP)',       url: 'https://www.tennistv.com' },
      { label: 'WTA TV',               url: 'https://www.wtatennis.com/video' },
      { label: 'beIN Sports',          url: 'https://www.beinsports.com' },
    ],
    football: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'Canal+',               url: 'https://www.canalplus.com/sport' },
      { label: 'beIN Sports',          url: 'https://www.beinsports.com' },
      { label: 'DAZN',                 url: 'https://www.dazn.com' },
    ],
    basketball: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'NBA League Pass',      url: 'https://www.nba.com/watch' },
      { label: 'WNBA League Pass',     url: 'https://www.wnba.com/watch' },
      { label: 'DAZN',                 url: 'https://www.dazn.com' },
    ],
    baseball: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'MLB.tv',               url: 'https://www.mlb.com/live-stream-games' },
      { label: 'ESPN+',                url: 'https://plus.espn.com' },
    ],
    hockey: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'NHL.tv',               url: 'https://www.nhl.com/subscribe' },
      { label: 'ESPN+',                url: 'https://plus.espn.com' },
      { label: 'DAZN',                 url: 'https://www.dazn.com' },
    ],
    mma: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'UFC Fight Pass',        url: 'https://ufcfightpass.com' },
      { label: 'ESPN+',                url: 'https://plus.espn.com' },
    ],
    american_football: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'NFL+',                 url: 'https://www.nfl.com/plus' },
      { label: 'ESPN+',                url: 'https://plus.espn.com' },
      { label: 'DAZN',                 url: 'https://www.dazn.com' },
    ],
    default: [
      { label: 'YouTube Live Search',  url: 'https://www.youtube.com/results?search_query={query}+live+stream' },
      { label: 'Google Search',        url: 'https://www.google.com/search?q={query}+live+streaming' },
    ],
  };

  function watchMatch(home, away, sportKey) {
    const group = SPORT_MAP[sportKey] || 'default';
    const links = STREAMING_LINKS[group] || STREAMING_LINKS.default;
    const query = encodeURIComponent(home + ' ' + away);

    const existing = document.getElementById('watch-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'watch-overlay';

    const linksHtml = links.map(function(l) {
      return '<a href="' + l.url.replace('{query}', query) + '" target="_blank" rel="noopener" class="watch-link-btn">' + l.label + '</a>';
    }).join('');

    overlay.innerHTML = `
      <div class="watch-modal">
        <div class="watch-modal-header">
          <span>Regarder en direct</span>
          <button onclick="document.getElementById('watch-overlay').remove()" class="watch-close">X</button>
        </div>
        <div class="watch-match-title">${home} vs ${away}</div>
        <div class="watch-disclaimer">
          Le streaming video necessite des droits de diffusion. Ces liens vous redirigent
          vers les plateformes legales susceptibles de diffuser ce match.
        </div>
        <div class="watch-links">${linksHtml}</div>
      </div>
    `;
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // -----------------------------------------------------------------
  // AJOUTER AU JOURNAL (bouton manuel)
  // -----------------------------------------------------------------
  function addToJournal(rank) {
    if (!_lastScanData || !_lastScanData.opportunities) return;
    const opp   = _lastScanData.opportunities[rank];
    if (!opp) return;
    const kelly = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);

    const tab = document.querySelector('[data-tab="journal"]');
    if (tab) tab.click();

    setTimeout(function() {
      const addBtn = document.getElementById('btn-add-bet');
      if (addBtn) addBtn.click();

      setTimeout(function() {
        const setVal = function(id, v) { const el = document.getElementById(id); if(el) el.value = v; };
        setVal('j-date',      new Date().toISOString().split('T')[0]);
        setVal('j-sport',     SPORT_MAP[opp.sport] || 'tennis');
        setVal('j-match',     opp.homeTeam + ' vs ' + opp.awayTeam);
        setVal('j-type',      opp.isLive ? 'live' : 'prematch');
        setVal('j-market',    'Vainqueur match');
        setVal('j-selection', opp.selection);
        setVal('j-cote',      opp.bestPrice);
        setVal('j-stake',     kelly ? kelly.stake : '');
        setVal('j-edge',      opp.edge);
        setVal('j-reason',    'Scanner IA -- Edge ' + opp.edge + '% -- Prob ' + opp.trueProb + '% -- ' + opp.bestBook);
      }, 200);
    }, 300);
  }

  // -----------------------------------------------------------------
  // AUTO-REFRESH
  // -----------------------------------------------------------------
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(function() { runScan(true); }, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  }

  // -----------------------------------------------------------------
  // INIT
  // -----------------------------------------------------------------
  function init() {
    const btn = document.getElementById('btn-scan');
    if (btn) btn.addEventListener('click', function() { runScan(false); });

    ['scan-filter-sport', 'scan-filter-edge'].forEach(function(id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', function() {
        applyFilters();
        if (id === 'scan-filter-sport' && el.value !== 'all') {
          syncSportToOtherTabs(el.value);
        }
      });
    });

    const liveChk = document.getElementById('scan-filter-live');
    if (liveChk) liveChk.addEventListener('change', applyFilters);

    const notifBtn = document.getElementById('btn-notif-toggle');
    if (notifBtn) {
      notifBtn.addEventListener('click', async function() {
        if (!_notifyEnabled) {
          const granted = await requestNotificationPermission();
          if (granted) {
            _notifyEnabled = true;
            showToast('Notifications activees');
          } else {
            showToast('Permission notifications refusee dans le navigateur');
          }
        } else {
          _notifyEnabled = false;
          showToast('Notifications desactivees');
        }
        updateNotifButton();
      });
    }

    const autoLogChk = document.getElementById('scan-auto-log');
    if (autoLogChk) {
      autoLogChk.addEventListener('change', function() {
        _autoLogEnabled = autoLogChk.checked;
        showToast(_autoLogEnabled
          ? 'Auto-log active -- nouvelles opportunites ajoutees au journal'
          : 'Auto-log desactive');
      });
    }

    updateNotifButton();
    startAutoRefresh();

    const scanTab = document.querySelector('[data-tab="scanner"]');
    if (scanTab) {
      scanTab.addEventListener('click', function() {
        if (!_lastScanData) runScan(false);
      });
    }
  }

  return { init, runScan, addToJournal, applyFilters, focusSport, watchMatch };
})();
