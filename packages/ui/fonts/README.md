# Self-hosted fonts

Variable WOFF2 files served with the application bundle — production pages
make no third-party font requests (standing obligation E11).

| Family | Style | Axis | Subsets | License |
|---|---|---|---|---|
| Schibsted Grotesk | normal | wght 400–600 | latin, latin-ext | [OFL 1.1](OFL-schibsted-grotesk.txt) |
| Newsreader | italic only | wght 400–500, opsz 6–72 | latin, latin-ext | [OFL 1.1](OFL-newsreader.txt) |

Newsreader ships italic only on purpose: it is the display accent face of the
warm-editorial design language, never a body face. Finnish and Swedish
characters live in the latin/latin-ext subsets included here.

Provenance: fetched from Google Fonts (fonts.gstatic.com) at WP-03 time;
`@font-face` rules with matching `unicode-range` live in `../src/fonts.css`.
