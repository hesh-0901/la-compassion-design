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
- `RESEND_API_KEY` (secret serveur, jamais exposé au navigateur)
- `RESEND_FROM_EMAIL` (expéditeur Resend, par exemple `onboarding@resend.dev` pour les tests)
- `FIREBASE_SERVICE_ACCOUNT` (secret JSON complet du compte de service Firebase Admin SDK)
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`

## Notifications e-mail

Les fonctions Cloudflare Pages dans `functions/api` envoient :
- un accusé de réception au candidat (si une adresse est fournie) ;
- une alerte aux comptes `admins` actifs dont le rôle est `superAdmin` ;
- une notification au candidat après acceptation ou refus.

Le destinataire administratif est lu depuis Firestore : aucune adresse n'est codée en dur. Les fonctions vérifient le jeton Firebase des administrateurs avant d'envoyer une décision. Les secrets Firebase Admin et Resend restent côté serveur.

Avec l'expéditeur de test `onboarding@resend.dev`, Resend limite les destinataires à l'adresse autorisée sur le compte Resend. Les candidats ne recevront leurs e-mails qu'après configuration d'un domaine d'expédition vérifié.
