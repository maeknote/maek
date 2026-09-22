# Repository guidance

Follow the feature boundaries in [docs/architecture.md](docs/architecture.md).
Keep new UI and domain logic in its owning feature, use feature public indexes
for cross-feature dependencies, and run `npm run check` after structural work.

For standalone custom dashboards or editors, follow
`.agents/skills/maek-custom-page/SKILL.md`.
