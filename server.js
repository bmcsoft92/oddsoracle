/**
 * OddsOracle -- Backend Server v3.0
 * Express + The Odds API proxy + SSE live updates + Scanner IA + keep-alive
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const ODDS_API_KEY  = process.env.ODDS_API_KEY  || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

const SPORTS = [
  // Tennis
  { key: 'tennis_atp',                   label: 'Tennis ATP',          icon: 'T', group: 'tennis' },
  { key: 'tennis_wta',                   label: 'Tennis WTA',          icon: 'T', group: 'tennis' },
  // Football -- Europe
  { key: 'soccer_france_ligue1',         label: 'Ligue 1',             icon: 'F', group: 'football' },
  { key: 'soccer_epl',                   label: 'Premier League',      icon: 'F', group: 'football' },
  { key: 'soccer_europe_champs',         label: 'Champions League',    icon: 'F', group: 'football' },
  { key: 'soccer_spain_la_liga',         label: 'La Liga',             icon: 'F', group: 'football' },
  { key: 'soccer_italy_serie_a',         label: 'Serie A',             icon: 'F', group: 'football' },
  { key: 'soccer_germany_bundesliga',    label: 'Bundesliga',          icon: 'F', group: 'football' },
  { key: 'soccer_portugal_primeira_liga',label: 'Primeira Liga',       icon: 'F', group: 'football' },
  { key: 'soccer_netherlands_eredivisie',label: 'Eredivisie',          icon: 'F', group: 'football' },
  // Football -- Ameriques
  { key: 'soccer_usa_mls',               label: 'MLS',                 icon: 'F', group: 'football' },
  { key: 'soccer_colombia_primera_a',    label: 'Colombia Primera A',  icon: 'F', group: 'football' },
  { key: 'soccer_brazil_campeonato',     label: 'Brasileirao',         icon: 'F', group: 'football' },
  { key: 'soccer_argentina_primera_division', label: 'Argentina Liga', icon: 'F', group: 'football' },
  // Basketball
  { key: 'basketball_nba',               label: 'NBA',                 icon: 'B', group: 'basketball' },
  { key: 'basketball_nba_championship',  label: 'NBA Playoffs',        icon: 'B', group: 'basketball' },
  { key: 'basketball_wnba',              label: 'WNBA',                icon: 'B', group: 'basketball' },
  { key: 'basketball_euroleague',        label: 'Euroleague',          icon: 'B', group: 'basketball' },
  { key: 'basketball_ncaab',             label: 'NCAA Basketball',     icon: 'B', group: 'basketball' },
  // Baseball
  { key: 'baseball_mlb',                 label: 'MLB',                 icon: 'X', group: 'baseball' },
  // Hockey sur glace
  { key: 'icehockey_nhl',               label: 'NHL',                  icon: 'H', group: 'hockey' },
  // MMA
  { key: 'mma_mixed_martial_arts',       label: 'MMA/UFC',             icon: 'M', group: 'mma' },
  // NFL (hors saison en juin -- disponible en septembre)
  { key: 'americanfootball_nfl',         label: 'NFL',                 icon: 'A', group: 'american_football' },
];

const BOOKMAKERS = ['betclic', 'unibet', 'pinnacle', 'winamax', 'bet365'];
// ── Icône par groupe de sport ──────────────────────────────────────────────
function mapGroupIcon(group) {
  const g = (group || '').toLowerCase();
  if (g.includes('soccer') || g.includes('football') && !g.includes('american') && !g.includes('aussie')) return '⚽';
  if (g.includes('tennis'))            return '🎾';
  if (g.includes('basketball'))        return '🏀';
  if (g.includes('baseball'))          return '⚾';
  if (g.includes('icehockey') || g.includes('hockey')) return '🏒';
  if (g.includes('americanfootball'))  return '🏈';
  if (g.includes('mma') || g.includes('boxing')) return '🥊';
  if (g.includes('cricket'))           return '🏏';
  if (g.includes('rugby'))             return '🏉';
  if (g.includes('golf'))              return '⛳';
  return '⚡';
}

// ── Découverte dynamique des sports actifs (endpoint GRATUIT, 0 quota) ─────
async function getActiveSports() {
  const cacheKey = 'active_sports_dyn';
  const cached   = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const raw    = await oddsApiFetch('/sports', { all: false });
    const sports = (Array.isArray(raw) ? raw : [])
      .filter(function(s){ return s.active && !s.has_outrights; })
      .map(function(s){
        return {
          key:   s.key,
          label: s.title || s.key,
          icon:  mapGroupIcon(s.group || s.key),
          group: s.group || s.key,
        };
      });
    console.log('[sports] ' + sports.length + ' sports actifs découverts');
    cache.set(cacheKey, sports, 1800); // 30 min (endpoint gratuit)
    return sports;
  } catch(e) {
    console.warn('[sports] fallback statique: ' + e.message);
    return SPORTS; // fallback sur la liste statique
  }
}


// -- CACHE --
class Cache {
  constructor() { this._store = new Map(); }
  set(key, value, ttlSeconds) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this._store.delete(key); return null; }
    return entry.value;
  }
  del(key) { this._store.delete(key); }
  size()   { return this._store.size; }
}

const cache = new Cache();

// ── Historique cotes en mémoire (tracking mouvement / steam) ─────────────
const oddsHistory = {};  // { matchId: { open, snapshots, openTime } }

function recordOddsSnapshot(matchId, homeTeam, awayTeam, rawBookmakers) {
  if (!matchId || !rawBookmakers || !rawBookmakers.length) return;
  const snapshot = { ts: Date.now(), bk: rawBookmakers };
  if (!oddsHistory[matchId]) {
    oddsHistory[matchId] = { home: homeTeam, away: awayTeam, open: snapshot, snapshots: [snapshot], openTime: Date.now() };
  } else {
    oddsHistory[matchId].snapshots.push(snapshot);
    if (oddsHistory[matchId].snapshots.length > 48) oddsHistory[matchId].snapshots.shift();
  }
  const cutoff = Date.now() - 86400000;
  Object.keys(oddsHistory).forEach(function(k) { if (oddsHistory[k].openTime < cutoff) delete oddsHistory[k]; });
}

function getOddsMovement(matchId, teamName) {
  const hist = oddsHistory[matchId];
  if (!hist || hist.snapshots.length < 2) return null;
  function bestPrice(bkArr, tName) {
    let best = null;
    bkArr.forEach(function(bk) {
      const mk = bk.markets && bk.markets.find(function(m){ return m.key === 'h2h'; });
      if (!mk) return;
      const out = mk.outcomes && mk.outcomes.find(function(o){ return teamMatch(o.name, tName); });
      if (out && out.price && (!best || out.price > best)) best = out.price;
    });
    return best;
  }
  const opening = bestPrice(hist.open.bk, teamName);
  const current = bestPrice(hist.snapshots[hist.snapshots.length - 1].bk, teamName);
  if (!opening || !current) return null;
  const pctChange = Math.round((current - opening) / opening * 1000) / 10;
  const direction = pctChange > 0.5 ? 'up' : pctChange < -0.5 ? 'down' : 'stable';
  const steam     = Math.abs(pctChange) >= 5;
  const sparkline = hist.snapshots.slice(-8).map(function(s){ return bestPrice(s.bk, teamName); }).filter(Boolean);
  return { opening, current, pctChange, direction, steam, sparkline };
}

let apiUsage = {
  requestsUsed: 0,
  requestsRemaining: null,
  lastReset: new Date().toISOString(),
};

// -- HELPER: Fetch Odds API --
function oddsApiFetch(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ODDS_API_KEY) {
      reject(new Error('ODDS_API_KEY non configuree. Voir .env.example'));
      return;
    }
    const queryParams = new URLSearchParams({ apiKey: ODDS_API_KEY, ...params });
    const url = `${ODDS_API_BASE}${endpoint}?${queryParams}`;
    console.log('[API] GET ' + endpoint);
    https.get(url, (res) => {
      if (res.headers['x-requests-used']) {
        apiUsage.requestsUsed      = parseInt(res.headers['x-requests-used']);
        apiUsage.requestsRemaining = parseInt(res.headers['x-requests-remaining']);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) { reject(new Error('Cle API invalide ou expiree')); return; }
        if (res.statusCode === 422) { reject(new Error('Sport non disponible ou parametre invalide')); return; }
        if (res.statusCode !== 200) { reject(new Error('Erreur API ' + res.statusCode)); return; }
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Reponse API invalide (JSON mal forme)')); }
      });
    }).on('error', reject);
  });
}

// -- QUOTA GUARD (évite de vider le quota) --
// Compteur d'appels avant que le premier header x-requests-remaining arrive
let _apiCallsMadeUnknown = 0;
const UNKNOWN_QUOTA_LIMIT = 15; // max appels sans connaître le solde

function quotaOk() {
  if (apiUsage.requestsRemaining === null) {
    // Pas encore de header reçu — limiter le nombre d'appels "à l'aveugle"
    if (_apiCallsMadeUnknown >= UNKNOWN_QUOTA_LIMIT) return false;
    _apiCallsMadeUnknown++;
    return true;
  }
  // Reset compteur une fois qu'on connaît le solde
  _apiCallsMadeUnknown = 0;
  return apiUsage.requestsRemaining > 20;
}

// -- CHARGEMENT SÉRIALISÉ avec vérification quota entre chaque sport --
// Remplace Promise.allSettled pour éviter 36 appels simultanés au démarrage
async function loadSportsSafely(sports) {
  const results = [];
  for (const sport of sports) {
    if (!quotaOk()) {
      console.warn('[quota] Arrêt chargement sports — quota faible');
      break;
    }
    try {
      const data = await loadOddsForSport(sport);
      results.push({ status: 'fulfilled', value: data });
    } catch(e) {
      results.push({ status: 'rejected', reason: e });
    }
  }
  return results;
}

// -- CACHE DISQUE (survit aux redémarrages du process) --
const DISK_CACHE_DIR = '/tmp';
function diskCacheSave(key, data) {
  try {
    const file = DISK_CACHE_DIR + '/oo_' + key.replace(/[^a-z0-9_]/gi, '_') + '.json';
    fs.writeFileSync(file, JSON.stringify({ data, ts: Date.now() }));
  } catch(e) { /* silencieux */ }
}
function diskCacheLoad(key, maxAgeMs) {
  try {
    const file = DISK_CACHE_DIR + '/oo_' + key.replace(/[^a-z0-9_]/gi, '_') + '.json';
    if (!fs.existsSync(file)) return null;
    const { data, ts } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - ts > maxAgeMs) return null;
    return data;
  } catch(e) { return null; }
}

