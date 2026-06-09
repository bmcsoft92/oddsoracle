/**
 * OddsOracle -- Pre-Match Module
 * Analyse complete avant match avec calcul de value bet
 */

const PrematchModule = (() => {

  let lastAnalysis = null;

  // -- Markets definitions par sport
  const MARKETS = {
    tennis: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%'  },
      { label: 'Handicap sets -1.5',          cond: 'favori fort' },
      { label: 'Nombre total de sets (O/U)',   cond: 'selon equilibre' },
      { label: 'Vainqueur 1er set',           cond: 'si forme differenciee' },
      { label: 'Au moins un tie-break',       cond: 'si niveau proche' },
      { label: 'Perdant gagne un set',        cond: 'si outsider > 30%' },
    ],
    football: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Les deux equipes marquent',   cond: 'si attaques actives' },
      { label: 'Total buts (O/U 2.5)',        cond: 'selon tempo' },
      { label: 'Mi-temps / match double',    cond: 'si domination' },
    ],
    basketball: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Total points (O/U)',          cond: 'selon rythme' },
      { label: 'Handicap points',            cond: 'si niveau desequilibre' },
      { label: 'Vainqueur Q1',              cond: 'si starter dominant' },
    ],
    hockey: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Total buts (O/U 5.5)',        cond: 'selon attaques' },
      { label: 'Vainqueur P1',              cond: 'si depart rapide' },
    ],
    baseball: [
      { label: 'Vainqueur du match',         cond: 'edge > 5%' },
      { label: 'Total runs (O/U 8.5)',        cond: 'selon pitchers' },
      { label: 'Vainqueur 1ere manche',      cond: 'si pitcher dominant' },
    ],
    mma: [
      { label: 'Vainqueur du combat',        cond: 'edge > 5%' },
      { label: 'Method of victory',          cond: 'selon style' },
      { label: 'Distance / KO avant R3',     cond: 'selon historique' },
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
    if (edge == null) return '-- Cotes non renseignees';
    const pct = (edge * 100).toFixed(1);
    if (edge >= 0.10) return 'STRONG VALUE BET - Edge +' + pct + '%';
    if (edge >= 0.05) return 'VALUE BET - Edge +' + pct + '%';
    if (edge >= 0)    return 'Edge +' + pct + '% (sous le seuil)';
    return 'Pas de value - Edge ' + pct + '%';
  }

  function stakeRecommendation(edge, pReal, cote, sport) {
    if (edge == null || edge < 0.05) return null;
    const alloc = BankrollManager.getAllocation();
    const bankrollPM = alloc.prematch;
    const k = OddsModels.kellyStake(pReal, cote, bankrollPM, 'prematch');
    if (k.stake <= 0) return null;

    const category = edge >= 0.10 ? 'A (Strong - max 8% bankroll)' : 'B (Value - max 4% bankroll)';
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
    const sportGroup = getSportGroup(sport);
    const markets = MARKETS[sportGroup] || MARKETS.football;

    const stakeA = stakeRecommendation(edgeA, pA, coteA, sport);
    const stakeB = stakeRecommendation(edgeB, pB, coteB, sport);

    const fmtPct = function(v) { return v != null ? (v * 100).toFixed(1) + '%' : '--'; };
    const fmtAdj = function(v) { return v > 0 ? '+' + (v*100).toFixed(1) + '%' : (v*100).toFixed(1) + '%'; };

    let mainRec = null;
    if (edgeA >= 0.05 && (edgeA >= (edgeB || 0))) mainRec = { player: playerA, edge: edgeA, prob: pA, cote: coteA, stake: stakeA };
    else if (edgeB >= 0.05) mainRec = { player: playerB, edge: edgeB, prob: pB, cote: coteB, stake: stakeB };

    const container = document.getElementById('prematch-result');
    const surfLbl = surfaceLabel(data.surface, sportGroup);

    container.innerHTML = '<div class="analysis-output">'

      + '<div class="analysis-block">'
      + '<div class="analysis-title">Analyse Pre-Match</div>'
      + '<div style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:0.35rem">'
      + playerA + ' <span style="color:var(--text-muted)">vs</span> ' + playerB
      + '</div>'
      + '<div style="font-size:0.78rem;color:var(--text-muted)">'
      + (tournament || '--') + ' - ' + formatLabel(format) + (surfLbl ? ' - ' + surfLbl : '')
      + '</div>'
      + '</div>'

      + '<div class="analysis-block">'
      + '<div class="analysis-title">Probabilites</div>'
      + '<div class="prob-bars">'
      + '<div class="prob-bar-wrap">'
      + '<div class="prob-bar-label">'
      + '<span style="color:var(--accent);font-weight:600">' + playerA + '</span>'
      + '<span style="color:var(--text-primary);font-weight:700">' + fmtPct(pA) + '</span>'
      + '</div>'
      + '<div class="prob-bar-track"><div class="prob-bar-fill bar-a" style="width:' + (pA*100).toFixed(0) + '%"></div></div>'
      + '</div>'
      + '<div class="prob-bar-wrap">'
      + '<div class="prob-bar-label">'
      + '<span style="color:var(--orange);font-weight:600">' + playerB + '</span>'
      + '<span style="color:var(--text-primary);font-weight:700">' + fmtPct(pB) + '</span>'
      + '</div>'
      + '<div class="prob-bar-track"><div class="prob-bar-fill bar-b" style="width:' + (pB*100).toFixed(0) + '%"></div></div>'
      + '</div>'
      + '</div>'
      + (pImplA != null ? '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem">Prob. implicite: ' + playerA + ' ' + fmtPct(pImplA) + ' - ' + playerB + ' ' + fmtPct(pImplB) + ' - Marge: ' + ((overround-1)*100).toFixed(1) + '%</div>' : '')
      + '</div>'

      + '<div class="analysis-block">'
      + '<div class="analysis-title">Decomposition des Ajustements</div>'
      + '<table class="markets-table"><thead><tr><th>Facteur</th><th>Impact sur A</th></tr></thead><tbody>'
      + '<tr><td>Classement Elo (prior)</td><td style="color:var(--text-primary)">' + fmtPct(OddsModels.eloProb(data.eloA, data.eloB)) + ' base</td></tr>'
      + '<tr><td>Forme A/B</td><td style="color:' + adjColor(adjustments.dFormeA - adjustments.dFormeB) + '">' + fmtAdj(adjustments.dFormeA - adjustments.dFormeB) + '</td></tr>'
      + '<tr><td>Fatigue A/B</td><td style="color:' + adjColor(adjustments.dFatigueA - adjustments.dFatigueB) + '">' + fmtAdj(adjustments.dFatigueA - adjustments.dFatigueB) + '</td></tr>'
      + '<tr><td>H2H</td><td style="color:' + adjColor(adjustments.dH2H) + '">' + fmtAdj(adjustments.dH2H) + '</td></tr>'
      + '<tr><td>Signaux contextuels</td><td style="color:' + adjColor(adjustments.dSigA - adjustments.dSigB) + '">' + fmtAdj(adjustments.dSigA - adjustments.dSigB) + '</td></tr>'
      + ((adjustments.manualA || adjustments.manualB) ? '<tr><td>Ajustement manuel</td><td style="color:' + adjColor(adjustments.manualA - adjustments.manualB) + '">' + fmtAdj(adjustments.manualA - adjustments.manualB) + '</td></tr>' : '')
      + '</tbody></table>'
      + '</div>'

      + '<div class="analysis-block">'
      + '<div class="analysis-title">Analyse de Value</div>'
      + '<div style="margin:0.5rem 0"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem">' + playerA + '</div>'
      + '<span class="edge-tag ' + edgeClass(edgeA) + '">' + edgeLabel(edgeA) + '</span></div>'
      + '<div style="margin:0.5rem 0"><div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem">' + playerB + '</div>'
      + '<span class="edge-tag ' + edgeClass(edgeB) + '">' + edgeLabel(edgeB) + '</span></div>'
      + '</div>'

      + '<div class="analysis-block">'
      + '<div class="analysis-title">Marches Recommandes</div>'
      + '<table class="markets-table"><thead><tr><th>Marche</th><th>Condition</th></tr></thead><tbody>'
      + markets.map(function(m) { return '<tr><td>' + m.label + '</td><td>' + m.cond + '</td></tr>'; }).join('')
      + '</tbody></table>'
      + '</div>'

      + (mainRec ? '<div class="recommend-block">'
        + '<div class="rec-title">ACTION RECOMMANDEE</div>'
        + '<div class="rec-detail">'
        + '<strong>Pari:</strong> ' + mainRec.player + ' vainqueur<br/>'
        + '<strong>Categorie:</strong> ' + (mainRec.stake ? mainRec.stake.category : '--') + '<br/>'
        + '<strong>Cote:</strong> ' + mainRec.cote + ' - <strong>P. reelle:</strong> ' + fmtPct(mainRec.prob) + '<br/>'
        + '<strong>Mise recommandee:</strong> ' + (mainRec.stake ? mainRec.stake.recommended.toFixed(0) + ' EUR' : '-- (bankroll non configuree)') + '<br/>'
        + (mainRec.stake ? '<strong>Gain potentiel:</strong> +' + mainRec.stake.potential.toFixed(0) + ' EUR' : '')
        + '</div></div>'
        : '<div class="analysis-block" style="border-color:var(--red)"><div style="color:var(--red);font-weight:600;font-size:0.82rem">Pas de value bet detectee -- Ne pas parier sur ce match</div></div>')

      + '</div>';

    lastAnalysis = { data, result };
  }

  function formatLabel(fmt) {
    const m = { bo3: 'Best-of-3', bo5: 'Best-of-5', '90': '2x45 min', '4q': '4 quarts', '3p': '3 periodes', '9i': '9 manches', '3r': '3 rounds', '5r': '5 rounds' };
    return m[fmt] || fmt;
  }

  function surfaceLabel(surf, group) {
    if (group === 'tennis') {
      const m = { clay: 'Terre battue', hard: 'Dur', grass: 'Gazon', indoor: 'Indoor' };
      return m[surf] || surf;
    }
    return null; // pas de surface pour les autres sports
  }

  function adjColor(v) {
    if (v > 0.01)  return 'var(--green)';
    if (v < -0.01) return 'var(--red)';
    return 'var(--text-secondary)';
  }

  // Config coherence sport: Surface et Format adaptes au sport
  const SPORT_CONTEXT = {
    tennis: {
      surfaceLabel: 'Surface',
      surfaceOptions: [
        { v: 'clay',   l: 'Terre battue' },
        { v: 'hard',   l: 'Dur' },
        { v: 'grass',  l: 'Gazon' },
        { v: 'indoor', l: 'Indoor' },
      ],
      formatLabel: 'Format',
      formatOptions: [
        { v: 'bo3', l: 'Best-of-3' },
        { v: 'bo5', l: 'Best-of-5' },
      ],
      showSurface: true,
    },
    football: {
      formatLabel: 'Competition',
      formatOptions: [
        { v: '90',   l: '90 min (championnat)' },
        { v: '90et', l: '90 min + prolongations' },
      ],
      showSurface: false,
    },
    basketball: {
      formatLabel: 'Format',
      formatOptions: [
        { v: '4q',  l: '4 quarts (NBA)' },
        { v: '4qe', l: '4 quarts (Euro)' },
      ],
      showSurface: false,
    },
    hockey: {
      formatLabel: 'Format',
      formatOptions: [
        { v: '3p', l: '3 periodes' },
      ],
      showSurface: false,
    },
    baseball: {
      formatLabel: 'Format',
      formatOptions: [
        { v: '9i', l: '9 manches' },
        { v: '7i', l: '7 manches (DH)' },
      ],
      showSurface: false,
    },
    mma: {
      formatLabel: 'Format',
      formatOptions: [
        { v: '3r', l: '3 rounds' },
        { v: '5r', l: '5 rounds (title)' },
      ],
      showSurface: false,
    },
  };

  function getSportGroup(sport) {
    if (!sport) return 'tennis';
    if (sport.startsWith('tennis')) return 'tennis';
    if (sport.startsWith('soccer') || sport === 'football') return 'football';
    if (sport.startsWith('basketball')) return 'basketball';
    if (sport.startsWith('icehockey')) return 'hockey';
    if (sport.startsWith('baseball')) return 'baseball';
    if (sport.startsWith('mma') || sport.startsWith('americanfootball')) return 'mma';
    return 'football';
  }

  function updateSportContext(sportVal) {
    const group = getSportGroup(sportVal);
    const ctx = SPORT_CONTEXT[group] || SPORT_CONTEXT.football;

    const surfaceGroup = document.getElementById('pm-surface-group');
    const surfaceSel   = document.getElementById('pm-surface');
    const surfaceLbl   = document.getElementById('pm-surface-label');
    const formatSel    = document.getElementById('pm-format');
    const formatLbl    = document.getElementById('pm-format-label');

    if (surfaceGroup) surfaceGroup.style.display = ctx.showSurface ? '' : 'none';

    if (ctx.showSurface && surfaceSel && ctx.surfaceOptions) {
      if (surfaceLbl) surfaceLbl.textContent = ctx.surfaceLabel;
      surfaceSel.innerHTML = ctx.surfaceOptions.map(function(o) {
        return '<option value="' + o.v + '">' + o.l + '</option>';
      }).join('');
    }

    if (formatSel && ctx.formatOptions) {
      if (formatLbl) formatLbl.textContent = ctx.formatLabel;
      formatSel.innerHTML = ctx.formatOptions.map(function(o) {
        return '<option value="' + o.v + '">' + o.l + '</option>';
      }).join('');
    }
  }

  function init() {
    const sportSel = document.getElementById('pm-sport');
    if (sportSel) {
      sportSel.addEventListener('change', function() {
        updateSportContext(this.value);
      });
      updateSportContext(sportSel.value);
    }

    document.getElementById('btn-analyze-prematch').addEventListener('click', function() {
      const data = collectFormData();
      if (!data.eloA || !data.eloB) {
        alert('Veuillez renseigner les classements Elo des deux joueurs.');
        return;
      }
      const result = OddsModels.prematchAnalysis(data);
      renderResult(data, result);
      lastAnalysis = { data, result };
    });

    document.getElementById('btn-new-analysis').addEventListener('click', function() {
      document.getElementById('prematch-result').innerHTML =
        '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem">&#128302;</div>'
        + '<div>Completez le formulaire et lancez l\'analyse pour voir les resultats.</div></div>';
    });
  }

  function getLastAnalysis() { return lastAnalysis; }

  return { init, getLastAnalysis };
})();
