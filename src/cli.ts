// src/cli.ts
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const pkg = require("../package.json") as { version: string };

// Types
type Finding = {
  line: number;
  type:
    | "duplicate-key"
    | "empty-value"
    | "trailing-space"
    | "unbalanced-quotes"
    | "invalid-key"
    | "space-around-equals"
    | "bom-detected"
    | "crlf-detected"
    | "missing-in-example"
    | "extra-vs-example";
  message: string;
  key?: string;
};

const VALID_KEY = /^[A-Z0-9_]+$/;

// Small file utils
function readFileSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function parseEnv(text: string) {
  // normalize CRLF to LF so line numbers are consistent
  const hasCRLF = /\r\n/.test(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return { lines, hasCRLF };
}

// Core analysis
function analyzeEnv(
  lines: string[],
  opts: { compareKeys?: Set<string>; fix?: boolean }
) {
  const findings: Finding[] = [];
  const seen = new Map<string, number>();
  const fixes: { lineIdx: number; newLine: string }[] = [];

  // BOM detection (0xFEFF at start of first line)
  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xfeff) {
    findings.push({
      line: 1,
      type: "bom-detected",
      message: "Byte Order Mark (BOM) detected at file start",
    });
    if (opts.fix) {
      const noBom = lines[0].slice(1);
      fixes.push({ lineIdx: 0, newLine: noBom });
    }
  }

  lines.forEach((raw, i) => {
    const lineNum = i + 1;
    const line = raw;

    // ignore blank lines and comments
    if (!line.trim() || line.trimStart().startsWith("#")) return;

    // trailing whitespace
    if (/\s+$/.test(line)) {
      findings.push({
        line: lineNum,
        type: "trailing-space",
        message: "Trailing whitespace",
      });
      if (opts.fix) {
        fixes.push({ lineIdx: i, newLine: line.replace(/\s+$/, "") });
      }
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) return; // malformed line; skip

    const rawKey = line.slice(0, eqIndex).trim();
    const beforeEq = line.slice(0, eqIndex);
    const afterEq = line.slice(eqIndex + 1);

    // spaces around '=' (can cause subtle loader differences)
    if (beforeEq.endsWith(" ") || afterEq.startsWith(" ")) {
      findings.push({
        line: lineNum,
        type: "space-around-equals",
        message: "Spaces around '=' can be error-prone",
        key: rawKey,
      });
    }

    const key = rawKey.replace(/^\uFEFF/, ""); // just in case BOM stuck around
    const value = afterEq;

    // validate key format
    if (!VALID_KEY.test(key)) {
      findings.push({
        line: lineNum,
        type: "invalid-key",
        message: `Invalid key '${key}'. Use A–Z, 0–9, and underscores only.`,
        key,
      });
    }

    // duplicates
    if (seen.has(key)) {
      findings.push({
        line: lineNum,
        type: "duplicate-key",
        message: `Duplicate key '${key}' (first at line ${seen.get(key)})`,
        key,
      });
    } else {
      seen.set(key, lineNum);
    }

    // empty value (allow quoted empty: "")
    const trimmed = value.trim();
    const isQuoted = /^["'].*["']$/.test(trimmed);
    if (!isQuoted && trimmed === "") {
      findings.push({
        line: lineNum,
        type: "empty-value",
        message: `Empty value for '${key}'`,
        key,
      });
    }

    // unbalanced quotes
    if ((trimmed.startsWith('"') && !trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && !trimmed.endsWith("'"))) {
      findings.push({
        line: lineNum,
        type: "unbalanced-quotes",
        message: `Unbalanced quotes for '${key}'`,
        key,
      });
    }
  });

  // compare .env keys vs example (optional)
  if (opts.compareKeys) {
    for (const k of opts.compareKeys) {
      if (!seen.has(k)) {
        findings.push({
          line: 0,
          type: "missing-in-example",
          message: `Key '${k}' is in .env.example but missing in .env`,
          key: k,
        });
      }
    }
    for (const k of seen.keys()) {
      if (!opts.compareKeys.has(k)) {
        findings.push({
          line: seen.get(k) ?? 0,
          type: "extra-vs-example",
          message: `Key '${k}' exists in .env but not in .env.example`,
          key: k,
        });
      }
    }
  }

  return { findings, fixes };
}

function applyFixes(lines: string[], fixes: { lineIdx: number; newLine: string }[]) {
  const updated = [...lines];
  for (const f of fixes) {
    updated[f.lineIdx] = f.newLine;
  }
  return updated;
}

// SARIF builder
//helper for github
type SarifFinding = {
  line: number;
  type: string;
  message: string;
  key?: string;
};

function buildSarif(args: {
  findings: SarifFinding[];
  filePath: string;
  toolName: string;
  toolVersion: string;
}) {
  const { findings, filePath, toolName, toolVersion } = args;

  // Create rules once per finding type to keep SARIF compact & proper
  const rulesMap = new Map<string, number>();
  const rules: any[] = [];
  function ruleFor(type: string) {
    if (!rulesMap.has(type)) {
      rulesMap.set(type, rules.length);
      rules.push({
        id: type,
        shortDescription: { text: `env-genie rule: ${type}` },
        fullDescription: { text: `Finding of type '${type}' reported by env-genie.` },
        defaultConfiguration: { level: "warning" }
      });
    }
    return type;
  }

  const results = findings.map((f) => ({
    ruleId: ruleFor(f.type),
    level: "warning",
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: filePath.replace(/\\/g, "/") },
          region: { startLine: Math.max(1, f.line || 1) }
        }
      }
    ],
    properties: f.key ? { key: f.key } : undefined
  }));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            version: toolVersion,
            rules
          }
        },
        results
      }
    ]
  };
}

