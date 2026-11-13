#!/usr/bin/env bash
#
# Check the AsciiDoc validity of the .adoc files of the repository.
#
# Every file is processed by asciidoctor in verbose mode:
#   - `-v` lowers the log level to DEBUG, which enables the validation of
#     the internal cross references during the conversion;
#   - `--failure-level=INFO` makes asciidoctor exit with a non-zero code
#     as soon as any message is logged, including the INFO-level
#     "possible invalid reference" messages emitted for dead cross
#     references (they are INFO, not WARNING, as of asciidoctor 2.0.x);
#   - `-o` must point to a real file: with /dev/null, asciidoctor only
#     parses the document without converting it, so no cross reference
#     validation ever happens (silent false negative).
#
# Exit codes:
#   0: all files valid
#   1: at least one file invalid
#   2: environment error (asciidoctor not found, not a git repository, ...)
#
# Requires asciidoctor >= 1.5.7 (for the --failure-level option).
# The asciidoctor binary may be overridden with the ASCIIDOCTOR variable.
#
# Usage:
#   scripts/check-asciidoc.sh [FILE...]
#
# Without argument, all the .adoc files of the repository are checked
# (tracked and untracked, but not ignored).

set -euo pipefail

# Minimum log level that makes asciidoctor fail.
# INFO catches the "possible invalid reference" messages
# emitted for dead cross references.
readonly FAILURE_LEVEL=INFO

usage() {
	echo "Usage: scripts/check-asciidoc.sh [FILE...]"
	echo ""
	echo "Check the AsciiDoc validity of the given .adoc files,"
	echo "or of all the .adoc files of the repository without argument."
}

case "${1:-}" in
-h|--help)
	usage
	exit 0
	;;
esac

# --- asciidoctor discovery ------------------------------------------------

if [[ -n "${ASCIIDOCTOR:-}" ]]; then
	asciidoctor="${ASCIIDOCTOR}"
else
	asciidoctor="$(command -v asciidoctor || true)"
	if [[ -z "${asciidoctor}" ]]; then
		echo "error: asciidoctor not found." >&2
		echo "hint: install it with: gem install asciidoctor" >&2
		echo "hint: or set the ASCIIDOCTOR environment variable" >&2
		exit 2
	fi
fi

if ! "${asciidoctor}" --version >/dev/null 2>&1; then
	echo "error: cannot run asciidoctor: ${asciidoctor}" >&2
	exit 2
fi

# --- files discovery --------------------------------------------------------

if [[ $# -gt 0 ]]; then
	files=("$@")
else
	if ! root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
		echo "error: not a git repository, and no file given." >&2
		usage >&2
		exit 2
	fi
	mapfile -t files < <(git -C "${root}" ls-files --cached --others --exclude-standard -- '*.adoc')
	for i in "${!files[@]}"; do
		files[i]="${root}/${files[i]}"
	done
fi

if [[ ${#files[@]} -eq 0 ]]; then
	echo "No .adoc file to check."
	exit 0
fi

# --- checks -----------------------------------------------------------------

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

version="$("${asciidoctor}" --version 2>/dev/null || true)"
echo "Checking with ${version%%$'\n'*}"
echo

status=0
for file in "${files[@]}"; do
	if [[ ! -f "${file}" ]]; then
		echo "FAIL ${file} (file not found)"
		status=1
		continue
	fi

	log="${tmpdir}/asciidoctor.log"
	# NOTE: -o must point to a real file, not /dev/null:
	# asciidoctor skips the conversion with /dev/null,
	# and the cross reference validation with it.
	if "${asciidoctor}" \
		-v \
		--failure-level="${FAILURE_LEVEL}" \
		-o "${tmpdir}/output.html" \
		"${file}" \
		>/dev/null 2> "${log}"
	then
		echo "ok   ${file}"
	else
		echo "FAIL ${file}"
		sed 's/^/     /' "${log}"
		status=1
	fi
done

echo
if [[ "${status}" -eq 0 ]]; then
	echo "OK: ${#files[@]} .adoc file(s) valid."
else
	echo "KO: some .adoc file(s) are invalid." >&2
fi

exit "${status}"
