export type McpTransport = "stdio" | "remote";

export interface McpServerEntry {
  id: string;
  transport: McpTransport;
  command: string;
  args: string[];
  url: string;
  enabled: boolean;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface McpConfigView {
  path: string;
  installed: boolean;
  servers: McpServerEntry[];
}

export function emptyMcpServer(): McpServerEntry {
  return {
    id: "",
    transport: "stdio",
    command: "",
    args: [],
    url: "",
    enabled: true,
    env: {},
    headers: {},
  };
}

export function mcpEndpointLabel(server: McpServerEntry): string {
  if (server.transport === "remote") {
    return server.url.trim() || "—";
  }
  const parts = [server.command.trim(), ...server.args.map((item) => item.trim())].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" ") : "—";
}

export function mergeMcpServersFromDisk(
  current: McpServerEntry[],
  disk: McpServerEntry[],
): McpServerEntry[] {
  if (disk.length === 0) {
    return current;
  }

  const diskById = new Map(
    disk
      .map((server) => [server.id.trim(), server] as const)
      .filter(([id]) => id.length > 0),
  );
  const seen = new Set<string>();
  const merged = current.map((server) => {
    const id = server.id.trim();
    if (!id) {
      return server;
    }
    seen.add(id);
    const saved = diskById.get(id);
    return saved ? { ...server, ...saved, id: server.id } : server;
  });

  for (const server of disk) {
    const id = server.id.trim();
    if (id && !seen.has(id)) {
      merged.push(server);
    }
  }

  return merged;
}
