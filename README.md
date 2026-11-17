# Jarvis

Assistant perso sous forme de petite ville en 3D. Page web (GitHub Pages) à ajouter sur l'écran d'accueil de l'iPhone.

- `index.html`, `style.css`, `app.js` : l'app (Three.js + Supabase).
- `supabase/functions/jarvis-chat` : le chat, qui parle à l'API Claude (clé dans les secrets Supabase).
- `supabase/functions/medinlyon` : le robot MédinLyon côté serveur (rendez-vous, créneaux, réservation, annulation, PDF).

Aucune donnée personnelle dans ce dépôt : tout est dans Supabase, lisible seulement par le propriétaire connecté.

## Mails Outlook (lecture seule)

- Application Microsoft Entra « Jarvis » (comptes Microsoft personnels), ID client `7bbe78e6-2258-45f1-9ad7-25f731fb1213`.
- Plateforme **Web**, URI de redirection : `https://uaprtibscyepsabyqcyl.supabase.co/functions/v1/jarvis-outlook`.
- Permissions : `openid offline_access User.Read Mail.Read` (rien d'autre : pas d'envoi, de modification ni de suppression).
- Le secret client se colle dans Jarvis › Réglages › « Outlook · secret de l'application » (coffre chiffré, jamais relisible par l'app).
- `supabase/functions/jarvis-outlook` : connexion (PKCE), relecture toutes les 15 min (pg_cron `jarvis-outlook-sync`), tri par Claude Haiku, rangement dans les lieux (`jarvis_items` source `outlook`, une info par mail avec son n° de mail) et alertes rouges.
- Table `jarvis_mails` : mails gardés (IBAN, n° de sécu et n° de carte masqués), fermée à tout le monde sauf aux fonctions du serveur.
- Connecteur MCP : `jarvis_mails_chercher`, `jarvis_mail_lire`, `jarvis_memoire`, `jarvis_mails_synchroniser`.
