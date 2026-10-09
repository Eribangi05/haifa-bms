# Branded QR codes and printable posters

Request codes (hotel, bar, mall, taxi rank) now print as a branded poster. The QR still opens the same address (`/r/<code>`), so codes already printed keep working.

## What you get (Request codes tab in the console)

| Button | Output |
|---|---|
| QR (PNG) | 2048 px branded QR (rounded dots, Rwanda-blue corners, Abasare mark in the middle) |
| QR (SVG) | Same QR as vector: send it to a print shop, it stays sharp at any size |
| Poster A5 / A4 | Flag stripes, logo and "Genda · Kora · Sura", venue name, headline in Kinyarwanda + French + English, framed QR, 3 steps, support number and the code |
| Sticker | Small square (100 x 108 mm) for tables, windows and car doors |

The API also serves the vector QR at `GET /admin/request-codes/:id/qr-branded.svg` (`?plain=1` leaves the logo out). The original `qr.svg` and `qr.png` endpoints are unchanged.

## Why it still scans

* Error correction level H (30%). The logo covers under 8% of the code.
* Dark navy dots on white, quiet zone around the code, finder corners kept solid.
* Checked by decoding it with a QR reader library at 200, 400 px and with blur (a poor print). Print a test copy and scan it with two or three phones before ordering many.

## Printing tips

* Print A5 or A4 on matte paper (gloss reflects light), full colour, "actual size", no "fit to page" shrink below 70 mm for the QR.
* Keep the QR at least 50 mm wide and place posters where people can stand 30 cm to 1 m away, with good light.
* Never stretch the poster or put another logo over the QR.
