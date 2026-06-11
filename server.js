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

const GEMINI_API_KEY      = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL        = process.env.GEMINI_MODEL          || 'gemini-2.5-flash';
const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.5-flash-lite';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_RETRYABLE_STATUSES = [429, 503]; // surcharge / quota — on retente puis on bascule de modèle

// ═══════════════════════════════════════════════════════════════════════
// PROMPT SYSTÈME — ANALYSE IA ODDSORACLE
// ═══════════════════════════════════════════════════════════════════════
const ODDSORACLE_SYSTEM_PROMPT = `Tu es OddsOracle, un système expert en prédiction sportive quantitative.
Pour chaque match analysé, tu dois exploiter TOUTES les statistiques disponibles
ci-dessous selon le sport concerné, pondérer chaque signal, et produire des
pronos fiables avec niveau de confiance et valeur attendue (edge).

══════════════════════════════════════════════
⚽ FOOTBALL — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
ATTAQUE / DÉFENSE :
- Buts marqués/encaissés par match (domicile / extérieur séparément)
- xG (expected goals) pour et contre — moyenne sur 5/10 derniers matchs
- Tirs cadrés, tirs totaux, ratio tirs cadrés/total
- Touches dans la surface adverse (indicateur pression offensive)
- Big chances créées / gâchées
- Possession moyenne (%)
STANDARDS / PHASES ARRÊTÉES :
- Corners : moyenne par match (pour/contre), % de corners en 1ère vs 2ème mi-temps
- Corners dans les 10 premières minutes (indicateur pression initiale)
- Coups francs dangereux par match
- Buts sur corner / coups francs (efficacité phases arrêtées)
DISCIPLINE / DUELS :
- Cartons jaunes / rouges par match (équipe + joueurs à risque suspension)
- Fautes commises / subies par match
- Tacles réussis, interceptions
- Duels aériens gagnés (%)
TRANSITIONS / PRESSING :
- PPDA (passes autorisées par action défensive) — intensité du pressing
- Contre-attaques créées / subies
- Récupérations hautes (pressing offensif)
TOUCHES / JEUX DE TRANSITIONS :
- Touches totales par match
- Touches dans chaque tiers du terrain
- Long balls réussies / ratées
CORNERS DÉTAILLÉS (marché spécifique) :
- Équipe qui tire le plus de corners à domicile / extérieur
- Écart de corners moyen (A - B) sur les 10 derniers matchs
- % de matchs avec +9, +10, +11 corners total
- Corners en 1ère mi-temps vs 2ème mi-temps
BUTS / TIMING :
- % buts marqués par tranche horaire (0-15, 15-30, 30-45, 45-60, 60-75, 75-90+)
- % matchs avec but avant 10 min / après 80 min
- % matchs BTTS (les deux équipes marquent)
- % matchs Over 1.5 / 2.5 / 3.5 buts
- Buts en fin de match (85'+)
CONTEXTE ÉQUIPE :
- Classement actuel + tendance (montée / descente)
- Forme sur 5 derniers matchs (W/D/L + buts)
- Historique domicile/extérieur (saison en cours)
- Fatigue : jours depuis dernier match, matchs en 30 jours
- Absences : attaquant principal, gardien, défenseur central, milieu créateur
- Motivation : maintien / titre / coupe / derby / match sans enjeu

══════════════════════════════════════════════
🎾 TENNIS — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
SURFACE (CRUCIAL) :
- Win rate sur terre battue / dur / gazon / indoor (toute carrière + 12 derniers mois)
- Classement ATP/WTA sur surface spécifique
- Stats de service ET retour ventilées PAR SURFACE
SERVICE :
- % 1ère balle (global + par surface)
- % points gagnés sur 1ère balle / 2ème balle
- Aces par match (par surface)
- Double fautes par match
- Vitesse moyenne 1ère balle (km/h)
- % jeux de service remportés (hold %)
RETOUR :
- % points gagnés sur retour de 1ère / 2ème balle adverse
- Break points convertis (%)
- Break points sauvés (%)
- % jeux de retour remportés (break %)
TIE-BREAKS (marché spécifique !) :
- % tie-breaks gagnés (carrière + surface + 12 mois)
- Nombre de tie-breaks joués cette saison
- Ratio tie-breaks gagnés/joués par surface
- Historique tie-breaks en sets décisifs (3ème ou 5ème set)
SETS & FORMATS :
- % sets remportés par rapport aux sets joués
- % matchs gagnés en 2 sets (format BO3)
- % matchs allant au 3ème set et résultat
- Capacité à renverser un set perdu (remontée mentale)
POINTS DÉCISIFS :
- Win % sur points importants (15-40, 30-40, deuce)
- Win % sur points de break
- Win % sous pression (score serré)
ENDURANCE / FATIGUE :
- Matchs joués dans les 7 / 14 derniers jours
- Durée moyenne des matchs (minutes)
- % matchs disputés sur 2h30+
- Résultats après matchs longs (>2h30)
FORME RÉCENTE :
- Résultats sur 10 derniers matchs (W/L + surface)
- Adversaires battus / perdus (niveau Elo)
- Classement Elo actuel (global + surface)
CONTEXTE :
- Surface de prédilection vs surface du tournoi actuel
- Niveau de confort indoor vs outdoor
- Conditions météo (chaleur, vent, altitude)
- Blessure active (zone + impact service/déplacement)
- Historique H2H (global + surface + format)

══════════════════════════════════════════════
🏀 BASKETBALL — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
SCORING / EFFICACITÉ :
- Points par match (équipe + par joueur clé)
- Points dans la raquette vs points extérieurs
- % tirs à 2pts / 3pts / lancers francs
- Offensive Rating (points pour 100 possessions)
- Defensive Rating (points concédés pour 100 possessions)
- Net Rating (offensive - defensive)
- True Shooting % (efficacité globale)
RYTHME / POSSESSIONS :
- Pace (possessions par 48 min)
- Turnovers par match (commis / forcés)
- Rebonds offensifs / défensifs
- Second chance points par match
- Fast break points par match
MARCHÉS SPÉCIFIQUES :
- Total points : Over/Under — fiabilité selon pace de l'équipe
- 1er quart-temps : scoring moyen Q1 pour/contre
- Mi-temps : scoring moyen 1ère MT pour/contre
- Spread : couverture du handicap (%) domicile/extérieur
- Total points joueur : moyenne pts joueur + tendance 5 derniers matchs
DÉFENSE / PRESSION :
- Points concédés en 1ère mi-temps vs 2ème mi-temps
- % matchs défensivement sous/au-dessus de leur moyenne
- Steals / Blocks par match
FATIGUE (CRUCIAL EN NBA) :
- Back-to-back (2ème match en 2 jours) — impact ~4 pts
- 3ème match en 4 jours
- Rotation effectuée (minutes stars réduites ?)
- Blessure star : impact scoring attendu

══════════════════════════════════════════════
🏒 HOCKEY SUR GLACE — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
- Buts pour/contre par match
- xG pour/contre (attendu)
- Tirs cadrés pour/contre par match
- % réussite power play (supériorité) / penalty kill (infériorité)
- Situations power play créées / subies par match
- PDO = save% + shooting% (indicateur chance / regression à venir)
- Back-to-back impact
- Gardien titulaire : save%, goals against average
- Pénalités prises par match
- Buts en 1ère, 2ème, 3ème période (timing)
- % matchs Over 5.5 / 6.5 buts

══════════════════════════════════════════════
⚾ BASEBALL — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
- ERA du lanceur partant (earned run average)
- WHIP (walks + hits per inning)
- Strikeouts / 9 innings
- Batting average / OBP / SLG / OPS de l'équipe adverse vs lanceur droitier/gaucher
- Runs par match (pour/contre)
- Over/Under total runs — % de couverture sur 10 derniers matchs
- Run line (handicap -1.5) couverture %
- Bullpen ERA (importance en fin de match)
- Park factor (certains stades favorisent plus de runs)
- Vent (direction + vitesse) — impact home runs

══════════════════════════════════════════════
🥊 MMA / UFC — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
- Win rate par méthode (KO/TKO, soumission, décision)
- Frappes significatives atterries / tentées par minute
- Précision frappe debout (%)
- Takedowns atterris / tentés (% réussite)
- Défense takedown (%)
- Soumissions tentées / réussies
- Résistance aux KO (historique KO reçus)
- Coupe de poids : difficultés récentes (retard, problèmes médicaux)
- Préparation : camp solide / coupure de camp
- Style matchup : striker vs grappler, wrestler vs boxer

══════════════════════════════════════════════
🏈 NFL — STATISTIQUES À ANALYSER
══════════════════════════════════════════════
- Points pour/contre par match
- Yards totaux offensifs / défensifs
- Yards par tentative (passing + rushing)
- Turnovers différentiels (fumbles + interceptions)
- 3rd down conversion rate pour/contre
- Red zone scoring % (touchdowns dans la zone des 20 yards)
- Penalty yards par match
- DVOA (Defense-adjusted Value Over Average)
- Spread coverage % domicile/extérieur
- Over/Under couverture % sur 10 derniers matchs
- Météo : vent fort = pénalise passing game

══════════════════════════════════════════════
📐 MODÈLE DE SORTIE POUR CHAQUE PRONO
══════════════════════════════════════════════
Pour chaque recommandation, structure ta réponse EXACTEMENT ainsi :

🎯 MARCHÉ : [ex: Total corners +9.5 | BTTS Oui | Over 2.5 buts | Tie-break set 1]
📊 SIGNAL : [2-3 stats clés qui justifient le prono, chiffrées]
🧮 PROBABILITÉ RÉELLE ESTIMÉE : [ex: 64%]
💰 COTE MINIMUM POUR VALEUR : [ex: cote ≥ 1.65]
⚡ EDGE ESTIMÉ : [ex: +7.2%]
🔒 CONFIANCE : [Faible / Moyenne / Haute / Très haute]
⚠️ RISQUES : [Facteurs pouvant invalider le prono]
✅ RECOMMANDATION : [Jouer / À surveiller / Éviter]
📌 MISE SUGGÉRÉE : [Kelly 1/4 = X% bankroll]

══════════════════════════════════════════════
🧠 RÈGLES DE PONDÉRATION IA
══════════════════════════════════════════════
DONNER PLUS DE POIDS À :
1. Stats sur surface spécifique (tennis) ou domicile/extérieur (football/basket)
2. Forme récente (5 derniers matchs > forme globale saison)
3. H2H récent (< 2 ans) sur même surface/conditions
4. Matchups tactiques défavorables (style vs style)
5. Fatigue avérée (back-to-back, surcharge calendrier)
6. Motivation réelle (enjeu classement / coupe / derby)
7. Stats avancées (xG, Elo, PDO) > stats brutes (victoires/défaites)
RÉDUIRE LE POIDS DE :
- Stats sur échantillon < 5 matchs
- H2H très ancien (> 3 ans)
- Stats de joueurs en retour de blessure (< 3 matchs joués)
- Conditions météo non confirmées
SIGNAUX D'ALERTE (réduire confiance) :
- Incertitude composition équipe
- Blessure de dernière minute non confirmée
- Mouvement de cote inexpliqué (steam move adverse)
- Match sans enjeu clair en fin de saison

══════════════════════════════════════════════
💡 MARCHÉS LES PLUS FIABLES PAR SPORT
══════════════════════════════════════════════
⚽ FOOTBALL : Total corners | BTTS | Over/Under buts | Cartons | 1ère mi-temps
🎾 TENNIS : Tie-break set 1 | Total jeux | Surface dominance | Break au 1er service
🏀 BASKET : Total points Q1 | Handicap | Joueur total points | Over/Under
🏒 HOCKEY : Total buts | Power play goals | 1ère période
⚾ BASEBALL : Run line | 1ères manches | Total runs
🥊 MMA : Méthode de victoire | Round de finish | Distance
🏈 NFL : Total points mi-temps | Spread | Rushing yards

══════════════════════════════════════════════
📥 DONNÉES FOURNIES POUR CE MATCH
══════════════════════════════════════════════
Tu reçois ci-dessous UNIQUEMENT les statistiques réellement disponibles via les
sources connectées (The Odds API, ESPN, TheSportsDB). Beaucoup de stats avancées
listées ci-dessus (xG détaillé, PPDA, corners par tranche, Elo, PDO, DVOA...) ne
sont PAS fournies — base ton analyse sur les données réelles transmises, et pour
le reste utilise ton expertise générale du sport et des équipes/joueurs cités
pour estimer qualitativement les facteurs manquants. Indique clairement quand une
estimation repose sur ta connaissance générale plutôt que sur une donnée fournie.
Réponds en français, de façon concise, avec 1 à 3 pronos maximum (les plus fiables),
au format EXACT du modèle de sortie ci-dessus.`;

