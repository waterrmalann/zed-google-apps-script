// @ts-check
"use strict";

/**
 * TypeScript server plugin that makes tsserver treat Google Apps Script files
 * the way the Apps Script runtime does.
 *
 * - Apps Script loads every script file of a project into one shared global
 *   scope. The plugin adds the project's other script files to the program,
 *   so functions defined in a closed file still resolve.
 * - `.gs` is not an extension tsserver knows about. Files that the editor has
 *   not opened would be parsed as TypeScript, so the plugin reports them as
 *   JavaScript.
 * - It adds the bundled `@types/google-apps-script` declarations
 *   (`SpreadsheetApp`, `DriveApp`, ...), unless the project already resolves
 *   its own copy from `node_modules/@types`.
 * - Apps Script has no DOM, so `window`, `document`, `fetch` or `setTimeout`
 *   are not offered: the ECMAScript library is used without the DOM one.
 *
 * Zed writes this file into the extension's working directory and loads it
 * through vtsls' `vtsls.tsserver.globalPlugins` setting. That vtsls instance
 * only receives files Zed recognizes as Google Apps Script: `.gs` files, and
 * any files mapped to the language with the `file_types` setting (such as the
 * `.js` files `clasp pull` creates by default). Every inferred project, the
 * projects tsserver creates for files outside a `jsconfig.json` or
 * `tsconfig.json`, is therefore treated as Apps Script code.
 */

const fs = require("fs");
const path = require("path");

const GS_EXTENSION = ".gs";
// Other extensions clasp accepts for script files. Siblings with these
// extensions are only added when an opened file uses them too.
const OTHER_SCRIPT_EXTENSIONS = [".js"];
const MANIFEST_FILE = "appsscript.json";
const TYPES_PACKAGE = "google-apps-script";
// Directories never scanned for sibling script files.
const SKIPPED_DIRECTORIES = new Set(["node_modules", "bower_components"]);
// Limits that keep the scan cheap when the project root is unexpectedly large.
const MAX_SCANNED_DIRECTORIES = 200;
const MAX_SCRIPT_FILES = 500;
// A project is rescanned at most this often (it is marked dirty on every edit).
const RESCAN_INTERVAL_MS = 2000;
// ECMAScript library used instead of the default one, which includes the DOM.
const APPS_SCRIPT_LIB = ["lib.es2022.d.ts"];

/** @param {string} fileName */
function extensionOf(fileName) {
  return path.extname(fileName).toLowerCase();
}

/**
 * Nearest ancestor directory of `directory` (inclusive) holding the
 * `appsscript.json` manifest, which marks the root of an Apps Script project
 * (the `rootDir` of a clasp project).
 *
 * @param {string} directory
 * @returns {string | undefined}
 */
function findManifestDirectory(directory) {
  let current = directory;
  for (;;) {
    if (fs.existsSync(path.join(current, MANIFEST_FILE))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Files with one of `extensions` under `root`, recursively when `recursive`
 * is set.
 *
 * @param {string} root
 * @param {boolean} recursive
 * @param {ReadonlySet<string>} extensions
 * @returns {string[]}
 */
function collectScriptFiles(root, recursive, extensions) {
  /** @type {string[]} */
  const files = [];
  const pending = [root];
  let scannedDirectories = 0;
  while (pending.length > 0 && scannedDirectories < MAX_SCANNED_DIRECTORIES) {
    const directory = /** @type {string} */ (pending.pop());
    scannedDirectories++;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(fullPath);
        }
      } else if (entry.isFile() && extensions.has(extensionOf(entry.name))) {
        files.push(fullPath);
        if (files.length >= MAX_SCRIPT_FILES) {
          return files;
        }
      }
    }
  }
  return files;
}

/**
 * @param {{ typescript: typeof import("typescript/lib/tsserverlibrary") }} modules
 */
