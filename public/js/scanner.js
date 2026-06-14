/**
 * OddsOracle -- Scanner IA v2
 * Scan automatique de valeur sur tous les sports
 * Algorithme: edge via ligne sharp (Pinnacle) + Kelly automatique
 * Nouveautes v2: notifications browser, auto-log journal, coherence sport, watch live
 */

const ScannerModule = (() => {

  let _autoRefreshTimer = null;
  let _lastScanData     = null;
  let _dedupedOpps      = null;
  let _displayedOpps    = null; // sous-ensemble actuellement affiche (apres filtres) -- source pour openStats/addToJournal
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
    baseball_kbo:                      'baseball',
    baseball_npb:                      'baseball',
    baseball_milb:                     'baseball',
    baseball_ncaa:                     'baseball',
    icehockey_nhl:                     'hockey',
    icehockey_ahl:                     'hockey',
    mma_mixed_martial_arts:            'mma',
    boxing_boxing:                     'mma',
    americanfootball_nfl:              'american_football',
    americanfootball_cfl:              'american_football',
    americanfootball_ncaaf:            'american_football',
    americanfootball_ufl:              'american_football',
    rugbyleague_nrl:                   'rugby',
    rugbyleague_nrl_state_of_origin:   'rugby',
    rugbyunion_internationals:         'rugby',
    cricket_odi:                       'cricket',
    cricket_test_match:                'cricket',
    aussierules_afl:                   'aussie_rules',
    // -- Tennis : Grands Chelems
    tennis_atp_aus_open_singles:       'tennis',
    tennis_atp_french_open:            'tennis',
    tennis_atp_wimbledon:              'tennis',
    tennis_atp_us_open:                'tennis',
    tennis_wta_aus_open_singles:       'tennis',
    tennis_wta_french_open:            'tennis',
    tennis_wta_wimbledon:              'tennis',
    tennis_wta_us_open:                'tennis',
    // -- Tennis : Masters 1000 / Premier (ATP)
    tennis_atp_indian_wells:           'tennis',
    tennis_atp_miami_open:             'tennis',
    tennis_atp_monte_carlo_masters:    'tennis',
    tennis_atp_madrid_open:            'tennis',
    tennis_atp_italian_open:           'tennis',
    tennis_atp_canadian_open:          'tennis',
    tennis_atp_cincinnati_open:        'tennis',
    tennis_atp_shanghai_masters:       'tennis',
    tennis_atp_paris_masters:          'tennis',
    tennis_atp_barcelona_open:         'tennis',
    tennis_atp_munich:                 'tennis',
    tennis_atp_hamburg_open:           'tennis',
    tennis_atp_dubai:                  'tennis',
    tennis_atp_qatar_open:             'tennis',
    tennis_atp_china_open:             'tennis',
    // -- Tennis : WTA 1000 / 500
    tennis_wta_indian_wells:           'tennis',
    tennis_wta_miami_open:             'tennis',
    tennis_wta_madrid_open:            'tennis',
    tennis_wta_italian_open:           'tennis',
    tennis_wta_canadian_open:          'tennis',
    tennis_wta_cincinnati_open:        'tennis',
    tennis_wta_wuhan_open:             'tennis',
    tennis_wta_china_open:             'tennis',
    tennis_wta_dubai:                  'tennis',
    tennis_wta_qatar_open:             'tennis',
    tennis_wta_charleston_open:        'tennis',
    tennis_wta_strasbourg:             'tennis',
    tennis_wta_stuttgart_open:         'tennis',
    tennis_wta_queens_club_champ:      'tennis',
    // -- Football : championnats & coupes additionnels
    soccer_france_ligue_two:           'football',
    soccer_france_coupe_de_france:     'football',
    soccer_efl_champ:                  'football',
    soccer_england_league1:            'football',
    soccer_england_league2:            'football',
    soccer_fa_cup:                     'football',
    soccer_england_efl_cup:            'football',
    soccer_uefa_champs_league:         'football',
    soccer_uefa_champs_league_qualification: 'football',
    soccer_uefa_europa_league:         'football',
    soccer_uefa_europa_conference_league: 'football',
    soccer_spain_segunda_division:     'football',
    soccer_spain_copa_del_rey:         'football',
    soccer_italy_serie_b:              'football',
    soccer_italy_coppa_italia:         'football',
    soccer_germany_bundesliga2:        'football',
    soccer_germany_dfb_pokal:          'football',
    soccer_belgium_first_div:          'football',
    soccer_austria_bundesliga:         'football',
    soccer_switzerland_superleague:    'football',
    soccer_turkey_super_league:        'football',
    soccer_greece_super_league:        'football',
    soccer_denmark_superliga:          'football',
    soccer_norway_eliteserien:         'football',
    soccer_sweden_allsvenskan:         'football',
    soccer_sweden_superettan:          'football',
    soccer_finland_veikkausliiga:      'football',
    soccer_poland_ekstraklasa:         'football',
    soccer_russia_premier_league:      'football',
    soccer_spl:                        'football',
    soccer_saudi_arabia_pro_league:    'football',
    // -- Football : competitions internationales
    soccer_fifa_world_cup:                          'football',
    soccer_fifa_world_cup_qualifiers_europe:        'football',
    soccer_fifa_world_cup_qualifiers_south_america: 'football',
    soccer_fifa_world_cup_womens:                   'football',
    soccer_fifa_club_world_cup:                     'football',
    soccer_uefa_european_championship:              'football',
    soccer_uefa_euro_qualification:                 'football',
    soccer_uefa_nations_league:                     'football',
    soccer_africa_cup_of_nations:                   'football',
    soccer_conmebol_copa_america:                   'football',
    soccer_conmebol_copa_libertadores:              'football',
    soccer_conmebol_copa_sudamericana:              'football',
    soccer_concacaf_gold_cup:                       'football',
    soccer_concacaf_leagues_cup:                    'football',
    // -- Football : Ameriques & Asie
    soccer_mexico_ligamx:              'football',
    soccer_japan_j_league:             'football',
    soccer_korea_kleague1:             'football',
    soccer_china_superleague:          'football',
    soccer_australia_aleague:          'football',
    // -- Basketball additionnel
    basketball_wncaab:                 'basketball',
    basketball_nbl:                    'basketball',
    // -- Hockey additionnel
    icehockey_liiga:                   'hockey',
    icehockey_mestis:                  'hockey',
    icehockey_sweden_hockey_league:    'hockey',
    icehockey_sweden_allsvenskan:      'hockey',
    // -- Rugby additionnel
    rugbyunion_six_nations:            'rugby',
    // -- Cricket additionnel
    cricket_ipl:                       'cricket',
    cricket_big_bash:                  'cricket',
    cricket_icc_world_cup:             'cricket',
    cricket_t20_world_cup:             'cricket',
    cricket_international_t20:         'cricket',
    cricket_the_hundred:               'cricket',
    // -- Handball / Lacrosse
    handball_germany_bundesliga:       'handball',
    lacrosse_pll:                      'lacrosse',
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
      sportKey:  opp.sport,
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
      _bankroll = (BankrollManager.getState && BankrollManager.getState().current) || 1000;

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

      const displayedCount = renderResults(json.data, json.scannedAt, json.cached);

      // Le badge de l'onglet reflete lui aussi les cartes affichees (apres deduplication)
      const badgeEl = document.getElementById('scanner-badge');
      if (badgeEl) {
        badgeEl.textContent = displayedCount;
        badgeEl.style.display = displayedCount > 0 ? 'inline-flex' : 'none';
      }

      if (status) {
        const t = new Date(json.scannedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        status.textContent = `Derniere analyse: ${t}${json.cached ? ' (cache)' : ''}`;
        status.className   = 'scanner-status ok';
      }

      if (meta && json.data && json.data.meta) {
        const m = json.data.meta;
        // Le compteur reflete les cartes reellement affichees (apres deduplication par match),
        // pas le total brut d'opportunites detectees cote serveur.
        meta.textContent = `${m.sportsScanned} sports -- ${m.eventsFound} matchs -- ${displayedCount} opportunites`;
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
  // Retourne le nombre de cartes effectivement affichees (apres deduplication par match)
  function renderResults(data, scannedAt, cached) {
    const container = document.getElementById('scanner-results');
    if (!container) return 0;

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
      _dedupedOpps   = [];
      _displayedOpps = [];
      return 0;
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
    // Tri final : score affiné (edge + forme/H2H quand dispo) puis edge brut
    dedupedOpps.sort((a, b) => {
      const sa = a.adjustedScore != null ? a.adjustedScore : (a.predScore != null ? a.predScore : a.edge || 0);
      const sb = b.adjustedScore != null ? b.adjustedScore : (b.predScore != null ? b.predScore : b.edge || 0);
      return (sb - sa) || ((b.edge || 0) - (a.edge || 0));
    });

    const opps = dedupedOpps;
    _dedupedOpps   = opps;
    _displayedOpps = opps;
    const html = opps.map((opp, i) => renderCard(opp, i)).join('');
    container.innerHTML = `<div class="scanner-grid">${html}</div>`;
    return opps.length;
  }

  function renderCard(opp, rank) {
    const kelly   = autoKelly(opp.trueProb, opp.bestPrice, _bankroll, opp.isLive);
    const conf    = CONF_META[opp.confidence] || CONF_META.low;
    const urgency = URGENCY_META[opp.urgency]  || URGENCY_META.upcoming;
    const edgeCls = opp.edge >= 10 ? 'ev-forte' : opp.edge >= 6 ? 'ev-bonne' : 'ev-ok';
    const predLbl = opp.predLabel || (opp.edge >= 10 ? 'FORTE' : opp.edge >= 6 ? 'BONNE' : 'CORRECTE');

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

    // Marches O/U + Handicap (top picks uniquement, voir getScannerData)
    const extraMarketsHtml = (opp.extraMarkets && opp.extraMarkets.length)
      ? '<div class="sc2-extra-section"><div class="sc2-extra-title">Autres marches value</div>'
        + opp.extraMarkets.map(function(em, idx) {
            const ecls = em.edge >= 10 ? 'ev-forte' : em.edge >= 6 ? 'ev-bonne' : 'ev-ok';
            return '<div class="sc2-extra-row">'
              + '<span class="sc2-extra-mkt">' + em.marketName + '</span>'
              + '<span class="sc2-extra-sel">' + em.label + '</span>'
              + '<span class="sc2-extra-odd">' + em.bestPrice.toFixed(2) + '</span>'
              + '<span class="sc2-extra-bk">' + (em.bestBook || '') + '</span>'
              + '<span class="sc2-extra-edge ' + ecls + '">+' + em.edge + '%</span>'
              + '<button class="sc2-btn sc2-btn-extra" onclick="ScannerModule.addExtraToJournal(' + rank + ',' + idx + ')">+ Journal</button>'
              + '</div>';
          }).join('')
        + '</div>'
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

      ${(opp.adjustedScore != null) ? `
      <div class="sc2-ai-section">
        <div class="sc2-ai-score">
          <span class="sc2-ai-score-val">${opp.adjustedScore}<small>/100</small></span>
          <span class="sc2-ai-score-lbl">Score IA${opp.formAdj ? ` <span class="${opp.formAdj > 0 ? 'sc2-ai-adj-pos' : 'sc2-ai-adj-neg'}">(${opp.formAdj > 0 ? '+' : ''}${opp.formAdj})</span>` : ''}</span>
        </div>
        <span class="sc2-ai-note">${opp.formNote || (opp.confidence === 'low' ? '<span class="sc2-low-conf">⚠ confiance faible (cotes peu convergentes)</span>' : 'Pas de donnée forme/H2H')}</span>
      </div>` : ''}

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

      ${extraMarketsHtml}

      <div class="sc2-footer">
        <button class="sc2-btn sc2-btn-journal${isLogged ? ' sc2-btn-logged' : ''}"
                onclick="ScannerModule.addToJournal(${rank})">
          ${isLogged ? '✓ Loggé' : '+ Journal'}
        </button>
        <div class="sc2-footer-right">
          <button class="sc2-btn sc2-btn-stats" onclick="ScannerModule.openStats(${rank})">&#x1F4CA; Stats</button>
          <button class="sc2-btn sc2-btn-ghost" onclick="ScannerModule.focusSport('${opp.sport}')">Ce sport</button>
          <button class="sc2-btn sc2-btn-watch" onclick="ScannerModule.watchMatch('${homeEsc}','${awayEsc}','${opp.sport}')">&#9654; Watch</button>
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
    if (!_dedupedOpps) return;
    const sportEl  = document.getElementById('scan-filter-sport');
    const edgeEl   = document.getElementById('scan-filter-edge');
    const liveEl   = document.getElementById('scan-filter-live');
    const sport    = sportEl ? sportEl.value : 'all';
    const minEdge  = parseFloat(edgeEl ? edgeEl.value : 0);
    const onlyLive = liveEl ? liveEl.checked : false;

    // On filtre la liste deja dedupliquee (1 carte par match), pour rester
    // coherent avec le badge et les boutons Stats/Journal qui indexent _displayedOpps.
    const filtered = _dedupedOpps.filter(o => {
      if (sport !== 'all' && SPORT_MAP[o.sport] !== sport) return false;
      if (o.edge < minEdge) return false;
      if (onlyLive && !o.isLive) return false;
      return true;
    });

    const container = document.getElementById('scanner-results');
    if (!container) return;

    _displayedOpps = filtered;

    const badgeEl = document.getElementById('scanner-badge');
    const meta    = document.getElementById('scanner-meta');

    if (!filtered.length) {
      container.innerHTML = '<div class="scanner-empty">Aucune opportunite avec ces filtres</div>';
      if (badgeEl) { badgeEl.textContent = '0'; badgeEl.style.display = 'none'; }
      if (meta && _lastScanData && _lastScanData.meta) {
        const m = _lastScanData.meta;
        meta.textContent = `${m.sportsScanned} sports -- ${m.eventsFound} matchs -- 0 opportunites`;
      }
      return;
    }

    container.innerHTML = `<div class="scanner-grid">${filtered.map((o, i) => renderCard(o, i)).join('')}</div>`;

    if (badgeEl) {
      badgeEl.textContent = filtered.length;
      badgeEl.style.display = 'inline-flex';
    }
    if (meta && _lastScanData && _lastScanData.meta) {
      const m = _lastScanData.meta;
      meta.textContent = `${m.sportsScanned} sports -- ${m.eventsFound} matchs -- ${filtered.length} opportunites`;
    }
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
  // OUVRIR LA MODALE STATS / ANALYSE IA
  // -----------------------------------------------------------------
  function openStats(rank) {
    if (!_displayedOpps) return;
    const opp = _displayedOpps[rank];
    if (!opp) return;
    if (typeof openMatchStats !== 'function') return;
    openMatchStats({
      dataset: {
        home:    opp.homeTeam || '',
        away:    opp.awayTeam || '',
        sport:   opp.sport || '',
        matchId: opp.matchId || '',
        edge:    String(opp.edge != null ? opp.edge : ''),
        prob:    String(opp.trueProb != null ? opp.trueProb : ''),
      }
    });
  }

  // -----------------------------------------------------------------
  // AJOUTER AU JOURNAL (bouton manuel)
  // -----------------------------------------------------------------
  function addToJournal(rank) {
    if (!_displayedOpps) return;
    const opp   = _displayedOpps[rank];
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
  // AJOUTER AU JOURNAL -- marche supplementaire (O/U, Handicap)
  // -----------------------------------------------------------------
  function addExtraToJournal(rank, idx) {
    if (!_displayedOpps) return;
    const opp = _displayedOpps[rank];
    if (!opp || !opp.extraMarkets) return;
    const em = opp.extraMarkets[idx];
    if (!em) return;

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
        setVal('j-market',    em.marketName);
        setVal('j-selection', em.label);
        setVal('j-cote',      em.bestPrice);
        setVal('j-edge',      em.edge);
        setVal('j-reason',    'Scanner IA -- ' + em.marketName + ' ' + em.label + ' -- Edge ' + em.edge + '% -- Prob ' + em.trueProb + '% -- ' + (em.bestBook || ''));
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

  return { init, runScan, addToJournal, addExtraToJournal, applyFilters, focusSport, watchMatch, openStats };
})();

