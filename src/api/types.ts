export type PluginSourceType =
	| "repository"
	| "data_source"
	| "documentation"
	| "research_paper"
	| "huggingface_dataset"
	| "local_folder"
	| "slack"
	| "google_drive";

export interface ResolveSourceArgs {
	source_id?: string;
	source_type?: PluginSourceType;
	identifier?: string;
}

export interface ResolvedSource {
	id: string;
	type: PluginSourceType;
}

export type PendingOperationType = "index" | "oracle" | "tracer";

export type PendingOperationStatus =
	| "pending"
	| "processing"
	| "completed"
	| "error";

export interface PendingOperation {
	id: string;
	type: PendingOperationType;
	name: string;
	sourceType?: PluginSourceType;
	status?: PendingOperationStatus;
	progress?: number;
	error?: string;
}

export interface IOpsTracker {
	trackOperation(op: PendingOperation): void;
	getOperation(id: string): PendingOperation | undefined;
	getAllOperations(): PendingOperation[];
	removeOperation(id: string): void;
}

export type ApiErrorCategory =
	| "credits_exhausted"
	| "rate_limited"
	| "auth_error"
	| "network_error";

export interface ClassifiedApiError {
	category: ApiErrorCategory;
	actionableMessage: string;
}

export type SSEEventType =
	| "thinking"
	| "searching"
	| "reading"
	| "analyzing"
	| "content"
	| "done"
	| "error";

export interface SSEEvent {
	type: SSEEventType;
	data?: string;
	content?: string;
	progress?: number;
	error?: string;
	source?: string;
}
