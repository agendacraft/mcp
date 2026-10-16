import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Settings } from "./config";
import { buildAccessTokenProvider } from "./index";
import { TokenStore, tokenBundleFromResponse } from "./oauth";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function fixture() {
  const tokenPath = join(mkdtempSync(join(tmpdir(), "mcp-refresh-")), "token.json");
  const store = new TokenStore(tokenPath);
  await store.save(
    tokenBundleFromResponse(
      {
        access_token: "fixture-expired",
        refresh_token: "fixture-original",
        expires_in: 1,
        scope: "agenda:read",
      },
      0
    )
  );
  const exchanged: string[] = [];
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/.well-known/oauth-authorization-server") {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      res.end(
        JSON.stringify({
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
        })
      );
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      exchanged.push(new URLSearchParams(body).get("refresh_token")!);
      if (exchanged.length === 1) {
        res.end(
          JSON.stringify({
            access_token: "fixture-fresh",
            refresh_token: "fixture-rotated",
            expires_in: 3600,
          })
        );
      } else {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const settings: Settings = {
    agendaServiceUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    tokenPath,
    oauthClientId: "fixture-client",
    oauthScopes: "agenda:read",
    requestTimeoutMs: 2_000,
  };
  return { settings, store, server, exchanged };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

const processWorker = `
import { buildAccessTokenProvider } from './src/index.ts';
import { TokenStore } from './src/oauth.ts';
const settings = JSON.parse(process.argv[1]);
const store = new TokenStore(settings.tokenPath);
const load = store.load.bind(store);
let first = true;
store.load = async () => {
  const bundle = await load();
  if (first) {
    first = false;
    process.send('ready');
    await new Promise(resolve => process.once('message', resolve));
  }
  return bundle;
};
try {
  const token = await buildAccessTokenProvider(settings, { store })();
  process.send({ token });
} catch (error) {
  process.send({ error: error.message });
  process.exitCode = 1;
} finally {
  process.disconnect();
}
`;

function tokenProcess(settings: Settings) {
  const ready = deferred<void>();
  const finished = deferred<string>();
  const child: ChildProcess = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", processWorker, JSON.stringify(settings)],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] }
  );
  let token: string | undefined;
  let diagnostics = "";
  child.stderr?.on("data", (chunk) => {
    diagnostics += chunk;
  });
  child.on("message", (message) => {
    if (message === "ready") ready.resolve();
    else if (typeof message === "object" && message !== null) {
      if ("token" in message) token = String(message.token);
      if ("error" in message) diagnostics += String(message.error);
    }
  });
  child.once("error", (error) => {
    ready.reject(error);
    finished.reject(error);
  });
  child.once("exit", (code) => {
    if (code === 0 && token !== undefined) finished.resolve(token);
    else {
      const error = new Error(`Fixture token process failed: ${diagnostics}`);
      ready.reject(error);
      finished.reject(error);
    }
  });
  return { child, ready: ready.promise, finished: finished.promise };
}

describe("shared token refresh", () => {
  it("refreshes once when concurrent callers observe the same expired token", async () => {
    const { settings, store, server, exchanged } = await fixture();
    const initialReads = deferred<void>();
    let readers = 0;
    const providers = Array.from({ length: 2 }, () => {
      const reader = new TokenStore(settings.tokenPath);
      const load = reader.load.bind(reader);
      let first = true;
      reader.load = async () => {
        const bundle = await load();
        if (first) {
          first = false;
          if (++readers === 2) initialReads.resolve();
          await initialReads.promise;
        }
        return bundle;
      };
      return buildAccessTokenProvider(settings, { store: reader });
    });

    try {
      const tokens = await Promise.all(providers.map((provider) => provider()));

      expect(tokens).toEqual(["fixture-fresh", "fixture-fresh"]);
      expect(exchanged).toEqual(["fixture-original"]);
      expect((await store.load())?.refreshToken).toBe("fixture-rotated");
    } finally {
      await close(server);
    }
  });

  it("shares one rotated token between independent CLI processes", async () => {
    const { settings, store, server, exchanged } = await fixture();
    const clients = [tokenProcess(settings), tokenProcess(settings)];
    const outcomes = Promise.allSettled(clients.map((client) => client.finished));
    try {
      await Promise.all(clients.map((client) => client.ready));

      for (const { child } of clients) child.send("start");
      const results = await outcomes;

      expect(results).toEqual([
        { status: "fulfilled", value: "fixture-fresh" },
        { status: "fulfilled", value: "fixture-fresh" },
      ]);
      expect(exchanged).toEqual(["fixture-original"]);
      expect((await store.load())?.refreshToken).toBe("fixture-rotated");
    } finally {
      for (const { child } of clients) if (child.exitCode === null) child.kill();
      await close(server);
    }
  }, 15_000);
});
