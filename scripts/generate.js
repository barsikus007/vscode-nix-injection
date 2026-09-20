#!/usr/bin/env bun
// Regenerates syntaxes/nix-inline-injection.tmLanguage.json and the
// `embeddedLanguages` field of package.json from languages.json.
// All other package.json fields are preserved as-is.
//
// languages.json is the single source of truth — it is also read by flake.nix
// (via builtins.fromJSON). Each entry has:
//   key      — short id used in repository keys and `meta.embedded.block.<key>`
//   triggers — comment markers accepted between `/*` and `*/`
//   scope    — TextMate scope name of the target grammar (e.g. "source.python")
//   langId   — VSCode language id used for the embeddedLanguages map

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LANGUAGES = JSON.parse(fs.readFileSync(path.join(ROOT, "languages.json"), "utf8"));

const RE_META_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = (s) => s.replace(RE_META_ESCAPE, "\\$&");
const triggerAlt = (triggers) => {
  const parts = triggers.map(escapeRegex);
  return parts.length === 1 ? parts[0] : `(?:${parts.join("|")})`;
};

const BEGIN_CAPS = {
  1: { name: "comment.block.nix" },
  2: { name: "punctuation.definition.string.begin.nix" },
};
const END_CAPS = {
  1: { name: "punctuation.definition.string.end.nix" },
};
const MULTI_END = "^([ \\t]*'')(?![\\$'\\\\])";
const DOUBLE_END = '(?<!\\\\)(")';

const makeMultiPatterns = (scope, key) => [
  {
    begin: "(^|\\G)",
    while: "(^|\\G)(?![ \\t]*''(?!['$\\\\]))",
    contentName: `meta.embedded.block.${key}`,
    patterns: [{ include: scope }],
  },
];

function makeMulti(lang) {
  const trig = triggerAlt(lang.triggers);
  return {
    begin: `(/\\*\\s*${trig}\\s*\\*/)\\s*('')`,
    beginCaptures: BEGIN_CAPS,
    end: MULTI_END,
    endCaptures: END_CAPS,
    patterns: makeMultiPatterns(lang.scope, lang.key),
  };
}

function makeDouble(lang) {
  const trig = triggerAlt(lang.triggers);
  return {
    begin: `(/\\*\\s*${trig}\\s*\\*/)\\s*(")`,
    beginCaptures: BEGIN_CAPS,
    end: DOUBLE_END,
    endCaptures: END_CAPS,
    contentName: `meta.embedded.block.${lang.key}`,
    patterns: [{ include: lang.scope }],
  };
}

const repository = {};
for (const lang of LANGUAGES) {
  repository[`${lang.key}-multi`] = makeMulti(lang);
  repository[`${lang.key}-double`] = makeDouble(lang);
}

const patterns = [];
for (const lang of LANGUAGES) {
  patterns.push({ include: `#${lang.key}-multi` });
  patterns.push({ include: `#${lang.key}-double` });
}

// context-based triggers by attribute or function name, mirrors the nix
// injection queries of nvim-treesitter:
// https://github.com/nvim-treesitter/nvim-treesitter/blob/main/runtime/queries/nix/injections.scm
// limits vs treesitter: trigger and string opener must stay on one line and
// only a flat { } argument is allowed in between; a string after the attrset
// argument (runCommand) stays comment-triggered, strings nested inside the
// attrset argument are handled by the region rules below
const OPEN_CAPS = {
  1: { name: "punctuation.definition.string.begin.nix" },
};
const scopeByKey = Object.fromEntries(LANGUAGES.map((l) => [l.key, l.scope]));

const IDENT_TAIL = "[A-Za-z0-9_'-]*";
// nixpkgs phase attrs from the treesitter query: ^%a+Phase$, ^pre%a+$, ^post%a+$, ^script$
const ATTR_SHELL = "(?:(?:pre|post)[A-Za-z]+|[A-Za-z]+Phase|script)";
const NAME_STR = '"(?:[^"\\\\]|\\\\.)*"';

