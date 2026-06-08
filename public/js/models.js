/**
 * OddsOracle — Models & Probability Engine
 * Calcul probabiliste pré-match et live
 */

const OddsModels = (() => {

  /**
   * Calcul Elo: probabilité de victoire basée sur classements Elo
   * Formule standard adaptée au tennis
   */
  function eloProb(eloA, eloB) {
    if (!eloA || !eloB) return 0.5;
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  }

  /**
   * Ajustement forme récente (0-10 → facteur multiplicatif)
   * Forme 5 = neutre, 10 = +10%, 0 = -10%
   */
  function formeAdjustment(forme) {
    if (forme == null || isNaN(forme)) return 0;
    return (forme - 5) * 0.02; // ±10% max
  }

  /**
   * Ajustement fatigue: nombre de matchs en 7 jours
   * 0-1 matchs: 0%, 2: -2%, 3: -5%, 4+: -10%
   */
  function fatigueAdjustment(matchesLast7) {
    const m = parseInt(matchesLast7) || 0;
    if (m <= 1) return 0;
    if (m === 2) return -0.02;
    if (m === 3) return -0.05;
    return -0.10;
  }

  /**
   * Ajustement H2H avec pondération temporelle
   * Retourne un delta de probabilité [-0.07, +0.07]
   */
  function h2hAdjustment(winsA, winsB, winsASurf, winsBSurf) {
    const total = (winsA + winsB) || 1;
    const totalSurf = (winsASurf + winsBSurf) || 0;

    // H2H global
    const h2hGlobal = (winsA / total) - 0.5;

    // H2H surface (poids plus élevé)
    let h2hSurf = 0;
    if (totalSurf > 0) {
      h2hSurf = (winsASurf / totalSurf) - 0.5;
    }

    // Pondération: 40% global, 60% surface si disponible
    let adj;
    if (totalSurf > 0) {
      adj = h2hGlobal * 0.4 + h2hSurf * 0.6;
    } else {
      adj = h2hGlobal;
    }

    // Clamp ±7%
    return Math.max(-0.07, Math.min(0.07, adj * 0.14));
  }

  /**
   * Signaux contextuels → ajustement delta probabilité
   */
  function signalsAdjustment(signals, side) {
    let delta = 0;

    if (side === 'A') {
      if (signals.injuryA)        delta -= 0.15;
      if (signals.homeA)          delta += 0.05;
      if (signals.negativePressA) delta -= 0.05;
      if (signals.steamMove)      delta += 0.04; // steam move = sharps sur A
    } else {
      if (signals.injuryB)        delta -= 0.15;
      if (signals.steamMove)      delta -= 0.04;
    }

    if (signals.nightSession) delta += 0; // neutre par défaut

    return delta;
  }

  /**
   * MODÈLE PRÉ-MATCH COMPLET
   * Retourne { pA, pB, edgeA, edgeB, pImplA, pImplB, overround }
   */
  function prematchAnalysis(data) {
    const {
      eloA, eloB, formeA, formeB,
      matchesA, matchesB,
      h2hA, h2hB, h2hASurf, h2hBSurf,
      coteA, coteB,
      signals,
      adjA, adjB, // manuels en %
    } = data;

    // ── Étape 1: Prior Elo
    let pA = eloProb(eloA, eloB);

    // ── Étape 2: Ajustements
    const dFormeA   = formeAdjustment(formeA);
    const dFormeB   = formeAdjustment(formeB);
    const dFatigueA = fatigueAdjustment(matchesA);
    const dFatigueB = fatigueAdjustment(matchesB);
    const dH2H      = h2hAdjustment(h2hA, h2hB, h2hASurf, h2hBSurf);
    const dSigA     = signalsAdjustment(signals, 'A');
    const dSigB     = signalsAdjustment(signals, 'B');

    const manualA = (parseFloat(adjA) || 0) / 100;
    const manualB = (parseFloat(adjB) || 0) / 100;

    // Delta total pour A
    const deltaA = dFormeA - dFormeB + dFatigueA - dFatigueB + dH2H + dSigA - dSigB + manualA - manualB;

    pA = Math.max(0.02, Math.min(0.98, pA + deltaA));
    const pB = 1 - pA;

    // ── Étape 3: Cotes marché → probabilité implicite
    let pImplA = null, pImplB = null, overround = null;
    if (coteA && coteB && coteA > 1 && coteB > 1) {
      const rawImplA = 1 / coteA;
      const rawImplB = 1 / coteB;
      overround = rawImplA + rawImplB;
      pImplA = rawImplA / overround; // corrigé
      pImplB = rawImplB / overround;
    }

    // ── Étape 4: Edge
    const edgeA = pImplA != null ? pA - pImplA : null;
    const edgeB = pImplB != null ? pB - pImplB : null;

    return {
      pA, pB, edgeA, edgeB,
      pImplA, pImplB, overround,
      adjustments: {
        dFormeA, dFormeB, dFatigueA, dFatigueB,
        dH2H, dSigA, dSigB, manualA, manualB
      }
    };
  }

  /**
   * MODÈLE LIVE — Recalcul après événement
   * data: { pBase, setsA, setsB, gamesA, gamesB, setNum, minutesPlayed, tiebreaksPlayed, signals }
   */
  function liveRecalc(data) {
    const {
      pBase = 0.5, // probabilité base pré-match pour A
      setsA = 0, setsB = 0,
      gamesA = 0, gamesB = 0,
      minutesPlayed = 0,
      tiebreaksPlayed = 0,
      signals = {} // { kineA, kineB, breakA, breakB, momentumA, momentumB, boiterieA }
    } = data;

    let pLive = pBase;

    // ── Facteur score (sets)
    const totalSets = setsA + setsB;
    let factorScore = 1.0;
    if (setsA > setsB) {
      if (setsA - setsB === 1) factorScore = 1.25;
      if (setsA - setsB === 2) factorScore = 1.65;
    } else if (setsB > setsA) {
      if (setsB - setsA === 1) factorScore = 0.80;
      if (setsB - setsA === 2) factorScore = 0.40;
    }
    // Sets égaux = neutre

    // ── Facteur jeux dans le set actuel
    let factorGames = 1.0;
    const gamesDiff = gamesA - gamesB;
    if (gamesDiff >= 2) factorGames = 1.10;
    else if (gamesDiff === 1) factorGames = 1.05;
    else if (gamesDiff === -1) factorGames = 0.95;
    else if (gamesDiff <= -2) factorGames = 0.90;

    // ── Facteur momentum (signaux)
    let factorMomentum = 1.0;
    if (signals.momentumA) factorMomentum *= 1.12;
    if (signals.breakA)    factorMomentum *= 1.18;
    if (signals.momentumB) factorMomentum *= 0.90;
    if (signals.breakB)    factorMomentum *= 0.85;

    // ── Facteur fatigue live
    let factorFatigue = 1.0;
    const longSets = Math.floor(minutesPlayed / 45);
    factorFatigue -= longSets * 0.03;
    factorFatigue -= tiebreaksPlayed * 0.02;
    if (totalSets >= 3) factorFatigue -= 0.08;
    factorFatigue = Math.max(0.70, factorFatigue);

    // ── Signaux médicaux (les plus forts)
    let medFactor = 1.0;
    if (signals.kineA)    medFactor *= 0.70; // -30% pour A
    if (signals.boiterieA) medFactor *= 0.65;

    // Appliquer
    pLive = pBase * factorScore * factorGames * factorMomentum * factorFatigue * medFactor;
    pLive = Math.max(0.03, Math.min(0.97, pLive));

    // Normaliser
    const pLiveB = 1 - pLive;

    return {
      pLiveA: pLive,
      pLiveB,
      factors: { factorScore, factorGames, factorMomentum, factorFatigue, medFactor }
    };
  }

  /**
   * KELLY CRITERION adapté
   * mode: 'prematch' → Kelly 1/4 | 'live' → Kelly 1/6
   */
  function kellyStake(pReal, cote, bankroll, mode = 'prematch') {
    const fraction = mode === 'live' ? 1/6 : 1/4;
    const b = cote - 1; // gain net par unité misée
    const q = 1 - pReal;

    const kelly = (pReal * b - q) / b;

    if (kelly <= 0) return { stake: 0, kelly, fraction, edge: pReal - (1/cote) };

    const stake = kelly * fraction * bankroll;
    const edge  = pReal - (1 / cote);

    return { stake: Math.max(0, stake), kelly, fraction, edge };
  }

  /**
   * Edge calculation avec correction pour la marge bookmaker
   */
  function calcEdge(pReal, cote1, cote2) {
    if (!cote1 || !cote2 || cote1 <= 1 || cote2 <= 1) return null;
    const rawImpl1 = 1 / cote1;
    const rawImpl2 = 1 / cote2;
    const overround = rawImpl1 + rawImpl2;
    const pCorr = rawImpl1 / overround;
    const margin = (overround - 1) * 100;
    const edge = (pReal / 100) - pCorr;

    return {
      pImplicit: rawImpl1,
      pCorrected: pCorr,
      edge,
      edgePct: edge * 100,
      overround,
      margin,
      isValueBet: edge > 0.05,
      isStrongBet: edge > 0.10
    };
  }

  /**
   * Kelly mise live avec réduction 40%
   */
  function kellyLive(pReal, cote, bankrollLive) {
    const base = kellyStake(pReal, cote, bankrollLive, 'live');
    return { ...base, stakeReduced: base.stake * 0.6 }; // -40% supplémentaire
  }

  return {
    eloProb,
    prematchAnalysis,
    liveRecalc,
    kellyStake,
    kellyLive,
    calcEdge
  };
})();
