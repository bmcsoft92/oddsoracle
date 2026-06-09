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
    var tl, urgCls = '';
    if (h < 0.5) { tl = '&lt; 30min'; urgCls = ' mc-urgent'; }
    else if (h < 2)  { tl = 'Dans '+Math.ceil(h*60)+'min'; urgCls = ' mc-urgent'; }
    else if (h < 6)  { tl = 'Dans '+Math.ceil(h)+'h'; }
    else if (h < 24) { tl = "Auj. " + tod; }
    else             { tl = 'Demain ' + tod; }
    timeBadge = '<span class="mc-time-badge'+urgCls+'">'+tl+'</span>';
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
    +kellyHtml+watchHtml+'<button class="mc-stats-btn" onclick="event.stopPropagation();openMatchStats(this)">&#x1F4CA; Stats</button></div>' : watchHtml ? '<div class="mc-footer">'+watchHtml+'<button class="mc-stats-btn" onclick="event.stopPropagation();openMatchStats(this)">&#x1F4CA; Stats</button></div>' : '<div class="mc-footer"><button class="mc-stats-btn" onclick="event.stopPropagation();openMatchStats(this)">&#x1F4CA; Stats</button></div>';

  // data-score pour auto-fill form
  var scoreData = match.liveScore
    ? ' data-score-h="'+(match.liveScore.homeScore||0)+'" data-score-a="'+(match.liveScore.awayScore||0)+'" data-score-prog="'+(match.liveScore.progress||'')+'"'
    : '';

  var cardEdge = bestSel ? (bestSel.edge||0) : 0;
  var cardProb = bestSel ? (bestSel.trueProb||0) : 0;
  var cardTeam = bestSel && bestSel.name ? bestSel.name : '';
  var isLiveCard = !!(match.isLive);

  return '<div class="match-card feed-card-clickable"'
    +' data-home="'+safeH+'" data-away="'+safeA+'"'
    +' data-sport="'+(match.sportKey||'')+'"'
    +' data-cotea="'+cotA+'" data-coteb="'+cotB+'"'
    +' data-match-id="'+(match.id||'')+'"'
    +' data-edge="'+cardEdge.toFixed(2)+'"'
    +' data-prob="'+cardProb+'"'
    +' data-is-live="'+(isLiveCard?'1':'0')+'"'
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
    +'<div class="card-analysis" data-loaded="0"></div>'
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
      }
      // Ouvrir la section avancée si fermée
      var adv=document.getElementById('live-advanced');
      if(adv&&adv.style.display==='none'){
        adv.style.display='block';
        var tog=adv.previousElementSibling;
        if(tog&&tog.classList.contains('advanced-toggle')) tog.textContent='\u25be Analyse avanc\u00e9e (score live, signaux, fiche)';
      }
      // Appliquer le contexte sport APRES ouverture (elements doivent etre visibles)
      if(sport&&typeof LiveModule!=='undefined'&&LiveModule.updateSportContext) LiveModule.updateSportContext(sport);
      // Démarrer auto-détection + charger forme joueurs
      if(typeof LiveModule!=='undefined'&&LiveModule.onMatchLoaded) LiveModule.onMatchLoaded(home,away,sport);
      // Ouvrir le modal stats grand jeu
      openMatchStats(card);
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
    var liveOnly   = data.matches.filter(function(m){ return m.isLive; });
    var upcoming   = data.matches.filter(function(m){ return !m.isLive; });
    var html = '';

    if (liveOnly.length) {
      html += '<div class="feed-section-header feed-section-live">'
            + '<span class="live-dot-anim">&#9679;</span> EN DIRECT (' + liveOnly.length + ')'
            + '</div>'
            + '<div class="match-list">' + liveOnly.map(function(m){ return renderMatchCard(m, true); }).join('') + '</div>';
    }
    if (upcoming.length) {
      html += '<div class="feed-section-header feed-section-upcoming">'
            + '&#9201; &Agrave; VENIR — prochaines heures (' + upcoming.length + ')'
            + '</div>'
            + '<div class="match-list">' + upcoming.map(function(m){ return renderMatchCard(m, false); }).join('') + '</div>';
    }
    if (!liveOnly.length && upcoming.length) {
      html = '<div class="feed-no-live">&#9679; Aucun match en direct — ' + upcoming.length + ' match' + (upcoming.length>1?'s':'') + ' &agrave; venir</div>' + html;
    }
    el.innerHTML = html;
    attachCardClicks(el);
    autoAnalyzeCards(el);
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
    _refreshTimer = setInterval(load, 60000);
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
    autoAnalyzeCards(el);
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

/* ===== STATS MODAL - Grand Jeu ===== */

