assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: $message"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    return 1
  fi
  echo "PASS: $message"
}
