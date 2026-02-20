type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const LABELS: Record<LogLevel, string> = {
	debug: "DEBUG",
	info: "INFO ",
	warn: "WARN ",
	error: "ERROR",
};

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const currentLevel: LogLevel = LEVELS.includes(envLevel as LogLevel)
	? (envLevel as LogLevel)
	: "info";
const currentLevelIdx = LEVELS.indexOf(currentLevel);

function formatMessage(
	level: LogLevel,
	module: string,
	message: string,
	data?: Record<string, unknown>,
): string {
	const base = `${new Date().toISOString()} ${LABELS[level]} [${module}] ${message}`;
	return data && Object.keys(data).length > 0
		? `${base} ${JSON.stringify(data)}`
		: base;
}

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
	const make =
		(level: LogLevel) => (message: string, data?: Record<string, unknown>) => {
			if (LEVELS.indexOf(level) >= currentLevelIdx) {
				const out = level === "error" ? console.error : console.log;
				out(formatMessage(level, module, message, data));
			}
		};

	return {
		debug: make("debug"),
		info: make("info"),
		warn: make("warn"),
		error: make("error"),
	};
}