// CLI wiring
function main() {
  const program = new Command()
    .name("env-genie")
    .description("Fast .env linter for humans and CI")
    .argument("[file]", "Path to .env file (default: ./.env)")
    .option("-e, --example <file>", "Compare against .env.example")
    .option("--json", "JSON output")
    // IMPORTANT: keep this as part of the command chain (not a stray line)
    .option("--sarif [file]", "Output findings in SARIF format (optional file path)")
    .option("--fix", "Auto-fix safe issues (BOM removal, trailing spaces, LF)")
    .action((fileArg: string | undefined, opts) => {
      const envPath = path.resolve(process.cwd(), fileArg ?? ".env");
      const text = readFileSafe(envPath);
      if (text === null) {
        console.error(pc.red(`✖ Cannot read ${envPath}`));
        process.exit(2);
      }

      const { lines, hasCRLF } = parseEnv(text);

      // load keys from .env.example if provided
      let compareKeys: Set<string> | undefined;
      if (opts.example) {
        const exPath = path.resolve(process.cwd(), opts.example);
        const exText = readFileSafe(exPath);
        if (exText !== null) {
          const { lines: exLines } = parseEnv(exText);
          const keys = new Set<string>();
          exLines.forEach((l) => {
            const t = l.trim();
            if (!t || t.startsWith("#")) return;
            const idx = l.indexOf("=");
            if (idx !== -1) {
              const k = l.slice(0, idx).trim();
              if (k) keys.add(k);
            }
          });
          compareKeys = keys;
        }
      }

      const { findings, fixes } = analyzeEnv(lines, { compareKeys, fix: !!opts.fix });

      // Normalize line endings when fixing CRLF
      if (hasCRLF) {
        findings.unshift({
          line: 0,
          type: "crlf-detected",
          message: "CRLF line endings detected; LF is recommended for cross-env consistency",
        });
        if (opts.fix) {
          const lf = lines.map((l) => l.replace(/\r/g, ""));
          const after = applyFixes(lf, fixes);
          fs.writeFileSync(envPath, after.join("\n"), "utf8");
        }
      } else if (opts.fix && fixes.length) {
        const after = applyFixes(lines, fixes);
        fs.writeFileSync(envPath, after.join("\n"), "utf8");
      }

      // Outputs
      if (opts.json) {
        // Machine-friendly JSON for CI
        console.log(JSON.stringify({ file: envPath, findings }, null, 2));
      } else {
        // Human output
        if (findings.length === 0) {
          console.log(pc.green(`✔ ${path.basename(envPath)} looks good`));
        } else {
          console.log(pc.yellow(`⚠ Issues in ${path.basename(envPath)}:`));
          for (const f of findings) {
            const ln = f.line ? `:${f.line}` : "";
            console.log(
              `  ${pc.cyan(f.type)}${ln}${f.key ? ` (${f.key})` : ""}: ${f.message}`
            );
          }
        }
      }

      // Write SARIF
      if (opts.sarif) {
        const pkgVersion = "v" + pkg.version;
        const outFile =
          typeof opts.sarif === "string" ? (opts.sarif as string) : "env-genie.sarif";
        const sarif = buildSarif({
          findings,
          filePath: envPath,
          toolName: "env-genie",
          toolVersion: pkgVersion,
        });
        fs.writeFileSync(outFile, JSON.stringify(sarif, null, 2), "utf8");
        console.log(`Wrote SARIF to ${outFile}`);
      }

      // Nonzero exit code if problems found (good for CI)
      process.exit(findings.length ? 1 : 0);
    });

  program.parse(process.argv);
}

main();