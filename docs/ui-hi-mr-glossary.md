# Beuk interface — Hindi (hi) and Marathi (mr) translation brief

Beuk is a web studio where writers write, design and export their books (EPUB, print PDF, Word).
These strings are its interface: buttons, menus, tooltips, help sentences, warnings.
The readers who will check these first are older native speakers (V's parents) — the words must
feel natural to them, like a well-made Indian app, not like a government form or a machine translation.

## Register

- **Hindi:** everyday Hindustani. Use the words people actually say, including common English loanwords
  written in Devanagari where Hindi speakers use them (सेव, एक्सपोर्ट, फ़ॉन्ट, प्रीव्यू). Avoid stiff Sanskritised
  coinages (सहेजें, निर्यात, पूर्वावलोकन). Address the user with polite **आप** and its verb forms
  (करें, चुनें, लिखें). Nukta is fine in Hindi (फ़ाइल, ज़ेन).
- **Marathi:** everyday natural Marathi as spoken in Pune/Mumbai, same spirit: common English loanwords are fine
  where Marathi speakers use them. Address the user with **तुम्ही** and its imperative (करा, निवडा, लिहा).
  Marathi has no nukta: write फाइल, झेन, फॉन्ट (not फ़). Use the Marathi ॲ / ऑ where loanwords need it (ॲप, ऑफलाइन).
- Short labels stay short. A button label is a verb or a noun, not a sentence.
- Keep Western digits (0–9). Do not convert numbers to Devanagari digits.
- No exclamation marks unless the English has one.
- Punctuation: Hindi ends sentences with । (purna viram) — Marathi uses the full stop "." as modern Marathi apps do.
  Keep the English's “curly quotes” style as “ ” in both.

## Must stay exactly as written (do not translate or transliterate)

`Beuk`, `EPUB`, `EPUBCheck`, `PDF`, `PDF/X`, `KDP`, `ISBN`, `ACX`, `DOCX`, `Word` (the program), `Kindle`, `Apple Books`,
`Kobo`, `Google`, `Ko-fi`, `Creative Commons`, file extensions, URLs, keyboard keys (Ctrl, Shift, Enter, Esc),
units (mm, in, pt, KB, MB), paper sizes (A4, A5, Letter), font names, `https://`, emoji and symbols (↘ ↗ × · → ✓ �).

## Mechanical rules (a script checks every one)

1. Every key in the input must appear in the output, with the same key, no extras.
2. Placeholders in braces — `{n}`, `{name}`, `{chapter}`, `{title}` … — must appear byte-for-byte, the same set, the
   same number of times. Never translate the word inside the braces. Move them to wherever the grammar needs.
3. HTML tags (`<b>…</b>` etc.) stay, same tags, same count, wrapped around the matching words.
4. Keys ending in `Plural` are the "n is not 1" twin of the key without the suffix. Hindi and Marathi do mark plurals
   (शब्द / शब्दों, पान / पाने) — make the twin grammatical for 2, 5, 100.
5. If the English value is only symbols/placeholders/brand names (e.g. `{title} (2)`, `PDF`, `ISBN`, `https://`), copy it unchanged.
6. Output is valid JSON, UTF-8, an object of key → string. Escape `"` inside strings as `\"`, keep `\n` if the English has it.

## Glossary (use these consistently; if a term is missing, choose naturally and add it to your report)

| English | Hindi (hi) | Marathi (mr) |
|---|---|---|
| book | किताब | पुस्तक |
| manuscript | पांडुलिपि | हस्तलिखित |
| chapter | अध्याय | प्रकरण |
| section (a part of the book) | सेक्शन | विभाग |
| page | पेज | पान (plural पाने) |
| word / words | शब्द | शब्द |
| shelf (the list of the writer's books) | शेल्फ़ | शेल्फ |
| desk (side panel where notes/entries open) | डेस्क | डेस्क |
| editor | एडिटर | एडिटर |
| write / writing | लिखना / लेखन | लिहिणे / लेखन |
| writer / author | लेखक | लेखक |
| reader | पाठक | वाचक |
| beta reader | बीटा पाठक | बीटा वाचक |
| reading link | पढ़ने का लिंक | वाचनाची लिंक |
| save / saved | सेव करें / सेव हो गया | सेव्ह करा / सेव्ह झाले |
| export | एक्सपोर्ट | एक्सपोर्ट |
| import | इम्पोर्ट | इम्पोर्ट |
| download / upload | डाउनलोड / अपलोड | डाउनलोड / अपलोड |
| preview | प्रीव्यू | प्रीव्ह्यू |
| print / print-ready | प्रिंट / प्रिंट के लिए तैयार | प्रिंट / प्रिंटसाठी तयार |
| cover | कवर | मुखपृष्ठ |
| spine / back cover | स्पाइन / पीछे का कवर | कणा / मागचे मुखपृष्ठ |
| title / subtitle | शीर्षक / उपशीर्षक | शीर्षक / उपशीर्षक |
| front matter / back matter | शुरुआती पन्ने / आखिरी पन्ने | सुरुवातीची पाने / शेवटची पाने |
| table of contents | विषय-सूची | अनुक्रमणिका |
| theme | थीम | थीम |
| typography / Typography Studio | टाइपोग्राफ़ी / टाइपोग्राफ़ी स्टूडियो | टायपोग्राफी / टायपोग्राफी स्टुडिओ |
| font | फ़ॉन्ट | फॉन्ट |
| trim size | ट्रिम साइज़ | ट्रिम साइझ |
| snapshot | स्नैपशॉट | स्नॅपशॉट |
| history (versions) | इतिहास | इतिहास |
| backup | बैकअप | बॅकअप |
| outline | रूपरेखा | आराखडा |
| plot thread | कहानी की धारा | कथानकाचा धागा |
| goal | लक्ष्य | ध्येय |
| streak (days written in a row) | लगातार लेखन | सलग लेखन |
| Insights | इनसाइट्स | इनसाइट्स |
| Covenant (Beuk's series bible of people, places, things — a feature name, capitalised) | अनुबंध | करार |
| entry (in the Covenant) | प्रविष्टि | नोंद |
| Zen (distraction-free mode) | ज़ेन | झेन |
| Read Aloud | पढ़कर सुनाएँ | मोठ्याने वाचा |
| dictation | डिक्टेशन | डिक्टेशन |
| Homeport (Beuk's home screen name) | Homeport | Homeport |
| settings | सेटिंग्स | सेटिंग्ज |
| account | अकाउंट | अकाउंट |
| sign in / sign out | साइन इन करें / साइन आउट करें | साइन इन करा / साइन आउट करा |
| password | पासवर्ड | पासवर्ड |
| two-step sign-in | दो-चरण साइन-इन | दोन-टप्पी साइन-इन |
| device | डिवाइस | डिव्हाइस |
| tab (browser) | टैब | टॅब |
| cloud | क्लाउड | क्लाउड |
| offline | ऑफ़लाइन | ऑफलाइन |
| delete / remove | हटाएँ | हटवा |
| cancel | रद्द करें | रद्द करा |
| close | बंद करें | बंद करा |
| undo / redo | पहले जैसा करें / फिर से करें | पूर्ववत करा / पुन्हा करा |
| choose / pick | चुनें | निवडा |
| open | खोलें | उघडा |
| copy / paste | कॉपी करें / पेस्ट करें | कॉपी करा / पेस्ट करा |
| search / find | खोजें | शोधा |
| replace | बदलें | बदला |
| language | भाषा | भाषा |
| store (bookstore preset) | स्टोर | स्टोअर |
| check (a manuscript check) | जाँच | तपासणी |
| warning / error | चेतावनी / गड़बड़ी | इशारा / त्रुटी |
| locked | लॉक | लॉक |
| free trial / subscription | मुफ़्त ट्रायल / सदस्यता | मोफत ट्रायल / सदस्यता |
| help | मदद | मदत |
| tooltip/tip | सुझाव | सूचना |
| image / picture | तस्वीर | चित्र |
| note / footnote | नोट / फ़ुटनोट | टीप / तळटीप |
| drop cap | ड्रॉप कैप | ड्रॉप कॅप |
| poem mode | कविता मोड | कविता मोड |

## Terms added by earlier chunks (reuse them; Marathi equivalents in the same spirit)

Hindi: Candlelight / Paper (theme names) → मोमबत्ती की रोशनी / कागज़ · Structure → ढाँचा · Prologue / Epilogue → प्रस्तावना / उपसंहार ·
Echoes → गूँज · Cadence → वाक्यों की चाल · streak freeze → छुट्टी · Opening plate → शुरुआती चित्र-पेज · backdrop → पृष्ठभूमि ·
Redact → काला करें · Insert (loose card) → पर्चा · Texts → मैसेज · Letter → चिट्ठी · Transcript → बातचीत का लिखित रूप ·
Sideways / Upside Down → तिरछा / उल्टा · Verse → पद्य · Colophon → मुद्रण विवरण
Sample book titles (e.g. "The Lantern Coast") stay in English.
Hindi (chunk 02): flourish → सजावटी चिह्न · ornament → सजावट · Print Interior → अंदर के पेज (प्रिंट) · spread → पेज-जोड़ी · Attribution → श्रेय ·
archive → संग्रह · Bulk import → एक साथ इम्पोर्ट · sample story → नमूना कहानी · Alt Text → वैकल्पिक टेक्स्ट (Alt Text) · gutter → बीच का हिस्सा (गटर)
Stop (playback) → रोकें (never बंद करें, which is Close) · Marathi: थांबवा
Marathi (chunk 01): Candlelight / Paper (themes) → मेणबत्ती / कागद · Half Title → अर्धशीर्षक · Prologue / Epilogue → पूर्वकथा / उपसंहार ·
Epigraph → प्रारंभिक अवतरण · Colophon → मुद्रणविषयक माहिती · Opening plate → सुरुवातीचे चित्रपान · Running head → पानावरची छोटी शीर्षओळ ·
Scene Break → दृश्यबदल · Echoes → पडसाद · Streak freeze → फ्रीझ · Target → लक्ष्य (goal stays ध्येय) · Redact → काळे करा ·
Transcript → प्रतिलेख · Margin note → समासातील टीप · Insert (loose card) → सुटे कार्ड
Marathi (chunk 02): Flourish → नक्षी · ornament → अलंकार · page break → पान-विराम · spread → पानांची जोडी · recto / verso → उजवे पान / डावे पान ·
caption → चित्र-ओळ · alt text → पर्यायी मजकूर · attribution → श्रेय · hyphenation → शब्द तोडणी (हायफन) · Bulk import → एकत्र इम्पोर्ट ·
Archive → संग्रह · Support → सहाय्य · Tally → मोजणी · table / cell → तक्ता / कप्पा · indent → ओळीची सुरुवातीची जागा (NOT समास, which is margin)
Theme names are fixed: Hindi कागज़ / मोमबत्ती की रोशनी · Marathi कागद / मेणबत्ती
Hindi (chunk 04): caption → कैप्शन · tally → गिनती · synopsis → सारांश · status → स्थिति · tag → टैग · POV → नज़रिया · Notebook → नोटबुक ·
duplicate → कॉपी बनाएँ · split → दो हिस्से करें · merge → मिलाएँ · grid square → खाना · scene → दृश्य · small caps → स्मॉल कैप्स ·
running heads → पेज के ऊपर की शीर्ष-पंक्ति · draft / final → ड्राफ़्ट / फ़ाइनल
Hindi (chunk 03): heading → हेडिंग · paragraph → पैराग्राफ़ · scene break → सीन-ब्रेक · block quote → ब्लॉक उद्धरण · table/row/cell/column → टेबल / पंक्ति / खाना / कॉलम ·
tracked changes → ट्रैक किए गए बदलाव · comment → टिप्पणी · ellipsis → तीन बिंदु (…) · rule (line) → रेखा. "the reader" in PDF import strings = the PDF reader program (PDF रीडर), not a person.
Marathi (chunk 03): heading / sub-heading → मथळा / उपमथळा · paragraph → परिच्छेद · block quote → उद्धृत परिच्छेद · table/row/column/cell → तक्ता / ओळ / स्तंभ / सेल ·
rule (line) → रेघ · set aside → बाजूला ठेवले · left out → वगळले · comments → टिप्पण्या · tracked changes → ट्रॅक केलेले बदल · ellipsis → तीन टिंबे ·
report → अहवाल · Dismiss → काढून टाका · merge → विलीन करा · title page → शीर्षकपान · underline / strike-through → अधोरेखन / खोडरेघ
FIXED: Marathi tally → मोजणी (not हिशोब) · Marathi caption → चित्र-ओळ · Marathi cell → कप्पा
Marathi (chunk 04): full account → संपूर्ण तपशील · look (formatting) → मांडणी · Grid → जाळी · POV → दृष्टिकोन · duplicate → प्रत बनवा · split → दोन भाग करा ·
synopsis → सारांश · status → स्थिती · draft / final → ड्राफ्ट / फायनल · Notebook → नोटबुक
FIXED: Marathi merge → विलीन करा (not जोडा)
Hindi (chunk 05): plate → चित्र-पेज · Part dividers → भाग-विभाजक · Cover Maker → कवर मेकर · bleed/hinge/flap/board/wrap → ब्लीड / हिंज / फ़्लैप / बोर्ड / रैप ·
Terms → नियम और शर्तें · Privacy → प्राइवेसी · tagline → टैगलाइन · stanza → छंद · restore → वापस लाएँ · narrator → कथावाचक
Marathi (chunk 05): plate → चित्रपान · backdrop → पार्श्वभूमी · stanza → कडवे · texture → पोत · binding → बांधणी · hinge → बिजागर · flap / fold → फ्लॅप / घडी ·
gutter → मधला भाग (गटर) · Hardcover / Paperback → हार्डकव्हर / पेपरबॅक · Cover Maker → मुखपृष्ठ मेकर · tagline → टॅगलाइन · Privacy / Terms → गोपनीयता / अटी
Cover layout "Free" (free-form) → Hindi मनचाहा · Marathi मोकळी. Narrator → Hindi कथावाचक · Marathi निवेदक
Hindi (chunk 06): accessibility → सुलभता · imprint → इम्प्रिंट · blurb → ब्लर्ब · endpaper → एंडपेपर · preflight → प्रिंट से पहले की जाँच · Large Print → बड़े अक्षरों वाला संस्करण ·
picture book → चित्र-पुस्तक · margin → हाशिया · metadata → मेटाडेटा · Dictate → बोलकर लिखें · Ambient sound → माहौल की आवाज़ · Foreword / Preface / Appendix → प्राक्कथन / भूमिका / परिशिष्ट
Marathi (chunk 06): imprint → प्रकाशनाचे नाव · blurb → पुस्तक-परिचय · margin → समास · folio → पान क्रमांक · running head → शीर्षओळ · Large Print → मोठ्या अक्षरांची आवृत्ती ·
leading → ओळींमधील अंतर · Accessibility → सुलभता · screen reader → स्क्रीन रीडर · Dictate → बोलून लिहा · Ambient sound → पार्श्वध्वनी · Foreword / Preface / Appendix → पुरोवचन / प्रस्तावना / परिशिष्ट
Hindi (chunk 07): sync → सिंक · conflict (sync) → टकराव · Theme Creator → थीम क्रिएटर · alignment → संरेखण · dialogue → संवाद · Reading ease → पढ़ने में आसानी ·
Sentence variety → वाक्यों में विविधता · binding → बाइंडिंग · Ink & paper → स्याही और कागज़ · pace → रफ़्तार. Sample/preview text (creator.sample*) IS translated, as ja/ar/ru do.
Marathi (chunk 07): Theme Creator → थीम क्रिएटर · alignment → संरेखन · Reading ease → वाचन-सुलभता · conflict (sync) → विसंगती · Black & white → कृष्णधवल · blocking issue → अडथळा
RULE: when a sentence names another Beuk screen/button/label (e.g. "Project Settings", "Structural Validation", "Export"), use that label's translation in quotes, never the English. Store-side names (KDP's "Custom Trim", Bleed option) stay English.
Marathi (chunk 08): interior → आतील पाने · ink & paper → शाई आणि कागद · Advisory → सल्ला · retail sample → विक्रीसाठीचा नमुना · pronunciation guide → उच्चार मार्गदर्शक ·
legal name → कायदेशीर नाव · placeholder → तात्पुरता मजकूर
FIXED: Marathi Pass / Fail → पास / फेल (not योग्य / अयोग्य)
Hindi (chunk 09): Character / Lore (Covenant entry types) → पात्र / दंतकथा · mention → ज़िक्र · Rights → अधिकार · All rights reserved → सर्वाधिकार सुरक्षित · series → सीरीज़ · frontispiece → मुख-चित्र
Marathi (chunk 09): mention → उल्लेख · passage → उतारा · field → रकाना · Links (between entries) → नाती · template → साचा · series → मालिका · Lore → दंतकथा · Rights / Licence → हक्क / परवाना
