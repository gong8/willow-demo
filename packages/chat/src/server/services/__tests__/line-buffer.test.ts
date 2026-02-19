import { describe, it, expect } from "vitest";
import { LineBuffer } from "../line-buffer.js";

describe("LineBuffer", () => {
	it("processes complete lines", () => {
		const buffer = new LineBuffer();
		const lines = buffer.push("hello\nworld\n");
		expect(lines).toEqual(["hello", "world"]);
	});

	it("buffers incomplete lines", () => {
		const buffer = new LineBuffer();
		let lines = buffer.push("hello");
		expect(lines).toEqual([]);
		
		lines = buffer.push(" world\nfoo\nbar");
		expect(lines).toEqual(["hello world", "foo"]);
		
		lines = buffer.push("\n");
		expect(lines).toEqual(["bar"]);
	});

	it("handles multiple chunks", () => {
		const buffer = new LineBuffer();
		const result = [...buffer.push("a\n"), ...buffer.push("b\n"), ...buffer.push("c\n")];
		expect(result).toEqual(["a", "b", "c"]);
	});
});
