# 🚀 Déploiement OddsOracle — Guide complet (gratuit)

## Ce que tu vas obtenir
- Application en ligne 24h/24, accessible depuis n'importe quel appareil
- Données de cotes en temps réel (Betclic, Pinnacle, Winamax, Unibet, Bet365)
- Scores live en direct
- URL publique : `https://oddsoracle.onrender.com` (ou similaire)

---

## Étape 1 — Clé API gratuite (2 min)

1. Va sur **https://the-odds-api.com/**
2. Clique **"Get API Key"** → inscription avec ton email
3. **Pas de carte bancaire requise** — plan gratuit = 500 req/mois
4. Copie ta clé API (format : `abc123def456...`)

---

## Étape 2 — Compte GitHub (si pas déjà fait)

1. Va sur **https://github.com**
2. Crée un compte gratuit
3. Crée un nouveau repository : **"oddsoracle"** (privé recommandé)

---

## Étape 3 — Envoyer le code sur GitHub

Ouvre un terminal dans le dossier du projet et exécute :

```bash
cd C:\Users\ADMIN\Claude\Projects\Pronowin

# Initialiser Git
git init
git add .
git commit -m "OddsOracle v2.0 — Live betting system"

# Connecter à GitHub (remplacer TON_PSEUDO par ton pseudo GitHub)
git remote add origin https://github.com/TON_PSEUDO/oddsoracle.git
git branch -M main
git push -u origin main
```

---

## Étape 4 — Déployer sur Render.com (gratuit)

1. Va sur **https://render.com** → créer un compte gratuit
2. Clique **"New +"** → **"Web Service"**
3. Connecte ton compte GitHub → sélectionne le repo **"oddsoracle"**
4. Render détecte automatiquement la config (`render.yaml`)
5. Dans la section **"Environment Variables"**, ajoute :
   - **Key** : `ODDS_API_KEY`
   - **Value** : `ta_cle_api_the_odds_api`
6. Clique **"Create Web Service"**
7. Attends 2-3 minutes → ton app est en ligne ! 🎉

---

## Étape 5 — Garder l'app toujours active (optionnel mais recommandé)

Le plan gratuit de Render met l'app en veille après 15 min d'inactivité.
Le serveur se réveille automatiquement en quelques secondes, **mais** pour
éviter tout délai, configure un ping automatique gratuit :

1. Va sur **https://uptimerobot.com** → compte gratuit
2. **"Add New Monitor"** → HTTP(s)
3. URL : `https://oddsoracle.onrender.com/health`
4. Intervalle : **5 minutes**
5. → L'app ne dormira jamais ✅

> **Note** : Le serveur se ping aussi lui-même toutes les 14 min automatiquement.

---

## Résumé des coûts

| Service         | Plan    | Coût   |
|----------------|---------|--------|
| Render.com      | Free    | 0€/mois |
| The Odds API    | Free    | 0€/mois (500 req) |
| UptimeRobot     | Free    | 0€/mois |
| GitHub          | Free    | 0€/mois |
| **Total**       |         | **0€** |

---

## En cas de problème

### "ODDS_API_KEY non configurée"
→ Vérifie que la variable d'environnement est bien définie dans Render Dashboard → Environment

### "Clé API invalide"
→ Vérifie que tu as bien copié la clé complète depuis the-odds-api.com

### "Aucun match disponible"
→ Normal si pas de matchs dans les 48h pour ce sport. Essaie un autre sport.

### Tester en local d'abord
```bash
cp .env.example .env
# Édite .env et mets ta clé API
npm install
npm start
# Ouvre http://localhost:3000
```