// -- HELPERS --
function formatBookmakers(bookmakers) {
  return bookmakers
    .filter(bk => BOOKMAKERS.includes(bk.key))
    .map(bk => {
      const h2h = bk.markets && bk.markets.find(m => m.key === 'h2h');
      if (!h2h) return null;
      return {
        key:        bk.key,
        title:      bk.title,
        odds:       (h2h.outcomes || []).map(o => ({ name: o.name, price: o.price })),
        lastUpdate: bk.last_update,
      };
    })
    .filter(Boolean);
}

function extractBestOdds(bookmakers) {
  const bestByOutcome = {};
  bookmakers.forEach(bk => {
    const h2h = bk.markets && bk.markets.find(m => m.key === 'h2h');
    if (!h2h) return;
    (h2h.outcomes || []).forEach(o => {
      if (!bestByOutcome[o.name] || o.price > bestByOutcome[o.name].price) {
        bestByOutcome[o.name] = { price: o.price, bookmaker: bk.title };
      }
    });
  });
  return bestByOutcome;
}

// -- MIDDLEWARE --
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -- ROUTES --

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), apiUsage, cacheSize: cache.size(), timestamp: new Date().toISOString() });
});

app.get('/api/sports', async (req, res) => {
  const cacheKey = 'sports_list';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });
  cache.set(cacheKey, SPORTS, 86400);
  res.json({ data: SPORTS, cached: false });
});

// Retourne TOUS les sports actifs sur la cle API (pour dropdown dynamique)
app.get('/api/sports/available', async (req, res) => {
  const cacheKey = 'sports_available';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  if (!ODDS_API_KEY) {
    return res.json({ data: SPORTS, cached: false, static: true });
  }

  try {
    const all = await oddsApiFetch('/sports', { all: 'true' });
    const active = all.filter(s => s.active && s.has_outrights === false);
    const mapped  = active.map(s => ({
      key:   s.key,
      label: s.title,
      icon:  s.group === 'Soccer' ? 'F' : s.group === 'Basketball' ? 'B' : s.group === 'Tennis' ? 'T' : 'S',
      group: s.group ? s.group.toLowerCase() : 'other',
      description: s.description || '',
    }));
    const priority = ['tennis', 'soccer', 'basketball'];
    mapped.sort((a, b) => {
      const pa = priority.findIndex(p => a.group.includes(p));
      const pb = priority.findIndex(p => b.group.includes(p));
      const ra = pa === -1 ? 99 : pa;
      const rb = pb === -1 ? 99 : pb;
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
    cache.set(cacheKey, mapped, 3600);
    res.json({ data: mapped, cached: false, count: mapped.length });
  } catch (err) {
    console.error('[sports/available]', err.message);
    res.json({ data: SPORTS, cached: false, static: true, error: err.message });
  }
});

app.get('/api/events', async (req, res) => {
  const sport    = req.query.sport || 'tennis_atp';
  const cacheKey = 'events_' + sport;
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, apiUsage });
  try {
    const events = await oddsApiFetch('/sports/' + sport + '/events', { dateFormat: 'iso' });
    const now = Date.now();
    const h48 = now + 48 * 3600 * 1000;
    const relevant = events.filter(e => {
      const t = new Date(e.commence_time).getTime();
      return t >= now - 3600 * 1000 && t <= h48;
    });
    cache.set(cacheKey, relevant, 1800);
    res.json({ data: relevant, cached: false, apiUsage });
  } catch (err) {
    console.error('[events]', err.message);
    const stale = cache.get(cacheKey + '_stale');
    if (stale) return res.json({ data: stale, cached: true, stale: true, error: err.message, apiUsage });
    res.status(500).json({ error: err.message, apiUsage });
  }
});

app.get('/api/odds', async (req, res) => {
  const sport    = req.query.sport   || 'tennis_atp';
  const eventId  = req.query.eventId || null;
  const cacheKey = 'odds_' + sport + '_' + (eventId || 'all');
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, apiUsage });
  try {
    const params   = { regions: 'eu', markets: 'h2h', oddsFormat: 'decimal', bookmakers: BOOKMAKERS.join(',') };
    const endpoint = eventId
      ? '/sports/' + sport + '/events/' + eventId + '/odds'
      : '/sports/' + sport + '/odds';
    const raw = await oddsApiFetch(endpoint, params);
    const normalized = (Array.isArray(raw) ? raw : [raw]).map(event => ({
      id:           event.id,
      sport:        event.sport_key,
      homeTeam:     event.home_team,
      awayTeam:     event.away_team,
      commenceTime: event.commence_time,
      bookmakers:   formatBookmakers(event.bookmakers || []),
      bestOdds:     extractBestOdds(event.bookmakers || []),
    }));
    cache.set(cacheKey, normalized, 900);
    cache.set(cacheKey + '_stale', normalized, 7200);
    res.json({ data: normalized, cached: false, apiUsage });
  } catch (err) {
    console.error('[odds]', err.message);
    const stale = cache.get(cacheKey + '_stale');
    if (stale) return res.json({ data: stale, cached: true, stale: true, error: err.message, apiUsage });
    res.status(500).json({ error: err.message, apiUsage });
  }
});

