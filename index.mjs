/**
 * PoC port of extract-barcodes from C++ to JS/TS
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { createCanvas, loadImage } from 'canvas';
import { Poppler } from 'node-poppler';
import * as zxing from 'zxing-wasm';

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { rxingDetectBarcode } from './src/rxing.mjs';
import { BwipBarcodeRenderer } from './src/bwip.mjs';
import {
	ArgumentUtils,
	BboxUtils,
	CardinalDirection,
	StringUtils,
	ptsToPixel,
	writeBarcodeImage,
} from './src/utils.mjs';

const argv = yargs(hideBin(process.argv))
	.usage('Usage: $0 [-d|--debug] <filename1>...<filenameN>')
	.option('debug', {
		alias: 'd',
		type: 'boolean',
		requiresArg: false,
		description: 'Enable debug mode',
		default: false,
	})
	.option('pages', {
		alias: 'p',
		type: 'string',
		requiresArg: true,
		description: 'List of pages to process',
		default: null,
	})
	.option('exclude-pages', {
		alias: 'x',
		type: 'string',
		requiresArg: true,
		description: 'List of pages to exclude from processing',
		default: null,
	})
	.option('strict', {
		alias: 's',
		type: 'boolean',
		requiresArg: false,
		description: 'Attempt strict reproduction of barcodes',
		default: false,
	})
	.option('output', {
		alias: 'o',
		type: 'string',
		requiresArg: true,
		description: 'Output filename (single file mode only)',
		default: null,
	})
	.parse();

const debug = argv.debug ?? false;
const inputFiles = Array.from(argv._).map((name) => name.trim());
if (!Array.isArray(inputFiles) || inputFiles.length <= 0) {
	console.error("No input file(s) given");
	process.exit(1);
} else if (StringUtils.isNotBlank(argv.output) && inputFiles.length > 1) {
	console.error("-o / --output option can only be used with a single input file");
	process.exit(1);
}

const excludedPages = ArgumentUtils.parsePagelistSet(argv.excludePages);

const extraPopplerOptions = {};
const pageRange = ArgumentUtils.parsePageRange(argv.pages);
const firstPageToConvert = pageRange?.at(0) ?? null;
if (typeof firstPageToConvert === 'number')
	extraPopplerOptions['firstPageToConvert'] = firstPageToConvert;
const lastPageToConvert  = pageRange?.at(1) ?? null;
if (typeof lastPageToConvert === 'number')
	extraPopplerOptions['lastPageToConvert'] = lastPageToConvert;

if (argv.strict) {
	console.info(`Running in strict mode, additionally using rxing-wasm to attempt a perfect recreation of code128 and datamatrix barcodes...`);
}

try {
	const poppler = new Poppler();

	for (const file of inputFiles) {
		const tempDir = await fs.mkdtemp('temp');

		try {
			// Extract page dimensions and rotation (needed for TSV bbox rescaling)
			console.info(`Reading and processing '${file}' metadata...`);
			const fileInfo = await poppler.pdfInfo(file, {
				...extraPopplerOptions,
				firstPageToConvert: extraPopplerOptions.firstPageToConvert ?? -1,
				lastPageToConvert:  extraPopplerOptions.lastPageToConvert  ?? -1,
				printAsJson: true,
			}).then((result) => {
				// Extract and convert page metadata (size, rotation)
				return Object.entries(result).reduce((res, [key, value]) => {
					const [_, pageNum, pageProp] = key.match(/^page(\d+)(.+)$/) || [null, null, null];
					if (pageNum == null || pageProp == null) {
						switch (key) {
						case 'title':
							res['title'] = value.trim();
							return res;
						case 'pages':
							res['pages'] = Number.parseInt(value, 10);
							return res;
						default:	// ignore
							return res;
						}
					}

					// Handle page property
					const pageId = Number.parseInt(pageNum, 10);
					const entry = res.page[pageNum] ?? (res.page[pageNum] = { page: pageId });
					switch (pageProp) {
					case "Size": {	// Size: '0.000 x 0.000 pts'
						const comp = value.split(' ');
						entry['size'] = {
							w: Math.ceil(ptsToPixel(Number.parseFloat(comp[0], 10))),
							h: Math.ceil(ptsToPixel(Number.parseFloat(comp[2], 10))),
						};
						return res;
					}
					case "Rot":	// Rotation
						entry['rotation'] = Number.parseFloat(value, 10);
						return res;
					default:
						return res;
					}
				}, { page: {}, pages: 0 });
			});

			// Generate TSV text dump of PDF content
			console.info(`Extracting and processing '${file}' text...`);
			const tsvFile = path.join(tempDir, 'text.tsv');
			const tsvTextLines = await poppler.pdfToText(file, tsvFile, {
				...extraPopplerOptions,
				generateTsvFile: true,
			}).then(async () => {
				// Read and postprocess TSV per-word data by merging it back into lines
				const lines = await fs.readFile(tsvFile, { encoding: 'utf8' });
				return Array.from(lines.split('\n').reduce((res, line) => {
					const [level, pageNum, parNum, blockNum, lineNum, _wordNum, x, y, w, h, _conf, text] = line.split('\t', 12)
						.map((val, idx, line) => idx <= line.length - 2 ? Number.parseFloat(val, 10) : val.trim());
					if (Number.isNaN(level) || level <= 4) return res;

					const lineKey = `${level}:${pageNum}:${parNum}:${blockNum}:${lineNum}`;
					if (res.has(lineKey)) {
						// Merge text, resize bbox
						const entry = res.get(lineKey);
						entry.text += ' ' + text;
						entry.bbox.x1 = Math.max(entry.bbox.x1, x + w);
						entry.bbox.y1 = Math.max(entry.bbox.y1, y + h);
					} else {
						res.set(lineKey, {
							page: pageNum,
							// paragraph: parNum,
							// block: blockNum,
							// line: lineNum,
							text,
							bbox: {
								x0: x,
								y0: y,
								x1: x + w,
								y1: y + h,
							},
						});
					}
					return res;
				}, new Map()).values()).map((item) => {
					return {
						...item,
						bbox: {
							x0: ptsToPixel(item.bbox.x0),
							y0: ptsToPixel(item.bbox.y0),
							x1: ptsToPixel(item.bbox.x1),
							y1: ptsToPixel(item.bbox.y1),
						},
					};
				});
			});

			// Extract pages into PNG images
			console.info(`Converting ${fileInfo.pages} pages into PNG files (this may take a while)...`);
			await poppler.pdfToCairo(file, path.join(tempDir, 'page'), {
				...extraPopplerOptions,
				resolutionXYAxis: 150,	// Harcode this so we can scale TSV coordinates
				monochromeFile: false,
				scalePageTo: 1500,	// Going lower increases risk of not detecting (all) barcodes on a page
				pngFile: true,
			});

			// Set common file header
			const pageResults = {
				['common']: {
					file, strict: argv.strict ?? false,
					timestamp: new Date().toISOString(),
					pages: fileInfo.pages,
				},
			};

			const pageIdRegexp = /page-(\d+)\.png$/;
			for await (const pageFile of fs.glob('page*.png', { cwd: tempDir })) {
				const pageId = Number.parseInt(pageFile.match(pageIdRegexp)?.at(1), 10);
				if (excludedPages.has(pageId)) {
					console.info(`Skipping excluded page '${pageId}'...`);
					continue;
				}

				// zxing-wasm decoder, uses a current version of zxing, which does not return the raw bytes of a barcode
				const page = await fs.readFile(path.join(tempDir, pageFile));
				const pageBarcodes = await zxing.readBarcodes(page, { tryHarder: true, tryDownscale: true, tryDenoise: true, downscaleFactor: 2, });
				if (!Array.isArray(pageBarcodes) || pageBarcodes.length <= 0) {
					console.info(`Processing page '${pageId}'... no barcodes found, skipping`);
					continue;
				} else {
					console.info(`Processing page '${pageId}' with ${pageBarcodes.length} barcodes...`);
				}

				// Extract original barcodes and attempt to regenerate them from the detected data
				const pageData = await loadImage(page).then(async (image) => {
					const pageCanvas = createCanvas(image.width, image.height);
					const pageCtx = pageCanvas.getContext('2d');
					pageCtx.drawImage(image, 0, 0);

					const processedBarcodes = [];
					const pageTsvLines = ((pageNum, pageInfo, canvas, tsvLines) => {
						const { w: pw, h: ph } = pageInfo?.size ?? { w: canvas.width, h: canvas.height };
						const sx = canvas.width  / pw;	// page to image scaling X
						const sy = canvas.height / ph;	// page to image scaling Y

						// Extract TSV lines for the current page and rescale the pixels
						// to the actual page image dimensions
						return tsvLines.filter((line) => line.page === pageNum).map((line) => {
							return {
								text: line.text,
								bbox: {
									x0: Math.floor(line.bbox.x0 * sx),
									y0: Math.floor(line.bbox.y0 * sy),
									x1: Math.ceil(line.bbox.x1 * sx),
									y1: Math.ceil(line.bbox.y1 * sy),
								},
							};
						});
					})(pageId, fileInfo.page[pageId], pageCanvas, tsvTextLines);

					/**
					 * Strict mode: Reprocess barcodes on the page with rxing, which still allows
					 * us to get the raw bytes of a barcode (and not just the content), this can be
					 * used to create perfect reconstructions of code128 and datamatrix barcodes
					 *
					 * @todo Instead of re-scanning the whole page, run rxing on individual extracted
					 *       code128/datamatrix codes, which should be a lot faster
					 */
					const rxingBarcodeFormats = ["code128", "datamatrix"];
					for (const [idx, barcode] of pageBarcodes.entries()) {
						const barcodeFormat = barcode.format.toLowerCase();
						if (!barcode.isValid || barcodeFormat === 'databar' /* false positive */) {
							console.info(`Skipping invalid barcode #${idx} (${barcodeFormat}) on page`);
							continue;
						}

						// Extract original barcode into image file (for now) and for embedding
						const barcodeBbox = BboxUtils.bboxFromBarcode(barcode);
						const barcodeImageBytes = await writeBarcodeImage(pageCtx, barcodeBbox, argv.debug && path.join(tempDir, `barcode-${pageId}-${idx}-org.png`));

						// Run the barcode image through rxing-wasm to get the raw bytes
						if (argv.strict && rxingBarcodeFormats.includes(barcodeFormat)) {
							if (argv.debug) console.debug(`Reprocessing page '${pageId}' barcode #${idx} (${barcodeFormat}: '${barcode.text.trim()}') with rxing-wasm to extract raw bytes...`);
							barcode.rawBytes = (await rxingDetectBarcode(pageCtx, barcodeBbox))?.bytes;
							if (argv.debug && barcode.rawBytes) {
								console.debug(`rxing-wasm detected barcode bytes:`,
									Buffer.from(barcode.rawBytes).toString('hex'));
							}
						}

						/*
						 * Re-render barcode into clean PNG and SVG images
						 *
						 * Strict mode uses the raw bytes extracted by rxing to generate perfect
						 * copies of code128 and datamatrix codes (feeding the raw bytes into bwip-js)
						 */
						const {
							barcodeSvg: bwipBarcodeSvg,
							barcodePng: bwipBarcodePng,
							strict
						} = await (async (barcode, options = {}) => {
							const defaultResult = { barcodeSvg: null, barcodePng: null, strict: false };
							try {
								const result = (await BwipBarcodeRenderer.render(barcode, options)) ?? defaultResult;
								if (options.debug && result.barcodePng) {
									await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-bwp.png`), result.barcodePng);
								}
								if (options.debug && result.barcodeSvg) {
									await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-bwp.svg`), result.barcodeSvg);
								}
								return result;
							} catch (err) {
								console.error(`Failed to re-render barcode ${idx} on page ${pageId}:`, err);
								return defaultResult;
							}
						})(barcode, { strict: argv.strict, debug: argv.debug });

						/**
						 * Label detection
						 *
						 * Use proximity to select one of the text lines close to the barcode as a text label.
						 * These lines are usually directly below the barcode, but can be to either side or above it
						 * (Highly dependent on the PDFs overall quality...)
						 */
						const label = ((barcode, bbox, textLines) => {
							if (argv.debug) console.debug(`Detecting label of barcode '${barcode.text.trim()}'...`);

							// Maximum center point distance: 25% of longest page dimension; minimum distance: nearest edge of barcode
							const minDistance = Math.min((bbox.x1 - bbox.x0) >>> 1, (bbox.y1 - bbox.y0) >>> 1) * 1.00; // adjustment factor for tsv bbox conversion inaccuracies
							const maxDistance = Math.max(pageCanvas.width, pageCanvas.height) * 0.25;  // adjustment factor increased (from 0.25 OCR) for tsv bbox conversion inaccuracies

							const candidates = [];
							for (const line of textLines) {
								let distance = BboxUtils.bboxCenterDistance(bbox, line.bbox);
								if (distance >= maxDistance || distance <= minDistance || BboxUtils.bboxInsideOther(bbox, line.bbox))
									continue;

								// Slightly punish text lines that are above the barcode, as the label is usually either below or left/right of it
								const cardinalPosition = BboxUtils.bboxDirectionOf(bbox, line.bbox);
								if (cardinalPosition === CardinalDirection.NORTH) {
									// if (argv.debug) console.debug(`Giving a 10% debuff to text line '${line.text.trim()}' above barcode`);
									distance += distance * 0.1;	// Add 10% "debuff" to favor others
								} else if (cardinalPosition === CardinalDirection.WEST || cardinalPosition === CardinalDirection.EAST) {
									// if (argv.debug) console.debug(`Giving a 5% debuff to text line '${line.text.trim()}' left/right of barcode`);
									distance += distance * 0.05;	// Add 5% "debuff" to favor others
								}

								candidates.push({
									...line,
									distance,
								});
							}

							// Return the entry with the lowest distance score
							return candidates.sort((a, b) => a.distance - b.distance)
								.at(0)?.text?.trim();
						})(barcode, barcodeBbox, pageTsvLines);


						// Push processed barcode data onto the list, including the extract original image data as PNG,
						// the rendered ones, barcode content, format, textual information and position
						processedBarcodes.push({
							...barcode, strict, label,
							format: barcodeFormat,
							sourcePng: barcodeImageBytes,
							barcodeSvg: bwipBarcodeSvg,
							barcodePng: bwipBarcodePng,
						});
					}

					return {
						size: { width: image.width, height: image.height },
						text: pageTsvLines.map((item) => item.text).join('\n'),
						textLines: pageTsvLines,
						barcodes: processedBarcodes,
					};
				});

				// Ignore result if no valid barcodes found
				if (!Array.isArray(pageData.barcodes) || pageData.barcodes.length <= 0)
					continue;

				pageResults[`page:${pageId}`] = Object.freeze({
					id: pageId, file: pageFile,
					text: pageData.text,
					size: pageData.size,
					barcodes: pageData.barcodes.map((item) => {
						return {
							text: item.text,
							data: Buffer.from(item.bytes)?.toString('base64'),
							bbox: BboxUtils.bboxFromBarcode(item),
							label:  item.label,
							format: item.format,
							strict: item.strict,	// Strict / faithful reproduction has been attempted, generated barcode should match original (only code128 and datamatrix)
							source: {
								png: item.sourcePng?.toString('base64'),
							},
							output: {
								png: item.barcodePng?.toString('base64'),
								svg: item.barcodeSvg,
							},
						};
					}),
					textLines: pageData.tsvLines,
				});
			}

			const resultOutputFile = argv.output || `${file}.json`;
			if (argv.debug) console.debug(`Writing result to file '${resultOutputFile}'...`);
			await fs.writeFile(resultOutputFile, JSON.stringify(pageResults, undefined, debug ? 2 : 0));
		} finally {
			if (!argv.debug && StringUtils.isNotBlank(tempDir)) {
				await fs.rm(tempDir, {
					recursive: true,
					force: true,
				});
			}
		}
	}
} catch (err) {
	console.error("Failed to process file", err);
}
