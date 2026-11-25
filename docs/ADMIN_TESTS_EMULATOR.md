# Tests isolés de l’administration

Les tests de cette branche doivent utiliser exclusivement le projet de démonstration Firebase et les émulateurs locaux.

## Démarrage

1. Installer Firebase CLI si nécessaire.
2. Depuis la racine du dépôt, démarrer les émulateurs :

```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-la-compassion-design
```

3. Dans un fichier local `.env.local` non versionné, activer explicitement le mode émulateur :

```env
VITE_USE_FIREBASE_EMULATOR=true
```

4. Démarrer Vite dans un autre terminal :

```bash
npm run dev
```

L'application se connecte alors à Auth Emulator (9099) et Firestore Emulator (8080). Sans la variable explicite, le comportement Firebase habituel est conservé.

## Jeu de données

Créer les comptes et documents de test directement dans l'interface Emulator UI (http://127.0.0.1:4000) :
- un compte administrateur avec un document `admins/{uid}`, `role: "admin"`, `active: true` ;
- un compte super administrateur avec `role: "superAdmin"`, `active: true` ;
- des candidatures couvrant les cinq statuts et les deux réponses de disponibilité.

Ne jamais importer ces données dans le projet Firebase réel. Utiliser uniquement le projet `demo-la-compassion-design` avec les émulateurs en cours d'exécution.

## Scénarios à vérifier

- Synthèse des quatre indicateurs et absence de valeur de capacité quand les réglages sont vides.
- Dossiers Reçue / En étude triés du plus ancien au plus récent.
- Signalement de la disponibilité « Partiellement ».
- Barre segmentée visible uniquement à partir de cinq candidatures.
- Recherche insensible à la casse et aux accents, téléphone avec ou sans +243.
- Combinaison des filtres, pagination côté client et export des seuls résultats filtrés.
- Changement de statut avec historique, confirmation avant refus et note interne.
- Lecture de la capacité pour les administrateurs et modification réservée au SuperAdmin.

Le build et les scénarios émulateur doivent être exécutés avant toute fusion ou déploiement.
