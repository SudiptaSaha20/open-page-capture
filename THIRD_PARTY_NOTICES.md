# Third-party software bundled in `vendor/`

| Component | Version | License | Used for |
|---|---|---|---|
| Tesseract.js (`vendor/tesseract/tesseract.min.js`, `worker.min.js`) | 7.0.0 | Apache-2.0 | On-device OCR engine (JS side) |
| Tesseract.js Core (`vendor/tesseract/tesseract-core-*.wasm.js`) | 7.0.0 | Apache-2.0 | OCR engine compiled to WebAssembly |
| Tesseract English model (`vendor/tesseract/tessdata/eng.traineddata.gz`, "4.0.0_best_int") | 1.0.0 (@tesseract.js-data/eng) | Apache-2.0 | English OCR model |
| pdf-lib (`vendor/pdf-lib.min.js`) | 1.17.1 | MIT | PDF creation |
| gifenc (`vendor/gifenc.esm.js`) | 1.0.3 | MIT | GIF encoding |

License texts are in `vendor/` next to each component. Open Page Capture's own source has no license
file yet; add one before publishing.
