/**
 * OddsOracle — Pré-Match Module
 * Analyse complète avant match avec calcul de value bet
 */

const PrematchModule = (() => {

  let lastAnalysis = null;

  // ── Markets definitions par sport
  const MARKETS = {
    tennis: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%'  },
      { label: 'Handicap sets -1.5',          cond: 'favori fort' },
      { label: 'Nombre total de sets (O/U)',   cond: 'selon équilibre' },
      { label: 'Vainqueur 1er set',           cond: 'si forme différenciée' },
      { label: 'Au moins un tie-break',       cond: 'si niveau proche' },
      { label: 'Perdant gagne un set',        cond: 'si outsider > 30%' },
    ],
    football: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Les deux équipes marquent',   cond: 'si attaques actives' },
      { label: 'Total buts (O/U 2.5)',        cond: 'selon tempo' },
      { label: 'Mi-temps / match double',    cond: 'si domination' },
    ],
    basketball: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Total points (O/U)',          cond: 'selon rythme' },
      { label: 'Handicap points',            cond: 'si niveau déséquilibré' },
      { label: 'Vainqueur Q1',              cond: 'si starter dominant' },
    ],
  };

  function collectFormData() {
    return {
      sport:      document.getElementById('pm-sport').value,
      tournament: document.getElementById('pm-tournament').value,
      surface:    document.getElementById('pm-surface').value,
      format:     document.getElementById('pm-format').value,
      playerA:    document.getElementById('pm-playerA').value || 'Joueur A',
      playerB:    document.getElementById('pm-playerB').value || 'Joueur B',
      eloA:       parseFloat(document.getElementById('pm-eloA').value),
      eloB:       parseFloat(document.getElementById('pm-eloB').value),
      formeA:     parseFloat(document.getElementById('pm-formeA').value),
      formeB:     parseFloat(document.getElementById('pm-formeB').value),
      matchesA:   parseInt(document.getElementById('pm-matchesA').value),
      matchesB:   parseInt(document.getElementById('pm-matchesB').value),
      coteA:      parseFloat(document.getElementById('pm-coteA').value),
      coteB:      parseFloat(document.getElementById('pm-coteB').value),
      h2hA:       parseInt(document.getElementById('pm-h2hA').value) || 0,
      h2hB:       parseInt(document.getElementById('pm-h2hB').value) || 0,
      h2hASurf:   parseInt(document.getElementById('pm-h2hA-surf').value) || 0,
      h2hBSurf:   parseInt(document.getElementById('pm-h2hB-surf').value) || 0,
      adjA:       parseFloat(document.getElementById('pm-adjA').value) || 0,
      adjB:       parseFloat(document.getElementById('pm-adjB').value) || 0,
      signals: {
        injuryA:        document.getElementById('sig-injuryA').checked,
        injuryB:        document.getElementById('sig-injuryB').checked,
        homeA:          document.getElementById('sig-homeA').checked,
        negativePressA: document.getElementById('sig-negativePressA').checked,
        nightSession:   document.getElementById('sig-nightSession').checked,
        steamMove:      document.getElementById('sig-steamMove').checked,
      }
    };
  }

  function edgeClass(edge) {
    if (edge == null) return 'edge-none';
    if (edge >= 0.10) return 'edge-strong';
    if (edge >= 0.05) return 'edge-value';
    if (edge >= 0)    return 'edge-none';
    return 'edge-negative';
  }

  function edgeLabel(edge) {
    if (edge == null) return '— Cotes non renseignées';
    const pct = (edge * 100).toFixed(1);
    if (edge >= 0.10) return `🔥 STRONG VALUE BET · Edge +${pct}%`;
    if (edge >= 0.05) return `✅ VALUE BET · Edge +${pct}%`;
    if (edge >= 0)    return `Edge +${pct}% (sous le seuil)`;
    return `❌ Pas de value · Edge ${pct}%`;
  }

  function stakeRecommendation(edge, pReal, cote, sport) {
    if (edge == null || edge < 0.05) return null;
    const alloc = BankrollManager.getAllocation();
    const bankrollPM = alloc.prematch;
    const k = OddsModels.kellyStake(pReal, cote, bankrollPM, 'prematch');
    if (k.stake <= 0) return null;

    const category = edge >= 0.10 ? 'A (Strong · max 8% bankroll)' : 'B (Value · max 4% bankroll)';
    const maxPct   = edge >= 0.10 ? 0.08 : 0.04;
    const maxStake = alloc.total * maxPct;
    const recommended = Math.min(k.stake, maxStake);

    return {
      category, maxStake, recommended,
      kelly: k.kelly,
      potential: recommended * (cote - 1)
    };
  }

  function renderResult(data, result) {
    const { playerA, playerB, sport, tournament, coteA, coteB, format } = data;
    const { pA, pB, edgeA, edgeB, pImplA, pImplB, overround, adjustments } = result;
    const markets = MARKETS[sport] || MARKETS.tennis;

    const stakeA = stakeRecommendation(edgeA, pA, coteA, sport);
    const stakeB = stakeRecommendation(edgeB, pB, coteB, sport);

    const fmtPct = (v) => v != null ? (v * 100).toFixed(1) + '%' : '—';
    const fmtAdj = (v) => v > 0 ? `+${(v*100).toFixed(1)}%` : `${(v*100).toFixed(1)}%`;

    // Determine main recommendation
    let mainRec = null;
    if (edgeA >= 0.05 && (edgeA >= (edgeB || 0))) mainRec = { player: playerA, edge: edgeA, prob: pA, cote: coteA, stake: stakeA };
    else if (edgeB >= 0.05) mainRec = { player: playerB, edge: edgeB, prob: pB, cote: coteB, stake: stakeB };

    const container = document.getElementById('prematch-result');

    container.innerHTML = `
      <div class="analysis-output">

        <!-- Header -->
        <div class="analysis-block">
          <div class="analysis-title">🎯 Analyse Pré-Match</div>
          <div style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:0.35rem">
            ${playerA} <span style="color:var(--text-muted)">vs</span> ${playerB}
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${tournament || '—'} · ${formatLabel(format)} · ${surfaceLabel(data.surface)}</div>
        </div>

        <!-- Probabilités -->
        <div class="analysis-block">
          <div class="analysis-title">📈 Probabilités</div>
          <div class="prob-bars">
            <div class="prob-bar-wrap">
              <div class="prob-bar-label">
                <span style="color:var(--accent);font-weight:600">${playerA}</span>
                <span style="color:var(--text-primary);font-weight:700">${fmtPct(pA)}</span>
              </div>
              <div class="prob-bar-track">
                <div class="prob-bar-fill bar-a" style="width:${(pA*100).toFixed(0)}%"></div>
              </div>
            </div>
            <div class="prob-bar-wrap">
              <div class="prob-bar-label">
                <span style="color:var(--orange);font-weight:600">${playerB}</span>
                <span style="color:var(--text-primary);font-weight:700">${fmtPct(pB)}</span>
              </div>
              <div class="prob-bar-track">
                <div class="prob-bar-fill bar-b" style="width:${(pB*100).toFixed(0)}%"></div>
              </div>
            </div>
          </div>
          ${pImplA != null ? `
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem">
            Prob. implicite: ${playerA} ${fmtPct(pImplA)} · ${playerB} ${fmtPct(pImplB)} · Marge: ${((overround-1)*100).toFixed(1)}%
          </div>` : ''}
        </div>

        <!-- Ajustements -->
        <div class="analysis-block">
          <div class="analysis-title">🔧 Décomposition des Ajustements</div>
          <table class="markets-table">
            <thead><tr><th>Facteur</th><th>Impact sur A</th></tr></thead>
            <tbody>
              <tr><td>Classement Elo (prior)</td><td style="color:var(--text-primary)">${fmtPct(OddsModels.eloProb(data.eloA, data.eloB))} → base</td></tr>
              <tr><td>Forme A/B</td><td style="color:${adjColor(adjustments.dFormeA - adjustments.dFormeB)}">${fmtAdj(adjustments.dFormeA - adjustments.dFormeB)}</td></tr>
              <tr><td>Fatigue A/B</td><td style="color:${adjColor(adjustments.dFatigueA - adjustments.dFatigueB)}">${fmtAdj(adjustments.dFatigueA - adjustments.dFatigueB)}</td></tr>
              <tr><td>H2H (global + surface)</td><td style="color:${adjColor(adjustments.dH2H)}">${fmtAdj(adjustments.dH2H)}</td></tr>
              <tr><td>Signaux contextuels</td><td style="color:${adjColor(adjustments.dSigA - adjustments.dSigB)}">${fmtAdj(adjustments.dSigA - adjustments.dSigB)}</td></tr>
              ${(adjustments.manualA || adjustments.manualB) ? `<tr><td>Ajustement manuel</td><td style="color:${adjColor(adjustments.manualA - adjustments.manualB)}">${fmtAdj(adjustments.manualA - adjustments.manualB)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>

        <!-- Edge -->
        <div class="analysis-block">
          <div class="analysis-title">💎 Analyse de Value</div>
          <div style="margin:0.5rem 0">
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem">${playerA}</div>
            <span class="edge-tag ${edgeClass(edgeA)}">${edgeLabel(edgeA)}</span>
          </div>
          <div style="margin:0.5rem 0">
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem">${playerB}</div>
            <span class="edge-tag ${edgeClass(edgeB)}">${edgeLabel(edgeB)}</span>
          </div>
        </div>

        <!-- Marchés à analyser -->
        <div class="analysis-block">
          <div class="analysis-title">📊 Marchés Recommandés</div>
          <table class="markets-table">
            <thead><tr><th>Marché</th><th>Condition</th></tr></thead>
            <tbody>
              ${markets.map(m => `<tr><td>${m.label}</td><td>${m.cond}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <!-- Recommandation principale -->
        ${mainRec ? `
        <div class="recommend-block">
          <div class="rec-title">⚡ ACTION RECOMMANDÉE</div>
          <div class="rec-detail">
            <strong>Pari:</strong> ${mainRec.player} vainqueur du match<br/>
            <strong>Catégorie:</strong> ${mainRec.stake?.category || '—'}<br/>
            <strong>Cote:</strong> ${mainRec.cote} · <strong>P. réelle:</strong> ${fmtPct(mainRec.prob)}<br/>
            <strong>Mise recommandée:</strong> ${mainRec.stake ? mainRec.stake.recommended.toFixed(0) + ' €' : '— (bankroll non configurée)'}<br/>
            ${mainRec.stake ? `<strong>Gain potentiel:</strong> +${mainRec.stake.potential.toFixed(0)} €` : ''}
          </div>
        </div>` : `
        <div class="analysis-block" style="border-color:var(--red)">
          <div style="color:var(--red);font-weight:600;font-size:0.82rem">⛔ Pas de value bet détectée — Ne pas parier sur ce match</div>
        </div>`}

      </div>
    `;

    lastAnalysis = { data, result };
  }

  function formatLabel(fmt) {
    const m = { bo3: 'Best-of-3', bo5: 'Best-of-5', '90': '2×45 min', '4q': '4 quarts' };
    return m[fmt] || fmt;
  }

  function surfaceLabel(surf) {
    const m = { clay: 'Terre battue', hard: 'Dur', grass: 'Gazon', indoor: 'Indoor', neutral: 'Neutre' };
    return m[surf] || surf;
  }

  function adjColor(v) {
    if (v > 0.01)  return 'var(--green)';
    if (v < -0.01) return 'var(--red)';
    return 'var(--text-secondary)';
  }

  function init() {
    document.getElementById('btn-analyze-prematch').addEventListener('click', () => {
      const data = collectFormData();

      // Validation minimale
      if (!data.eloA || !data.eloB) {
        alert('⚠️ Veuillez renseigner les classements Elo des deux joueurs.');
        return;
      }

      const result = OddsModels.prematchAnalysis(data);
      renderResult(data, result);
      lastAnalysis = { data, result };
    });

    document.getElementById('btn-new-analysis').addEventListener('click', () => {
      document.getElementById('prematch-result').innerHTML = `
        <div class="empty-state">
          <div style="font-size:3rem;margin-bottom:1rem">🔮</div>
          <div>Complétez le formulaire et lancez l'analyse pour voir les résultats.</div>
        </div>`;
    });
  }

  function getLastAnalysis() { return lastAnalysis; }

  return { init, getLastAnalysis };
})();
