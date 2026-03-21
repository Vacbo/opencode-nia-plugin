/**
 * Nia API TypeScript Types
 * Manual type definitions for Nia Knowledge Agent API
 * Reference: https://docs.trynia.ai/sdk/examples
 */

// =============================================================================
// Source Types (7 types)
// =============================================================================

/** Repository source type */
export interface RepositorySource {
	id: string;
	type: "repository";
	repository: string;
	branch: string;
	status: "indexing" | "ready" | "error";
	indexed_at?: string;
	error?: string;
	file_count?: number;
}

/** Documentation data source type */
export interface DataSource {
	id: string;
	type: "data_source";
	url: string;
	display_name: string;
	crawl_entire_domain?: boolean;
	status: "indexing" | "ready" | "error";
	indexed_at?: string;
	error?: string;
	page_count?: number;
}

/** Research paper source type */
export interface ResearchPaperSource {
	id: string;
	type: "research_paper";
	url: string;
	title?: string;
	authors?: string[];
	status: "indexing" | "ready" | "error";
	indexed_at?: string;
	error?: string;
}

/** Local folder source type (E2E encrypted) */
export interface LocalFolderSource {
	id: string;
	type: "local_folder";
	name: string;
	source_type: string;
	encrypted: boolean;
	status: "syncing" | "ready" | "error";
	synced_at?: string;
	chunk_count?: number;
}

/** Package source type (npm/PyPI) */
export interface PackageSource {
	id: string;
	type: "package";
	registry: "npm" | "py_pi";
	package_name: string;
	version?: string;
	indexed_at?: string;
}

/** Dependency source type */
export interface DependencySource {
	id: string;
	type: "dependency";
	name: string;
	version: string;
	ecosystem: "npm" | "pip" | "cargo" | "go";
	dependencies?: string[];
	dependents?: string[];
}

/** Category source type */
export interface CategorySource {
	id: string;
	type: "category";
	name: string;
	description?: string;
	source_count: number;
	created_at: string;
}

/** Union of all source types */
export type Source =
	| RepositorySource
	| DataSource
	| ResearchPaperSource
	| LocalFolderSource
	| PackageSource
	| DependencySource
	| CategorySource;

// =============================================================================
// Search Types
// =============================================================================

/** Search mode types */
export type SearchMode = "universal" | "query" | "web" | "deep";

/** Search result item */
export interface SearchResultItem {
	id: string;
	source_id: string;
	source_type: string;
	title?: string;
	content: string;
	url?: string;
	file_path?: string;
	score: number;
	highlights?: string[];
}

/** Universal search request */
export interface UniversalSearchRequest {
	query: string;
	top_k?: number;
	include_repos?: boolean;
	include_docs?: boolean;
	include_papers?: boolean;
	include_local_folders?: boolean;
}

/** Universal search response */
export interface UniversalSearchResponse {
	results: SearchResultItem[];
	query: string;
	total: number;
}

/** Query search request */
export interface QuerySearchRequest {
	messages: Array<{
		role: "user" | "assistant" | "system";
		content: string;
	}>;
	repositories?: string[];
	data_sources?: string[];
	local_folders?: string[];
	search_mode?: "sources" | "code" | "all";
	include_sources?: boolean;
	e2e_session_id?: string;
}

/** Query search response */
export interface QuerySearchResponse {
	answer: string;
	sources: SearchResultItem[];
	citations?: string[];
}

/** Web search request */
export interface WebSearchRequest {
	query: string;
	num_results?: number;
}

/** Web search response */
export interface WebSearchResponse {
	results: Array<{
		title: string;
		url: string;
		snippet: string;
		score: number;
	}>;
	query: string;
}

/** Deep research request */
export interface DeepSearchRequest {
	query: string;
	output_format?: "markdown" | "html" | "comparison table" | "json";
	repositories?: string[];
	data_sources?: string[];
}

/** Deep search response */
export interface DeepSearchResponse {
	id: string;
	status: "processing" | "completed" | "error";
	result?: string;
	sources?: SearchResultItem[];
	citations?: string[];
}

// =============================================================================
// Context Types
// =============================================================================

/** Context save request */
export interface ContextSaveRequest {
	title: string;
	summary: string;
	content: string;
	tags?: string[];
}

