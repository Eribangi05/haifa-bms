# Abasare brand guide

One look across the app, the admin console, the store listing and printed material. Everything here is implemented in code; the files named below are the source of truth.

## Name and promise
**Abasare** (Kinyarwanda: "those who drive / those who serve"). Tagline from the logo: **Ride · Work · Explore**, always translated, never mixed with another language: *Genda · Kora · Sura* (Kinyarwanda), *Roulez · Travaillez · Explorez* (French). Strings: `brand.tagline` in `mobile/src/lib/locales/features/brand.*.ts`. Voice: warm, clear, short sentences; safety and fair pay are stated plainly, never exaggerated.

## Abasare and Umusare (one word, two numbers)
**Abasare** is the plural: the drivers who drive cars that belong to other people, and the name of the service and the app. One such driver is an **Umusare**. Use *Umusare* whenever a single person is meant ("Your Umusare", "Become an Umusare", "Umusare approved") and *Abasare* for the service, the app, the team or several drivers ("Abasare: a driver for your own car", "Abasare drivers"). This holds in English, French and Kinyarwanda.

## Languages
The console and the app show one language at a time: Kinyarwanda, French or English, never a mix. In the console every text has a translation (`admin-web/i18n-data.js`, `i18n-extra.js`, `i18n.js`); `backend/scripts/console-lang-check.ts` opens every page in Kinyarwanda and French and lists any text that still looks English (what remains are names typed by people and the editors that show all three languages of one record on purpose). Dates use the chosen language, with Kinyarwanda month names written in the code.

## Colours (Rwanda flag)
| Role | Light | Dark | Use |
|---|---|---|---|
| Brand blue (header) | `#0069A8` | `#0F3554` | Top bar, hero cards, splash screen |
| Sky blue | `#00A1DE` | `#00A1DE` | Flag band, accents (darkened to `#0077B0` for text) |
| Sun yellow | `#FAD201` | `#FAD201` | Gold line under the top bar, active tab marker, primary highlight, "Copy code" style buttons |
| Green | `#20603D` | `#23744A` | Flag band, success, invitation banner |
| Ink / muted / line | `#0F1B3D` / `#5A6685` / `#DAE1EF` | `#EAF0FA` / `#A7B4CF` / `#2C3A58` | Text and dividers |

Every text and background pair used in the app reaches contrast 4.5:1 in both modes (`mobile/tests/palette.test.ts`). Definitions: `mobile/src/lib/palette.ts`.

## Logo
The supplied logo (`mobile/assets/logo.png`, `icon.png`): blue "A" with a yellow location pin, a road and car, a driver in uniform and Kigali landmarks, with the wordmark and the three flag-coloured lines. Usage rules:
* On a white or very light rounded tile; on the brand blue use the tile version (never place the dark wordmark directly on blue).
* Keep clear space of at least one quarter of the tile width. Do not stretch, recolour or add effects.
* In headers the small **brand mark** (the "A", pin, road and car, `assets/brand/mark.png`) sits on a white chip beside the name "Abasare" typeset in the app font.
* The splash screen is the logo tile on brand blue (`app.config.js`).

## Typography and shape
System font stack (Inter on web); titles 700-800, body 400-600. Corner radius 14 (cards), 20-28 (heroes), pill 99 (chips). Soft shadows only. Layout tokens: `mobile/src/ui/theme.ts`.

## Iconography
One family of glossy artwork: **blue discs** (sky blue to deep blue) with white, yellow or red glyphs for actions and list rows, and **gradient tiles** for the bottom tabs. The tab tiles, calendar, tickets, receipt and the nine list icons are the supplied designs, cropped; every other icon is redrawn in the same style by `mobile/scripts/icons/build.mjs` (run it to regenerate `mobile/assets/icons/`). Screens refer to icons by emoji key; `mobile/src/ui/icons.ts` maps each key to its artwork (an unmapped key still renders as text). To add an icon: add a glyph to `build.mjs`, add its key to `EMOJI_ICON`.

## Screens
* **Top bar**: brand blue with a gold line. Root screens show the brand mark and the name (Home also shows the RW / FR / EN switch); inner screens show a white Back control and the title.
* **Hero cards** (`ui/dash.tsx` `Hero`): brand blue with sun-yellow and green discs and the three flag bands along the bottom.
* **Welcome**: logo tile, name, tagline, four promises with icons, language choice.
* **Menus**: grouped lists with a yellow marker beside each group title (`MenuGroup`).

## Contact shown in the app
Help and assistance shows **Jean Paul INGABIRE, +250 786 880 880** with Call, WhatsApp and Message buttons. It is a constant in `mobile/src/config.ts` (`SUPPORT`); change it there for a different contact.

## Store assets
`store/icon-512.png`, `store/feature-graphic-1024x500.png` (regenerate with `node scripts/store-graphic.mjs` in `mobile/`), copy in `store/LISTING.md`. Phone screenshots must come from a real device build.