app.get('/api/scores', async (req, res) => {
  const sport    = req.query.sport    || 'tennis_atp';
  const daysFrom = req.query.daysFrom || '1';
  const cacheKey = 'scores_' + sport + '_' + daysFrom;
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, apiUsage });
  try {
    const scores = await oddsApiFetch('/sports/' + sport + '/scores', { daysFrom, dateFormat: 'iso' });
    const sorted = scores.sort((a, b) => {
      if (a.completed === b.completed) return 0;
      return a.completed ? 1 : -1;
    });
    cache.set(cacheKey, sorted, 120);
    res.json({ data: sorted, cached: false, apiUsage });
  } catch (err) {
    console.error('[scores]', err.message);
    res.status(500).json({ error: err.message, apiUsage });
  }
});

app.get('/api/quota', (req, res) => {
  res.json(apiUsage);
});

// -- HELPER PARTAGE: charge les cotes d'un sport (reutilise le cache scanner) --
async function loadOddsForSport(sport) {
  const cacheKey = 'odds_' + sport.key + '_all';
  // 1. Cache mémoire (priorité)
  let data = cache.get(cacheKey);
  if (data) return data;
  // 2. Cache disque (survit aux redémarrages — TTL 6h)
  const disk = diskCacheLoad('odds_' + sport.key, 6 * 3600 * 1000);
  if (disk) {
    cache.set(cacheKey, disk, 21600);
    console.log('[cache] disk hit pour ' + sport.key);
    return disk;
  }
  // 3. Guard quota : servir le stale si quota bas
  if (!quotaOk()) {
    const stale = cache.get(cacheKey + '_stale');
    if (stale) { console.warn('[quota] faible — stale servi pour ' + sport.key); return stale; }
    throw new Error('Quota Odds API épuisé et pas de données stale');
  }
  // 4. Appel API
  const raw = await oddsApiFetch('/sports/' + sport.key + '/odds', {
    regions: 'eu', markets: 'h2h', oddsFormat: 'decimal',
    bookmakers: BOOKMAKERS.join(','),
  });
  data = (Array.isArray(raw) ? raw : [raw]).map(function(event) {
    recordOddsSnapshot(event.id, event.home_team, event.away_team, event.bookmakers || []);
    return {
      id:           event.id,
      sport:        event.sport_key,
      sportLabel:   sport.label,
      sportIcon:    sport.icon,
      homeTeam:     event.home_team,
      awayTeam:     event.away_team,
      commenceTime: event.commence_time,
      bookmakers:   formatBookmakers(event.bookmakers || []),
      bestOdds:     extractBestOdds(event.bookmakers || []),
      _raw:         event.bookmakers || [],
    };
  });
  cache.set(cacheKey, data, 21600);         // 6h mémoire
  cache.set(cacheKey + '_stale', data, 604800); // 7j stale
  diskCacheSave('odds_' + sport.key, data); // persist disque
  return data;
}

// Enrichit un evenement avec cotes completes par selection
function enrichEvent(event, sport) {
  const rawBk = event._raw || [];
  const pinnacle = rawBk.find(function(b) { return b.key === 'pinnacle'; });
  const sharpBk  = pinnacle || rawBk[0];
  const sharpH2H = sharpBk && sharpBk.markets && sharpBk.markets.find(function(m) { return m.key === 'h2h'; });
  if (!sharpH2H || !sharpH2H.outcomes || !sharpH2H.outcomes.length) return null;

  const outcomes  = sharpH2H.outcomes;
  const overround = outcomes.reduce(function(s, o) { return s + 1 / o.price; }, 0);

  const selections = outcomes.map(function(o) {
    const trueProb = (1 / o.price) / overround;
    const allBooks = [];
    let bestPrice = 1.0, bestBook = '';
    rawBk.forEach(function(bk) {
      const h2h = bk.markets && bk.markets.find(function(m) { return m.key === 'h2h'; });
      const out = h2h && h2h.outcomes && h2h.outcomes.find(function(x) { return x.name === o.name; });
      if (out && out.price > 1) {
        allBooks.push({ name: bk.title || bk.key, price: out.price });
        if (out.price > bestPrice) { bestPrice = out.price; bestBook = bk.title || bk.key; }
      }
    });
    allBooks.sort(function(a, b) { return b.price - a.price; });
    const edge     = (trueProb * bestPrice - 1) * 100;
    const predLabel = edge >= 10 ? 'FORTE' : edge >= 6 ? 'BONNE' : edge >= 2 ? 'CORRECTE' : null;
    return {
      name:          o.name,
      sharpPrice:    o.price,
      bestPrice,
      bestBook,
      allBookmakers: allBooks,
      trueProb:      Math.round(trueProb * 1000) / 10,
      edge:          Math.round(edge * 10) / 10,
      predScore:     Math.min(99, Math.round(trueProb * (1 + Math.max(0, edge) / 100))),
      predLabel,
    };
  });

  return {
    id:           event.id,
    sport:        sport.key,
    sportLabel:   sport.label,
    sportIcon:    sport.icon,
    homeTeam:     event.homeTeam,
    awayTeam:     event.awayTeam,
    commenceTime: event.commenceTime,
    selections,
    bookmakerCount: rawBk.length,
    hasSharp:       !!pinnacle,
  };
}

// -- LIVE ALL: tous les matchs en cours sur tous les sports --

// -----------------------------------------------------------------------
// SCORES LIVE — TheSportsDB (gratuit, sans quota)
// -----------------------------------------------------------------------
async function getLiveScores() {
  try {
    const ctrl = new AbortController();
    setTimeout(function(){ ctrl.abort(); }, 6000);
    const resp = await fetch(
      'https://www.thesportsdb.com/api/v1/json/3/eventslive.php',
      { signal: ctrl.signal }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data && data.events) ? data.events : [];
  } catch(e) {
    console.warn('[thesportsdb] ' + e.message);
    return [];
  }
}

function normTeam(s) {
  return (s || '').toLowerCase()
    .replace(/\s+fc$/,'').replace(/^fc\s+/,'')
    .replace(/[^a-z0-9]/g, '');
}

function teamMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function attachLiveScore(match, liveScores) {
  const score = liveScores.find(function(s) {
    return (teamMatch(s.strHomeTeam, match.homeTeam) && teamMatch(s.strAwayTeam, match.awayTeam))
        || (teamMatch(s.strHomeTeam, match.awayTeam) && teamMatch(s.strAwayTeam, match.homeTeam));
  });
  if (!score) return null;
  return {
    homeScore: score.intHomeScore,
    awayScore: score.intAwayScore,
    progress:  score.strProgress  || '',
    status:    score.strStatus    || '',
    detail:    score.strResult    || ''
  };
}
// Mapper sport TheSportsDB → clé The Odds API (pour enrichissement cotes)
const SPORTSDB_MAP = {
  'Soccer':              ['soccer_france_ligue1','soccer_epl','soccer_europe_champs','soccer_spain_la_liga',
                          'soccer_italy_serie_a','soccer_germany_bundesliga','soccer_portugal_primeira_liga',
                          'soccer_netherlands_eredivisie','soccer_usa_mls','soccer_brazil_campeonato',
                          'soccer_argentina_primera_division','soccer_colombia_primera_a'],
  'Tennis':              ['tennis_atp','tennis_wta'],
  'Basketball':          ['basketball_nba','basketball_nba_championship','basketball_wnba','basketball_euroleague'],
  'Baseball':            ['baseball_mlb'],
  'Ice Hockey':          ['icehockey_nhl'],
  'American Football':   ['americanfootball_nfl'],
  'Mixed Martial Arts':  ['mma_mixed_martial_arts'],
};

