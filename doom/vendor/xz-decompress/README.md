# XZ decoder

`xz-decompress.min.js` is the unmodified browser distribution from
[`xz-decompress` 0.2.3](https://www.npmjs.com/package/xz-decompress/v/0.2.3).
It includes its decoder WASM; it does not fetch code or assets at runtime.

- Source: <https://github.com/httptoolkit/xz-decompress>
- Revision: `02e7ec3ee164de24cd3d1baf76911dd0be68a7c0` (`v0.2.3`).
- SHA-256: `d83649874b6198df07340a88377613ccd2267aebb9f18b3be26c6904a81bac52`.
- License: MIT; based on Steve Sanderson's `xzwasm`, maintained by Tim Perry.
- Embedded XZ: Lasse Collin and Igor Pavlov, public domain;
  revision `6f0e0c41e3682254c2e0be245f275f77df821ffe`.
- Embedded allocator: Igalia's `walloc`, MIT;
  revision `a93409f5ebd49c875514c5fee30d3b151f7b0882`.
  `LICENSE` is the unmodified license from that revision.

The npm tarball is available at
<https://registry.npmjs.org/xz-decompress/-/xz-decompress-0.2.3.tgz>.
Extract `package/dist/package/xz-decompress.min.js` to reproduce this file.
The build verifies its hash and embeds its notice and the full MIT text.
Only the single-file target includes this decoder, gzip-compressed.