/** Context response */
export interface ContextResponse {
	id: string;
	title: string;
	summary: string;
	content: string;
	tags: string[];
	created_at: string;
	updated_at: string;
}

/** Context list response */
export interface ContextListResponse {
	contexts: ContextResponse[];
	total: number;
}

/** Context semantic search request */
export interface ContextSemanticSearchRequest {
	query: string;
	limit?: number;
	tags?: string[];
}

// =============================================================================
// Oracle Types
// =============================================================================

/** Oracle job status */
export type OracleJobStatus = "pending" | "processing" | "completed" | "error";

/** Oracle job request */
export interface OracleJobRequest {
	query: string;
	repositories?: string[];
	data_sources?: string[];
	output_format?: "markdown" | "html" | "comparison table" | "json";
	model?: string;
}

/** Oracle job response */
export interface OracleJobResponse {
	id: string;
	status: OracleJobStatus;
	query: string;
	created_at: string;
	completed_at?: string;
	result?: string;
	sources?: SearchResultItem[];
	error?: string;
}

/** Oracle job event (SSE) */
export interface OracleJobEvent {
	type: "progress" | "source_found" | "analysis" | "complete" | "error";
	message?: string;
	progress?: number;
	source?: SearchResultItem;
	result?: string;
	error?: string;
}

// =============================================================================
// GitHub Tracer Types
// =============================================================================

/** Tracer request */
export interface TracerRequest {
	query: string;
	repositories: string[];
	path_filter?: string;
	language?: string;
}

/** Tracer result item */
export interface TracerResultItem {
	repository: string;
	path: string;
	content: string;
	line_number?: number;
	score: number;
}

/** Tracer job response */
export interface TracerJobResponse {
	id: string;
	status: "pending" | "processing" | "completed" | "error";
	query: string;
	created_at: string;
	completed_at?: string;
	results?: TracerResultItem[];
	error?: string;
}

// =============================================================================
// Advisor Types
// =============================================================================

/** Codebase context for advisor requests */
export interface CodebaseContext {
	files?: string[];
	file_tree?: string;
	dependencies?: string[];
	git_diff?: string;
	summary?: string;
	focus_paths?: string[];
}

/** Search scope for advisor requests */
export interface SearchScope {
	repositories?: string[];
	data_sources?: string[];
}

/** Output format enum for advisor requests */
export type AdvisorOutputFormat =
	| "explanation"
	| "checklist"
	| "diff"
	| "structured";

/** Advisor result (live API contract) */
export interface AdvisorResult {
	advice: string;
	sources_searched: string[];
	output_format: string;
}

// =============================================================================
// Package Search Types
// =============================================================================

/** Package registry type */
export type PackageRegistry = "npm" | "py_pi";

/** Package search request */
export interface PackageSearchRequest {
	registry: PackageRegistry;
	package_name: string;
	semantic_queries?: string[];
	code_snippets?: string[];
}

/** Package search result item */
export interface PackageSearchResultItem {
	package_name: string;
	version: string;
	description?: string;
	repository_url?: string;
	code_results: Array<{
		file_path: string;
		content: string;
		score: number;
	}>;
}

/** Package search response */
export interface PackageSearchResponse {
	results: PackageSearchResultItem[];
	total: number;
}

// =============================================================================
// Dependency Analysis Types
// =============================================================================

/** Dependency request */
export interface DependencyRequest {
	package_name: string;
	registry: PackageRegistry;
	depth?: number;
	include_dev_dependencies?: boolean;
}

/** Dependency result item */
export interface DependencyResultItem {
	name: string;
	version: string;
	type: "production" | "development";
	dependencies: string[];
	dependents: string[];
}

/** Dependency response */
export interface DependencyResponse {
	package_name: string;
	registry: PackageRegistry;
	dependencies: DependencyResultItem[];
	total: number;
}

// =============================================================================
// Category Types
// =============================================================================

/** Category request */
export interface CategoryRequest {
	name: string;
	description?: string;
	source_ids?: string[];
}

/** Category result */
export interface CategoryResult {
	id: string;
	name: string;
	description?: string;
	sources: Source[];
	source_count: number;
	created_at: string;
	updated_at: string;
}