// Icône + label par sport TheSportsDB
const SPORTSDB_META = {
  'Soccer':             { icon: '⚽', label: 'Football' },
  'Tennis':             { icon: '🎾', label: 'Tennis' },
  'Basketball':         { icon: '🏀', label: 'Basketball' },
  'Baseball':           { icon: '⚾', label: 'Baseball' },
  'Ice Hockey':         { icon: '🏒', label: 'Hockey' },
  'American Football':  { icon: '🏈', label: 'NFL' },
  'Mixed Martial Arts': { icon: '🥊', label: 'MMA' },
};

// Trouver l'event Odds API qui correspond à un event TheSportsDB
function matchOddsEvent(oddsEvents, sdbEvent) {
  return oddsEvents.find(function(e) {
    return (teamMatch(e.homeTeam, sdbEvent.strHomeTeam) && teamMatch(e.awayTeam, sdbEvent.strAwayTeam))
        || (teamMatch(e.homeTeam, sdbEvent.strAwayTeam) && teamMatch(e.awayTeam, sdbEvent.strHomeTeam));
  });
}


app.get('/api/live/all', async (req, res) => {
  const cacheKey = 'live_all';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, fetchedAt: cached._fetchedAt, apiUsage });

  const now         = Date.now();
  const cutoffFutur = now + 24 * 3600 * 1000; // matchs des prochaines 24h
  const liveMatches = [];
  const seenKeys    = new Set();

  // ── Timeout global 12s pour éviter le blocage du client ──
  const deadline = new Promise(function(_, rej) { setTimeout(function(){ rej(new Error('timeout')); }, 12000); });

  async function buildLiveFeed() {
    // PARTIE 1 : TheSportsDB (matchs EN COURS, gratuit, sans quota)
    const sdbEvents = await getLiveScores(); // timeout 6s interne
    // Sports uniques trouvés dans TheSportsDB → charger odds en parallèle
    const sdbSports = [...new Set(
      sdbEvents.flatMap(function(e){ return SPORTSDB_MAP[e.strSport||'']||[]; })
    )];
    const oddsResults = await Promise.allSettled(
      sdbSports.map(function(key){
        const sp = SPORTS.find(function(s){ return s.key===key; });
        return sp ? loadOddsForSport(sp) : Promise.resolve([]);
      })
    );
    const loadedOdds = {};
    sdbSports.forEach(function(key, i){
      loadedOdds[key] = oddsResults[i].status==='fulfilled' ? oddsResults[i].value : [];
    });

    for (const sdbEv of sdbEvents) {
      const sportName = sdbEv.strSport || '';
      if (!sdbEv.strHomeTeam || !sdbEv.strAwayTeam) continue;
      const meta     = SPORTSDB_META[sportName] || { icon: '⚡', label: sportName };
      const sportKs  = SPORTSDB_MAP[sportName]  || [];
      const mk = normTeam(sdbEv.strHomeTeam)+'|'+normTeam(sdbEv.strAwayTeam);
      if (seenKeys.has(mk)) continue;
      seenKeys.add(mk);
      let enrichedOdds = null;
      for (const key of sportKs) {
        const matched = matchOddsEvent(loadedOdds[key]||[], sdbEv);
        if (matched) {
          enrichedOdds = enrichEvent(matched, SPORTS.find(function(s){ return s.key===key; }));
          break;
        }
      }
      liveMatches.push({
        homeTeam:    sdbEv.strHomeTeam,
        awayTeam:    sdbEv.strAwayTeam,
        sportKey:    (enrichedOdds&&enrichedOdds.sportKey)||sportKs[0]||'unknown',
        sportLabel:  meta.label,
        sportIcon:   meta.icon,
        commenceTime:(sdbEv.dateEvent||now)+'T'+(sdbEv.strTime||'00:00:00'),
        isLive:      true,
        isImminent:  false,
        liveScore: {
          homeScore: sdbEv.intHomeScore,
          awayScore: sdbEv.intAwayScore,
          progress:  sdbEv.strProgress||sdbEv.strStatus||'',
          status:    sdbEv.strStatus||''
        },
        selections: enrichedOdds ? (enrichedOdds.selections||[]) : [],
        league:     sdbEv.strLeague||''
      });
    }

    // PARTIE 2 : matchs à venir (24h) — sports découverts dynamiquement (sérialisé)
    const activeSports2 = await getActiveSports();
    const upcomingResults = await loadSportsSafely(activeSports2);
    activeSports2.forEach(function(sport, i) {
      if (!upcomingResults[i] || upcomingResults[i].status !== 'fulfilled') return;
      for (const event of upcomingResults[i].value) {
        const t = new Date(event.commenceTime).getTime();
        const msAgo = now - t;
        // Skip if too far in future, or started more than 3h ago (probably finished)
        if (t > cutoffFutur) continue;
        if (msAgo > 3 * 3600000) continue;
        const enriched = enrichEvent(event, sport);
        if (!enriched) continue;
        const mk2 = normTeam(enriched.homeTeam)+'|'+normTeam(enriched.awayTeam);
        if (seenKeys.has(mk2)) continue;
        seenKeys.add(mk2);
        const started  = t <= now;
        const hoursLeft = started ? 0 : Math.round((t-now)/360000)/10;
        liveMatches.push({
          ...enriched,
          isLive:    started,
          isImminent: !started,
          hoursLeft
        });
      }
    });
  }

  try {
    await Promise.race([buildLiveFeed(), deadline]);
  } catch(e) {
    console.warn('[live/all] ' + e.message);
  }

  liveMatches.sort(function(a, b) {
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return  1;
    if (a.isLive) return 0;
    return new Date(a.commenceTime) - new Date(b.commenceTime);
  });

  const result = { matches: liveMatches, count: liveMatches.length, _fetchedAt: new Date().toISOString() };
  cache.set(cacheKey, result, 120);
  res.json({ data: result, cached: false, fetchedAt: result._fetchedAt, apiUsage });
});

// -- UPCOMING: tous les matchs des prochaines 24h sur tous les sports --
app.get('/api/upcoming', async (req, res) => {
  const cacheKey = 'upcoming_all';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, fetchedAt: cached._fetchedAt, apiUsage });

  const now          = Date.now();
  const activeSports = await getActiveSports(); // sports découverts dynamiquement
  const h24 = now + 24 * 3600 * 1000;
  const upcoming = [];

  const upRes = await loadSportsSafely(activeSports);
  activeSports.forEach(function(sport, i) {
    if (!upRes[i] || upRes[i].status !== 'fulfilled') return;
    for (const event of upRes[i].value) {
      const t = new Date(event.commenceTime).getTime();
      if (t <= now || t > h24) continue;
      const enriched = enrichEvent(event, sport);
      if (enriched) upcoming.push({ ...enriched, isLive: false, hoursLeft: Math.round((t - now) / 360000) / 10 });
    }
  });

  upcoming.sort(function(a, b) { return new Date(a.commenceTime) - new Date(b.commenceTime); });

  const result = { matches: upcoming, count: upcoming.length, _fetchedAt: new Date().toISOString() };
  cache.set(cacheKey, result, 1800); // 30 min
  res.json({ data: result, cached: false, fetchedAt: result._fetchedAt, apiUsage });
});

