/**
 * PoC port of extract-barcodes from C++ to JS/TS
 */
import * as zxing from 'zxing-wasm';
import bwipjs from 'bwip-js';

/**
 * Use bwip-js to render barcode
 *
 * @typedef {object} BwipRenderResult
 * @property {Uint8Array} barcodePng
 * @property {Uint8Array} barcodeSvg
 * @property {boolean} strict
 *
 * @typedef {object} BwipRenderOptions
 * @property {boolean?} strict
 */
export class BwipBarcodeRenderer {
	/**
	 * Render a zxing-wasm detected barcode
	 * @param {zxing.ReadResult} barcode
	 * @param {BwipRenderOptions?} options
	 * @returns {}
	 */
	static async render(barcode, options = {}) {
		const barcodeFormat = barcode.format.toLowerCase();
		// Convert additional options
		const barcodeExtra = JSON.parse(barcode.extra || '{}'), extraOpts = {};
		if ((barcodeFormat === 'qrcode' || barcodeFormat === 'datamatrix') && barcodeExtra?.Version?.length > 0)
			extraOpts['version'] = barcodeExtra.Version;
		if (barcodeFormat === 'qrcode' && Number.isInteger(barcodeExtra?.DataMask))
			extraOpts['mask'] = String(barcodeExtra.DataMask || -1);

		// Attempt to regenerate code with bwip-js (this will be interesting with code128 based stuff)
		let barcodePng = null, barcodeSvg = null, strict = false;
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

			barcodePng = await bwipjs.toBuffer({ ...bwipOptions });
			barcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
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
			if (bwipRaw && options.strict) {
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

			barcodePng = await bwipjs.toBuffer({ ...bwipOptions });
			barcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
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
			if (bwipRaw && options.strict) {
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

			barcodePng = await bwipjs.toBuffer({ ...bwipOptions });
			barcodeSvg = await bwipjs.toSVG({ ...bwipOptions, scale: 1 });
			break;
		}
		default:
			if (options.strict) throw new Error(`Can not regenerate unknown barcode format: '${barcodeFormat}'`);
			console.info(`Not regenerating unknown barcode format '${barcodeFormat}' on page`);
			return null;
		}

		return { barcodePng, barcodeSvg, strict };
	}
}
