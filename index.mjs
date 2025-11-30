/**
 * PoC port of extract-barcodes from C++ to JS/TS
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { createCanvas, loadImage } from 'canvas';
import { createWorker } from 'tesseract.js';
import { Poppler } from 'node-poppler';
import * as rxing from 'rxing-wasm';
import * as zxing from 'zxing-wasm';
import bwipjs from 'bwip-js';

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

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
	.parse();

const debug = argv.debug ?? false;
const inputFiles = Array.from(argv._).map((name) => name.trim());
if (!Array.isArray(inputFiles) || inputFiles.length <= 0) {
	console.error("No input file(s) given");
	process.exit(0);
}

const poppler = new Poppler();
const tessWorker1 = await createWorker('eng');
const zxingToBwip = (name) => {
	switch (name) {
	default: return name.toLowerCase();
	}
};

const seq = (start, end) => {
	const r = [];
	for (let i = Math.min(start, end), j = Math.max(start, end); i <= j; i++)
		r.push(i);
	return r;
};

const excludedPages = ((param) => {
	const result = new Set();
	if (param == null || param.length <= 0)
		return result;

	return param.split(',').reduce((res, item) => {
		const tmp = item.split('-', 2);
		switch (tmp.length) {
		case 2: {
			const start = Number.parseInt(tmp[0], 10);
			const end   = Number.parseInt(tmp[1], 10);
			seq(start, end).forEach((v) => res.add(v));
			break;
		}
		case 1: {
			const value = Number.parseInt(tmp[0], 10);
			res.add(value);
			break;
		}}
		return res;
	}, result);
})(argv.excludePages);

const lcFirst = (value) => {
	return `${value?.substring(0, 1)?.toLowerCase() || ''}${value?.substring(1) || ''}`;
};

const writerBarcodeOptions = (options) => {
	const result = [];
	for (const [key, val] of Object.entries(options)) {
		if (typeof val === 'boolean' && val === true)
			result.push(`${lcFirst(key)}`);
		else if (typeof val === 'string' || typeof val === 'number')
			result.push(`${lcFirst(key)}=${val}`);
	}
	return result.join(',');
};

const writeBarcodeImage = async (srcCtx, barcode, outfile) => {
	const padding = 5;
	const imageData = getBarcodeImageData(srcCtx, barcode);
	const w = imageData.width + (padding << 1);
	const h = imageData.height + (padding << 1);

	const dstCanvas = createCanvas(w, h);
	const dstCtx = dstCanvas.getContext('2d');

	// Transfer pixels into destination canvas
	dstCtx.fillStyle = '#ffffff';
	dstCtx.fillRect(0, 0, w, h);
	dstCtx.putImageData(imageData,
		padding, padding);

	const imageBytes = dstCanvas.toBuffer('image/png');
	if (outfile) await fs.writeFile(outfile, imageBytes);
	return imageBytes;
};

const getBarcodeImageData = (srcCtx, barcode) => {
	const { x, y } = barcode.position.topLeft;
	const w = barcode.position.bottomRight.x - x;
	const h = barcode.position.bottomRight.y - y;
	return srcCtx.getImageData(x, y, w, h);
};

const parsePageRange = (value) => {
	if (typeof value !== 'string' || value.length <= 0)
		return [null, null];

	if (value.includes('-')) {
		return value.split('-', 2)
			.map((val) => Number.parseInt(val, 10) || null);
	} else {
		const page = Number.parseInt(value, 10) || null;
		return [page, page];
	}
};

const pageRange = parsePageRange(argv.pages);

const extraPopplerOptions = {};
const firstPageToConvert = pageRange?.at(0) ?? null;
if (typeof firstPageToConvert === 'number')
	extraPopplerOptions['firstPageToConvert'] = firstPageToConvert;
const lastPageToConvert  = pageRange?.at(1) ?? null;
if (typeof lastPageToConvert === 'number')
	extraPopplerOptions['lastPageToConvert'] = lastPageToConvert;

// console.log(`Pages: ${firstPageToConvert || ''}-${lastPageToConvert || ''}`, pageRange);

const rxingFormatToZxing = (rxingFormatId) => {
	switch (rxingFormatId) {
	case rxing.BarcodeFormat.Code128:
		return "code128";
	case rxing.BarcodeFormat.QrCode:
		return "qrcode";
	case rxing.BarcodeFormat.DataMatrix:
		return "datamatrix";
	default:
		return null;	// ignore mapping errors for now
		// throw new Error(`Unknown rxing barcode format: ${rxingFormatId}`);
	}
};

const rxingBboxToZxingPosition = (rxingBbox) => {
	const [ x1, y1, x2, y2 ] = rxingBbox
		.map((v) => Math.trunc(v));

	return {
		topLeft:     { x: x1, y: y1 },
		topRight:    { x: x2, y: y1 },
		bottomLeft:  { x: x1, y: y2 },
		bottomRight: { x: x2, y: y2 },
	};
};

const rxingDetectBarcodes = async (page) => {
	return loadImage(page).then(async (image) => {
		const pageCanvas = createCanvas(image.width, image.height);
		const pageCtx = pageCanvas.getContext('2d');
		pageCtx.drawImage(image, 0, 0);

		const imageData = pageCtx.getImageData(0, 0, image.width, image.height);
		const lumaData = rxing.convert_imagedata_to_luma(imageData);

		const hints = new rxing.DecodeHintDictionary();
		hints.set_hint(rxing.DecodeHintTypes.TryHarder, "true");

		try {
			return rxing.decode_multi(lumaData, image.width, image.height, hints, true).reduce((res, item) => {
				res.push({
					format: rxingFormatToZxing(item.format()),
					text:   item.text(),
					bytes:  item.raw_bytes(),
					position: rxingBboxToZxingPosition(item.result_points()),
				});
				item.free();
				return res;
			}, []);
		} catch (err) {
			if (err === 'NotFoundException')
				return [];

			throw err;
		}
	});
};

/**
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

const CardinalDirection = Object.freeze({
	NORTH: 0x1,
	SOUTH: 0x2,
	WEST:  0x4,
	EAST:  0x8,
});

class BboxUtils {
	/**
	 * Get center point of bbox
	 * @param {Bbox} bbox
	 * @returns {Point}
	 */
	static bboxCenterPoint(bbox) {
		return {
			x: bbox.x0 + ((bbox.x1 - bbox.x0) >>> 1),
			y: bbox.y0 + ((bbox.y1 - bbox.y0) >>> 1),
		};
	}

	/**
	 * Calculate center point distance between two bounding boxes
	 * @param {Bbox} bboxA
	 * @param {Bbox} bboxB
	 * @returns {number} The center point distance in pixels
	 */
	static bboxCenterDistance(bboxA, bboxB) {
		const { x: ax, y: ay } = BboxUtils.bboxCenterPoint(bboxA);
		const { x: bx, y: by } = BboxUtils.bboxCenterPoint(bboxB);

		if (ax === bx)
			return Math.abs(ay - by);
		else if (ay === by)
			return Math.abs(ax - bx);
		else {
			// pythagoras, i summon you
			const deltaX = ax - bx, deltaY = ay - by;
			return Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
		}
	}

	/**
	 * Check whether bboxB is inside bboxA
	 * @param {Bbox} bboxA
	 * @param {Bbox} bboxB
	 * @returns {boolean}
	 */
	static bboxInsideOther(bboxA, bboxB) {
		return bboxB.x0 >= bboxA.x0 && bboxB.x1 <= bboxA.x1 && bboxB.y0 >= bboxA.y0 && bboxB.y1 <= bboxA.y1;
	}

	/**
	 * Convert barcode outline into a bbox
	 * @param {any} barcode
	 * @returns {Bbox}
	 */
	static bboxFromBarcode(barcode) {
		return Object.freeze({
			x0: barcode.position.topLeft.x,
			y0: barcode.position.topLeft.y,
			x1: barcode.position.bottomRight.x,
			y1: barcode.position.bottomRight.y,
		});
	}

	/**
	 * Detect in which cardinal direction bboxB is in relation to bboxA
	 * @param {*} bboxA
	 * @param {*} bboxB
	 */
	static bboxDirectionOf(bboxA, bboxB) {
		const centerA = this.bboxCenterPoint(bboxA);
		const centerB = this.bboxCenterPoint(bboxB);

		// Calculate angle between both center points
		const radians = Math.atan2((centerA.y - centerB.y), (centerA.x - centerB.x));
		if (radians >= 5.495 || radians < 0.785)
			return CardinalDirection.EAST;
		else if (radians >= 0.785 && radians < 2.355)
			return CardinalDirection.NORTH;
		else if (radians >= 2.355 && radians < 3.925)
			return CardinalDirection.WEST;
		else if (radians >= 3.925 && radians < 5.495)
			return CardinalDirection.SOUTH;
	}
}

