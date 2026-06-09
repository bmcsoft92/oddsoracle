/**
 * OddsOracle -- Live Betting Module
 * Signaux en temps reel, recalcul probabiliste, alertes, fiche de declenchement
 * Coherence sport: Tennis / Football / Basketball / Hockey / Baseball / MMA
 */

const LiveModule = (() => {

  let activeSignals = {
    kineA: false, kineB: false,
    breakA: false, breakB: false,
    momentumA: false, momentumB: false,
    coteMove: false, suspension: false,
    boiterieA: false
  };

  let activeCount = 0;
  let countdownTimer = null;

  // ── Config sport: labels, champs visibles, signaux adaptes
  const SPORT_CTX = {
    tennis: {
      label:       'Tennis',
      setsRowVisible: true,
      gamesRowVisible: true,
      setsALbl:    'Sets A',
      setsBLbl:    'Sets B',
      setNumLbl:   'Set actuel',
      setNumVisible: true,
      gamesALbl:   'Jeux A (set actuel)',
      gamesBLbl:   'Jeux B (set actuel)',
      minutesLbl:  'Minutes jouees',
      scoreFormat: function(d) { return d.setsA + '-' + d.setsB + ' (Set ' + d.setNum + ': ' + d.gamesA + '-' + d.gamesB + ')'; },
      sc1Label:    function(d) { return d.playerA + ' perd le 1er set'; },
      sc2Label:    function(d) { return d.playerB + ' perd le 1er set'; },
      sc3Label:    'Tie-break au 1er set',
      sc4Label:    'Blessure / Appel kine',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 0, minutesPlayed: 30 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 30 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 6, gamesB: 6, minutesPlayed: 45 }); },
      sc3Extra:    'Marche: vainqueur du tie-break',
    },
    football: {
      label:       'Football',
      setsRowVisible: false,
      gamesRowVisible: true,
      gamesALbl:   'Buts A',
      gamesBLbl:   'Buts B',
      minutesLbl:  'Minutes (sur 90)',
      scoreFormat: function(d) { return d.gamesA + '-' + d.gamesB + ' (' + d.minutesPlayed + "')"; },
      sc1Label:    function(d) { return 'But de ' + d.playerB + ' (A encaisse)'; },
      sc2Label:    function(d) { return 'But de ' + d.playerA + ' (B encaisse)'; },
      sc3Label:    'Carton rouge',
      sc4Label:    'Pression / Domination territoire',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 1, minutesPlayed: 30 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 1, gamesB: 0, minutesPlayed: 30 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 45, signals: { kineA: true } }); },
      sc3Extra:    'Marche: vainqueur du match',
    },
    basketball: {
      label:       'Basketball',
      setsRowVisible: true,
      gamesRowVisible: true,
      setsALbl:    'Pts A (total)',
      setsBLbl:    'Pts B (total)',
      setNumLbl:   'Quart actuel',
      setNumVisible: true,
      gamesALbl:   'Pts A (ce quart)',
      gamesBLbl:   'Pts B (ce quart)',
      minutesLbl:  'Minutes jouees',
      scoreFormat: function(d) { return d.setsA + '-' + d.setsB + ' (Q' + d.setNum + ': +' + d.gamesA + '/' + d.gamesB + ')'; },
      sc1Label:    function(d) { return d.playerA + ' mene de +10 pts'; },
      sc2Label:    function(d) { return d.playerB + ' revient a -5 pts'; },
      sc3Label:    'Mi-temps serree (ecart < 5)',
      sc4Label:    'Blessure titulaire',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 10, gamesB: 0, minutesPlayed: 24 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 5, gamesB: 0, minutesPlayed: 24 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 2, gamesB: 2, minutesPlayed: 24 }); },
      sc3Extra:    'Marche: vainqueur du match',
    },
    hockey: {
      label:       'Hockey',
      setsRowVisible: true,
      gamesRowVisible: true,
      setsALbl:    'Buts A (total)',
      setsBLbl:    'Buts B (total)',
      setNumLbl:   'Periode',
      setNumVisible: true,
      gamesALbl:   'Tirs A (periode)',
      gamesBLbl:   'Tirs B (periode)',
      minutesLbl:  'Minutes jouees',
      scoreFormat: function(d) { return d.setsA + '-' + d.setsB + ' (P' + d.setNum + ')'; },
      sc1Label:    function(d) { return 'But de ' + d.playerB + ' (A encaisse)'; },
      sc2Label:    function(d) { return 'But de ' + d.playerA + ' (B encaisse)'; },
      sc3Label:    'Powerplay / Penalite',
      sc4Label:    'Blessure gardien',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 0, minutesPlayed: 20 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 20 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 8, gamesB: 2, minutesPlayed: 20 }); },
      sc3Extra:    'Marche: prochain but',
    },
    baseball: {
      label:       'Baseball',
      setsRowVisible: true,
      gamesRowVisible: true,
      setsALbl:    'Runs A',
      setsBLbl:    'Runs B',
      setNumLbl:   'Manche',
      setNumVisible: true,
      gamesALbl:   'Outs',
      gamesBLbl:   'Hommes en base',
      minutesLbl:  'Manche (1-9)',
      scoreFormat: function(d) { return d.setsA + '-' + d.setsB + ' (M' + d.setNum + ')'; },
      sc1Label:    function(d) { return 'Run de ' + d.playerB + ' (A encaisse)'; },
      sc2Label:    function(d) { return 'Run de ' + d.playerA + ' (B encaisse)'; },
      sc3Label:    'Bases chargees / Momentum offensif',
      sc4Label:    'Pitcher remplace',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 0, minutesPlayed: 30 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 30 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 3, gamesB: 3, minutesPlayed: 30 }); },
      sc3Extra:    'Marche: vainqueur du match',
    },
    mma: {
      label:       'MMA / Combat',
      setsRowVisible: false,
      gamesRowVisible: false,
      minutesLbl:  'Round actuel',
      scoreFormat: function(d) { return 'Round ' + (d.minutesPlayed || 1); },
      sc1Label:    function(d) { return d.playerA + ' prend l\'avantage (KD/TD)'; },
      sc2Label:    function(d) { return d.playerB + ' prend l\'avantage'; },
      sc3Label:    'Combat serr - cartes divisees attendues',
      sc4Label:    'Blessure visible / saignement',
      sc1Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 5 }); },
      sc2Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 0, minutesPlayed: 5 }); },
      sc3Recalc:   function(pBaseA) { return OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 10 }); },
      sc3Extra:    'Marche: methode de victoire',
    },
  };

  function getSportGroup(sportVal) {
    if (!sportVal) return 'tennis';
    if (sportVal.startsWith('tennis')) return 'tennis';
    if (sportVal.startsWith('soccer') || sportVal === 'football') return 'football';
    if (sportVal.startsWith('basketball')) return 'basketball';
    if (sportVal.startsWith('icehockey')) return 'hockey';
    if (sportVal.startsWith('baseball')) return 'baseball';
    if (sportVal.startsWith('mma') || sportVal.startsWith('americanfootball')) return 'mma';
    return 'football';
  }

  function getCurrentSport() {
    const sel = document.getElementById('live-sport-select');
    return sel ? getSportGroup(sel.value) : 'tennis';
  }

  function updateLiveSportContext(sportVal) {
    const group = getSportGroup(sportVal);
    const ctx = SPORT_CTX[group] || SPORT_CTX.tennis;

    // Score form fields
    const setsRow   = document.getElementById('live-sets-row');
    const gamesRow  = document.getElementById('live-games-row');
    const setNumGrp = document.getElementById('live-setnum-group');

    if (setsRow)  setsRow.style.display  = ctx.setsRowVisible  ? '' : 'none';
    if (gamesRow) gamesRow.style.display = ctx.gamesRowVisible ? '' : 'none';
    if (setNumGrp) setNumGrp.style.display = (ctx.setNumVisible !== false) ? '' : 'none';

    var lbl = function(id, text) { var el = document.getElementById(id); if (el && text) el.textContent = text; };
    lbl('live-setsA-lbl',   ctx.setsALbl);
    lbl('live-setsB-lbl',   ctx.setsBLbl);
    lbl('live-setNum-lbl',  ctx.setNumLbl);
    lbl('live-gamesA-lbl',  ctx.gamesALbl);
    lbl('live-gamesB-lbl',  ctx.gamesBLbl);
    lbl('live-minutes-lbl', ctx.minutesLbl);

    // === CONTEXT PANEL : visibilité sport-spécifique ===
    var sv = sportVal || '';
    var isTennis     = (group === 'tennis');
    var isWTA        = isTennis && (sv.indexOf('wta') >= 0 || sv.indexOf('womens') >= 0);
    var isFootball   = (group === 'football');
    var isBasketball = (group === 'basketball');
    var isMMA        = (group === 'mma');
    var isBaseball   = (group === 'baseball');
    var isHockey     = (group === 'hockey');

    // Fonction utilitaire show/hide
    var showEl  = function(id) { var e=document.getElementById(id); if(e) e.style.display=''; };
    var hideEl  = function(id) { var e=document.getElementById(id); if(e) e.style.display='none'; };
    var showCls = function(cls) { document.querySelectorAll('.'+cls).forEach(function(e){ e.style.display=''; }); };
    var hideCls = function(cls) { document.querySelectorAll('.'+cls).forEach(function(e){ e.style.display='none'; }); };

    // Surface — uniquement tennis
    showCls('ctx-field-surface');
    if (!isTennis) hideCls('ctx-field-surface');

    // Cycle féminin — uniquement WTA
    showCls('ctx-field-cycle');
    if (!isWTA) hideCls('ctx-field-cycle');

    // Blocs sport-spécifiques par groupe
    ['ctx-sport-tennis','ctx-sport-football','ctx-sport-basketball',
     'ctx-sport-mma','ctx-sport-baseball','ctx-sport-hockey'].forEach(function(c){ hideCls(c); });
    if (isTennis)     showCls('ctx-sport-tennis');
    if (isFootball)   showCls('ctx-sport-football');
    if (isBasketball) showCls('ctx-sport-basketball');
    if (isMMA)        showCls('ctx-sport-mma');
    if (isBaseball)   showCls('ctx-sport-baseball');
    if (isHockey)     showCls('ctx-sport-hockey');

    // Libellé "Joueur" vs "Équipe"
    var isTeamSport = !isTennis && !isMMA;
    var ctxATitle = document.getElementById('ctx-a-title');
    var ctxBTitle = document.getElementById('ctx-b-title');
    var labA = document.getElementById('live-playerA') ? document.getElementById('live-playerA').value || '' : '';
    var labB = document.getElementById('live-playerB') ? document.getElementById('live-playerB').value || '' : '';
    if (ctxATitle && !labA) ctxATitle.textContent = isTeamSport ? 'Équipe domicile' : 'Joueur A';
    if (ctxBTitle && !labB) ctxBTitle.textContent = isTeamSport ? 'Équipe extérieure' : 'Joueur B';
  }

  function collectLiveData() {
    return {
      sport:       getCurrentSport(),
      playerA:     document.getElementById('live-playerA').value || 'Equipe A',
      playerB:     document.getElementById('live-playerB').value || 'Equipe B',
      setsA:       parseInt(document.getElementById('live-setsA').value) || 0,
      setsB:       parseInt(document.getElementById('live-setsB').value) || 0,
      setNum:      parseInt(document.getElementById('live-setNum').value) || 1,
      gamesA:      parseInt(document.getElementById('live-gamesA').value) || 0,
      gamesB:      parseInt(document.getElementById('live-gamesB').value) || 0,
      coteA:       parseFloat(document.getElementById('live-coteA').value) || 0,
      coteB:       parseFloat(document.getElementById('live-coteB').value) || 0,
      pBaseA:      parseFloat(document.getElementById('live-pbaseA').value) || 50,
      minutesPlayed: parseInt(document.getElementById('live-minutes').value) || 0,
    };
  }

  function toggleSignal(signalKey, btn) {
    activeSignals[signalKey] = !activeSignals[signalKey];
    btn.classList.toggle('active', activeSignals[signalKey]);
  }

  function formatScore(d) {
    const ctx = SPORT_CTX[d.sport] || SPORT_CTX.tennis;
    return ctx.scoreFormat(d);
  }

  function calcAndShowAlert() {
    const d = collectLiveData();
    const ctx = SPORT_CTX[d.sport] || SPORT_CTX.tennis;

    const result = OddsModels.liveRecalc({
      pBase:         d.pBaseA / 100,
      setsA:         d.setsA,
      setsB:         d.setsB,
      gamesA:        d.gamesA,
      gamesB:        d.gamesB,
      minutesPlayed: d.minutesPlayed,
      tiebreaksPlayed: 0,
      signals:       activeSignals,
    });

    const { pLiveA, pLiveB, factors } = result;
    const alloc = BankrollManager.getAllocation();
    const bankrollLive = alloc.live;
    const minEdge = BankrollManager.getConfig().edgeMinLive / 100;

    let edgeA = d.coteA > 1 ? pLiveA - (1 / d.coteA) : null;
    let edgeB = d.coteB > 1 ? pLiveB - (1 / d.coteB) : null;

    let bestPlayer = null, bestEdge = null, bestCote = null, bestProb = null;
    if (edgeA != null && edgeA > minEdge && (!edgeB || edgeA >= edgeB)) {
      bestPlayer = d.playerA; bestEdge = edgeA; bestCote = d.coteA; bestProb = pLiveA;
    } else if (edgeB != null && edgeB > minEdge) {
      bestPlayer = d.playerB; bestEdge = edgeB; bestCote = d.coteB; bestProb = pLiveB;
    }

    let stakeRec = null;
    if (bestPlayer && bestCote > 1) {
      const k = OddsModels.kellyLive(bestProb, bestCote, bankrollLive);
      stakeRec = { ...k, bankrollLive };
    }

    const score  = formatScore(d);
    const dt     = new Date().toLocaleTimeString('fr-FR');
    const cfg    = BankrollManager.getConfig();
    const output = document.getElementById('live-alert-output');

    const edgePct = function(e) { return e != null ? (e*100).toFixed(1) + '%' : '--'; };
    const fmtPct  = function(p) { return (p*100).toFixed(0) + '%'; };
    const isValue  = bestEdge != null && bestEdge > 0;
    const isStrong = bestEdge != null && bestEdge > 0.10;

    let actionHTML = '';
    if (bestPlayer && stakeRec) {
      const stakeFmt = stakeRec.stakeReduced > 0 ? stakeRec.stakeReduced.toFixed(0) + ' EUR' : '< 1 EUR';
      actionHTML = '<div class="live-action-block ' + (isStrong ? 'action-strong' : 'action-value') + '">'
        + '<div class="act-label">ACTION -- 10s MAX</div>'
        + '<div class="act-row"><span>Pari:</span><strong>' + bestPlayer + ' -- Vainqueur</strong></div>'
        + '<div class="act-row"><span>Cote min.:</span><strong>' + bestCote.toFixed(2) + '</strong></div>'
        + '<div class="act-row"><span>Edge:</span><strong class="' + (bestEdge > 0.10 ? 'text-green' : 'text-cyan') + '">' + edgePct(bestEdge) + '</strong></div>'
        + '<div class="act-row"><span>Mise live (-40%):</span><strong style="color:var(--accent)">' + stakeFmt + '</strong></div>'
        + '<div class="act-row"><span>Bankroll live:</span><strong>' + (bankrollLive > 0 ? bankrollLive.toFixed(0) + ' EUR' : 'Non configuree') + '</strong></div>'
        + '<div class="act-invalid">Invalider si cote descend sous ' + bestCote.toFixed(2) + ' ou signal annule</div>'
        + '</div>';
    } else {
      actionHTML = '<div class="act-no-value">Aucune value detectee -- Edge insuffisant (< ' + cfg.edgeMinLive + '%)</div>';
    }

    const signals = Object.entries({
      kineA:     activeSignals.kineA     ? 'Appel kine ' + d.playerA : null,
      kineB:     activeSignals.kineB     ? 'Appel kine ' + d.playerB : null,
      breakA:    activeSignals.breakA    ? 'Break / avantage ' + d.playerA : null,
      breakB:    activeSignals.breakB    ? 'Break / avantage ' + d.playerB : null,
      momentumA: activeSignals.momentumA ? 'Momentum ' + d.playerA : null,
      momentumB: activeSignals.momentumB ? 'Momentum ' + d.playerB : null,
      coteMove:  activeSignals.coteMove  ? 'Mouvement de cotes >15%' : null,
      suspension: activeSignals.suspension ? 'Cotes suspendues' : null,
      boiterieA: activeSignals.boiterieA ? 'Blessure visible ' + d.playerA : null,
    }).filter(function(e) { return e[1] !== null; }).map(function(e) { return e[1]; });

    output.innerHTML = '<div class="live-alert-box ' + (isStrong ? 'alert-box-strong' : isValue ? 'alert-box-value' : 'alert-box-neutral') + '">'
      + '<div class="alert-header">'
      + '<span class="alert-sport">ALERTE LIVE - ' + ctx.label.toUpperCase() + '</span>'
      + '<span class="alert-time">' + dt + '</span>'
      + '</div>'
      + '<div class="alert-match">' + d.playerA + ' vs ' + d.playerB + '</div>'
      + '<div class="alert-score">Score: ' + score + '</div>'
      + '<div class="alert-sep">----------------------------------</div>'
      + '<div class="alert-section">'
      + '<div class="alert-section-title">SIGNAUX DETECTES</div>'
      + (signals.length ? signals.map(function(s) { return '<div class="signal-item">' + s + '</div>'; }).join('') : '<div class="signal-item muted">Aucun signal actif</div>')
      + '</div>'
      + '<div class="alert-section">'
      + '<div class="alert-section-title">PROBABILITES LIVE</div>'
      + '<div class="prob-live-row">'
      + '<span>' + d.playerA + '</span>'
      + '<div class="prob-live-bar"><div style="width:' + (pLiveA*100).toFixed(0) + '%;background:var(--accent)"></div></div>'
      + '<strong>' + fmtPct(pLiveA) + '</strong>'
      + '<span class="edge-small ' + (edgeA != null && edgeA > 0.05 ? 'text-green' : 'text-muted') + '">'
      + (edgeA != null ? 'Edge: ' + edgePct(edgeA) : '--') + '</span>'
      + '</div>'
      + '<div class="prob-live-row">'
      + '<span>' + d.playerB + '</span>'
      + '<div class="prob-live-bar"><div style="width:' + (pLiveB*100).toFixed(0) + '%;background:var(--orange)"></div></div>'
      + '<strong>' + fmtPct(pLiveB) + '</strong>'
      + '<span class="edge-small ' + (edgeB != null && edgeB > 0.05 ? 'text-green' : 'text-muted') + '">'
      + (edgeB != null ? 'Edge: ' + edgePct(edgeB) : '--') + '</span>'
      + '</div>'
      + '<div class="factors-mini">'
      + 'Score x' + factors.factorScore.toFixed(2) + ' - Jeux x' + factors.factorGames.toFixed(2)
      + ' - Momentum x' + factors.factorMomentum.toFixed(2) + ' - Fatigue x' + factors.factorFatigue.toFixed(2)
      + (factors.medFactor < 1 ? ' - <span style="color:var(--red)">Medical x' + factors.medFactor.toFixed(2) + '</span>' : '')
      + '</div>'
      + '</div>'
      + actionHTML
      + '</div>';

    if (bestPlayer) startCountdown();
    updateScoreDisplay(d);
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    const el  = document.getElementById('countdown');
    const val = document.getElementById('countdown-val');
    el.style.display = 'inline-flex';
    let secs = 10;
    val.textContent = secs;
    countdownTimer = setInterval(function() {
      secs--;
      val.textContent = secs;
      if (secs <= 0) { clearInterval(countdownTimer); el.style.display = 'none'; }
    }, 1000);
  }

  function detectSignalType() {
    if (activeSignals.kineA || activeSignals.kineB) return 'Blessure/Kine';
    if (activeSignals.boiterieA) return 'Blessure';
    if (activeSignals.breakA || activeSignals.breakB) return 'Avantage';
    if (activeSignals.momentumA || activeSignals.momentumB) return 'Momentum';
    if (activeSignals.coteMove || activeSignals.suspension) return 'Marche';
    return 'General';
  }

  function updateScoreDisplay(d) {
    document.getElementById('live-pA-name').textContent = d.playerA;
    document.getElementById('live-pB-name').textContent = d.playerB;
    const scoreEl = document.getElementById('live-score-display');
    if (scoreEl) {
      const ctx = SPORT_CTX[d.sport] || SPORT_CTX.tennis;
      scoreEl.textContent = ctx.setsRowVisible ? d.setsA + ' - ' + d.setsB : d.gamesA + ' - ' + d.gamesB;
    }
  }

  function generateFiche() {
    const d = collectLiveData();
    const ctx = SPORT_CTX[d.sport] || SPORT_CTX.tennis;
    const pBaseA = d.pBaseA / 100;
    const alloc = BankrollManager.getAllocation();
    const bankrollLive = alloc.live;

    const sc1 = ctx.sc1Recalc(pBaseA);
    const sc2 = ctx.sc2Recalc(pBaseA);
    const sc3 = ctx.sc3Recalc(pBaseA);
    const sc4 = OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 0, signals: { kineA: true } });

    const coteA_sc1 = d.coteA > 1 ? (1 / sc1.pLiveA).toFixed(2) : '--';
    const coteB_sc2 = d.coteB > 1 ? (1 / sc2.pLiveB).toFixed(2) : '--';

    const kellyK1 = d.coteA > 1 ? OddsModels.kellyLive(sc1.pLiveA, d.coteA, bankrollLive) : null;
    const kellyK2 = d.coteB > 1 ? OddsModels.kellyLive(sc2.pLiveB, d.coteB, bankrollLive) : null;

    const sc1Lbl = typeof ctx.sc1Label === 'function' ? ctx.sc1Label(d) : ctx.sc1Label;
    const sc2Lbl = typeof ctx.sc2Label === 'function' ? ctx.sc2Label(d) : ctx.sc2Label;

    const ficheOutput = document.getElementById('live-fiche-output');
    ficheOutput.innerHTML = '<div class="fiche-output">'
      + '<span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/>'
      + '<span class="f-title">  FICHE LIVE [' + ctx.label.toUpperCase() + '] -- ' + d.playerA + ' vs ' + d.playerB + '</span><br/>'
      + '<span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/><br/>'

      + '<span class="f-title">SCENARIO 1 -- ' + sc1Lbl + '</span><br/>'
      + '→ P live A: <span class="f-good">' + (sc1.pLiveA*100).toFixed(0) + '%</span> (etait ' + d.pBaseA + '%)<br/>'
      + '→ Cote A attendue: ~' + coteA_sc1 + '<br/>'
      + '→ Edge si cote > ' + (d.coteA > 1 ? d.coteA.toFixed(2) : '--') + ': '
      + (d.coteA > 1 && kellyK1 ? '<span class="f-good">+' + (kellyK1.edge*100).toFixed(1) + '%</span>' : '--') + '<br/>'
      + '→ Mise: <span class="f-action">' + (kellyK1 && kellyK1.stakeReduced > 0 ? kellyK1.stakeReduced.toFixed(0) + ' EUR' : '--') + '</span><br/>'
      + '→ Declenchement: <span class="f-good">OUI si cote >= ' + (d.coteA > 1 ? d.coteA.toFixed(2) : '--') + '</span><br/><br/>'

      + '<span class="f-title">SCENARIO 2 -- ' + sc2Lbl + '</span><br/>'
      + '→ P live B: <span class="f-good">' + (sc2.pLiveB*100).toFixed(0) + '%</span><br/>'
      + '→ Cote B attendue: ~' + coteB_sc2 + '<br/>'
      + '→ Mise: <span class="f-action">' + (kellyK2 && kellyK2.stakeReduced > 0 ? kellyK2.stakeReduced.toFixed(0) + ' EUR' : '--') + '</span><br/>'
      + '→ Declenchement: <span class="f-good">OUI si signal confirme</span><br/><br/>'

      + '<span class="f-title">SCENARIO 3 -- ' + ctx.sc3Label + '</span><br/>'
      + '→ P live A: <span class="f-warn">' + (sc3.pLiveA*100).toFixed(0) + '%</span><br/>'
      + '→ ' + (ctx.sc3Extra || 'Marche: vainqueur du match') + '<br/>'
      + '→ Mise max: <span class="f-action">1% bankroll (' + (bankrollLive * 0.01).toFixed(0) + ' EUR)</span><br/><br/>'

      + '<span class="f-title">SCENARIO 4 -- ' + ctx.sc4Label + '</span><br/>'
      + '→ P live A apres signal: <span class="f-warn">' + (sc4.pLiveA*100).toFixed(0) + '%</span><br/>'
      + '→ Action: <span class="f-action">Parier sur ' + d.playerB + ' IMMEDIATEMENT</span><br/>'
      + '→ Cote cible: > 1.15 minimum<br/>'
      + '→ Delai max: <span class="f-warn">30 secondes</span><br/><br/>'

      + '<span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/>'
      + 'Budget live: <span class="f-action">' + bankrollLive.toFixed(0) + ' EUR</span> -- Regle -40% live active<br/>'
      + 'Max 2 paris simultanees -- Stop a 3 pertes live<br/>'
      + '<span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>'
      + '</div>';
  }

  function init() {
    // Coherence sport: adapter champs au sport selectionne
    const liveSportSel = document.getElementById('live-sport-select');
    if (liveSportSel) {
      liveSportSel.addEventListener('change', function() {
        updateLiveSportContext(this.value);
      });
      updateLiveSportContext(liveSportSel.value);
    }

    const signalMap = {
      'sig-kine':       'kineA',
      'sig-kineB':      'kineB',
      'sig-breakA':     'breakA',
      'sig-breakB':     'breakB',
      'sig-momentumA':  'momentumA',
      'sig-momentumB':  'momentumB',
      'sig-coteMove':   'coteMove',
      'sig-suspension': 'suspension',
      'sig-boiterie':   'boiterieA',
    };

    Object.entries(signalMap).forEach(function(e) {
      var btn = document.getElementById(e[0]);
      if (btn) btn.addEventListener('click', function() { toggleSignal(e[1], btn); });
    });

    document.getElementById('btn-calc-live').addEventListener('click', calcAndShowAlert);
    document.getElementById('btn-gen-fiche').addEventListener('click', generateFiche);
    document.getElementById('btn-live-setup').addEventListener('click', generateFiche);

    document.getElementById('btn-live-plus').addEventListener('click', function() {
      if (activeCount < 2) { activeCount++; updateActiveCount(); }
    });
    document.getElementById('btn-live-minus').addEventListener('click', function() {
      if (activeCount > 0) { activeCount--; updateActiveCount(); }
    });

    ['live-playerA','live-playerB','live-setsA','live-setsB','live-setNum','live-gamesA','live-gamesB'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function() { updateScoreDisplay(collectLiveData()); });
    });
  }

  function updateActiveCount() {
    var el = document.getElementById('live-active-count');
    el.textContent = activeCount;
    el.style.color = activeCount >= 2 ? 'var(--red)' : 'var(--text-primary)';
  }


  // ═══════════════════════════════════════════════════════════════════
  // CONTEXT FACTORS — modificateurs pBase selon état joueur/match
  // ═══════════════════════════════════════════════════════════════════
  const MENTAL_FACTORS = {
    optimal:   0,
    fatigue:   -0.05,   // -5% prob
    disturbed: -0.10,   // -10% (conflit perso, deuil proche)
    crisis:    -0.18,   // -18% (grave problème mental)
  };
  const PHYSICAL_FACTORS = {
    optimal:   0,
    sore:     -0.03,   // courbatures légères
    pain:     -0.08,   // douleur
    injury:   -0.15,   // blessure signalée
  };
  const SURFACE_FACTORS = {
    preferred: +0.04,  // surface de prédilection
    neutral:   0,
    weak:     -0.04,   // surface défavorable
  };
  const FATIGUE_FACTORS = {
    fresh:   +0.02,   // 4+ jours repos
    normal:   0,
    tired:   -0.04,   // 2 matchs en 3 jours
    exhausted: -0.08, // 3+ matchs en 4 jours
  };
  const ROUND_FACTORS = {
    early:    0,      // 1er/2e tour
    quarter: +0.01,  // QF — pression symétrique
    semi:    -0.02,  // demi: outsiders surprennent
    final:   -0.04,  // finale: pression maximale sur favori
  };
  const CYCLE_FACTOR = -0.04;  // facteur cycle féminin si activé
  const H2H_MAX      = 0.06;   // max ±6% selon H2H

  // État courant du contexte (A et B)
  let ctxA = { mental: 'optimal', physical: 'optimal', surface: 'neutral', fatigue: 'normal', cycle: false };
  let ctxB = { mental: 'optimal', physical: 'optimal', surface: 'neutral', fatigue: 'normal', cycle: false };
  let matchCtx = { round: 'early', h2hA: 0, h2hB: 0, weather: 'normal' };

  // Calcule le delta pBase ajusté selon contexte
  function computeContextDelta(ctx, isA) {
    const sv    = (document.getElementById('live-sport') || {}).value || '';
    const grp   = getSportGroup(sv);
    const isTennis = (grp === 'tennis');
    const isWTA    = isTennis && (sv.indexOf('wta') >= 0 || sv.indexOf('womens') >= 0);
    let delta = 0;
    delta += MENTAL_FACTORS[ctx.mental]    || 0;
    delta += PHYSICAL_FACTORS[ctx.physical] || 0;
    if (isTennis) delta += SURFACE_FACTORS[ctx.surface] || 0;  // surface pertinente seulement au tennis
    delta += FATIGUE_FACTORS[ctx.fatigue]  || 0;
    if (ctx.cycle && isWTA) delta += CYCLE_FACTOR;  // cycle féminin WTA uniquement
    if (isA) delta += matchCtx.h2hA || 0;
    else     delta += matchCtx.h2hB || 0;
    delta += ROUND_FACTORS[matchCtx.round] || 0;
    // Facteurs sport-spécifiques
    delta += sportSpecificDelta(ctx, grp, isA);
    return delta;
  }

  function sportSpecificDelta(ctx, group, isA) {
    let d = 0;
    if (group === 'tennis') {
      // Traitement médical en cours (ex: Sinner) → perturbation mentale/physique
      if (ctx.medicalTreatment === 'minor') d -= 0.02;
      if (ctx.medicalTreatment === 'suspension_risk') d -= 0.05;
      if (ctx.medicalTreatment === 'recovering') d -= 0.03;
      // Zone de blessure
      if (ctx.injuryZone === 'wrist') d -= 0.06;
      if (ctx.injuryZone === 'shoulder') d -= 0.07;
      if (ctx.injuryZone === 'ankle') d -= 0.05;
      if (ctx.injuryZone === 'back') d -= 0.08;
    }
    if (group === 'football') {
      // Joueur clé absent
      if (ctx.keyPlayerOut === 'striker') d -= 0.04;
      if (ctx.keyPlayerOut === 'goalkeeper') d -= 0.05;
      if (ctx.keyPlayerOut === 'multiple') d -= 0.08;
      // Cartons jaunes accumulés (pression)
      if (ctx.yellowCards === 'oneaway') d -= 0.02;
      if (ctx.yellowCards === 'suspended_next') d -= 0.01;
    }
    if (group === 'basketball') {
      if (ctx.backToBack === 'yes') d -= 0.04;
      if (ctx.starInjury === 'yes') d -= 0.06;
    }
    if (group === 'mma') {
      if (ctx.weightCut === 'hard') d -= 0.06;
      if (ctx.weightCut === 'extreme') d -= 0.10;
    }
    return d;
  }

  // Retourne pBase ajusté pour joueur A (en %)
  function getAdjustedPBase() {
    const rawPct = parseFloat(document.getElementById('live-pbaseA').value) || 50;
    const raw    = rawPct / 100;
    const deltaA = computeContextDelta(ctxA, true);
    const deltaB = computeContextDelta(ctxB, false);
    // deltaB négatif pour B → positif pour A
    const adjusted = Math.max(0.02, Math.min(0.98, raw + deltaA - deltaB));
    return adjusted * 100;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTO-DÉTECTION ESPN
  // ═══════════════════════════════════════════════════════════════════
  let _autoTimer    = null;
  let _autoMatch    = null;
  let _autoEnabled  = false;
  let _autoCount    = 0;

  async function detectAndApplySignals() {
    if (!_autoMatch) return;
    const { home, away, sport } = _autoMatch;

    try {
      const r = await fetch(
        '/api/live-signals?sport=' + encodeURIComponent(sport)
        + '&home=' + encodeURIComponent(home)
        + '&away=' + encodeURIComponent(away)
      );
      const data = await r.json();
      _autoCount++;

      const statusEl = document.getElementById('auto-detect-status');

      if (!data.found) {
        if (statusEl) statusEl.textContent = '⊕ Scan #' + _autoCount + ' — match non trouvé en live ESPN';
        return;
      }

      // Apply detected signals (only activate, never deactivate manually-set ones)
      const s = data.signals || {};
      const sigMap = {
        kineA: 'sig-kine', kineB: 'sig-kineB',
        breakA: 'sig-breakA', breakB: 'sig-breakB',
        momentumA: 'sig-momentumA', momentumB: 'sig-momentumB',
        suspension: 'sig-suspension', boiterieA: 'sig-boiterie',
      };
      let newSignals = false;
      Object.entries(sigMap).forEach(function(e) {
        const key = e[0], btnId = e[1];
        if (s[key] && !activeSignals[key]) {
          activeSignals[key] = true;
          newSignals = true;
          var btn = document.getElementById(btnId);
          if (btn) btn.classList.add('active');
        }
      });

      // Auto-update score from ESPN
      if (data.score) {
        const sportGrp = getSportGroup(sport);
        const ctx = SPORT_CTX[sportGrp] || SPORT_CTX.tennis;
        if (ctx.setsRowVisible && data.sets && data.sets.length) {
          // Tennis/hockey/baseball: use linescores for sets
          const lastSet = data.sets[data.sets.length - 1];
          setIfEmpty('live-setsA',  String(data.score.home));
          setIfEmpty('live-setsB',  String(data.score.away));
          setIfEmpty('live-setNum', String(data.period));
          setIfEmpty('live-gamesA', String(lastSet.home));
          setIfEmpty('live-gamesB', String(lastSet.away));
        } else {
          // Football/MMA: direct score
          setIfEmpty('live-gamesA', String(data.score.home));
          setIfEmpty('live-gamesB', String(data.score.away));
        }
        if (data.clock) {
          const mins = parseInt(data.clock);
          if (!isNaN(mins)) setIfEmpty('live-minutes', String(mins));
        }
      }

      // Show real-time stats if available
      renderAutoStats(data);

      // Auto-calculate if any signal is now active
      if (newSignals) {
        calcAndShowAlert();
        if (statusEl) {
          statusEl.innerHTML = '<span style="color:var(--green)">⚡ Signal détecté automatiquement — alerte recalculée</span>';
        }
      } else {
        if (statusEl) {
          statusEl.textContent = '✓ Scan #' + _autoCount + ' — ' + (data.clock ? data.clock + "'" : 'live') + ' | Score ESPN: ' + data.score.home + '-' + data.score.away;
        }
      }

    } catch (err) {
      console.warn('[AutoDetect]', err.message);
    }
  }

  function setIfEmpty(id, val) {
    var el = document.getElementById(id);
    if (el && !el.value) el.value = val;
  }

  function renderAutoStats(data) {
    const el = document.getElementById('espn-stats-row');
    if (!el) return;
    const sA = data.statsA || {}, sB = data.statsB || {};
    var parts = [];
    if (sA.aces || sB.aces)           parts.push('Aces: ' + (sA.aces||'—') + ' / ' + (sB.aces||'—'));
    if (sA.doubleFaults || sB.doubleFaults) parts.push('DFautes: ' + (sA.doubleFaults||'—') + ' / ' + (sB.doubleFaults||'—'));
    if (sA.possession || sB.possession)   parts.push('Poss.: ' + (sA.possession||'—') + '% / ' + (sB.possession||'—') + '%');
    if (sA.shots || sB.shots)         parts.push('Tirs: ' + (sA.shots||'—') + ' / ' + (sB.shots||'—'));
    el.textContent = parts.join('  ·  ');
  }

  function startAutoDetection(home, away, sport) {
    _autoMatch   = { home, away, sport };
    _autoEnabled = true;
    _autoCount   = 0;
    stopAutoDetection();
    detectAndApplySignals();
    _autoTimer = setInterval(detectAndApplySignals, 30000);
    var statusEl = document.getElementById('auto-detect-status');
    if (statusEl) statusEl.textContent = '⊕ Auto-détection ESPN activée — refresh 30s';
  }

  function stopAutoDetection() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    _autoEnabled = false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PLAYER FORM — chargement TheSportsDB
  // ═══════════════════════════════════════════════════════════════════
  async function loadPlayerForm(name, side) {
    if (!name || name.length < 3) return;
    const el = document.getElementById('player-ctx-' + side);
    if (!el) return;
    el.innerHTML = '<span style="color:var(--text-muted);font-size:.75rem">Chargement...</span>';

    try {
      const r = await fetch('/api/player-form?name=' + encodeURIComponent(name));
      const d = await r.json();
      if (!d.found) { el.innerHTML = '<span style="color:var(--text-muted);font-size:.75rem">Pas de données TheSportsDB</span>'; return; }

      const formBadges = (d.form || []).map(function(f) {
        return '<span class="form-badge fb-' + f.result + '" title="' + (f.opponent||'') + ' (' + (f.score||'') + ')">' + f.result + '</span>';
      }).join('');

      const streakStr = d.streak > 0
        ? '<span style="color:var(--green)">🔥 ' + d.streak + 'V</span>'
        : d.streak < 0
        ? '<span style="color:var(--red)">❄️ ' + Math.abs(d.streak) + 'D</span>'
        : '';

      const formPctColor = d.formPct >= 60 ? 'var(--green)' : d.formPct >= 40 ? 'var(--yellow)' : 'var(--red)';

      el.innerHTML =
        '<div class="player-ctx-name">' + d.name + (d.nationality ? ' <span class="player-ctx-nat">' + d.nationality + '</span>' : '') + '</div>'
        + '<div class="player-ctx-form-row">'
        + '<span class="player-ctx-form-pct" style="color:' + formPctColor + '">' + (d.formPct !== null ? d.formPct + '%' : '—') + '</span>'
        + '<span class="player-ctx-badges">' + formBadges + '</span>'
        + streakStr
        + '</div>'
        + '<div class="player-ctx-record">' + d.wins + 'V / ' + d.losses + 'D (5 derniers)</div>';

    } catch (err) {
      el.innerHTML = '<span style="color:var(--red);font-size:.75rem">Erreur: ' + err.message + '</span>';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // UPDATE CONTEXT depuis les selecteurs HTML
  // ═══════════════════════════════════════════════════════════════════
  function updateContext() {
    ctxA.mental   = (document.getElementById('ctx-a-mental')   || {}).value || 'optimal';
    ctxA.physical = (document.getElementById('ctx-a-physical') || {}).value || 'optimal';
    ctxA.surface  = (document.getElementById('ctx-a-surface')  || {}).value || 'neutral';
    ctxA.fatigue  = (document.getElementById('ctx-a-fatigue')  || {}).value || 'normal';
    ctxA.cycle    = !!(document.getElementById('ctx-a-cycle')  || {}).checked;
    // Sport-specific
    ctxA.medicalTreatment = (document.getElementById('ctx-a-medical')     || {}).value || 'none';
    ctxA.injuryZone       = (document.getElementById('ctx-a-injury-zone') || {}).value || 'none';
    ctxA.keyPlayerOut     = (document.getElementById('ctx-a-key-player')  || {}).value || 'none';
    ctxA.yellowCards      = (document.getElementById('ctx-a-yellows')     || {}).value || 'none';
    ctxA.backToBack       = (document.getElementById('ctx-a-b2b')         || {}).value || 'no';
    ctxA.starInjury       = (document.getElementById('ctx-a-star-injury') || {}).value || 'no';
    ctxA.weightCut        = (document.getElementById('ctx-a-weight-cut')  || {}).value || 'normal';

    ctxB.mental   = (document.getElementById('ctx-b-mental')   || {}).value || 'optimal';
    ctxB.physical = (document.getElementById('ctx-b-physical') || {}).value || 'optimal';
    ctxB.surface  = (document.getElementById('ctx-b-surface')  || {}).value || 'neutral';
    ctxB.fatigue  = (document.getElementById('ctx-b-fatigue')  || {}).value || 'normal';
    ctxB.cycle    = !!(document.getElementById('ctx-b-cycle')  || {}).checked;
    // Sport-specific
    ctxB.medicalTreatment = (document.getElementById('ctx-b-medical')     || {}).value || 'none';
    ctxB.injuryZone       = (document.getElementById('ctx-b-injury-zone') || {}).value || 'none';
    ctxB.keyPlayerOut     = (document.getElementById('ctx-b-key-player')  || {}).value || 'none';
    ctxB.yellowCards      = (document.getElementById('ctx-b-yellows')     || {}).value || 'none';
    ctxB.backToBack       = (document.getElementById('ctx-b-b2b')         || {}).value || 'no';
    ctxB.starInjury       = (document.getElementById('ctx-b-star-injury') || {}).value || 'no';
    ctxB.weightCut        = (document.getElementById('ctx-b-weight-cut')  || {}).value || 'normal';

    matchCtx.round = (document.getElementById('ctx-match-round') || {}).value || 'early';
    const h2hRaw   = parseInt((document.getElementById('ctx-h2h-adv') || {}).value) || 0;
    matchCtx.h2hA  = h2hRaw * 0.01;  // +3 → +0.03 pBase pour A
    matchCtx.h2hB  = -h2hRaw * 0.01;

    // Recalcul pBase ajusté affiché
    const adjPct = getAdjustedPBase();
    const adjEl  = document.getElementById('ctx-adjusted-pbase');
    if (adjEl) {
      const raw    = parseFloat(document.getElementById('live-pbaseA').value) || 50;
      const diff   = Math.round((adjPct - raw) * 10) / 10;
      const sign   = diff >= 0 ? '+' : '';
      const color  = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text-muted)';
      adjEl.innerHTML = 'P base ajustée: <strong style="color:' + color + '">'
        + Math.round(adjPct) + '% (' + sign + diff + '%)</strong>';
    }
  }

  // Hook: quand match chargé depuis card-click, démarrer auto-détection
  function onMatchLoaded(home, away, sport) {
    _autoMatch = { home, away, sport };
    // Charger forme joueurs
    loadPlayerForm(home, 'A');
    loadPlayerForm(away, 'B');
    // Mettre à jour titres des panels
    var titleA = document.getElementById('ctx-a-title');
    var titleB = document.getElementById('ctx-b-title');
    if (titleA) titleA.textContent = home;
    if (titleB) titleB.textContent = away;
    // Démarrer auto-détection
    if (sport) startAutoDetection(home, away, sport);
    // Reset contexte
    updateContext();
  }


  return { init, updateSportContext: updateLiveSportContext, onMatchLoaded, updateContext, getAdjustedPBase };
})();
