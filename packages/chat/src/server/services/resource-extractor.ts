import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { convert } from "html-to-text";
import { PDFParse } from "pdf-parse";
import { createLogger } from "../logger.js";

const log = createLogger("resource-extractor");

export const RESOURCES_DIR = join(homedir(), ".willow", "resources");

export async function ensureResourcesDir(): Promise<void> {
	await mkdir(RESOURCES_DIR, { recursive: true });
}

/**
 * Strip null bytes and other problematic control characters from extracted text.
 * PDF extraction often produces null bytes that break Node.js spawn args.
 */
function cleanExtractedText(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional cleanup of PDF artifacts
	return text.replaceAll("\0", "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Extract text from a file on disk based on its content type.
 */
export async function extractText(
	diskPath: string,
	contentType: string,
): Promise<string> {
	if (contentType === "application/pdf") {
		const buffer = await readFile(diskPath);
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		const result = await parser.getText();
		await parser.destroy();
		return cleanExtractedText(result.text);
	}

	// text/plain, text/markdown, etc.
	const buffer = await readFile(diskPath);
	return cleanExtractedText(buffer.toString("utf-8"));
}

/**
 * Fetch a URL, extract its text content, and save the HTML to disk.
 * Returns { title, text, diskPath }.
 */
export async function fetchAndExtractUrl(
	url: string,
	resourceId: string,
): Promise<{ title: string; text: string; diskPath: string }> {
	log.info("Fetching URL", { url });

	const res = await fetch(url, {
		headers: {
			"User-Agent":
				"Mozilla/5.0 (compatible; Willow/1.0; +https://github.com/willow)",
			Accept: "text/html,application/xhtml+xml,*/*",
		},
		redirect: "follow",
	});

	if (!res.ok) {
		throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
	}

	const html = await res.text();

	// Extract title from HTML
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

	// Convert HTML to text
	const text = convert(html, {
		wordwrap: false,
		selectors: [
			{ selector: "img", format: "skip" },
			{ selector: "script", format: "skip" },
			{ selector: "style", format: "skip" },
			{ selector: "nav", format: "skip" },
			{ selector: "footer", format: "skip" },
			{ selector: "a", options: { ignoreHref: true } },
		],
	});

	// Save HTML to disk
	await ensureResourcesDir();
	const diskPath = join(RESOURCES_DIR, `${resourceId}.html`);
	await writeFile(diskPath, html);

	return { title, text, diskPath };
}

/**
 * Get the file extension for a content type.
 */
export function getExtension(contentType: string): string {
	switch (contentType) {
		case "application/pdf":
			return ".pdf";
		case "text/markdown":
			return ".md";
		case "text/plain":
			return ".txt";
		default:
			return ".bin";
	}
}
