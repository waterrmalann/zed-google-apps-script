use std::{env, fs, path::Path};

use zed_extension_api::{
    self as zed,
    lsp::{Completion, CompletionKind},
    serde_json::{json, Value},
    settings::LspSettings,
    CodeLabel, CodeLabelSpan, LanguageServerId, Result,
};

/// Version of `@vtsls/language-server` the tsserver plugin is tested with.
///
/// The plugin hooks into tsserver internals, so the server (which bundles its
/// own TypeScript) is pinned rather than following `latest`.
const SERVER_PACKAGE: &str = "@vtsls/language-server";
const SERVER_VERSION: &str = "0.3.0";
const SERVER_PATH: &str = "node_modules/@vtsls/language-server/bin/vtsls.js";

/// Apps Script type definitions (`SpreadsheetApp`, `DriveApp`, ...). They only
/// contain declarations, so the latest release is used.
const TYPES_PACKAGE: &str = "@types/google-apps-script";
const TYPES_PATH: &str = "node_modules/@types/google-apps-script/index.d.ts";

/// The tsserver plugin is written to
/// `<work dir>/tsserver-plugin/node_modules/<name>/`, the layout tsserver
/// expects under a `--pluginProbeLocations` directory. It finds the type
/// definitions relative to that location.
const PLUGIN_NAME: &str = "zed-apps-script-tsserver-plugin";
const PLUGIN_LOCATION: &str = "tsserver-plugin";
const PLUGIN_SOURCE: &str = include_str!("../tsserver-plugin/index.js");

struct GoogleAppsScriptExtension {
    /// Whether each package has been checked in this session, so that
    /// restarting the server does not query the npm registry again.
    checked_server: bool,
    checked_types: bool,
}

impl GoogleAppsScriptExtension {
    fn ensure_server(&mut self, language_server_id: &LanguageServerId) -> Result<()> {
        if self.checked_server && file_exists(SERVER_PATH) {
            return Ok(());
        }
        install_npm_package(
            language_server_id,
            SERVER_PACKAGE,
            SERVER_PATH,
            Some(SERVER_VERSION),
        )?;
        self.checked_server = true;
        Ok(())
    }

    /// The server still works without the Apps Script type definitions, so a
    /// failure to install them is only logged.
    fn ensure_type_definitions(&mut self, language_server_id: &LanguageServerId) {
        if self.checked_types && file_exists(TYPES_PATH) {
            return;
        }
        match install_npm_package(language_server_id, TYPES_PACKAGE, TYPES_PATH, None) {
            Ok(()) => self.checked_types = true,
            Err(error) => eprintln!("failed to install {TYPES_PACKAGE}: {error}"),
        }
    }
}

