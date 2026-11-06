# Web fonts

These Latin WOFF2 files are served by `next/font/local`; builds never download fonts.
Each family is licensed under SIL Open Font License 1.1; the full license is in its adjacent `*-OFL.txt` file.

Russo One and Chakra Petch reuse the existing sign-in files. Their shared definitions live in `../fonts.ts`; sign-in keeps its CSS variable names through aliases. Admin, duel, and Solid Vision definitions remain scoped to their consumers.

All faces use `display: "swap"` and the existing adjusted Arial fallback; Newsreader retains Times New Roman. The surrounding CSS fallback stacks are unchanged. Next calculates fallback metrics from the local files.

The six variable fonts expose only the original weight ranges in CSS. Newsreader remains italic at the Google API default optical size (16); Martian Mono remains at the default width (100%). Barlow and Chakra Petch are static fonts upstream, so only the requested weights are included.

New font payload: **336,264 bytes (328.4 KiB)**. Total web WOFF2 payload, including the moved sign-in files: **383,188 bytes (374.2 KiB)**.

## Sources

The new binaries are the unmodified Latin responses from the Google Fonts CSS API with a Chrome 104 user agent. License texts come from the corresponding family directories in [google/fonts](https://github.com/google/fonts/tree/main/ofl).

- Schibsted Grotesk: [CSS request](https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&display=swap), [`schibsted-grotesk-400-700-latin.woff2`](https://fonts.gstatic.com/s/schibstedgrotesk/v7/Jqz55SSPQuCQF3t8uOwiUL-taUTtap9GayojdSFO.woff2).
- Martian Mono: [CSS request](https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400..500&display=swap), [`martian-mono-400-500-latin.woff2`](https://fonts.gstatic.com/s/martianmono/v6/2V0PKIcADoYhV6w87xrTKjs4CYElh_VS9YA4TlTnaTq9wXulPFk.woff2).
- Sofia Sans Semi Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Sofia+Sans+Semi+Condensed:wght@1..1000&display=swap), [`sofia-sans-semi-condensed-1-1000-latin.woff2`](https://fonts.gstatic.com/s/sofiasanssemicondensed/v8/46k9laPnUDrQoNsWDCGXXxYlujh5Wv0nwP4RwxURsWM08kyUrcU.woff2).
- Sofia Sans Extra Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@1..1000&display=swap), [`sofia-sans-extra-condensed-1-1000-latin.woff2`](https://fonts.gstatic.com/s/sofiasansextracondensed/v6/raxoHjafvdAIOju4GcIfJH0i7zi50X3zRtuLNiMS0fSuJk52kCel.woff2).
- Newsreader: [CSS request](https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@1,200..800&display=swap), [`newsreader-italic-200-800-latin.woff2`](https://fonts.gstatic.com/s/newsreader/v26/cY9XfjOCX1hbuyalUrK439vogqC9yFZCYg7oRZaLFYYzbARA_n8.woff2).
- Oxanium: [CSS request](https://fonts.googleapis.com/css2?family=Oxanium:wght@200..800&display=swap), [`oxanium-200-800-latin.woff2`](https://fonts.gstatic.com/s/oxanium/v21/RrQQboN_4yJ0JmiMe2LE0ZJCZ4c.woff2).
- Barlow Semi Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@300;400;500;600&display=swap), [`barlow-semi-condensed-300-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRf06i_B2slqZ6GfQ.woff2), [`barlow-semi-condensed-400-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpvgxjLBV1hqnzfr-F8sEYMB0Yybp0mudRXeIqqKkkogw.woff2), [`barlow-semi-condensed-500-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfi6m_B2slqZ6GfQ.woff2), [`barlow-semi-condensed-600-latin.woff2`](https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfp66_B2slqZ6GfQ.woff2).
- Barlow Condensed: [CSS request](https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500&display=swap), [`barlow-condensed-300-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47rxz3bWuYMBYro.woff2), [`barlow-condensed-400-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTx3L3I-JCGChYJ8VI-L6OO_au7B6xHT2lv0tKk.woff2), [`barlow-condensed-500-latin.woff2`](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4-Lwz3bWuYMBYro.woff2).
