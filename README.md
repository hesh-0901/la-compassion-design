# LA COMPASSION DESIGN

Application d'inscription à la Masterclass Design du département Design de l'Église de la Compassion, Lubumbashi.

## Stack
- React
- TypeScript
- Vite
- CSS responsive

## Développement
```bash
npm install
npm run dev
```

## Production
```bash
npm run build
```

Le dossier de sortie est `dist`, prêt pour Cloudflare Pages.

## Variables Cloudflare
Les secrets et variables de production sont configurés dans les paramètres du projet Cloudflare Pages. Les secrets ajoutés ou modifiés sont pris en compte par les nouveaux déploiements.

Variables attendues :
- `MAILER_WEB_APP_URL` (URL `/exec` du déploiement Google Apps Script)
- `MAILER_SECRET` (secret partagé entre Cloudflare et les propriétés du script)
- `FIREBASE_SERVICE_ACCOUNT` (secret JSON complet du compte de service Firebase Admin SDK)
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`

## Notifications e-mail

Les fonctions Cloudflare Pages dans `functions/api` envoient :
- un accusé de réception au candidat (si une adresse est fournie) ;
- une alerte aux comptes `admins` actifs dont le rôle est `superAdmin` ;
- une notification au candidat après acceptation ou refus.

Le destinataire administratif est lu depuis Firestore : aucune adresse n'est codée en dur. Les fonctions vérifient le jeton Firebase des administrateurs avant d'envoyer une décision. Les secrets Firebase Admin et Resend restent côté serveur.

L'envoi est effectué par Google Apps Script avec le compte Gmail qui a déployé la Web App. Les quotas d'envoi Gmail et les règles Google s'appliquent.
