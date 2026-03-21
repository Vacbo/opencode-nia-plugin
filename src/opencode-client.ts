import type { OpencodeClient } from "@opencode-ai/sdk";

let opencodeClient: OpencodeClient | undefined;

export function setOpencodeClient(client: OpencodeClient): void {
	opencodeClient = client;
}

export function getOpencodeClient(): OpencodeClient | undefined {
	return opencodeClient;
}
