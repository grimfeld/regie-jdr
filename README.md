# Régie JDR — prototype 0.1

Premier squelette de l'application de régie pour maître du jeu.

## Pré-requis
- Node.js 20 ou plus récent
- npm

## Installation
```bash
npm install
```

## Préparer un installateur Windows 11
```bash
npm run package:win
```
Les installateurs NSIS (`.exe`) et MSI (`.msi`) seront créés dans le dossier `release/`. Le projet doit être construit sur Windows pour produire et valider l’installeur Windows.
La CI ne le construit que sur un tag de version (voir « Publier une version » ci-dessous). Vérification avant diffusion : `docs/install-checklist.md`.

## Publier une version
```bash
npm run release -- 0.1.0              # version exacte, ou patch / minor / major
npm run release -- 0.2.0 --dry-run    # affiche les commandes sans rien modifier
```
À lancer depuis `main` propre et à jour. Le script met la version dans `package.json` (commit `Release vX.Y.Z`), crée le tag `vX.Y.Z` et pousse `main` puis le tag.
Le tag `vX.Y.Z` déclenche `.github/workflows/release.yml` : vérification que le tag correspond à `package.json`, tests complets, construction de l’installeur Windows, puis Release GitHub avec `Regie-JDR-Setup-X.Y.Z.exe` et `Regie-JDR-Setup-X.Y.Z.msi`. Un tag avec suffixe (`v0.2.0-beta.1`) est publié en pré-version.

## Lancer en développement
```bash
npm run electron:dev
```

## État du prototype
- Interface MJ et fenêtre de diffusion séparée.
- Synchronisation du titre et du décor entre les deux fenêtres.
- Import local d'images PNG/JPG/WebP.
- Trois thèmes d'interface : rétro SF, Imperium (sans Mechanicus), fantasy.
- Premiers contrôles visuels de volume (interface seulement à ce stade).

## Prochaines étapes
1. Persistance des scènes et des bibliothèques dans les données locales de l’application.
2. Vraie bibliothèque de décors, portraits et créatures avec catégories.
3. Placement, déplacement, taille, calques et transitions des personnages sur la scène.
4. Moteur audio réel avec Howler.js, boucles, bruitages et mixage.
5. Profils de campagnes et sauvegarde SQLite.
6. Packaging Windows/macOS/Linux et tests de capture audio Discord.
