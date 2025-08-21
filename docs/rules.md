# Rules

These are the rule IDs env-genie reports. You’ll see these IDs in CLI output and SARIF.

- **invalid-key** — Keys must match `^[A-Z0-9_]+$` (uppercase letters, digits, underscore).  
  *Fix:* rename like `BAD_KEY` (no spaces or backslashes).

- **duplicate-key** — The same key appears more than once; many parsers use the **last** one.  
  *Fix:* remove duplicates or consolidate to a single line.

- **empty-value** — A key has no value (`KEY=`). Often accidental or placeholder.  
  *Fix:* add a value or delete the key if unused.

- **unbalanced-quotes** — Mismatched or missing closing quote in a value.  
  *Fix:* use `KEY="value with spaces"` or remove stray quotes.

- **space-around-equals** — `KEY = value` can confuse parsers (space may be part of the key).  
  *Fix:* prefer `KEY=value` (quote the value if it contains spaces).

- **trailing-space** — Whitespace at end of a line can break comparisons or loaders.  
  *Fix:* remove trailing spaces.

- **bom-detected** — UTF-8 BOM at file start can break some env loaders.  
  *Fix:* remove BOM (env-genie `--fix` will do this).

- **crlf-detected** — File uses CRLF (`\r\n`); LF (`\n`) is safer cross-platform.  
  *Fix:* normalize to LF (env-genie `--fix` will do this).

- **missing-in-example** — Key exists in `.env.example` but is missing in the `.env` you scanned.  
  *Fix:* add the missing key to your `.env` (empty or real value per your policy).

- **extra-vs-example** — Key exists in `.env` but not in `.env.example`.  
  *Fix:* add it to `.env.example` or remove it from `.env` if not needed.

---

### Severity (defaults)
- **Errors:** `invalid-key`, `duplicate-key`, `unbalanced-quotes`  
- **Warnings:** `empty-value`, `space-around-equals`, `trailing-space`, `bom-detected`, `crlf-detected`, `missing-in-example`, `extra-vs-example`
