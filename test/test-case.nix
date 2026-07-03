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
}
