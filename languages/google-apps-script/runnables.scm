; Top-level functions, which Apps Script can run by name (for example with
; `clasp run-function`). Functions ending in `_` are private to the script and
; cannot be run directly.
; https://developers.google.com/apps-script/guides/html/communication#private_functions
((program
  (function_declaration
    name: (identifier) @run @function_name))
  (#not-match? @run "_$")
  (#set! tag apps-script-function))
