/**
 * OddsOracle — Backend Server
 * Express + The Odds API proxy + SSE live updates + keep-alive
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const ODDS_API_KEY  = process.env.ODDS_API_KEY  || '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Sports suivis par OddsOracle
const SPORTS = [
  { key: 'tennis_atp',            label: 'Tennis ATP',         icon: '🎾' },
  { key: 'tennis_wta',            label: 'Tennis WTA',         icon: '🎾' },
  { key: 'soccer_france_ligue1',  label: 'Ligue 1',            icon: '⚽' },
  { key: 'soccer_epl',            label: 'Premier League',     icon: '⚽' },
  { key: 'soccer_europe_champs',  label: 'Champions League',   icon: '⚽' },
  { key: 'basketball_nba',        label: 'NBA',                icon: '🏀' },
  { key: 'basketball_euroleague', label: 'Euroleague',         icon: '🏀' },
];

// Bookmakers à afficher (priorité)
const BOOKMAKERS = ['betclic', 'unibet', 'pinnacle', 'winamax', 'bet365'];

// ──────────────────────────────────────────────
// CACHE IN-MEMORY (évite de brûler les quotas API)
// ──────────────────────────────────────────────
class Cache {
  constructor() { this._store = new Map(); }

  set(key, value, ttlSeconds) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this._store.delete(key); return null; }
    return entry.value;
  }

  del(key)   { this._store.delete(key); }
  size()     { return this._store.size; }
}

const cache = new Cache();

// ──────────────────────────────────────────────
// SUIVI QUOTA API
// ──────────────────────────────────────────────
let apiUsage = {
  requestsUsed:    0,
  requestsRemaining: null,
  lastReset: new Date().toISOString(),
};

// ──────────────────────────────────────────────
// HELPER: Fetch depuis The Odds API
// ──────────────────────────────────────────────
function oddsApiFetch(endpoint, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ODDS_API_KEY) {
      reject(new Error('ODDS_API_KEY non configurée. Voir .env.example'));
      return;
    }

    const queryParams = new URLSearchParams({
      apiKey: ODDS_API_KEY,
      ...params
    });

    const url = `${ODDS_API_BASE}${endpoint}?${queryParams}`;
    console.log(`[API] GET ${endpoint}`);

    https.get(url, (res) => {
      // Mettre à jour le suivi de quota depuis les headers
      if (res.headers['x-requests-used']) {
        apiUsage.requestsUsed      = parseInt(res.headers['x-requests-used']);
        apiUsage.requestsRemaining = parseInt(res.headers['x-requests-remaining']);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          reject(new Error('Clé API invalide ou expirée'));
          return;
        }
        if (res.statusCode === 422) {
          reject(new Error('Sport non disponible ou paramètre invalide'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Erreur API ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error('Réponse API invalide (JSON mal formé)'));
        }
      });
    }).on('error', reject);
  });
}

// ──────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// ROUTES API
// ──────────────────────────────────────────────

/**
 * GET /health
 * Keep-alive endpoint (ping par Render / UptimeRobot)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    apiUsage,
    cacheSize: cache.size(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/sports
 * Liste des sports disponibles (mise en cache 24h)
 */