// writeFoo "name" [flatAttrset] <string> — the pkgs.writers family takes a
// mandatory attrset after the name, trivial-builders writers take none
const FUNC_RULES = [
  { key: "shell", func: "write(?:ShellScript|Bash|Dash)" },
  { key: "fish", func: "writeFish" },
  { key: "haskell", func: "writeHaskell" },
  { key: "javascript", func: "writeJS" },
  { key: "perl", func: "writePerl" },
  { key: "python", func: "writePy" },
  { key: "rust", func: "writeRust" },
];
// builtins.match and friends: the first argument is the regex
const DIRECT_FUNC_RULES = [{ key: "regex", func: "[A-Za-z]*match" }];

function addContextRules(repoKey, key, lookbehind, includeDouble = true) {
  const scope = scopeByKey[key];
  repository[`${repoKey}-multi`] = {
    begin: `${lookbehind}('')`,
    beginCaptures: OPEN_CAPS,
    end: MULTI_END,
    endCaptures: END_CAPS,
    patterns: makeMultiPatterns(scope, key),
  };
  patterns.push({ include: `#${repoKey}-multi` });

  if (includeDouble) {
    repository[`${repoKey}-double`] = {
      begin: `${lookbehind}(")`,
      beginCaptures: OPEN_CAPS,
      end: DOUBLE_END,
      endCaptures: END_CAPS,
      contentName: `meta.embedded.block.${key}`,
      patterns: [{ include: scope }],
    };
    patterns.push({ include: `#${repoKey}-double` });
  }
}

// shell attributes only auto-inject into multiline strings (''...''); single-line
// double-quoted strings ("...") easily swallow the closing quote because bash
// statement boundaries do not end on double quotes within a single line
addContextRules("shell-attr", "shell", `(?<=\\b${ATTR_SHELL}\\s*=\\s*)`, false);
for (const { key, func } of FUNC_RULES) {
  addContextRules(
    `${key}-func`,
    key,
    `(?<=\\b${func}${IDENT_TAIL}\\s+${NAME_STR}(?:\\s*\\{[^{}]*\\})?\\s*)`,
  );
}
for (const { key, func } of DIRECT_FUNC_RULES) {
  addContextRules(`${key}-func-direct`, key, `(?<=\\b${func}\\s+)`);
}

// region-based triggers for strings nested inside an attrset argument, also
// from the treesitter queries: runTest/nixosTest testScript,
// writeShellApplication text, home-manager type="lua" + config
// the regions own the outer braces (hm-lua closes zero-width before the base
// grammar's brace) and re-include source.nix inside, so nested attrsets stay
// balanced and the rest of the block keeps normal highlighting; the inner
// attr rules consume the attr name to win the tie against the bind rule of
// the included grammar and only fire while the region is open
const ATTR_NAME_SCOPE = "entity.other.attribute-name.multipart.nix";
const BIND_OP_SCOPE = "keyword.operator.bind.nix";
const STR_BEGIN_SCOPE = "punctuation.definition.string.begin.nix";
const NOT_IDENT_CHAR = "(?<![A-Za-z0-9_'.-])";

function addRegionAttrRules(repoKey, key, attr) {
  const scope = scopeByKey[key];
  repository[`${repoKey}-multi`] = {
    begin: `${NOT_IDENT_CHAR}(${attr})(\\s*)(=)(\\s*)('')`,
    beginCaptures: {
      1: { name: ATTR_NAME_SCOPE },
      3: { name: BIND_OP_SCOPE },
      5: { name: STR_BEGIN_SCOPE },
    },
    end: MULTI_END,
    endCaptures: END_CAPS,
    patterns: makeMultiPatterns(scope, key),
  };
  repository[`${repoKey}-double`] = {
    begin: `${NOT_IDENT_CHAR}(${attr})(\\s*)(=)(\\s*)(")`,
    beginCaptures: {
      1: { name: ATTR_NAME_SCOPE },
      3: { name: BIND_OP_SCOPE },
      5: { name: STR_BEGIN_SCOPE },
    },
    end: DOUBLE_END,
    endCaptures: END_CAPS,
    contentName: `meta.embedded.block.${key}`,
    patterns: [{ include: scope }],
  };
  return [{ include: `#${repoKey}-multi` }, { include: `#${repoKey}-double` }];
}

const FUNC_REGION_CAPS = {
  1: { name: "variable.parameter.name.nix" },
  3: { name: "punctuation.definition.attrset.nix" },
};
const BRACE_CAP = { 1: { name: "punctuation.definition.attrset.nix" } };