// -- SCANNER IA --
app.get('/api/scanner', async (req, res) => {
  const cacheKey = 'scanner_results';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, apiUsage, scannedAt: cached._scannedAt });

  if (!ODDS_API_KEY) {
    return res.status(503).json({ error: 'ODDS_API_KEY non configuree', apiUsage });
  }

  const activeSportsScan = await getActiveSports();
  const opportunities = [];
  const now = Date.now();
  const h48 = now + 48 * 3600 * 1000;
  let sportsScanned = 0;
  let eventsFound   = 0;

  for (const sport of activeSportsScan) {
    try {
      const oddsCacheKey = 'odds_' + sport.key + '_all';
      let oddsData = cache.get(oddsCacheKey);

      if (!oddsData) {
        const raw = await oddsApiFetch('/sports/' + sport.key + '/odds', {
          regions:    'eu',
          markets:    'h2h',
          oddsFormat: 'decimal',
          bookmakers: BOOKMAKERS.join(','),
        });
        oddsData = (Array.isArray(raw) ? raw : [raw]).map(event => ({
          id:           event.id,
          sport:        event.sport_key,
          homeTeam:     event.home_team,
          awayTeam:     event.away_team,
          commenceTime: event.commence_time,
          bookmakers:   formatBookmakers(event.bookmakers || []),
          bestOdds:     extractBestOdds(event.bookmakers || []),
          _raw:         event.bookmakers || [],
        }));
        cache.set(oddsCacheKey, oddsData, 900);
        cache.set(oddsCacheKey + '_stale', oddsData, 7200);
      }

      sportsScanned++;

      for (const event of oddsData) {
        const t = new Date(event.commenceTime).getTime();
        if (t < now - 3 * 3600 * 1000 || t > h48) continue;
        eventsFound++;

        const isLive = t < now;
        const rawBk  = event._raw || [];
        if (rawBk.length < 2) continue;

        const pinnacle = rawBk.find(function(b) { return b.key === 'pinnacle'; });
        const sharpBk  = pinnacle || rawBk[0];
        const sharpH2H = sharpBk && sharpBk.markets && sharpBk.markets.find(function(m) { return m.key === 'h2h'; });
        if (!sharpH2H || !sharpH2H.outcomes || !sharpH2H.outcomes.length) continue;

        const outcomes  = sharpH2H.outcomes;
        const overround = outcomes.reduce(function(s, o) { return s + 1 / o.price; }, 0);
        const trueProbs = {};
        for (const o of outcomes) {
          trueProbs[o.name] = (1 / o.price) / overround;
        }

        for (const o of outcomes) {
          const trueProb = trueProbs[o.name];
          let bestPrice    = 1.0;
          let bestBookKey  = '';
          let bestBookName = '';

          const allBookmakers = [];

          for (const bk of rawBk) {
            const bkH2H = bk.markets && bk.markets.find(function(m) { return m.key === 'h2h'; });
            const bkOut = bkH2H && bkH2H.outcomes && bkH2H.outcomes.find(function(out) { return out.name === o.name; });
            if (bkOut && bkOut.price > 1) {
              allBookmakers.push({ name: bk.title || bk.key, price: bkOut.price });
              if (bkOut.price > bestPrice) {
                bestPrice    = bkOut.price;
                bestBookKey  = bk.key;
                bestBookName = bk.title || bk.key;
              }
            }
          }

          if (!bestBookKey) continue;

          const edge = (trueProb * bestPrice - 1) * 100;
          if (edge < 2) continue;

          const confidence = pinnacle ? 'high' : rawBk.length >= 3 ? 'medium' : 'low';
          const hoursLeft  = (t - now) / 3600000;
          const urgency    = isLive ? 'live' : hoursLeft < 2 ? 'soon' : hoursLeft < 6 ? 'today' : 'upcoming';

          const predScore  = Math.min(99, Math.round(trueProb * (1 + edge / 100)));
          const predLabel  = edge >= 10 ? 'FORTE' : edge >= 6 ? 'BONNE' : 'CORRECTE';

          opportunities.push({
            sport:          sport.key,
            sportLabel:     sport.label,
            sportIcon:      sport.icon,
            matchId:        event.id,
            homeTeam:       event.homeTeam,
            awayTeam:       event.awayTeam,
            commenceTime:   event.commenceTime,
            isLive,
            urgency,
            hoursLeft:      Math.round(hoursLeft * 10) / 10,
            selection:      o.name,
            trueProb:       Math.round(trueProb * 1000) / 10,
            sharpPrice:     o.price,
            bestPrice,
            bestBook:       bestBookName || bestBookKey,
            allBookmakers:  allBookmakers.sort(function(a,b) { return b.price - a.price; }),
            edge:           Math.round(edge * 10) / 10,
            confidence,
            ev:             Math.round((trueProb * bestPrice - 1) * 1000) / 10,
            predScore,
            predLabel,
          });
        }
      }
    } catch (err) {
      console.warn('[scanner] ' + sport.key + ': ' + err.message);
    }
  }

  opportunities.sort(function(a, b) {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return b.edge - a.edge;
  });

  const result = {
    opportunities: opportunities.slice(0, 25),
    meta: { sportsScanned, eventsFound, totalOpportunities: opportunities.length },
    _scannedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, 900);
  res.json({ data: result, cached: false, apiUsage, scannedAt: result._scannedAt });
});

app.post('/api/cache/clear', (req, res) => {
  const sport = req.body && req.body.sport;
  if (sport) {
    ['events', 'odds', 'scores'].forEach(type => {
      cache.del(type + '_' + sport + '_all');
      cache.del(type + '_' + sport + '_all_stale');
    });
    cache.del('scanner_results');
    res.json({ ok: true, message: 'Cache vide pour ' + sport });
  } else {
    cache.del('scanner_results');
    res.json({ ok: true, message: 'Cache vide' });
  }
});

// -- SSE LIVE STREAM --
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  const sport = req.query.sport || 'tennis_atp';
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const client   = { id: clientId, res, sport };
  sseClients.add(client);
  console.log('[SSE] Client ' + clientId + ' connected (' + sport + ') total: ' + sseClients.size);

  res.write('event: connected\ndata: ' + JSON.stringify({ clientId, sport }) + '\n\n');

  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\ndata: ' + new Date().toISOString() + '\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    console.log('[SSE] Client ' + clientId + ' disconnected');
  });
});

async function broadcastScores() {
  if (sseClients.size === 0) return;
  try {
    // TheSportsDB uniquement — 0 quota Odds API
    const liveEvents = await getLiveScores();
    const payload = JSON.stringify({ liveMatches: liveEvents, timestamp: new Date().toISOString() });
    sseClients.forEach(client => client.res.write('event: scores\ndata: ' + payload + '\n\n'));
  } catch(e) {
    console.error('[broadcast]', e.message);
  }
}

setInterval(broadcastScores, 600000); // 10 min (était 2 min)

// -- KEEP-ALIVE (Render free tier) --
if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  console.log('[keep-alive] Active -> ping ' + selfUrl + '/health every 14 min');
  setInterval(() => {
    https.get(selfUrl + '/health', (res) => {
      console.log('[keep-alive] ping OK (' + res.statusCode + ')');
    }).on('error', (e) => {
      console.error('[keep-alive] ping FAIL:', e.message);
    });
  }, 14 * 60 * 1000);
}

