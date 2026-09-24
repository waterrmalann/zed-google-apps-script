; Adapted from Zed's built-in JavaScript queries for tree-sitter-javascript.
; Later patterns take precedence over earlier ones.

; Variables
(identifier) @variable

(call_expression
  function: (member_expression
    object: (identifier) @type
    (#any-of? @type
      "Promise" "Array" "Object" "Map" "Set" "WeakMap" "WeakSet" "Date" "Error" "TypeError"
      "RangeError" "SyntaxError" "ReferenceError" "EvalError" "URIError" "RegExp" "Function"
      "Number" "String" "Boolean" "Symbol" "BigInt" "Proxy" "ArrayBuffer" "DataView" "Math"
      "JSON" "Reflect" "Intl")))

; Properties
(property_identifier) @property

(shorthand_property_identifier) @property

(shorthand_property_identifier_pattern) @property

(private_property_identifier) @property

; Function and method calls
(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: [
      (property_identifier)
      (private_property_identifier)
    ] @function.method))

(new_expression
  constructor: (identifier) @type.class)

; Function and method definitions
(function_expression
  name: (identifier) @function)

(function_declaration
  name: (identifier) @function)

(generator_function
  name: (identifier) @function)

(generator_function_declaration
  name: (identifier) @function)

(method_definition
  name: [
    (property_identifier)
    (private_property_identifier)
  ] @function.method)

(method_definition
  name: (property_identifier) @constructor
  (#eq? @constructor "constructor"))

(pair
  key: [
    (property_identifier)
    (private_property_identifier)
  ] @function.method
  value: [
    (function_expression)
    (arrow_function)
  ])

(assignment_expression
  left: (member_expression
    property: [
      (property_identifier)
      (private_property_identifier)
    ] @function.method)
  right: [
    (function_expression)
    (arrow_function)
  ])

(variable_declarator
  name: (identifier) @function
  value: [
    (function_expression)
    (arrow_function)
  ])

(assignment_expression
  left: (identifier) @function
  right: [
    (function_expression)
    (arrow_function)
  ])

; Parameters
(formal_parameters
  [
    (identifier) @variable.parameter
    (array_pattern
      (identifier) @variable.parameter)
    (object_pattern
      [
        (pair_pattern
          value: (identifier) @variable.parameter)
        (shorthand_property_identifier_pattern) @variable.parameter
      ])
    (assignment_pattern
      left: (identifier) @variable.parameter)
    (object_pattern
      (object_assignment_pattern
        left: (shorthand_property_identifier_pattern) @variable.parameter))
    (rest_pattern
      (identifier) @variable.parameter)
  ])

(catch_clause
  parameter: (identifier) @variable.parameter)

(arrow_function
  parameter: (identifier) @variable.parameter)

; Special identifiers
(class_declaration
  name: (identifier) @type.class)

(class
  name: (identifier) @type.class)

(class_heritage
  (identifier) @type.class)

([
  (identifier)
  (shorthand_property_identifier)
  (shorthand_property_identifier_pattern)
] @constant
  (#match? @constant "^_*[A-Z_][A-Z\\d_]*$"))

; Custom functions for Sheets are conventionally upper case (`=DOUBLE(A1)`), so
; function names take precedence over the constant naming convention.
(function_declaration
  name: (identifier) @function)

(call_expression
  function: (identifier) @function)

; Apps Script built-in services and enums
; https://developers.google.com/apps-script/reference
((identifier) @type.builtin
  (#any-of? @type.builtin
    "Browser" "CacheService" "CalendarApp" "CardService" "Charset" "Charts"
    "ConferenceDataService" "ContentService" "DataStudioApp" "DigestAlgorithm" "DocumentApp"
    "DriveApp" "FormApp" "GmailApp" "GroupsApp" "HtmlService" "Jdbc" "LanguageApp"
    "LinearOptimizationService" "LockService" "Logger" "MacAlgorithm" "MailApp" "Maps"
    "MimeType" "PropertiesService" "RsaAlgorithm" "ScriptApp" "Session" "SlidesApp"
    "SpreadsheetApp" "UrlFetchApp" "Utilities" "XmlService"))

; Simple triggers and web app entry points
; https://developers.google.com/apps-script/guides/triggers
(program
  (function_declaration
    name: (identifier) @function.special
    (#any-of? @function.special
      "onOpen" "onEdit" "onInstall" "onSelectionChange" "doGet" "doPost")))

; Literals
(this) @variable.special

(super) @variable.special

[
  (null)
  (undefined)
] @constant.builtin

[
  (true)
  (false)
] @boolean

(comment) @comment

(hash_bang_line) @comment

[
  (string)
  (template_string)
] @string

(escape_sequence) @string.escape

(regex) @string.regex

(regex_flags) @keyword.operator.regex

(number) @number

; Tokens
[
  ";"
  (optional_chain)
  "."
  ","
  ":"
] @punctuation.delimiter

[
  "-"
  "--"
  "-="
  "+"
  "++"
  "+="
  "*"
  "*="
  "**"
  "**="
  "/"
  "/="
  "%"
  "%="
  "<"
  "<="
  "<<"
  "<<="
  "="
  "=="
  "==="
  "!"
  "!="
  "!=="
  "=>"
  ">"
  ">="
  ">>"
  ">>="
  ">>>"
  ">>>="
  "~"
  "^"
  "&"
  "|"
  "^="
  "&="
  "|="
  "&&"
  "||"
  "??"
  "&&="
  "||="
  "??="
  "..."
] @operator

(regex
  "/" @string.regex)

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

(ternary_expression
  [
    "?"
    ":"
  ] @operator)

[
  "as"
  "async"
  "debugger"
  "default"
  "delete"
  "extends"
  "get"
  "in"
  "instanceof"
  "new"
  "of"
  "set"
  "static"
  "target"
  "typeof"
  "using"
  "void"
  "with"
] @keyword

[
  "const"
  "let"
  "var"
  "function"
  "class"
] @keyword.declaration

[
  "export"
  "from"
  "import"
] @keyword.import

[
  "await"
  "break"
  "case"
  "catch"
  "continue"
  "do"
  "else"
  "finally"
  "for"
  "if"
  "return"
  "switch"
  "throw"
  "try"
  "while"
  "yield"
] @keyword.control

(switch_default
  "default" @keyword.control)

(template_substitution
  "${" @punctuation.special
  "}" @punctuation.special) @embedded

(decorator
  "@" @punctuation.special)
