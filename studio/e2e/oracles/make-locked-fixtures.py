"""The locked fixtures of "opening password-protected files on import" (design 2026-11-10, task 1).

    python make-locked-fixtures.py            write studio/test/fixtures/locked/*, then check each one opens

Run it with the interpreter of the oracle venv beside it (studio/e2e/oracles/.venv, gitignored), where
msoffcrypto-tool and pypdf are installed:

    studio/e2e/oracles/.venv/Scripts/python -m pip install msoffcrypto-tool==6.1.0 pypdf==5.1.0

The inputs are committed beside the outputs (test/importlock-inputs.test.ts writes them again with
BEUK_WRITE_LOCKED_INPUTS=1): plain.docx is 1.0's buildDocxBlob() output, plain.pdf is 1.0's pdfFixtureBytes(false).
Every output is third-party tool output: the DOCX files from msoffcrypto-tool's OOXMLFile.encrypt (ECMA-376 Agile,
AES-256 / SHA-512, spinCount 100000), the PDFs from pypdf's PdfWriter.encrypt. No byte is written by hand.

The passwords are the fixtures' own, written here and in the README; they are test passwords, not secrets. They are
never printed.
"""
import io
import os
import sys

import msoffcrypto
import pypdf
from importlib.metadata import version
from msoffcrypto.format.ooxml import OOXMLFile
from pypdf import PdfReader, PdfWriter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "test", "fixtures", "locked"))

PW = "correct horse"
PW_UNICODE = "pässwörd\U0001F600"  # pässwörd😀

DOCX = [
    ("agile-sha512.docx", PW),
    ("agile-unicode.docx", PW_UNICODE),
]
PDF = [
    # (name, user password, owner password, pypdf algorithm)
    ("rc4-128.pdf", PW, None, "RC4-128"),
    ("aes-128.pdf", PW, None, "AES-128"),
    ("aes-256.pdf", PW, None, "AES-256"),
    ("aes-256-unicode.pdf", PW_UNICODE, None, "AES-256"),
    ("owner-only.pdf", "", "owner", "AES-256"),
]


def read(name):
    with open(os.path.join(OUT, name), "rb") as f:
        return f.read()


def write(name, data):
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)


def make_docx(plain):
    for name, pw in DOCX:
        out = io.BytesIO()
        OOXMLFile(io.BytesIO(plain)).encrypt(pw, out)
        write(name, out.getvalue())
        # the check: msoffcrypto opens it again with the password verified and the HMAC checked, to the plain bytes
        office = msoffcrypto.OfficeFile(io.BytesIO(read(name)))
        assert office.is_encrypted(), name + " is not encrypted"
        office.load_key(password=pw, verify_password=True)
        back = io.BytesIO()
        office.decrypt(back, verify_integrity=True)
        assert back.getvalue() == plain, name + " does not decrypt to plain.docx"
        print("wrote " + name)


def make_pdf(plain):
    for name, user, owner, algorithm in PDF:
        w = PdfWriter(clone_from=PdfReader(io.BytesIO(plain)))
        w.encrypt(user_password=user, owner_password=owner, algorithm=algorithm)
        out = io.BytesIO()
        w.write(out)
        write(name, out.getvalue())
        # the check: pypdf reads it back as encrypted, and the user password opens it to the same three pages
        r = PdfReader(io.BytesIO(read(name)))
        assert r.is_encrypted, name + " is not encrypted"
        assert r.decrypt(user) != 0, name + " does not open with its user password"
        assert len(r.pages) == 3, name + " lost pages"
        assert "The Harbour" in r.pages[0].extract_text(), name + " lost its text"
        print("wrote " + name)


def main():
    print("msoffcrypto-tool " + version("msoffcrypto-tool") + ", pypdf " + pypdf.__version__)
    make_docx(read("plain.docx"))
    make_pdf(read("plain.pdf"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
