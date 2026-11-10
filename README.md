# SKILLBRIDGE Africa

Plateforme d'échange de compétences entre étudiants, basée sur des SkillCredits.

## Stack

- Frontend : HTML / CSS / JavaScript vanilla
- Backend : Supabase (Postgres, Auth, Edge Functions)

## Mise en route

### 1. Créer le projet Supabase

1. Crée un projet gratuit sur https://supabase.com
2. Récupère `Project URL` et `anon public key` (Settings > API)

### 2. Configurer le frontend

```bash
cp config.example.js config.js
# Édite config.js avec tes valeurs
```

### 3. Initialiser la base de données

Dans le SQL Editor de Supabase, exécute dans l'ordre :
1. `supabase/migrations/init_schema.sql`
2. `supabase/migrations/0002_fix_rls_and_credits.sql` (si projet déjà déployé)

### 4. Déployer les Edge Functions

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase functions deploy create-session-request
npx supabase functions deploy confirm-session
```

### 5. Lancer le frontend

```bash
npm start
# ou: npx serve .
```

## Fonctionnalités MVP

- Authentification (signup/login)
- Profil avec crédits et niveau
- Recherche de profs
- Demande de séance
- Validation de séance par le prof + attribution atomique des crédits
- Notifications

## Licence

Projet étudiant.