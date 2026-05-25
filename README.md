# Nix Inline Code Highlighting

Highlights embedded languages inside Nix strings using a comment marker — analogous to `@injection.language` from nvim-treesitter, but for VSCode

Works alongside [jnoortheen.nix-ide](https://marketplace.visualstudio.com/items?itemName=jnoortheen.nix-ide)

## Example

```nix
{
  startScript = /* bash */ ''
    echo "hello"
    for f in *.txt; do
      cat "$f"
    done
  '';

  config = /* json */ ''
    { "port": 8080, "debug": true }
  '';

  query = /* sql */ "SELECT * FROM users WHERE id = $1";
}
```

The `/* lang */` marker goes immediately before the opening `''` or `"`. Highlighting applies to both multi-line (`''...''`) and single-line (`"..."`) Nix strings

## Supported languages

`bash`/`sh`/`shell`/`shellscript`, `python`/`py`, `javascript`/`js`, `typescript`/`ts`, `json`, `yaml`/`yml`, `toml`, `html`, `css`, `scss`/`sass`, `lua`, `ruby`/`rb`, `go`/`golang`, `rust`/`rs`, `cpp`/`c++`/`cxx`, `c`, `java`, `kotlin`/`kt`, `sql`/`postgresql`/`mysql`, `xml`, `markdown`/`md`, `dockerfile`, `nix`, `haskell`/`hs`, `php`, `perl`/`pl`, `powershell`/`ps1`/`pwsh`, `fish`, `zsh`, `regex`/`regexp`, `diff`/`patch`, `makefile`/`make`, `ini`/`conf`/`cfg`, `kdl`

For highlighting to work, the corresponding language must be known to VSCode — usually either built-in or installed via a third-party extension (e.g. `kdl-org.kdl` for KDL)

## Installation

- **Marketplace:** `ext install barsikus007.nix-injection`
- **Open VSX** (VSCodium / Cursor / Code-OSS): search for `nix-injection` in Extensions
- **From .vsix:** download the release from GitHub and `code --install-extension nix-injection-<version>.vsix`

## Development

```sh
bun install
bun run generate  # regenerate syntaxes/nix-inline-injection.tmLanguage.json from scripts/generate.js
bun run test      # tokenize test.nix via vscode-textmate
```

To add a new language — one entry in [languages.json](languages.json) (single source of truth for the generator and the nix flake), then `bun run generate`. Issues or PRs are welcomed!