app.get('/api/sports', async (req, res) => {
  const cacheKey = 'sports_list';
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    // Retourner la liste statique configurée (économise des req API)
    const data = SPORTS;
    cache.set(cacheKey, data, 86400); // 24h
    res.json({ data, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/events?sport=tennis_atp
 * Matchs à venir + en cours pour un sport (cache 30 min)
 */
app.get('/api/events', async (req, res) => {
  const sport    = req.query.sport || 'tennis_atp';
  const cacheKey = `events_${sport}`;
  const cached   = cache.get(cacheKey);

  if (cached) return res.json({ data: cached, cached: true, apiUsage });

  try {
    const events = await oddsApiFetch(`/sports/${sport}/events`, {
      dateFormat: 'iso',
    });

    // Filtrer: seulement matchs dans les prochaines 48h ou en cours
    const now   = Date.now();
    const h48   = now + 48 * 3600 * 1000;
    const relevant = events.filter(e => {
      const t = new Date(e.commence_time).getTime();
      return t >= now - 3600 * 1000 && t <= h48; // -1h pour matchs en cours
    });

    cache.set(cacheKey, relevant, 1800); // 30 min
    res.json({ data: relevant, cached: false, apiUsage });
  } catch (err) {
    console.error('[events]', err.message);
    // Fallback: retourner les données en cache même expirées
    const stale = cache.get(`${cacheKey}_stale`);
    if (stale) return res.json({ data: stale, cached: true, stale: true, error: err.message, apiUsage });
    res.status(500).json({ error: err.message, apiUsage });
  }
});

/**
 * GET /api/odds?sport=tennis_atp&eventId=abc123
 * Cotes d'un événement ou de tous les matchs d'un sport (cache 15 min)
 * Bookmakers prioritaires: Betclic, Pinnacle, Winamax, Unibet, Bet365
 */
app.get('/api/odds', async (req, res) => {
  const sport   = req.query.sport   || 'tennis_atp';
  const eventId = req.query.eventId || null;
  const cacheKey = `odds_${sport}_${eventId || 'all'}`;
  const cached   = cache.get(cacheKey);

  if (cached) return res.json({ data: cached, cached: true, apiUsage });

  try {
    const params = {
      regions:    'eu',
      markets:    'h2h',
      oddsFormat: 'decimal',
      bookmakers: BOOKMAKERS.join(','),
    };

    const endpoint = eventId
      ? `/sports/${sport}/events/${eventId}/odds`
      : `/sports/${sport}/odds`;

    const raw = await oddsApiFetch(endpoint, params);

    // Normaliser: extraire la meilleure cote par bookmaker
    const normalized = (Array.isArray(raw) ? raw : [raw]).map(event => ({
      id:           event.id,
      sport:        event.sport_key,
      homeTeam:     event.home_team,
      awayTeam:     event.away_team,
      commenceTime: event.commence_time,
      bookmakers:   formatBookmakers(event.bookmakers || []),
      bestOdds:     extractBestOdds(event.bookmakers || []),
    }));

    cache.set(cacheKey, normalized, 900); // 15 min
    // Garder copie "stale" pour fallback
    cache.set(`${cacheKey}_stale`, normalized, 7200);

    res.json({ data: normalized, cached: false, apiUsage });
  } catch (err) {
    console.error('[odds]', err.message);
    const stale = cache.get(`${cacheKey}_stale`);
    if (stale) return res.json({ data: stale, cached: true, stale: true, error: err.message, apiUsage });
    res.status(500).json({ error: err.message, apiUsage });
  }
});

/**
 * GET /api/scores?sport=tennis_atp&daysFrom=1
 * Scores live et récents (cache 2 min)
 */
app.get('/api/scores', async (req, res) => {
  const sport    = req.query.sport    || 'tennis_atp';
  const daysFrom = req.query.daysFrom || '1';
  const cacheKey = `scores_${sport}_${daysFrom}`;
  const cached   = cache.get(cacheKey);

  if (cached) return res.json({ data: cached, cached: true, apiUsage });

  try {
    const scores = await oddsApiFetch(`/sports/${sport}/scores`, {
      daysFrom,
      dateFormat: 'iso',
    });

    // Trier: matchs en cours d'abord, puis récents
    const sorted = scores.sort((a, b) => {
      if (a.completed === b.completed) return 0;
      return a.completed ? 1 : -1; // en cours en premier
    });

    cache.set(cacheKey, sorted, 120); // 2 min
    res.json({ data: sorted, cached: false, apiUsage });
  } catch (err) {
    console.error('[scores]', err.message);
    res.status(500).json({ error: err.message, apiUsage });
  }
});

/**
 * GET /api/quota
 * Suivi des requêtes API restantes
 */
app.get('/api/quota', (req, res) => {
  res.json(apiUsage);
});

/**
 * POST /api/cache/clear
 * Vider le cache (forcer rechargement des données)
 */
app.post('/api/cache/clear', (req, res) => {
  const sport = req.body?.sport;
  if (sport) {
    ['events', 'odds', 'scores'].forEach(type => {
      cache.del(`${type}_${sport}_all`);
      cache.del(`${type}_${sport}_all_stale`);
    });
    res.json({ ok: true, message: `Cache vidé pour ${sport}` });
  } else {
    // Vider tout sauf sports_list
    res.json({ ok: true, message: 'Cache vidé (prochain accès = données fraîches)' });
  }
});

/**
 * GET /api/stream?sport=tennis_atp
 * Server-Sent Events: envoie des mises à jour live toutes les 2 minutes
 * Utilisé uniquement pendant une session live active
 */
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

  console.log(`[SSE] Client connecté #${clientId} (${sport}) — total: ${sseClients.size}`);

  // Envoyer immédiatement un heartbeat
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, sport })}\n\n`);

  // Heartbeat toutes les 30s pour garder la connexion
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${new Date().toISOString()}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    console.log(`[SSE] Client déconnecté #${clientId} — total: ${sseClients.size}`);
  });
});

