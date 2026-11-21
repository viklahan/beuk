---
title: The Checker Learns New Tricks
section: Standards Desk
place: short
order: 3
---
Last Monday, [Wendy Reid of the W3C's Publishing Maintenance Working Group wrote up](https://www.w3.org/blog/2026/were-on-a-roll-epub-3-4-is-coming/) where EPUB 3.4 stands: Candidate Recommendation, with EPUBCheck 5.4.0 already validating against it. New in the checker: “roll” scrolling layouts for webtoon-style books, AVIF and JPEG XL images, OPUS and AAC audio, and an accessibility contact-email field. Font obfuscation, NCX and the old OPF *guide* element are formally outdated; the XHTML *switch* element is deprecated outright. The comfort, from the spec itself: an EPUB that conforms to an earlier version conforms to 3.4 as it stands. EPUB 3, incidentally, turned fifteen this month.

:: Revalidate against 5.4.0, prefer WOFF2 for embedded fonts, and treat “outdated” warnings as a to-do list, not an emergency.
