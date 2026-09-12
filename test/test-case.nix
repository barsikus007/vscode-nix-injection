{
  pkgs ? null,
  writeShellScriptBin ? null,
  runCommand ? null,
}:
{
  shellCodeFine = /* bash */ ''
    echo "fine"
    exit_zsh() { exit; }
    echo "fine"
  '';
  sqlQuery = /* sql */ "SELECT * FROM users WHERE id = $1";
  regularCommentedString /* nothing here */ = "nothing here too";
  # commentedInjection = /* bash */ '' echo should-not-highlight '';
  /* blockCommentedInjection = /* bash */ /* '' echo also-not '' */
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
}