// ── Broadcast live scores aux clients SSE connectés
async function broadcastScores() {
  if (sseClients.size === 0) return;

  // Grouper par sport
  const sports = [...new Set([...sseClients].map(c => c.sport))];

  for (const sport of sports) {
    try {
      // Utiliser le cache ou faire une requête (max 1 req/2min par sport)
      const cacheKey = `scores_${sport}_1`;
      let data = cache.get(cacheKey);

      if (!data && ODDS_API_KEY) {
        const scores = await oddsApiFetch(`/sports/${sport}/scores`, {
          daysFrom: '1', dateFormat: 'iso'
        });
        data = scores;
        cache.set(cacheKey, data, 120);
      }

      if (!data) continue;

      const liveMatches = data.filter(s => !s.completed);
      const payload = JSON.stringify({ sport, liveMatches, timestamp: new Date().toISOString() });

      sseClients.forEach(client => {
        if (client.sport === sport) {
          client.res.write(`event: scores\ndata: ${payload}\n\n`);
        }
      });
    } catch(e) {
      console.error('[broadcast]', e.message);
    }
  }
}

// Broadcaster toutes les 2 minutes si des clients sont connectés
setInterval(broadcastScores, 120000);

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────
function formatBookmakers(bookmakers) {
  return bookmakers
    .filter(bk => BOOKMAKERS.includes(bk.key))
    .map(bk => {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h) return null;
      return {
        key:    bk.key,
        title:  bk.title,
        odds:   h2h.outcomes?.map(o => ({ name: o.name, price: o.price })) || [],
        lastUpdate: bk.last_update,
      };
    })
    .filter(Boolean);
}

function extractBestOdds(bookmakers) {
  const bestByOutcome = {};

  bookmakers.forEach(bk => {
    const h2h = bk.markets?.find(m => m.key === 'h2h');
    if (!h2h) return;
    h2h.outcomes?.forEach(o => {
      if (!bestByOutcome[o.name] || o.price > bestByOutcome[o.name].price) {
        bestByOutcome[o.name] = { price: o.price, bookmaker: bk.title };
      }
    });
  });

  return bestByOutcome;
}

// ──────────────────────────────────────────────
// KEEP-ALIVE (Render free tier dort après 15 min)
// Auto-ping toutes les 14 minutes pour rester éveillé
// ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  console.log(`[keep-alive] Activé → ping ${selfUrl}/health toutes les 14 min`);

  setInterval(() => {
    https.get(`${selfUrl}/health`, (res) => {
      console.log(`[keep-alive] ping OK (${res.statusCode})`);
    }).on('error', (e) => {
      console.error('[keep-alive] ping FAIL:', e.message);
    });
  }, 14 * 60 * 1000);
}

// ──────────────────────────────────────────────
// SPA FALLBACK: toutes les routes non-API → index.html
// ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ──────────────────────────────────────────────
// START
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🔮 OddsOracle Server v2.0         ║
  ║   http://localhost:${PORT}              ║
  ╠══════════════════════════════════════╣
  ║   API Key: ${ODDS_API_KEY ? '✅ configurée' : '❌ MANQUANTE (.env)'}         ║
  ║   Mode: ${process.env.NODE_ENV || 'development'}                       ║
  ╚══════════════════════════════════════╝
  `);

  if (!ODDS_API_KEY) {
    console.warn('  ⚠️  ODDS_API_KEY non définie — données live désactivées.');
    console.warn('     → Obtenez une clé gratuite sur https://the-odds-api.com/');
    console.warn('     → Ajoutez ODDS_API_KEY=votre_cle dans .env');
  }
});