impl zed::Extension for GoogleAppsScriptExtension {
    fn new() -> Self {
        Self {
            checked_server: false,
            checked_types: false,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        let binary_path = binary.as_ref().and_then(|binary| binary.path.clone());
        let binary_args = binary.as_ref().and_then(|binary| binary.arguments.clone());
        let binary_env = binary.and_then(|binary| binary.env);

        if binary_path.is_none() {
            self.ensure_server(language_server_id)?;
        }
        // A user-provided server still needs the type definitions.
        self.ensure_type_definitions(language_server_id);
        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::None,
        );
        write_tsserver_plugin()?;

        let (command, args) = match binary_path {
            Some(path) => (
                path,
                binary_args.unwrap_or_else(|| vec!["--stdio".to_string()]),
            ),
            None => {
                let mut args = vec![work_dir_path(SERVER_PATH)?];
                args.extend(binary_args.unwrap_or_else(|| vec!["--stdio".to_string()]));
                (zed::node_binary_path()?, args)
            }
        };

        Ok(zed::Command {
            command,
            args,
            env: binary_env
                .map(|env| env.into_iter().collect())
                .unwrap_or_default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        Ok(
            LspSettings::for_worktree(language_server_id.as_ref(), worktree)
                .ok()
                .and_then(|settings| settings.initialization_options),
        )
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        let mut configuration = default_workspace_configuration()?;
        if let Some(user_settings) =
            LspSettings::for_worktree(language_server_id.as_ref(), worktree)
                .ok()
                .and_then(|settings| settings.settings)
        {
            merge_json(&mut configuration, user_settings);
        }
        // Keep the plugin even when the user provides their own list.
        ensure_tsserver_plugin(&mut configuration)?;
        Ok(Some(configuration))
    }

    fn label_for_completion(
        &self,
        _language_server_id: &LanguageServerId,
        completion: Completion,
    ) -> Option<CodeLabel> {
        let highlight_name = match completion.kind? {
            CompletionKind::Class
            | CompletionKind::Interface
            | CompletionKind::Enum
            | CompletionKind::Constructor => "type",
            CompletionKind::Constant => "constant",
            CompletionKind::Function | CompletionKind::Method => "function",
            CompletionKind::Property | CompletionKind::Field => "property",
            CompletionKind::Variable => "variable",
            _ => return None,
        };

        let label_len = completion.label.len();
        let mut spans = vec![CodeLabelSpan::literal(
            completion.label,
            Some(highlight_name.to_string()),
        )];
        // Same layout as Zed's built-in JavaScript support: the module an
        // auto-import comes from, or the type detail, after the name.
        let detail = completion
            .label_details
            .and_then(|details| details.description)
            .or(completion.detail);
        if let Some(detail) = detail.filter(|detail| !detail.is_empty()) {
            spans.push(CodeLabelSpan::literal(format!(" {detail}"), None));
        }

        Some(CodeLabel {
            code: String::new(),
            spans,
            filter_range: (0..label_len as u32).into(),
        })
    }
}

fn file_exists(path: &str) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// Absolute path of a file in the extension's working directory.
fn work_dir_path(relative_path: &str) -> Result<String> {
    let work_dir = env::current_dir().map_err(|error| error.to_string())?;
    Ok(work_dir.join(relative_path).to_string_lossy().to_string())
}

/// Installs `package` (at `version`, or the latest release) unless that
/// version is already installed. An installed copy is kept if the registry
/// cannot be reached.
fn install_npm_package(
    language_server_id: &LanguageServerId,
    package: &str,
    entry_path: &str,
    version: Option<&str>,
) -> Result<()> {
    let installed = file_exists(entry_path);
    zed::set_language_server_installation_status(
        language_server_id,
        &zed::LanguageServerInstallationStatus::CheckingForUpdate,
    );
    let version = match version {
        Some(version) => version.to_string(),
        None => match zed::npm_package_latest_version(package) {
            Ok(version) => version,
            Err(_) if installed => return Ok(()),
            Err(error) => return Err(error),
        },
    };

    if installed && zed::npm_package_installed_version(package)?.as_deref() == Some(&version) {
        return Ok(());
    }

    zed::set_language_server_installation_status(
        language_server_id,
        &zed::LanguageServerInstallationStatus::Downloading,
    );
    match zed::npm_install_package(package, &version) {
        Ok(()) if file_exists(entry_path) => Ok(()),
        Ok(()) => Err(format!(
            "installed package '{package}' did not contain expected path '{entry_path}'"
        )),
        Err(_) if installed => Ok(()),
        Err(error) => Err(error),
    }
}

/// Writes the tsserver plugin that ships with this version of the extension.
fn write_tsserver_plugin() -> Result<()> {
    let plugin_dir = Path::new(PLUGIN_LOCATION)
        .join("node_modules")
        .join(PLUGIN_NAME);
    let manifest = json!({
        "name": PLUGIN_NAME,
        "version": env!("CARGO_PKG_VERSION"),
        "private": true,
        "main": "index.js",
    })
    .to_string();

    let write = |file_name: &str, contents: &str| -> Result<()> {
        let path = plugin_dir.join(file_name);
        if fs::read_to_string(&path).is_ok_and(|existing| existing == contents) {
            return Ok(());
        }
        fs::write(&path, contents)
            .map_err(|error| format!("failed to write {}: {error}", path.display()))
    };

    fs::create_dir_all(&plugin_dir)
        .map_err(|error| format!("failed to create {}: {error}", plugin_dir.display()))?;
    write("package.json", &manifest)?;
    write("index.js", PLUGIN_SOURCE)
}

fn tsserver_plugin_entry() -> Result<Value> {
    Ok(json!({
        "name": PLUGIN_NAME,
        "location": work_dir_path(PLUGIN_LOCATION)?,
        "enableForWorkspaceTypeScriptVersions": true,
    }))
}

fn default_workspace_configuration() -> Result<Value> {
    // The same editor defaults as Zed's built-in JavaScript support.
    let javascript = json!({
        "suggest": {
            "completeFunctionCalls": true
        },
        "inlayHints": {
            "parameterNames": {
                "enabled": "all",
                "suppressWhenArgumentMatchesName": false
            },
            "parameterTypes": {
                "enabled": true
            },
            "variableTypes": {
                "enabled": true,
                "suppressWhenTypeMatchesName": false
            },
            "propertyDeclarationTypes": {
                "enabled": true
            },
            "functionLikeReturnTypes": {
                "enabled": true
            },
            "enumMemberValues": {
                "enabled": true
            }
        },
    });

    Ok(json!({
        "javascript": javascript,
        "typescript": {
            // Type acquisition downloads typings for npm packages, which Apps
            // Script cannot import.
            "disableAutomaticTypeAcquisition": true,
        },
        "vtsls": {
            // Always use the bundled TypeScript the plugin is tested with.
            "autoUseWorkspaceTsdk": false,
            "experimental": {
                "completion": {
                    "enableServerSideFuzzyMatch": true,
                    "entriesLimit": 5000,
                }
            },
            "tsserver": {
                "globalPlugins": [tsserver_plugin_entry()?],
            },
        },
    }))
}

/// Adds the Apps Script plugin to `vtsls.tsserver.globalPlugins` if user
/// settings replaced that list.
fn ensure_tsserver_plugin(configuration: &mut Value) -> Result<()> {
    let entry = tsserver_plugin_entry()?;
    let Some(plugins) = configuration
        .pointer_mut("/vtsls/tsserver")
        .and_then(Value::as_object_mut)
        .map(|tsserver| {
            tsserver
                .entry("globalPlugins")
                .or_insert_with(|| Value::Array(Vec::new()))
        })
    else {
        return Ok(());
    };

    match plugins {
        Value::Array(plugins) => {
            let has_plugin = plugins
                .iter()
                .any(|plugin| plugin.get("name").and_then(Value::as_str) == Some(PLUGIN_NAME));
            if !has_plugin {
                plugins.push(entry);
            }
        }
        other => *other = Value::Array(vec![entry]),
    }
    Ok(())
}

/// Recursively merges `overrides` into `target`. Objects are merged key by
/// key; any other value in `overrides` replaces the one in `target`.
fn merge_json(target: &mut Value, overrides: Value) {
    match (target, overrides) {
        (Value::Object(target), Value::Object(overrides)) => {
            for (key, value) in overrides {
                match target.get_mut(&key) {
                    Some(existing) => merge_json(existing, value),
                    None => {
                        target.insert(key, value);
                    }
                }
            }
        }
        (target, overrides) => *target = overrides,
    }
}

zed::register_extension!(GoogleAppsScriptExtension);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_json_merges_objects_and_replaces_values() {
        let mut target = json!({ "a": { "b": 1, "c": [1] }, "d": true });
        merge_json(
            &mut target,
            json!({ "a": { "c": [2], "e": "x" }, "d": false }),
        );
        assert_eq!(
            target,
            json!({ "a": { "b": 1, "c": [2], "e": "x" }, "d": false })
        );
    }

    #[test]
    fn ensure_tsserver_plugin_keeps_user_plugins() {
        let mut configuration = json!({
            "vtsls": { "tsserver": { "globalPlugins": [{ "name": "other" }] } }
        });
        ensure_tsserver_plugin(&mut configuration).unwrap();
        let plugins = configuration["vtsls"]["tsserver"]["globalPlugins"]
            .as_array()
            .unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0]["name"], "other");
        assert_eq!(plugins[1]["name"], PLUGIN_NAME);

        ensure_tsserver_plugin(&mut configuration).unwrap();
        let plugins = configuration["vtsls"]["tsserver"]["globalPlugins"]
            .as_array()
            .unwrap();
        assert_eq!(plugins.len(), 2);
    }

    #[test]
    fn default_configuration_contains_plugin() {
        let configuration = default_workspace_configuration().unwrap();
        let plugins = configuration["vtsls"]["tsserver"]["globalPlugins"]
            .as_array()
            .unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["name"], PLUGIN_NAME);
        assert!(plugins[0]["location"]
            .as_str()
            .unwrap()
            .ends_with(PLUGIN_LOCATION));
    }
}
