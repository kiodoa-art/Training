# Training History PWA

En statisk, installerbar mobilapp der lokalt konverterer Garmin `.fit`-filer og ZIP-arkiver med FIT-filer til en kumulativ `training-history.json`. Appen har fire mobilfaner: Overblik, Ture, Import og Udvikling.

## GitHub Pages

1. Opret et nyt GitHub-repository.
2. Upload **indholdet af denne mappe** til repositoryets rod (ikke selve mappen som et ekstra niveau).
3. Åbn **Settings → Pages** i repositoryet.
4. Vælg **Deploy from a branch**, branch **main** og mappe **/(root)**. Tryk **Save**.
5. Åbn den viste HTTPS-adresse. På Android kan appen installeres fra browsermenuen med **Føj til startskærm** eller **Installer app**.

Service workers og PWA-installation kræver HTTPS. GitHub Pages leverer HTTPS automatisk. Ved lokal test kan du bruge en enkel lokal webserver; appen bør ikke åbnes direkte som `file://`.

## Brug

- Importér en eller flere `.fit`-filer eller en `.zip` med FIT-filer.
- Kontrollér previewet, og vælg **Tilføj til historik**.
- En eksisterende `training-history.json` kan flettes ind uden at overskrive nyere lokale aktiviteter.
- Eksport gemmer kun rigtige brugerdata. Demoen, der vises ved tom historik, eksporteres ikke.

Alle filer analyseres på enheden. Der er ingen backend, tracking eller upload til tredjepart.

## Biblioteker

- `fit-file-parser` 3.0.2 (MIT), lokalt tilpasset til browserens `TextDecoder`.
- `fflate` 0.8.3 (MIT).

Licenstekster findes i `vendor/licenses/`.
