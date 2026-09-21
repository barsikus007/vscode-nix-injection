{
  lib ? null,
  pkgs ? null,
  runCommand ? null,
  runTest ? null,
  testers ? null,
  writeShellApplication ? null,
  writeShellScriptBin ? null,
}:
{
  shellCodeFine = /* bash */ ''
    echo "fine"
    exit_zsh() { exit; }
    echo "fine"
  '';
  shellTrailingAmpersand = /* shell */ ''
    (
      echo "subshell"
    ) 9>&- &
  '';
  shellInterpolatedString = /* shell */ ''
    echo "start"
    ${lib.optionalString true ''
      echo "inside"
    ''}
    echo "end"
  '';
  sqlQuery = /* sql */ "SELECT * FROM users WHERE id = $1";
  regularCommentedString # nothing here
    = "nothing here too";
  # commentedInjection = /* bash */ '' echo should-not-highlight '';
  # blockCommentedInjection = /* bash
  # '' echo also-not ''
  preFixup = ''
    echo attr-lookbehind
  '';
  postInstall = "echo attr-double";
  phases = ''
    echo attr-negative
  '';
  drv = writeShellScriptBin "demo" ''
    echo func-write
  '';
  pyd = pkgs.writers.writePython3Bin "demo" { } ''
    print("func-python")
  '';
  js = pkgs.writers.writeJSBin "demo" { } ''
    console.log("func-js")
  '';
  rs = pkgs.writers.writeRustBin "demo" { } ''
    fn main() { println!("func-rust"); }
  '';
  re = builtins.match "a(.*)b" "acb";
  runCmd = runCommand "demo" { } ''
    echo func-negative
  '';
  wshApp = writeShellApplication {
    name = "demo";
    runtimeInputs = [ pkgs.curl ];
    text = ''
      echo wsh-text
    '';
  };
  test = testers.nixosTest {
    name = "demo";
    nodes.machine =
      { pkgs, ... }:
      {
        environment.systemPackages = [ pkgs.hello ];
      };
    testScript = ''
      machine.wait_for_unit("multi-user.target")
    '';
  };
  test2 = runTest {
    testScript = "print(1)";
  };
  plugins = [
    {
      plugin = null;
      type = "lua";
      config = ''
        require("demo").setup()
      '';
    }
    {
      config = "plain config";
      type = "viml";
    }
    {
      config = "plain order";
      type = "lua";
    }
  ];
  after = ''
    plain after regions
  '';
}
