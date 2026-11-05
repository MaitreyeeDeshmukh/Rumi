/** Helpers for the release-tool tests: run a node script as a child process, and serve a scripted fake site. */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `node <script> ...args` and collects the output. The child gets only the env vars passed in `env`. */
export function runNode(script: string, args: string[], env: Record<string, string> = {}, cwd: string = WEB_ROOT): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}
export type Handler = (req: IncomingMessage) => FakeReply;

/** A real HTTP server on a free local port; `handler` decides every answer. */
export async function serve(handler: Handler): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method ?? "GET"} ${req.url ?? ""}`);
    const r = handler(req);
    res.writeHead(r.status ?? 200, r.headers ?? {});
    res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
