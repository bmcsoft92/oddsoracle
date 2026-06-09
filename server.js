/**
 * OddsOracle -- Backend Server v3.0
 * Express + The Odds API proxy + SSE live updates + Scanner IA + keep-alive
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');

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

// -- SCANNER IA --
app.get('/api/scanner', async (req, res) => {
  const cacheKey = 'scanner_results';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true, apiUsage, scannedAt: cached._scannedAt });

  if (!ODDS_API_KEY) {
    return res.status(503).json({ error: 'ODDS_API_KEY non configuree', apiUsage });
  }

  const opportunities = [];
  const now = Date.now();
  const h48 = now + 48 * 3600 * 1000;
  let sportsScanned = 0;
  let eventsFound   = 0;

  for (const sport of SPORTS) {
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

          // Tableau complet de toutes les cotes par bookmaker pour cette selection
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

          // Prediction: recommandation basee sur l'edge et la confiance
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
  const sports = [...new Set([...sseClients].map(c => c.sport))];
  for (const sport of sports) {
    try {
      const cacheKey = 'scores_' + sport + '_1';
      let data = cache.get(cacheKey);
      if (!data && ODDS_API_KEY) {
        const scores = await oddsApiFetch('/sports/' + sport + '/scores', { daysFrom: '1', dateFormat: 'iso' });
        data = scores;
        cache.set(cacheKey, data, 120);
      }
      if (!data) continue;
      const liveMatches = data.filter(s => !s.completed);
      const payload = JSON.stringify({ sport, liveMatches, timestamp: new Date().toISOString() });
      sseClients.forEach(client => {
        if (client.sport === sport) client.res.write('event: scores\ndata: ' + payload + '\n\n');
      });
    } catch(e) {
      console.error('[broadcast]', e.message);
    }
  }
}

setInterval(broadcastScores, 120000);

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

// -- SPA FALLBACK --
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