// -- START --
app.listen(PORT, () => {
  console.log('');
  console.log('  OddsOracle Server v3.0');
  console.log('  http://localhost:' + PORT);
  console.log('  API Key: ' + (ODDS_API_KEY ? 'OK' : 'MISSING (.env)'));
  console.log('  Mode: ' + (process.env.NODE_ENV || 'development'));
  console.log('');
  if (!ODDS_API_KEY) {
    console.warn('  WARNING: ODDS_API_KEY not set -- live data disabled.');
    console.warn('  Get a free key at https://the-odds-api.com/');
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ESPN LIVE SIGNAL DETECTION  /api/live-signals
// ═══════════════════════════════════════════════════════════════════════
const ESPN_MAP = {
  tennis_atp: 'tennis/atp', tennis_wta: 'tennis/wta',
  soccer_epl: 'soccer/eng.1', soccer_france_ligue1: 'soccer/fra.1',
  soccer_spain_la_liga: 'soccer/esp.1', soccer_germany_bundesliga: 'soccer/ger.1',
  soccer_italy_serie_a: 'soccer/ita.1', soccer_europe_champs: 'soccer/uefa.champions',
  soccer_usa_mls: 'soccer/usa.1', soccer_brazil_campeonato: 'soccer/bra.1',
  soccer_argentina_primera_division: 'soccer/arg.1',
  soccer_portugal_primeira_liga: 'soccer/por.1',
  soccer_netherlands_eredivisie: 'soccer/ned.1',
  basketball_nba: 'basketball/nba', basketball_wnba: 'basketball/wnba',
  basketball_euroleague: 'basketball/eur.1',
  baseball_mlb: 'baseball/mlb',
  icehockey_nhl: 'hockey/nhl',
  americanfootball_nfl: 'football/nfl',
  mma_mixed_martial_arts: 'mma/ufc',
};

function espnName(c) {
  return (c && c.team && c.team.displayName) ||
         (c && c.athlete && c.athlete.displayName) || '';
}
function espnShort(c) {
  return (c && c.team && (c.team.shortDisplayName || c.team.abbreviation)) ||
         (c && c.athlete && c.athlete.shortName) || '';
}

function parseEspnSignals(comp, sportKey) {
  const sig = {
    kineA: false, kineB: false,
    breakA: false, breakB: false,
    momentumA: false, momentumB: false,
    suspension: false, coteMove: false, boiterieA: false,
    retirement: false, redCardA: false, redCardB: false,
  };
  const status    = comp.status    || {};
  const situation = comp.situation || {};
  const notes     = comp.notes     || [];
  const competitors = comp.competitors || [];

  // Match suspended
  const stName = (status.type || {}).name || '';
  if (stName === 'STATUS_SUSPENDED' || stName === 'STATUS_DELAYED') sig.suspension = true;

  // Medical / injury / retirement in notes
  const noteText = notes.map(n => (n.text || n.headline || '')).join(' ').toLowerCase();
  if (/medical|physio|trainer|kine|injury|injur/.test(noteText)) { sig.kineA = true; }
  if (/injur|retire|withdraw|walkover|retired/.test(noteText)) { sig.boiterieA = true; sig.retirement = true; }

  // Tennis specifics
  if (sportKey && sportKey.startsWith('tennis')) {
    const lp = (situation.lastPlay || '').toLowerCase();
    const serverId = situation.server ? String(situation.server) : '';
    if (/break/.test(lp)) {
      // server 0 = home/A broke serve, server 1 = away/B broke serve
      if (serverId === '1' || /home/.test(lp)) sig.breakA = true;
      else sig.breakB = true;
    }
    // Retirement from competitor status
    competitors.forEach(function(c, i) {
      if ((c.winner === false && c.score === '0') || /ret\.?$|retired/.test((c.score || '').toLowerCase())) {
        if (i === 0) sig.retirement = true;
      }
    });
  }

  // Football: red card from play-by-play or notes
  if (sportKey && sportKey.startsWith('soccer')) {
    if (/red card|expuls/.test(noteText)) { sig.redCardA = true; }
    // Check stats for corners/shots as momentum proxy
    const statsA = (competitors[0] || {}).statistics || [];
    const statsB = (competitors[1] || {}).statistics || [];
    const cornersA = parseInt((statsA.find(s => s.name === 'corners') || {}).displayValue || '0');
    const cornersB = parseInt((statsB.find(s => s.name === 'corners') || {}).displayValue || '0');
    if (cornersA - cornersB >= 3) sig.momentumA = true;
    if (cornersB - cornersA >= 3) sig.momentumB = true;
  }

  return sig;
}

app.get('/api/live-signals', async function(req, res) {
  const sport = req.query.sport || 'tennis_atp';
  const home  = req.query.home  || '';
  const away  = req.query.away  || '';

  const espnPath = ESPN_MAP[sport];
  if (!espnPath) return res.json({ found: false, reason: 'sport_not_mapped', sport });

  const cacheKey = 'espn_sb_' + sport;
  let sbData = cache.get(cacheKey);

  if (!sbData) {
    try {
      const url  = 'https://site.api.espn.com/apis/site/v2/sports/' + espnPath + '/scoreboard';
      const ctrl = new AbortController();
      const timer = setTimeout(function() { ctrl.abort(); }, 8000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('ESPN ' + r.status);
      sbData = await r.json();
      cache.set(cacheKey, sbData, 30); // 30s cache for live data
    } catch (err) {
      return res.json({ found: false, error: err.message });
    }
  }

  const events = sbData.events || [];

  // Return live event list when no specific match requested
  const liveList = events
    .filter(function(ev) {
      const st = ((ev.status || {}).type || {}).name || '';
      return st === 'STATUS_IN_PROGRESS' || st === 'STATUS_HALFTIME';
    })
    .map(function(ev) {
      const comp  = (ev.competitions || [])[0] || {};
      const comps = comp.competitors || [];
      return {
        id:        ev.id,
        name:      ev.shortName || ev.name,
        homeName:  espnName(comps[0]),
        awayName:  espnName(comps[1]),
        homeScore: (comps[0] || {}).score || '0',
        awayScore: (comps[1] || {}).score || '0',
        clock:     (ev.status || {}).displayClock || '',
        period:    (ev.status || {}).period || 1,
      };
    });

  if (!home) return res.json({ found: false, liveList, sport });

  // Find matching event
  let matched = null;
  for (const ev of events) {
    const comp  = (ev.competitions || [])[0] || {};
    const comps = comp.competitors || [];
    const n0 = espnName(comps[0]), n1 = espnName(comps[1]);
    if (
      (teamMatch(n0, home) && teamMatch(n1, away)) ||
      (teamMatch(n0, away) && teamMatch(n1, home))
    ) { matched = { ev, comp, comps }; break; }
    // Try short names
    const s0 = espnShort(comps[0]), s1 = espnShort(comps[1]);
    if (
      (teamMatch(s0, home) && teamMatch(s1, away)) ||
      (teamMatch(s0, away) && teamMatch(s1, home))
    ) { matched = { ev, comp, comps }; break; }
  }

  if (!matched) return res.json({ found: false, liveList, sport });

  const { ev, comp, comps } = matched;
  const signals = parseEspnSignals(comp, sport);
  const status  = ev.status || {};
  const period  = status.period || 1;
  const clock   = status.displayClock || '';

  // Linescores (sets / periods)
  const lsA = (comps[0] || {}).linescores || [];
  const lsB = (comps[1] || {}).linescores || [];
  const sets = lsA.map(function(ls, i) {
    return { period: i + 1, home: ls.value || 0, away: (lsB[i] || {}).value || 0 };
  });

  // Player/team stats
  const statsA = (comps[0] || {}).statistics || [];
  const statsB = (comps[1] || {}).statistics || [];
  function getStat(stats, name) {
    const s = stats.find(function(x) { return x.name === name || x.shortDisplayName === name; });
    return s ? s.displayValue : null;
  }

  res.json({
    found:     true,
    signals,
    score:     { home: (comps[0] || {}).score || '0', away: (comps[1] || {}).score || '0' },
    sets,
    period,
    clock,
    isLive:    ((status.type || {}).name || '').includes('IN_PROGRESS'),
    homeName:  espnName(comps[0]),
    awayName:  espnName(comps[1]),
    statsA: {
      aces:      getStat(statsA, 'aces'),
      doubleFaults: getStat(statsA, 'doubleFaults'),
      winner1stSv: getStat(statsA, 'firstServePointsWon'),
      shots:     getStat(statsA, 'shots'),
      possession: getStat(statsA, 'possessionPct'),
    },
    statsB: {
      aces:      getStat(statsB, 'aces'),
      doubleFaults: getStat(statsB, 'doubleFaults'),
      winner1stSv: getStat(statsB, 'firstServePointsWon'),
      shots:     getStat(statsB, 'shots'),
      possession: getStat(statsB, 'possessionPct'),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PLAYER FORM  /api/player-form
// ═══════════════════════════════════════════════════════════════════════
function calcStreak(results) {
  if (!results.length) return 0;
  let streak = 0;
  const last = results[0];
  for (const r of results) { if (r === last) streak++; else break; }
  return last === 'W' ? streak : -streak;
}

app.get('/api/player-form', async function(req, res) {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });

  const cacheKey = 'pform_' + normTeam(name);
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    // Search player on TheSportsDB
    const ctrl1 = new AbortController();
    setTimeout(function() { ctrl1.abort(); }, 6000);
    const r1 = await fetch(
      'https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=' + encodeURIComponent(name),
      { signal: ctrl1.signal }
    );
    const d1 = await r1.json();
    const players = d1.player || [];
    if (!players.length) return res.json({ found: false, name });

    const player = players[0];

    // Last events
    const ctrl2 = new AbortController();
    setTimeout(function() { ctrl2.abort(); }, 6000);
    const r2 = await fetch(
      'https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=' + player.idPlayer,
      { signal: ctrl2.signal }
    );
    const d2 = await r2.json();
    const events = (d2.results || []).slice(0, 10);

    const form = events.map(function(ev) {
      const isHome = teamMatch(ev.strHomeTeam || '', name);
      const hs = parseInt(ev.intHomeScore) || 0;
      const as_ = parseInt(ev.intAwayScore) || 0;
      let result = 'D';
      if (hs !== as_) result = (isHome ? hs > as_ : as_ > hs) ? 'W' : 'L';
      return {
        date:     ev.dateEvent,
        opponent: isHome ? ev.strAwayTeam : ev.strHomeTeam,
        score:    hs + '-' + as_,
        result,
      };
    });

    const wins    = form.filter(function(f) { return f.result === 'W'; }).length;
    const formPct = form.length ? Math.round(wins / form.length * 100) : null;
    const streak  = calcStreak(form.map(function(f) { return f.result; }));

    const result = {
      found:       true,
      name:        player.strPlayer,
      nationality: player.strNationality,
      birthDate:   player.dateBorn,
      position:    player.strPosition,
      thumb:       player.strThumb || player.strCutout || null,
      form:        form.slice(0, 5),
      formPct,
      wins,
      losses:      form.length - wins,
      streak,
    };

    cache.set(cacheKey, result, 1800);
    res.json(result);

  } catch (err) {
    res.json({ found: false, name, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// MATCH STATS — H2H + Forme + Mouvement cotes + Stats ESPN
// Inspiré Flashscore / bookmakers
// ═══════════════════════════════════════════════════════════════════════

// Récupère les derniers résultats d'une équipe/joueur (TheSportsDB)
async function fetchTeamRecentForm(name) {
  if (!name) return null;
  const cacheKey = 'form_' + normTeam(name);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const ctrl = new AbortController();
    setTimeout(function(){ ctrl.abort(); }, 5000);
    const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=' + encodeURIComponent(name), { signal: ctrl.signal });
    const d = await r.json();
    const players = d.player || [];
    if (!players.length) {
      // Try team search
      const ctrl2 = new AbortController();
      setTimeout(function(){ ctrl2.abort(); }, 5000);
      const r2 = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=' + encodeURIComponent(name), { signal: ctrl2.signal });
      const d2 = await r2.json();
      const teams = d2.teams || [];
      if (!teams.length) return null;
      const team = teams[0];
      const ctrl3 = new AbortController();
      setTimeout(function(){ ctrl3.abort(); }, 5000);
      const r3 = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=' + team.idTeam, { signal: ctrl3.signal });
      const d3 = await r3.json();
      const events = (d3.results || []).slice(0, 7);
      const form = events.map(function(ev) {
        const isHome = teamMatch(ev.strHomeTeam || '', name);
        const hs = parseInt(ev.intHomeScore) || 0, as = parseInt(ev.intAwayScore) || 0;
        let result = 'D';
        if (hs !== as) result = (isHome ? hs > as : as > hs) ? 'W' : 'L';
        return { date: ev.dateEvent, home: ev.strHomeTeam, away: ev.strAwayTeam, homeScore: hs, awayScore: as, result, venue: ev.strVenue || '' };
      });
      const wins = form.filter(function(f){ return f.result === 'W'; }).length;
      const homeFormArr = form.filter(function(f){ return teamMatch(f.home, name); });
      const awayFormArr = form.filter(function(f){ return !teamMatch(f.home, name); });
      const homeWinsH = homeFormArr.filter(function(f){ return f.result==='W'; }).length;
      const awayWinsA = awayFormArr.filter(function(f){ return f.result==='W'; }).length;
      const result = { name: team.strTeam, badge: team.strTeamBadge || null, form, homeForm: homeFormArr, awayForm: awayFormArr, homeFormPct: homeFormArr.length ? Math.round(homeWinsH/homeFormArr.length*100) : null, awayFormPct: awayFormArr.length ? Math.round(awayWinsA/awayFormArr.length*100) : null, formPct: form.length ? Math.round(wins/form.length*100) : null, streak: calcStreak(form.map(function(f){ return f.result; })), goalsScored: form.reduce(function(acc,f){ const isH = teamMatch(f.home,name); return acc + (isH ? f.homeScore : f.awayScore); },0), goalsConceded: form.reduce(function(acc,f){ const isH = teamMatch(f.home,name); return acc + (isH ? f.awayScore : f.homeScore); },0) };
      cache.set(cacheKey, result, 1800);
      return result;
    }
    // Player form
    const player = players[0];
    const ctrl4 = new AbortController();
    setTimeout(function(){ ctrl4.abort(); }, 5000);
    const r4 = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=' + player.idPlayer, { signal: ctrl4.signal });
    const d4 = await r4.json();
    const events = (d4.results || []).slice(0, 7);
    const form = events.map(function(ev) {
      const isHome = teamMatch(ev.strHomeTeam || '', name);
      const hs = parseInt(ev.intHomeScore) || 0, as = parseInt(ev.intAwayScore) || 0;
      let result = 'D';
      if (hs !== as) result = (isHome ? hs > as : as > hs) ? 'W' : 'L';
      return { date: ev.dateEvent, home: ev.strHomeTeam, away: ev.strAwayTeam, homeScore: hs, awayScore: as, result };
    });
    const wins = form.filter(function(f){ return f.result === 'W'; }).length;
    const result = { name: player.strPlayer, nationality: player.strNationality, thumb: player.strThumb || null, form, formPct: form.length ? Math.round(wins/form.length*100) : null, streak: calcStreak(form.map(function(f){ return f.result; })) };
    cache.set(cacheKey, result, 1800);
    return result;
  } catch(err) { return null; }
}

// Récupère le H2H entre deux équipes (TheSportsDB searchevents)
async function fetchH2H(homeTeam, awayTeam) {
  const cacheKey = 'h2h_' + normTeam(homeTeam) + '_' + normTeam(awayTeam);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const query = homeTeam + ' vs ' + awayTeam;
    const ctrl = new AbortController();
    setTimeout(function(){ ctrl.abort(); }, 5000);
    const r = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=' + encodeURIComponent(query), { signal: ctrl.signal });
    const d = await r.json();
    const events = (d.event || []).slice(0, 10).map(function(ev) {
      return {
        date: ev.dateEvent,
        home: ev.strHomeTeam, away: ev.strAwayTeam,
        homeScore: parseInt(ev.intHomeScore) || 0,
        awayScore: parseInt(ev.intAwayScore) || 0,
        venue: ev.strVenue || '',
        season: ev.strSeason || '',
      };
    });
    const homeWins  = events.filter(function(e){ return teamMatch(e.home, homeTeam) ? e.homeScore > e.awayScore : e.awayScore > e.homeScore; }).length;
    const awayWins  = events.filter(function(e){ return teamMatch(e.away, homeTeam) ? e.homeScore > e.awayScore : e.awayScore > e.homeScore; }).length;
    const draws     = events.filter(function(e){ return e.homeScore === e.awayScore; }).length;
    const result = { meetings: events, homeWins, awayWins, draws, total: events.length };
    cache.set(cacheKey, result, 3600);
    return result;
  } catch(err) { return null; }
}

app.get('/api/match-stats', async function(req, res) {
  const home    = req.query.home    || '';
  const away    = req.query.away    || '';
  const sport   = req.query.sport   || '';
  const matchId = req.query.matchId || '';

  try {
  const cacheKey = 'mstats_' + normTeam(home) + '_' + normTeam(away);
  const cached = cache.get(cacheKey);
  if (cached) {
    const mvHome = matchId ? getOddsMovement(matchId, home) : null;
    const mvAway = matchId ? getOddsMovement(matchId, away) : null;
    return res.json(Object.assign({}, cached, {
      oddsMovement: { homeTeam: mvHome, awayTeam: mvAway, drawTeam: null }
    }));
  }

  // Run all in parallel
  const [formHomeRes, formAwayRes, h2hRes, espnRes] = await Promise.allSettled([
    fetchTeamRecentForm(home),
    fetchTeamRecentForm(away),
    fetchH2H(home, away),
    (async function() {
      if (!sport) return null;
      const espnPath = ESPN_MAP[sport];
      if (!espnPath) return null;
      try {
        const url = 'https://site.api.espn.com/apis/site/v2/sports/' + espnPath + '/scoreboard';
        const ctrl = new AbortController();
        setTimeout(function(){ ctrl.abort(); }, 6000);
        const r = await fetch(url, { signal: ctrl.signal });
        if (!r.ok) return null;
        const sbData = await r.json();
        const events = sbData.events || [];
        for (const ev of events) {
          const comp  = (ev.competitions || [])[0] || {};
          const comps = comp.competitors || [];
          const n0 = espnName(comps[0]), n1 = espnName(comps[1]);
          if (!((teamMatch(n0,home) && teamMatch(n1,away)) || (teamMatch(n0,away) && teamMatch(n1,home)))) continue;
          const statsA = (comps[0] || {}).statistics || [];
          const statsB = (comps[1] || {}).statistics || [];
          function gs(stats, name) { const s = stats.find(function(x){ return x.name === name || x.abbreviation === name; }); return s ? s.displayValue : null; }
          // Incidents timeline (goals, cards, subs)
          const rawDetails = comp.details || [];
          const incidents = rawDetails.map(function(d) {
            const type = (d.type && d.type.text) || '';
            const clock = (d.clock && d.clock.displayValue) || '';
            const athletes = (d.athletesInvolved || []).map(function(a){ return a.displayName || a.shortName || ''; });
            const teamId = d.team ? String(d.team.id) : '';
            const homeId = comps[0] && comps[0].team ? String(comps[0].team.id) : '';
            const side = teamId === homeId ? 'home' : 'away';
            return { type, clock, athletes, side, scoring: !!d.scoringPlay, penalty: !!d.penaltyPlay, yellowCard: !!d.yellowCard, redCard: !!d.redCard };
          }).filter(function(d){ return d.type && d.clock; });
          // Venue + referee
          const venue = comp.venue ? { name: comp.venue.fullName || '', city: (comp.venue.address && comp.venue.address.city) || '', capacity: comp.venue.capacity || null } : null;
          const officials = (comp.officials || []);
          const referee = officials.find(function(o){ return /referee|arbitre/i.test((o.position && o.position.displayName) || ''); }) || officials[0] || null;
          const refereeInfo = referee ? { name: referee.fullName || referee.displayName || '', role: (referee.position && referee.position.displayName) || 'Arbitre' } : null;
          return {
            found: true,
            score: { home: (comps[0]||{}).score||'0', away: (comps[1]||{}).score||'0' },
            period: (ev.status||{}).period || 1,
            clock:  (ev.status||{}).displayClock || '',
            incidents,
            venue,
            referee: refereeInfo,
            statsA: { possession: gs(statsA,'possessionPct'), shots: gs(statsA,'shots'), shotsOnTarget: gs(statsA,'shotsOnTarget'), corners: gs(statsA,'cornerKicks'), yellowCards: gs(statsA,'yellowCards'), redCards: gs(statsA,'redCards'), fouls: gs(statsA,'foulsCommitted'), offsides: gs(statsA,'offsides'), xGoals: gs(statsA,'expectedGoals'), aces: gs(statsA,'aces'), doubleFaults: gs(statsA,'doubleFaults'), firstServePct: gs(statsA,'firstServeIn') },
            statsB: { possession: gs(statsB,'possessionPct'), shots: gs(statsB,'shots'), shotsOnTarget: gs(statsB,'shotsOnTarget'), corners: gs(statsB,'cornerKicks'), yellowCards: gs(statsB,'yellowCards'), redCards: gs(statsB,'redCards'), fouls: gs(statsB,'foulsCommitted'), offsides: gs(statsB,'offsides'), xGoals: gs(statsB,'expectedGoals'), aces: gs(statsB,'aces'), doubleFaults: gs(statsB,'doubleFaults'), firstServePct: gs(statsB,'firstServeIn') },
          };
        }
        return { found: false };
      } catch(e) { return null; }
    })()
  ]);

  const espnStats = espnRes.status === 'fulfilled' ? espnRes.value : null;
  const mvHome    = matchId ? getOddsMovement(matchId, home) : null;
  const mvAway    = matchId ? getOddsMovement(matchId, away) : null;

  const result = {
    home, away, sport,
    formHome:     formHomeRes.status === 'fulfilled' ? formHomeRes.value : null,
    formAway:     formAwayRes.status === 'fulfilled' ? formAwayRes.value : null,
    h2h:          h2hRes.status      === 'fulfilled' ? h2hRes.value      : null,
    espnStats:    espnStats,
    oddsMovement: { homeTeam: mvHome, awayTeam: mvAway, drawTeam: null },
  };

  // Cache 10 min (sans oddsMovement car dynamique)
  const toCache = Object.assign({}, result, { oddsMovement: null });
  cache.set(cacheKey, toCache, 600);

  res.json(result);
  } catch(err) {
    console.error('[match-stats]', err.message);
    res.status(500).json({ error: err.message, home, away });
  }
});

// -- SPA FALLBACK (doit être EN DERNIER après toutes les routes API) --
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