function openMatchStats(btnOrCard) {
  var card = btnOrCard.closest ? btnOrCard.closest('.match-card') : btnOrCard;
  if (!card) return;
  var home    = card.dataset.home    || '';
  var away    = card.dataset.away    || '';
  var sport   = card.dataset.sport   || '';
  var matchId = card.dataset.matchId || card.dataset['match-id'] || '';
  var edge    = parseFloat(card.dataset.edge) || 0;
  var prob    = parseFloat(card.dataset.prob)  || 0;

  var overlay = document.getElementById('stats-modal-overlay');
  var modal   = document.getElementById('stats-modal');
  if (!modal || !overlay) return;

  var titleEl = document.getElementById('stats-modal-title');
  if (titleEl) titleEl.textContent = home + ' — ' + away;

  overlay.style.display = 'flex';

  // Reset to IA tab
  modal.querySelectorAll('.stats-tab').forEach(function(t){ t.classList.remove('active'); });
  var iaTab = modal.querySelector('.stats-tab[data-tab="ia"]');
  if (iaTab) iaTab.classList.add('active');

  var body = document.getElementById('stats-modal-body');
  if (body) body.innerHTML = '<div class="stats-loading"><div class="stats-spinner"></div>Analyse en cours…</div>';

  var url = '/api/match-stats?home=' + encodeURIComponent(home)
          + '&away=' + encodeURIComponent(away)
          + '&sport=' + encodeURIComponent(sport)
          + (matchId ? '&matchId=' + encodeURIComponent(matchId) : '');

  fetch(url)
    .then(function(r){
      if (!r.ok) throw new Error('Serveur: ' + r.status + ' — Endpoint non disponible (déploiement en attente ?)');
      return r.json();
    })
    .then(function(data){
      if (data && data.error) throw new Error(data.error);
      window._statsModalData = data;
      window._statsModalMeta = { home: home, away: away, sport: sport, edge: edge, prob: prob };
      renderStatsTab('ia', data, home, away, edge, prob);
    })
    .catch(function(err){
      var msg = err.message || 'Erreur inconnue';
      if (msg.indexOf('<!DOCTYPE') >= 0 || msg.indexOf('JSON') >= 0) {
        msg = 'Endpoint non disponible — redéployez le serveur';
      }
      if (body) body.innerHTML = '<div class="stats-error">&#x26A0; ' + escHtml(msg) + '<br><small style="opacity:.6">Vérifiez que le serveur Render est à jour</small></div>';
    });
}

var _cotesRefreshTimer = null;

function _startCotesRefresh() {
  _stopCotesRefresh();
  _cotesRefreshTimer = setInterval(function() {
    var meta = window._statsModalMeta || {};
    if (!meta.home) return;
    var url = '/api/match-stats?home=' + encodeURIComponent(meta.home)
            + '&away=' + encodeURIComponent(meta.away)
            + '&sport=' + encodeURIComponent(meta.sport || '');
    fetch(url).then(function(r){ return r.ok ? r.json() : null; }).then(function(data) {
      if (!data) return;
      window._statsModalData = data;
      var body = document.getElementById('stats-modal-body');
      var activeTab = document.querySelector('.stats-tab.active');
      if (body && activeTab && activeTab.dataset.tab === 'cotes') {
        body.innerHTML = renderTabCotes(data, meta.home, meta.away);
      }
    }).catch(function(){});
  }, 30000); // refresh toutes les 30s
}

function _stopCotesRefresh() {
  if (_cotesRefreshTimer) { clearInterval(_cotesRefreshTimer); _cotesRefreshTimer = null; }
}

