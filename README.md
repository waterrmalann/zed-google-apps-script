# Google Apps Script for Zed

A [Zed](https://zed.dev) extension that adds support for
[Google Apps Script](https://developers.google.com/apps-script) `.gs` files.

- **Syntax highlighting** with the JavaScript Tree-sitter grammar. Apps Script
  services (`SpreadsheetApp`, `DriveApp`, `HtmlService`, ...) and the
  simple-trigger and web app entry points (`onOpen`, `onEdit`, `onInstall`,
  `onSelectionChange`, `doGet` and `doPost`) get their own highlights.
- **Embedded languages**: JSDoc comments (including `@OnlyCurrentDoc` and
  `@customfunction`), regular expressions, HTML passed to
  `HtmlService.createHtmlOutput()` and `HtmlService.createTemplate()`, and SQL
  passed to JDBC statements.
- **Editor support**: outline, breadcrumbs, bracket matching,
  auto-indentation, comment toggling and Vim text objects.
- **IntelliSense for Apps Script** through
  [vtsls](https://github.com/yioneko/vtsls), the TypeScript language server Zed
  uses for JavaScript. It provides completions, hover, go-to-definition,
  references, rename, signature help, code actions and inlay hints, with
  these adjustments for Apps Script:
  - The type definitions from
    [`@types/google-apps-script`](https://www.npmjs.com/package/@types/google-apps-script)
    are included, so services such as `SpreadsheetApp` are typed. No
    `package.json` or `npm install` is needed in your project.
  - All script files of a project share one global scope, as they do in Apps
    Script. A function declared in any `.gs` file resolves in the others, even
    when that file is not open.
  - Browser globals such as `window`, `document`, `fetch` and `setTimeout` are
    not suggested, because Apps Script does not have them.
- **Snippets** for triggers, web apps, custom functions, menus, locks, caching,
  script properties, `UrlFetchApp` and time-driven triggers.
- **Formatting** through the language server, or with Prettier if you enable
  it (see [Formatting](#formatting)).

## Installation

Clone this repository and run `zed: install dev extension` on the cloned
directory. Rust must be installed through [rustup](https://rustup.rs). Once the
extension is published to the Zed extension registry, it can also be installed
from the Extensions page (`zed: extensions`).

The language server needs Node.js, which Zed provides. The first time you
open a `.gs` file, Zed installs `@vtsls/language-server` and
`@types/google-apps-script` into the extension's directory.

## Working with clasp

With [clasp](https://github.com/google/clasp), the extension works best when
local files use the `.gs` extension. clasp writes pulled files with the first
extension listed in `scriptExtensions` in `.clasp.json`, which is `.js` by
default:

```json
{
  "scriptId": "...",
  "rootDir": "src",
  "scriptExtensions": [".gs", ".js"]
}
```

To keep `.js` files instead, map them to this language in a project settings
file, `.zed/settings.json`:

```json
{
  "file_types": {
    "Google Apps Script": ["**/src/**/*.js"]
  }
}
```

The `appsscript.json` manifest marks the root of a script project. Every
`.gs` file under the directory that contains it is part of the shared global
scope, and so is every `.js` file when you map `.js` files to this language.
Without a manifest, only the files in the same directory are.

## Configuration

The language server is called `apps-script-vtsls`. It accepts the same
settings as vtsls, under `lsp.apps-script-vtsls.settings`. These settings
apply to Apps Script files only, not to your other JavaScript files.

### Type checking

Type errors are not reported by default, as for plain JavaScript. To enable
type checking in every file:

```json
{
  "lsp": {
    "apps-script-vtsls": {
      "settings": {
        "js/ts": {
          "implicitProjectConfig": {
            "checkJs": true
          }
        }
      }
    }
  }
}
```

To check a single file, add `// @ts-check` at the top of it.

JSDoc annotations give types to trigger event objects and your own functions:

```js
/** @param {GoogleAppsScript.Events.SheetsOnEdit} e */
function onEdit(e) {
  const range = e.range; // GoogleAppsScript.Spreadsheet.Range
}
```

### Type definitions

If your project installs `@types/google-apps-script` itself (for example with
`npm install --save-dev @types/google-apps-script`), that copy is used instead
of the bundled one, so you can pin its version.

### Formatting

Files are formatted by the language server. To use Zed's Prettier
integration instead, which formats them like JavaScript:

```json
{
  "languages": {
    "Google Apps Script": {
      "prettier": {
        "allowed": true
      }
    }
  }
}
```

### Inlay hints

The server provides the same inlay hints as Zed's JavaScript support. They are
shown when inlay hints are enabled in Zed:

```json
{
  "languages": {
    "Google Apps Script": {
      "inlay_hints": {
        "enabled": true
      }
    }
  }
}
```

### Disabling the language server

```json
{
  "languages": {
    "Google Apps Script": {
      "enable_language_server": false
    }
  }
}
```

### Using your own vtsls

The Apps Script plugin is tested with the vtsls version the extension
installs (0.3.0, which bundles TypeScript 5.9). Other versions are untested.

```json
{
  "lsp": {
    "apps-script-vtsls": {
      "binary": {
        "path": "/path/to/vtsls",
        "arguments": ["--stdio"]
      }
    }
  }
}
```

## Running functions

Top-level functions can be run from the editor gutter with clasp's
[`run-function`](https://github.com/google/clasp#run) command, which needs the
setup described in clasp's documentation. Functions whose names end with `_`
are private in Apps Script and are skipped. Add this task to
`.zed/tasks.json`:

```json
[
  {
    "label": "clasp run-function $ZED_CUSTOM_function_name",
    "command": "clasp",
    "args": ["run-function", "$ZED_CUSTOM_function_name"],
    "tags": ["apps-script-function"]
  }
]
```

## Notes

- Other languages also use the `.gs` extension, such as Genie, Gosu and GrADS.
  To open those with a different language, add them to `file_types`.
- ES modules (`import` and `export`) are not supported by Apps Script.
- Enabled [advanced services](https://developers.google.com/apps-script/guides/services/advanced)
  (`Drive`, `Sheets`, `Gmail`, ...) are also typed. The type definitions
  declare all of them, whether or not they are enabled in `appsscript.json`.
- HTML files, including templates with `<? ?>` scriptlets, use Zed's HTML
  support.

## How it works

Apps Script runs JavaScript on the V8 runtime, so the extension uses the
[tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript)
grammar with queries adapted from Zed's JavaScript support.

The language server is a separate vtsls instance that only handles Apps
Script files. It loads a small tsserver plugin,
[`tsserver-plugin/index.js`](tsserver-plugin/index.js), which adds the
project's other script files and the Apps Script type definitions to each
project, reads `.gs` files as JavaScript, and uses the ECMAScript library
without the DOM. The vtsls version is pinned because the plugin relies on
tsserver internals.

## Development

```sh
# Extension (Rust, compiled to WebAssembly by Zed)
rustup target add wasm32-wasip2
cargo fmt --check
cargo clippy --target wasm32-wasip2 -- -D warnings
cargo test

# tsserver plugin tests (run vtsls against temporary projects)
cd tsserver-plugin
npm ci
npm test

# Tree-sitter queries (needs tree-sitter-cli and a C compiler)
scripts/check-queries.sh
```

## License

[MIT](LICENSE)
