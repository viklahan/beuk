# Locked fixtures (opening password-protected files on import, design 2026-11-10)

Every locked file here is third-party tool output. None is hand-made.

## How they were made (2026-11-10, on the Legion)

```sh
cd studio
BEUK_WRITE_LOCKED_INPUTS=1 npx vitest run test/importlock-inputs.test.ts --maxWorkers=2   # the two plain inputs
PYTHONUTF8=1 e2e/oracles/.venv/Scripts/python e2e/oracles/make-locked-fixtures.py        # the locked outputs
```

The script checks each output as it writes it. Each DOCX must open again in msoffcrypto-tool, with the password
verified and the HMAC checked, to exactly `plain.docx`. Each PDF must open in pypdf with its user password, to three
pages that still read "The Harbour".

## Tool versions

- msoffcrypto-tool 6.1.0 (`msoffcrypto.format.ooxml.OOXMLFile.encrypt`: ECMA-376 Agile, AES-256-CBC, SHA-512,
  spinCount 100000), with olefile 0.47
- pypdf 5.1.0 (`PdfWriter.encrypt(..., algorithm=...)`), with cryptography 50.0.2
- Python 3.14, in the gitignored venv `studio/e2e/oracles/.venv`

## The inputs

| File | What it is |
|---|---|
| `plain.docx` | 1.0's own Word file: `buildDocxBlob()` over the first fixture book with sections (`test/importlock-inputs.test.ts`) |
| `plain.pdf` | 1.0's own import self-check PDF: `pdfFixtureBytes(false)` in `client/index.html` (three pages of Times text, a table, a picture) |

## The outputs and their passwords

| File | Made by | Lock | Password |
|---|---|---|---|
| `agile-sha512.docx` | msoffcrypto-tool | Agile 4.4, AES-256 / SHA-512 | `correct horse` |
| `agile-unicode.docx` | msoffcrypto-tool | Agile 4.4, AES-256 / SHA-512 | `pässwörd😀` (U+00E4, U+00F6, U+1F600) |
| `rc4-128.pdf` | pypdf `RC4-128` | /V 2 /R 3, 128-bit RC4 | user `correct horse` (owner the same) |
| `aes-128.pdf` | pypdf `AES-128` | /V 4 /R 4, AESV2 | user `correct horse` (owner the same) |
| `aes-256.pdf` | pypdf `AES-256` | /V 5 /R 6, AESV3 | user `correct horse` (owner the same) |
| `aes-256-unicode.pdf` | pypdf `AES-256` | /V 5 /R 6, AESV3 | user `pässwörd😀` (owner the same) |
| `owner-only.pdf` | pypdf `AES-256` | /V 5 /R 6, AESV3 | user empty, owner `owner` |

These are test passwords, not secrets.

Re-running the script makes new salts and keys, so the bytes change each time. Commit the inputs and outputs together.
