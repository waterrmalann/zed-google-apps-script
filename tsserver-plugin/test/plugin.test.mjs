// End-to-end tests of the tsserver plugin, run through vtsls the same way the
// Zed extension runs it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { LspClient } from "./lsp-client.mjs";

const PLUGIN_NAME = "zed-apps-script-tsserver-plugin";
const packageDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const vtsls = path.join(packageDir, "node_modules", "@vtsls", "language-server", "bin", "vtsls.js");

let tempDir;
let extensionDir;

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-script-plugin-"));
  // Same layout as the extension's working directory in Zed.
  extensionDir = path.join(tempDir, "extension");
  const pluginDir = path.join(extensionDir, "tsserver-plugin", "node_modules", PLUGIN_NAME);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(path.join(packageDir, "index.js"), path.join(pluginDir, "index.js"));
  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    JSON.stringify({ name: PLUGIN_NAME, main: "index.js" }),
  );
  fs.symlinkSync(path.join(packageDir, "node_modules"), path.join(extensionDir, "node_modules"), "dir");
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Creates a workspace from a map of relative paths to file contents. */
function createWorkspace(name, files) {
  const root = path.join(tempDir, name);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return root;
}

/** Starts vtsls with the settings the extension sends by default. */
async function startServer(root, { checkJs = false } = {}) {
  const settings = {
    typescript: { disableAutomaticTypeAcquisition: true },
    vtsls: {
      autoUseWorkspaceTsdk: false,
      tsserver: {
        globalPlugins: [
          {
            name: PLUGIN_NAME,
            location: path.join(extensionDir, "tsserver-plugin"),
            enableForWorkspaceTypeScriptVersions: true,
          },
        ],
      },
    },
    "js/ts": { implicitProjectConfig: { checkJs } },
  };
  const client = new LspClient(process.execPath, [vtsls, "--stdio"], { cwd: root, settings });
  await client.initialize(root);
  return client;
}