// =============================================================================
// Repository Tree Types
// =============================================================================

/** Repository tree node */
export interface RepositoryTreeNode {
	path: string;
	type: "file" | "directory";
	size?: number;
	children?: RepositoryTreeNode[];
}

/** Repository tree response */
export interface RepositoryTreeResponse {
	repository: string;
	branch: string;
	tree: RepositoryTreeNode[];
}

// =============================================================================
// File Content Types
// =============================================================================

/** File content request */
export interface FileContentRequest {
	repository?: string;
	data_source_id?: string;
	path: string;
	start_line?: number;
	end_line?: number;
}

/** File content response */
export interface FileContentResponse {
	content: string;
	path: string;
	size: number;
	line_count: number;
	encoding: string;
}

// =============================================================================
// Grep Request Types
// =============================================================================

/** Code grep request */
export interface CodeGrepRequest {
	pattern: string;
	path?: string;
	context_lines?: number;
	case_sensitive?: boolean;
	whole_word?: boolean;
	regex?: boolean;
}

/** Grep result item */
export interface GrepResultItem {
	path: string;
	line_number: number;
	content: string;
	context_before?: string[];
	context_after?: string[];
}

// =============================================================================
// E2E Sync Types
// =============================================================================

/** E2E sync batch */
export interface E2ESyncBatch {
	sync_chunks: Array<{
		id: string;
		encrypted_content: string;
		blind_index: string;
	}>;
	stats: {
		total: number;
		encrypted: number;
	};
}

/** E2E session */
export interface E2ESession {
	id: string;
	local_folder_id: string;
	expires_at: string;
	max_chunks: number;
	allowed_operations: Array<"search" | "read">;
}

// =============================================================================
// Operations Tracker Types
// =============================================================================

/** Pending operation type */
export type PendingOperationType = "index" | "oracle" | "tracer";

/** Pending operation */
export interface PendingOperation {
	id: string;
	type: PendingOperationType;
	name: string;
	sourceType?: Source["type"];
	status?: "pending" | "processing" | "completed" | "error";
	progress?: number;
	error?: string;
}

/** Operations tracker interface */
export interface IOpsTracker {
	trackOperation(op: PendingOperation): void;
	getOperation(id: string): PendingOperation | undefined;
	getAllOperations(): PendingOperation[];
	removeOperation(id: string): void;
}

// =============================================================================
// Error Types
// =============================================================================

/** API error response */
export interface ApiError {
	error: string;
	message: string;
	status_code: number;
	details?: Record<string, unknown>;
}

/** Rate limit error */
export interface RateLimitError extends ApiError {
	retry_after?: number;
}

// =============================================================================
// SSE Event Types
// =============================================================================

/** SSE event type for streaming responses */
export type SSEEventType =
	| "thinking" // Agent is reasoning
	| "searching" // Performing search
	| "reading" // Reading file/content
	| "analyzing" // Analyzing results
	| "content" // Streaming content chunk
	| "done" // Stream complete
	| "error"; // Error occurred

/** SSE event for streaming responses */
export interface SSEEvent {
	/** Event type */
	type: SSEEventType;
	/** Raw data string */
	data?: string;
	/** Formatted content for display */
	content?: string;
	/** 0-100 progress indicator */
	progress?: number;
	/** Error message when type="error" */
	error?: string;
	/** Source identifier for content events */
	source?: string;
}

// =============================================================================
// Index Request Types
// =============================================================================

/** Repository index request */
export interface RepositoryIndexRequest {
	repository: string;
	branch?: string;
	include_patterns?: string[];
	exclude_patterns?: string[];
}

/** Data source index request */
export interface DataSourceIndexRequest {
	url: string;
	display_name: string;
	crawl_entire_domain?: boolean;
	max_pages?: number;
}

/** Research paper index request */
export interface ResearchPaperIndexRequest {
	url: string;
}

// =============================================================================
// Source List Types
// =============================================================================

/** Source list request */
export interface SourceListRequest {
	type?: Source["type"];
	query?: string;
	limit?: number;
	offset?: number;
}

/** Source list response */
export interface SourceListResponse {
	sources: Source[];
	total: number;
	limit: number;
	offset: number;
}
