/**
 * OddsOracle — Live Betting Module
 * Signaux en temps réel, recalcul probabiliste, alertes, fiche de déclenchement
 */

const LiveModule = (() => {

  // État des signaux actifs
  let activeSignals = {
    kineA: false, kineB: false,
    breakA: false, breakB: false,
    momentumA: false, momentumB: false,
    coteMove: false, suspension: false,
    boiterieA: false
  };

  let activeCount = 0;
  let countdownTimer = null;

  // ── Lire les données du match live
  function collectLiveData() {
    return {
      playerA:     document.getElementById('live-playerA').value || 'Joueur A',
      playerB:     document.getElementById('live-playerB').value || 'Joueur B',
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

  // ── Signal activé/désactivé au clic
  function toggleSignal(signalKey, btn) {
    activeSignals[signalKey] = !activeSignals[signalKey];
    btn.classList.toggle('active', activeSignals[signalKey]);
  }

  // ── Formatage du score
  function formatScore(d) {
    const sets = `${d.setsA}-${d.setsB}`;
    const games = `${d.gamesA}-${d.gamesB}`;
    return `${sets} (Set ${d.setNum}: ${games})`;
  }

  // ── Calculer et afficher l'alerte live
  function calcAndShowAlert() {
    const d = collectLiveData();

    // Recalcul probabiliste
    const result = OddsModels.liveRecalc({
      pBase:        d.pBaseA / 100,
      setsA:        d.setsA,
      setsB:        d.setsB,
      gamesA:       d.gamesA,
      gamesB:       d.gamesB,
      minutesPlayed: d.minutesPlayed,
      tiebreaksPlayed: 0,
      signals:      activeSignals,
    });

    const { pLiveA, pLiveB, factors } = result;

    // Déterminer le signal principal
    const signalType = detectSignalType();

    // Calcul des edges
    let edgeA = null, edgeB = null;
    let stakeA = null, stakeB = null;
    const alloc = BankrollManager.getAllocation();
    const bankrollLive = alloc.live;

    if (d.coteA > 1) {
      edgeA = pLiveA - (1 / d.coteA);
    }
    if (d.coteB > 1) {
      edgeB = pLiveB - (1 / d.coteB);
    }

    // Trouver la meilleure opportunité
    let bestPlayer = null, bestEdge = null, bestCote = null, bestProb = null;
    const minEdge = BankrollManager.getConfig().edgeMinLive / 100;

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

    // ── Construire l'alerte
    const score = formatScore(d);
    const dt    = new Date().toLocaleTimeString('fr-FR');
    const cfg   = BankrollManager.getConfig();

    const output = document.getElementById('live-alert-output');

    const edgePct = (e) => e != null ? `${(e*100).toFixed(1)}%` : '—';
    const fmtPct  = (p) => `${(p*100).toFixed(0)}%`;

    const isValue  = bestEdge != null && bestEdge > 0;
    const isStrong = bestEdge != null && bestEdge > 0.10;

    let actionHTML = '';
    if (bestPlayer && stakeRec) {
      const stakeFmt = stakeRec.stakeReduced > 0 ? stakeRec.stakeReduced.toFixed(0) + ' €' : '< 1 €';
      actionHTML = `
        <div class="live-action-block ${isStrong ? 'action-strong' : 'action-value'}">
          <div class="act-label">⚡ ACTION — 10s MAX</div>
          <div class="act-row"><span>Pari:</span><strong>${bestPlayer} · Vainqueur</strong></div>
          <div class="act-row"><span>Cote min.:</span><strong>${bestCote.toFixed(2)}</strong></div>
          <div class="act-row"><span>Edge:</span><strong class="${bestEdge > 0.10 ? 'text-green' : 'text-cyan'}">${edgePct(bestEdge)}</strong></div>
          <div class="act-row"><span>Mise live (-40%):</span><strong style="color:var(--accent)">${stakeFmt}</strong></div>
          <div class="act-row"><span>Bankroll live:</span><strong>${bankrollLive > 0 ? bankrollLive.toFixed(0) + ' €' : 'Non configurée'}</strong></div>
          <div class="act-invalid">⚠️ Invalider si: cote descend en dessous de ${bestCote.toFixed(2)} ou signal annulé</div>
        </div>`;
    } else {
      actionHTML = `<div class="act-no-value">Aucune value détectée · Edge insuffisant (&lt; ${cfg.edgeMinLive}%)</div>`;
    }

    // Construire le signal text
    const signals = Object.entries({
      kineA:    activeSignals.kineA    ? '🚨 Appel kiné Joueur A' : null,
      kineB:    activeSignals.kineB    ? '🚨 Appel kiné Joueur B' : null,
      breakA:   activeSignals.breakA   ? '📍 Break Joueur A' : null,
      breakB:   activeSignals.breakB   ? '📍 Break Joueur B' : null,
      momentumA: activeSignals.momentumA ? '🔥 Momentum Joueur A' : null,
      momentumB: activeSignals.momentumB ? '🔥 Momentum Joueur B' : null,
      coteMove:  activeSignals.coteMove  ? '📈 Mouvement de cotes >15%' : null,
      suspension: activeSignals.suspension ? '⏸️ Cotes suspendues' : null,
      boiterieA: activeSignals.boiterieA  ? '🦵 Boiterie Joueur A' : null,
    }).filter(([,v]) => v !== null).map(([,v]) => v);

    output.innerHTML = `
      <div class="live-alert-box ${isStrong ? 'alert-box-strong' : isValue ? 'alert-box-value' : 'alert-box-neutral'}">
        <div class="alert-header">
          <span class="alert-sport">⚡ ALERTE LIVE · TENNIS</span>
          <span class="alert-time">${dt}</span>
        </div>
        <div class="alert-match">${d.playerA} vs ${d.playerB}</div>
        <div class="alert-score">Score: ${score}</div>
        <div class="alert-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

        <div class="alert-section">
          <div class="alert-section-title">🔴 SIGNAUX DÉTECTÉS</div>
          ${signals.length ? signals.map(s => `<div class="signal-item">${s}</div>`).join('') : '<div class="signal-item muted">Aucun signal actif</div>'}
        </div>

        <div class="alert-section">
          <div class="alert-section-title">📈 PROBABILITÉS LIVE</div>
          <div class="prob-live-row">
            <span>${d.playerA}</span>
            <div class="prob-live-bar">
              <div style="width:${(pLiveA*100).toFixed(0)}%;background:var(--accent)"></div>
            </div>
            <strong>${fmtPct(pLiveA)}</strong>
            <span class="edge-small ${edgeA != null && edgeA > 0.05 ? 'text-green' : 'text-muted'}">
              ${edgeA != null ? `Edge: ${edgePct(edgeA)}` : '—'}
            </span>
          </div>
          <div class="prob-live-row">
            <span>${d.playerB}</span>
            <div class="prob-live-bar">
              <div style="width:${(pLiveB*100).toFixed(0)}%;background:var(--orange)"></div>
            </div>
            <strong>${fmtPct(pLiveB)}</strong>
            <span class="edge-small ${edgeB != null && edgeB > 0.05 ? 'text-green' : 'text-muted'}">
              ${edgeB != null ? `Edge: ${edgePct(edgeB)}` : '—'}
            </span>
          </div>
          <div class="factors-mini">
            Score ×${factors.factorScore.toFixed(2)} ·
            Jeux ×${factors.factorGames.toFixed(2)} ·
            Momentum ×${factors.factorMomentum.toFixed(2)} ·
            Fatigue ×${factors.factorFatigue.toFixed(2)}
            ${factors.medFactor < 1 ? ` · <span style="color:var(--red)">Médical ×${factors.medFactor.toFixed(2)}</span>` : ''}
          </div>
        </div>

        ${actionHTML}
      </div>
    `;

    // Countdown si action recommandée
    if (bestPlayer) startCountdown();

    // Mise à jour de l'affichage du score
    updateScoreDisplay(d);
  }

  // ── Countdown 10 secondes
  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    const el = document.getElementById('countdown');
    const val = document.getElementById('countdown-val');
    el.style.display = 'inline-flex';
    let secs = 10;
    val.textContent = secs;

    countdownTimer = setInterval(() => {
      secs--;
      val.textContent = secs;
      if (secs <= 0) {
        clearInterval(countdownTimer);
        el.style.display = 'none';
      }
    }, 1000);
  }

  // ── Détecter le type de signal principal
  function detectSignalType() {
    if (activeSignals.kineA || activeSignals.kineB) return 'Blessure/Kiné';
    if (activeSignals.boiterieA) return 'Boiterie';
    if (activeSignals.breakA || activeSignals.breakB) return 'Break';
    if (activeSignals.momentumA || activeSignals.momentumB) return 'Momentum';
    if (activeSignals.coteMove || activeSignals.suspension) return 'Marché';
    return 'Général';
  }

  // ── Affichage du score en header
  function updateScoreDisplay(d) {
    document.getElementById('live-pA-name').textContent = d.playerA;
    document.getElementById('live-pB-name').textContent = d.playerB;
    document.getElementById('live-score-display').textContent = `${d.setsA} - ${d.setsB}`;
  }

  // ── Générer la fiche de déclenchement
  function generateFiche() {
    const d = collectLiveData();
    const pBaseA = d.pBaseA / 100;
    const pBaseB = 1 - pBaseA;
    const alloc = BankrollManager.getAllocation();
    const bankrollLive = alloc.live;

    // Scénario 1: Joueur A perd le 1er set
    const sc1 = OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 1, gamesA: 0, gamesB: 0, minutesPlayed: 30 });
    const coteA_sc1 = d.coteA > 1 ? (1 / sc1.pLiveA).toFixed(2) : '—';

    // Scénario 2: Joueur B perd le 1er set
    const sc2 = OddsModels.liveRecalc({ pBase: pBaseA, setsA: 1, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 30 });
    const coteB_sc2 = d.coteB > 1 ? (1 / sc2.pLiveB).toFixed(2) : '—';

    // Scénario 3: Tie-break
    const sc3 = OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 6, gamesB: 6, minutesPlayed: 45 });

    // Scénario 4: Blessure
    const sc4 = OddsModels.liveRecalc({ pBase: pBaseA, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, minutesPlayed: 0, signals: { kineA: true } });

    const kellyK1 = d.coteA > 1 ? OddsModels.kellyLive(sc1.pLiveA, d.coteA, bankrollLive) : null;
    const kellyK2 = d.coteB > 1 ? OddsModels.kellyLive(sc2.pLiveB, d.coteB, bankrollLive) : null;

    const ficheOutput = document.getElementById('live-fiche-output');
    ficheOutput.innerHTML = `
      <div class="fiche-output">
        <span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/>
        <span class="f-title">  FICHE LIVE — ${d.playerA} vs ${d.playerB}</span><br/>
        <span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/><br/>

        <span class="f-title">SCÉNARIO 1 — ${d.playerA} perd le 1er set</span><br/>
        → P live A après 0-1: <span class="f-good">${(sc1.pLiveA*100).toFixed(0)}%</span> (était ${d.pBaseA}%)<br/>
        → Cote A attendue: ~${coteA_sc1}<br/>
        → Edge estimé si cote &gt; ${d.coteA > 1 ? d.coteA.toFixed(2) : '—'}: ${d.coteA > 1 && kellyK1 ? '<span class="f-good">+' + (kellyK1.edge*100).toFixed(1) + '%</span>' : '—'}<br/>
        → Mise recommandée: <span class="f-action">${kellyK1 && kellyK1.stakeReduced > 0 ? kellyK1.stakeReduced.toFixed(0) + ' €' : '—'}</span><br/>
        → Déclenchement: <span class="f-good">OUI si cote ≥ ${d.coteA > 1 ? d.coteA.toFixed(2) : '—'}</span><br/><br/>

        <span class="f-title">SCÉNARIO 2 — ${d.playerB} perd le 1er set</span><br/>
        → P live B après 1-0: <span class="f-good">${(sc2.pLiveB*100).toFixed(0)}%</span><br/>
        → Cote B attendue: ~${coteB_sc2}<br/>
        → Mise recommandée: <span class="f-action">${kellyK2 && kellyK2.stakeReduced > 0 ? kellyK2.stakeReduced.toFixed(0) + ' €' : '—'}</span><br/>
        → Déclenchement: <span class="f-good">OUI si pattern de jeu confirme</span><br/><br/>

        <span class="f-title">SCÉNARIO 3 — Tie-break au 1er set</span><br/>
        → P live A en TB: <span class="f-warn">${(sc3.pLiveA*100).toFixed(0)}%</span><br/>
        → Marché: vainqueur du tie-break<br/>
        → Mise: <span class="f-action">1% bankroll live max</span> (= ${(bankrollLive * 0.01).toFixed(0)} €)<br/><br/>

        <span class="f-title">SCÉNARIO 4 — Appel kiné ou blessure visible</span><br/>
        → P live A après kiné: <span class="f-warn">${(sc4.pLiveA*100).toFixed(0)}%</span> (correction -30%)<br/>
        → Action: <span class="f-action">Parier sur ${d.playerB} IMMÉDIATEMENT</span><br/>
        → Cote cible: &gt; 1.15 minimum<br/>
        → Délai: <span class="f-warn">30 secondes maximum</span><br/><br/>

        <span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span><br/>
        Budget live disponible: <span class="f-action">${bankrollLive.toFixed(0)} €</span><br/>
        Règle −40% live: toutes mises réduites<br/>
        Max 2 paris simultanés · Stop à 3 pertes live<br/>
        <span class="f-sep">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>
      </div>
    `;
  }

  function init() {
    // Boutons signal
    const signalMap = {
      'sig-kine':      'kineA',
      'sig-kineB':     'kineB',
      'sig-breakA':    'breakA',
      'sig-breakB':    'breakB',
      'sig-momentumA': 'momentumA',
      'sig-momentumB': 'momentumB',
      'sig-coteMove':  'coteMove',
      'sig-suspension':'suspension',
      'sig-boiterie':  'boiterieA',
    };

    Object.entries(signalMap).forEach(([id, key]) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', () => {
          toggleSignal(key, btn);
        });
      }
    });

    // Bouton calcul alerte
    document.getElementById('btn-calc-live').addEventListener('click', calcAndShowAlert);

    // Générer fiche
    document.getElementById('btn-gen-fiche').addEventListener('click', generateFiche);
    document.getElementById('btn-live-setup').addEventListener('click', generateFiche);

    // Compteur paris actifs
    document.getElementById('btn-live-plus').addEventListener('click', () => {
      if (activeCount < 2) {
        activeCount++;
        updateActiveCount();
      }
    });

    document.getElementById('btn-live-minus').addEventListener('click', () => {
      if (activeCount > 0) {
        activeCount--;
        updateActiveCount();
      }
    });

    // Update score display on input changes
    ['live-playerA','live-playerB','live-setsA','live-setsB','live-setNum','live-gamesA','live-gamesB'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        const d = collectLiveData();
        updateScoreDisplay(d);
      });
    });
  }

  function updateActiveCount() {
    const el = document.getElementById('live-active-count');
    el.textContent = activeCount;
    el.style.color = activeCount >= 2 ? 'var(--red)' : 'var(--text-primary)';
  }

  return { init };
})();
