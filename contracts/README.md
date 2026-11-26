# Example trusted contracts

Each JSON file packages an immutable schema, its field semantics and positive/negative fixtures. The Host compares the SHA-256 of the exact file bytes with a digest from trusted configuration, then compiles the schema and verifies the fixtures. The example pins live in `examples/pins.json`. The conformance suite includes the golden conversion of three whole rubles to three hundred kopecks.
