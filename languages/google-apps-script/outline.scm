(function_declaration
  "async"? @context
  "function" @context
  name: (_) @name
  parameters: (formal_parameters
    "(" @context
    ")" @context)) @item

(generator_function_declaration
  "async"? @context
  "function" @context
  "*" @context
  name: (_) @name
  parameters: (formal_parameters
    "(" @context
    ")" @context)) @item

; Top-level declarations. `var` is still common in Apps Script code written
; for the legacy Rhino runtime.
(program
  [
    (lexical_declaration
      [
        "let"
        "const"
      ] @context
      (variable_declarator
        name: (identifier) @name) @item)
    (variable_declaration
      "var" @context
      (variable_declarator
        name: (identifier) @name) @item)
  ])

; Top-level array destructuring
(program
  (lexical_declaration
    [
      "let"
      "const"
    ] @context
    (variable_declarator
      name: (array_pattern
        [
          (identifier) @name @item
          (assignment_pattern
            left: (identifier) @name @item)
          (rest_pattern
            (identifier) @name @item)
        ]))))

; Top-level object destructuring
(program
  (lexical_declaration
    [
      "let"
      "const"
    ] @context
    (variable_declarator
      name: (object_pattern
        [
          (shorthand_property_identifier_pattern) @name @item
          (pair_pattern
            value: (identifier) @name @item)
          (pair_pattern
            value: (assignment_pattern
              left: (identifier) @name @item))
          (rest_pattern
            (identifier) @name @item)
        ]))))

(class_declaration
  "class" @context
  name: (_) @name) @item

; Method definitions in classes (not in object literals)
(class_body
  (method_definition
    [
      "get"
      "set"
      "async"
      "*"
      "static"
    ]* @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item)

(field_definition
  "static"? @context
  property: (_) @name) @item

; Object literal methods (including nested objects)
(object
  (method_definition
    [
      "get"
      "set"
      "async"
      "*"
    ]* @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item)

; Object properties
(pair
  key: [
    (property_identifier) @name
    (string
      (string_fragment) @name)
    (number) @name
    (computed_property_name) @name
  ]) @item

; Nested variables in function bodies
(statement_block
  (lexical_declaration
    [
      "let"
      "const"
    ] @context
    (variable_declarator
      name: (identifier) @name) @item))

(comment) @annotation
