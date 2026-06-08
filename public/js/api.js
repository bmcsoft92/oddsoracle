/**
 * OddsOracle — API Client (Frontend)
 * Communique avec le backend Express pour les données live
 */

const APIClient = (() => {

  // Base URL : en dev = localhost:3000, en prod = même domaine
  const BASE = window.location.origin;

  let sseSource = null;
  let liveCallbacks = [];
  let _quotaInfo = null;

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────
  async function apiFetch(path, options = {}) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      return json;
    } catch (err) {
      console.warn(`[APIClient] ${path} →`, err.message);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  // SPORTS
  // ──────────────────────────────────────────────
  async function getSports() {
    const r = await apiFetch('/api/sports');
    return r.data;
  }

  // ──────────────────────────────────────────────
  // EVENTS (matchs à venir / en cours)
  // ──────────────────────────────────────────────
  async function getEvents(sport = 'tennis_atp') {
    const r = await apiFetch(`/api/events?sport=${encodeURIComponent(sport)}`);
    return r.data;
  }

  // ──────────────────────────────────────────────
  // ODDS (cotes en direct)
  // ──────────────────────────────────────────────
  async function getOdds(sport = 'tennis_atp', eventId = null) {
    let url = `/api/odds?sport=${encodeURIComponent(sport)}`;
    if (eventId) url += `&eventId=${encodeURIComponent(eventId)}`;
    const r = await apiFetch(url);
    if (r.apiUsage) _quotaInfo = r.apiUsage;
    return r.data;
  }

  // ──────────────────────────────────────────────
  // SCORES (live + récents)
  // ──────────────────────────────────────────────
  async function getScores(sport = 'tennis_atp', daysFrom = 1) {
    const r = await apiFetch(`/api/scores?sport=${encodeURIComponent(sport)}&daysFrom=${daysFrom}`);
    return r.data;
  }

  // ──────────────────────────────────────────────
  // QUOTA
  // ──────────────────────────────────────────────
  async function getQuota() {
    const r = await apiFetch('/api/quota');
    _quotaInfo = r;
    return r;
  }

  function getLastQuota() { return _quotaInfo; }

  // ──────────────────────────────────────────────
  // SSE — LIVE STREAM
  // Se connecte quand l'onglet Live est ouvert
  // Se déconnecte automatiquement à la fermeture
  // ──────────────────────────────────────────────
  function connectLiveStream(sport, onScores, onConnect) {
    disconnectLiveStream(); // fermer l'ancienne si existe

    const url = `${BASE}/api/stream?sport=${encodeURIComponent(sport)}`;
    sseSource = new EventSource(url);

    sseSource.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      console.log('[SSE] Connecté, id:', data.clientId);
      if (onConnect) onConnect(data);
    });

    sseSource.addEventListener('scores', (e) => {
      const data = JSON.parse(e.data);
      if (onScores) onScores(data);
    });

    sseSource.addEventListener('heartbeat', () => {
      // Connexion maintenue
    });

    sseSource.onerror = (err) => {
      console.warn('[SSE] Erreur connexion, reconnexion auto...');
    };

    return sseSource;
  }

  function disconnectLiveStream() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
      console.log('[SSE] Déconnecté');
    }
  }

  // ──────────────────────────────────────────────
  // UTILITAIRES
  // ──────────────────────────────────────────────

  /**
   * Formater un match depuis l'API pour l'afficher dans le sélecteur
   * Retourne { id, label, homeTeam, awayTeam, commenceTime, sport }
   */
  function formatMatchOption(event) {
    const date  = new Date(event.commenceTime || event.commence_time);
    const now   = Date.now();
    const diff  = date.getTime() - now;
    const isLive = Math.abs(diff) < 4 * 3600 * 1000; // ±4h = potentiellement en cours

    const timeLabel = isLive && diff < 0
      ? '🔴 EN COURS'
      : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const home = event.homeTeam || event.home_team || '';
    const away = event.awayTeam || event.away_team || '';

    return {
      id:           event.id,
      label:        `${timeLabel} — ${home} vs ${away}`,
      homeTeam:     home,
      awayTeam:     away,
      commenceTime: event.commenceTime || event.commence_time,
      sport:        event.sport || event.sport_key,
      isLive,
    };
  }

  /**
   * Extraire les meilleures cotes d'un objet event (retourné par /api/odds)
   * Retourne { homeOdds, awayOdds, bestBookmaker }
   */
  function extractOdds(eventWithOdds) {
    const best = eventWithOdds.bestOdds || {};
    const home = eventWithOdds.homeTeam;
    const away = eventWithOdds.awayTeam;

    return {
      homeOdds:      best[home]?.price || null,
      awayOdds:      best[away]?.price || null,
      homeBookmaker: best[home]?.bookmaker || null,
      awayBookmaker: best[away]?.bookmaker || null,
      allBookmakers: eventWithOdds.bookmakers || [],
    };
  }

  /**
   * Vérifier si le serveur/API est disponible
   */
  async function checkApiStatus() {
    try {
      const r = await apiFetch('/health');
      return {
        online:    true,
        apiKeySet: !r.apiUsage?.requestsRemaining === null,
        uptime:    r.uptime,
        apiUsage:  r.apiUsage,
      };
    } catch(e) {
      return { online: false, error: e.message };
    }
  }

  return {
    getSports,
    getEvents,
    getOdds,
    getScores,
    getQuota,
    getLastQuota,
    connectLiveStream,
    disconnectLiveStream,
    formatMatchOption,
    extractOdds,
    checkApiStatus,
  };
})();
