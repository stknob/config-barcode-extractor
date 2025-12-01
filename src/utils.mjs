/**
 * Various utility classed and functions
 *
 */

export const ptsToPixel = (pts) => pts * 0.75;
export const pixelToPts = (px)  => px  * 1.33;

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
}