// the included grammar scopes bindings properly only inside its own attrset
// context, which the region replaces, so the region replicates the binding
// shell (name, =, ;) itself and delegates values to the included grammar
const TERMINATOR_MIMIC = { match: "(;)", name: "punctuation.terminator.bind.nix" };
const BIND_MIMIC = {
  begin: `${NOT_IDENT_CHAR}([\\w.'-]+)(\\s*)(=)`,
  beginCaptures: {
    1: { name: ATTR_NAME_SCOPE },
    3: { name: BIND_OP_SCOPE },
  },
  end: "(;)",
  endCaptures: { 1: { name: "punctuation.terminator.bind.nix" } },
  patterns: [{ include: "source.nix" }],
};
const regionPatterns = (innerRules) => [
  ...innerRules,
  TERMINATOR_MIMIC,
  BIND_MIMIC,
  { include: "source.nix" },
];

function addFuncRegion(repoKey, func, innerRules) {
  repository[repoKey] = {
    begin: `\\b(${func})(\\s*)(\\{)`,
    beginCaptures: FUNC_REGION_CAPS,
    end: "(\\})",
    endCaptures: BRACE_CAP,
    patterns: regionPatterns(innerRules),
  };
  patterns.push({ include: `#${repoKey}` });
}

addFuncRegion("nixostest-region", "nixosTest|runTest", addRegionAttrRules("testscript", "python", "testScript"));
addFuncRegion("wshapp-region", "writeShellApplication", addRegionAttrRules("wsh-text", "shell", "text"));

// home-manager neovim plugin spec: opens on type = "lua" inside a base-owned
// attrset and closes zero-width before its }, which stays with the base
// grammar; a config placed before the type stays plain, same as in the
// treesitter query
repository["hm-lua-region"] = {
  begin: `${NOT_IDENT_CHAR}(type)(\\s*)(=)(\\s*)("lua")`,
  beginCaptures: {
    1: { name: ATTR_NAME_SCOPE },
    3: { name: BIND_OP_SCOPE },
    5: { name: "string.quoted.double.nix" },
  },
  end: "(?=\\})",
  patterns: regionPatterns(addRegionAttrRules("hm-config", "lua", "config")),
};
patterns.push({ include: "#hm-lua-region" });

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  scopeName: "nix.inline-injection",
  injectionSelector: "L:source.nix - comment - string",
  patterns,
  repository,
};

// Custom serializer: keeps leaf objects/arrays on one line when short to mirror
// the readable layout of the hand-written original.
const INLINE_MAX = 120;
function fmt(value, depth = 0) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const parts = value.map((v) => fmt(v, depth + 1));
    const inline = "[" + parts.join(", ") + "]";
    if (inline.length <= INLINE_MAX && !parts.some((p) => p.includes("\n"))) return inline;
    return "[\n" + parts.map((p) => inner + p).join(",\n") + "\n" + pad + "]";
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const hasNested = keys.some((k) => value[k] !== null && typeof value[k] === "object");
  if (!hasNested) {
    const inline =
      "{ " + keys.map((k) => JSON.stringify(k) + ": " + JSON.stringify(value[k])).join(", ") + " }";
    if (inline.length <= INLINE_MAX) return inline;
  }
  const parts = keys.map((k) => inner + JSON.stringify(k) + ": " + fmt(value[k], depth + 1));
  return "{\n" + parts.join(",\n") + "\n" + pad + "}";
}

const grammarPath = path.join(ROOT, "syntaxes", "nix-inline-injection.tmLanguage.json");
fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
fs.writeFileSync(grammarPath, fmt(grammar) + "\n");
console.log(`wrote ${path.relative(ROOT, grammarPath)}`);

// Patch only the embeddedLanguages map in package.json; preserve everything else.
const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const embeddedLanguages = {};
for (const lang of LANGUAGES) {
  embeddedLanguages[`meta.embedded.block.${lang.key}`] = lang.langId;
}
const grammars = pkg.contributes && pkg.contributes.grammars;
if (!grammars || !grammars[0]) {
  console.error("package.json: contributes.grammars[0] not found");
  process.exit(1);
}
grammars[0].embeddedLanguages = embeddedLanguages;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`updated ${path.relative(ROOT, pkgPath)} (embeddedLanguages)`);