if (argv.strict) {
	console.log(`Running in strict mode, using rxing-wasm to attempt a perfect recreation of barcodes...`);
}

try {
	for (const file of inputFiles) {
		const tempDir = await fs.mkdtemp('temp');

		try {
			const outputFile = path.join(tempDir, 'page');
			await poppler.pdfToCairo(file, outputFile, {
				...extraPopplerOptions,
				monochromeFile: false,
				scalePageTo: 1800,	// Going lower increases risk of not detecting (all) barcodes on a page
				pngFile: true,
			});

			const pageResults = {};
			const pageIdRegexp = /page-(\d+)\.png$/;
			for await (const pageFile of fs.glob('page*.png', { cwd: tempDir })) {
				const pageId = Number.parseInt(pageFile.match(pageIdRegexp)?.at(1), 10);
				if (excludedPages.has(pageId)) {
					console.log(`Skipping excluded page '${pageId}'...`);
					continue;
				}

				console.log(`Processing page '${pageId}'...`);

				// zxing-wasm decoder, uses a current version of zxing, which does not return the raw bytes of a barcode
				const page = await fs.readFile(path.join(tempDir, pageFile));
				const pageBarcodes = await zxing.readBarcodes(page, { tryHarder: true, tryDownscale: true, tryDenoise: true, downscaleFactor: 2, });
				if (!Array.isArray(pageBarcodes) || pageBarcodes.length <= 0) {
					console.log(`zxing found no barcodes on page ${pageId}, skipping`);
					continue;
				}

				if (argv.strict) {
					// Run the same page through rxing-wasm to get the raw bytes for each barcode
					const rxingBarcodes = (await rxingDetectBarcodes(page))
						.reduce((res, item) => res.set(item.text, item), new Map());

					// Augment zxing-wasm detected barcodes with raw byte information from rxing-wasm
					pageBarcodes.forEach((item) => item.rawBytes = rxingBarcodes?.get(item.text)?.bytes);
				}

				// Extract page text
				const ocrResult = (await tessWorker1.recognize(page, {}, { text: true, blocks: true }))?.data;
				const pageTextBlocks = ocrResult?.blocks || [];
				const pageText = ocrResult?.text ?? '';

				// Convert into a list of text lines
				const pageTextLines = pageTextBlocks.reduce((res, block) => {
					for (const paragraph of block.paragraphs) {
						for (const line of paragraph.lines) {
							res.push({
								text: line.text,
								bbox: line.bbox,
							});
						}
					}
					return res;
				}, []);

				// Extract original barcodes and attempt to regenerate them from the detected data
				const extractedPageBarcodes = [];
				await loadImage(page /* path.join(tempDir, pageFile) */).then(async (image) => {
					const pageCanvas = createCanvas(image.width, image.height);
					const pageCtx = pageCanvas.getContext('2d');
					pageCtx.drawImage(image, 0, 0);

					for (const [idx, barcode] of pageBarcodes.entries()) {
						const barcodeFormat = zxingToBwip(barcode.format);
						if (!barcode.isValid) {
							console.log(`Skipping invalid barcode #${idx} (${barcodeFormat}) on page`);
							continue;
						}

						// Convert additional options
						const barcodeExtra = JSON.parse(barcode.extra || '{}'), extraOpts = {};
						if ((barcodeFormat === 'qrcode' || barcodeFormat === 'datamatrix') && barcodeExtra?.Version?.length > 0)
							extraOpts['version'] = barcodeExtra.Version;
						if (barcodeFormat === 'qrcode' && Number.isInteger(barcodeExtra?.DataMask))
							extraOpts['mask'] = String(barcodeExtra.DataMask || -1);

						// Attempt to regenerate code with bwip-js (this will be interesting with code128 based stuff)
						let bwipBarcodePng = null, bwipBarcodeSvg = null;
						let regen = true, strict = false;
						switch (barcodeFormat) {
						case 'qrcode': {
							// NOTE: Rendered barcodes will most likely not match original due
							// to different payload encoding (or lack of control thereof)
							const bwipOptions = Object.freeze({
								...extraOpts,
								bcid: barcodeFormat,
								text: barcode.text,
								paddingbottom: 2,
								paddingtop: 2,
								paddingleft: 2,
								paddingright: 2,
								backgroundcolor: 'FFFFFF',
								includetext: false,
								textalign: 'center',
								eclevel: barcode.ecLevel,
								fixedeclevel: true,
								scale: 3,
							});

							bwipBarcodePng = await bwipjs.toBuffer({ ...bwipOptions });
							bwipBarcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
							break;
						}
						case 'datamatrix': {
							// NOTE: This seems to match to original barcodes nicely, at least for the Datalogic QD24XX manual
							// NOTE: Datamatrix codes from the QD24xx manual have a trailing '\r' char, which changes the result when removed with trim()
							const bwipRaw = Array.from(barcode.rawBytes || [])
								.map((v) => `^${v.toString().padStart(3, '0')}`)
								.join('') || null;

							const commonBwipOptions = Object.freeze({
								...extraOpts,
								bcid: barcodeFormat,
								paddingbottom: 2,
								paddingtop: 2,
								paddingleft: 2,
								paddingright: 2,
								backgroundcolor: 'FFFFFF',
								includetext: false,
								textalign: 'center',
								scale: 3,
							});

							let bwipOptions;
							if (bwipRaw && argv.strict) {
								bwipOptions = {
									...commonBwipOptions,
									alttext: barcode.text,
									text: bwipRaw,
									raw: true,
								};
								strict = true;
							} else {
								bwipOptions = {
									...commonBwipOptions,
									alttext: barcode.text,
									parsefnc: barcode.readerInit,
									text: barcode.readerInit
										? "^PROG".concat(barcode.text)
										: barcode.text,
								};
							}

							bwipBarcodePng = await bwipjs.toBuffer({ ...bwipOptions });
							bwipBarcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
							break;
						}
						case 'code128': {
							// Convert raw bytes into code128 codepoints for bwip
							// (sans the checksum and stop byte, which bwip will handle itself)
							const bwipRaw = Array.from(barcode.rawBytes || [])
								.slice(0, -2)
								.map((v) => `^${v.toString().padStart(3, '0')}`)
								.join('') || null;

							const commonBwipOptions = Object.freeze({
								...extraOpts,
								bcid: barcodeFormat,
								paddingbottom: 2,
								paddingtop: 2,
								paddingleft: 2,
								paddingright: 2,
								backgroundcolor: 'FFFFFF',
								includetext: false,
								textalign: 'center',
								scale: 3,
							});

							let bwipOptions;
							if (bwipRaw && argv.strict) {
								bwipOptions = {
									...commonBwipOptions,
									// alttext: barcode.text,
									text: bwipRaw,
									raw: true,
								};
								strict = true;
							} else {
								bwipOptions = {
									...commonBwipOptions,
									parsefnc: barcode.readerInit,
									text: barcode.readerInit
										? "^FNC3".concat(barcode.text)
										: barcode.text,
								};
							}

							bwipBarcodePng = await bwipjs.toBuffer({ ...bwipOptions });
							bwipBarcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
							break;
						}
						default:
							if (argv.strict) throw new Error(`Can not regenerate unknown barcode format: '${barcodeFormat}'`);
							console.log(`Not regenerating unknown barcode format '${barcodeFormat}' on page`);
							regen = false;
						}

						if (regen) {
							await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-bwp.png`), bwipBarcodePng);
							await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-bwp.svg`), bwipBarcodeSvg);

							// // Re-render barcode into SVG (zxing somewhat broke the bwip-js render route, so this is the least they can do...)
							// // Neither does a good job for QRCode, and bwip-js recreates datamatrix code nicely, while this also fails there
							// const zxingSvgOptions = writerBarcodeOptions(barcodeExtra);
							// const { image: zxingPng, svg: zxingSvg } = await zxing.writeBarcode(barcode.bytes, {
							// 	withQuietZones: true,
							// 	options: zxingSvgOptions,
							// 	readerInit: barcode.readerInit,
							// 	ecLevel: barcode.ecLevel ?? undefined,
							// 	format:  barcode.format,
							// 	scale: 5,
							// });

							// await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-zxg.svg`), zxingSvg);
							// await fs.writeFile(path.join(tempDir, `barcode-${pageId}-${idx}-zxg.png`), await zxingPng.bytes());
						}

						// Extract original barcode into image file (for now) and for embedding
						const barcodeImageBytes = await writeBarcodeImage(pageCtx, barcode, path.join(tempDir, `barcode-${pageId}-${idx}-org.png`));

						/**
						 * Label detection
						 */
						let label = ((barcode, textLines) => {
							const barcodeBbox = BboxUtils.bboxFromBarcode(barcode);
							const minDistance = Math.min((barcodeBbox.x1 - barcodeBbox.x0) >>> 1, (barcodeBbox.y1 - barcodeBbox.y0) >>> 1);
							const maxDistance = Math.max(pageCanvas.width, pageCanvas.height) * 0.25;

							const candidates = [];
							for (const line of textLines) {
								let distance = BboxUtils.bboxCenterDistance(barcodeBbox, line.bbox);
								if (distance >= maxDistance || distance <= minDistance || BboxUtils.bboxInsideOther(barcodeBbox, line.bbox))
									continue;

								// Slightly punish text lines that are above the barcode, as the label is usually either below or left/right of it
								if (BboxUtils.bboxDirectionOf(barcodeBbox, line.bbox) === CardinalDirection.NORTH) {
									if (argv.debug) console.log(`Giving 10% debuff to text line '${line.text.trim()}' above barcode`);
									distance += distance * 0.1;	// Add 10% "debuff" to favor others
								}

								candidates.push({
									...line,
									distance,
								});
							}

							// Get entry with lowest distance
							const selected = candidates.sort((a, b) => a.distance - b.distance).at(0);
							// console.log(`Selected label for barcode '${barcode.text}':`, selected, candidates);
							return selected?.text?.trim();
						})(barcode, pageTextLines);


						extractedPageBarcodes.push({
							...barcode, strict, label,
							format: barcodeFormat,
							sourcePng: barcodeImageBytes,
							barcodeSvg: bwipBarcodeSvg,	// Use bwip-js for now (both suck at QR, bwip-js wins for datamatrix)
							barcodePng: bwipBarcodePng,
						})
					}
				});

				pageResults[`page:${pageId}`] = Object.freeze({
					id: pageId, file: pageFile, text: pageText,
					barcodes: extractedPageBarcodes.map((item) => {
						return {
							text: item.text,
							data: Buffer.from(item.bytes)?.toString('base64'),
							label:  item.label,
							format: item.format,
							source: item.sourcePng?.toString('base64'),
							strict: item.strict,	// Strict / faithful reproduction has been attempted, generated barcode should match original (only code128 and datamatrix)
							output: {
								png: item.barcodePng?.toString('base64'),
								svg: item.barcodeSvg,
							},
							bbox: BboxUtils.bboxFromBarcode(item),
						};
					}),
					textLines: pageTextLines,
				});
			}

			// add common file header
			pageResults['common'] = {
				file, strict: argv.strict ?? false,
			};

			await fs.writeFile(`${file}.json`, JSON.stringify(pageResults, undefined, debug ? 2 : 0));
		} finally {
			// TODO: Delete temp directory recursive
			// await fs.unlink(tempDir);
		}
	}
} catch (err) {
	console.error("Failed to process file", err);
} finally {
	await tessWorker1.terminate();
}