function init(modules) {
  const ts = modules.typescript;
  const bundledTypes = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "node_modules",
    "@types",
    TYPES_PACKAGE,
    "index.d.ts",
  );

  /**
   * @param {import("typescript/lib/tsserverlibrary").server.PluginCreateInfo} info
   */
  function create(info) {
    const project = info.project;
    const logger = project.projectService.logger;
    const log = (/** @type {string} */ message) =>
      logger.info(`[apps-script] ${message}`);

    const getScriptFileNames = project.getScriptFileNames.bind(project);
    const getScriptKind = project.getScriptKind.bind(project);
    const getCompilationSettings = project.getCompilationSettings.bind(project);
    const updateGraph = project.updateGraph.bind(project);

    /** @type {string[]} */
    let extraFiles = [];
    let lastScan = 0;
    let lastRootFiles = "";
    let isAppsScriptProject = false;
    /** @type {import("typescript/lib/tsserverlibrary").CompilerOptions | undefined} */
    let baseOptions;
    /** @type {import("typescript/lib/tsserverlibrary").CompilerOptions | undefined} */
    let appsScriptOptions;
    const hasBundledTypes = fs.existsSync(bundledTypes);
    if (!hasBundledTypes) {
      log(`bundled type definitions not found at ${bundledTypes}`);
    }

    /** Whether the project already resolves its own Apps Script types. */
    function projectProvidesTypes() {
      const options = getCompilationSettings();
      if (options.types) {
        return options.types.includes(TYPES_PACKAGE);
      }
      try {
        return ts
          .getAutomaticTypeDirectiveNames(options, project)
          .includes(TYPES_PACKAGE);
      } catch {
        return false;
      }
    }

    /** @param {readonly string[]} scripts */
    function computeExtraFiles(scripts) {
      const extensions = new Set([GS_EXTENSION]);
      for (const script of scripts) {
        const extension = extensionOf(script);
        if (OTHER_SCRIPT_EXTENSIONS.includes(extension)) {
          extensions.add(extension);
        }
      }

      /** @type {Map<string, string>} */
      const files = new Map();
      const add = (/** @type {string} */ fileName) => {
        files.set(project.toPath(fileName), fileName);
      };

      /** @type {Set<string>} */
      const scannedRoots = new Set();
      for (const script of scripts) {
        const directory = path.dirname(script);
        const manifestDirectory = findManifestDirectory(directory);
        // Without a manifest the project boundaries are unknown, so only the
        // file's own directory is considered part of the same project.
        const root = manifestDirectory ?? directory;
        const key = `${manifestDirectory ? "r" : "d"}:${root}`;
        if (scannedRoots.has(key)) {
          continue;
        }
        scannedRoots.add(key);
        for (const file of collectScriptFiles(root, !!manifestDirectory, extensions)) {
          add(file);
        }
      }

      if (hasBundledTypes && !projectProvidesTypes()) {
        add(bundledTypes);
      }
      return [...files.values()];
    }

    // The extra files are only recomputed while the project graph is being
    // updated. Changing `getScriptFileNames` at any other time would make the
    // language service build a program behind the project's back.
    project.updateGraph = () => {
      const rootFiles = getScriptFileNames();
      const rootFilesKey = rootFiles.join("\n");
      const now = Date.now();
      if (
        rootFilesKey !== lastRootFiles ||
        now - lastScan >= RESCAN_INTERVAL_MS
      ) {
        lastRootFiles = rootFilesKey;
        lastScan = now;
        const scripts = rootFiles.filter(
          (file) =>
            extensionOf(file) === GS_EXTENSION ||
            OTHER_SCRIPT_EXTENSIONS.includes(extensionOf(file)),
        );
        // Projects created for a `jsconfig.json` or `tsconfig.json` are left
        // alone.
        isAppsScriptProject =
          project.projectKind === ts.server.ProjectKind.Inferred &&
          scripts.length > 0;
        try {
          extraFiles = isAppsScriptProject ? computeExtraFiles(scripts) : [];
        } catch (error) {
          log(`failed to collect Apps Script files: ${error}`);
          extraFiles = [];
        }
      }
      return updateGraph();
    };

    project.getScriptFileNames = () => {
      const rootFiles = getScriptFileNames();
      if (extraFiles.length === 0) {
        return rootFiles;
      }
      const rootPaths = new Set(rootFiles.map((file) => project.toPath(file)));
      return [
        ...rootFiles,
        ...extraFiles.filter((file) => !rootPaths.has(project.toPath(file))),
      ];
    };

    project.getCompilationSettings = () => {
      const options = getCompilationSettings();
      if (!isAppsScriptProject || options.lib) {
        return options;
      }
      if (options !== baseOptions) {
        baseOptions = options;
        appsScriptOptions = { ...options, lib: APPS_SCRIPT_LIB };
      }
      return /** @type {import("typescript/lib/tsserverlibrary").CompilerOptions} */ (
        appsScriptOptions
      );
    };

    project.getScriptKind = (fileName) =>
      extensionOf(fileName) === GS_EXTENSION
        ? ts.ScriptKind.JS
        : getScriptKind(fileName);

    log(`enabled for ${project.getProjectName()}`);
    return info.languageService;
  }

  return { create };
}

module.exports = init;
