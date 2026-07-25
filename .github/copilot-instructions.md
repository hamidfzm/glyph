# Glyph Copilot Instructions

See [CLAUDE.md](../CLAUDE.md) for architecture, key files, and release process.
See [CONTRIBUTING.md](../CONTRIBUTING.md) for development commands, conventions, workflow, and PR guidelines.

Additional rules for frontend and Rust code are in `.claude/rules/`.

Non-negotiable guarantees for stateful and security-sensitive code are in [docs/engineering-invariants.md](../docs/engineering-invariants.md); changes touching them must name the invariants at stake and test the adversarial scenario matrix.
