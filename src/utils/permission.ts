interface AskInput {
  permission: string;
  patterns: string[];
  always: string[];
  metadata: Record<string, unknown>;
}

interface AskResult {
  allowed?: boolean;
}

interface ToolContext {
  ask: (input: AskInput) => Promise<AskResult | false>;
}

interface RequestPermissionOptions {
  permission: string;
  patterns: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
}

export async function requestPermission(
  context: ToolContext,
  opts: RequestPermissionOptions
): Promise<boolean> {
  try {
    const result = await context.ask({
      permission: opts.permission,
      patterns: opts.patterns,
      always: opts.always ?? [],
      metadata: opts.metadata ?? {},
    });

    return result !== false;
  } catch {
    return false;
  }
}