/**
 * OddsOracle -- Main Application Controller
 * Navigation, Dashboard, Bankroll UI, Settings, Init global
 */

// -----------------------------------------------------------------
// DASHBOARD MODULE
// -----------------------------------------------------------------
const DashboardModule = (() => {

  let bankrollChart = null;
  let allocationChart = null;

  function refresh() {
    const bets    = JournalModule.getAllBets();
    const state   = BankrollManager.getState();
    const alloc   = BankrollManager.getAllocation();
    const stats   = JournalModule.calcStats(bets);
    const wins    = stats.wins;
    const losses  = stats.losses;
    const total   = wins + losses;
    const winrate = total > 0 ? (wins / total * 100).toFixed(0) : 0;

    // ROI
    const roi = stats.roi;
    const roiEl = document.getElementById('dash-roi');
    roiEl.textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
    roiEl.style.color = roi >= 0 ? 'var(--green)' : 'var(--red)';

    // Bankroll
    const brEl = document.getElementById('dash-bankroll');
    brEl.textContent = (state.current || 0).toFixed(0) + ' €';
    const diff = (state.current || 0) - (state.initial || 0);
    const subEl = document.getElementById('dash-bankroll-sub');
    if (state.initial > 0) {
      subEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(0) + ' € vs. initial';
      subEl.style.color = diff >= 0 ? 'var(--green)' : 'var(--red)';
    }

    document.getElementById('dash-paris-count').textContent = bets.length + ' paris';
    document.getElementById('dash-winrate').textContent = winrate + '%';
    document.getElementById('dash-win-loss').textContent = `${wins}W / ${losses}L`;

    // Sidebar stats
    document.getElementById('mini-roi').textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%';
    document.getElementById('mini-roi').style.color = roi >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('mini-bankroll').textContent = (state.current || 0).toFixed(0) + ' €';

    // Streak
    const resolved = bets.filter(b => b.result === 'win' || b.result === 'loss');
    let streak = 0, streakType = null;
    for (const b of resolved) {
      if (streakType === null) { streakType = b.result; streak = 1; }
      else if (b.result === streakType) streak++;
      else break;
    }
    const streakEl = document.getElementById('dash-streak');
    if (streak > 0 && streakType) {
      streakEl.textContent = `${streak}x ${streakType === 'win' ? '✅' : '❌'}`;
      streakEl.style.color = streakType === 'win' ? 'var(--green)' : 'var(--red)';
      document.getElementById('dash-streak-sub').textContent = streakType === 'win' ? 'Série de victoires' : 'Série de défaites';
    } else {
      streakEl.textContent = '--';
    }

    // Allocation
    document.getElementById('alloc-prematch').textContent = alloc.prematch.toFixed(0) + ' €';
    document.getElementById('alloc-live').textContent     = alloc.live.toFixed(0) + ' €';
    document.getElementById('alloc-stoploss').textContent = alloc.stopLossDaily.toFixed(0) + ' €';

    // Recent bets
    const recent = bets.slice(0, 5);
    const recentEl = document.getElementById('recent-bets-list');
    if (recent.length === 0) {
      recentEl.innerHTML = '<div class="empty-state">Aucun pari enregistré</div>';
    } else {
      recentEl.innerHTML = recent.map(b => {
        const pnl = JournalModule.calcStats([b]).pnl;
        const pnlClass = b.result === 'win' ? 'win' : b.result === 'loss' ? 'loss' : 'pending';
        const pnlTxt = b.result === 'win' ? `+${pnl.toFixed(0)} €` :
                       b.result === 'loss' ? `${pnl.toFixed(0)} €` : '⏳';
        return `
          <div class="bet-item">
            <div>
              <div class="bet-item-match">${b.match}</div>
              <div class="bet-item-detail">${b.date} · ${b.selection} @${parseFloat(b.cote).toFixed(2)}</div>
            </div>
            <div class="bet-item-pnl ${pnlClass}">${pnlTxt}</div>
          </div>
        `;
      }).join('');
    }

    // Rules check
    const warnings = BankrollManager.checkStopLoss();
    const alertBanner = document.getElementById('alert-banner');
    if (warnings.length > 0) {
      alertBanner.style.display = 'block';
      alertBanner.innerHTML = warnings.map(w => `⚠️ ${w.msg}`).join('<br/>');
    } else {
      alertBanner.style.display = 'none';
    }

    // Rules list
    const ruleStreak = document.getElementById('rule-streak');
    if (streak >= 3 && streakType === 'loss') {
      ruleStreak.textContent = '⚠️ 3 pertes consécutives -- réévaluer la méthode';
      ruleStreak.className = 'rule-item rule-warning';
    } else {
      ruleStreak.textContent = `ℹ️ Série en cours: ${streak > 0 && streakType ? streak + 'x ' + (streakType === 'win' ? 'victoires' : 'défaites') : 'Aucune'}`;
      ruleStreak.className = 'rule-item rule-info';
    }

    // Stop-loss visual
    const slWarnings = warnings.filter(w => w.type === 'STOP_LOSS_DAILY' || w.type === 'STOP_LOSS_WEEKLY');
    document.getElementById('rule-streak').parentElement.querySelectorAll('.rule-ok').forEach((el, i) => {
      if (i === 0 && warnings.find(w => w.type === 'STOP_LOSS_DAILY')) {
        el.textContent = '❌ Stop-loss journalier ATTEINT';
        el.className = 'rule-item rule-danger';
      } else if (i === 1 && state.liveStreakLosses >= 2) {
        el.textContent = `⚠️ ${state.liveStreakLosses}/3 pertes live consécutives`;
        el.className = 'rule-item rule-warning';
      }
    });

    updateCharts(bets, alloc);
  }

  function updateCharts(bets, alloc) {
    // Bankroll evolution chart
    const canvasBR = document.getElementById('chart-bankroll');
    if (!canvasBR) return;

    const resolved = bets.filter(b => b.result === 'win' || b.result === 'loss').reverse();
    const labels = [];
    const dataPoints = [];
    let running = BankrollManager.getState().initial || 0;

    labels.push('Départ');
    dataPoints.push(running);

    resolved.forEach((b, i) => {
      const pnl = JournalModule.calcStats([b]).pnl;
      running += pnl;
      labels.push(b.date || `#${i+1}`);
      dataPoints.push(parseFloat(running.toFixed(0)));
    });

    const gradient = canvasBR.getContext('2d').createLinearGradient(0, 0, 0, 200);
    const isPositive = dataPoints[dataPoints.length - 1] >= dataPoints[0];
    gradient.addColorStop(0, isPositive ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    if (bankrollChart) bankrollChart.destroy();
    bankrollChart = new Chart(canvasBR, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: dataPoints,
          borderColor: isPositive ? '#22c55e' : '#ef4444',
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: dataPoints.length > 15 ? 0 : 3,
          pointBackgroundColor: isPositive ? '#22c55e' : '#ef4444',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.raw} €` }
        }},
        scales: {
          x: { ticks: { color: '#505878', font: { size: 10 } }, grid: { color: '#2a2f45' } },
          y: { ticks: { color: '#505878', font: { size: 10 }, callback: v => v + ' €' }, grid: { color: '#2a2f45' } }
        }
      }
    });

    // Allocation donut
    const canvasAlloc = document.getElementById('chart-allocation');
    if (!canvasAlloc) return;
    if (allocationChart) allocationChart.destroy();

    allocationChart = new Chart(canvasAlloc, {
      type: 'doughnut',
      data: {
        labels: ['Pré-match', 'Live'],
        datasets: [{
          data: [alloc.prematch || 70, alloc.live || 30],
          backgroundColor: ['#6c63ff', '#06b6d4'],
          borderColor: '#1a1d27',
          borderWidth: 3,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8890a8', font: { size: 10 } } }
        }
      }
    });
  }

  return { refresh };
})();

// -----------------------------------------------------------------
// BANKROLL UI MODULE
// -----------------------------------------------------------------
const BankrollUI = (() => {
  function refresh() {
    const alloc = BankrollManager.getAllocation();
    const state = BankrollManager.getState();
    const cfg   = BankrollManager.getConfig();

    // Form values
    document.getElementById('br-initial').value = state.initial || '';
    document.getElementById('br-current').value = state.current || '';

    // Breakdown
    document.getElementById('br-prematch-budget').textContent = alloc.prematch.toFixed(0) + ' €';
    document.getElementById('br-live-budget').textContent     = alloc.live.toFixed(0) + ' €';
    document.getElementById('br-stoploss').textContent        = alloc.stopLossDaily.toFixed(0) + ' €';
    document.getElementById('br-stoploss-week').textContent   = alloc.stopLossWeekly.toFixed(0) + ' €';
    document.getElementById('br-protect-gains').textContent   = alloc.protectGains.toFixed(0) + ' €';

    // Stop-loss bars
    const slDaily = state.todayLosses / alloc.stopLossDaily;
    const slWeek  = state.weekLosses  / alloc.stopLossWeekly;

    const barDaily = document.getElementById('sl-bar-daily');
    const barWeek  = document.getElementById('sl-bar-week');
    if (barDaily) {
      barDaily.style.width = Math.min(100, (slDaily * 100)) + '%';
      barDaily.className = 'sl-bar ' + (slDaily > 0.8 ? 'danger' : slDaily > 0.5 ? 'warn' : '');
    }
    if (barWeek) {
      barWeek.style.width = Math.min(100, (slWeek * 100)) + '%';
      barWeek.className = 'sl-bar sl-bar-week ' + (slWeek > 0.8 ? 'danger' : slWeek > 0.5 ? 'warn' : '');
    }

    document.getElementById('sl-daily-val').textContent = state.todayLosses.toFixed(0) + ' €';
    document.getElementById('sl-week-val').textContent  = state.weekLosses.toFixed(0) + ' €';

    // Live streak dots
    const dots = document.querySelectorAll('.loss-dot');
    dots.forEach((d, i) => {
      d.classList.toggle('active',   i < state.liveStreakLosses);
      d.classList.toggle('inactive', i >= state.liveStreakLosses);
    });
    document.getElementById('sl-live-streak').textContent = `${state.liveStreakLosses}/3`;
  }

  function init() {
    // Sauvegarder bankroll
    document.getElementById('btn-br-save').addEventListener('click', () => {
      const initial = parseFloat(document.getElementById('br-initial').value);
      const current = parseFloat(document.getElementById('br-current').value) || initial;
      if (!initial || isNaN(initial)) { alert('Bankroll initiale invalide'); return; }
      BankrollManager.setBankroll(initial, current);
      refresh();
      DashboardModule.refresh();
    });

    // Reset journalier / hebdo
    document.getElementById('btn-reset-daily').addEventListener('click', () => {
      if (confirm('Réinitialiser les pertes journalières ?')) {
        BankrollManager.resetDaily();
        refresh();
      }
    });

    document.getElementById('btn-reset-weekly').addEventListener('click', () => {
      if (confirm('Réinitialiser les pertes hebdomadaires ?')) {
        BankrollManager.resetWeekly();
        refresh();
      }
    });

    // Kelly calculator
    document.getElementById('btn-kelly-calc').addEventListener('click', () => {
      const prob   = parseFloat(document.getElementById('kelly-prob').value);
      const cote   = parseFloat(document.getElementById('kelly-cote').value);
      const br     = parseFloat(document.getElementById('kelly-bankroll').value);
      const mode   = document.getElementById('kelly-mode').value;

      if (!prob || !cote || !br || cote <= 1) {
        document.getElementById('kelly-result').innerHTML = '<div style="color:var(--red)">⚠️ Paramètres invalides</div>';
        return;
      }

      const k = OddsModels.kellyStake(prob / 100, cote, br, mode);
      const edgePct = (k.edge * 100).toFixed(1);
      const cfg = BankrollManager.getConfig();
      const minEdge = mode === 'live' ? cfg.edgeMinLive : cfg.edgeMinPrematch;
      const isValue = k.edge * 100 >= minEdge;
      const liveReduction = mode === 'live' ? ` <span style="color:var(--yellow)">(−40% live → ${(k.stake * 0.6).toFixed(0)} €)</span>` : '';

      document.getElementById('kelly-result').innerHTML = k.stake <= 0 ? `
        <div style="color:var(--red);font-weight:700">❌ Pas de value · Edge négatif (${edgePct}%)</div>
      ` : `
        <div class="kelly-value">${k.stake.toFixed(0)} €${liveReduction}</div>
        <div class="kelly-detail">
          Kelly brut: ${(k.kelly * 100).toFixed(2)}% · Fraction 1/${mode === 'live' ? 6 : 4}<br/>
          Edge: <span style="color:${isValue ? 'var(--green)' : 'var(--yellow)'}">${edgePct}%</span>
          ${isValue ? '✅ Value bet' : `⚠️ Sous le seuil (${minEdge}%)`}<br/>
          Gain potentiel: +${(k.stake * (cote - 1)).toFixed(0)} €<br/>
          Retour total: ${(k.stake * cote).toFixed(0)} €
        </div>
      `;
    });

    // Edge calculator
    document.getElementById('btn-edge-calc').addEventListener('click', () => {
      const cote1 = parseFloat(document.getElementById('edge-cote1').value);
      const cote2 = parseFloat(document.getElementById('edge-cote2').value);
      const prob  = parseFloat(document.getElementById('edge-prob').value);

      if (!cote1 || !cote2 || !prob) {
        document.getElementById('edge-result').innerHTML = '<div style="color:var(--red)">⚠️ Paramètres invalides</div>';
        return;
      }

      const r = OddsModels.calcEdge(prob, cote1, cote2);
      const edgePct = r.edgePct.toFixed(1);
      const color = r.isStrongBet ? 'var(--green)' : r.isValueBet ? 'var(--cyan)' : r.edge >= 0 ? 'var(--yellow)' : 'var(--red)';

      document.getElementById('edge-result').innerHTML = `
        <div style="font-size:1.5rem;font-weight:900;color:${color}">${edgePct >= 0 ? '+' : ''}${edgePct}%</div>
        <div class="kelly-detail">
          P. implicite brute: ${(r.pImplicit*100).toFixed(1)}%<br/>
          P. corrigée (marge retirée): ${(r.pCorrected*100).toFixed(1)}%<br/>
          Marge bookmaker: ${r.margin.toFixed(1)}%<br/>
          ${r.isStrongBet ? '\U0001f525 STRONG VALUE BET (&gt;10%)' :
            r.isValueBet  ? '✅ Value bet (&gt;5%)' :
            r.edge >= 0   ? '⚠️ Edge positif mais insuffisant' : '❌ Pas de value'}
        </div>
      `;
    });

    refresh();
  }

  return { init, refresh };
})();

// -----------------------------------------------------------------
// SETTINGS MODULE
// -----------------------------------------------------------------
const SettingsModule = (() => {
  function init() {
    const cfg = BankrollManager.getConfig();
    document.getElementById('set-edge-prematch').value = cfg.edgeMinPrematch;
    document.getElementById('set-edge-live').value     = cfg.edgeMinLive;
    document.getElementById('set-sl-daily').value      = cfg.slDailyPct;
    document.getElementById('set-sl-weekly').value     = cfg.slWeeklyPct;
    document.getElementById('set-protect').value       = cfg.protectGainsPct;

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      BankrollManager.setConfig({
        edgeMinPrematch: parseFloat(document.getElementById('set-edge-prematch').value) || 5,
        edgeMinLive:     parseFloat(document.getElementById('set-edge-live').value) || 8,
        slDailyPct:      parseFloat(document.getElementById('set-sl-daily').value) || 15,
        slWeeklyPct:     parseFloat(document.getElementById('set-sl-weekly').value) || 25,
        protectGainsPct: parseFloat(document.getElementById('set-protect').value) || 20,
      });
      showToast('✅ Paramètres sauvegardés');
    });

    document.getElementById('btn-reset-all').addEventListener('click', () => {
      if (confirm('⚠️ Toutes les données seront supprimées. Confirmer ?')) {
        localStorage.clear();
        location.reload();
      }
    });
  }
  return { init };
})();

// -----------------------------------------------------------------
// LIVE MATCH SELECTOR (donnees reelles The Odds API)
// -----------------------------------------------------------------
const LiveMatchSelector = (() => {
  let eventsCache = [];
  let oddsCache   = {};
  let sseActive   = false;

  async function updateApiStatus() {
    const dot  = document.getElementById('api-dot');
    const text = document.getElementById('api-status-text');
    const quotaEl = document.getElementById('quota-display');

    try {
      const status = await APIClient.checkApiStatus();
      if (status.online) {
        dot.className = 'api-dot online';
        const quota = status.apiUsage;
        if (quota && quota.requestsRemaining != null) {
          text.textContent = `API connectée`;
          const rem = quota.requestsRemaining;
          quotaEl.textContent = `· ${rem} req restantes`;
          quotaEl.className = rem < 50 ? 'quota-badge danger' : rem < 150 ? 'quota-badge warn' : 'quota-badge';
        } else {
          text.textContent = 'Serveur actif';
          quotaEl.textContent = quota.requestsRemaining === null ? '· Clé API non configurée' : '';
        }
      } else {
        dot.className = 'api-dot offline';
        text.textContent = 'Hors ligne';
      }
    } catch(e) {
      dot.className = 'api-dot offline';
      text.textContent = 'Serveur injoignable';
    }
  }

  async function loadMatches() {
    const sport    = document.getElementById('live-sport-select').value;
    const selectEl = document.getElementById('live-match-select');
    const quotaBadge = document.getElementById('quota-badge');

    selectEl.innerHTML = '<option>⏳ Chargement...</option>';

    try {
      const events = await APIClient.getEvents(sport);
      eventsCache  = events;

      if (!events || events.length === 0) {
        selectEl.innerHTML = '<option value="">-- Aucun match disponible pour ce sport --</option>';
        quotaBadge.textContent = 'Aucun match dans les 48h';
        return;
      }

      selectEl.innerHTML = '<option value="">-- Sélectionner un match --</option>';
      events.forEach(ev => {
        const opt = APIClient.formatMatchOption(ev);
        const option = document.createElement('option');
        option.value = ev.id;
        option.textContent = opt.label;
        if (opt.isLive) option.style.fontWeight = '700';
        selectEl.appendChild(option);
      });

      quotaBadge.textContent = `${events.length} match(s) chargé(s)`;

      // Charger les cotes en arriere-plan
      loadOddsForSport(sport);

    } catch(e) {
      selectEl.innerHTML = `<option value="">-- Erreur: ${e.message} --</option>`;
      quotaBadge.textContent = '⚠️ Clé API manquante? Voir .env';
      quotaBadge.className = 'quota-badge danger';
    }
  }

  async function loadOddsForSport(sport) {
    try {
      const odds = await APIClient.getOdds(sport);
      odds.forEach(ev => { oddsCache[ev.id] = ev; });
      updateQuotaDisplay();
    } catch(e) {
      console.warn('[odds]', e.message);
    }
  }

  function updateQuotaDisplay() {
    const quota = APIClient.getLastQuota();
    if (!quota) return;
    const quotaEl = document.getElementById('quota-display');
    if (quota.requestsRemaining != null) {
      quotaEl.textContent = `· ${quota.requestsRemaining} req restantes`;
      const badge = document.getElementById('quota-badge');
      if (badge) badge.textContent = `Quota API: ${quota.requestsUsed} utilisées / ${quota.requestsRemaining} restantes`;
    }
  }

  async function loadSelectedMatch() {
    const matchId  = document.getElementById('live-match-select').value;
    const sport    = document.getElementById('live-sport-select').value;
    if (!matchId) return;

    const event = eventsCache.find(e => e.id === matchId);
    if (!event) return;

    // Remplir les champs joueurs
    const home = event.home_team || event.homeTeam || '';
    const away = event.away_team || event.awayTeam || '';
    document.getElementById('live-playerA').value = home;
    document.getElementById('live-playerB').value = away;

    // Mettre a jour l'affichage
    document.getElementById('live-pA-name').textContent = home;
    document.getElementById('live-pB-name').textContent = away;

    // Adapter les champs au sport selectionne (fix coherence tennis/basket/etc.)
    if (typeof LiveModule !== 'undefined' && LiveModule.updateSportContext) {
      LiveModule.updateSportContext(sport);
    }

    // Remplir les cotes si disponibles
    const oddsData = oddsCache[matchId];
    if (oddsData) {
      const { homeOdds, awayOdds } = APIClient.extractOdds(oddsData);
      if (homeOdds) document.getElementById('live-coteA').value = homeOdds.toFixed(2);
      if (awayOdds) document.getElementById('live-coteB').value = awayOdds.toFixed(2);

      showToast(`✅ Match chargé: ${home} @${homeOdds?.toFixed(2) || '?'} · ${away} @${awayOdds?.toFixed(2) || '?'}`);
    } else {
      // Essayer de charger les cotes specifiques
      try {
        const odds = await APIClient.getOdds(sport, matchId);
        if (odds && odds[0]) {
          oddsCache[matchId] = odds[0];
          const { homeOdds, awayOdds } = APIClient.extractOdds(odds[0]);
          if (homeOdds) document.getElementById('live-coteA').value = homeOdds.toFixed(2);
          if (awayOdds) document.getElementById('live-coteB').value = awayOdds.toFixed(2);
        }
        showToast(`✅ Match chargé: ${home} vs ${away}`);
      } catch(e) {
        showToast(`⚠️ Match chargé (cotes indisponibles)`);
      }
    }

    // Connecter le flux SSE live pour ce sport
    if (!sseActive) {
      APIClient.connectLiveStream(sport, (data) => {
        handleLiveScores(data, matchId);
      });
      sseActive = true;
    }
  }

  function handleLiveScores(data, currentMatchId) {
    if (!data.liveMatches) return;
    const match = data.liveMatches.find(m => m.id === currentMatchId);
    if (!match) return;

    // Mettre a jour les scores si disponibles
    const scores = match.scores;
    if (scores && scores.length >= 2) {
      const scoreA = scores.find(s => s.name === document.getElementById('live-playerA').value);
      const scoreB = scores.find(s => s.name === document.getElementById('live-playerB').value);
      if (scoreA && scoreB) {
        document.getElementById('live-score-display').textContent =
          `${scoreA.score} -- ${scoreB.score}`;
      }
    }
  }

  function init() {
    updateApiStatus();
    setInterval(updateApiStatus, 60000);

    document.getElementById('btn-refresh-matches').addEventListener('click', loadMatches);
    document.getElementById('btn-load-match').addEventListener('click', loadSelectedMatch);

    // Quand on change de sport => vider la liste
    document.getElementById('live-sport-select').addEventListener('change', () => {
      document.getElementById('live-match-select').innerHTML =
        '<option value="">-- Cliquer sur Actualiser --</option>';
    });

    // Deconnecter SSE quand on quitte l'onglet live
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.tab !== 'live' && sseActive) {
          APIClient.disconnectLiveStream();
          sseActive = false;
        }
      });
    });
  }

  return { init };
})();

// -----------------------------------------------------------------
// PREMATCH SELECTOR (donnees reelles The Odds API)
// -----------------------------------------------------------------
const PrematchSelector = (() => {

  let eventsCache = [];
  let oddsCache   = {};

  // Estime l'Elo depuis la probabilite implicite corrigee du margin
  // P(A) = 1 / (1 + 10^((eloB - eloA)/400))  =>  eloB - eloA = -400 * log10(1/pA - 1)
  function estimateElo(probA) {
    const BASE_ELO = 2000;
    if (probA <= 0 || probA >= 1) return { eloA: BASE_ELO, eloB: BASE_ELO };
    const diff = -400 * Math.log10(1 / probA - 1);
    return {
      eloA: Math.round(BASE_ELO + diff / 2),
      eloB: Math.round(BASE_ELO - diff / 2),
    };
  }

  async function loadMatches() {
    const sport    = document.getElementById('pm-api-sport').value;
    const selectEl = document.getElementById('pm-api-match');
    const badge    = document.getElementById('pm-api-badge');

    selectEl.innerHTML = '<option>Chargement...</option>';
    if (badge) badge.textContent = '';

    try {
      const events = await APIClient.getEvents(sport);
      eventsCache  = events || [];

      if (!eventsCache.length) {
        selectEl.innerHTML = '<option value="">-- Aucun match disponible --</option>';
        if (badge) badge.textContent = 'Aucun match dans les 48h';
        return;
      }

      selectEl.innerHTML = '<option value="">-- Selectionner un match --</option>';
      eventsCache.forEach(ev => {
        const opt    = APIClient.formatMatchOption(ev);
        const option = document.createElement('option');
        option.value = ev.id;
        option.textContent = opt.label;
        if (opt.isLive) option.style.fontWeight = '700';
        selectEl.appendChild(option);
      });

      if (badge) badge.textContent = eventsCache.length + ' match(s) disponible(s)';

      // Charger les cotes en arriere-plan
      APIClient.getOdds(sport).then(odds => {
        (odds || []).forEach(ev => { oddsCache[ev.id] = ev; });
      }).catch(() => {});

    } catch(e) {
      selectEl.innerHTML = '<option value="">-- Erreur: ' + e.message + ' --</option>';
      if (badge) { badge.textContent = 'Cle API manquante?'; badge.className = 'quota-badge danger'; }
    }
  }

  async function loadSelectedMatch() {
    const matchId = document.getElementById('pm-api-match').value;
    const sport   = document.getElementById('pm-api-sport').value;
    const badge   = document.getElementById('pm-api-badge');
    if (!matchId) return;

    const event = eventsCache.find(function(e) { return e.id === matchId; });
    if (!event) return;

    const home = event.home_team || event.homeTeam || '';
    const away = event.away_team || event.awayTeam || '';

    // Remplir les noms
    const setVal = function(id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('pm-playerA', home);
    setVal('pm-playerB', away);

    // Detecter le sport
    const sportMap = { tennis_atp: 'tennis', tennis_wta: 'tennis', soccer_france_ligue1: 'football', soccer_epl: 'football', soccer_europe_champs: 'football', basketball_nba: 'basketball', basketball_euroleague: 'basketball' };
    const sportEl = document.getElementById('pm-sport');
    if (sportEl && sportMap[sport]) sportEl.value = sportMap[sport];

    // Mettre a jour le select format selon le sport
    const formatEl = document.getElementById('pm-format');
    if (formatEl) {
      if (sport.includes('tennis'))         formatEl.value = 'bo3';
      else if (sport.includes('soccer'))    formatEl.value = '90';
      else if (sport.includes('basketball')) formatEl.value = '4q';
    }

    // Recuperer les cotes
    let oddsData = oddsCache[matchId];
    if (!oddsData) {
      try {
        const res = await APIClient.getOdds(sport, matchId);
        oddsData = res && res[0] ? res[0] : null;
        if (oddsData) oddsCache[matchId] = oddsData;
      } catch(e) {}
    }

    if (oddsData) {
      const extracted = APIClient.extractOdds(oddsData);
      const homeOdds  = extracted.homeOdds;
      const awayOdds  = extracted.awayOdds;

      if (homeOdds) setVal('pm-coteA', homeOdds.toFixed(2));
      if (awayOdds) setVal('pm-coteB', awayOdds.toFixed(2));

      // Estimer les Elo depuis la ligne de marche
      if (homeOdds && awayOdds) {
        const overround = 1/homeOdds + 1/awayOdds;
        const probA     = (1/homeOdds) / overround;
        const elos      = estimateElo(probA);
        setVal('pm-eloA', elos.eloA);
        setVal('pm-eloB', elos.eloB);
      }

      // Marquer les champs comme auto-remplis
      ['pm-playerA','pm-playerB','pm-coteA','pm-coteB','pm-eloA','pm-eloB'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
          el.style.borderColor = 'var(--green)';
          el.style.boxShadow   = '0 0 0 2px var(--green-dim)';
          setTimeout(function() { el.style.borderColor = ''; el.style.boxShadow = ''; }, 3000);
        }
      });

      if (badge) badge.textContent = 'Charge: ' + home + ' @' + (homeOdds ? homeOdds.toFixed(2) : '?') + ' / ' + away + ' @' + (awayOdds ? awayOdds.toFixed(2) : '?');
    } else {
      if (badge) badge.textContent = 'Noms charges (cotes indisponibles)';
    }
  }

  function init() {
    const refreshBtn = document.getElementById('pm-api-refresh');
    const loadBtn    = document.getElementById('pm-api-load');
    const sportSel   = document.getElementById('pm-api-sport');

    if (refreshBtn) refreshBtn.addEventListener('click', loadMatches);
    if (loadBtn)    loadBtn.addEventListener('click', loadSelectedMatch);
    if (sportSel)   sportSel.addEventListener('change', function() {
      const sel = document.getElementById('pm-api-match');
      if (sel) sel.innerHTML = '<option value="">-- Cliquer sur Actualiser --</option>';
    });
  }

  return { init };
})();

// -----------------------------------------------------------------
// NAVIGATION
// -----------------------------------------------------------------
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabs     = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.dataset.tab;

      navItems.forEach(n => n.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');

      if (target === 'dashboard') DashboardModule.refresh();
      if (target === 'bankroll')  BankrollUI.refresh();
      if (target === 'journal')   JournalModule.renderTable();
    });
  });
}

// -----------------------------------------------------------------
// LIVE ALERT STYLES (inline CSS for dynamic elements)
// -----------------------------------------------------------------
function injectLiveStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .live-alert-box {
      border-radius: 8px;
      border: 1px solid;
      padding: 1rem;
      font-size: 0.82rem;
      line-height: 1.7;
    }
    .alert-box-strong  { border-color: var(--green);  background: rgba(34,197,94,0.05); }
    .alert-box-value   { border-color: var(--cyan);   background: rgba(6,182,212,0.05); }
    .alert-box-neutral { border-color: var(--border0); background: var(--bg2); }

    .alert-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.7rem;
      color: var(--text1);
      margin-bottom: 0.35rem;
    }

    .alert-sport { font-weight: 700; color: var(--red); font-size: 0.75rem; }
    .alert-time  { color: var(--text1); }
    .alert-match { font-size: 1rem; font-weight: 700; color: var(--text0); }
    .alert-score { font-size: 0.8rem; color: var(--text1); margin-bottom: 0.5rem; }
    .alert-sep   { color: var(--text1); font-size: 0.7rem; display: block; margin: 0.5rem 0; }

    .alert-section { margin: 0.75rem 0; }
    .alert-section-title {
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text1);
      margin-bottom: 0.4rem;
    }

    .signal-item { color: var(--text1); padding: 0.15rem 0; }
    .signal-item.muted { color: var(--text1); }

    .prob-live-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin: 0.3rem 0;
      font-size: 0.8rem;
    }
    .prob-live-row > span:first-child { min-width: 90px; color: var(--text1); }
    .prob-live-bar {
      flex: 1;
      height: 6px;
      background: var(--border0);
      border-radius: 3px;
      overflow: hidden;
    }
    .prob-live-bar > div { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .edge-small { font-size: 0.72rem; min-width: 80px; }

    .factors-mini {
      font-size: 0.7rem;
      color: var(--text1);
      margin-top: 0.25rem;
    }

    .live-action-block {
      margin-top: 0.75rem;
      border-radius: 6px;
      padding: 0.75rem;
      border: 1px solid;
    }
    .action-strong { background: rgba(34,197,94,0.1); border-color: var(--green); }
    .action-value  { background: rgba(6,182,212,0.1);  border-color: var(--cyan);  }

    .act-label {
      font-weight: 700;
      font-size: 0.82rem;
      color: var(--text0);
      margin-bottom: 0.4rem;
    }
    .act-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text1);
      padding: 0.15rem 0;
    }
    .act-row strong { color: var(--text0); }
    .act-invalid {
      font-size: 0.72rem;
      color: var(--yellow);
      margin-top: 0.4rem;
    }
    .act-no-value {
      margin-top: 0.75rem;
      padding: 0.5rem;
      background: var(--bg2);
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--text1);
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

// -----------------------------------------------------------------
// TOAST
// -----------------------------------------------------------------
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:2rem;right:2rem;
    background:var(--bg-card);border:1px solid var(--green);
    color:var(--green);padding:0.65rem 1.25rem;
    border-radius:8px;font-size:0.85rem;font-weight:600;
    z-index:9999;animation:fadeInUp 0.3s ease;
    box-shadow:0 4px 16px rgba(0,0,0,0.4);
  `;
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeInUp{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:translateY(0)}}';
  document.head.appendChild(style);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// -----------------------------------------------------------------
// DATETIME
// -----------------------------------------------------------------
function updateDatetime() {
  const el = document.getElementById('current-datetime');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) + ' · ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}

// -----------------------------------------------------------------
// LIVE FEED MODULE -- auto-charge tous les matchs en cours
// -----------------------------------------------------------------

// -----------------------------------------------------------------------
// SHARED MATCH CARD RENDERER  (Betclic-style + live scores + Watch btn)
// -----------------------------------------------------------------------
function renderMatchCard(match, isLive) {
  var sels  = match.selections || [];
  var safeH = (match.homeTeam || '').replace(/["\'<>]/g, '');
  var safeA = (match.awayTeam || '').replace(/["\'<>]/g, '');
  var cotA  = sels[0] ? sels[0].bestPrice.toFixed(2) : '';
  var cotB  = sels[sels.length-1] ? sels[sels.length-1].bestPrice.toFixed(2) : '';

  // Statut réel du match (passé le commence_time = en cours)
  var started = match.isLive || (match.isImminent === false && !!isLive);
  var imminent = match.isImminent;

  // Best selection
  var bestSel = sels.reduce(function(b,s){ return (!b||(s.edge||0)>(b.edge||0))?s:b; }, null);

  // Time badge
  var dt  = new Date(match.commenceTime);
  var tod = dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  var timeBadge;
  if (started) {
    timeBadge = '<span class="mc-live-badge">&#9679; LIVE &middot; '+tod+'</span>';
  } else {
    var h = match.hoursLeft || 0;
    var tl = h < 1 ? '&lt; 1h' : 'Dans '+Math.ceil(h)+'h';
    timeBadge = '<span class="mc-time-badge'+(h<1?' mc-urgent':'')+'">'+tl+' &middot; '+tod+'</span>';
  }

  // Score live (si disponible via TheSportsDB)
  var scoreHtml = '';
  if (match.liveScore) {
    var sc = match.liveScore;
    var prog = sc.progress ? '<span class="mc-score-prog">'+sc.progress+'</span>' : '';
    scoreHtml = '<div class="mc-score">'
      +'<span class="mc-score-h">'+(sc.homeScore != null ? sc.homeScore : '—')+'</span>'
      +'<span class="mc-score-sep">:</span>'
      +'<span class="mc-score-a">'+(sc.awayScore != null ? sc.awayScore : '—')+'</span>'
      +prog+'</div>';
  }

  // Odds columns
  var oddsHtml = sels.map(function(s,i){
    var n    = sels.length;
    var lbl  = n===2 ? (i===0?'1':'2') : (i===0?'1': i===1?'X':'2');
    var best = bestSel && s===bestSel && (s.edge||0)>0;
    var ec   = (s.edge||0)>0 ? 'mc-ep' : 'mc-en';
    var et   = s.edge!=null ? ((s.edge>0?'+':'')+s.edge.toFixed(1)+'%') : '';
    var pw   = Math.min(100,Math.max(0,s.trueProb||0));
    return '<div class="mc-odd'+(best?' mc-best':'')+'">'
      +'<div class="mc-ol">'+lbl+'</div>'
      +'<div class="mc-op">'+(s.bestPrice?s.bestPrice.toFixed(2):'—')+'</div>'
      +'<div class="mc-ob">'+(s.bestBook||'')+'</div>'
      +'<div class="mc-bar-wrap"><div class="mc-bar" style="width:'+pw+'%"></div></div>'
      +'<div class="mc-oe '+ec+'">'+et+'</div>'
      +'</div>';
  }).join('');

  // Prediction badge
  var predHtml = bestSel && bestSel.predLabel
    ? '<span class="mc-pred feed-pred feed-pred-'+bestSel.predLabel.toLowerCase()+'">'+bestSel.predLabel+'</span>'
    : '';

  // Kelly
  var kellyHtml = '';
  if (bestSel && (bestSel.edge||0)>0 && bestSel.trueProb) {
    var p = bestSel.trueProb/100;
    var b = (bestSel.bestPrice||2)-1;
    var k = Math.max(0,(p*b-(1-p))/b);
    kellyHtml = '<span class="mc-kelly">Kelly '+(k/4*100).toFixed(1)+'%</span>';
  }

  // Bouton Watch → sportplus.live
  var watchHtml = started
    ? '<a class="mc-watch" href="https://fr4.sportplus.live/" target="_blank" rel="noopener" onclick="event.stopPropagation()">&#9654; Watch</a>'
    : '';

  // Footer
  var foot = bestSel ? '<div class="mc-footer">'
    +'<span class="mc-prob">Prob <strong>'+(bestSel.trueProb||0)+'%</strong></span>'
    +((bestSel.edge||0)>0?'<span class="mc-ep mc-ev">edge +'+bestSel.edge.toFixed(1)+'%</span>':'')
    +kellyHtml+watchHtml+'</div>' : watchHtml ? '<div class="mc-footer">'+watchHtml+'</div>' : '';

  // data-score pour auto-fill form
  var scoreData = match.liveScore
    ? ' data-score-h="'+(match.liveScore.homeScore||0)+'" data-score-a="'+(match.liveScore.awayScore||0)+'" data-score-prog="'+(match.liveScore.progress||'')+'"'
    : '';

  return '<div class="match-card feed-card-clickable"'
    +' data-home="'+safeH+'" data-away="'+safeA+'"'
    +' data-sport="'+(match.sportKey||'')+'"'
    +' data-cotea="'+cotA+'" data-coteb="'+cotB+'"'
    +scoreData+'>'
    +'<div class="mc-head">'
    +'<span class="mc-sport">'+(match.sportIcon||'⚡')+' '+(match.sportLabel||'')+'</span>'
    +timeBadge+predHtml
    +'</div>'
    +'<div class="mc-teams">'
    +'<span class="mc-team">'+safeH+'</span>'
    +(scoreHtml || '<span class="mc-vs">vs</span>')
    +'<span class="mc-team">'+safeA+'</span>'
    +'</div>'
    +'<div class="mc-odds">'+oddsHtml+'</div>'
    +foot
    +'</div>';
}

function attachCardClicks(container) {
  container.querySelectorAll('.feed-card-clickable').forEach(function(card) {
    card.addEventListener('click', function() {
      var home  = card.dataset.home  || '';
      var away  = card.dataset.away  || '';
      var sport = card.dataset.sport || '';
      var cotA  = card.dataset.cotea || '';
      var cotB  = card.dataset.coteb || '';
      var setV = function(id,v){ var e=document.getElementById(id); if(e) e.value=v; };
      var setT = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
      setV('live-playerA',home); setT('live-pA-name',home);
      setV('live-playerB',away); setT('live-pB-name',away);
      if(cotA) setV('live-coteA',cotA);
      if(cotB) setV('live-coteB',cotB);
      // Auto-remplir le score si disponible (TheSportsDB)
      var sh = card.dataset.scoreH;
      var sa = card.dataset.scoreA;
      if(sh!=null){ setV('live-score-a',sh); setV('live-jeux-a',sh); }
      if(sa!=null){ setV('live-score-b',sa); setV('live-jeux-b',sa); }
      if(sport){
        var sel=document.getElementById('live-sport-select');
        if(sel){ var o=Array.from(sel.options).find(function(x){ return sport.indexOf(x.value)!==-1||x.value.indexOf(sport.split('_')[0])!==-1; }); if(o) sel.value=o.value; }
        if(typeof LiveModule!=='undefined'&&LiveModule.updateSportContext) LiveModule.updateSportContext(sport);
      }
      // Ouvrir la section avancée si fermée
      var adv=document.getElementById('live-advanced');
      if(adv&&adv.style.display==='none'){
        adv.style.display='block';
        var tog=adv.previousElementSibling;
        if(tog&&tog.classList.contains('advanced-toggle')) tog.textContent='\u25be Analyse avanc\u00e9e (score live, signaux, fiche)';
      }
      var form=document.getElementById('live-match-header');
      if(form) form.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
}

const LiveFeedModule = (() => {

  let _refreshTimer = null;

  function render(data) {
    var el = document.getElementById('live-feed-container');
    if (!el) return;
    if (!data || !data.matches || !data.matches.length) {
      el.innerHTML = '<div class="feed-empty">'
        + '<div style="font-size:1.8rem;margin-bottom:.5rem">&#9679; LIVE</div>'
        + '<div>Aucun match en cours d&eacute;tect&eacute; sur les sports surveill&eacute;s.</div>'
        + '<div style="font-size:.72rem;margin-top:.4rem;color:var(--text2)">Les cotes apparaissent automatiquement quand des matchs commencent.</div>'
        + '<button onclick="LiveFeedModule.load()" class="btn btn-sm btn-secondary" style="margin-top:.75rem">&#8635; Rafra&icirc;chir</button>'
        + '</div>';
      return;
    }
    el.innerHTML = '<div class="feed-meta-bar">'
      + '<span>&#9679; '+data.count+' match'+(data.count>1?'s':'')+' en cours</span>'
      + '<span class="fmb-right">auto-refresh 2min</span>'
      + '</div>'
      + '<div class="match-list">' + data.matches.map(function(m){ return renderMatchCard(m, true); }).join('') + '</div>';
    attachCardClicks(el);
  }

  async function load() {
    const el = document.getElementById('live-feed-container');
    if (!el) return;
    el.innerHTML = '<div class="feed-loading">Chargement des matchs en cours...</div>';
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(function(){ ctrl.abort(); }, 15000);
      const resp = await fetch('/api/live/all', { signal: ctrl.signal });
      clearTimeout(tid);
      const json = await resp.json();
      render(json.data);
    } catch(e) {
      if (el) {
        const msg = e.name === 'AbortError' ? 'Délai dépassé — cliquez Actualiser' : e.message;
        el.innerHTML = '<div class="feed-empty">'
          + '<div>⚠ ' + msg + '</div>'
          + '<button onclick="LiveFeedModule.load()" class="btn btn-sm btn-secondary" style="margin-top:.75rem">&#8635; Actualiser</button>'
          + '</div>';
      }
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    _refreshTimer = setInterval(load, 120000);
  }

  function stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function init() {
    const tab = document.getElementById('tab-live');
    if (tab) {
      tab.addEventListener('click', function() {
        load();
        startAutoRefresh();
      });
    }
  }

  return { init, load, startAutoRefresh, stopAutoRefresh };
})();

// -----------------------------------------------------------------
// PREMATCH FEED MODULE -- auto-charge tous les matchs prochaines 24h
// -----------------------------------------------------------------
const PrematchFeedModule = (() => {

  let _refreshTimer = null;

  function render(data) {
    var el = document.getElementById('prematch-feed-container');
    if (!el) return;
    if (!data || !data.matches || !data.matches.length) {
      el.innerHTML = '<div class="feed-empty">'
        + '<div style="font-size:1.8rem;margin-bottom:.5rem">&#9671;</div>'
        + '<div>Aucun match programm&eacute; dans les 24 prochaines heures.</div>'
        + '<div style="font-size:.72rem;margin-top:.4rem;color:var(--text2)">Essayez d&#39;actualiser — les cotes apparaissent quand les bookmakers les proposent.</div>'
        + '<button onclick="PrematchFeedModule.load()" class="btn btn-sm btn-secondary" style="margin-top:.75rem">&#8635; Rafra&icirc;chir</button>'
        + '</div>';
      return;
    }
    el.innerHTML = '<div class="feed-meta-bar">'
      + '<span>&#9671; '+data.count+' match'+(data.count>1?'s':'')+' &agrave; venir (24h)</span>'
      + '<span class="fmb-right">auto-refresh 10min</span>'
      + '</div>'
      + '<div class="match-list">' + data.matches.map(function(m){ return renderMatchCard(m, false); }).join('') + '</div>';
    attachCardClicks(el);
  }

  async function load() {
    const el = document.getElementById('prematch-feed-container');
    if (!el) return;
    el.innerHTML = '<div class="feed-loading">Chargement des matchs a venir...</div>';
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(function(){ ctrl.abort(); }, 15000);
      const resp = await fetch('/api/upcoming', { signal: ctrl.signal });
      clearTimeout(tid);
      const json = await resp.json();
      render(json.data);
    } catch(e) {
      if (el) el.innerHTML = '<div class="feed-empty">Erreur: ' + e.message + '</div>';
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    _refreshTimer = setInterval(load, 600000);
  }

  function stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  function init() {
    const tab = document.getElementById('tab-prematch');
    if (tab) {
      tab.addEventListener('click', function() {
        load();
        startAutoRefresh();
      });
    }
  }

  return { init, load, startAutoRefresh, stopAutoRefresh };
})();

// -----------------------------------------------------------------
// INIT
// -----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  BankrollManager.load();
  injectLiveStyles();
  initNavigation();

  PrematchModule.init();
  LiveModule.init();
  BankrollUI.init();
  JournalModule.init();
  SettingsModule.init();
  LiveMatchSelector.init();
  PrematchSelector.init();
  ScannerModule.init();
  LiveFeedModule.init();
  PrematchFeedModule.init();

  LiveFeedModule.load();
  PrematchFeedModule.load();
});