import { Globe, Loader2, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export function ResourceUploadDialog({
	onUploadFile,
	onAddUrl,
	onClose,
}: {
	onUploadFile: (file: File) => Promise<void>;
	onAddUrl: (url: string) => Promise<void>;
	onClose: () => void;
}) {
	const [mode, setMode] = useState<"file" | "url">("file");
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			setLoading(true);
			setError(null);
			try {
				await onUploadFile(file);
				onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Upload failed");
			} finally {
				setLoading(false);
			}
		},
		[onUploadFile, onClose],
	);

	const handleUrlSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			if (!url.trim()) return;

			setLoading(true);
			setError(null);
			try {
				await onAddUrl(url.trim());
				onClose();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Fetch failed");
			} finally {
				setLoading(false);
			}
		},
		[url, onAddUrl, onClose],
	);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="mx-4 w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h3 className="text-sm font-semibold text-foreground">
						Add Resource
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Mode tabs */}
				<div className="flex border-b border-border">
					<button
						type="button"
						onClick={() => setMode("file")}
						className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
							mode === "file"
								? "border-b-2 border-primary text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<Upload className="mr-1.5 inline h-3.5 w-3.5" />
						Upload File
					</button>
					<button
						type="button"
						onClick={() => setMode("url")}
						className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
							mode === "url"
								? "border-b-2 border-primary text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<Globe className="mr-1.5 inline h-3.5 w-3.5" />
						Add URL
					</button>
				</div>

				{/* Content */}
				<div className="p-4">
					{mode === "file" ? (
						<div>
							<input
								ref={fileInputRef}
								type="file"
								accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
								onChange={handleFileChange}
								className="hidden"
								disabled={loading}
							/>
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={loading}
								className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
							>
								{loading ? (
									<>
										<Loader2 className="h-5 w-5 animate-spin" />
										Uploading...
									</>
								) : (
									<>
										<Upload className="h-5 w-5" />
										Choose a file (PDF, TXT, MD)
									</>
								)}
							</button>
						</div>
					) : (
						<form onSubmit={handleUrlSubmit}>
							<input
								type="url"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="https://example.com/article"
								className="mb-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
								disabled={loading}
							/>
							<button
								type="submit"
								disabled={loading || !url.trim()}
								className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
							>
								{loading ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Fetching...
									</>
								) : (
									"Fetch URL"
								)}
							</button>
						</form>
					)}

					{error && <p className="mt-3 text-sm text-red-400">{error}</p>}
				</div>
			</div>
		</div>
	);
}
