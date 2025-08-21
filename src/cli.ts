// src/cli.ts
import { Command, Option } from "commander";
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

/** Map finding types to severity for SARIF and exit policy */
function severityFor(type: string): "error" | "warning" | "note" {
  switch (type) {
    case "invalid-key":
    case "duplicate-key":
    case "unbalanced-quotes":
      return "error";
    case "empty-value":
    case "trailing-space":
    case "space-around-equals":
    case "bom-detected":
    case "crlf-detected":
    case "missing-in-example":
    case "extra-vs-example":
    default:
      return "warning";
  }
}


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

// CLI wiring
function main() {
  const program = new Command()
    .name("env-genie")
    .version(pkg.version)//pkg import
    .description("Fast .env linter for humans and CI. Validate and lint .env files; optional SARIF for GitHub Code Scanning.")
    .argument("[file]", "Path to .env file (default: ./.env)")
    .option("--path <file...>", "One or more .env files to scan", [])
    .option("-e, --example <file>", "Compare against .env.example")
    .option("--json", "JSON output")
    // IMPORTANT: this is part of the command chain (not a stray line)
    .option("--sarif [file]", "Output findings in SARIF format (optional file path)")
    .option("--fix", "Auto-fix safe issues (BOM removal, trailing spaces, LF)")
    // EXIT POLICY OPTIONS
    .option("--exit-zero", "Always exit 0 (useful when trialing in CI)", false)
    .addOption(new Option("--fail-on <level>").choices(["error", "warning"]).default("error"))
    .option("--max-errors <n>", "Allow up to N errors (Infinity by default)", (v) => parseInt(String(v), 10), Number.POSITIVE_INFINITY)
    .option("--max-warnings <n>", "Allow up to N warnings (Infinity by default)", (v) => parseInt(String(v), 10), Number.POSITIVE_INFINITY)

    .action((fileArg: string | undefined, opts) => {
      //const envPath = path.resolve(process.cwd(), fileArg ?? ".env");
      //const text = readFileSafe(envPath);
      //if (text === null) {
      //console.error(pc.red(`✖ Cannot read ${envPath}`));
      //  process.exit(2);
      //}

      //const { lines, hasCRLF } = parseEnv(text);

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
      // Resolve files: prefer --path ...; else [fileArg]; else .env
      const rawPaths: string[] =
        Array.isArray(opts.path) && opts.path.length
          ? (opts.path as string[])
          : [fileArg ?? ".env"];
      const paths = rawPaths.map((p) => path.resolve(process.cwd(), String(p)));

      // Scan each file and merge findings
      type FileResult = { file: string; findings: Finding[] };
      const perFile: FileResult[] = [];
      let findings: Finding[] = []; // aggregate across files for exit policy
      let anyCRLF = false;

      for (const p of paths) {
        const textForP = readFileSafe(p);
        if (textForP === null) {
          console.error(pc.red(`✖ Cannot read ${p}`));
          process.exit(2);
        }

        const { lines, hasCRLF } = parseEnv(textForP);
        anyCRLF = anyCRLF || hasCRLF;

 const extraFindings: Finding[] = [];
        if (hasCRLF) {
  extraFindings.push({
    line: 1,
    type: "crlf-detected",
    message: "CRLF line endings detected; LF is recommended for cross-env consistency",
  });
}


        // run analysis
        const { findings: fileFindings, fixes } = analyzeEnv(lines, {
          compareKeys,
          fix: Boolean(opts.fix),
        });

        // apply fixes per-file if requested
        if (opts.fix && fixes.length) {
          const after = applyFixes(lines, fixes);
          fs.writeFileSync(p, after.join("\n"), "utf8");
        }

        fileFindings.push(...extraFindings);
perFile.push({ file: p, findings: fileFindings });

        
      }

      // Outputs
      if (opts.json) {
        // Machine-friendly JSON for CI (one entry per file)
        console.log(JSON.stringify(perFile, null, 2));
      } else {
        // Human output per file
        for (const { file, findings: fset } of perFile) {
          const label = path.basename(file);
          if (fset.length === 0) {
            console.log(pc.green(`✔ ${label} looks good`));
          } else {
            console.log(pc.yellow(`⚠ Issues in ${label}:`));
            for (const f of fset) {
              const ln = f.line ? `:${f.line}` : "";
              console.log(
                `  ${pc.cyan(f.type)}${ln}${f.key ? ` (${f.key})` : ""}: ${f.message}`
              );
            }
          }
        }
      }

      // Write SARIF (combine all files into a single run)
      if (opts.sarif) {
        const pkgVersion = "v" + pkg.version;
        const outFile =
          typeof opts.sarif === "string" ? (opts.sarif as string) : "env-genie.sarif";

        // Build combined results and rules
const rulesMap = new Map<string, any>();
const results: any[] = [];

for (const { file, findings: fset } of perFile) {
  for (const f of fset) {
    if (!rulesMap.has(f.type)) {
      rulesMap.set(f.type, {
        id: f.type,
        shortDescription: { text: `env-genie rule: ${f.type}` },
        fullDescription: { text: `Finding of type '${f.type}' reported by env-genie.` },
        defaultConfiguration: { level: severityFor(f.type) },
        helpUri: `https://github.com/thegreatbey/env-genie/blob/main/docs/rules.md#${f.type}`
      });
    }

    results.push({
      ruleId: f.type,                         // <-- no ruleFor()
      level: severityFor(f.type),
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: path.relative(process.cwd(), file).replace(/\\/g, "/")
            },
            region: { startLine: Math.max(1, f.line ?? 1) }
          }
        }
      ],
      properties: f.key ? { key: f.key } : undefined
    });
  }
}

// Turn the map into an array for SARIF driver
const rules = Array.from(rulesMap.values());


        const sarif = {
          $schema: "https://json.schemastore.org/sarif-2.1.0.json",
          version: "2.1.0",
          runs: [
            {
              tool: {
                driver: {
                  name: "env-genie",
                  version: "v" + pkg.version,
                  rules,
                },
              },
              results,
            },
          ],
        };

        fs.writeFileSync(outFile, JSON.stringify(sarif, null, 2), "utf8");
        console.log(`Wrote SARIF to ${outFile}`);
      }

      // Exit policy (configurable) — uses aggregated `findings`
      const errorCount = findings.filter((f) => severityFor(f.type) === "error").length;
      const warningCount = findings.filter((f) => severityFor(f.type) === "warning").length;

      const optsAny: any = opts; // Commander types
      let exitCode = 0;
      if (!optsAny.exitZero) {
        const failOnWarning = optsAny.failOn === "warning";
        const breachByLevel = failOnWarning
          ? warningCount > 0 || errorCount > 0
          : errorCount > 0;
        const overError =
          Number.isFinite(optsAny.maxErrors) && errorCount > Number(optsAny.maxErrors);
        const overWarn =
          Number.isFinite(optsAny.maxWarnings) && warningCount > Number(optsAny.maxWarnings);
        if (breachByLevel || overError || overWarn) exitCode = 1;
      }
      process.exit(exitCode);

    });

  program.parse(process.argv);
}

main();