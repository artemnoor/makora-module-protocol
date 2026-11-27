# Semantic contracts

A profile is a frozen contract ID, Draft 2020-12 schema, definition of meaning, and positive and negative fixtures. Include golden examples of output or conversion for observable semantics. A schema verifies structure and constraints. Modules remain responsible for the meaning and provenance of their data.

The example catalog pins the SHA-256 of the exact UTF-8 bytes of each artifact containing its schema, normative meaning and fixtures. The Host MUST verify the digest from trusted configuration before compilation, reject external references and use the catalog for both input and successful output validation. It MUST compare advertised schemas with trusted entries structurally, allowing object-key reordering. Object-key order is ignored; array order, JSON value types and schema constraints are significant, and the comparison is exact for the trusted entry rather than a similarity check. The Reference Host accepts local fragment references.

An incompatible representation or meaning requires a new ID. MMP 0.1 requires exact IDs on every edge. An adapter is an explicit operation with different input and output contract IDs. Providers are interchangeable for a given triple only when policy permits their effects and required permissions.
