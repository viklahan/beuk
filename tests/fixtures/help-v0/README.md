# Pre-H1 guide copy (test fixture)

Each `<slug>.txt` is the visible text of the guide's `<main>` (minus the "← All guides" back link)
in the static page `client/help/<slug>.html` as it stood at commit `bb992b4`, extracted with
`oldGuideText()` from `tests/help-text.ts`. Those static pages were replaced by
`content/help/guides/<slug>.md`; `tests/help-content.test.ts` renders every migrated guide and
requires its article text to equal this copy, except for the intentional edits it lists.
