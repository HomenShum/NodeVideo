# Fixed renderer font

`Geist-Variable-Latin.ttf` is the renderer's bundled text primitive. The worker always passes this
file through FFmpeg's `drawtext=fontfile=...` option and never asks the host to discover a font.
That keeps text layout stable on local Windows, Linux workers, and CI.

The TTF was mechanically converted without design changes from
`@fontsource-variable/geist@5.2.9/files/geist-latin-wght-normal.woff2`, already pinned in this
repository's npm lockfile. Upstream is the [Geist font project](https://github.com/vercel/geist-font).
Copyright belongs to the Geist Project Authors. Redistribution is under the SIL Open Font License
1.1 in [`OFL.txt`](./OFL.txt).
