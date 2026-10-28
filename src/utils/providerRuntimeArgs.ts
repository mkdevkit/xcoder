const HOST_FLAGS = ["--host", "--hostname", "-H"];
const PORT_FLAGS = ["--port", "-p"];

export interface RuntimeEndpoint {
  host: string;
  port: string;
}

export function readRuntimeEndpoint(
  args: string[],
  defaults: RuntimeEndpoint,
): RuntimeEndpoint {
  const hostIndex = args.findIndex((arg) => HOST_FLAGS.includes(arg));
  const portIndex = args.findIndex((arg) => PORT_FLAGS.includes(arg));
  return {
    host:
      hostIndex >= 0 && args[hostIndex + 1] ? args[hostIndex + 1] : defaults.host,
    port:
      portIndex >= 0 && args[portIndex + 1] ? args[portIndex + 1] : defaults.port,
  };
}

export function writeRuntimeEndpoint(
  args: string[],
  endpoint: RuntimeEndpoint,
  hostFlag: "--host" | "--hostname",
): string[] {
  const next = [...args];
  const hostIndex = next.findIndex((arg) => HOST_FLAGS.includes(arg));
  const portIndex = next.findIndex((arg) => PORT_FLAGS.includes(arg));

  if (hostIndex >= 0) {
    if (hostIndex + 1 < next.length) {
      next[hostIndex + 1] = endpoint.host;
    } else {
      next.push(endpoint.host);
    }
    if (next[hostIndex] !== hostFlag) {
      next[hostIndex] = hostFlag;
    }
  } else {
    next.push(hostFlag, endpoint.host);
  }

  if (portIndex >= 0) {
    if (portIndex + 1 < next.length) {
      next[portIndex + 1] = endpoint.port;
    } else {
      next.push(endpoint.port);
    }
  } else {
    next.push("--port", endpoint.port);
  }

  return next;
}

export const OPENCODE_RUNTIME_DEFAULTS: RuntimeEndpoint = {
  host: "127.0.0.1",
  port: "4096",
};

export const OPENCODE_DEFAULT_ARGS = [
  "serve",
  "--hostname",
  "127.0.0.1",
  "--port",
  "4096",
];