const SPORTS = [
  // Tennis
  { key: 'tennis_atp',                   label: 'Tennis ATP',          icon: 'T', group: 'tennis' },
  { key: 'tennis_wta',                   label: 'Tennis WTA',          icon: 'T', group: 'tennis' },
  // Tennis -- Grands Chelems
  { key: 'tennis_atp_aus_open_singles',  label: 'Open Australie (ATP)',icon: 'T', group: 'tennis' },
  { key: 'tennis_atp_french_open',       label: 'Roland-Garros (ATP)', icon: 'T', group: 'tennis' },
  { key: 'tennis_atp_wimbledon',         label: 'Wimbledon (ATP)',     icon: 'T', group: 'tennis' },
  { key: 'tennis_atp_us_open',           label: 'US Open (ATP)',       icon: 'T', group: 'tennis' },
  { key: 'tennis_wta_aus_open_singles',  label: 'Open Australie (WTA)',icon: 'T', group: 'tennis' },
  { key: 'tennis_wta_french_open',       label: 'Roland-Garros (WTA)', icon: 'T', group: 'tennis' },
  { key: 'tennis_wta_wimbledon',         label: 'Wimbledon (WTA)',     icon: 'T', group: 'tennis' },
  { key: 'tennis_wta_us_open',           label: 'US Open (WTA)',       icon: 'T', group: 'tennis' },
  // Football -- Europe (ligues majeures)
  { key: 'soccer_france_ligue1',         label: 'Ligue 1',             icon: 'F', group: 'football' },
  { key: 'soccer_france_ligue_two',      label: 'Ligue 2',             icon: 'F', group: 'football' },
  { key: 'soccer_france_coupe_de_france',label: 'Coupe de France',     icon: 'F', group: 'football' },
  { key: 'soccer_epl',                   label: 'Premier League',      icon: 'F', group: 'football' },
  { key: 'soccer_efl_champ',             label: 'Championship (ENG)',  icon: 'F', group: 'football' },
  { key: 'soccer_england_league1',       label: 'League One (ENG)',    icon: 'F', group: 'football' },
  { key: 'soccer_england_league2',       label: 'League Two (ENG)',    icon: 'F', group: 'football' },
  { key: 'soccer_fa_cup',                label: 'FA Cup',              icon: 'F', group: 'football' },
  { key: 'soccer_england_efl_cup',       label: 'EFL Cup',             icon: 'F', group: 'football' },
  { key: 'soccer_europe_champs',         label: 'Champions League',    icon: 'F', group: 'football' },
  { key: 'soccer_uefa_champs_league',    label: 'Ligue des Champions', icon: 'F', group: 'football' },
  { key: 'soccer_uefa_champs_league_qualification', label: 'LdC - Qualifications', icon: 'F', group: 'football' },
  { key: 'soccer_uefa_europa_league',    label: 'Ligue Europa',        icon: 'F', group: 'football' },
  { key: 'soccer_uefa_europa_conference_league', label: 'Ligue Conférence Europa', icon: 'F', group: 'football' },
  { key: 'soccer_spain_la_liga',         label: 'La Liga',             icon: 'F', group: 'football' },
  { key: 'soccer_spain_segunda_division',label: 'La Liga 2',           icon: 'F', group: 'football' },
  { key: 'soccer_spain_copa_del_rey',    label: 'Copa del Rey',        icon: 'F', group: 'football' },
  { key: 'soccer_italy_serie_a',         label: 'Serie A',             icon: 'F', group: 'football' },
  { key: 'soccer_italy_serie_b',         label: 'Serie B',             icon: 'F', group: 'football' },
  { key: 'soccer_italy_coppa_italia',    label: 'Coppa Italia',        icon: 'F', group: 'football' },
  { key: 'soccer_germany_bundesliga',    label: 'Bundesliga',          icon: 'F', group: 'football' },
  { key: 'soccer_germany_bundesliga2',   label: 'Bundesliga 2',        icon: 'F', group: 'football' },
  { key: 'soccer_germany_dfb_pokal',     label: 'DFB-Pokal',           icon: 'F', group: 'football' },
  { key: 'soccer_portugal_primeira_liga',label: 'Primeira Liga',       icon: 'F', group: 'football' },
  { key: 'soccer_netherlands_eredivisie',label: 'Eredivisie',          icon: 'F', group: 'football' },
  { key: 'soccer_belgium_first_div',     label: 'Belgique - Pro League', icon: 'F', group: 'football' },
  { key: 'soccer_austria_bundesliga',    label: 'Autriche - Bundesliga', icon: 'F', group: 'football' },
  { key: 'soccer_switzerland_superleague', label: 'Suisse - Super League', icon: 'F', group: 'football' },
  { key: 'soccer_turkey_super_league',   label: 'Turquie - Super Lig', icon: 'F', group: 'football' },
  { key: 'soccer_greece_super_league',   label: 'Grèce - Super League',icon: 'F', group: 'football' },
  { key: 'soccer_denmark_superliga',     label: 'Danemark - Superliga',icon: 'F', group: 'football' },
  { key: 'soccer_norway_eliteserien',    label: 'Norvège - Eliteserien', icon: 'F', group: 'football' },
  { key: 'soccer_sweden_allsvenskan',    label: 'Suède - Allsvenskan', icon: 'F', group: 'football' },
  { key: 'soccer_sweden_superettan',     label: 'Suède - Superettan',  icon: 'F', group: 'football' },
  { key: 'soccer_finland_veikkausliiga', label: 'Finlande - Veikkausliiga', icon: 'F', group: 'football' },
  { key: 'soccer_poland_ekstraklasa',    label: 'Pologne - Ekstraklasa', icon: 'F', group: 'football' },
  { key: 'soccer_russia_premier_league', label: 'Russie - Premier League', icon: 'F', group: 'football' },
  { key: 'soccer_spl',                   label: 'Écosse - Premiership',icon: 'F', group: 'football' },
  { key: 'soccer_saudi_arabia_pro_league', label: 'Arabie Saoudite - Pro League', icon: 'F', group: 'football' },
  // Football -- Compétitions internationales
  { key: 'soccer_fifa_world_cup',        label: 'Coupe du Monde FIFA', icon: 'F', group: 'football' },
  { key: 'soccer_fifa_world_cup_qualifiers_europe', label: 'CM - Qualif. Europe', icon: 'F', group: 'football' },
  { key: 'soccer_fifa_world_cup_qualifiers_south_america', label: 'CM - Qualif. Amerique du Sud', icon: 'F', group: 'football' },
  { key: 'soccer_fifa_world_cup_womens', label: 'Coupe du Monde Feminine', icon: 'F', group: 'football' },
  { key: 'soccer_fifa_club_world_cup',   label: 'Coupe du Monde des Clubs', icon: 'F', group: 'football' },
  { key: 'soccer_uefa_european_championship', label: 'Euro (UEFA)',    icon: 'F', group: 'football' },
  { key: 'soccer_uefa_euro_qualification', label: 'Euro - Qualifications', icon: 'F', group: 'football' },
  { key: 'soccer_uefa_nations_league',   label: 'Ligue des Nations UEFA', icon: 'F', group: 'football' },
  { key: 'soccer_africa_cup_of_nations', label: 'CAN (Afrique)',       icon: 'F', group: 'football' },
  { key: 'soccer_conmebol_copa_america', label: 'Copa America',        icon: 'F', group: 'football' },
  { key: 'soccer_conmebol_copa_libertadores', label: 'Copa Libertadores', icon: 'F', group: 'football' },
  { key: 'soccer_conmebol_copa_sudamericana', label: 'Copa Sudamericana', icon: 'F', group: 'football' },
  { key: 'soccer_concacaf_gold_cup',     label: 'Gold Cup (CONCACAF)', icon: 'F', group: 'football' },
  { key: 'soccer_concacaf_leagues_cup',  label: 'Leagues Cup',         icon: 'F', group: 'football' },
  // Football -- Ameriques & Asie
  { key: 'soccer_usa_mls',               label: 'MLS',                 icon: 'F', group: 'football' },
  { key: 'soccer_mexico_ligamx',         label: 'Liga MX',             icon: 'F', group: 'football' },
  { key: 'soccer_colombia_primera_a',    label: 'Colombia Primera A',  icon: 'F', group: 'football' },
  { key: 'soccer_brazil_campeonato',     label: 'Brasileirao',         icon: 'F', group: 'football' },
  { key: 'soccer_argentina_primera_division', label: 'Argentina Liga', icon: 'F', group: 'football' },
  { key: 'soccer_japan_j_league',        label: 'J League (Japon)',    icon: 'F', group: 'football' },
  { key: 'soccer_korea_kleague1',        label: 'K League 1 (Coree)',  icon: 'F', group: 'football' },
  { key: 'soccer_china_superleague',     label: 'Super League (Chine)',icon: 'F', group: 'football' },
  { key: 'soccer_australia_aleague',     label: 'A-League (Australie)',icon: 'F', group: 'football' },
  // Basketball
  { key: 'basketball_nba',               label: 'NBA',                 icon: 'B', group: 'basketball' },
  { key: 'basketball_nba_championship',  label: 'NBA Playoffs',        icon: 'B', group: 'basketball' },
  { key: 'basketball_wnba',              label: 'WNBA',                icon: 'B', group: 'basketball' },
  { key: 'basketball_euroleague',        label: 'Euroleague',          icon: 'B', group: 'basketball' },
  { key: 'basketball_ncaab',             label: 'NCAA Basketball',     icon: 'B', group: 'basketball' },
  { key: 'basketball_wncaab',            label: 'NCAA Basketball Fem.',icon: 'B', group: 'basketball' },
  { key: 'basketball_nbl',               label: 'NBL (Australie)',     icon: 'B', group: 'basketball' },
  // Baseball
  { key: 'baseball_mlb',                 label: 'MLB',                 icon: 'X', group: 'baseball' },
  { key: 'baseball_npb',                 label: 'NPB (Japon)',         icon: 'X', group: 'baseball' },
  { key: 'baseball_kbo',                 label: 'KBO (Coree)',         icon: 'X', group: 'baseball' },
  { key: 'baseball_milb',                label: 'Minor League Baseball', icon: 'X', group: 'baseball' },
  { key: 'baseball_ncaa',                label: 'NCAA Baseball',       icon: 'X', group: 'baseball' },
  // Hockey sur glace
  { key: 'icehockey_nhl',               label: 'NHL',                  icon: 'H', group: 'hockey' },
  { key: 'icehockey_ahl',               label: 'AHL',                  icon: 'H', group: 'hockey' },
  { key: 'icehockey_liiga',             label: 'Liiga (Finlande)',     icon: 'H', group: 'hockey' },
  { key: 'icehockey_mestis',            label: 'Mestis (Finlande)',    icon: 'H', group: 'hockey' },
  { key: 'icehockey_sweden_hockey_league', label: 'SHL (Suede)',       icon: 'H', group: 'hockey' },
  { key: 'icehockey_sweden_allsvenskan', label: 'HockeyAllsvenskan (Suede)', icon: 'H', group: 'hockey' },
  // MMA / Boxe
  { key: 'mma_mixed_martial_arts',       label: 'MMA/UFC',             icon: 'M', group: 'mma' },
  { key: 'boxing_boxing',                label: 'Boxe',                icon: 'M', group: 'mma' },
  // Football americain
  { key: 'americanfootball_nfl',         label: 'NFL',                 icon: 'A', group: 'american_football' },
  { key: 'americanfootball_ncaaf',       label: 'NCAAF',               icon: 'A', group: 'american_football' },
  { key: 'americanfootball_cfl',         label: 'CFL',                 icon: 'A', group: 'american_football' },
  { key: 'americanfootball_ufl',         label: 'UFL',                 icon: 'A', group: 'american_football' },
  // Rugby
  { key: 'rugbyleague_nrl',              label: 'NRL',                 icon: 'R', group: 'rugby' },
  { key: 'rugbyleague_nrl_state_of_origin', label: 'State of Origin',  icon: 'R', group: 'rugby' },
  { key: 'rugbyunion_six_nations',       label: 'Six Nations',         icon: 'R', group: 'rugby' },
  // Cricket
  { key: 'cricket_ipl',                  label: 'IPL (Inde)',          icon: 'C', group: 'cricket' },
  { key: 'cricket_big_bash',             label: 'Big Bash League',     icon: 'C', group: 'cricket' },
  { key: 'cricket_icc_world_cup',        label: 'Coupe du Monde ICC',  icon: 'C', group: 'cricket' },
  { key: 'cricket_t20_world_cup',        label: 'Coupe du Monde T20',  icon: 'C', group: 'cricket' },
  { key: 'cricket_international_t20',    label: 'T20 International',  icon: 'C', group: 'cricket' },
  { key: 'cricket_odi',                  label: 'One Day International', icon: 'C', group: 'cricket' },
  { key: 'cricket_test_match',           label: 'Test Match',          icon: 'C', group: 'cricket' },
  { key: 'cricket_the_hundred',          label: 'The Hundred',         icon: 'C', group: 'cricket' },
  // Handball
  { key: 'handball_germany_bundesliga',  label: 'Handball-Bundesliga', icon: 'D', group: 'handball' },
  // Aussie Rules
  { key: 'aussierules_afl',              label: 'AFL (Australie)',     icon: 'U', group: 'aussie_rules' },
  // Lacrosse
  { key: 'lacrosse_pll',                 label: 'Premier Lacrosse League', icon: 'L', group: 'lacrosse' },
];

