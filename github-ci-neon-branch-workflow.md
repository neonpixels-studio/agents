## Neon Branch Workflow for GitHub CI

### 1. Add secrets to each repo

In each repo's GitHub settings (Settings → Secrets and variables → Actions), add:

| Secret                              | Value                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| `NEON_API_KEY`                      | Your Neon API key (account settings → API Keys)                  |
| `NEON_PROJECT_ID`                   | The project ID for this repo (Neon dashboard → project settings) |
| `NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key                                            |
| `NUXT_CLERK_SECRET_KEY`             | Clerk secret key                                                 |

`NEON_API_KEY` can be set as an org secret once if all repos are under the same GitHub org.

---

### 2. Add to your CI workflow

Insert these steps around your existing E2E test step:

```yaml
- name: Create Neon branch
  id: neon
  uses: neondatabase/create-neon-branch@v5
  with:
    project_id: ${{ secrets.NEON_PROJECT_ID }}
    api_key: ${{ secrets.NEON_API_KEY }}
    branch_name: ci-${{ github.run_id }}-${{ github.run_attempt }}

- name: Run E2E tests
  env:
    E2E_DATABASE_URL: ${{ steps.neon.outputs.db_url_with_pooler }}
    NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY }}
    NUXT_CLERK_SECRET_KEY: ${{ secrets.NUXT_CLERK_SECRET_KEY }}
  run: npm run e2e

- name: Delete Neon branch
  if: always()
  uses: neondatabase/delete-neon-branch@v3
  with:
    project_id: ${{ secrets.NEON_PROJECT_ID }}
    api_key: ${{ secrets.NEON_API_KEY }}
    branch: ci-${{ github.run_id }}-${{ github.run_attempt }}
```

The `if: always()` on the delete step ensures the branch is cleaned up even when tests fail.

---

### Notes

- `db_url_with_pooler` uses the pooled connection string (PgBouncer). If your Playwright tests need direct connections, use `db_url` instead.
- Branch names are scoped to `run_id` + `run_attempt` so reruns get a fresh branch rather than reusing a dirty one.
- Verify the action versions are current at [neondatabase/create-neon-branch](https://github.com/neondatabase/create-neon-branch) and [neondatabase/delete-neon-branch](https://github.com/neondatabase/delete-neon-branch) before adding to your workflows.
