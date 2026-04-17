#!/usr/bin/env bun

const BASE = process.env.KNOLDR_URL ?? "http://localhost:5100";
const TOKEN = process.env.KNOLDR_API_TOKEN;

async function rpc(skill: string, input: Record<string, unknown>): Promise<unknown> {
  const body = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: {
      message: {
        kind: "message",
        messageId: crypto.randomUUID(),
        role: "user",
        parts: [{ kind: "data", data: { skill, input } }],
      },
    },
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(`${BASE}/a2a`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as { result?: { kind: string; parts?: { kind: string; data?: unknown }[] }; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);

  const part = json.result?.parts?.[0];
  return (part as { data?: unknown })?.data ?? json.result;
}

function parseFlags(args: string[]): { query: string; flags: Record<string, unknown> } {
  const flags: Record<string, unknown> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--") && i + 1 < args.length) {
      const key = arg.slice(2);
      const val = args[++i]!;
      if (/^\d+$/.test(val)) flags[key] = Number(val);
      else if (val.startsWith("[") || val.startsWith("{")) {
        try { flags[key] = JSON.parse(val); } catch { flags[key] = val; }
      }
      else flags[key] = val;
    } else {
      positional.push(arg);
    }
  }

  return { query: positional.join(" "), flags };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd !== "find") {
  console.error("Usage: knoldr find <검색어> [--domain X] [--limit N] [--cursor X]");
  process.exit(1);
}

const { query, flags } = parseFlags(args);
if (!query && !flags.domain && !flags.tags) {
  console.error("Usage: knoldr find <검색어> [--domain X] [--limit N] [--cursor X]");
  process.exit(1);
}

const input: Record<string, unknown> = { ...flags };
if (query) input.query = query;

const result = await rpc("find", input);
console.log(JSON.stringify(result, null, 2));
