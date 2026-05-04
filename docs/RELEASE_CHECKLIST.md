# Release checklist

Reference for cutting a new release of `opencode-assistant`. Most of the
work is automated; this document covers the maintainer's part.

## One-time setup

These have to be done once and never again unless something rotates.

### 1. Detach the GitHub fork

If the repository was created by forking another project, GitHub keeps it
flagged as a fork forever in the UI even after the upstream link is gone.
The only way to clear that is to ask GitHub Support.

- Open <https://support.github.com/contact?tags=rr-general-support> with
  the GitHub account that owns the repository.
- Subject: "Detach repository from fork network".
- Body: include the repository URL and confirm you want it converted to a
  standalone repository.
- Wait 1-2 business days for confirmation.

### 2. npm publish credentials

`publish.yml` needs `NPM_TOKEN` configured as a repository secret.

- Generate an automation token on <https://www.npmjs.com/settings/~/tokens>
  (type: "Granular access token" with publish access to the
  `opencode-assistant` package, or a classic "Automation" token).
- Add it to the repo: Settings → Secrets and variables → Actions → New
  repository secret → name `NPM_TOKEN`, paste the token.

### 3. GHCR (Docker Hub alternative)

Nothing to set up. `docker-publish.yml` uses the built-in
`GITHUB_TOKEN` which already has `packages: write`. After the first
release the image will appear at
`ghcr.io/<owner>/opencode-assistant:<version>`.

To make the image public, go to the package page (Profile → Packages →
opencode-assistant) → Package settings → Change visibility → Public.

## Cutting a release

```bash
# 1. Make sure main is green
gh run list --workflow=ci.yml --branch=main --limit=1

# 2. Bump version, generate changelog, commit, tag — all in one
npm run release:prepare        # stable bump (X.Y.Z)
# or
npm run release:rc             # release-candidate bump (X.Y.Z-rc.N)

# 3. Push to main
git push origin main
```

After the push:

1. `publish.yml` runs on `main`, sees the version bump, runs
   `lint + build + test`, publishes to npm, creates the git tag `vX.Y.Z`,
   and opens a GitHub release with auto-generated notes.
2. The new GitHub release triggers `docker-publish.yml`, which builds the
   bot image for `linux/amd64` and `linux/arm64` and pushes it to GHCR
   tagged `:vX.Y.Z` and `:latest` (or `:next` for RCs).

## Verification (post-release)

- `npm view opencode-assistant version` returns the new version.
- `docker pull ghcr.io/<owner>/opencode-assistant:<version>` succeeds.
- The GitHub release page shows the auto-generated notes.
- A clean clone followed by `cp .env.example .env` (filled in) and
  `docker compose up -d` produces a working bot.

## When something fails

- **`publish.yml` fails on "Ensure npm version is not already published"**
  — somebody bumped to a version that already exists on npm. Bump again.
- **`publish.yml` fails on tests** — fix on `main`, run
  `npm run release:prepare` again to roll the version forward, push.
- **`docker-publish.yml` fails on QEMU/buildx setup** — usually a
  GitHub Actions runner outage. Re-run from the workflow tab.
- **GHCR push fails with 403** — the repository owner needs to enable
  package publishing. Settings → Actions → General → Workflow permissions
  → check "Read and write permissions".
