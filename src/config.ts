export interface NiaConfig {
	apiKey: string | undefined;
	searchEnabled: boolean;
	sandboxEnabled: boolean;
	researchEnabled: boolean;
	tracerEnabled: boolean;
	advisorEnabled: boolean;
	contextEnabled: boolean;
	e2eEnabled: boolean;
	annotationsEnabled: boolean;
	bulkDeleteEnabled: boolean;
	usageEnabled: boolean;
	feedbackEnabled: boolean;
	cacheTTL: number;
	maxPendingOps: number;
	checkInterval: number;
	tracerTimeout: number;
	debug: boolean;
	triggersEnabled: boolean;
	apiUrl: string;
	keywords: {
		enabled: boolean;
		customPatterns: string[];
	};
}

export interface ValidationWarning {
	field: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	warnings: ValidationWarning[];
}

const MAX_TIMEOUT_SECONDS = 3600;
const MAX_CACHE_TTL_SECONDS = 86400;

const DEFAULTS: NiaConfig = {
	apiKey: undefined,
	searchEnabled: true,
	sandboxEnabled: true,
	researchEnabled: true,
	tracerEnabled: true,
	advisorEnabled: true,
	contextEnabled: true,
	e2eEnabled: true,
	annotationsEnabled: true,
	bulkDeleteEnabled: true,
	usageEnabled: true,
	feedbackEnabled: true,
	cacheTTL: 300,
	maxPendingOps: 5,
	checkInterval: 15,
	tracerTimeout: 120,
	debug: false,
	triggersEnabled: true,
	apiUrl: "https://apigcp.trynia.ai/v2",
	keywords: {
		enabled: true,
		customPatterns: [],
	},
};

function parseBoolean(
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (value === undefined) return defaultValue;
	if (value.toLowerCase() === "true") return true;
	if (value.toLowerCase() === "false") return false;
	return defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
	if (value === undefined) return defaultValue;
	const parsed = parseInt(value, 10);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function validateConfig(config: NiaConfig): ValidationResult {
	const warnings: ValidationWarning[] = [];

	if (typeof config.apiKey === "string" && !config.apiKey.trim()) {
		warnings.push({
			field: "apiKey",
			message: "API key is blank (empty or whitespace only)",
		});
	}

	validateApiUrl(config.apiUrl, warnings);
	validatePositiveBounded(
		config.tracerTimeout,
		"tracerTimeout",
		MAX_TIMEOUT_SECONDS,
		warnings,
	);
	validatePositiveBounded(
		config.checkInterval,
		"checkInterval",
		MAX_TIMEOUT_SECONDS,
		warnings,
	);
	validatePositiveBounded(
		config.cacheTTL,
		"cacheTTL",
		MAX_CACHE_TTL_SECONDS,
		warnings,
	);

	return { valid: warnings.length === 0, warnings };
}

function validateApiUrl(url: string, warnings: ValidationWarning[]): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		warnings.push({ field: "apiUrl", message: "API URL is not a valid URL" });
		return;
	}

	const isDev =
		process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
	const isLocalhost =
		parsed.hostname === "localhost" ||
		parsed.hostname === "127.0.0.1" ||
		parsed.hostname === "::1";

	if (!isDev && parsed.protocol !== "https:") {
		warnings.push({
			field: "apiUrl",
			message: "API URL must use HTTPS in production",
		});
	}

	if (!isDev && isLocalhost) {
		warnings.push({
			field: "apiUrl",
			message: "API URL must not use localhost in production",
		});
	}
}

function validatePositiveBounded(
	value: number,
	field: string,
	max: number,
	warnings: ValidationWarning[],
): void {
	if (!Number.isInteger(value) || value <= 0) {
		warnings.push({ field, message: `${field} must be a positive integer` });
	} else if (value > max) {
		warnings.push({
			field,
			message: `${field} exceeds maximum of ${max} seconds`,
		});
	}
}

let configValidated = false;

export function resetConfigValidation(): void {
	configValidated = false;
}

export function loadConfig(): NiaConfig {
	const config: NiaConfig = {
		apiKey: process.env.NIA_API_KEY,
		searchEnabled: parseBoolean(process.env.NIA_SEARCH, DEFAULTS.searchEnabled),
		sandboxEnabled: parseBoolean(
			process.env.NIA_SANDBOX_ENABLED ?? process.env.NIA_SANDBOX,
			DEFAULTS.sandboxEnabled,
		),
		researchEnabled: parseBoolean(
			process.env.NIA_RESEARCH,
			DEFAULTS.researchEnabled,
		),
		tracerEnabled: parseBoolean(process.env.NIA_TRACER, DEFAULTS.tracerEnabled),
		advisorEnabled: parseBoolean(
			process.env.NIA_ADVISOR,
			DEFAULTS.advisorEnabled,
		),
		contextEnabled: parseBoolean(
			process.env.NIA_CONTEXT,
			DEFAULTS.contextEnabled,
		),
		e2eEnabled: parseBoolean(process.env.NIA_E2E, DEFAULTS.e2eEnabled),
		annotationsEnabled: parseBoolean(process.env.NIA_ANNOTATIONS_ENABLED, DEFAULTS.annotationsEnabled),
		bulkDeleteEnabled: parseBoolean(process.env.NIA_BULK_DELETE_ENABLED, DEFAULTS.bulkDeleteEnabled),
		usageEnabled: parseBoolean(process.env.NIA_USAGE_ENABLED, DEFAULTS.usageEnabled),
		feedbackEnabled: parseBoolean(process.env.NIA_FEEDBACK_ENABLED, DEFAULTS.feedbackEnabled),
		cacheTTL: parseNumber(process.env.NIA_CACHE_TTL, DEFAULTS.cacheTTL),
		maxPendingOps: parseNumber(
			process.env.NIA_MAX_PENDING_OPS,
			DEFAULTS.maxPendingOps,
		),
		checkInterval: parseNumber(
			process.env.NIA_CHECK_INTERVAL,
			DEFAULTS.checkInterval,
		),
		tracerTimeout: parseNumber(
			process.env.NIA_TRACER_TIMEOUT,
			DEFAULTS.tracerTimeout,
		),
		debug: parseBoolean(process.env.NIA_DEBUG, DEFAULTS.debug),
		triggersEnabled: parseBoolean(
			process.env.NIA_TRIGGERS,
			DEFAULTS.triggersEnabled,
		),
		apiUrl: process.env.NIA_API_URL ?? DEFAULTS.apiUrl,
		keywords: {
			enabled: parseBoolean(
				process.env.NIA_KEYWORDS_ENABLED,
				DEFAULTS.keywords.enabled,
			),
			customPatterns: process.env.NIA_KEYWORDS_PATTERNS
				? process.env.NIA_KEYWORDS_PATTERNS.split(",")
						.map((p) => p.trim())
						.filter(Boolean)
				: DEFAULTS.keywords.customPatterns,
		},
	};

	if (!configValidated) {
		configValidated = true;
		const { warnings } = validateConfig(config);
		for (const warning of warnings) {
			console.warn(`[nia] config: ${warning.field} — ${warning.message}`);
		}
	}

	return config;
}

export function isConfigured(): boolean {
	return !!loadConfig().apiKey;
}
