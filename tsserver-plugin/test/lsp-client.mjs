// Minimal Language Server Protocol client used to drive vtsls in tests.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export class LspClient {
  #process;
  #buffer = Buffer.alloc(0);
  #nextId = 0;
  #pending = new Map();
  #settings;
  diagnostics = new Map();

  constructor(command, args, { cwd, settings }) {
    this.#settings = settings;
    this.#process = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.#process.stdout.on("data", (chunk) => this.#receive(chunk));
    this.#process.stderr.resume();
  }

  async initialize(rootPath) {
    const rootUri = pathToFileURL(rootPath).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: {},
        },
      },
    });
    this.notify("initialized", {});
    this.notify("workspace/didChangeConfiguration", { settings: this.#settings });
  }

  open(filePath) {
    const uri = pathToFileURL(filePath).href;
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "javascript",
        version: 1,
        text: fs.readFileSync(filePath, "utf8"),
      },
    });
    return uri;
  }

  /** Hover text at the end of the first occurrence of `marker` in the file. */
  async hover(filePath, marker) {
    const response = await this.request("textDocument/hover", {
      textDocument: { uri: pathToFileURL(filePath).href },
      position: positionAfter(fs.readFileSync(filePath, "utf8"), marker),
    });
    const contents = response.result?.contents;
    return typeof contents === "string" ? contents : (contents?.value ?? "");
  }

  /** Files of the tsserver project that contains `filePath`. */
  async projectFiles(filePath) {
    const response = await this.request("workspace/executeCommand", {
      command: "typescript.tsserverRequest",
      arguments: ["projectInfo", { file: filePath, needFileNameList: true }],
    });
    return response.result?.body?.fileNames ?? [];
  }

  /** Waits for diagnostics of `uri` that satisfy `predicate`. */
  async waitForDiagnostics(uri, predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const diagnostics = this.diagnostics.get(uri);
      if (diagnostics && predicate(diagnostics)) {
        return diagnostics;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.diagnostics.get(uri) ?? [];
  }

  async shutdown() {
    await this.request("shutdown", null);
    this.notify("exit", null);
    this.#process.kill();
  }

  request(method, params) {
    const id = ++this.#nextId;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#send({ id, method, params });
    });
  }

  notify(method, params) {
    this.#send({ method, params });
  }

  #send(message) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.#process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  #receive(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }
      const length = Number(/Content-Length: (\d+)/i.exec(this.#buffer.subarray(0, headerEnd))[1]);
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) {
        return;
      }
      const message = JSON.parse(this.#buffer.subarray(bodyStart, bodyStart + length).toString());
      this.#buffer = this.#buffer.subarray(bodyStart + length);
      this.#handle(message);
    }
  }

  #handle(message) {
    if (message.method && message.id !== undefined) {
      // Server-to-client request.
      const result =
        message.method === "workspace/configuration"
          ? message.params.items.map((item) => lookup(this.#settings, item.section))
          : null;
      this.#send({ id: message.id, result });
    } else if (message.id !== undefined) {
      this.#pending.get(message.id)?.(message);
      this.#pending.delete(message.id);
    } else if (message.method === "textDocument/publishDiagnostics") {
      this.diagnostics.set(message.params.uri, message.params.diagnostics);
    }
  }
}

function lookup(settings, section) {
  if (!section) {
    return settings;
  }
  return section.split(".").reduce((value, key) => value?.[key], settings) ?? null;
}

function positionAfter(text, marker) {
  const offset = text.indexOf(marker);
  if (offset < 0) {
    throw new Error(`marker not found: ${marker}`);
  }
  const lines = text.slice(0, offset + marker.length).split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
}
