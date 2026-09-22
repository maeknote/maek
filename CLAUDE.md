# Architecture rules

This repository uses feature-first ownership. Read
[docs/architecture.md](docs/architecture.md) before adding or moving a feature.
Do not bypass a feature's public `index.ts`, and keep shared code independent
of features and app composition.
