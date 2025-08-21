# env-genie

<p align="center">
  <img src="env-genie-icon.svg" width="720" alt="env-genie --Fast env linter for humans and CI.">
</p>


Fast `.env` linter and fixer for humans and CI

[![Install](https://img.shields.io/badge/Install-npx%20env--genie-CB3837?logo=npm)](https://www.npmjs.com/package/env-genie)
[![npm](https://img.shields.io/npm/v/env-genie?logo=npm)](https://www.npmjs.com/package/env-genie)
[![Publish](https://img.shields.io/github/actions/workflow/status/thegreatbey/env-genie/publish.yml?branch=main)](https://github.com/thegreatbey/env-genie/actions/workflows/publish.yml)
[![Install size](https://packagephobia.com/badge?p=env-genie)](https://packagephobia.com/result?p=env-genie)
[![Downloads](https://img.shields.io/npm/dm/env-genie)](https://www.npmjs.com/package/env-genie)
[![License](https://img.shields.io/github/license/thegreatbey/env-genie)](https://github.com/thegreatbey/env-genie/blob/main/LICENSE)



`env-genie` makes sure your `.env` files are clean, consistent, and production-ready. It detects common mistakes, compares against `.env.example`, and can output results in human-friendly, JSON, or SARIF formats for CI pipelines.

## Features
- Detects common issues:
  - Duplicate keys
  - Empty values
  - Trailing spaces
  - Unbalanced quotes
  - Invalid keys (ALL_CAPS_UNDERSCORE only)
  - Spaces around `=`
  - BOM detection
  - CRLF line endings
  - Missing/extra keys vs `.env.example`
- Auto-fix safe issues with `--fix` (BOM, trailing spaces, CRLF → LF)
- Multiple outputs:
  - Human-friendly CLI output
  - `--json` for scripts/CI
  - `--sarif` for GitHub code scanning
- Fast, lightweight, zero deps beyond `commander` + `picocolors`

## Usage
Install globally:
```bash
npm install -g env-genie
```

Or run with `npx`:
```bash
npx env-genie .env
```

quick try
```bash
npx env-genie
```
local dev dependency
```bash
npm i -D env-genie
npx env-genie
```

## CLI Usage

```bash
# scan default .env in text mode
npx env-genie

# write SARIF for GitHub Code Scanning
npx env-genie --sarif env-genie.sarif

# JSON for scripting
npx env-genie --json | jq '.findings | length' 

# multiple files
npx env-genie --path .env --path apps/web/.env.local
```

## GitHub Actions (Code Scanning)

```yaml
name: env-lint
on: [push, pull_request]
jobs:
  lint-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx env-genie --sarif env-genie.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: env-genie.sarif
```



## Options
```bash
Usage: env-genie [options] [file]

Arguments:
  file                  Path to .env file (default: ./.env)

Options:
  -e, --example <file>  Compare against .env.example
  --json                JSON output
  --sarif [file]        Output findings in SARIF format (optional file path)
  --fix                 Auto-fix safe issues (BOM removal, trailing spaces, LF)
  -h, --help            Show help
```

### Example
```bash
# Check .env and compare against .env.example
npx env-genie -e .env.example

# Output JSON
npx env-genie --json

# Output SARIF (GitHub code scanning)
npx env-genie --sarif

# Auto-fix safe issues
npx env-genie --fix
```

## More Examples and Usage

```bash
npx env-genie               # check ./.env
npx env-genie .env.local    # check a specific file
npx env-genie --example .env.example
npx env-genie --json
npx env-genie --fix         # safe autofixes (BOM, trailing spaces, LF)

# in CI:
- run: npx env-genie --example .env.example


## CI Integration
`env-genie` works great in GitHub Actions. Example:
```yaml
- name: Lint env
  run: npx env-genie --sarif env-genie.sarif || true
```
