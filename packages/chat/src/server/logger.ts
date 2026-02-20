type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_IDX: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const LABELS: Record<LogLevel, string> = {
	debug: "DEBUG",
	info: "INFO ",
	warn: "WARN ",
	error: "ERROR",
};

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const minLevel = LEVEL_IDX[envLevel as LogLevel] ?? LEVEL_IDX.info;

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
			if (LEVEL_IDX[level] >= minLevel) {
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
