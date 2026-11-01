---
name: safe-source-edit
description: Edit C++/JS/TS/JSON source that contains backslashes (\n, \", \\, regexes, Windows paths) without a Python heredoc or sed turning them into real characters. Use before any scripted edit, patch, or generated test whose text holds a backslash, and when a build suddenly reports "newline in string literal".
---

# Editing source that contains backslashes

A shell heredoc, `sed -i` or `python - <<EOF` one-liner reads `\n`, `\"`, `\\` and `\'` itself. The file then gets a real newline, a bare quote or a lost backslash: broken string literals (`C2001`, `unterminated string literal`), broken regexes, ruined Windows paths. It has happened many times in this repo.

## Choose the tool in this order

1. **Edit tool.** Anything that changes a few lines, tests included. It writes the text as given. Default choice.
2. **Write tool, then run the file.** When a script is really needed (many files, JSON rewrite, measuring): save it as `.omc/tmp/<name>.py` with Write, run `python .omc/tmp/<name>.py`. Nothing in between touches the escapes.
3. **A heredoc only when the text has no backslash at all.** If it must hold one, use a quoted delimiter (`<<'EOF'`) and still prefer 2.

Never use `sed -i` with a replacement that contains `\n`, `\t`, `\\` or a quote that needs escaping.

## Inside a Python script written to a file

- Use raw strings for anything with backslashes: `r"..."`. Triple-quoted raw strings (`r"""..."""`) for multi-line patches.
- To get one backslash without writing it, use `BS = chr(92)` and build the text from it. A literal `'\'` is a syntax error; `'\\'` is one backslash.
- Read text that carries backslashes from a file (`open(p, encoding="utf-8").read()`), do not re-type it.
- Assert the anchor is present before replacing: `assert old in s`. A silent no-op is worse than an error.
- Keep line endings. Read and write with `newline=""`, or check `file <path>` afterwards: a file that was LF must stay LF. `git show <rev>:<path> > <path>` on Windows can leave CRLF (check `git diff --stat`: a diff of every line means line endings changed; fix with `sed -i 's/\r$//'`).
- JSON: load, change, dump with `ensure_ascii=False, indent=2`, `newline="\n"`, and end the file with a newline.

## Windows specifics

- `subprocess.run([exe])` needs an absolute path (`os.path.abspath`); in bash pass `$(pwd -W)/...`.
- Japanese text through stdin of a Python child raises `UnicodeEncodeError`: write the text to a UTF-8 file and open it.
- Console output of Japanese is garbled in the tool result (cp932): print `s.encode("unicode_escape").decode()` to read it.

## After the edit

- Rebuild the target that owns the file and grep the build output for ` error `.
- `git diff --stat`: the line count should match the change you meant. A diff far larger than the edit points at line endings or an escape accident.
- `git diff` once on the changed literals: every `\n` that should stay an escape still shows as the two characters `\n`.
