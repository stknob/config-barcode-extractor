/**
 * PoC port of extract-barcodes from C++ to JS/TS
 */
import { createCanvas, loadImage } from 'canvas';
import { getBarcodeImageData } from './utils.mjs';
import * as rxing from 'rxing-wasm';

export function rxingFormatToZxing(rxingFormatId) {
	switch (rxingFormatId) {
	case rxing.BarcodeFormat.Code128:
		return "code128";
	case rxing.BarcodeFormat.QrCode:
		return "qrcode";
	case rxing.BarcodeFormat.DataMatrix:
		return "datamatrix";
	default:	// ignore mapping errors for now
		return null;
	}
}

export function rxingBboxToZxingPosition(rxingBbox, offset = null) {
	const ox = offset?.x ?? 0, oy = offset?.y ?? 0;
	const [ x1, y1, x2, y2 ] = rxingBbox
		.map((v) => Math.trunc(v));

	return {
		topLeft:     { x: x1 + ox, y: y1 + oy },
		topRight:    { x: x2 + ox, y: y1 + oy },
		bottomLeft:  { x: x1 + ox, y: y2 + oy },
		bottomRight: { x: x2 + ox, y: y2 + oy },
	};
}

export async function rxingDetectBarcodes(page) {
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
}

/**
 * @param {CanvasRenderingContext2D} srcCanvas Source canvas
 * @param {Bbox} bbox
 * @returns
 */
export async function rxingDetectBarcode(srcCtx, bbox, options = { padding: 5 }) {
	const imageData = getBarcodeImageData(srcCtx, bbox, { padding: options?.padding });
	const lumaData = rxing.convert_imagedata_to_luma(imageData);

	const iw = imageData.width, ih = imageData.height;
	const ix = bbox.x0, iy = bbox.y0;

	const hints = new rxing.DecodeHintDictionary();
	hints.set_hint(rxing.DecodeHintTypes.TryHarder, "true");

	let result = null;
	try {
		result = await rxing.decode_barcode_with_hints(lumaData, iw, ih, hints, true);
		return {
			format: rxingFormatToZxing(result.format()),
			position: rxingBboxToZxingPosition(result.result_points(), { x: ix, y: iy }),
			text:   result.text(),
			bytes:  result.raw_bytes(),
		};
	} catch (err) {
		return null;
	} finally {
		hints?.free();
		result?.free();
	}
}
