const LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LEVELS)[number];
type LogFn = (message: string, data?: Record<string, unknown>) => void;
export type Logger = Record<LogLevel, LogFn>;

const LEVEL_INDEX = Object.fromEntries(LEVELS.map((l, i) => [l, i])) as Record<
	LogLevel,
	number
>;

const envLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const currentLevel: LogLevel =
	envLevel in LEVEL_INDEX ? (envLevel as LogLevel) : "info";

export function createLogger(module: string): Logger {
	return Object.fromEntries(
		LEVELS.map((level) => [
			level,
			(message: string, data?: Record<string, unknown>) => {
				if (LEVEL_INDEX[level] < LEVEL_INDEX[currentLevel]) return;
				const label = level.toUpperCase().padEnd(5);
				const base = `${new Date().toISOString()} ${label} [${module}] ${message}`;
				console.error(
					data && Object.keys(data).length > 0
						? `${base} ${JSON.stringify(data)}`
						: base,
				);
			},
		]),
	) as Logger;
}
