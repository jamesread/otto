# Notes for AI agents

## Semantic commits

Use [Conventional Commits](https://www.conventionalcommits.org/) (semantic commit messages) for all commits.

Format: `type(scope): description`

- **type**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- **scope** (optional): area of the codebase, e.g. `frontend`, `backend`, `ci`
- **description**: imperative, lowercase start, no period at end

Examples:
- `feat(frontend): add Share for advice button using Web Share API with GTD context`
- `fix(api): correct pagination for list endpoint`
- `docs: update README setup steps`
- `chore(deps): bump vite to 5.x`
