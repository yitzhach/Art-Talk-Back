export function startDevServer(opts: { port: number; api: string; solo?: boolean }): Promise<{ port: number; close(): Promise<void> }>;
