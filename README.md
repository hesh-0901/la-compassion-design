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
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`