// ── Sports prioritaires pour le Scanner IA (toujours scannés en priorité) ──
const SPORTS_PRIORITY = new Set([
  'tennis_atp', 'tennis_wta',
  'tennis_atp_aus_open_singles', 'tennis_atp_french_open', 'tennis_atp_wimbledon', 'tennis_atp_us_open',
  'tennis_wta_aus_open_singles', 'tennis_wta_french_open', 'tennis_wta_wimbledon', 'tennis_wta_us_open',
  'soccer_france_ligue1', 'soccer_epl', 'soccer_europe_champs', 'soccer_uefa_champs_league',
  'soccer_spain_la_liga', 'soccer_italy_serie_a', 'soccer_germany_bundesliga',
  'soccer_uefa_europa_league', 'soccer_fifa_world_cup', 'soccer_uefa_european_championship',
  'soccer_uefa_nations_league', 'soccer_conmebol_copa_libertadores', 'soccer_conmebol_copa_america',
  'basketball_nba', 'basketball_euroleague',
  'icehockey_nhl', 'baseball_mlb',
  'mma_mixed_martial_arts', 'americanfootball_nfl',
]);

const BOOKMAKERS = ['betclic', 'unibet', 'pinnacle', 'winamax', 'bet365'];
// ── Icône par groupe de sport ──────────────────────────────────────────────
function mapGroupIcon(group) {
  const g = (group || '').toLowerCase();
  if (g.includes('soccer') || (g.includes('football') && !g.includes('american') && !g.includes('aussie'))) return '⚽';
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
    const req = https.get(url, (res) => {
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
    // Évite une requête bloquée indéfiniment si The Odds API ne répond pas
    req.setTimeout(15000, () => req.destroy(new Error('Timeout The Odds API (15s)')));
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

// ── ROTATION SCANNER : ne pas scanner TOUS les sports actifs à chaque cycle ──
// Les sports "prioritaires" (SPORTS_PRIORITY) sont scannés à chaque cycle.
// Les autres sports actifs (ligues secondaires) sont scannés par petits lots
// tournants, pour étaler la consommation de quota dans le temps.
let _scanRotationIndex = 0;
const SCAN_ROTATION_BATCH      = 5;    // nb de sports secondaires scannés par cycle
const SCAN_ODDS_TTL_PRIORITY   = 1800; // 30 min — sports prioritaires
const SCAN_ODDS_TTL_SECONDARY  = 3600; // 60 min — sports secondaires (rotation)

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
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents (Náutico -> Nautico)
    .replace(/\s+fc$/,'').replace(/^fc\s+/,'')
    .replace(/[^a-z0-9]/g, '');
}

function teamMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Analyse la cohérence des cotes entre bookmakers pour une sélection donnée.
// Une "edge" élevée n'est une vraie value que si le marché est globalement
// d'accord avec la cote sharp (Pinnacle) : si la meilleure cote est très
// isolée par rapport au reste du marché, c'est probablement une ligne
// périmée/erronée chez ce bookmaker plutôt qu'une vraie opportunité.
function analyzeConsensus(allBookmakers, bestPrice) {
  const n = allBookmakers.length;
  if (n < 2) return { consensus: 'thin', isOutlier: false, deviationPct: 0 };
  const others = allBookmakers.map(b => b.price).filter(p => p !== bestPrice);
  const avgOthers = others.length
    ? others.reduce((a, b) => a + b, 0) / others.length
    : bestPrice;
  const deviationPct = avgOthers > 0
    ? Math.round(((bestPrice - avgOthers) / avgOthers) * 1000) / 10
    : 0;
  return {
    consensus:   n >= 4 ? 'strong' : n >= 3 ? 'moderate' : 'thin',
    isOutlier:   n >= 3 && deviationPct > 25,   // ligne très isolée → probable erreur
    lowAgreement: n >= 3 && deviationPct > 12,  // ligne isolée → confiance réduite
    deviationPct,
    avgOthers: Math.round(avgOthers * 100) / 100,
  };
}

// Calcule un ajustement de score basé sur la forme récente et le H2H,
// sans se substituer à l'edge marché (qui reste le signal principal) —
// sert juste à départager / affiner la confiance sur le top des opportunités.
function computeFormAdjustment(opp, formHome, formAway, h2h) {
  let adj = 0;
  const notes = [];
  const isHomeSel = teamMatch(opp.selection, opp.homeTeam);
  const isAwaySel = teamMatch(opp.selection, opp.awayTeam);
  if (!isHomeSel && !isAwaySel) return { adj: 0, notes: [] };

  const selForm = isHomeSel ? formHome : formAway;
  const oppForm = isHomeSel ? formAway : formHome;
  if (selForm && oppForm && selForm.formPct != null && oppForm.formPct != null) {
    const diff = selForm.formPct - oppForm.formPct;
    adj += diff / 25; // ±4 pts max pour 100% d'écart de forme
    notes.push('Forme 5 derniers: ' + selForm.formPct + '% vs ' + oppForm.formPct + '%');
  }
  if (h2h && h2h.total >= 3) {
    const selWins = isHomeSel ? h2h.homeWins : h2h.awayWins;
    const h2hPct = (selWins / h2h.total) * 100;
    adj += (h2hPct - 50) / 33; // ±1.5 pts max
    notes.push('H2H: ' + selWins + '/' + h2h.total + ' victoires');
  }
  return { adj: Math.round(adj * 10) / 10, notes };
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

  // ── Scan par paliers : sports prioritaires à chaque cycle + rotation sur les sports secondaires ──
  const prioritySports  = activeSportsScan.filter(s => SPORTS_PRIORITY.has(s.key));
  const secondarySports = activeSportsScan.filter(s => !SPORTS_PRIORITY.has(s.key));
  let rotationBatch = [];
  if (secondarySports.length) {
    const batchSize = Math.min(SCAN_ROTATION_BATCH, secondarySports.length);
    for (let i = 0; i < batchSize; i++) {
      rotationBatch.push(secondarySports[(_scanRotationIndex + i) % secondarySports.length]);
    }
    _scanRotationIndex = (_scanRotationIndex + batchSize) % secondarySports.length;
  }
  const sportsToScan = prioritySports.concat(rotationBatch);

  const opportunities = [];
  const now = Date.now();
  const h48 = now + 48 * 3600 * 1000;
  let sportsScanned = 0;
  let eventsFound   = 0;

  for (const sport of sportsToScan) {
    try {
      const oddsCacheKey = 'odds_' + sport.key + '_all';
      let oddsData = cache.get(oddsCacheKey);

      if (!oddsData) {
        if (!quotaOk()) {
          // Quota bas : on sert le stale si dispo, sinon on saute ce sport ce cycle-ci
          const stale = cache.get(oddsCacheKey + '_stale');
          if (stale) {
            oddsData = stale;
            console.warn('[quota] faible — stale servi pour ' + sport.key + ' (scanner)');
          } else {
            continue;
          }
        } else {
          const raw = await oddsApiFetch('/sports/' + sport.key + '/odds', {
            regions:    'eu',
            markets:    'h2h',
            oddsFormat: 'decimal',
            bookmakers: BOOKMAKERS.join(','),
          });
          oddsData = (Array.isArray(raw) ? raw : [raw]).map(event => {
            recordOddsSnapshot(event.id, event.home_team, event.away_team, event.bookmakers || []);
            return {
              id:           event.id,
              sport:        event.sport_key,
              homeTeam:     event.home_team,
              awayTeam:     event.away_team,
              commenceTime: event.commence_time,
              bookmakers:   formatBookmakers(event.bookmakers || []),
              bestOdds:     extractBestOdds(event.bookmakers || []),
              _raw:         event.bookmakers || [],
            };
          });
          const ttl = SPORTS_PRIORITY.has(sport.key) ? SCAN_ODDS_TTL_PRIORITY : SCAN_ODDS_TTL_SECONDARY;
          cache.set(oddsCacheKey, oddsData, ttl);
          cache.set(oddsCacheKey + '_stale', oddsData, 604800); // 7j stale
        }
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

          const sortedBooks = allBookmakers.sort(function(a,b) { return b.price - a.price; });
          const consensus = analyzeConsensus(sortedBooks, bestPrice);

          const edge = (trueProb * bestPrice - 1) * 100;
          if (edge < 2) continue;

          // Cote très isolée par rapport au reste du marché (>25%) :
          // probablement une ligne périmée/erronée, pas une vraie value.
          if (consensus.isOutlier) continue;

          let confidence = pinnacle ? 'high' : rawBk.length >= 3 ? 'medium' : 'low';
          if (consensus.lowAgreement) confidence = 'low';

          const hoursLeft  = (t - now) / 3600000;
          const urgency    = isLive ? 'live' : hoursLeft < 2 ? 'soon' : hoursLeft < 6 ? 'today' : 'upcoming';

          const predScore  = Math.min(99, Math.round(trueProb * (1 + edge / 100)));
          let predLabel  = edge >= 10 ? 'FORTE' : edge >= 6 ? 'BONNE' : 'CORRECTE';
          if (confidence === 'low' && predLabel === 'FORTE') predLabel = 'BONNE';

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
            allBookmakers:  sortedBooks,
            edge:           Math.round(edge * 10) / 10,
            confidence,
            marketConsensus: consensus.consensus,
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

  // -- Affinage IA : forme récente + H2H (TheSportsDB, gratuit) sur le top --
  // L'edge marché reste le signal principal ; la forme/H2H sert à départager
  // et affiner la confiance des meilleures opportunités.
  const TOP_N_REFINE = 8;
  const topPicks = opportunities.slice(0, TOP_N_REFINE);
  await Promise.allSettled(topPicks.map(async function(opp) {
    try {
      const [formHomeRes, formAwayRes, h2hRes] = await Promise.allSettled([
        fetchTeamRecentForm(opp.homeTeam),
        fetchTeamRecentForm(opp.awayTeam),
        fetchH2H(opp.homeTeam, opp.awayTeam),
      ]);
      const formHome = formHomeRes.status === 'fulfilled' ? formHomeRes.value : null;
      const formAway = formAwayRes.status === 'fulfilled' ? formAwayRes.value : null;
      const h2h      = h2hRes.status === 'fulfilled' ? h2hRes.value : null;

      const { adj, notes } = computeFormAdjustment(opp, formHome, formAway, h2h);
      opp.formAdj = adj;
      opp.formNote = notes.length ? notes.join(' · ') : null;
      opp.adjustedScore = Math.max(1, Math.min(99, Math.round(opp.predScore + adj)));
    } catch (e) {
      opp.adjustedScore = opp.predScore;
    }
  }));
  opportunities.forEach(function(o) { if (o.adjustedScore == null) o.adjustedScore = o.predScore; });

  // Re-tri final : live d'abord, puis score affiné (edge + forme/H2H), puis edge brut
  opportunities.sort(function(a, b) {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return (b.adjustedScore - a.adjustedScore) || (b.edge - a.edge);
  });

  const result = {
    opportunities: opportunities.slice(0, 25),
    meta: {
      sportsScanned, eventsFound, totalOpportunities: opportunities.length,
      activeSportsTotal:    activeSportsScan.length,
      prioritySportsCount:  prioritySports.length,
      secondaryScannedThisCycle: rotationBatch.map(s => s.key),
      secondaryRotationTotal: secondarySports.length,
    },
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
  soccer_colombia_primera_a: 'soccer/col.1',
  basketball_nba: 'basketball/nba', basketball_wnba: 'basketball/wnba',
  basketball_nba_championship: 'basketball/nba',
  basketball_ncaab: 'basketball/mens-college-basketball',
  basketball_euroleague: 'basketball/eur.1',
  baseball_mlb: 'baseball/mlb',
  icehockey_nhl: 'hockey/nhl',
  americanfootball_nfl: 'football/nfl',
  mma_mixed_martial_arts: 'mma/ufc',
};

// Mapping sport générique (utilisé par le Journal) → clés ESPN_MAP à essayer
// Permet à /api/check-result de retrouver un match même quand le pari ne
// connaît que le label générique (ex: "hockey") et non la clé API précise
// (ex: "icehockey_nhl").
const GENERIC_SPORT_ESPN_KEYS = {
  tennis: ['tennis_atp', 'tennis_wta'],
  basketball: ['basketball_nba', 'basketball_nba_championship', 'basketball_wnba', 'basketball_euroleague', 'basketball_ncaab'],
  baseball: ['baseball_mlb'],
  hockey: ['icehockey_nhl'],
  mma: ['mma_mixed_martial_arts'],
  american_football: ['americanfootball_nfl'],
  football: [
    'soccer_epl', 'soccer_france_ligue1', 'soccer_spain_la_liga',
    'soccer_germany_bundesliga', 'soccer_italy_serie_a', 'soccer_usa_mls',
    'soccer_brazil_campeonato', 'soccer_europe_champs',
    'soccer_argentina_primera_division', 'soccer_portugal_primeira_liga',
    'soccer_netherlands_eredivisie', 'soccer_colombia_primera_a'
  ],
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

// ── Collecte des stats d'un match (forme, H2H, ESPN, mouvement de cote) ──
// Réutilisée par /api/match-stats et /api/ia-analysis
async function buildMatchStatsData(home, away, sport, matchId) {
  const cacheKey = 'mstats_' + normTeam(home) + '_' + normTeam(away);
  const cached = cache.get(cacheKey);
  if (cached) {
    const mvHome = matchId ? getOddsMovement(matchId, home) : null;
    const mvAway = matchId ? getOddsMovement(matchId, away) : null;
    return Object.assign({}, cached, {
      oddsMovement: { homeTeam: mvHome, awayTeam: mvAway, drawTeam: null }
    });
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

  return result;
}

app.get('/api/match-stats', async function(req, res) {
  const home    = req.query.home    || '';
  const away    = req.query.away    || '';
  const sport   = req.query.sport   || '';
  const matchId = req.query.matchId || '';

  try {
    const result = await buildMatchStatsData(home, away, sport, matchId);
    res.json(result);
  } catch(err) {
    console.error('[match-stats]', err.message);
    res.status(500).json({ error: err.message, home, away });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ANALYSE IA  /api/ia-analysis  (Anthropic Claude + prompt OddsOracle)
// ═══════════════════════════════════════════════════════════════════════

// Construit le message utilisateur envoyé au LLM à partir des données réellement
// disponibles (stats déjà collectées par buildMatchStatsData + contexte du modèle local)
function buildIaUserMessage(params) {
  const { home, away, sport, edge, prob, market, cote, stats } = params;
  const sportInfo  = SPORTS.find(function(s){ return s.key === sport; }) || null;
  const sportLabel = sportInfo ? sportInfo.label : (sport || 'Sport inconnu');
  const sportGroup = sportInfo ? sportInfo.group : '';

  const lines = [];
  lines.push('MATCH : ' + home + ' vs ' + away);
  lines.push('SPORT : ' + sportLabel + (sportGroup ? ' (groupe: ' + sportGroup + ')' : ''));
  if (market) lines.push('MARCHÉ ANALYSÉ PAR LE MODÈLE LOCAL : ' + market);
  if (cote !== undefined && cote !== null && cote !== '') lines.push('COTE PROPOSÉE : ' + cote);
  if (prob !== undefined && prob !== null && prob !== '') lines.push('PROBABILITÉ ESTIMÉE PAR LE MODÈLE LOCAL : ' + prob + '%');
  if (edge !== undefined && edge !== null && edge !== '') lines.push('EDGE ESTIMÉ PAR LE MODÈLE LOCAL (vs marché) : ' + edge + '%');

  const fh = (stats && stats.formHome) || null;
  const fa = (stats && stats.formAway) || null;
  if (fh) lines.push('FORME RÉCENTE ' + home + ' (5 derniers matchs) : ' + (fh.form || '?') + (fh.formPct != null ? ' — ' + fh.formPct + '% de points pris' : '') + (fh.streak ? ', série en cours ' + fh.streak : ''));
  if (fa) lines.push('FORME RÉCENTE ' + away + ' (5 derniers matchs) : ' + (fa.form || '?') + (fa.formPct != null ? ' — ' + fa.formPct + '% de points pris' : '') + (fa.streak ? ', série en cours ' + fa.streak : ''));

  const h2h = (stats && stats.h2h) || null;
  if (h2h && h2h.total) {
    lines.push('CONFRONTATIONS DIRECTES (H2H, ' + h2h.total + ' matchs) : ' + h2h.homeWins + 'V ' + home + ' / ' + (h2h.draws || 0) + 'N / ' + h2h.awayWins + 'V ' + away);
  }

  const om  = (stats && stats.oddsMovement) || {};
  const mvH = om.homeTeam, mvA = om.awayTeam;
  if (mvH && mvH.pctChange != null) lines.push('Mouvement de cote ' + home + ' : ' + (mvH.pctChange > 0 ? '+' : '') + mvH.pctChange.toFixed(1) + '%' + (mvH.steam ? ' (steam move détecté)' : ''));
  if (mvA && mvA.pctChange != null) lines.push('Mouvement de cote ' + away + ' : ' + (mvA.pctChange > 0 ? '+' : '') + mvA.pctChange.toFixed(1) + '%' + (mvA.steam ? ' (steam move détecté)' : ''));

  const espn = (stats && stats.espnStats) || null;
  if (espn && espn.found) {
    lines.push('MATCH EN COURS — Score actuel : ' + espn.score.home + ' - ' + espn.score.away + ' (période ' + espn.period + ', ' + espn.clock + ')');
    function fmtStats(label, s) {
      if (!s) return null;
      const parts = [];
      Object.keys(s).forEach(function(k) {
        if (s[k] !== null && s[k] !== undefined && s[k] !== '') parts.push(k + '=' + s[k]);
      });
      return parts.length ? (label + ' : ' + parts.join(', ')) : null;
    }
    const sA = fmtStats('Stats live ' + home, espn.statsA);
    const sB = fmtStats('Stats live ' + away, espn.statsB);
    if (sA) lines.push(sA);
    if (sB) lines.push(sB);
    if (espn.venue) lines.push('Stade : ' + espn.venue.name + (espn.venue.city ? ' (' + espn.venue.city + ')' : ''));
    if (espn.referee) lines.push('Arbitre : ' + espn.referee.name);
    if (espn.incidents && espn.incidents.length) {
      lines.push('Incidents : ' + espn.incidents.map(function(i) {
        return i.clock + ' ' + i.type + (i.athletes && i.athletes.length ? ' (' + i.athletes.join(', ') + ')' : '') + ' [' + i.side + ']';
      }).join(' | '));
    }
  } else {
    lines.push('Match à venir (pas de données live disponibles pour le moment).');
  }

  lines.push('');
  lines.push('Analyse ce match selon le sport "' + sportLabel + '" et propose 1 à 3 pronos au format demandé.');

  return lines.join('\n');
}

// Appelle Gemini une fois pour un modèle donné. Ne lève jamais — renvoie un descripteur de résultat.
async function callGeminiOnce(model, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(function(){ ctrl.abort(); }, 30000);
  try {
    const r = await fetch(GEMINI_API_URL + model + ':generateContent?key=' + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(function(){ return ''; });
      return { ok: false, status: r.status, errText, model };
    }
    const data = await r.json();
    return { ok: true, status: r.status, data, model };
  } catch (err) {
    return { ok: false, status: 0, errText: err.name === 'AbortError' ? 'timeout' : err.message, model };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/ia-analysis', async function(req, res) {
  const home    = (req.query.home    || '').trim();
  const away    = (req.query.away    || '').trim();
  const sport   = (req.query.sport   || '').trim();
  const matchId = (req.query.matchId || '').trim();
  const edge    = req.query.edge;
  const prob    = req.query.prob;
  const market  = (req.query.market  || '').trim();
  const cote    = req.query.cote;

  if (!home || !away) {
    return res.status(400).json({ error: 'Paramètres home et away requis' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: 'GEMINI_API_KEY non configurée sur le serveur. Voir .env.example' });
  }

  const cacheKey = 'ia_' + normTeam(home) + '_' + normTeam(away) + '_' + sport;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const stats = await buildMatchStatsData(home, away, sport, matchId);
    const userMessage = buildIaUserMessage({ home, away, sport, edge, prob, market, cote, stats });

    const payload = {
      systemInstruction: { parts: [{ text: ODDSORACLE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      // thinkingBudget:0 -> les modeles gemini-2.5-* (flash/flash-lite) consacrent tout
      // le budget de tokens a la reponse visible (sinon une partie est utilisee pour
      // le "raisonnement interne" et le texte final peut etre coupe en plein milieu)
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
    };

    // Modèles à essayer dans l'ordre (principal puis secours), sans doublon
    const modelsToTry = [GEMINI_MODEL, GEMINI_MODEL_FALLBACK].filter(function(m, i, arr) {
      return m && arr.indexOf(m) === i;
    });

    let resp = null;
    outer:
    for (let m = 0; m < modelsToTry.length; m++) {
      const model = modelsToTry[m];
      for (let attempt = 0; attempt < 2; attempt++) {
        resp = await callGeminiOnce(model, payload);
        if (resp.ok) break outer;
        if (!GEMINI_RETRYABLE_STATUSES.includes(resp.status)) break outer;
        if (attempt === 0) await new Promise(function(r){ setTimeout(r, 1200); }); // backoff avant retry
      }
      // Si toujours en échec après les tentatives sur ce modèle, on passe au modèle suivant (si surcharge/quota)
    }

    if (!resp || !resp.ok) {
      console.error('[ia-analysis] Gemini ' + (resp ? resp.status : '?') + ' (modele ' + (resp ? resp.model : '?') + '): ' + (resp ? resp.errText : ''));
      if (resp && resp.status === 0) {
        const msg = resp.errText === 'timeout' ? 'Timeout lors de l\'analyse IA' : resp.errText;
        return res.status(500).json({ error: msg, home, away });
      }
      const overloaded = resp && GEMINI_RETRYABLE_STATUSES.includes(resp.status);
      return res.status(502).json({
        error: overloaded
          ? 'Service IA temporairement surchargé, réessaie dans quelques instants.'
          : 'Erreur API Gemini (' + (resp ? resp.status : '?') + ')',
        retryable: !!overloaded,
      });
    }

    const data  = resp.data;
    const cand  = (data.candidates || [])[0] || {};
    const parts = (cand.content && cand.content.parts) || [];
    const text  = parts.map(function(p){ return p.text || ''; }).join('');

    const result = { analysis: text, model: resp.model, generatedAt: Date.now() };
    cache.set(cacheKey, result, 600); // 10 min — limite le nombre d'appels (quota gratuit)
    res.json(result);
  } catch(err) {
    console.error('[ia-analysis]', err.message);
    const msg = err.name === 'AbortError' ? 'Timeout lors de l\'analyse IA' : err.message;
    res.status(500).json({ error: msg, home, away });
  }
});

// -----------------------------------------------------------------------
// CHECK-RESULT : résultat automatique d'un pari (TheSportsDB + ESPN)
// -----------------------------------------------------------------------
app.get('/api/check-result', async (req, res) => {
  const home      = (req.query.home      || '').trim();
  const away      = (req.query.away      || '').trim();
  const date      = (req.query.date      || '').trim(); // YYYY-MM-DD
  const selection = (req.query.selection || '').trim();
  const sport     = (req.query.sport     || '').trim();

  if (!home || !away) return res.json({ result: 'pending', reason: 'params manquants' });

  // Helper : normalise un nom d'équipe pour comparaison
  function norm(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }
  function teamMatch(a, b) {
    const na = norm(a), nb = norm(b);
    if (na === nb) return true;
    const wa = na.split(' '), wb = nb.split(' ');
    return wa.some(w => w.length > 3 && nb.includes(w)) || wb.some(w => w.length > 3 && na.includes(w));
  }

  // ── 1. ESPN scoreboard ──────────────────────────────────────────────
  // Si le sport est une clé API précise (ex: 'icehockey_nhl'), on l'utilise
  // directement. Sinon (label générique du Journal, ex: 'hockey'), on essaie
  // les clés ESPN correspondantes via GENERIC_SPORT_ESPN_KEYS.
  const espnPaths = ESPN_MAP[sport]
    ? [ESPN_MAP[sport]]
    : (GENERIC_SPORT_ESPN_KEYS[sport] || []).map(k => ESPN_MAP[k]).filter(Boolean);

  if (espnPaths.length) {
    try {
      const ctrl = new AbortController();
      setTimeout(function(){ ctrl.abort(); }, 7000);
      // Essaie la date fournie + hier + avant-hier (décalage timezone)
      const dates = [];
      if (date) {
        const d = new Date(date);
        for (let i = -1; i <= 1; i++) {
          const dd = new Date(d); dd.setDate(dd.getDate() + i);
          dates.push(dd.toISOString().slice(0,10).replace(/-/g,''));
        }
      }

      for (const espnPath of espnPaths) {
        const urls = dates.length
          ? dates.map(d => `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${d}`)
          : [`https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`];

        for (const url of urls) {
          const r = await fetch(url, { signal: ctrl.signal });
          if (!r.ok) continue;
          const sb = await r.json();
          const events = sb.events || [];
          for (const ev of events) {
            const comp  = (ev.competitions || [])[0] || {};
            const comps = comp.competitors || [];
            const n0 = (comps[0]&&comps[0].team&&(comps[0].team.displayName||comps[0].team.shortDisplayName))||'';
            const n1 = (comps[1]&&comps[1].team&&(comps[1].team.displayName||comps[1].team.shortDisplayName))||'';
            if (!((teamMatch(n0,home)&&teamMatch(n1,away))||(teamMatch(n0,away)&&teamMatch(n1,home)))) continue;

            const status  = (ev.status||{});
            const state   = (status.type||{}).state || ''; // pre / in / post
            if (state !== 'post') return res.json({ result: 'pending', status: state, score: null });

            const s0 = parseFloat(comps[0].score||0);
            const s1 = parseFloat(comps[1].score||0);
            const homeIsComp0 = teamMatch(n0, home);
            const homeScore = homeIsComp0 ? s0 : s1;
            const awayScore = homeIsComp0 ? s1 : s0;

            let winner = null;
            if (homeScore > awayScore) winner = home;
            else if (awayScore > homeScore) winner = away;
            else winner = 'draw';

            // Détermine win/loss selon la sélection
            let result = 'loss';
            const sel = norm(selection);
            if (sel === 'nul' || sel === 'draw' || sel === 'x') {
              result = winner === 'draw' ? 'win' : 'loss';
            } else if (teamMatch(selection, winner)) {
              result = 'win';
            }

            return res.json({
              result, winner,
              score: homeScore + '-' + awayScore,
              home, away, source: 'espn'
            });
          }
        }
      }
    } catch(e) { /* ESPN timeout ou erreur, continuer */ }
  }

  // ── 2. TheSportsDB fallback ─────────────────────────────────────────
  // searchevents.php attend un format "Equipe1 vs Equipe2" et échoue si un
  // mot supplémentaire traîne (ex: suffixe d'état brésilien "Nautico PE").
  // On essaie donc le nom complet, puis sans ce suffixe.
  function stripRegionSuffix(s) { return s.replace(/\s+[A-Z]{2}$/, ''); }
  const homeAlt = stripRegionSuffix(home);
  const awayAlt = stripRegionSuffix(away);
  const tsdbQueries = [home + ' vs ' + away];
  if (homeAlt !== home || awayAlt !== away) tsdbQueries.push(homeAlt + ' vs ' + awayAlt);

  for (const q of tsdbQueries) {
    try {
      const ctrl2 = new AbortController();
      setTimeout(function(){ ctrl2.abort(); }, 6000);
      const r = await fetch(
        'https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=' + encodeURIComponent(q),
        { signal: ctrl2.signal }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const events = (d.event || []).filter(function(ev) {
        if (!teamMatch(ev.strHomeTeam, home) || !teamMatch(ev.strAwayTeam, away)) return false;
        if (date && ev.dateEvent && !ev.dateEvent.startsWith(date)) return false;
        return true;
      });
      const ev = events[0];
      if (!ev) continue;

      // Statuts "terminé" connus de TheSportsDB. On NE se base PAS sur la
      // présence d'un score (intHomeScore), car les matchs LIVE ont déjà
      // un score renseigné -> ça marquait des matchs en cours comme finis.
      const FINISHED_STATUSES = /^(match finished|ft|aet|aot|finished|ended|final|full time)$/i;
      const finished = FINISHED_STATUSES.test((ev.strStatus || '').trim());
      if (!finished) return res.json({ result: 'pending', status: ev.strStatus });
      const hs = parseInt(ev.intHomeScore || 0);
      const as = parseInt(ev.intAwayScore || 0);
      let winner = null;
      if (hs > as) winner = ev.strHomeTeam;
      else if (as > hs) winner = ev.strAwayTeam;
      else winner = 'draw';

      const sel = norm(selection);
      let result = 'loss';
      if (sel === 'nul' || sel === 'draw' || sel === 'x') {
        result = winner === 'draw' ? 'win' : 'loss';
      } else if (teamMatch(selection, winner)) {
        result = 'win';
      }

      return res.json({ result, winner, score: hs+'-'+as, home, away, source: 'thesportsdb' });
    } catch(e) { /* timeout, essaie la requête suivante */ }
  }

  return res.json({ result: 'pending', reason: 'match non trouvé' });
});

// -- SPA FALLBACK (doit être EN DERNIER après toutes les routes API) --
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