function closeStatsModal() {
  _stopCotesRefresh();
  var overlay = document.getElementById('stats-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

function switchStatsTab(tabName) {
  var modal = document.getElementById('stats-modal');
  if (!modal) return;
  modal.querySelectorAll('.stats-tab').forEach(function(t){
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  var data = window._statsModalData;
  var meta = window._statsModalMeta || {};
  if (data) renderStatsTab(tabName, data, meta.home||'', meta.away||'', meta.edge||0, meta.prob||0);
  // Auto-refresh cotes quand l'onglet est actif
  if (tabName === 'cotes') { _startCotesRefresh(); }
  else { _stopCotesRefresh(); }
}

function renderStatsTab(tab, data, home, away, edge, prob) {
  var body = document.getElementById('stats-modal-body');
  if (!body) return;
  if (tab === 'ia')     body.innerHTML = renderTabIA(data, home, away, edge, prob);
  else if (tab === 'apercu') body.innerHTML = renderTabApercu(data, home, away);
  else if (tab === 'h2h')   body.innerHTML = renderTabH2H(data, home, away);
  else if (tab === 'forme') body.innerHTML = renderTabForme(data, home, away);
  else if (tab === 'cotes') body.innerHTML = renderTabCotes(data, home, away);
  else if (tab === 'live')  body.innerHTML = renderTabLive(data, home, away);
}

/* ---- IA ANALYSE TAB ---- */
function renderTabIA(data, home, away, edge, prob) {
  var fh = data.formHome || {};
  var fa = data.formAway || {};
  var h2h = data.h2h || {};
  var om  = data.oddsMovement || {};
  var mvH = om.homeTeam || {}; var mvA = om.awayTeam || {};

  // Determine recommended side
  var rec = null, recCls = '', recIcon = '';
  if (edge >= 2) {
    rec = 'Cuiabá'; // placeholder, actually computed from bestSel
    recCls = edge >= 5 ? 'ia-rec-hot' : 'ia-rec-good';
    recIcon = edge >= 5 ? '🔥' : '✅';
  }

  // Find best side from bestSel stored in meta
  var meta = window._statsModalMeta || {};
  var bestTeam = '';
  // Get from card data
  var cards = document.querySelectorAll('.feed-card-clickable');
  for (var i=0; i<cards.length; i++) {
    var c = cards[i];
    if (c.dataset.home === home && c.dataset.away === away) {
      var bestOdd = c.querySelector('.mc-odd.mc-best .mc-ol');
      if (bestOdd) {
        var side = bestOdd.textContent.trim();
        bestTeam = side==='1' ? home : side==='2' ? away : 'Nul';
      }
      break;
    }
  }

  // Build confidence score (0-100)
  var confidence = Math.min(95, Math.max(10,
    (prob > 0 ? Math.min(40, prob * 0.5) : 20)
    + (Math.abs(edge) > 0 ? Math.min(25, Math.abs(edge) * 3) : 0)
    + (fh.form && fh.form.length ? 10 : 0)
    + (h2h.total > 0 ? 10 : 0)
    + (mvH.direction ? 5 : 0)
    + (Math.abs((mvH.pctChange||0)) > 3 ? 10 : 0)
  ));

  var edgeCls = edge >= 3 ? 'edge-hot' : edge >= 1 ? 'edge-ok' : edge >= 0 ? 'edge-neutral' : 'edge-neg';
  var edgeSign = edge >= 0 ? '+' : '';

  // Key factors
  var factors = [];
  if (fh.formPct != null && fa.formPct != null) {
    var formDiff = (fh.formPct||0) - (fa.formPct||0);
    if (Math.abs(formDiff) > 15) factors.push({ icon: '📊', text: (formDiff>0?home:away) + ' en meilleure forme (' + Math.abs(formDiff) + '% écart)', positive: formDiff>0 === (home===bestTeam) });
  }
  if (h2h.total >= 3) {
    var domTeam = h2h.homeWins > h2h.awayWins ? home : away;
    factors.push({ icon: '🤝', text: 'H2H: ' + domTeam + ' domine (' + Math.max(h2h.homeWins,h2h.awayWins) + '/' + h2h.total + ')', positive: domTeam===bestTeam });
  }
  if (mvH.direction === 'down') factors.push({ icon: '📉', text: home + ' cote baisse ' + (mvH.pctChange?mvH.pctChange.toFixed(1)+'%':''), positive: false });
  if (mvA.direction === 'down') factors.push({ icon: '📉', text: away + ' cote baisse ' + (mvA.pctChange?mvA.pctChange.toFixed(1)+'%':''), positive: false });
  if (mvH.steam) factors.push({ icon: '🚨', text: 'Steam détecté sur ' + home, positive: true });
  if (mvA.steam) factors.push({ icon: '🚨', text: 'Steam détecté sur ' + away, positive: true });
  if (fh.streak > 2) factors.push({ icon: '🔥', text: home + ' en série de ' + fh.streak + ' victoires', positive: home===bestTeam });
  if (fa.streak > 2) factors.push({ icon: '🔥', text: away + ' en série de ' + fa.streak + ' victoires', positive: away===bestTeam });
  if (fh.streak < -2) factors.push({ icon: '❄️', text: home + ' en série de ' + Math.abs(fh.streak) + ' défaites', positive: home!==bestTeam });
  if (fa.streak < -2) factors.push({ icon: '❄️', text: away + ' en série de ' + Math.abs(fa.streak) + ' défaites', positive: away!==bestTeam });

  var html = '<div class="ia-panel">';

  // Recommandation principale
  var recLabel = edge >= 5 ? 'FORT BET' : edge >= 2 ? 'BET' : edge >= 0.5 ? 'SURVEILLER' : 'PASSER';
  var recColor = edge >= 5 ? '#ff5252' : edge >= 2 ? '#66bb6a' : edge >= 0.5 ? '#4fc3f7' : '#888';
  html += '<div class="ia-rec-box" style="border-color:' + recColor + '20;background:' + recColor + '0d">'
        + '<div class="ia-rec-label" style="color:' + recColor + '">' + recLabel + '</div>'
        + (bestTeam ? '<div class="ia-rec-team">' + escHtml(bestTeam) + '</div>' : '')
        + '<div class="ia-rec-meta">'
        + (prob > 0 ? '<span class="ia-meta-badge">Prob ' + Math.round(prob) + '%</span>' : '')
        + (edge !== 0 ? '<span class="ia-meta-badge" style="color:' + recColor + '">' + edgeSign + edge.toFixed(1) + '% edge</span>' : '')
        + '</div>'
        + '</div>';

  // Confidence gauge
  html += '<div class="ia-confidence">'
        + '<div class="ia-conf-label">Niveau de confiance IA</div>'
        + '<div class="ia-conf-bar-wrap">'
        + '<div class="ia-conf-bar" style="width:' + confidence + '%;background:' + recColor + '"></div>'
        + '</div>'
        + '<div class="ia-conf-pct">' + Math.round(confidence) + '%</div>'
        + '</div>';

  // Factors
  if (factors.length) {
    html += '<div class="ia-factors-title">Facteurs clés</div>'
          + '<div class="ia-factors">';
    factors.forEach(function(f) {
      var cls = f.positive ? 'ia-factor-pos' : 'ia-factor-neg';
      html += '<div class="ia-factor ' + cls + '"><span>' + f.icon + '</span><span>' + escHtml(f.text) + '</span></div>';
    });
    html += '</div>';
  }

  // Quick stats row
  html += '<div class="ia-quick-grid">';
  html += iaQuickCard('Prob. Victoire', prob > 0 ? Math.round(prob) + '%' : '—', 'via The Odds API');
  html += iaQuickCard('Edge bookmakers', edgeSign + edge.toFixed(1) + '%', edge >= 1 ? 'Valeur positive' : 'Pas de value');
  html += iaQuickCard('H2H', h2h.total > 0 ? h2h.homeWins + 'V / ' + h2h.draws + 'N / ' + h2h.awayWins + 'D' : '—', home + ' vs ' + away);
  html += iaQuickCard('Forme ' + escHtml(home.split(' ')[0]), fh.formPct != null ? fh.formPct + '%' : '—', fh.streak ? (fh.streak>0?'🔥':'❄️') + ' Série ' + fh.streak : 'N/A');
  html += iaQuickCard('Forme ' + escHtml(away.split(' ')[0]), fa.formPct != null ? fa.formPct + '%' : '—', fa.streak ? (fa.streak>0?'🔥':'❄️') + ' Série ' + fa.streak : 'N/A');
  if (mvH.current) html += iaQuickCard('Mouv. cote ' + escHtml(home.split(' ')[0]), (mvH.pctChange!=null?(mvH.pctChange>0?'+':'')+mvH.pctChange.toFixed(1)+'%':'—'), mvH.steam?'🚨 Steam':'');
  html += '</div>';

  html += '</div>';
  return html;
}

function iaQuickCard(label, val, sub) {
  return '<div class="ia-qcard"><div class="ia-qcard-val">' + val + '</div>'
       + '<div class="ia-qcard-label">' + label + '</div>'
       + (sub ? '<div class="ia-qcard-sub">' + escHtml(sub) + '</div>' : '')
       + '</div>';
}

/* ---- APERÇU TAB ---- */
function renderTabApercu(data, home, away) {
  var fh = data.formHome || {};
  var fa = data.formAway || {};
  var h2h = data.h2h || {};
  var om  = data.oddsMovement || {};
  var esp = data.espnStats || {};

  var html = '<div class="stats-apercu">';
  html += '<div class="stats-teams-row">'
        + '<div class="stats-team-name">' + escHtml(home) + '</div>'
        + '<div class="stats-vs">VS</div>'
        + '<div class="stats-team-name">' + escHtml(away) + '</div>'
        + '</div>';

  if (esp && esp.found && esp.score) {
    html += '<div class="apercu-score">'
          + '<span class="asc-h">' + esp.score.home + '</span>'
          + '<span class="asc-sep">:</span>'
          + '<span class="asc-a">' + esp.score.away + '</span>'
          + (esp.clock ? '<span class="asc-clock">⏱ ' + esp.clock + '</span>' : '')
          + '</div>';
  }

  html += '<div class="stats-quick-row">';
  html += makeQuickStat('Forme (5M)', renderFormBadgesArr(fh.form, 5), renderFormBadgesArr(fa.form, 5));
  html += makeQuickStat('% Victoires', fh.formPct != null ? fh.formPct + '%' : '—', fa.formPct != null ? fa.formPct + '%' : '—');
  html += makeQuickStat('H2H Vict.', h2h.homeWins != null ? String(h2h.homeWins) : '—', h2h.awayWins != null ? String(h2h.awayWins) : '—');
  if (fh.goalsScored != null) html += makeQuickStat('Buts marqués', String(fh.goalsScored||0), String(fa.goalsScored||0));
  if (fh.goalsConceded != null) html += makeQuickStat('Buts encaissés', String(fh.goalsConceded||0), String(fa.goalsConceded||0));
  html += '</div>';

  if (om.homeTeam || om.awayTeam) {
    html += '<div class="stats-section-title">📈 Mouvement des cotes</div>'
          + '<div class="stats-odds-row">'
          + renderOddsMini(home, om.homeTeam)
          + (om.drawTeam ? renderOddsMini('Nul', om.drawTeam) : '')
          + renderOddsMini(away, om.awayTeam)
          + '</div>';
  }
  html += '</div>';
  return html;
}

/* ---- H2H TAB ---- */
function renderTabH2H(data, home, away) {
  var h2h = data.h2h || {};
  var meetings = h2h.meetings || [];

  var html = '<div class="stats-h2h">';
  html += '<div class="stats-section-title">🤝 Confrontations directes</div>';

  if (!meetings.length) {
    html += '<div class="stats-empty">Aucune confrontation trouvée dans la base de données</div>';
  } else {
    var total = (h2h.homeWins||0) + (h2h.awayWins||0) + (h2h.draws||0);
    if (total > 0) {
      var pctH = Math.round((h2h.homeWins||0)/total*100);
      var pctD = Math.round((h2h.draws||0)/total*100);
      var pctA = 100 - pctH - pctD;
      html += '<div class="h2h-summary">'
            + '<div class="h2h-sum-team">' + escHtml(home) + '<strong>' + h2h.homeWins + '</strong></div>'
            + '<div class="h2h-sum-draw">Nul<strong>' + h2h.draws + '</strong></div>'
            + '<div class="h2h-sum-team">' + escHtml(away) + '<strong>' + h2h.awayWins + '</strong></div>'
            + '</div>'
            + '<div class="h2h-bar">'
            + '<div class="h2h-bar-h" style="width:'+pctH+'%">'+(pctH>8?pctH+'%':'')+'</div>'
            + '<div class="h2h-bar-d" style="width:'+pctD+'%">'+(pctD>8?pctD+'%':'')+'</div>'
            + '<div class="h2h-bar-a" style="width:'+pctA+'%">'+(pctA>8?pctA+'%':'')+'</div>'
            + '</div>';
    }
    html += '<table class="stats-table" style="margin-top:12px">'
          + '<thead><tr><th>Date</th><th>Saison</th><th>Domicile</th><th class="stats-score">Score</th><th>Extérieur</th></tr></thead><tbody>';
    meetings.forEach(function(m) {
      var hs = m.homeScore, as = m.awayScore;
      var scoreStr = hs + ' : ' + as;
      var winner = hs > as ? m.home : as > hs ? m.away : null;
      html += '<tr>'
            + '<td>' + (m.date||'').slice(0,10) + '</td>'
            + '<td style="color:var(--text-muted);font-size:.75rem">' + (m.season||'') + '</td>'
            + '<td class="' + (winner===m.home?'stat-winner':'') + '">' + escHtml(m.home||'') + '</td>'
            + '<td class="stats-score">' + scoreStr + '</td>'
            + '<td class="' + (winner===m.away?'stat-winner':'') + '">' + escHtml(m.away||'') + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';
  return html;
}

/* ---- FORME TAB ---- */
function renderTabForme(data, home, away) {
  var fh = data.formHome || {};
  var fa = data.formAway || {};

  function teamBlock(f, name) {
    var html = '<div class="stats-col">';
    html += '<div class="stats-col-title">' + escHtml(name) + '</div>';
    if (f.badge) html += '<img src="' + escHtml(f.badge) + '" class="team-badge" onerror="this.style.display=&quot;none&quot;">';
    if (f.form && f.form.length) {
      html += '<div class="stats-form-badges">' + renderFormBadgesArr(f.form) + '</div>';
    }
    if (f.formPct != null) html += '<div class="stats-form-pct">🎯 ' + f.formPct + '% victoires</div>';
    if (f.streak) {
      var streakIcon = f.streak > 0 ? '🔥' : '❄️';
      html += '<div class="stats-streak">' + streakIcon + ' '
            + (f.streak > 0 ? f.streak + ' victoires consécutives' : Math.abs(f.streak) + ' défaites consécutives')
            + '</div>';
    }
    if (f.goalsScored != null) {
      html += '<div class="stats-goals-row">'
            + '<span>⚽ ' + (f.goalsScored||0) + ' buts marqués</span>'
            + '<span>🥅 ' + (f.goalsConceded||0) + ' buts encaissés</span>'
            + '</div>';
    }
    // Split domicile / extérieur (style Flashscore)
    if ((f.homeForm && f.homeForm.length) || (f.awayForm && f.awayForm.length)) {
      html += '<div class="form-ha-split">';
      if (f.homeForm && f.homeForm.length) {
        html += '<div class="form-ha-row">'
              + '<span class="form-ha-label form-ha-home">🏠 Dom.</span>'
              + '<span class="form-ha-badges">' + renderFormBadgesArr(f.homeForm, 5) + '</span>'
              + (f.homeFormPct != null ? '<span class="form-ha-pct">' + f.homeFormPct + '%</span>' : '')
              + '</div>';
      }
      if (f.awayForm && f.awayForm.length) {
        html += '<div class="form-ha-row">'
              + '<span class="form-ha-label form-ha-away">✈️ Ext.</span>'
              + '<span class="form-ha-badges">' + renderFormBadgesArr(f.awayForm, 5) + '</span>'
              + (f.awayFormPct != null ? '<span class="form-ha-pct">' + f.awayFormPct + '%</span>' : '')
              + '</div>';
      }
      html += '</div>';
    }
    if (f.form && f.form.length) {
      html += '<table class="stats-table" style="margin-top:8px">'
            + '<thead><tr><th>Date</th><th>Match</th><th class="stats-score">Score</th><th></th></tr></thead><tbody>';
      var recentMatches = Array.isArray(f.form) ? f.form : [];
      recentMatches.slice(0,6).forEach(function(ev) {
        var rCls = ev.result==='W'?'fb-W':ev.result==='L'?'fb-L':'fb-D';
        var scoreStr = ev.homeScore + ':' + ev.awayScore;
        html += '<tr>'
              + '<td>' + (ev.date||'').slice(0,10) + '</td>'
              + '<td style="font-size:.75rem">' + escHtml(ev.home||'') + ' v ' + escHtml(ev.away||'') + '</td>'
              + '<td class="stats-score">' + scoreStr + '</td>'
              + '<td><span class="form-badge ' + rCls + '">' + ev.result + '</span></td>'
              + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  return '<div class="stats-forme"><div class="stats-two-col">'
       + teamBlock(fh, home)
       + teamBlock(fa, away)
       + '</div></div>';
}

/* ---- COTES TAB ---- */
function renderTabCotes(data, home, away) {
  var om = data.oddsMovement || {};

  var html = '<div class="stats-cotes">';
  html += '<div class="stats-section-title">📊 Variation des cotes <span class="cotes-live-badge">🔄 live</span></div>';

  if (!om.homeTeam && !om.awayTeam) {
    html += '<div class="stats-empty">Historique des cotes non disponible — les variations s\'enregistrent au fil des scans</div>';
    return html + '</div>';
  }

  function oddsBlock(label, mov) {
    if (!mov) return '';
    var dir = mov.direction || 'stable';
    var arrow = dir==='down'?'▼':dir==='up'?'▲':'→';
    var cls = dir==='down'?'odds-down':dir==='up'?'odds-up':'odds-stable';
    var steamBadge = mov.steam ? '<span class="steam-badge">🚨 STEAM</span>' : '';
    var sparkHtml = (mov.sparkline && mov.sparkline.length > 1) ? renderSparkline(mov.sparkline) : '';
    return '<div class="odds-block">'
         + '<div class="odds-block-label">' + escHtml(label) + '</div>'
         + '<div class="odds-vals-row">'
         + '<div class="odds-val-item"><div class="ovl">Ouverture</div><div class="ovv">' + (mov.opening?mov.opening.toFixed(2):'—') + '</div></div>'
         + '<div class="odds-arrow-big ' + cls + '">' + arrow + '</div>'
         + '<div class="odds-val-item"><div class="ovl">Actuel</div><div class="ovv">' + (mov.current?mov.current.toFixed(2):'—') + '</div></div>'
         + '<div class="odds-val-item"><div class="ovl">Variation</div><div class="ovv ' + cls + '">' + (mov.pctChange!=null?(mov.pctChange>0?'+':'')+mov.pctChange.toFixed(1)+'%':'—') + '</div></div>'
         + steamBadge
         + '</div>'
         + sparkHtml
         + '</div>';
  }

  html += oddsBlock(home, om.homeTeam);
  if (om.drawTeam) html += oddsBlock('Nul', om.drawTeam);
  html += oddsBlock(away, om.awayTeam);
  html += '</div>';
  return html;
}

/* ---- LIVE ESPN TAB ---- */
function renderTabLive(data, home, away) {
  var esp = data.espnStats || {};

  var html = '<div class="stats-live">';
  html += '<div class="stats-section-title">⚡ Stats ESPN en direct</div>';

  if (!esp || !esp.found) {
    html += '<div class="stats-empty">Pas de stats ESPN disponibles — match non démarré ou hors couverture ESPN</div>';
    return html + '</div>';
  }

  // Score + horloge
  if (esp.score) {
    html += '<div class="apercu-score" style="margin-bottom:16px">'
          + '<span class="asc-h">' + esp.score.home + '</span>'
          + '<span class="asc-sep">:</span>'
          + '<span class="asc-a">' + esp.score.away + '</span>'
          + (esp.clock ? '<span class="asc-clock">⏱ ' + esp.clock + '</span>' : '')
          + '</div>';
  }

  // Venue + Arbitre (style Flashscore)
  if (esp.venue || esp.referee) {
    html += '<div class="live-venue-bar">';
    if (esp.venue && esp.venue.name) {
      html += '<span class="live-venue-item">🏟️ ' + escHtml(esp.venue.name)
            + (esp.venue.city ? ' <span class="live-venue-city">(' + escHtml(esp.venue.city) + ')</span>' : '')
            + (esp.venue.capacity ? ' <span class="live-venue-cap">' + esp.venue.capacity.toLocaleString() + ' pl.</span>' : '')
            + '</span>';
    }
    if (esp.referee && esp.referee.name) {
      html += '<span class="live-venue-item">👁 ' + escHtml(esp.referee.name) + '</span>';
    }
    html += '</div>';
  }

  var hStats = esp.statsA || {};
  var aStats = esp.statsB || {};

  // Build stat rows — football + tennis complets
  var statDefs = [
    { key: 'possession', label: 'Possession (%)' },
    { key: 'shots', label: 'Tirs' },
    { key: 'shotsOnTarget', label: 'Tirs cadrés' },
    { key: 'xGoals', label: 'xG (buts attendus)' },
    { key: 'corners', label: 'Corners' },
    { key: 'fouls', label: 'Fautes' },
    { key: 'yellowCards', label: 'Cartons jaunes' },
    { key: 'redCards', label: 'Cartons rouges' },
    { key: 'offsides', label: 'Hors-jeux' },
    { key: 'aces', label: 'Aces' },
    { key: 'doubleFaults', label: 'Doubles fautes' },
    { key: 'firstServePct', label: '1er service (%)' },
  ];

  var rows = statDefs.filter(function(s){ return hStats[s.key] != null || aStats[s.key] != null; });

  if (rows.length) {
    html += '<table class="stats-table stats-live-table">';
    html += '<thead><tr><th>' + escHtml(home) + '</th><th>Statistique</th><th>' + escHtml(away) + '</th></tr></thead><tbody>';
    rows.forEach(function(s) {
      var hv = hStats[s.key] || '0';
      var av = aStats[s.key] || '0';
      var hNum = parseFloat(hv) || 0;
      var aNum = parseFloat(av) || 0;
      var total = hNum + aNum;
      var hPct = total > 0 ? Math.round(hNum/total*100) : 50;
      var aPct = 100 - hPct;
      html += '<tr>'
            + '<td class="stat-cell"><span class="stat-num' + (hNum>aNum?' stat-winner':'') + '">' + hv + '</span>'
            + '<div class="stat-bar-track"><div class="stat-bar-fill stat-bar-h" style="width:' + hPct + '%"></div></div></td>'
            + '<td class="stat-label">' + s.label + '</td>'
            + '<td class="stat-cell"><div class="stat-bar-track stat-bar-track-r"><div class="stat-bar-fill stat-bar-a" style="width:' + aPct + '%"></div></div>'
            + '<span class="stat-num' + (aNum>hNum?' stat-winner':'') + '">' + av + '</span></td>'
            + '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<div class="stats-empty">Statistiques pas encore disponibles pour ce match</div>';
  }

  // Timeline incidents (style Flashscore) — buts, cartons, remplacement
  var incidents = esp.incidents || [];
  if (incidents.length) {
    html += '<div class="stats-section-title" style="margin-top:18px">📋 Chronologie du match</div>';
    html += '<div class="incident-timeline">';
    // Trier par horloge (format "45+2'", "67'" → extraire le nombre)
    var sorted = incidents.slice().sort(function(a, b) {
      var pa = parseInt((a.clock||'0').replace(/[^0-9]/g,'')) || 0;
      var pb = parseInt((b.clock||'0').replace(/[^0-9]/g,'')) || 0;
      return pa - pb;
    });
    sorted.forEach(function(inc) {
      var icon = '⚽';
      var cls = 'inc-goal';
      if (inc.redCard) { icon = '🟥'; cls = 'inc-red'; }
      else if (inc.yellowCard) { icon = '🟨'; cls = 'inc-yellow'; }
      else if (/sub|remplac/i.test(inc.type)) { icon = '🔄'; cls = 'inc-sub'; }
      else if (!inc.scoring) { icon = '📌'; cls = 'inc-event'; }
      if (inc.penalty) icon = '⚽ P';
      var athlete = (inc.athletes && inc.athletes[0]) ? escHtml(inc.athletes[0]) : '';
      var sideClass = inc.side === 'home' ? 'inc-side-home' : 'inc-side-away';
      html += '<div class="incident-item ' + cls + ' ' + sideClass + '">'
            + '<span class="inc-clock">' + escHtml(inc.clock) + '</span>'
            + '<span class="inc-icon">' + icon + '</span>'
            + '<span class="inc-info"><strong>' + (inc.side === 'home' ? escHtml(home) : escHtml(away)) + '</strong>'
            + (athlete ? ' — ' + athlete : '')
            + '</span>'
            + '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/* ---- HELPERS ---- */
function renderFormBadgesArr(form, limit) {
  if (!form || !form.length) return '<span style="color:var(--text-muted);font-size:.75rem">N/A</span>';
  var arr = Array.isArray(form) ? form : form.split ? form.split('') : [];
  if (limit) arr = arr.slice(0, limit);
  return arr.map(function(item) {
    var r = typeof item === 'object' ? item.result : item;
    var cls = r==='W'?'fb-W':r==='L'?'fb-L':'fb-D';
    return '<span class="form-badge ' + cls + '">' + r + '</span>';
  }).join('');
}

function renderOddsMini(label, mov) {
  if (!mov) return '';
  var dir = mov.direction||'stable';
  var arrow = dir==='down'?'▼':dir==='up'?'▲':'→';
  var cls = dir==='down'?'odds-down':dir==='up'?'odds-up':'odds-stable';
  return '<div class="odds-mini">'
       + '<div class="odds-mini-label">' + escHtml(label) + '</div>'
       + '<div class="odds-mini-val ' + cls + '">' + arrow + ' ' + (mov.current?mov.current.toFixed(2):'—') + '</div>'
       + (mov.pctChange!=null ? '<div class="odds-mini-pct ' + cls + '">' + (mov.pctChange>0?'+':'') + mov.pctChange.toFixed(1) + '%</div>' : '')
       + '</div>';
}

function renderSparkline(vals) {
  if (!vals || vals.length < 2) return '';
  var w = 220, h = 44;
  var min = Math.min.apply(null, vals);
  var max = Math.max.apply(null, vals);
  var range = max - min || 1;
  var pts = vals.map(function(v,i){
    var x = Math.round(i/(vals.length-1)*w);
    var y = Math.round(h - (v-min)/range*h);
    return x+','+y;
  }).join(' ');
  return '<svg class="sparkline" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg" style="margin-top:8px">'
       + '<polyline points="'+pts+'" fill="none" stroke="var(--accent,#4fc3f7)" stroke-width="2" stroke-linejoin="round"/>'
       + '<circle cx="'+pts.split(' ').pop().split(',')[0]+'" cy="'+pts.split(' ').pop().split(',')[1]+'" r="3" fill="var(--accent,#4fc3f7)"/>'
       + '</svg>';
}

function makeQuickStat(label, valH, valA) {
  return '<div class="quick-stat">'
       + '<div class="qs-val-h">' + valH + '</div>'
       + '<div class="qs-label">' + label + '</div>'
       + '<div class="qs-val-a">' + valA + '</div>'
       + '</div>';
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* ===== AUTO-ANALYSE CARTES ===== */

function buildInlinePred(edge, prob, teamName, isLive) {
  // Prédiction basée sur edge et probabilité, sans appel API
  var strength, icon, cls, advice;
  if (edge >= 5) {
    icon = '🔥'; strength = 'Value forte'; cls = 'pred-hot'; advice = 'BET';
  } else if (edge >= 2) {
    icon = '✅'; strength = 'Value modérée'; cls = 'pred-good'; advice = 'Envisager';
  } else if (edge >= 0.5) {
    icon = '💡'; strength = 'Légère value'; cls = 'pred-ok'; advice = 'Surveiller';
  } else if (edge > -1) {
    icon = '⚖️'; strength = 'Marché serré'; cls = 'pred-neutral'; advice = '';
  } else {
    icon = '❌'; strength = 'Pas de value'; cls = 'pred-bad'; advice = '';
  }
  var probStr = prob > 0 ? Math.round(prob) + '%' : '';
  var teamStr = teamName ? ' <strong>' + teamName + '</strong>' : '';
  var advStr  = advice && teamName ? ' → ' + advice + teamStr : '';
  return '<div class="card-pred-bar ' + cls + '">'
       + '<span class="cpb-icon">' + icon + '</span>'
       + '<span class="cpb-label">' + strength + '</span>'
       + (probStr ? '<span class="cpb-prob">' + probStr + '</span>' : '')
       + advStr
       + (isLive ? '<span class="cpb-live-tag">⏱ LIVE</span>' : '')
       + '</div>';
}

function renderSignalBadges(signals) {
  if (!signals) return '';
  var ICONS = {
    kineA: '⚕️ Kiné A', kineB: '⚕️ Kiné B',
    breakA: '💥 Break A', breakB: '💥 Break B',
    momentumA: '🔥 Momentum A', momentumB: '🔥 Momentum B',
    suspension: '🟥 Suspension', boiterie: '🩹 Boiterie',
    redCard: '🟥 Carton rouge', retirement: '🏳️ Abandon'
  };
  var active = Object.keys(signals).filter(function(k){ return signals[k] && ICONS[k]; });
  if (!active.length) return '';
  return '<div class="card-signals-row">'
       + active.map(function(k){ return '<span class="csig">' + ICONS[k] + '</span>'; }).join('')
       + '</div>';
}

var _analysisCache = {};
var _analysisQueue = [];
var _analysisRunning = false;

function queueCardAnalysis(cardEl) {
  var home = cardEl.dataset.home;
  var away = cardEl.dataset.away;
  var sport = cardEl.dataset.sport;
  var isLive = cardEl.dataset.isLive === '1';
  if (!home || !away) return;
  var key = home + '|' + away + '|' + sport;
  var edge = parseFloat(cardEl.dataset.edge) || 0;
  var prob = parseFloat(cardEl.dataset.prob) || 0;
  var bestOdd = cardEl.querySelector('.mc-odd.mc-best');
  var teamName = '';
  if (bestOdd) {
    var lbl = bestOdd.querySelector('.mc-ol');
    if (lbl) {
      var side = lbl.textContent.trim();
      if (side === '1') teamName = home;
      else if (side === '2') teamName = away;
      else teamName = 'Nul';
    }
  }
  var analysisDiv = cardEl.querySelector('.card-analysis');
  if (!analysisDiv) return;
  analysisDiv.innerHTML = buildInlinePred(edge, prob, teamName, isLive);
  if (isLive && !_analysisCache[key]) {
    _analysisQueue.push({ key: key, home: home, away: away, sport: sport, cardEl: cardEl, analysisDiv: analysisDiv, edge: edge, prob: prob, teamName: teamName });
    if (!_analysisRunning) drainAnalysisQueue();
  }
}

function drainAnalysisQueue() {
  if (!_analysisQueue.length) { _analysisRunning = false; return; }
  _analysisRunning = true;
  var item = _analysisQueue.shift();
  var url = '/api/live-signals?sport=' + encodeURIComponent(item.sport)
           + '&home=' + encodeURIComponent(item.home)
           + '&away=' + encodeURIComponent(item.away);
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(d) {
      _analysisCache[item.key] = d;
      var signals = d.signals || {};
      var sigHtml = renderSignalBadges(signals);
      if (item.cardEl.isConnected && item.analysisDiv.isConnected) {
        var pred = buildInlinePred(item.edge, item.prob, item.teamName, true);
        item.analysisDiv.innerHTML = pred + sigHtml;
      }
    })
    .catch(function(){})
    .finally(function(){
      setTimeout(drainAnalysisQueue, 400);
    });
}

function autoAnalyzeCards(container) {
  var cards = container.querySelectorAll('.feed-card-clickable');
  var delay = 0;
  cards.forEach(function(card) {
    var analysisDiv = card.querySelector('.card-analysis');
    if (analysisDiv && analysisDiv.dataset.loaded !== '1') {
      analysisDiv.dataset.loaded = '1';
      setTimeout(function(){ queueCardAnalysis(card); }, delay);
      delay += 50;
    }
  });
}