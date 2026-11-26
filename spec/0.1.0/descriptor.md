# Module descriptor

The canonical ModuleDescriptor may be maintained as `mmp.module.json` or generated from a module definition. The descriptor advertised in discovery MUST correspond to the deployed package. It declares the module ID, publisher claim, package version, MMP version, description, operations and dependency triples.

The Host MUST validate the [descriptor schema](../../schemas/0.1.0/module-descriptor.schema.json), unique tools and triples, exact SemVer for the package and trusted identity/version pins. It MUST enumerate tools, reject duplicate names or reserved `mmp_` names, and compare the declared input/output schemas with the trusted catalog. Ordinary MCP servers without valid extension metadata may be used as ordinary MCP servers under Host policy.

A capability is a case-sensitive ASCII `namespace/name` identifier. Its namespace is controlled by the descriptor publisher or a shared naming authority. Different implementations MAY implement the same triple. Dependencies are exact triples and bind each outbound call. Permission names describe required grants. Effects are `read-only`, `write` or `external`; a Host MUST reject unsupported values.
