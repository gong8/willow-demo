type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
	debug: "DEBUG",
	info: "INFO ",
	warn: "WARN ",
	error: "ERROR",
};

const currentLevel: LogLevel =
	((process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel) in LEVEL_ORDER
		? ((process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel)
		: "info";

function shouldLog(level: LogLevel): boolean {
	return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatMessage(
	level: LogLevel,
	module: string,
	message: string,
	data?: Record<string, unknown>,
): string {
	const timestamp = new Date().toISOString();
	const base = `${timestamp} ${LEVEL_LABELS[level]} [${module}] ${message}`;
	if (data && Object.keys(data).length > 0) {
		return `${base} ${JSON.stringify(data)}`;
	}
	return base;
}

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

/**
 * MCP server logger — ALL output goes to stderr since stdout is the
 * JSON-RPC protocol channel.
 */
export function createLogger(module: string): Logger {
	return {
		debug(message, data) {
			if (shouldLog("debug"))
				console.error(formatMessage("debug", module, message, data));
		},
		info(message, data) {
			if (shouldLog("info"))
				console.error(formatMessage("info", module, message, data));
		},
		warn(message, data) {
			if (shouldLog("warn"))
				console.error(formatMessage("warn", module, message, data));
		},
		error(message, data) {
			if (shouldLog("error"))
				console.error(formatMessage("error", module, message, data));
		},
	};
}
