"""The DOCX lock's oracle (locked review copy, design 2026-11-06, task 2): msoffcrypto-tool decrypts an
ECMA-376 Agile-encrypted file with a password.

    python docx-decrypt.py IN OUT PASSWORD   decrypt IN to OUT; exit 0, or 1 if it cannot (wrong password,
                                             a failed integrity check, not an encrypted file)
    python docx-decrypt.py --no-verify IN OUT PASSWORD
                                             the same, with neither the verifier nor the HMAC checked: only the
                                             key derivation and the segments (msoffcrypto-tool 6.1.0 compares the
                                             block-padded verifier hash and HMAC with the hash itself, so it refuses
                                             every SHA-1 Agile file when verifying; opening locked files on import,
                                             design 2026-11-10, task 1)
    python docx-decrypt.py --probe           print the msoffcrypto-tool version; exit 0

Both exit 3 and print "SKIPPED: msoffcrypto-tool not installed" when the tool is missing. Run it with the
interpreter of the venv beside it (studio/e2e/oracles/.venv, gitignored), which is where the tool is installed:

    /c/Python314/python -m venv studio/e2e/oracles/.venv
    studio/e2e/oracles/.venv/Scripts/python -m pip install msoffcrypto-tool

The password is checked against the file's verifier (verify_password) and the package against its dataIntegrity
HMAC (verify_integrity), so a file whose HMAC is wrong does not open here. The password is never printed.
"""
import sys

try:
    import msoffcrypto
    from importlib.metadata import version
except ImportError:
    print("SKIPPED: msoffcrypto-tool not installed")
    sys.exit(3)


def main(argv):
    if len(argv) == 2 and argv[1] == "--probe":
        print("msoffcrypto-tool " + version("msoffcrypto-tool"))
        return 0
    verify = True
    if len(argv) == 5 and argv[1] == "--no-verify":
        verify = False
        argv = argv[:1] + argv[2:]
    if len(argv) != 4:
        print("usage: docx-decrypt.py [--no-verify] IN OUT PASSWORD | --probe", file=sys.stderr)
        return 2
    src, dst, password = argv[1], argv[2], argv[3]
    try:
        with open(src, "rb") as f:
            office = msoffcrypto.OfficeFile(f)
            if not office.is_encrypted():
                print("FAILED: not an encrypted file", file=sys.stderr)
                return 1
            office.load_key(password=password, verify_password=verify)
            with open(dst, "wb") as out:
                office.decrypt(out, verify_integrity=verify)
    except Exception as e:  # any refusal is a failure; its type names why, never the password
        print("FAILED: " + type(e).__name__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
