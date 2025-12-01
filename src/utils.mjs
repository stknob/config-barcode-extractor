/**
 * Various utility classed and functions
 *
 */
import { createCanvas } from 'canvas';

export const ptsToPixel = (pts) => pts * 0.75;
export const pixelToPts = (px)  => px  * 1.33;


/**
 *
 * @param {CanvasRenderingContext2D} srcCtx
 * @param {object} barcode
 * @param {string?} outfile
 * @returns {Promise<Uint8Array>}
 */
export const writeBarcodeImage = async (srcCtx, barcode, outfile) => {
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

/**
 * @param {CanvasRenderingContext2D} srcCtx
 * @param {string} outfile
 * @returns {Promise<Uint8Array>}
 */
export const writeImage = async (srcCtx, outfile) => {
	const imageBytes = srcCtx.canvas.toBuffer('image/png');
	if (outfile) await fs.writeFile(outfile, imageBytes);
	return imageBytes;
};

/**
 *
 * @param {CanvasRenderingContext2D} srcCtx
 * @param {object} barcode
 * @returns {ImageData}
 */
export const getBarcodeImageData = (srcCtx, barcode) => {
	const { x, y } = barcode.position.topLeft;
	const w = barcode.position.bottomRight.x - x;
	const h = barcode.position.bottomRight.y - y;
	return srcCtx.getImageData(x, y, w, h);
};


export class ArrayUtils {
	/**
	 * Create a sequence of increasing numbers starting at `start` up to (including) `end`
	 * @param {number} start
	 * @param {number} end
	 * @returns {number[]} Sequence of increasing numbers
	 */
	static seq(start, end) {
		const r = [];
		for (let i = Math.min(start, end), j = Math.max(start, end); i <= j; i++)
			r.push(i);
		return r;
	}
}

export class StringUtils {
	/**
	 *
	 * @param {string} str
	 * @returns {boolean}
	 */
	static isEmpty(str) {
		return typeof str !== 'string' || str.length <= 0;
	}

	static isNotEmpty(str) {
		return this.isEmpty(str) === false;
	}

	/**
	 *
	 * @param {string} str
	 * @returns {boolean}
	 */
	static isBlank(str) {
		return typeof str !== 'string' || str.trim().length <= 0;
	}

	static isNotBlank(str) {
		return this.isBlank(str) === false;
	}
}

export class ArgumentUtils {
	/**
	 * Parse a comma-separated list of pages and page ranges
	 * @example
	 *   ArgumentUtils.parsePagelistSet('1-3,5-6,8,10')
	 * @param {string} param
	 * @returns {Set<number>} A set of page numbers
	 */
	static parsePagelistSet(param) {
		const result = new Set();
		if (param == null || param.length <= 0)
			return result;

		return param.split(',').reduce((res, item) => {
			const tmp = item.split('-', 2);
			switch (tmp.length) {
			default: throw new Error("Invalid parameter format");
			case 2: {
				const start = Number.parseInt(tmp[0], 10);
				const end   = Number.parseInt(tmp[1], 10);
				ArrayUtils.seq(start, end).forEach((v) => res.add(v));
				break;
			}
			case 1: {
				const value = Number.parseInt(tmp[0], 10);
				res.add(value);
				break;
			}}
			return res;
		}, result);
	}

	/**
	 *
	 * @param {string} param
	 */
	static parsePageRange(param) {
		if (typeof param !== 'string' || param.length <= 0)
			return [null, null];

		if (param.includes('-')) {
			return param.split('-', 2).map((value) => Number.parseInt(value, 10) || null);
		} else {
			const page = Number.parseInt(param, 10) || null;
			return [page, page];
		}
	}
}

/**
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */
export const CardinalDirection = Object.freeze({
	NORTH: 0x1,
	SOUTH: 0x2,
	WEST:  0x4,
	EAST:  0x8,
});

/**
 *
 */
export class BboxUtils {
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
	 * @param {Bbox} bboxA
	 * @param {Bbox} bboxB
	 * @returns {CardinalDirection} one of the cardinal directions
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

	/**
	 * Mark bbox outline on a canvas
	 * @param {CanvasRenderingContext2D} drawCtx
	 * @param {Bbox} bbox
	 * @param {string} color
	 */
	static bboxOutline(drawCtx, bbox, color = '#ff0000') {
		drawCtx.strokeStyle = color;
		drawCtx.lineWidth = 1;
		drawCtx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
	}
}
