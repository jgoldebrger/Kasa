# GitHub branch protection (`main`)

Require status checks so Vercel/production only receive merges that passed CI.

## Required check contexts

| Context         | Workflow          | Job                                                              |
| --------------- | ----------------- | ---------------------------------------------------------------- |
| `ci`            | `ci.yml`          | `ci`                                                             |
| `e2e-smoke`     | `ci.yml`          | `e2e-smoke`                                                      |
| `security-safe` | `ci.yml`          | `security-safe`                                                  |
| `gitleaks`      | `secret-scan.yml` | `gitleaks`                                                       |
| `semgrep`       | `semgrep.yml`     | `semgrep`                                                        |
| CodeQL analyze  | `codeql.yml`      | `analyze` (name may appear as `Analyze (javascript-typescript)`) |

## Apply via GitHub UI

1. **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. Enable **Require status checks to pass before merging**
4. Enable **Require branches to be up to date before merging**
5. Select the contexts above (they appear after each workflow has run once on `main`)
6. Enable **Do not allow bypassing the above settings** (admins included) if your policy allows
7. Disable force pushes and deletions

## Apply via `gh` (admin)

```bash
gh api -X PUT "repos/OWNER/REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "ci",
      "e2e-smoke",
      "security-safe",
      "gitleaks",
      "semgrep"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Add the CodeQL context name after the first successful `codeql` run on `main` (GitHub surfaces the exact check name in the PR UI).

## Related

- Deploy / rollback: [runbooks/deploy-rollback.md](./runbooks/deploy-rollback.md)
- Secret scan: `.github/workflows/secret-scan.yml`
