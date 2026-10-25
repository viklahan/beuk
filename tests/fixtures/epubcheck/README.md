# EPUBCheck message bundle (test fixture)

`MessageBundle-5.2.1.properties` is `com/adobe/epubcheck/messages/MessageBundle.properties`
extracted unchanged from the bundled EPUBCheck 5.2.1 jar (`tools-bin/epubcheck.jar`,
`META-INF/maven/org.w3c/epubcheck/pom.properties` → `version=5.2.1`):

    unzip -p tools-bin/epubcheck.jar com/adobe/epubcheck/messages/MessageBundle.properties

`tests/help-content.test.ts` checks every EPUBCheck code and every EPUBCheck "says" line in
`content/help/errors.json` against it. To re-verify the copy against a jar:
`unzip -p tools-bin/epubcheck.jar com/adobe/epubcheck/messages/MessageBundle.properties | cmp - tests/fixtures/epubcheck/MessageBundle-5.2.1.properties`.

EPUBCheck is distributed under the BSD 3-clause licence reproduced in `LICENSE.txt`.

`broken-sample-report.json` is the unmodified `--json` report of a real EPUBCheck 5.2.1 run
(the bundled jar, in `eclipse-temurin:21-jre`, 2026-10-25) over the sample book's Amazon KDP
export with one closing `</p>` removed from `OEBPS/Text/chapter_01.xhtml` on purpose — the run
behind the check-your-book guide's "EPUBCheck job" pane. The unmodified export passed the same
run with no messages.

`three-problems-cli.txt` is the unmodified console output of a real EPUBCheck 5.2.1 run over the
same export with three deliberate faults (one `</p>` removed from chapter_01.xhtml, the
`dc:identifier` replaced by the pre-UUID legacy form `urn:uuid:sk3j9x2a-s8f7d6e5`, and one
undeclared XHTML file added — which this EPUBCheck run did not report). It is what a writer would
paste into Help search; `tests/help-search.test.ts` uses it as the multi-line pasted message.
