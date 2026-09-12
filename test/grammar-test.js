#!/usr/bin/env bun
// Tokenize test.nix through the injection grammar and print scopes per token.
// Used to verify that embedded-language blocks do not leak past the closing ''.
//
// Usage:
//   bun run test                  # runs against ../test-case.nix
//   bun test/grammar-test.js FILE # tokenize a custom file
//
// Override grammar paths via env vars if auto-detection fails:
//   NIX_GRAMMAR=/path/to/nix.tmLanguage.json
//   SHELL_GRAMMAR=/path/to/shell-unix-bash.tmLanguage.json

const vsctm = require("vscode-textmate");
const oniguruma = require("vscode-oniguruma");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const INJ = path.join(PROJECT_ROOT, "syntaxes", "nix-inline-injection.tmLanguage.json");

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findGlob(dir, pattern) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => pattern.test(name))
      .map((name) => path.join(dir, name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function findNixGrammar() {
  if (process.env.NIX_GRAMMAR) return process.env.NIX_GRAMMAR;
  const extDirs = [
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".vscode-oss", "extensions"),
    path.join(os.homedir(), ".vscode-server", "extensions"),
  ];
  for (const dir of extDirs) {
    for (const candidate of findGlob(dir, /^jnoortheen\.nix-ide-/)) {
      const p = path.join(candidate, "dist", "nix.tmLanguage.json");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function findVscodeExtensionsDir() {
  const candidates = [
    "/Applications/Visual Studio Code.app/Contents/resources/app/extensions",
    "/usr/share/code/resources/app/extensions",
    "/usr/share/code-oss/resources/app/extensions",
    "/opt/visual-studio-code/resources/app/extensions",
    "/snap/code/current/usr/share/code/resources/app/extensions",
  ];
  // Search /nix/store for a vscode install (NixOS)
  try {
    for (const entry of fs.readdirSync("/nix/store")) {
      if (/-vscode-/.test(entry)) {
        candidates.push(`/nix/store/${entry}/lib/vscode/resources/app/extensions`);
      }
    }
  } catch {
    /* not on NixOS */
  }
  return firstExisting(candidates);
}

// map scopeName -> grammar file for every built-in VSCode grammar, so rules
// for python/js/rust/... do not get silently dropped when the include resolves
function collectBuiltinGrammars(extDir) {
  const scopes = {};
  if (!extDir) return scopes;
  for (const ext of fs.readdirSync(extDir)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(extDir, ext, "package.json"), "utf8"));
    } catch {
      continue;
    }
    for (const g of (pkg.contributes && pkg.contributes.grammars) || []) {
      if (g.scopeName && g.path && !scopes[g.scopeName]) {
        scopes[g.scopeName] = path.join(extDir, ext, g.path);
      }
    }
  }
  return scopes;
}

const NIX = findNixGrammar();
const BUILTIN = collectBuiltinGrammars(findVscodeExtensionsDir());
if (process.env.SHELL_GRAMMAR) BUILTIN["source.shell"] = process.env.SHELL_GRAMMAR;
const SHELL = BUILTIN["source.shell"];

if (!NIX) {
  console.error("Could not locate nix.tmLanguage.json (set NIX_GRAMMAR env var).");
  process.exit(1);
}
if (!SHELL) {
  console.error("Could not locate shell-unix-bash.tmLanguage.json (set SHELL_GRAMMAR env var).");
  process.exit(1);
}

const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
const wasmBin = fs.readFileSync(wasmPath).buffer;
const onigLib = oniguruma.loadWASM(wasmBin).then(() => ({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const registry = new vsctm.Registry({
  onigLib,
  loadGrammar: (scopeName) => {
    let p = null;
    if (scopeName === "source.nix") p = NIX;
    else if (scopeName === "nix.inline-injection") p = INJ;
    else p = BUILTIN[scopeName] || null;
    if (!p) return null;
    return Promise.resolve(vsctm.parseRawGrammar(fs.readFileSync(p).toString(), p));
  },
  getInjections: (scopeName) => (scopeName === "source.nix" ? ["nix.inline-injection"] : []),
});

const inputFile = process.argv[2] || path.join(PROJECT_ROOT, "test/test-case.nix");
const text = fs.readFileSync(inputFile, "utf-8");
const lines = text.split("\n");

(async () => {
  await onigLib;
  // compile every injection regex up front: rules whose include does not
  // resolve are dropped silently, which would hide a broken begin/end pattern
  const rawInj = JSON.parse(fs.readFileSync(INJ, "utf8"));
  const regexes = Object.values(rawInj.repository).flatMap((r) => [r.begin, r.end].filter(Boolean));
  try {
    new oniguruma.OnigScanner(regexes);
  } catch (e) {
    console.error(`Invalid regex in ${path.basename(INJ)}: ${String(e).split("\n")[0]}`);
    process.exit(1);
  }
  const grammar = await registry.loadGrammar("source.nix");
  let ruleStack = vsctm.INITIAL;
  let leaked = false;
  const closingEnds = [];
  for (let i = 0; i < lines.length; i++) {
    const r = grammar.tokenizeLine(lines[i], ruleStack);
    console.log(`L${i + 1}: ${JSON.stringify(lines[i])}`);
    for (const t of r.tokens) {
      const slice = lines[i].slice(t.startIndex, t.endIndex);
      const compact = t.scopes.filter((s) => s !== "source.nix").join("|") || "(top)";
      console.log(
        `  [${t.startIndex}-${t.endIndex}] ${JSON.stringify(slice).padEnd(25)} ${compact}`,
      );
      if (slice.trim() === "''" && t.scopes.includes("punctuation.definition.string.end.nix")) {
        closingEnds.push(i + 1);
      }
      // Heuristic leak detection: meta.embedded scope present on non-embedded source after the closing ''
      if (
        t.scopes.some((s) => s.startsWith("meta.embedded")) &&
        slice.includes("shellCodeEscapes")
      ) {
        leaked = true;
      }
    }
    ruleStack = r.ruleStack;
  }
  console.log("\nSummary:");
  console.log(`  Closing '' tokens at lines: ${closingEnds.join(", ") || "(none)"}`);
  console.log(`  Embedded scope leaked past block: ${leaked ? "YES (regression)" : "no"}`);
  if (leaked) process.exit(1);
})();
