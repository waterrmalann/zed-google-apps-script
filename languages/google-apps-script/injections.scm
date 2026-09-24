((comment) @injection.content
  (#set! injection.language "comment"))

; JSDoc, which also carries Apps Script annotations such as
; `@OnlyCurrentDoc` and `@customfunction`.
(((comment) @_jsdoc_comment
  (#match? @_jsdoc_comment "(?s)^/[*][*][^*].*[*]/$")) @injection.content
  (#set! injection.language "jsdoc"))

((regex) @injection.content
  (#set! injection.language "regex"))

; HTML passed to HtmlService:
; HtmlService.createHtmlOutput('<p>Hello</p>')
; HtmlService.createTemplate(`<p><?= name ?></p>`)
(call_expression
  function: (member_expression
    object: (identifier) @_service
    (#eq? @_service "HtmlService")
    property: (property_identifier) @_method
    (#any-of? @_method "createHtmlOutput" "createTemplate"))
  arguments: (arguments
    .
    [
      (string
        (string_fragment) @injection.content)
      (template_string
        (string_fragment) @injection.content)
    ])
  (#set! injection.language "html"))

; SQL passed to JDBC statements:
; conn.prepareStatement('SELECT * FROM users WHERE id = ?')
(call_expression
  function: (member_expression
    property: (property_identifier) @_method
    (#any-of? @_method
      "executeQuery" "executeUpdate" "prepareStatement" "prepareCall"))
  arguments: (arguments
    .
    [
      (string
        (string_fragment) @injection.content)
      (template_string
        (string_fragment) @injection.content)
    ])
  (#set! injection.language "sql"))

; Tagged template literals: html`...`, css`...`, sql`...`, ...
(call_expression
  function: (identifier) @_name
  (#eq? @_name "html")
  arguments: (template_string) @injection.content
  (#set! injection.language "html"))

(call_expression
  function: (identifier) @_name
  (#eq? @_name "css")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "css")))

(call_expression
  function: (identifier) @_name
  (#eq? @_name "js")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "javascript")))

(call_expression
  function: (identifier) @_name
  (#eq? @_name "json")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "json")))

(call_expression
  function: (identifier) @_name
  (#eq? @_name "sql")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "sql")))

(call_expression
  function: (identifier) @_name
  (#match? @_name "^g(raph)?ql$")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "graphql")))

; Strings and template literals preceded by a language comment:
; '/* html */' or '/*html*/'
(((comment) @_ecma_comment
  [
    (string
      (string_fragment) @injection.content)
    (template_string
      (string_fragment) @injection.content)
  ])
  (#match? @_ecma_comment "^\\/\\*\\s*html\\s*\\*\\/")
  (#set! injection.language "html"))

; '/* sql */' or '/*sql*/'
(((comment) @_ecma_comment
  [
    (string
      (string_fragment) @injection.content)
    (template_string
      (string_fragment) @injection.content)
  ])
  (#match? @_ecma_comment "^\\/\\*\\s*sql\\s*\\*\\/")
  (#set! injection.language "sql"))

; '/* css */' or '/*css*/'
(((comment) @_ecma_comment
  [
    (string
      (string_fragment) @injection.content)
    (template_string
      (string_fragment) @injection.content)
  ])
  (#match? @_ecma_comment "^\\/\\*\\s*css\\s*\\*\\/")
  (#set! injection.language "css"))

; '/* gql */' or '/*graphql*/'
(((comment) @_ecma_comment
  [
    (string
      (string_fragment) @injection.content)
    (template_string
      (string_fragment) @injection.content)
  ])
  (#match? @_ecma_comment "^\\/\\*\\s*(gql|graphql)\\s*\\*\\/")
  (#set! injection.language "graphql"))
