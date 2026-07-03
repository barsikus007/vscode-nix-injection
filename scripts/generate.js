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

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LANGUAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'languages.json'), 'utf8'));

const RE_META_ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = s => s.replace(RE_META_ESCAPE, '\\$&');
const triggerAlt = triggers => {
    const parts = triggers.map(escapeRegex);
    return parts.length === 1 ? parts[0] : `(?:${parts.join('|')})`;
};

const BEGIN_CAPS = {
    '1': { name: 'comment.block.nix' },
    '2': { name: 'punctuation.definition.string.begin.nix' },
};
const END_CAPS = {
    '1': { name: 'punctuation.definition.string.end.nix' },
};
const MULTI_END = "^([ \\t]*'')(?![\\$'\\\\])";
const DOUBLE_END = '(?<!\\\\)(")';

function makeMulti(lang) {
    const trig = triggerAlt(lang.triggers);
    return {
        begin: `(/\\*\\s*${trig}\\s*\\*/)\\s*('')`,
        beginCaptures: BEGIN_CAPS,
        end: MULTI_END,
        endCaptures: END_CAPS,
        contentName: `meta.embedded.block.${lang.key}`,
        patterns: [{ include: lang.scope }],
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

const grammar = {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    scopeName: 'nix.inline-injection',
    injectionSelector: 'L:source.nix - comment - string',
    patterns,
    repository,
};

// Custom serializer: keeps leaf objects/arrays on one line when short to mirror
// the readable layout of the hand-written original.
const INLINE_MAX = 120;
function fmt(value, depth = 0) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const pad = '  '.repeat(depth);
    const inner = '  '.repeat(depth + 1);
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const parts = value.map(v => fmt(v, depth + 1));
        const inline = '[' + parts.join(', ') + ']';
        if (inline.length <= INLINE_MAX && !parts.some(p => p.includes('\n'))) return inline;
        return '[\n' + parts.map(p => inner + p).join(',\n') + '\n' + pad + ']';
    }
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const hasNested = keys.some(k => value[k] !== null && typeof value[k] === 'object');
    if (!hasNested) {
        const inline = '{ ' + keys.map(k => JSON.stringify(k) + ': ' + JSON.stringify(value[k])).join(', ') + ' }';
        if (inline.length <= INLINE_MAX) return inline;
    }
    const parts = keys.map(k => inner + JSON.stringify(k) + ': ' + fmt(value[k], depth + 1));
    return '{\n' + parts.join(',\n') + '\n' + pad + '}';
}

const grammarPath = path.join(ROOT, 'syntaxes', 'nix-inline-injection.tmLanguage.json');
fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
fs.writeFileSync(grammarPath, fmt(grammar) + '\n');
console.log(`wrote ${path.relative(ROOT, grammarPath)}`);

// Patch only the embeddedLanguages map in package.json; preserve everything else.
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const embeddedLanguages = {};
for (const lang of LANGUAGES) {
    embeddedLanguages[`meta.embedded.block.${lang.key}`] = lang.langId;
}
const grammars = pkg.contributes && pkg.contributes.grammars;
if (!grammars || !grammars[0]) {
    console.error('package.json: contributes.grammars[0] not found');
    process.exit(1);
}
grammars[0].embeddedLanguages = embeddedLanguages;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`updated ${path.relative(ROOT, pkgPath)} (embeddedLanguages)`);
