/**
 * OddsOracle - Bankroll Manager
 * Gestion bankroll, stop-loss, Kelly, allocation 70/30
 */

const BankrollManager = (() => {

  // ── État interne
  let state = {
    initial: 0,
    current: 0,
    todayLosses: 0,
    weekLosses: 0,
    liveStreakLosses: 0,
    lastResetDate: null,
    lastResetWeek: null,
  };

  // ── Paramètres configurables
  let config = {
    edgeMinPrematch: 5,
    edgeMinLive: 8,
    slDailyPct: 15,
    slWeeklyPct: 25,
    protectGainsPct: 20,
  };

  // ── LocalStorage keys
  const KEY_STATE  = 'odds_bankroll_state';
  const KEY_CONFIG = 'odds_bankroll_config';

  function load() {
    try {
      const s = localStorage.getItem(KEY_STATE);
      const c = localStorage.getItem(KEY_CONFIG);
      if (s) state  = { ...state,  ...JSON.parse(s) };
      if (c) config = { ...config, ...JSON.parse(c) };
    } catch(e) {}
  }

  function save() {
    try {
      localStorage.setItem(KEY_STATE,  JSON.stringify(state));
      localStorage.setItem(KEY_CONFIG, JSON.stringify(config));
    } catch(e) {}
  }

  function setBankroll(initial, current) {
    state.initial = parseFloat(initial) || 0;
    state.current = parseFloat(current) || state.initial;
    save();
  }

  function setConfig(cfg) {
    config = { ...config, ...cfg };
    save();
  }

  function getConfig() { return { ...config }; }

  function getState() { return { ...state }; }

  function getAllocation() {
    const br = state.current;
    return {
      total:    br,
      prematch: br * 0.70,
      live:     br * 0.30,
      liveScenarios:    br * 0.30 * 0.20,   // 20% du budget live
      liveOpportunist:  br * 0.30 * 0.10,   // 10% du budget live
      stopLossDaily:    br * config.slDailyPct / 100,
      stopLossWeekly:   br * config.slWeeklyPct / 100,
      protectGains:     state.initial * (1 + config.protectGainsPct / 100),
    };
  }

  // ── Enregistrer une perte (pour suivi stop-loss)
  function recordLoss(amount, isLive = false) {
    state.todayLosses += Math.abs(amount);
    state.weekLosses  += Math.abs(amount);
    state.current     -= Math.abs(amount);
    if (isLive) state.liveStreakLosses++;
    save();
  }

  // ── Enregistrer un gain
  function recordWin(pnl, isLive = false) {
    state.current += pnl;
    if (isLive) state.liveStreakLosses = 0; // reset série
    save();
  }

  // ── Reset journalier / hebdo
  function resetDaily() {
    state.todayLosses = 0;
    state.liveStreakLosses = 0;
    state.lastResetDate = new Date().toISOString();
    save();
  }

  function resetWeekly() {
    state.weekLosses = 0;
    state.lastResetWeek = new Date().toISOString();
    save();
  }

  // ── Vérifier les stop-loss
  function checkStopLoss() {
    const alloc = getAllocation();
    const warnings = [];

    if (state.todayLosses >= alloc.stopLossDaily) {
      warnings.push({ type: 'STOP_LOSS_DAILY', msg: `Stop-loss journalier atteint (${state.todayLosses.toFixed(0)}€ / ${alloc.stopLossDaily.toFixed(0)}€)` });
    }
    if (state.weekLosses >= alloc.stopLossWeekly) {
      warnings.push({ type: 'STOP_LOSS_WEEKLY', msg: `Stop-loss hebdomadaire atteint - pause 48h obligatoire` });
    }
    if (state.liveStreakLosses >= 3) {
      warnings.push({ type: 'LIVE_STREAK', msg: `3 pertes live consécutives - arrêt du live pour aujourd'hui` });
    }
    if (state.current >= alloc.protectGains) {
      warnings.push({ type: 'PROTECT_GAINS', msg: `Objectif +${config.protectGainsPct}% atteint - protéger 50% des gains` });
    }

    return warnings;
  }

  // ── Calcul Kelly simple (wrapper autour OddsModels)
  function calcKelly(pReal, cote, mode) {
    const alloc = getAllocation();
    const bankrollBase = mode === 'live' ? alloc.live : alloc.prematch;
    return OddsModels.kellyStake(pReal / 100, parseFloat(cote), bankrollBase, mode);
  }

  return {
    load, save, setBankroll, setConfig, getConfig, getState,
    getAllocation, recordLoss, recordWin, resetDaily, resetWeekly,
    checkStopLoss, calcKelly
  };
})();
