{
  description = "VSCode extension: Nix Comment-based Language Injection";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib;
        bunPkg = builtins.fromJSON (builtins.readFile ./package.json);
        vsixName = "${bunPkg.name}-${bunPkg.version}.vsix";

        meta = {
          description = bunPkg.description;
          homepage = bunPkg.homepage;
          license = lib.licenses.mit;
          platforms = lib.platforms.all;
        };

        nixSnowflake = pkgs.fetchurl {
          url = "https://raw.githubusercontent.com/NixOS/nixos-artwork/master/logo/nix-snowflake-colours.svg";
          sha256 = "1cifj774r4z4m856fva1mamnpnhsjl44kw3asklrc57824f5lyz3";
        };

        bashLogo = pkgs.fetchurl {
          url = "https://raw.githubusercontent.com/odb/official-bash-logo/master/assets/Logos/Icons/PNG/256x256.png";
          sha256 = "0wz85g06kwfcidlxqsg99k1kvfxma55bbh6i4cy3mwwh82mghc9k";
        };

        icon = pkgs.runCommand "${bunPkg.name}-icon.png" {
          nativeBuildInputs = [ pkgs.librsvg pkgs.imagemagick ];
        } ''
          rsvg-convert -w 256 -h 256 ${nixSnowflake} -o nix.png
          magick nix.png \
            \( ${bashLogo} -resize 96x96 \) \
            -gravity center -composite \
            $out
        '';

        vsix = pkgs.stdenv.mkDerivation {
          pname = "${bunPkg.name}-vsix";
          inherit (bunPkg) version;
          src = lib.cleanSource ./.;

          nativeBuildInputs = with pkgs; [
            bun
            vsce
          ];

          buildPhase = /* shell */ ''
            runHook preBuild
            bun scripts/generate.js
            cp ${icon} icon.png
            HOME=$TMPDIR vsce package --no-dependencies --out ${vsixName}
            runHook postBuild
          '';

          installPhase = /* shell */ ''
            runHook preInstall
            mkdir -p $out
            cp ${vsixName} $out/
            runHook postInstall
          '';

          inherit meta;
        };
      in
      {
        packages = {
          inherit vsix icon;
          default = pkgs.vscode-utils.buildVscodeExtension {
            pname = bunPkg.name;
            inherit (bunPkg) version;
            src = "${vsix}/${vsixName}";
            vscodeExtUniqueId = "${bunPkg.publisher}.${bunPkg.name}";
            vscodeExtPublisher = bunPkg.publisher;
            vscodeExtName = bunPkg.name;
            inherit meta;
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            vsce
          ];
          shellHook = /* shell */ ''
            echo "Available commands:"
            echo "  bun install       - install dev dependencies (for tests)"
            echo "  bun run generate  - regenerate grammar + package.json from scripts/generate.js"
            echo "  bun run test      - tokenize test.nix and verify no scope leakage"
            echo "  vsce package      - build .vsix"
            echo "  vsce publish      - publish to VS Code Marketplace (after vsce login)"
            echo "  bunx ovsx publish - publish to Open VSX"
            echo "  nix build         - reproducible build via flake (output in ./result)"
          '';
        };
      }
    );
}
