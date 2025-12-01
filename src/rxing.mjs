/**
 * PoC port of extract-barcodes from C++ to JS/TS
 */
import { createCanvas, loadImage } from 'canvas';
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

export function rxingBboxToZxingPosition(rxingBbox) {
	const [ x1, y1, x2, y2 ] = rxingBbox
		.map((v) => Math.trunc(v));

	return {
		topLeft:     { x: x1, y: y1 },
		topRight:    { x: x2, y: y1 },
		bottomLeft:  { x: x1, y: y2 },
		bottomRight: { x: x2, y: y2 },
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
