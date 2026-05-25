{
  shellCodeFine = /* bash */ ''
    echo "fine"
    exit_zsh() { exit; }
    echo "fine"
  '';
  shellCodeEscapes = /* bash */ ''
    echo "fine"
    exit_zsh() { exit }
    echo "escape"
  '';
  sqlQuery = /* sql */ "SELECT * FROM users WHERE id = $1";
  regularCommentedString /* nothing here */ = "nothing here too";
}