/** Hover text once the project has finished loading. */
async function settledHover(client, filePath, marker) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const hover = await client.hover(filePath, marker);
    if (!hover.includes("(loading...)") || Date.now() > deadline) {
      return hover;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const MANIFEST = JSON.stringify({ timeZone: "Etc/UTC", runtimeVersion: "V8" });

test("resolves functions declared in unopened files of the project", async () => {
  const root = createWorkspace("shared-scope", {
    "src/appsscript.json": MANIFEST,
    "src/Code.gs": "function main() {\n  const total = addOne(1);\n  return total;\n}\n",
    "src/lib/Utils.gs": "/**\n * @param {number} n\n * @return {number}\n */\nfunction addOne(n) {\n  return n + 1;\n}\n",
  });
  const code = path.join(root, "src", "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    assert.match(await settledHover(client, code, "addO"), /function addOne\(n: number\): number/);
    assert.match(await settledHover(client, code, "const tot"), /const total: number/);
  } finally {
    await client.shutdown();
  }
});

test("only uses the file's directory when there is no manifest", async () => {
  const root = createWorkspace("no-manifest", {
    "Code.gs": "function main() {\n  return [sibling(), nested()];\n}\n",
    "Sibling.gs": "/** @return {string} */\nfunction sibling() {\n  return '';\n}\n",
    "nested/Nested.gs": "/** @return {string} */\nfunction nested() {\n  return '';\n}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    assert.match(await settledHover(client, code, "sibl"), /function sibling\(\): string/);
    const scripts = (await client.projectFiles(code)).filter((file) => file.endsWith(".gs"));
    assert.deepEqual(scripts.map((file) => path.basename(file)).sort(), ["Code.gs", "Sibling.gs"]);
  } finally {
    await client.shutdown();
  }
});

test("includes .js script files when the opened file is a .js file", async () => {
  const files = {
    "appsscript.json": MANIFEST,
    "Code.gs": "function fromGs() {}\n",
    "Main.js": "function main() {\n  return helper();\n}\n",
    "lib/Helper.js": "/** @return {boolean} */\nfunction helper() {\n  return true;\n}\n",
  };

  const jsRoot = createWorkspace("clasp-js", files);
  const main = path.join(jsRoot, "Main.js");
  let client = await startServer(jsRoot);
  try {
    client.open(main);
    assert.match(await settledHover(client, main, "helpe"), /function helper\(\): boolean/);
    const scripts = (await client.projectFiles(main))
      .filter((file) => /\.(gs|js)$/.test(file))
      .map((file) => path.relative(jsRoot, file))
      .sort();
    assert.deepEqual(scripts, ["Code.gs", "Main.js", path.join("lib", "Helper.js")]);
  } finally {
    await client.shutdown();
  }

  const gsRoot = createWorkspace("clasp-gs", files);
  const code = path.join(gsRoot, "Code.gs");
  client = await startServer(gsRoot);
  try {
    client.open(code);
    await settledHover(client, code, "fromG");
    const scripts = (await client.projectFiles(code)).filter((file) => /\.(gs|js)$/.test(file));
    assert.deepEqual(scripts, [code]);
  } finally {
    await client.shutdown();
  }
});

test("adds the bundled Apps Script type definitions", async () => {
  const root = createWorkspace("bundled-types", {
    "appsscript.json": MANIFEST,
    "Code.gs": "function main() {\n  const sheet = SpreadsheetApp.getActiveSheet();\n  return sheet;\n}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    assert.match(
      await settledHover(client, code, "const she"),
      /const sheet: GoogleAppsScript\.Spreadsheet\.Sheet/,
    );
  } finally {
    await client.shutdown();
  }
});

test("prefers type definitions installed in the project", async () => {
  const root = createWorkspace("project-types", {
    "appsscript.json": MANIFEST,
    "Code.gs": "function main() {\n  return DriveApp.getRootFolder();\n}\n",
  });
  fs.cpSync(
    path.join(packageDir, "node_modules", "@types", "google-apps-script"),
    path.join(root, "node_modules", "@types", "google-apps-script"),
    { recursive: true },
  );
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    assert.match(await settledHover(client, code, "DriveA"), /GoogleAppsScript\.Drive\.DriveApp/);
    const typeRoots = (await client.projectFiles(code)).filter((file) =>
      file.endsWith(path.join("google-apps-script", "index.d.ts")),
    );
    assert.deepEqual(typeRoots, [
      path.join(root, "node_modules", "@types", "google-apps-script", "index.d.ts"),
    ]);
  } finally {
    await client.shutdown();
  }
});

test("reports browser globals, which Apps Script does not have", async () => {
  const root = createWorkspace("no-dom", {
    "appsscript.json": MANIFEST,
    "Code.gs":
      "function main() {\n  window.alert('hi');\n  Logger.log([1, 2].at(-1));\n  console.log(Object.hasOwn({}, 'a'));\n}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root, { checkJs: true });
  try {
    const uri = client.open(code);
    const diagnostics = await client.waitForDiagnostics(uri, (items) =>
      items.some((item) => item.message.includes("window")),
    );
    assert.deepEqual(
      diagnostics.map((item) => item.message),
      ["Cannot find name 'window'."],
    );
  } finally {
    await client.shutdown();
  }
});

test("keeps a library list the user configured", async () => {
  const root = createWorkspace("user-lib", {
    "appsscript.json": MANIFEST,
    "Code.gs": "function main() {\n  return window;\n}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    await client.request("workspace/executeCommand", {
      command: "typescript.tsserverRequest",
      arguments: [
        "compilerOptionsForInferredProjects",
        { options: { allowJs: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] } },
      ],
    });
    client.open(code);
    assert.match(await settledHover(client, code, "windo"), /var window: Window/);
  } finally {
    await client.shutdown();
  }
});

test("leaves projects with a jsconfig.json alone", async () => {
  const root = createWorkspace("configured", {
    "appsscript.json": MANIFEST,
    "jsconfig.json": JSON.stringify({ compilerOptions: { checkJs: false } }),
    "Main.js": "function main() {\n  return window;\n}\n",
    "Code.gs": "function fromGs() {}\n",
  });
  const main = path.join(root, "Main.js");
  const client = await startServer(root);
  try {
    client.open(main);
    assert.match(await settledHover(client, main, "windo"), /var window: Window/);
    const scripts = (await client.projectFiles(main)).filter((file) => /\.(gs|js)$/.test(file));
    assert.deepEqual(scripts, [main]);
  } finally {
    await client.shutdown();
  }
});

test("picks up script files created after the project was loaded", async () => {
  const root = createWorkspace("new-file", {
    "appsscript.json": MANIFEST,
    "Code.gs": "function main() {\n  return later();\n}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    assert.match(await settledHover(client, code, "late"), /```typescript\nany\n```/);

    fs.writeFileSync(
      path.join(root, "Later.gs"),
      "/** @return {number} */\nfunction later() {\n  return 1;\n}\n",
    );
    // The plugin rescans a project at most every two seconds, when an edit
    // marks it as changed.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const edited = "function main() {\n  return later() + 0;\n}\n";
    fs.writeFileSync(code, edited);
    client.change(code, edited);
    assert.match(await settledHover(client, code, "late"), /function later\(\): number/);
  } finally {
    await client.shutdown();
  }
});

test("skips node_modules and hidden directories", async () => {
  const root = createWorkspace("skipped-directories", {
    "appsscript.json": MANIFEST,
    "Code.gs": "function main() {}\n",
    "lib/Utils.gs": "function util() {}\n",
    "node_modules/some-package/Dependency.gs": "function dependency() {}\n",
    ".git/Hidden.gs": "function hidden() {}\n",
  });
  const code = path.join(root, "Code.gs");
  const client = await startServer(root);
  try {
    client.open(code);
    await settledHover(client, code, "mai");
    const scripts = (await client.projectFiles(code))
      .filter((file) => file.endsWith(".gs"))
      .map((file) => path.relative(root, file))
      .sort();
    assert.deepEqual(scripts, ["Code.gs", path.join("lib", "Utils.gs")]);
  } finally {
    await client.shutdown();
  }
});
