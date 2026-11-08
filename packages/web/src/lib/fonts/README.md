# Web fonts

These WOFF2 files are served locally; builds never download fonts. Latin faces use
`next/font/local`. The 40 non-Latin faces use plain `fonts-ext.css` files with
Google's exact `unicode-range` declarations and separate family names. Scoped
CSS modules prepend those families to the existing variables, followed by the
Next Latin family and its adjusted fallback. Non-Latin files are never preloaded
and download only when matching characters are rendered.
Each family is licensed under SIL Open Font License 1.1; the full license is in its adjacent `*-OFL.txt` file.

Russo One and Chakra Petch reuse the existing sign-in files. The root definitions
live in `../fonts.ts`; root Chakra Petch keeps only 400/600/700. Sign-in has its
own four-weight Latin Chakra Petch loader (including 500) and Russo One loader,
with `--font-sign-in-body` and `--font-sign-in-display`, as before. Admin, duel,
and Solid Vision definitions and subset CSS remain scoped to their consumers,
including portals.

Sign-in's font module stays independent of `../fonts.ts`. Importing the root
Russo One definition there connects the font modules and lets Turbopack's default
CSS merging put sign-in's 500 face and preload in root CSS. Separate local
loaders keep that face scoped to sign-in consumers with default CSS chunking,
without increasing stylesheet requests across the app.

All faces use `swap`. Latin loaders keep the existing adjusted Arial fallback;
Newsreader retains Times New Roman. The surrounding CSS fallback stacks are
unchanged. Next calculates fallback metrics from the local Latin files.

The six variable fonts expose only the original weight ranges in CSS. Newsreader remains italic at the Google API default optical size (16); Martian Mono remains at the default width (100%). Barlow and Chakra Petch are static fonts upstream, so only the requested weights are included.

Latin payload: **383,188 bytes (374.2 KiB)**, including the moved sign-in files.
Restored non-Latin payload: **403,408 bytes (394.0 KiB)** across 40 files.
Total web WOFF2 payload: **786,596 bytes (768.2 KiB)**. These are unmodified
upstream binaries; the non-Latin total is the measured download size.

| Family | Restored subsets | Files | Bytes |
| --- | --- | ---: | ---: |
| Russo One | Cyrillic, latin-ext | 2 | 8,896 |
| Chakra Petch (400/600/700) | Thai, Vietnamese, latin-ext | 9 | 60,000 |
| Sofia Sans Semi Condensed | Cyrillic-ext, Cyrillic, Greek, latin-ext | 4 | 63,832 |
| Sofia Sans Extra Condensed | Cyrillic-ext, Cyrillic, Greek, latin-ext | 4 | 62,120 |
| Newsreader italic | Vietnamese, latin-ext | 2 | 51,732 |
| Oxanium | latin-ext | 1 | 6,972 |
| Barlow Semi Condensed (300/400/500/600) | Vietnamese, latin-ext | 8 | 57,996 |
| Barlow Condensed (300/400/500) | Vietnamese, latin-ext | 6 | 41,416 |
| Schibsted Grotesk | latin-ext | 1 | 20,844 |
| Martian Mono | Cyrillic-ext, Cyrillic, latin-ext | 3 | 29,600 |

## Sources

The binaries are unmodified responses from the Google Fonts CSS API with a
Chrome 104 user agent. The CSS requests below supply the source URLs and Unicode
ranges for every restored subset; adjacent `fonts-ext.css` files retain those
ranges verbatim and use local URLs. License texts come from the corresponding
family directories in [google/fonts](https://github.com/google/fonts/tree/main/ofl).

- Russo One: [CSS request](https://fonts.googleapis.com/css2?family=Russo+One:wght@400&display=swap).
- Chakra Petch: [CSS request](https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&display=swap).

- Schibsted Grotesk: [CSS request](https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&display=swap), [`schibsted-grotesk-400-700-latin.woff2`](https://fonts.gstatic.com/s/schibstedgrotesk/v7/Jqz55SSPQuCQF3t8uOwiUL-taUTtap9GayojdSFO.woff2).
- Martian Mono: [CSS request](https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400..500&display=swap), [`martian-mono-400-500-latin.woff2`](https://fonts.gstatic.com/s/martianmono/v6/2V0PKIcADoYhV6w87xrTKjs4CYElh_VS9YA4TlTnaTq9wXulPFk.woff2).
- Sofia Sans Semi Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Sofia+Sans+Semi+Condensed:wght@1..1000&display=swap), [`sofia-sans-semi-condensed-1-1000-latin.woff2`](https://fonts.gstatic.com/s/sofiasanssemicondensed/v8/46k9laPnUDrQoNsWDCGXXxYlujh5Wv0nwP4RwxURsWM08kyUrcU.woff2).
- Sofia Sans Extra Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@1..1000&display=swap), [`sofia-sans-extra-condensed-1-1000-latin.woff2`](https://fonts.gstatic.com/s/sofiasansextracondensed/v6/raxoHjafvdAIOju4GcIfJH0i7zi50X3zRtuLNiMS0fSuJk52kCel.woff2).
- Newsreader: [CSS request](https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@1,200..800&display=swap), [`newsreader-italic-200-800-latin.woff2`](https://fonts.gstatic.com/s/newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLFYYzbARA_n8.woff2).
- Oxanium: [CSS request](https://fonts.googleapis.com/css2?family=Oxanium:wght@200..800&display=swap), [`oxanium-200-800-latin.woff2`](https://fonts.gstatic.com/s/oxanium/v21/RrQQboN_4yJ0JmiMe2LE0ZJCZ4c.woff2).
- Barlow Semi Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@300;400;500;600&display=swap), [`barlow-semi-condensed-300-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRf06i_B2slqZ6GfQ.woff2), [`barlow-semi-condensed-400-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpvgxjLBV1hqnzfr-F8sEYMB0Yybp0mudRXeIqqKkkogw.woff2), [`barlow-semi-condensed-500-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfi6m_B2slqZ6GfQ.woff2), [`barlow-semi-condensed-600-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfp66_B2slqZ6GfQ.woff2).
- Barlow Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500&display=swap), [`barlow-condensed-300-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47rxz3bWuYMBYro.woff2), [`barlow-condensed-400-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTx3L3I-JCGChYJ8VI-L6OO_au7B6xHT2lv0tKk.woff2), [`barlow-condensed-500-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4-Lwz3bWuYMBYro.woff2).
