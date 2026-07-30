# Third-party notices

The following browser assets are distributed in `public/vendor/`:

| Asset | Version | License | Upstream |
|---|---:|---|---|
| xterm.js | 5.5.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-fit | 0.10.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-web-links | 0.11.0 | MIT | https://github.com/xtermjs/xterm.js |
| marked | 15.0.12 | MIT | https://github.com/markedjs/marked |
| DOMPurify | 3.4.12 | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |

Full license texts are included in `LICENSES/`. `npm run check` verifies that
the vendored bytes match the versions locked in `package-lock.json`.
