/**
 * Buffers incoming text chunks and yields complete newline-delimited lines.
 */
export class LineBuffer {
	private buffer = "";

	push(chunk: string): string[] {
		this.buffer += chunk;
		const parts = this.buffer.split("\n");
		this.buffer = parts.pop() || "";
		return parts;
	}
}
