# Interface strings waiting for V's sign-off

**None of this is approved.** Every translation below is a draft written by Claude: it is not approved, has not been reviewed by a native
speaker, and has not been signed off. V signs off every UI translation personally; until he does, each draft stays on this list.
English text is the source; it is the only column that is final wording.

Last updated 2026-11-27 (the ARC final fix wave: new and changed drafts in sections 8 and 9, listed at the top of each; ARC reader pages and reader emails: section 9; the ARC panel: section 8; Hindi and Marathi: section 7, with the 14 keys main added since 340cb22; the keystroke rescue's two strings: section 6). Before that: 2026-11-24 ("Use on every chapter": section 5; Poem Mode: section 4; the export screen: section 3, the proof's link words); 2026-11-12 (studio 2.0 cutover, task 6).

## 1. The 22 `next.*` keys (new in this task)

These 22 keys were English placeholders in all 12 other languages while they lived in `studio/src/i18n/next-strings.ts`
(5 from step 4 part C, 17 from per-user themes). Task 6 moved the English verbatim into `client/index.html` `UI_STRINGS`
(the `BEUK:next-strings` block, one `Object.assign` per language) and wrote a first draft for each of the 12 languages.
The overlay file is gone. The generated packs (`npm run extract`) now carry them.

How the drafts were made:

- Placeholders (`{n}`, `{chapter}`, `{name}`) are kept byte for byte; a test checks it for every language.
- Plurals: 1.0's rule for a `{n}` call is "the key's `Plural` twin when n is not 1". `next.textWarning` is the only key with
  a count; its twin is `next.textWarningPlural`. Polish, Russian and Arabic have more than two plural forms, and a
  `Plural` twin is one string, so their twins are worded with the count after a colon, which fits every count. Turkish,
  Japanese and Chinese do not pluralise after a number, so their two strings match.
- Words follow the neighbouring 1.0 strings in each language (theme, book, snapshot, device, account, tab, "Theme Creator",
  sign in) and each language's address form there (for example *tu* in Spanish and Italian, *vous* in French, *Sie* in German,
  *u* in Dutch). Quote marks follow each language's 1.0 strings.
- Arabic is right-to-left; the placeholders sit inside the Arabic text unchanged.
- `next.themes.deviceSuffix` is appended to a theme's name, and `next.themes.conflict` quotes the same words, so the two
  must change together (a test checks that the conflict text contains the trimmed suffix).

Points worth a look when you read them:

- **de** keeps `behalten` for the action ("Für alle Bücher behalten") and `gespeichert` for the state; 1.0 has no earlier word for "keep a theme".
- **es / pt / fr / it / nl / pl / ru / tr** each picked one verb for "keep" (guardar, guardar, garder, conservare, bewaren, zachować, сохранить, saklamak) and use it in every key. If you prefer another verb, it appears in about eight keys per language.
- **pt** follows the pt-PT words the 1.0 pack already uses (separador, instantâneo, "entrar").
- **ar** `next.markRefused` says the asterisks ("نجماته") would be read back as something else.

### `next.textWarning`

- **en** (source): {n} broken character in “{chapter}” could not be kept and became �.
- **es** Español: `{n} carácter dañado en «{chapter}» no pudo conservarse y se convirtió en �.`
- **fr** Français: `{n} caractère illisible dans « {chapter} » n’a pas pu être conservé et est devenu �.`
- **de** Deutsch: `{n} beschädigtes Zeichen in „{chapter}“ konnte nicht erhalten werden und wurde zu �.`
- **it** Italiano: `{n} carattere danneggiato in «{chapter}» non ha potuto essere conservato ed è diventato �.`
- **pt** Português: `{n} carácter danificado em «{chapter}» não pôde ser mantido e passou a �.`
- **nl** Nederlands: `{n} beschadigd teken in „{chapter}” kon niet worden behouden en werd �.`
- **pl** Polski: `{n} uszkodzony znak w „{chapter}” nie mógł zostać zachowany i zamienił się w �.`
- **ru** Русский: `{n} повреждённый символ в «{chapter}» не удалось сохранить, и он превратился в �.`
- **tr** Türkçe: `“{chapter}” içindeki {n} bozuk karakter korunamadı ve � oldu.`
- **ar** العربية: `{n} حرف تالف في «{chapter}» تعذّر حفظه وصار �.`
- **ja** 日本語: `「{chapter}」の壊れた文字 {n} 個を保持できず、� になりました。`
- **zh-Hans** 简体中文: `“{chapter}”中有 {n} 个损坏的字符无法保留，已变成 �。`
- **hi** हिन्दी: `“{chapter}” में {n} टूटा हुआ अक्षर रखा नहीं जा सका और � बन गया।`
- **mr** मराठी: `“{chapter}” मधील {n} बिघडलेले अक्षर ठेवता आले नाही आणि ते � झाले.`

### `next.textWarningPlural`

- **en** (source): {n} broken characters in “{chapter}” could not be kept and became �.
- **es** Español: `{n} caracteres dañados en «{chapter}» no pudieron conservarse y se convirtieron en �.`
- **fr** Français: `{n} caractères illisibles dans « {chapter} » n’ont pas pu être conservés et sont devenus �.`
- **de** Deutsch: `{n} beschädigte Zeichen in „{chapter}“ konnten nicht erhalten werden und wurden zu �.`
- **it** Italiano: `{n} caratteri danneggiati in «{chapter}» non hanno potuto essere conservati e sono diventati �.`
- **pt** Português: `{n} caracteres danificados em «{chapter}» não puderam ser mantidos e passaram a �.`
- **nl** Nederlands: `{n} beschadigde tekens in „{chapter}” konden niet worden behouden en werden �.`
- **pl** Polski: `W „{chapter}” nie dało się zachować uszkodzonych znaków, które zamieniły się w �: {n}.`
- **ru** Русский: `Повреждённых символов в «{chapter}», которые не удалось сохранить и которые превратились в �: {n}.`
- **tr** Türkçe: `“{chapter}” içindeki {n} bozuk karakter korunamadı ve � oldu.`
- **ar** العربية: `عدد الأحرف التالفة في «{chapter}» التي تعذّر حفظها وصارت �: {n}.`
- **ja** 日本語: `「{chapter}」の壊れた文字 {n} 個を保持できず、� になりました。`
- **zh-Hans** 简体中文: `“{chapter}”中有 {n} 个损坏的字符无法保留，已变成 �。`
- **hi** हिन्दी: `“{chapter}” में {n} टूटे हुए अक्षर रखे नहीं जा सके और � बन गए।`
- **mr** मराठी: `“{chapter}” मधील {n} बिघडलेली अक्षरे ठेवता आली नाहीत आणि ती � झाली.`

### `next.markRefused`

- **en** (source): That can’t be italic or bold here — its asterisks would read back as something else.
- **es** Español: `Aquí no puede ir en cursiva ni en negrita — sus asteriscos se leerían de vuelta como otra cosa.`
- **fr** Français: `Cela ne peut pas être en italique ni en gras ici — ses astérisques seraient relus comme autre chose.`
- **de** Deutsch: `Hier kann das nicht kursiv oder fett sein — seine Sternchen würden beim Zurücklesen etwas anderes ergeben.`
- **it** Italiano: `Qui non può essere in corsivo né in grassetto — i suoi asterischi verrebbero riletti come qualcos’altro.`
- **pt** Português: `Aqui isto não pode ficar em itálico nem em negrito — os seus asteriscos seriam lidos de volta como outra coisa.`
- **nl** Nederlands: `Dat kan hier niet cursief of vet zijn — de sterretjes ervan zouden als iets anders worden teruggelezen.`
- **pl** Polski: `Tutaj nie może to być kursywą ani pogrubieniem — jego gwiazdki zostałyby odczytane jako coś innego.`
- **ru** Русский: `Здесь это не может быть курсивом или полужирным — его звёздочки прочитались бы как что-то другое.`
- **tr** Türkçe: `Burada italik ya da kalın olamaz — yıldızları geri okunurken başka bir şey olarak anlaşılırdı.`
- **ar** العربية: `لا يمكن أن يكون هذا مائلًا أو عريضًا هنا — فنجماته ستُقرأ لاحقًا على أنها شيء آخر.`
- **ja** 日本語: `ここでは斜体や太字にできません — アスタリスクが読み戻されたときに別の意味になってしまいます。`
- **zh-Hans** 简体中文: `这里不能设为斜体或粗体 — 它的星号读回时会变成别的意思。`
- **hi** हिन्दी: `यहाँ इसे इटैलिक या बोल्ड नहीं किया जा सकता — इसके स्टार (*) चिह्न दोबारा पढ़े जाने पर कुछ और बन जाएँगे।`
- **mr** मराठी: `इथे ते इटॅलिक किंवा ठळक करता येत नाही — त्याच्या * चिन्हांचा अर्थ पुन्हा वाचताना वेगळाच लागेल.`

### `next.snapshotGone`

- **en** (source): That snapshot is no longer here — the book was replaced or the snapshot removed. Nothing was changed.
- **es** Español: `Esa instantánea ya no está aquí — el libro se reemplazó o se quitó la instantánea. No se cambió nada.`
- **fr** Français: `Cet instantané n’est plus là — le livre a été remplacé ou l’instantané supprimé. Rien n’a été modifié.`
- **de** Deutsch: `Dieser Schnappschuss ist nicht mehr da — das Buch wurde ersetzt oder der Schnappschuss entfernt. Es wurde nichts geändert.`
- **it** Italiano: `Quell’istantanea non c’è più — il libro è stato sostituito o l’istantanea rimossa. Non è stato cambiato nulla.`
- **pt** Português: `Esse instantâneo já não está aqui — o livro foi substituído ou o instantâneo removido. Nada foi alterado.`
- **nl** Nederlands: `Die momentopname is er niet meer — het boek is vervangen of de momentopname is verwijderd. Er is niets gewijzigd.`
- **pl** Polski: `Tej migawki już tu nie ma — książkę zastąpiono albo migawkę usunięto. Nic nie zostało zmienione.`
- **ru** Русский: `Этого снимка здесь больше нет — книгу заменили или снимок удалили. Ничего не изменено.`
- **tr** Türkçe: `Bu anlık görüntü artık burada değil — kitap değiştirilmiş ya da anlık görüntü kaldırılmış. Hiçbir şey değiştirilmedi.`
- **ar** العربية: `هذه اللقطة لم تعد هنا — استُبدل الكتاب أو أُزيلت اللقطة. لم يتغيّر شيء.`
- **ja** 日本語: `そのスナップショットはもうありません — 本が置き換えられたか、スナップショットが削除されました。何も変更していません。`
- **zh-Hans** 简体中文: `这份快照已不在 — 书已被替换，或快照已被移除。什么都没有更改。`
- **hi** हिन्दी: `वह स्नैपशॉट अब यहाँ नहीं है — किताब बदल दी गई या स्नैपशॉट हटा दिया गया। कुछ नहीं बदला गया।`
- **mr** मराठी: `तो स्नॅपशॉट आता इथे नाही — पुस्तक बदलले गेले किंवा स्नॅपशॉट काढून टाकला. काहीही बदलले नाही.`

### `next.bookReplaced`

- **en** (source): The book was replaced in another tab while this one was asking. Nothing was changed.
- **es** Español: `El libro se reemplazó en otra pestaña mientras esta preguntaba. No se cambió nada.`
- **fr** Français: `Le livre a été remplacé dans un autre onglet pendant que celui-ci vous posait la question. Rien n’a été modifié.`
- **de** Deutsch: `Das Buch wurde in einem anderen Tab ersetzt, während dieser nachfragte. Es wurde nichts geändert.`
- **it** Italiano: `Il libro è stato sostituito in un’altra scheda mentre questa stava chiedendo. Non è stato cambiato nulla.`
- **pt** Português: `O livro foi substituído noutro separador enquanto este perguntava. Nada foi alterado.`
- **nl** Nederlands: `Het boek is vervangen in een ander tabblad terwijl dit tabblad iets vroeg. Er is niets gewijzigd.`
- **pl** Polski: `Książkę zastąpiono w innej karcie, gdy ta o coś pytała. Nic nie zostało zmienione.`
- **ru** Русский: `Книгу заменили в другой вкладке, пока эта задавала вопрос. Ничего не изменено.`
- **tr** Türkçe: `Bu sekme soru sorarken kitap başka bir sekmede değiştirildi. Hiçbir şey değiştirilmedi.`
- **ar** العربية: `استُبدل الكتاب في علامة تبويب أخرى بينما كانت هذه تسأل. لم يتغيّر شيء.`
- **ja** 日本語: `このタブが確認している間に、別のタブで本が置き換えられました。何も変更していません。`
- **zh-Hans** 简体中文: `在这个标签页询问期间，书已在另一个标签页中被替换。什么都没有更改。`
- **hi** हिन्दी: `जब यह टैब पूछ रहा था, तभी दूसरे टैब में किताब बदल दी गई। कुछ नहीं बदला गया।`
- **mr** मराठी: `हा टॅब विचारत असतानाच दुसऱ्या टॅबमध्ये पुस्तक बदलले गेले. काहीही बदलले नाही.`

### `next.themes.everyH`

- **en** (source): Themes for every book
- **es** Español: `Temas para todos los libros`
- **fr** Français: `Thèmes pour tous les livres`
- **de** Deutsch: `Themen für alle Bücher`
- **it** Italiano: `Temi per ogni libro`
- **pt** Português: `Temas para todos os livros`
- **nl** Nederlands: `Thema's voor elk boek`
- **pl** Polski: `Motywy dla każdej książki`
- **ru** Русский: `Темы для каждой книги`
- **tr** Türkçe: `Her kitap için temalar`
- **ar** العربية: `سمات لكل كتاب`
- **ja** 日本語: `すべての本で使うテーマ`
- **zh-Hans** 简体中文: `适用于每本书的主题`
- **hi** हिन्दी: `हर किताब के लिए थीम`
- **mr** मराठी: `प्रत्येक पुस्तकासाठी थीम`

### `next.themes.everySub`

- **en** (source): Themes you keep for yourself, apart from any one book. One click copies a theme — with its fonts and flourishes — into this book and applies it. Removing one here never changes a book.
- **es** Español: `Temas que guardas para ti, aparte de cualquier libro. Un clic copia un tema — con sus fuentes y adornos — en este libro y lo aplica. Quitar uno aquí nunca cambia un libro.`
- **fr** Français: `Des thèmes que vous gardez pour vous, en dehors de tout livre. Un clic copie un thème — avec ses polices et ses fioritures — dans ce livre et l’applique. En retirer un ici ne modifie jamais un livre.`
- **de** Deutsch: `Themen, die Sie für sich behalten, unabhängig von einem einzelnen Buch. Ein Klick kopiert ein Thema — mit seinen Schriften und Verzierungen — in dieses Buch und wendet es an. Ein Thema hier zu entfernen ändert nie ein Buch.`
- **it** Italiano: `Temi che tieni per te, separati da qualsiasi libro. Un clic copia un tema — con i suoi caratteri e i suoi fregi — in questo libro e lo applica. Rimuoverne uno qui non cambia mai un libro.`
- **pt** Português: `Temas que guarda para si, à parte de qualquer livro. Um clique copia um tema — com as suas fontes e ornamentos — para este livro e aplica-o. Remover um aqui nunca altera um livro.`
- **nl** Nederlands: `Thema's die u voor uzelf bewaart, los van één boek. Eén klik kopieert een thema — met zijn lettertypen en sierwerk — naar dit boek en past het toe. Een thema hier verwijderen wijzigt nooit een boek.`
- **pl** Polski: `Motywy, które zachowujesz dla siebie, niezależnie od jakiejkolwiek książki. Jedno kliknięcie kopiuje motyw — z jego czcionkami i zdobieniami — do tej książki i go stosuje. Usunięcie motywu tutaj nigdy nie zmienia żadnej książki.`
- **ru** Русский: `Темы, которые вы храните для себя, отдельно от любой книги. Один щелчок копирует тему — вместе с её шрифтами и украшениями — в эту книгу и применяет её. Удаление темы здесь никогда не меняет книгу.`
- **tr** Türkçe: `Herhangi bir kitaptan bağımsız olarak kendinize sakladığınız temalar. Tek tıklama bir temayı — yazı tipleri ve süsleriyle birlikte — bu kitaba kopyalar ve uygular. Burada bir temayı kaldırmak hiçbir kitabı değiştirmez.`
- **ar** العربية: `سمات تحتفظ بها لنفسك، بمعزل عن أي كتاب. نقرة واحدة تنسخ سمة — بخطوطها وزخارفها — إلى هذا الكتاب وتطبّقها. إزالة سمة من هنا لا تغيّر أي كتاب أبدًا.`
- **ja** 日本語: `特定の本とは別に、自分用に取っておくテーマです。ワンクリックでテーマを — フォントや飾りごと — この本にコピーして適用します。ここで削除しても、本は一切変更されません。`
- **zh-Hans** 简体中文: `你为自己留存的主题，独立于任何一本书。单击即可把主题——连同字体和装饰——复制到这本书并应用。在这里移除主题不会更改任何书。`
- **hi** हिन्दी: `वे थीम जो आप अपने लिए रखते हैं, किसी एक किताब से अलग। एक क्लिक से थीम — उसके फ़ॉन्ट और सजावटी चिह्नों के साथ — इस किताब में कॉपी होकर लागू हो जाती है। यहाँ से किसी थीम को हटाने पर कोई किताब कभी नहीं बदलती।`
- **mr** मराठी: `कोणत्याही एका पुस्तकापासून वेगळ्या, तुम्ही स्वतःसाठी ठेवलेल्या थीम. एका क्लिकने थीम — तिच्या फॉन्ट आणि नक्षींसह — या पुस्तकात कॉपी होऊन लागू होते. इथून थीम काढली तरी कोणतेही पुस्तक बदलत नाही.`

### `next.themes.account`

- **en** (source): Kept with your account: they follow you to every device you sign in on.
- **es** Español: `Guardados en tu cuenta: te siguen a todos los dispositivos donde inicies sesión.`
- **fr** Français: `Gardés avec votre compte : ils vous suivent sur tous les appareils où vous vous connectez.`
- **de** Deutsch: `Mit Ihrem Konto gespeichert: Die Themen folgen Ihnen auf jedes Gerät, auf dem Sie sich anmelden.`
- **it** Italiano: `Conservati con il tuo account: ti seguono su ogni dispositivo da cui accedi.`
- **pt** Português: `Guardados na sua conta: seguem-no para todos os dispositivos em que entrar.`
- **nl** Nederlands: `Bewaard bij uw account: ze volgen u naar elk apparaat waarop u inlogt.`
- **pl** Polski: `Zachowane na twoim koncie: podążają za tobą na każde urządzenie, na którym się zalogujesz.`
- **ru** Русский: `Хранятся в вашем аккаунте: они следуют за вами на каждое устройство, где вы входите.`
- **tr** Türkçe: `Hesabınızla saklanır: giriş yaptığınız her cihazda sizi izler.`
- **ar** العربية: `محفوظة مع حسابك: تتبعك إلى كل جهاز تسجّل الدخول عليه.`
- **ja** 日本語: `アカウントに保存されます。サインインしたどのデバイスにも付いてきます。`
- **zh-Hans** 简体中文: `保存在你的账户中：会跟随你到登录的每台设备。`
- **hi** हिन्दी: `आपके अकाउंट के साथ रखी गई: आप जिस भी डिवाइस पर साइन इन करें, ये वहाँ आपके साथ रहती हैं।`
- **mr** मराठी: `तुमच्या अकाउंटसोबत ठेवल्या आहेत: तुम्ही ज्या डिव्हाइसवर साइन इन कराल तिथे त्या तुमच्यासोबत येतात.`

### `next.themes.deviceOnly`

- **en** (source): Kept on this device only. Sign in and they follow you to every device.
- **es** Español: `Guardados solo en este dispositivo. Inicia sesión y te seguirán a todos los dispositivos.`
- **fr** Français: `Gardés sur cet appareil uniquement. Connectez-vous et ils vous suivent sur tous vos appareils.`
- **de** Deutsch: `Nur auf diesem Gerät gespeichert. Melden Sie sich an, und die Themen folgen Ihnen auf jedes Gerät.`
- **it** Italiano: `Conservati solo su questo dispositivo. Accedi e ti seguiranno su ogni dispositivo.`
- **pt** Português: `Guardados só neste dispositivo. Entre e eles seguem-no para todos os dispositivos.`
- **nl** Nederlands: `Alleen op dit apparaat bewaard. Log in en ze volgen u naar elk apparaat.`
- **pl** Polski: `Zachowane tylko na tym urządzeniu. Zaloguj się, a będą podążać za tobą na każde urządzenie.`
- **ru** Русский: `Хранятся только на этом устройстве. Войдите, и они последуют за вами на каждое устройство.`
- **tr** Türkçe: `Yalnızca bu cihazda saklanır. Giriş yapın, her cihazda sizi izlesin.`
- **ar** العربية: `محفوظة على هذا الجهاز فقط. سجّل الدخول وستتبعك إلى كل جهاز.`
- **ja** 日本語: `このデバイスにのみ保存されます。サインインすれば、どのデバイスにも付いてきます。`
- **zh-Hans** 简体中文: `仅保存在这台设备上。登录后，它们会跟随你到每台设备。`
- **hi** हिन्दी: `सिर्फ़ इसी डिवाइस पर रखी गई। साइन इन करें, तो ये हर डिवाइस पर आपके साथ रहेंगी।`
- **mr** मराठी: `फक्त या डिव्हाइसवर ठेवल्या आहेत. साइन इन करा, म्हणजे त्या प्रत्येक डिव्हाइसवर तुमच्यासोबत येतील.`

### `next.themes.empty`

- **en** (source): Nothing kept for every book yet. Use “Keep for every book” on one of this book’s themes, or in the Theme Creator.
- **es** Español: `Aún no hay nada guardado para todos los libros. Usa «Guardar para todos los libros» en uno de los temas de este libro, o en el Creador de temas.`
- **fr** Français: `Rien de gardé pour tous les livres pour l’instant. Utilisez « Garder pour tous les livres » sur l’un des thèmes de ce livre, ou dans le Créateur de thèmes.`
- **de** Deutsch: `Noch nichts für alle Bücher behalten. Nutzen Sie „Für alle Bücher behalten“ bei einem der Themen dieses Buches oder im Themen-Gestalter.`
- **it** Italiano: `Nessun tema ancora conservato per ogni libro. Usa «Conserva per ogni libro» su uno dei temi di questo libro, oppure nel Creatore di temi.`
- **pt** Português: `Ainda não há nada guardado para todos os livros. Use «Guardar para todos os livros» num dos temas deste livro, ou no Criador de temas.`
- **nl** Nederlands: `Nog niets bewaard voor elk boek. Gebruik „Bewaar voor elk boek” bij een van de thema's van dit boek, of in de Themamaker.`
- **pl** Polski: `Nic jeszcze nie zachowano dla każdej książki. Użyj „Zachowaj dla każdej książki” przy jednym z motywów tej książki albo w Kreatorze motywów.`
- **ru** Русский: `Для каждой книги пока ничего не сохранено. Нажмите «Сохранить для каждой книги» у одной из тем этой книги или в Конструкторе тем.`
- **tr** Türkçe: `Henüz her kitap için saklanan bir şey yok. Bu kitabın temalarından birinde ya da Tema Oluşturucu’da “Her kitap için sakla”yı kullanın.`
- **ar** العربية: `لا شيء محفوظًا لكل كتاب بعد. استخدم «احتفظ بها لكل كتاب» على إحدى سمات هذا الكتاب، أو في منشئ السمات.`
- **ja** 日本語: `すべての本用に保存したテーマはまだありません。この本のテーマの「すべての本用に保存」か、テーマクリエイターを使ってください。`
- **zh-Hans** 简体中文: `还没有为每本书保留的主题。请在本书的某个主题上使用“为每本书保留”，或在主题创建器中使用。`
- **hi** हिन्दी: `अभी तक हर किताब के लिए कुछ नहीं रखा गया। इस किताब की किसी थीम पर, या थीम क्रिएटर में, “हर किताब के लिए रखें” इस्तेमाल करें।`
- **mr** मराठी: `प्रत्येक पुस्तकासाठी अजून काहीही ठेवलेले नाही. या पुस्तकाच्या एखाद्या थीमवर, किंवा “थीम क्रिएटर” मध्ये, “प्रत्येक पुस्तकासाठी ठेवा” वापरा.`

### `next.themes.keep`

- **en** (source): Keep for every book
- **es** Español: `Guardar para todos los libros`
- **fr** Français: `Garder pour tous les livres`
- **de** Deutsch: `Für alle Bücher behalten`
- **it** Italiano: `Conserva per ogni libro`
- **pt** Português: `Guardar para todos os livros`
- **nl** Nederlands: `Bewaar voor elk boek`
- **pl** Polski: `Zachowaj dla każdej książki`
- **ru** Русский: `Сохранить для каждой книги`
- **tr** Türkçe: `Her kitap için sakla`
- **ar** العربية: `احتفظ بها لكل كتاب`
- **ja** 日本語: `すべての本用に保存`
- **zh-Hans** 简体中文: `为每本书保留`
- **hi** हिन्दी: `हर किताब के लिए रखें`
- **mr** मराठी: `प्रत्येक पुस्तकासाठी ठेवा`

### `next.themes.kept`

- **en** (source): “{name}” is kept for every book
- **es** Español: `«{name}» está guardado para todos los libros`
- **fr** Français: `« {name} » est gardé pour tous les livres`
- **de** Deutsch: `Thema „{name}“ wird für alle Bücher behalten`
- **it** Italiano: `«{name}» è conservato per ogni libro`
- **pt** Português: `«{name}» está guardado para todos os livros`
- **nl** Nederlands: `„{name}” is bewaard voor elk boek`
- **pl** Polski: `Motyw „{name}” jest zachowany dla każdej książki`
- **ru** Русский: `Тема «{name}» сохранена для каждой книги`
- **tr** Türkçe: `“{name}” her kitap için saklandı`
- **ar** العربية: `السمة «{name}» محفوظة لكل كتاب`
- **ja** 日本語: `「{name}」をすべての本用に保存しました`
- **zh-Hans** 简体中文: `“{name}”已为每本书保留`
- **hi** हिन्दी: `“{name}” हर किताब के लिए रख ली गई है`
- **mr** मराठी: `“{name}” प्रत्येक पुस्तकासाठी ठेवली आहे`

### `next.themes.removed`

- **en** (source): “{name}” is no longer kept for every book — no book was changed
- **es** Español: `«{name}» ya no está guardado para todos los libros — no se cambió ningún libro`
- **fr** Français: `« {name} » n’est plus gardé pour tous les livres — aucun livre n’a été modifié`
- **de** Deutsch: `Thema „{name}“ wird nicht mehr für alle Bücher behalten — kein Buch wurde geändert`
- **it** Italiano: `«{name}» non è più conservato per ogni libro — nessun libro è stato cambiato`
- **pt** Português: `«{name}» já não está guardado para todos os livros — nenhum livro foi alterado`
- **nl** Nederlands: `„{name}” is niet langer bewaard voor elk boek — er is geen boek gewijzigd`
- **pl** Polski: `Motyw „{name}” nie jest już zachowany dla każdej książki — żadna książka nie została zmieniona`
- **ru** Русский: `Тема «{name}» больше не сохранена для каждой книги — ни одна книга не изменена`
- **tr** Türkçe: `“{name}” artık her kitap için saklanmıyor — hiçbir kitap değiştirilmedi`
- **ar** العربية: `السمة «{name}» لم تعد محفوظة لكل كتاب — لم يتغيّر أي كتاب`
- **ja** 日本語: `「{name}」はすべての本用の保存から外れました — どの本も変更されていません`
- **zh-Hans** 简体中文: `“{name}”不再为每本书保留 — 没有更改任何书`
- **hi** हिन्दी: `“{name}” अब हर किताब के लिए नहीं रखी गई — कोई किताब नहीं बदली गई`
- **mr** मराठी: `“{name}” आता प्रत्येक पुस्तकासाठी ठेवलेली नाही — कोणतेही पुस्तक बदलले नाही`

### `next.themes.offer`

- **en** (source): This book has themes of its own. Keep them for every book too?
- **es** Español: `Este libro tiene temas propios. ¿Guardarlos también para todos los libros?`
- **fr** Français: `Ce livre a des thèmes à lui. Les garder aussi pour tous les livres ?`
- **de** Deutsch: `Dieses Buch hat eigene Themen. Auch für alle Bücher behalten?`
- **it** Italiano: `Questo libro ha temi suoi. Conservarli anche per ogni libro?`
- **pt** Português: `Este livro tem temas próprios. Guardá-los também para todos os livros?`
- **nl** Nederlands: `Dit boek heeft eigen thema's. Ze ook voor elk boek bewaren?`
- **pl** Polski: `Ta książka ma własne motywy. Zachować je też dla każdej książki?`
- **ru** Русский: `У этой книги есть свои темы. Сохранить их и для каждой книги?`
- **tr** Türkçe: `Bu kitabın kendi temaları var. Bunları her kitap için de saklayalım mı?`
- **ar** العربية: `لهذا الكتاب سمات خاصة به. هل تحتفظ بها لكل كتاب أيضًا؟`
- **ja** 日本語: `この本には独自のテーマがあります。すべての本用にも保存しますか？`
- **zh-Hans** 简体中文: `这本书有自己的主题。也为每本书保留它们吗？`
- **hi** हिन्दी: `इस किताब की अपनी थीम हैं। इन्हें हर किताब के लिए भी रखें?`
- **mr** मराठी: `या पुस्तकाच्या स्वतःच्या थीम आहेत. त्या प्रत्येक पुस्तकासाठीही ठेवायच्या?`

### `next.themes.offerYes`

- **en** (source): Keep them
- **es** Español: `Guardarlos`
- **fr** Français: `Les garder`
- **de** Deutsch: `Behalten`
- **it** Italiano: `Conservali`
- **pt** Português: `Guardá-los`
- **nl** Nederlands: `Bewaar ze`
- **pl** Polski: `Zachowaj je`
- **ru** Русский: `Сохранить`
- **tr** Türkçe: `Sakla`
- **ar** العربية: `احتفظ بها`
- **ja** 日本語: `保存する`
- **zh-Hans** 简体中文: `保留`
- **hi** हिन्दी: `हाँ, रखें`
- **mr** मराठी: `ठेवा`

### `next.themes.offerNo`

- **en** (source): No, thanks
- **es** Español: `No, gracias`
- **fr** Français: `Non, merci`
- **de** Deutsch: `Nein, danke`
- **it** Italiano: `No, grazie`
- **pt** Português: `Não, obrigado`
- **nl** Nederlands: `Nee, bedankt`
- **pl** Polski: `Nie, dziękuję`
- **ru** Русский: `Нет, спасибо`
- **tr** Türkçe: `Hayır, teşekkürler`
- **ar** العربية: `لا، شكرًا`
- **ja** 日本語: `いいえ、結構です`
- **zh-Hans** 简体中文: `不用了，谢谢`
- **hi** हिन्दी: `नहीं, धन्यवाद`
- **mr** मराठी: `नको, धन्यवाद`

### `next.themes.moveOffer`

- **en** (source): Some themes are kept on this device only. Move them to your account, so they follow you to every device?
- **es** Español: `Algunos temas se guardan solo en este dispositivo. ¿Moverlos a tu cuenta para que te sigan a todos los dispositivos?`
- **fr** Français: `Certains thèmes sont gardés sur cet appareil uniquement. Les déplacer vers votre compte pour qu’ils vous suivent sur tous vos appareils ?`
- **de** Deutsch: `Einige Themen sind nur auf diesem Gerät gespeichert. In Ihr Konto verschieben, damit sie Ihnen auf jedes Gerät folgen?`
- **it** Italiano: `Alcuni temi sono conservati solo su questo dispositivo. Spostarli nel tuo account, così ti seguono su ogni dispositivo?`
- **pt** Português: `Alguns temas estão guardados só neste dispositivo. Movê-los para a sua conta, para que o sigam para todos os dispositivos?`
- **nl** Nederlands: `Sommige thema's worden alleen op dit apparaat bewaard. Naar uw account verplaatsen, zodat ze u naar elk apparaat volgen?`
- **pl** Polski: `Niektóre motywy są zachowane tylko na tym urządzeniu. Przenieść je na twoje konto, aby podążały za tobą na każde urządzenie?`
- **ru** Русский: `Некоторые темы хранятся только на этом устройстве. Перенести их в ваш аккаунт, чтобы они следовали за вами на каждое устройство?`
- **tr** Türkçe: `Bazı temalar yalnızca bu cihazda saklanıyor. Her cihazda sizi izlemeleri için hesabınıza taşınsın mı?`
- **ar** العربية: `بعض السمات محفوظة على هذا الجهاز فقط. هل تنقلها إلى حسابك لتتبعك إلى كل جهاز؟`
- **ja** 日本語: `一部のテーマはこのデバイスにのみ保存されています。どのデバイスにも付いてくるように、アカウントへ移しますか？`
- **zh-Hans** 简体中文: `有些主题仅保存在这台设备上。把它们移到你的账户，让它们跟随你到每台设备吗？`
- **hi** हिन्दी: `कुछ थीम सिर्फ़ इसी डिवाइस पर रखी हैं। इन्हें अपने अकाउंट में ले जाएँ, ताकि ये हर डिवाइस पर आपके साथ रहें?`
- **mr** मराठी: `काही थीम फक्त या डिव्हाइसवर ठेवल्या आहेत. त्या तुमच्या अकाउंटमध्ये हलवायच्या, म्हणजे त्या प्रत्येक डिव्हाइसवर तुमच्यासोबत येतील?`

### `next.themes.moveYes`

- **en** (source): Move them
- **es** Español: `Moverlos`
- **fr** Français: `Les déplacer`
- **de** Deutsch: `Verschieben`
- **it** Italiano: `Spostali`
- **pt** Português: `Movê-los`
- **nl** Nederlands: `Verplaats ze`
- **pl** Polski: `Przenieś je`
- **ru** Русский: `Перенести`
- **tr** Türkçe: `Taşı`
- **ar** العربية: `انقلها`
- **ja** 日本語: `移す`
- **zh-Hans** 简体中文: `移动`
- **hi** हिन्दी: `हाँ, ले जाएँ`
- **mr** मराठी: `हलवा`

### `next.themes.deviceSuffix`

- **en** (source):  (this device)
- **es** Español: ` (este dispositivo)`
- **fr** Français: ` (cet appareil)`
- **de** Deutsch: ` (dieses Gerät)`
- **it** Italiano: ` (questo dispositivo)`
- **pt** Português: ` (este dispositivo)`
- **nl** Nederlands: ` (dit apparaat)`
- **pl** Polski: ` (to urządzenie)`
- **ru** Русский: ` (это устройство)`
- **tr** Türkçe: ` (bu cihaz)`
- **ar** العربية: ` (هذا الجهاز)`
- **ja** 日本語: ` （このデバイス）`
- **zh-Hans** 简体中文: ` (这台设备)`
- **hi** हिन्दी: ` (यह डिवाइस)`
- **mr** मराठी: ` (हे डिव्हाइस)`

### `next.themes.conflict`

- **en** (source): “{name}” was changed on another device too. Both are kept: this device’s version is named “(this device)”.
- **es** Español: `«{name}» también se cambió en otro dispositivo. Se conservan ambos: la versión de este dispositivo se llama «(este dispositivo)».`
- **fr** Français: `« {name} » a aussi été modifié sur un autre appareil. Les deux sont gardés : la version de cet appareil s’appelle « (cet appareil) ».`
- **de** Deutsch: `Thema „{name}“ wurde auch auf einem anderen Gerät geändert. Beide bleiben erhalten: Die Version dieses Geräts heißt „(dieses Gerät)“.`
- **it** Italiano: `«{name}» è stato cambiato anche su un altro dispositivo. Restano entrambi: la versione di questo dispositivo si chiama «(questo dispositivo)».`
- **pt** Português: `«{name}» também foi alterado noutro dispositivo. Ficam ambos: a versão deste dispositivo chama-se «(este dispositivo)».`
- **nl** Nederlands: `„{name}” is ook op een ander apparaat gewijzigd. Beide blijven bewaard: de versie van dit apparaat heet „(dit apparaat)”.`
- **pl** Polski: `Motyw „{name}” zmieniono też na innym urządzeniu. Zachowano oba: wersja z tego urządzenia nazywa się „(to urządzenie)”.`
- **ru** Русский: `Тема «{name}» была изменена и на другом устройстве. Сохранены обе: версия с этого устройства называется «(это устройство)».`
- **tr** Türkçe: `“{name}” başka bir cihazda da değiştirildi. İkisi de saklandı: bu cihazın sürümünün adı “(bu cihaz)”.`
- **ar** العربية: `السمة «{name}» تغيّرت على جهاز آخر أيضًا. حُفظت النسختان: تحمل نسخة هذا الجهاز اسم «(هذا الجهاز)».`
- **ja** 日本語: `「{name}」は別のデバイスでも変更されました。両方とも保存してあります。このデバイスの版の名前は「（このデバイス）」です。`
- **zh-Hans** 简体中文: `“{name}”在另一台设备上也被更改了。两份都已保留：这台设备的版本名为“(这台设备)”。`
- **hi** हिन्दी: `“{name}” दूसरे डिवाइस पर भी बदली गई। दोनों रखी गई हैं: इस डिवाइस वाले संस्करण का नाम “(यह डिवाइस)” है।`
- **mr** मराठी: `“{name}” दुसऱ्या डिव्हाइसवरही बदलली गेली. दोन्ही ठेवल्या आहेत: या डिव्हाइसवरच्या आवृत्तीचे नाव “(हे डिव्हाइस)” आहे.`

### `next.themes.full`

- **en** (source): Themes for every book holds at most 200 themes. Remove one, then keep “{name}” again.
- **es** Español: `«Temas para todos los libros» admite como máximo 200 temas. Quita uno y vuelve a guardar «{name}».`
- **fr** Français: `« Thèmes pour tous les livres » contient 200 thèmes au maximum. Retirez-en un, puis gardez de nouveau « {name} ».`
- **de** Deutsch: `„Themen für alle Bücher“ fasst höchstens 200 Themen. Entfernen Sie eines, und behalten Sie dann „{name}“ erneut.`
- **it** Italiano: `«Temi per ogni libro» ne contiene al massimo 200. Rimuovine uno, poi conserva di nuovo «{name}».`
- **pt** Português: `«Temas para todos os livros» guarda no máximo 200 temas. Remova um e volte a guardar «{name}».`
- **nl** Nederlands: `„Thema's voor elk boek” bevat hooguit 200 thema's. Verwijder er een en bewaar „{name}” daarna opnieuw.`
- **pl** Polski: `„Motywy dla każdej książki” mogą liczyć najwyżej 200 motywów. Usuń jeden, a potem zachowaj „{name}” ponownie.`
- **ru** Русский: `В «Темах для каждой книги» помещается не больше 200 тем. Удалите одну, затем сохраните «{name}» снова.`
- **tr** Türkçe: `“Her kitap için temalar” en fazla 200 tema tutar. Birini kaldırın, sonra “{name}” temasını yeniden saklayın.`
- **ar** العربية: `تتّسع «سمات لكل كتاب» لـ 200 سمة على الأكثر. أزل واحدة، ثم احتفظ بـ«{name}» مرة أخرى.`
- **ja** 日本語: `「すべての本で使うテーマ」には最大 200 件まで保存できます。1 件削除してから、「{name}」をもう一度保存してください。`
- **zh-Hans** 简体中文: `“适用于每本书的主题”最多容纳 200 个主题。请移除一个，然后再次保留“{name}”。`
- **hi** हिन्दी: `“हर किताब के लिए थीम” में ज़्यादा से ज़्यादा 200 थीम रह सकती हैं। एक हटाएँ, फिर “{name}” को दोबारा रखें।`
- **mr** मराठी: `“प्रत्येक पुस्तकासाठी थीम” मध्ये जास्तीत जास्त 200 थीम ठेवता येतात. एखादी काढा, मग “{name}” पुन्हा ठेवा.`

### `next.themes.refused`

- **en** (source): “{name}” could not be kept with your account, so it stays on this device.
- **es** Español: `«{name}» no se pudo guardar en tu cuenta, así que se queda solo en este dispositivo.`
- **fr** Français: `« {name} » n’a pas pu être gardé avec votre compte ; il reste sur cet appareil.`
- **de** Deutsch: `Thema „{name}“ konnte nicht mit Ihrem Konto gespeichert werden und bleibt deshalb nur auf diesem Gerät.`
- **it** Italiano: `«{name}» non si è potuto conservare con il tuo account, quindi resta solo su questo dispositivo.`
- **pt** Português: `«{name}» não pôde ser guardado na sua conta, por isso fica só neste dispositivo.`
- **nl** Nederlands: `„{name}” kon niet bij uw account worden bewaard, dus blijft het op dit apparaat.`
- **pl** Polski: `Motywu „{name}” nie udało się zachować na twoim koncie, więc zostaje tylko na tym urządzeniu.`
- **ru** Русский: `Тему «{name}» не удалось сохранить в вашем аккаунте, поэтому она остаётся только на этом устройстве.`
- **tr** Türkçe: `“{name}” hesabınızla saklanamadı, bu yüzden yalnızca bu cihazda kalıyor.`
- **ar** العربية: `تعذّر حفظ السمة «{name}» مع حسابك، لذا تبقى على هذا الجهاز فقط.`
- **ja** 日本語: `「{name}」をアカウントに保存できなかったため、このデバイスにのみ残ります。`
- **zh-Hans** 简体中文: `“{name}”无法保存到你的账户，因此只留在这台设备上。`
- **hi** हिन्दी: `“{name}” आपके अकाउंट के साथ नहीं रखी जा सकी, इसलिए यह इसी डिवाइस पर रहेगी।`
- **mr** मराठी: `“{name}” तुमच्या अकाउंटसोबत ठेवता आली नाही, म्हणून ती या डिव्हाइसवरच राहते.`

## 2. Earlier sets still waiting

These were written in earlier work and are still not signed off. They are listed here by family and count, as the parity audit
(2026-11-12, section 2A, items 1 to 5) names them. Their key lists and English/draft text are NOT copied here: they are in the
reports named below, which are in the `step5-w1` worktree's `docs/superpowers/plans/` (that folder is untracked in git, so it
is not part of this branch).

| # | Family | Count | Where the text and the open questions are |
|---|---|---|---|
| 2A-2 | `lock.*` (lock a Word, manuscript or print export with a password) | 11 keys x 13 languages, drafts. Translation notes on German "sperren" and on Arabic `lock.toggle`. | `lockcopy-report.md`, "For V" 1 |
| 2A-3 | `beta.*` (named beta readers) | 20 keys, English in all 13 languages (not yet translated). | `named-links-report.md`, "For V" 1 |
| 2A-4 | `auth.*` and `backup.*` (authorship record, stamped backups) | 21 keys, machine-drafted in the 12 languages. Also parked: "two date styles in one dialog". The "seal" words that remain in pl, es and ar are left for V to decide. | `authorship-report.md`, "The new keys" and "Still open for you" |
| 2A-5 | `auth.code*` (two-step sign-in code step) | 6 keys x 13 languages. | `account-hardening-report.md`, "Every new user-visible string" |
| 2A-8 | `errs.note` (the error-report note, 13 languages) | 1 key. It still says the error message is sent; only the name and frames are now. New words needed. | `step5-wave7b-report.md`, "Still for V" |

(The brief for this task lists `errs.note` as the fifth item; in the audit it is item 8 of section 2A. It is listed here either way.)

Counts I checked against the generated English pack on 2026-11-12: `lock.*` is 11 keys, `auth.code*` is 6 keys, `errs.note` is 1 key,
and `next.*` is 22 keys. The `beta.*` count (20) and the authorship count (21) are the reports' own; the pack holds 79 `beta.*`
keys and 32 `auth.*` plus 10 `backup.*` keys in all, most of them long since signed off, so the pack alone cannot name which
are the pending ones. The reports are the list.

Total still waiting: 22 (this task) + 11 + 20 + 21 + 6 + 1 = 81 keys, counting each key once however many languages it has.
(That total is of 2026-11-12, sections 1 and 2 only. Section 3 below adds 24 keys, section 4 adds 7 and section 5 adds 26. Sets added between those two dates are not listed in this file: for example the 11 shelf-removal keys of 2026-11-20, `BEUK:shelfremove`, are marked as drafts only in `client/index.html`.)

## 3. The export screen: its groups and the proof (24 keys, 2026-11-23; the proof's link words changed 2026-11-24)

Studio 2.0's export screen offers a proof of the whole book first and puts the formats in six groups
(`studio/src/export/groups.ts`, `studio/src/export/Proof.tsx`). Its 24 keys are in `client/index.html` `UI_STRINGS`
(the `BEUK:exportproof` block, `EXPORTPROOF_STRINGS`): 12 `expg.*` keys (each group's name and its one line) and 12 `proof.*` keys.
English is the source. The 12 other languages below are drafts written by Claude: not approved, not read by a native speaker.

Changed on 2026-11-24, when the proof's frame was given the studio's own origin (links inside the book work; links that leave it are stopped):

- `proof.note`: its last sentence was "Links are switched off in this view." It now says links inside the book work and links that leave the book are off. All 12 drafts were reworded with it.
- `proof.linkOff`: it used to say the book was shown again from its first page. It now says the link leaves the book, such links are off, and the reader is where they were. All 12 drafts were written again.
- `proof.linkBack` is new (all 13 packs): the words for the one case where the book IS shown again from its first page (the frame left the book in a way nothing stopped).

How the drafts were made:

- The one placeholder (`{error}` in `proof.failed`) is kept byte for byte; `studio/test/export-proof-ui.test.tsx` checks it in every language.
- Words follow the neighbouring 1.0 strings in each language: the shelf, the archive, the box set, beta readers, the submission
  manuscript, trim size, the print check, and the name of "Standalone HTML" (`exp.htmlH`), which `proof.note` quotes.
- The address form follows each language's shelf strings (for example *tú* in Spanish, *vous* in French, *Sie* in German, *u* in Dutch).
- Quote marks follow each language's 1.0 strings.
- No exclamation marks anywhere (a test checks it).

Points worth a look when you read them:

- `expg.ebook` is the same letters as English in **it** and **pl** ("E-book (EPUB)"): the word is the same there.
- `expg.archive` ("Archive and sharing"): **ru** says "Архив и доступ для читателей" (archive and access for readers), because a bare noun for "sharing" reads oddly there; **es** says "Archivo y compartir".
- `proof.note` is the one long string. It says what the view is and where it differs from the EPUB (pages, the reader's own contents menu, typefaces) and what links do here. If the English changes, all 12 change.
- `proof.linkOff` ends "You are still where you were." Each language says this in its own address form (**de** "Sie sind noch an derselben Stelle", **nl** "U bent nog waar u was", **ja** speaks of the place being read).
- **de** uses the *Sie* form (the shelf strings do; the beta-reader strings in the 1.0 pack use *du*).
- **ja** and **zh-Hans** call a section セクション / 章节; check them against the word you want for "section" there.

### `expg.ebook`

- **en** (source): E-book (EPUB)
- **es** Español: `Libro electrónico (EPUB)`
- **fr** Français: `Livre numérique (EPUB)`
- **de** Deutsch: `E-Book (EPUB)`
- **it** Italiano: `E-book (EPUB)`
- **pt** Português: `Livro eletrónico (EPUB)`
- **nl** Nederlands: `E-boek (EPUB)`
- **pl** Polski: `E-book (EPUB)`
- **ru** Русский: `Электронная книга (EPUB)`
- **tr** Türkçe: `E-kitap (EPUB)`
- **ar** العربية: `كتاب إلكتروني (EPUB)`
- **ja** 日本語: `電子書籍（EPUB）`
- **zh-Hans** 简体中文: `电子书（EPUB）`
- **hi** हिन्दी: `ई-बुक (EPUB)`
- **mr** मराठी: `ई-बुक (EPUB)`

### `expg.ebookSub`

- **en** (source): Choose the store, check the package and download the EPUB.
- **es** Español: `Elige la tienda, comprueba el paquete y descarga el EPUB.`
- **fr** Français: `Choisissez la boutique, vérifiez le paquet et téléchargez l'EPUB.`
- **de** Deutsch: `Shop wählen, Paket prüfen und das EPUB herunterladen.`
- **it** Italiano: `Scegli lo store, controlla il pacchetto e scarica l'EPUB.`
- **pt** Português: `Escolha a loja, verifique o pacote e transfira o EPUB.`
- **nl** Nederlands: `Kies de winkel, controleer het pakket en download de EPUB.`
- **pl** Polski: `Wybierz sklep, sprawdź pakiet i pobierz EPUB.`
- **ru** Русский: `Выберите магазин, проверьте пакет и скачайте EPUB.`
- **tr** Türkçe: `Mağazayı seçin, paketi denetleyin ve EPUB'ı indirin.`
- **ar** العربية: `اختر المتجر، وافحص الحزمة، ونزّل ملف EPUB.`
- **ja** 日本語: `ストアを選び、パッケージを確認して、EPUBをダウンロードします。`
- **zh-Hans** 简体中文: `选择书店，检查文件包，下载 EPUB。`
- **hi** हिन्दी: `स्टोर चुनें, पैकेज की जाँच करें और EPUB डाउनलोड करें।`
- **mr** मराठी: `स्टोअर निवडा, पॅकेज तपासा आणि EPUB डाउनलोड करा.`

### `expg.print`

- **en** (source): Print
- **es** Español: `Impresión`
- **fr** Français: `Impression`
- **de** Deutsch: `Druck`
- **it** Italiano: `Stampa`
- **pt** Português: `Impressão`
- **nl** Nederlands: `Druk`
- **pl** Polski: `Druk`
- **ru** Русский: `Печать`
- **tr** Türkçe: `Baskı`
- **ar** العربية: `الطباعة`
- **ja** 日本語: `印刷`
- **zh-Hans** 简体中文: `印刷`
- **hi** हिन्दी: `प्रिंट`
- **mr** मराठी: `प्रिंट`

### `expg.printSub`

- **en** (source): Trim size, margins, the print check and the print-ready PDF.
- **es** Español: `Tamaño de corte, márgenes, la comprobación previa y el PDF listo para imprimir.`
- **fr** Français: `Format de coupe, marges, contrôle prépresse et PDF prêt à imprimer.`
- **de** Deutsch: `Beschnittformat, Ränder, Druckvorstufen-Prüfung und das druckfertige PDF.`
- **it** Italiano: `Formato di taglio, margini, controllo prestampa e PDF pronto per la stampa.`
- **pt** Português: `Tamanho de corte, margens, verificação pré-impressão e o PDF pronto para impressão.`
- **nl** Nederlands: `Snijformaat, marges, de drukvoorcontrole en de drukklare pdf.`
- **pl** Polski: `Format cięcia, marginesy, kontrola przeddrukowa i PDF gotowy do druku.`
- **ru** Русский: `Обрезной формат, поля, предпечатная проверка и PDF, готовый к печати.`
- **tr** Türkçe: `Kesim boyutu, kenar boşlukları, baskı öncesi kontrol ve baskıya hazır PDF.`
- **ar** العربية: `حجم القص، والهوامش، والفحص قبل الطباعة، وملف PDF الجاهز للطباعة.`
- **ja** 日本語: `仕上がりサイズ、余白、印刷プリフライト、印刷用PDF。`
- **zh-Hans** 简体中文: `裁切尺寸、页边距、印前检查和可印刷 PDF。`
- **hi** हिन्दी: `ट्रिम साइज़, मार्जिन, प्रिंट की जाँच और प्रिंट के लिए तैयार PDF।`
- **mr** मराठी: `ट्रिम साइझ, समास, प्रिंट तपासणी आणि प्रिंटसाठी तयार PDF.`

### `expg.files`

- **en** (source): Manuscript and other files
- **es** Español: `Manuscrito y otros archivos`
- **fr** Français: `Manuscrit et autres fichiers`
- **de** Deutsch: `Manuskript und andere Dateien`
- **it** Italiano: `Manoscritto e altri file`
- **pt** Português: `Manuscrito e outros ficheiros`
- **nl** Nederlands: `Manuscript en andere bestanden`
- **pl** Polski: `Maszynopis i inne pliki`
- **ru** Русский: `Рукопись и другие файлы`
- **tr** Türkçe: `Müsvedde ve diğer dosyalar`
- **ar** العربية: `المخطوطة وملفات أخرى`
- **ja** 日本語: `原稿とその他のファイル`
- **zh-Hans** 简体中文: `稿件和其他文件`
- **hi** हिन्दी: `पांडुलिपि और दूसरी फ़ाइलें`
- **mr** मराठी: `हस्तलिखित आणि इतर फाइल`

### `expg.filesSub`

- **en** (source): Markdown, a web page, Word and the submission manuscript.
- **es** Español: `Markdown, una página web, Word y el manuscrito para envío.`
- **fr** Français: `Markdown, une page web, Word et le manuscrit de soumission.`
- **de** Deutsch: `Markdown, eine Webseite, Word und das Einsendungsmanuskript.`
- **it** Italiano: `Markdown, una pagina web, Word e il manoscritto per l'invio.`
- **pt** Português: `Markdown, uma página web, Word e o manuscrito para submissão.`
- **nl** Nederlands: `Markdown, een webpagina, Word en het inzendmanuscript.`
- **pl** Polski: `Markdown, strona internetowa, Word i maszynopis do wysyłki.`
- **ru** Русский: `Markdown, веб-страница, Word и рукопись для подачи.`
- **tr** Türkçe: `Markdown, bir web sayfası, Word ve gönderim müsveddesi.`
- **ar** العربية: `Markdown، وصفحة ويب، وWord، ومخطوطة التقديم.`
- **ja** 日本語: `Markdown、ウェブページ、Word、投稿用原稿。`
- **zh-Hans** 简体中文: `Markdown、网页、Word 和投稿稿件。`
- **hi** हिन्दी: `Markdown, वेब पेज, Word और भेजने के लिए पांडुलिपि।`
- **mr** मराठी: `Markdown, वेब पान, Word आणि पाठवण्यासाठीचे हस्तलिखित.`

### `expg.audio`

- **en** (source): Audiobook script
- **es** Español: `Guion de audiolibro`
- **fr** Français: `Script de livre audio`
- **de** Deutsch: `Hörbuch-Skript`
- **it** Italiano: `Copione per audiolibro`
- **pt** Português: `Guião de audiolivro`
- **nl** Nederlands: `Luisterboekscript`
- **pl** Polski: `Skrypt audiobooka`
- **ru** Русский: `Сценарий аудиокниги`
- **tr** Türkçe: `Sesli kitap metni`
- **ar** العربية: `نص الكتاب الصوتي`
- **ja** 日本語: `オーディオブック台本`
- **zh-Hans** 简体中文: `有声书脚本`
- **hi** हिन्दी: `ऑडियोबुक स्क्रिप्ट`
- **mr** मराठी: `ऑडिओबुक स्क्रिप्ट`

### `expg.audioSub`

- **en** (source): Narrator scripts in ACX order.
- **es** Español: `Guiones para el narrador en el orden de ACX.`
- **fr** Français: `Des scripts de narration dans l'ordre ACX.`
- **de** Deutsch: `Sprecherskripte in ACX-Reihenfolge.`
- **it** Italiano: `Copioni per il narratore nell'ordine ACX.`
- **pt** Português: `Guiões para o narrador na ordem ACX.`
- **nl** Nederlands: `Vertellersscripts in ACX-volgorde.`
- **pl** Polski: `Skrypty dla lektora w kolejności ACX.`
- **ru** Русский: `Сценарии для чтеца в порядке ACX.`
- **tr** Türkçe: `ACX sırasına göre anlatıcı metinleri.`
- **ar** العربية: `نصوص للراوي بترتيب ACX.`
- **ja** 日本語: `ACXの順序で並べたナレーター用台本。`
- **zh-Hans** 简体中文: `按 ACX 顺序排列的朗读者脚本。`
- **hi** हिन्दी: `ACX के क्रम में कथावाचक के लिए स्क्रिप्ट।`
- **mr** मराठी: `ACX क्रमाने निवेदकासाठी स्क्रिप्ट.`

### `expg.boxset`

- **en** (source): Box set
- **es** Español: `Estuche`
- **fr** Français: `Coffret`
- **de** Deutsch: `Box-Set`
- **it** Italiano: `Cofanetto`
- **pt** Português: `Conjunto`
- **nl** Nederlands: `Boxset`
- **pl** Polski: `Zestaw`
- **ru** Русский: `Бокс-сет`
- **tr** Türkçe: `Kutu seti`
- **ar** العربية: `مجموعة صندوقية`
- **ja** 日本語: `ボックスセット`
- **zh-Hans** 简体中文: `套装`
- **hi** हिन्दी: `बॉक्स सेट`
- **mr** मराठी: `बॉक्स सेट`

### `expg.boxsetSub`

- **en** (source): Several books in one EPUB.
- **es** Español: `Varios libros en un solo EPUB.`
- **fr** Français: `Plusieurs livres dans un seul EPUB.`
- **de** Deutsch: `Mehrere Bücher in einem EPUB.`
- **it** Italiano: `Più libri in un solo EPUB.`
- **pt** Português: `Vários livros num só EPUB.`
- **nl** Nederlands: `Meerdere boeken in één EPUB.`
- **pl** Polski: `Kilka książek w jednym EPUB.`
- **ru** Русский: `Несколько книг в одном EPUB.`
- **tr** Türkçe: `Tek bir EPUB içinde birkaç kitap.`
- **ar** العربية: `عدة كتب في ملف EPUB واحد.`
- **ja** 日本語: `複数の本を1つのEPUBに。`
- **zh-Hans** 简体中文: `多本书合为一个 EPUB。`
- **hi** हिन्दी: `कई किताबें एक EPUB में।`
- **mr** मराठी: `एकाच EPUB मध्ये अनेक पुस्तके.`

### `expg.archive`

- **en** (source): Archive and sharing
- **es** Español: `Archivo y compartir`
- **fr** Français: `Archive et partage`
- **de** Deutsch: `Archiv und Teilen`
- **it** Italiano: `Archivio e condivisione`
- **pt** Português: `Arquivo e partilha`
- **nl** Nederlands: `Archief en delen`
- **pl** Polski: `Archiwum i udostępnianie`
- **ru** Русский: `Архив и доступ для читателей`
- **tr** Türkçe: `Arşiv ve paylaşım`
- **ar** العربية: `الأرشيف والمشاركة`
- **ja** 日本語: `保管庫と共有`
- **zh-Hans** 简体中文: `存档与分享`
- **hi** हिन्दी: `संग्रह और शेयर करना`
- **mr** मराठी: `संग्रह आणि शेअरिंग`

### `expg.archiveSub`

- **en** (source): Finished files kept on your shelf, and reading links for beta readers.
- **es** Español: `Archivos terminados guardados en tu estantería y enlaces de lectura para lectores beta.`
- **fr** Français: `Les fichiers terminés gardés sur votre étagère, et les liens de lecture pour vos bêta-lecteurs.`
- **de** Deutsch: `Fertige Dateien in Ihrem Regal und Leselinks für Testleser.`
- **it** Italiano: `I file finiti conservati nella tua libreria e i link di lettura per i beta reader.`
- **pt** Português: `Ficheiros terminados guardados na sua estante e ligações de leitura para leitores beta.`
- **nl** Nederlands: `Afgeronde bestanden op uw boekenplank, en leeslinks voor proeflezers.`
- **pl** Polski: `Gotowe pliki przechowywane na twojej półce oraz linki do czytania dla betaczytelników.`
- **ru** Русский: `Готовые файлы на вашей полке и ссылки для чтения для бета-читателей.`
- **tr** Türkçe: `Rafınızda saklanan bitmiş dosyalar ve beta okurlar için okuma bağlantıları.`
- **ar** العربية: `الملفات المنجزة المحفوظة على رفّك، وروابط القراءة للقرّاء التجريبيين.`
- **ja** 日本語: `本棚に保管した完成ファイルと、ベータ読者向けの閲覧リンク。`
- **zh-Hans** 简体中文: `保存在你书架上的成品文件，以及给试读读者的阅读链接。`
- **hi** हिन्दी: `आपके शेल्फ़ पर रखी तैयार फ़ाइलें, और बीटा पाठकों के लिए पढ़ने के लिंक।`
- **mr** मराठी: `तुमच्या शेल्फवर ठेवलेल्या तयार फाइल, आणि बीटा वाचकांसाठी वाचनाच्या लिंक.`

### `proof.h`

- **en** (source): See the whole book first
- **es** Español: `Mira primero el libro entero`
- **fr** Français: `Voir d'abord le livre en entier`
- **de** Deutsch: `Erst das ganze Buch ansehen`
- **it** Italiano: `Guarda prima il libro intero`
- **pt** Português: `Veja primeiro o livro inteiro`
- **nl** Nederlands: `Bekijk eerst het hele boek`
- **pl** Polski: `Najpierw zobacz całą książkę`
- **ru** Русский: `Сначала посмотрите книгу целиком`
- **tr** Türkçe: `Önce kitabın tamamına bakın`
- **ar** العربية: `شاهد الكتاب كاملًا أولًا`
- **ja** 日本語: `まず本全体を見る`
- **zh-Hans** 简体中文: `先看完整本书`
- **hi** हिन्दी: `पहले पूरी किताब देखें`
- **mr** मराठी: `आधी पूर्ण पुस्तक पाहा`

### `proof.sub`

- **en** (source): You can go through the whole book, first page to last, before you export it. Every export works without this.
- **es** Español: `Puedes recorrer el libro entero, de la primera página a la última, antes de exportarlo. Todas las exportaciones funcionan sin este paso.`
- **fr** Français: `Vous pouvez parcourir le livre en entier, de la première page à la dernière, avant de l'exporter. Tous les exports fonctionnent sans cette étape.`
- **de** Deutsch: `Sie können das ganze Buch von der ersten bis zur letzten Seite durchgehen, bevor Sie es exportieren. Jeder Export funktioniert auch ohne diesen Schritt.`
- **it** Italiano: `Puoi scorrere il libro intero, dalla prima pagina all'ultima, prima di esportarlo. Ogni esportazione funziona anche senza questo passaggio.`
- **pt** Português: `Pode percorrer o livro inteiro, da primeira página à última, antes de o exportar. Todas as exportações funcionam sem este passo.`
- **nl** Nederlands: `U kunt het hele boek doorlopen, van de eerste tot de laatste pagina, voordat u het exporteert. Elke export werkt ook zonder deze stap.`
- **pl** Polski: `Możesz przejrzeć całą książkę, od pierwszej strony do ostatniej, zanim ją wyeksportujesz. Każdy eksport działa także bez tego kroku.`
- **ru** Русский: `Перед экспортом можно пройти всю книгу от первой страницы до последней. Любой экспорт работает и без этого шага.`
- **tr** Türkçe: `Dışa aktarmadan önce kitabın tamamını ilk sayfadan son sayfaya kadar gözden geçirebilirsiniz. Her dışa aktarma bu adım olmadan da çalışır.`
- **ar** العربية: `يمكنك تصفّح الكتاب كاملًا، من صفحته الأولى إلى الأخيرة، قبل تصديره. كل تصدير يعمل من دون هذه الخطوة.`
- **ja** 日本語: `書き出す前に、最初のページから最後のページまで本全体を通して確認できます。確認しなくても、どの書き出しも使えます。`
- **zh-Hans** 简体中文: `导出之前，你可以把整本书从第一页看到最后一页。不看也可以，任何导出都照常可用。`
- **hi** हिन्दी: `एक्सपोर्ट करने से पहले आप पूरी किताब, पहले पेज से आखिरी तक, देख सकते हैं। हर एक्सपोर्ट इसके बिना भी काम करता है।`
- **mr** मराठी: `एक्सपोर्ट करण्याआधी तुम्ही पहिल्या पानापासून शेवटच्या पानापर्यंत पूर्ण पुस्तक पाहू शकता. हे न करताही प्रत्येक एक्सपोर्ट चालतो.`

### `proof.read`

- **en** (source): Read the whole book on screen
- **es** Español: `Leer el libro entero en pantalla`
- **fr** Français: `Lire le livre en entier à l'écran`
- **de** Deutsch: `Das ganze Buch am Bildschirm lesen`
- **it** Italiano: `Leggi il libro intero a schermo`
- **pt** Português: `Ler o livro inteiro no ecrã`
- **nl** Nederlands: `Het hele boek op het scherm lezen`
- **pl** Polski: `Przeczytaj całą książkę na ekranie`
- **ru** Русский: `Прочитать всю книгу на экране`
- **tr** Türkçe: `Kitabın tamamını ekranda oku`
- **ar** العربية: `اقرأ الكتاب كاملًا على الشاشة`
- **ja** 日本語: `本全体を画面で読む`
- **zh-Hans** 简体中文: `在屏幕上通读整本书`
- **hi** हिन्दी: `पूरी किताब स्क्रीन पर पढ़ें`
- **mr** मराठी: `पूर्ण पुस्तक स्क्रीनवर वाचा`

### `proof.print`

- **en** (source): Turn the print pages
- **es** Español: `Pasar las páginas impresas`
- **fr** Français: `Tourner les pages imprimées`
- **de** Deutsch: `Die Druckseiten durchblättern`
- **it** Italiano: `Sfoglia le pagine di stampa`
- **pt** Português: `Folhear as páginas de impressão`
- **nl** Nederlands: `Door de drukpagina's bladeren`
- **pl** Polski: `Przewracaj strony do druku`
- **ru** Русский: `Листать печатные страницы`
- **tr** Türkçe: `Baskı sayfalarını çevir`
- **ar** العربية: `قلّب صفحات الطباعة`
- **ja** 日本語: `印刷ページをめくる`
- **zh-Hans** 简体中文: `翻看印刷页面`
- **hi** हिन्दी: `प्रिंट के पेज पलटें`
- **mr** मराठी: `प्रिंटची पाने उलटा`

### `proof.title`

- **en** (source): The whole book, first page to last
- **es** Español: `El libro entero, de la primera página a la última`
- **fr** Français: `Le livre en entier, de la première page à la dernière`
- **de** Deutsch: `Das ganze Buch, von der ersten bis zur letzten Seite`
- **it** Italiano: `Il libro intero, dalla prima pagina all'ultima`
- **pt** Português: `O livro inteiro, da primeira página à última`
- **nl** Nederlands: `Het hele boek, van de eerste tot de laatste pagina`
- **pl** Polski: `Cała książka, od pierwszej strony do ostatniej`
- **ru** Русский: `Вся книга, от первой страницы до последней`
- **tr** Türkçe: `Kitabın tamamı, ilk sayfadan son sayfaya`
- **ar** العربية: `الكتاب كاملًا، من الصفحة الأولى إلى الأخيرة`
- **ja** 日本語: `本全体、最初のページから最後のページまで`
- **zh-Hans** 简体中文: `整本书，从第一页到最后一页`
- **hi** हिन्दी: `पूरी किताब, पहले पेज से आखिरी तक`
- **mr** मराठी: `पूर्ण पुस्तक, पहिल्या पानापासून शेवटपर्यंत`

### `proof.note`

- **en** (source): This is the page “Standalone HTML” downloads: the EPUB's sections, notes and pictures, in the same order, with the same stylesheet. An e-reader shows them as pages with its own contents menu, and the typefaces here can differ from the EPUB's. Links inside the book work here; links that leave the book are off.
- **es** Español: `Esta es la página que descarga «HTML independiente»: las secciones, las notas y las imágenes del EPUB, en el mismo orden y con la misma hoja de estilo. Un lector electrónico las muestra en páginas con su propio menú de contenido, y las tipografías de aquí pueden ser distintas de las del EPUB. Los enlaces dentro del libro funcionan aquí; los que salen del libro están desactivados.`
- **fr** Français: `Voici la page que télécharge « HTML autonome » : les sections, les notes et les images de l'EPUB, dans le même ordre, avec la même feuille de style. Une liseuse les présente en pages avec son propre menu de sommaire, et les polices affichées ici peuvent différer de celles de l'EPUB. Les liens internes au livre fonctionnent ici ; ceux qui sortent du livre sont désactivés.`
- **de** Deutsch: `Dies ist die Seite, die „Eigenständiges HTML“ herunterlädt: die Abschnitte, Anmerkungen und Bilder des EPUB, in derselben Reihenfolge und mit demselben Stylesheet. Ein E-Reader zeigt sie als Seiten mit eigenem Inhaltsmenü, und die Schriften hier können von denen im EPUB abweichen. Links innerhalb des Buchs funktionieren hier; Links, die aus dem Buch hinausführen, sind abgeschaltet.`
- **it** Italiano: `Questa è la pagina che «HTML autonomo» scarica: le sezioni, le note e le immagini dell'EPUB, nello stesso ordine e con lo stesso foglio di stile. Un e-reader le mostra in pagine con il suo menu dei contenuti, e i caratteri qui possono essere diversi da quelli dell'EPUB. I link interni al libro qui funzionano; quelli che escono dal libro sono disattivati.`
- **pt** Português: `Esta é a página que «HTML autónomo» transfere: as secções, as notas e as imagens do EPUB, pela mesma ordem e com a mesma folha de estilo. Um leitor de livros eletrónicos mostra-as em páginas com o seu próprio menu de conteúdos, e os tipos de letra aqui podem ser diferentes dos do EPUB. As ligações dentro do livro funcionam aqui; as que saem do livro estão desligadas.`
- **nl** Nederlands: `Dit is de pagina die “Zelfstandige HTML” downloadt: de secties, noten en afbeeldingen van de EPUB, in dezelfde volgorde en met hetzelfde stijlblad. Een e-reader toont ze als pagina's met een eigen inhoudsmenu, en de lettertypen hier kunnen afwijken van die in de EPUB. Links binnen het boek werken hier; links die het boek verlaten zijn uitgeschakeld.`
- **pl** Polski: `To jest strona, którą pobiera „Samodzielny HTML”: sekcje, przypisy i ilustracje z EPUB, w tej samej kolejności i z tym samym arkuszem stylów. Czytnik pokazuje je jako strony z własnym menu spisu treści, a kroje pisma tutaj mogą różnić się od tych w EPUB. Linki wewnątrz książki tutaj działają; linki prowadzące poza książkę są wyłączone.`
- **ru** Русский: `Это страница, которую скачивает «Автономный HTML»: разделы, примечания и иллюстрации EPUB в том же порядке и с той же таблицей стилей. Читалка показывает их постранично, со своим меню оглавления, а шрифты здесь могут отличаться от шрифтов в EPUB. Ссылки внутри книги здесь работают; ссылки, ведущие за пределы книги, отключены.`
- **tr** Türkçe: `Bu, “Bağımsız HTML”nin indirdiği sayfadır: EPUB'ın bölümleri, notları ve resimleri, aynı sırayla ve aynı stil sayfasıyla. Bir e-okuyucu bunları kendi içindekiler menüsüyle sayfalar hâlinde gösterir; buradaki yazı tipleri EPUB'dakilerden farklı olabilir. Kitabın içindeki bağlantılar burada çalışır; kitabın dışına çıkan bağlantılar kapalıdır.`
- **ar** العربية: `هذه هي الصفحة التي ينزّلها «HTML مستقل»: أقسام ملف EPUB وحواشيه وصوره، بالترتيب نفسه وبورقة الأنماط نفسها. يعرضها القارئ الإلكتروني صفحاتٍ مع قائمة محتوياته الخاصة، وقد تختلف الخطوط هنا عن خطوط ملف EPUB. الروابط داخل الكتاب تعمل هنا؛ أما الروابط التي تخرج من الكتاب فمعطّلة.`
- **ja** 日本語: `これは「単独HTML」がダウンロードするページです。EPUBと同じセクション、注、画像が、同じ順序、同じスタイルシートで並びます。電子書籍リーダーはこれをページに分け、独自の目次メニューを付けます。ここでの書体はEPUBと異なる場合があります。本の中のリンクはここで使えます。本の外へ出るリンクは無効です。`
- **zh-Hans** 简体中文: `这就是“独立 HTML”下载的页面：EPUB 的各个章节、注释和图片，顺序相同，样式表相同。电子书阅读器会把它们分页显示，并带有自己的目录菜单；这里的字体可能与 EPUB 中的不同。书内的链接在这里可用；通往书外的链接已关闭。`
- **hi** हिन्दी: `यह वही पेज है जो “Standalone HTML” डाउनलोड करता है: EPUB के सेक्शन, नोट और तस्वीरें, उसी क्रम में, उसी स्टाइलशीट के साथ। ई-रीडर इन्हें अपने विषय-सूची मेन्यू के साथ पेजों के रूप में दिखाता है, और यहाँ के टाइपफ़ेस EPUB वालों से अलग हो सकते हैं। किताब के अंदर के लिंक यहाँ काम करते हैं; किताब से बाहर ले जाने वाले लिंक बंद हैं।`
- **mr** मराठी: `“Standalone HTML” जे पान डाउनलोड करते तेच हे आहे: EPUB चे विभाग, टीपा आणि चित्रे, त्याच क्रमाने, त्याच स्टाइलशीटसह. ई-रीडर ते स्वतःच्या अनुक्रमणिका मेनूसह पानांच्या रूपात दाखवतो, आणि इथले टाइपफेस EPUB पेक्षा वेगळे असू शकतात. पुस्तकाच्या आतल्या लिंक इथे चालतात; पुस्तकाबाहेर नेणाऱ्या लिंक बंद आहेत.`

### `proof.preparing`

- **en** (source): Preparing the book…
- **es** Español: `Preparando el libro…`
- **fr** Français: `Préparation du livre…`
- **de** Deutsch: `Das Buch wird vorbereitet…`
- **it** Italiano: `Preparazione del libro…`
- **pt** Português: `A preparar o livro…`
- **nl** Nederlands: `Het boek wordt voorbereid…`
- **pl** Polski: `Przygotowywanie książki…`
- **ru** Русский: `Книга готовится…`
- **tr** Türkçe: `Kitap hazırlanıyor…`
- **ar** العربية: `جارٍ تجهيز الكتاب…`
- **ja** 日本語: `本を準備しています…`
- **zh-Hans** 简体中文: `正在准备这本书…`
- **hi** हिन्दी: `किताब तैयार हो रही है…`
- **mr** मराठी: `पुस्तक तयार होत आहे…`

### `proof.empty`

- **en** (source): There is nothing to show yet: every section of this book is empty or left out of the book.
- **es** Español: `Todavía no hay nada que mostrar: todas las secciones de este libro están vacías o fuera del libro.`
- **fr** Français: `Il n'y a encore rien à montrer : toutes les sections de ce livre sont vides ou laissées hors du livre.`
- **de** Deutsch: `Es gibt noch nichts zu zeigen: Jeder Abschnitt dieses Buchs ist leer oder nicht ins Buch aufgenommen.`
- **it** Italiano: `Non c'è ancora niente da mostrare: tutte le sezioni di questo libro sono vuote o escluse dal libro.`
- **pt** Português: `Ainda não há nada para mostrar: todas as secções deste livro estão vazias ou fora do livro.`
- **nl** Nederlands: `Er is nog niets te tonen: elke sectie van dit boek is leeg of buiten het boek gelaten.`
- **pl** Polski: `Nie ma jeszcze nic do pokazania: każda sekcja tej książki jest pusta albo pominięta w książce.`
- **ru** Русский: `Показывать пока нечего: все разделы этой книги пусты или не включены в книгу.`
- **tr** Türkçe: `Henüz gösterilecek bir şey yok: bu kitabın her bölümü boş ya da kitabın dışında bırakılmış.`
- **ar** العربية: `لا شيء يُعرض بعد: كل أقسام هذا الكتاب فارغة أو مستبعدة من الكتاب.`
- **ja** 日本語: `まだ表示するものがありません。この本のセクションはすべて空か、本から外されています。`
- **zh-Hans** 简体中文: `还没有可显示的内容：这本书的每个章节都是空的，或未收入书中。`
- **hi** हिन्दी: `अभी दिखाने के लिए कुछ नहीं है: इस किताब का हर सेक्शन खाली है या किताब से बाहर रखा गया है।`
- **mr** मराठी: `अजून दाखवण्यासारखे काही नाही: या पुस्तकाचा प्रत्येक विभाग रिकामा आहे किंवा पुस्तकातून वगळलेला आहे.`

### `proof.failed`

- **en** (source): The book could not be prepared. The error was: {error}
- **es** Español: `No se pudo preparar el libro. El error fue: {error}`
- **fr** Français: `Le livre n'a pas pu être préparé. L'erreur était : {error}`
- **de** Deutsch: `Das Buch konnte nicht vorbereitet werden. Der Fehler war: {error}`
- **it** Italiano: `Non è stato possibile preparare il libro. L'errore era: {error}`
- **pt** Português: `Não foi possível preparar o livro. O erro foi: {error}`
- **nl** Nederlands: `Het boek kon niet worden voorbereid. De fout was: {error}`
- **pl** Polski: `Nie udało się przygotować książki. Błąd: {error}`
- **ru** Русский: `Не удалось подготовить книгу. Ошибка: {error}`
- **tr** Türkçe: `Kitap hazırlanamadı. Hata şuydu: {error}`
- **ar** العربية: `تعذّر تجهيز الكتاب. الخطأ: {error}`
- **ja** 日本語: `本を準備できませんでした。エラー：{error}`
- **zh-Hans** 简体中文: `无法准备这本书。错误：{error}`
- **hi** हिन्दी: `किताब तैयार नहीं हो सकी। गड़बड़ी यह थी: {error}`
- **mr** मराठी: `पुस्तक तयार करता आले नाही. त्रुटी अशी होती: {error}`

### `proof.frame`

- **en** (source): The whole book
- **es** Español: `El libro entero`
- **fr** Français: `Le livre en entier`
- **de** Deutsch: `Das ganze Buch`
- **it** Italiano: `Il libro intero`
- **pt** Português: `O livro inteiro`
- **nl** Nederlands: `Het hele boek`
- **pl** Polski: `Cała książka`
- **ru** Русский: `Вся книга`
- **tr** Türkçe: `Kitabın tamamı`
- **ar** العربية: `الكتاب كاملًا`
- **ja** 日本語: `本全体`
- **zh-Hans** 简体中文: `整本书`
- **hi** हिन्दी: `पूरी किताब`
- **mr** मराठी: `पूर्ण पुस्तक`

### `proof.linkOff`

- **en** (source): That link leaves the book, and links out of the book are off in this view. You are still where you were.
- **es** Español: `Ese enlace sale del libro, y en esta vista los enlaces que salen del libro están desactivados. Sigues donde estabas.`
- **fr** Français: `Ce lien sort du livre, et les liens qui sortent du livre sont désactivés dans cette vue. Vous êtes toujours au même endroit.`
- **de** Deutsch: `Dieser Link führt aus dem Buch hinaus, und solche Links sind in dieser Ansicht abgeschaltet. Sie sind noch an derselben Stelle.`
- **it** Italiano: `Quel link esce dal libro, e in questa vista i link che escono dal libro sono disattivati. Sei ancora dove eri.`
- **pt** Português: `Essa ligação sai do livro, e nesta vista as ligações que saem do livro estão desligadas. Continua onde estava.`
- **nl** Nederlands: `Die link verlaat het boek, en links die het boek verlaten zijn in deze weergave uitgeschakeld. U bent nog waar u was.`
- **pl** Polski: `Ten link prowadzi poza książkę, a w tym widoku takie linki są wyłączone. Jesteś nadal w tym samym miejscu.`
- **ru** Русский: `Эта ссылка ведёт за пределы книги, а такие ссылки в этом виде отключены. Вы остались на том же месте.`
- **tr** Türkçe: `Bu bağlantı kitabın dışına çıkıyor ve bu görünümde kitabın dışına çıkan bağlantılar kapalıdır. Hâlâ bulunduğunuz yerdesiniz.`
- **ar** العربية: `هذا الرابط يخرج من الكتاب، والروابط التي تخرج من الكتاب معطّلة في هذا العرض. ما زلت في مكانك.`
- **ja** 日本語: `このリンクは本の外へ出ます。この表示では本の外へ出るリンクは無効です。読んでいた場所はそのままです。`
- **zh-Hans** 简体中文: `这个链接通往书外，而此视图中通往书外的链接已关闭。你仍在原来的位置。`
- **hi** हिन्दी: `यह लिंक किताब से बाहर ले जाता है, और इस व्यू में किताब से बाहर के लिंक बंद हैं। आप वहीं हैं जहाँ थे।`
- **mr** मराठी: `ही लिंक पुस्तकाबाहेर नेते, आणि या दृश्यात पुस्तकाबाहेरच्या लिंक बंद आहेत. तुम्ही आहात तिथेच आहात.`

### `proof.linkBack`

- **en** (source): The view left the book, so the book is shown again from its first page.
- **es** Español: `La vista salió del libro, así que el libro se muestra otra vez desde su primera página.`
- **fr** Français: `La vue a quitté le livre ; le livre est donc affiché de nouveau depuis sa première page.`
- **de** Deutsch: `Die Ansicht hat das Buch verlassen, deshalb wird das Buch wieder ab der ersten Seite gezeigt.`
- **it** Italiano: `La vista è uscita dal libro, quindi il libro viene mostrato di nuovo dalla prima pagina.`
- **pt** Português: `A vista saiu do livro, por isso o livro é mostrado de novo a partir da primeira página.`
- **nl** Nederlands: `De weergave heeft het boek verlaten, dus het boek wordt opnieuw vanaf de eerste pagina getoond.`
- **pl** Polski: `Widok opuścił książkę, więc książka jest znów pokazana od pierwszej strony.`
- **ru** Русский: `Вид ушёл из книги, поэтому книга снова показана с первой страницы.`
- **tr** Türkçe: `Görünüm kitaptan çıktı; bu yüzden kitap yeniden ilk sayfasından gösteriliyor.`
- **ar** العربية: `خرج العرض من الكتاب، لذا يُعرض الكتاب من جديد من صفحته الأولى.`
- **ja** 日本語: `表示が本から離れたため、本を最初のページからもう一度表示しています。`
- **zh-Hans** 简体中文: `视图离开了这本书，因此这本书从第一页重新显示。`
- **hi** हिन्दी: `व्यू किताब से बाहर चला गया था, इसलिए किताब फिर से उसके पहले पेज से दिखाई जा रही है।`
- **mr** मराठी: `दृश्य पुस्तकाबाहेर गेले, म्हणून पुस्तक पुन्हा पहिल्या पानापासून दाखवले आहे.`

## 4. Poem Mode (7 keys, 2026-11-24)

Poem Mode marks a chapter as a poem (`studio/src/editor/PoemMode.tsx`, `poem.ts`). Its 7 keys are in `client/index.html` `UI_STRINGS`
(the `BEUK:poemmode` block, `POEMMODE_STRINGS`). English is the source. The 12 other languages below are drafts written by Claude:
not approved, not read by a native speaker.

What each one is:

- `poem.mode`: the name of the P button in the editor's toolbar (its tooltip and what a screen reader says) and the label of the strip under the toolbar. The stylesheet shows the label in capitals where the script has them.
- `poem.alignAria`: what a screen reader calls the Centred / Left choice. It is never shown on screen.
- `poem.titlePh`: the placeholder of the chapter-title field while a poem has no text yet. A placeholder only: it is never written to the book.
- `poem.ghost1`, `poem.ghost2`, `poem.ghost3`: the three starter lines shown in an empty poem, one under the other. They read on from one another, so each language keeps the ellipsis at the end of the first, at both ends of the second and at the start of the third (a test checks that). They are never written to the book.
- `tool.verseInPoem`: the tooltip of the Verse tool while it is switched off in a poem. It opens with the language's own name for the Verse tool (`tool.verse`) and a dash, as `tool.verseTitle` does.

Not new, and so not on this list: the two choices themselves use the cover maker's existing words, `creator.alignCenter` and `creator.alignLeft`
(and `creator.alignRight` in a right-to-left book, where a "left" poem ranges at the right). The letter on the button is a "P" in every language.

How the drafts were made:

- The address form follows each language's neighbouring strings (*tú* in Spanish, *vous* in French, *Sie* in German, *tu* in Italian, *u* in Dutch, the polite forms in Portuguese, Russian and Turkish).
- The Enter key is named as each language's existing strings name it (`insights.tipOpen`, `ol.kbdHint`): *Intro*, *Entrée*, *Eingabe*, *Invio*, and *Enter* elsewhere.
- No exclamation marks and no placeholders anywhere (a test checks both).

Points worth a look when you read them:

- "Poem" against "verse": the Verse tool already has a name in each language (`tool.verse`: *Verso*, *Vers*, *Versi*, *Wiersz*, *Стихи*, *Şiir*, *شعر*, *韻文*, *诗行*). `poem.mode` uses the word for a poem (*poema*, *poème*, *Gedicht*, *poesia*, *gedicht*, *wiersz*, *стихотворение*, *şiir*, *قصيدة*, *詩*, *诗歌*). In **pl** and **tr** the two are the same word, so `tool.verseInPoem` reads a little doubled there ("Wiersz — … rozdział jest wierszem", "Şiir — … bir şiir").
- "Line" against "verse line": the starter lines say *verso*, *vers*, *wers* and *dize* in **es**, **fr**, **it**, **pt**, **pl** and **tr**, and "line" (*Zeile*, *regel*, *строка*, *سطر*, *行*) in **de**, **nl**, **ru**, **ar**, **ja** and **zh-Hans**.
- "Stanza": *estrofa*, *strophe*, *Strophe*, *strofa*, *estrofe*, *strofe*, *strofa*, *строфа*, *kıta*, *مقطع*, *連*, *节*. Check **ar**, **ja** and **zh-Hans** against the word you want.
- `poem.titlePh` in **pl** says "give your poem a title" (*Nadaj tytuł*), because "name" reads oddly there.
- **de** `poem.ghost2` names the key *Eingabe*, as the other German strings do.

### `poem.mode`

- **en** (source): Poem Mode
- **es** Español: `Modo poema`
- **fr** Français: `Mode poème`
- **de** Deutsch: `Gedichtmodus`
- **it** Italiano: `Modalità poesia`
- **pt** Português: `Modo poema`
- **nl** Nederlands: `Gedichtmodus`
- **pl** Polski: `Tryb wiersza`
- **ru** Русский: `Режим стихотворения`
- **tr** Türkçe: `Şiir Modu`
- **ar** العربية: `وضع القصيدة`
- **ja** 日本語: `詩モード`
- **zh-Hans** 简体中文: `诗歌模式`
- **hi** हिन्दी: `कविता मोड`
- **mr** मराठी: `कविता मोड`

### `poem.alignAria`

- **en** (source): How the lines of the poem are set
- **es** Español: `Cómo se colocan los versos del poema`
- **fr** Français: `Disposition des vers du poème`
- **de** Deutsch: `Ausrichtung der Gedichtzeilen`
- **it** Italiano: `Come sono disposti i versi della poesia`
- **pt** Português: `Como ficam dispostos os versos do poema`
- **nl** Nederlands: `Hoe de regels van het gedicht worden gezet`
- **pl** Polski: `Układ wersów wiersza`
- **ru** Русский: `Как выровнены строки стихотворения`
- **tr** Türkçe: `Şiirin dizelerinin hizalanması`
- **ar** العربية: `طريقة محاذاة أسطر القصيدة`
- **ja** 日本語: `詩の行の揃え方`
- **zh-Hans** 简体中文: `诗行的对齐方式`
- **hi** हिन्दी: `कविता की पंक्तियाँ कैसे रखी जाएँ`
- **mr** मराठी: `कवितेच्या ओळी कशा मांडल्या आहेत`

### `poem.titlePh`

- **en** (source): Name your poem
- **es** Español: `Ponle nombre a tu poema`
- **fr** Français: `Donnez un nom à votre poème`
- **de** Deutsch: `Geben Sie Ihrem Gedicht einen Namen`
- **it** Italiano: `Dai un nome alla tua poesia`
- **pt** Português: `Dê um nome ao seu poema`
- **nl** Nederlands: `Geef uw gedicht een naam`
- **pl** Polski: `Nadaj tytuł swojemu wierszowi`
- **ru** Русский: `Дайте название своему стихотворению`
- **tr** Türkçe: `Şiirinize bir ad verin`
- **ar** العربية: `سمِّ قصيدتك`
- **ja** 日本語: `詩に名前をつけましょう`
- **zh-Hans** 简体中文: `给你的诗起个名字`
- **hi** हिन्दी: `अपनी कविता का नाम रखें`
- **mr** मराठी: `तुमच्या कवितेला नाव द्या`

### `poem.ghost1`

- **en** (source): Write your first line here…
- **es** Español: `Escribe aquí tu primer verso…`
- **fr** Français: `Écrivez ici votre premier vers…`
- **de** Deutsch: `Schreiben Sie hier Ihre erste Zeile…`
- **it** Italiano: `Scrivi qui il tuo primo verso…`
- **pt** Português: `Escreva aqui o seu primeiro verso…`
- **nl** Nederlands: `Schrijf hier uw eerste regel…`
- **pl** Polski: `Napisz tutaj pierwszy wers…`
- **ru** Русский: `Напишите здесь первую строку…`
- **tr** Türkçe: `İlk dizenizi buraya yazın…`
- **ar** العربية: `اكتب سطرك الأول هنا…`
- **ja** 日本語: `ここに最初の行を書きます…`
- **zh-Hans** 简体中文: `在这里写下第一行…`
- **hi** हिन्दी: `अपनी पहली पंक्ति यहाँ लिखें…`
- **mr** मराठी: `तुमची पहिली ओळ इथे लिहा…`

### `poem.ghost2`

- **en** (source): …press Enter for the next one…
- **es** Español: `…pulsa Intro para el siguiente…`
- **fr** Français: `…appuyez sur Entrée pour le suivant…`
- **de** Deutsch: `…drücken Sie Eingabe für die nächste…`
- **it** Italiano: `…premi Invio per il successivo…`
- **pt** Português: `…prima Enter para o seguinte…`
- **nl** Nederlands: `…druk op Enter voor de volgende…`
- **pl** Polski: `…naciśnij Enter, aby zacząć następny…`
- **ru** Русский: `…нажмите Enter, чтобы начать следующую…`
- **tr** Türkçe: `…sonraki dize için Enter’a basın…`
- **ar** العربية: `…واضغط Enter للسطر التالي…`
- **ja** 日本語: `…Enter キーで次の行へ…`
- **zh-Hans** 简体中文: `…按 Enter 写下一行…`
- **hi** हिन्दी: `…अगली पंक्ति के लिए Enter दबाएँ…`
- **mr** मराठी: `…पुढच्या ओळीसाठी Enter दाबा…`

### `poem.ghost3`

- **en** (source): …and a blank line starts a new stanza.
- **es** Español: `…y una línea en blanco empieza una estrofa nueva.`
- **fr** Français: `…et une ligne vide commence une nouvelle strophe.`
- **de** Deutsch: `…und eine Leerzeile beginnt eine neue Strophe.`
- **it** Italiano: `…e una riga vuota inizia una nuova strofa.`
- **pt** Português: `…e uma linha em branco começa uma nova estrofe.`
- **nl** Nederlands: `…en een lege regel begint een nieuwe strofe.`
- **pl** Polski: `…a pusta linia zaczyna nową strofę.`
- **ru** Русский: `…а пустая строка начинает новую строфу.`
- **tr** Türkçe: `…boş bir satır da yeni bir kıta başlatır.`
- **ar** العربية: `…وسطر فارغ يبدأ مقطعًا جديدًا.`
- **ja** 日本語: `…空行を入れると、新しい連が始まります。`
- **zh-Hans** 简体中文: `…空一行就开始新的一节。`
- **hi** हिन्दी: `…और एक खाली पंक्ति से नया छंद शुरू होता है।`
- **mr** मराठी: `…आणि एक रिकामी ओळ नवे कडवे सुरू करते.`

### `tool.verseInPoem`

- **en** (source): Verse — not needed here: this whole chapter is a poem, so every line break is kept already
- **es** Español: `Verso — aquí no hace falta: todo el capítulo es un poema, así que cada salto de línea ya se conserva`
- **fr** Français: `Vers — inutile ici : tout le chapitre est un poème, chaque retour à la ligne est donc déjà gardé`
- **de** Deutsch: `Vers — hier nicht nötig: Das ganze Kapitel ist ein Gedicht, jeder Zeilenumbruch bleibt also schon erhalten`
- **it** Italiano: `Versi — qui non serve: tutto il capitolo è una poesia, quindi ogni a capo è già conservato`
- **pt** Português: `Verso — aqui não é preciso: o capítulo inteiro é um poema, por isso cada quebra de linha já é mantida`
- **nl** Nederlands: `Vers — hier niet nodig: het hele hoofdstuk is een gedicht, dus elke regelafbreking blijft al behouden`
- **pl** Polski: `Wiersz — tutaj niepotrzebny: cały rozdział jest wierszem, więc każdy podział wiersza jest już zachowany`
- **ru** Русский: `Стихи — здесь не нужно: вся глава уже стихотворение, поэтому каждый перенос строки сохраняется`
- **tr** Türkçe: `Şiir — burada gerekmez: bölümün tamamı bir şiir, bu yüzden her satır sonu zaten korunuyor`
- **ar** العربية: `شعر — لا حاجة إليه هنا: الفصل كله قصيدة، ولذلك فكل فاصل أسطر محفوظ أصلًا`
- **ja** 日本語: `韻文 — ここでは不要です。この章全体が詩なので、改行はすべてそのまま保たれます`
- **zh-Hans** 简体中文: `诗行 — 这里不需要：整章都是一首诗，所以每个换行都已保留`
- **hi** हिन्दी: `पद्य — यहाँ ज़रूरत नहीं: यह पूरा अध्याय एक कविता है, इसलिए हर पंक्ति-विराम पहले से ही बना रहता है`
- **mr** मराठी: `पद्य — इथे गरज नाही: हे पूर्ण प्रकरणच कविता आहे, म्हणून प्रत्येक ओळ-खंड आधीच जपला जातो`

## 5. "Use on every chapter" (26 keys, 2026-11-24)

At the end of a chapter's settings the studio offers "Use on every chapter…": that chapter's backdrop, drop cap,
small-caps lead-in or plate fit copied to every other chapter (`studio/src/chapters/EveryChapter.tsx`, `everych.ts`).
Its 26 keys are in `client/index.html` `UI_STRINGS` (the `BEUK:everychapter` block, `EVERYCHAPTER_STRINGS`), all `everych.*`.
English is the source. The 12 other languages below are drafts written by Claude: not approved, not read by a native speaker.

How the drafts were made:

- Placeholders (`{n}`, `{total}`, `{value}`, `{snap}`, `{list}`, `{setting}`, `{error}`) are kept byte for byte;
  `studio/test/every-chapter.test.tsx` checks it in every language, and that no string has an exclamation mark.
- No plural forms. Every count stands after a colon ("Other chapters that would change: {n} of {total}"), so one string
  fits every count in every language, Polish, Russian and Arabic included. No key has a `Plural` twin.
- Words follow the neighbouring 1.0 strings in each language: chapter, section, Part dividers (`chop.mergePart`),
  the body, front and back matter (`side.groupBody`, `side.groupFront`, `side.groupBack`), the export
  (`side.includeInExport`), backdrop, opening plate, settings (`set.title`), snapshot and History (`chop.undoChanged`),
  Undo (`chop.undo`). The address form and the quote marks follow each language's 1.0 strings.
- `everych.back` quotes the name History gives the snapshot through `{snap}`, which the studio fills with that
  language's own `history.auto.chapterop` ("Before a chapter change"), so the two cannot drift.
- Three of the dialog's four row names are not new keys: they are the chapter settings' own labels (`editor.backdrop`,
  `editor.dropCap`, `editor.smallCaps`). The fourth is new, `everych.plateFit` ("Plate fit"): the settings' own label
  there is "Fit" (`editor.plateFit`), which says enough only under the plate row; each draft joins that language's
  words for the fit and for the plate. The values are the pickers' own words (`editor.backdropNone`,
  `editor.bdWhisper` …, `editor.plateFitFill`, `editor.plateFitWhole`). Cancel is `set.cancel`, Undo is `chop.undo`,
  and a complete Undo says `chop.undone`.
- `everych.failed` follows each language's `proof.failed` ("… The error was: {error}").

Points worth a look when you read them:

- `everych.on` / `everych.off` stand after "This chapter:" for the drop cap and the lead-in. **es**, **fr**, **it**, **pt**
  use the masculine form (Activado, Activé, Attivato, Ativado), as for "the setting"; the drop cap is feminine in
  French and Spanish (la lettrine, la letra capital), so a neutral pair may read better there. **de** "Ein / Aus",
  **nl** "Aan / Uit", **ru** "Вкл. / Выкл.", **ja** "オン / オフ", **zh-Hans** "开 / 关".
- **tr** uses "bölüm" for both a chapter and a section, as the 1.0 pack does, so `everych.scope` reads "Tüm bölümler,
  kısım ayırıcıları dışında kitabın gövdesindeki her bölümdür".
- **de** `everych.scope` names the front and back matter by the sidebar's own group names there ("Frontmatter", "Anhang").
- **nl** `everych.scope` says "Het voormateriaal en de secties achterin" (the sidebar's group is "Achterin").
- **ja** and **zh-Hans** put the total before the count ("{total} 章中 {n} 章", "{total} 章中的 {n} 章").
- `everych.platePair` is the one sentence about print: a plate faces its chapter's opening page, so the plate and the
  copied backdrop are side by side. If the English changes, all 12 change.
- `everych.doneItem` ("{setting}: {n}") is joined with " · " into `everych.done`'s `{list}`; **fr** keeps its space
  before the colon, **ja** and **zh-Hans** use the full-width colon.

### `everych.open`

- **en** (source): Use on every chapter…
- **es** Español: `Usar en todos los capítulos…`
- **fr** Français: `Appliquer à tous les chapitres…`
- **de** Deutsch: `Für alle Kapitel übernehmen…`
- **it** Italiano: `Usa in tutti i capitoli…`
- **pt** Português: `Usar em todos os capítulos…`
- **nl** Nederlands: `Gebruiken voor elk hoofdstuk…`
- **pl** Polski: `Użyj we wszystkich rozdziałach…`
- **ru** Русский: `Применить ко всем главам…`
- **tr** Türkçe: `Tüm bölümlerde kullan…`
- **ar** العربية: `استخدام في كل الفصول…`
- **ja** 日本語: `すべての章に使う…`
- **zh-Hans** 简体中文: `用于所有章节…`
- **hi** हिन्दी: `हर अध्याय पर लागू करें…`
- **mr** मराठी: `प्रत्येक प्रकरणाला लावा…`

### `everych.title`

- **en** (source): Use this chapter's settings on every chapter
- **es** Español: `Usar los ajustes de este capítulo en todos los capítulos`
- **fr** Français: `Appliquer les réglages de ce chapitre à tous les chapitres`
- **de** Deutsch: `Einstellungen dieses Kapitels für alle Kapitel übernehmen`
- **it** Italiano: `Usa le impostazioni di questo capitolo in tutti i capitoli`
- **pt** Português: `Usar as definições deste capítulo em todos os capítulos`
- **nl** Nederlands: `De instellingen van dit hoofdstuk voor elk hoofdstuk gebruiken`
- **pl** Polski: `Użyj ustawień tego rozdziału we wszystkich rozdziałach`
- **ru** Русский: `Применить настройки этой главы ко всем главам`
- **tr** Türkçe: `Bu bölümün ayarlarını tüm bölümlerde kullan`
- **ar** العربية: `استخدام إعدادات هذا الفصل في كل الفصول`
- **ja** 日本語: `この章の設定をすべての章に使う`
- **zh-Hans** 简体中文: `把本章的设置用于所有章节`
- **hi** हिन्दी: `इस अध्याय की सेटिंग्स हर अध्याय पर लागू करें`
- **mr** मराठी: `या प्रकरणाची सेटिंग्ज प्रत्येक प्रकरणाला लावा`

### `everych.scope`

- **en** (source): Every chapter means every section in the body of the book except Part dividers. Chapters not included in the export are changed too. Front and back matter are not changed.
- **es** Español: `Todos los capítulos son todas las secciones del cuerpo del libro, salvo los separadores de parte. Los capítulos no incluidos en la exportación también cambian. Las páginas iniciales y finales no cambian.`
- **fr** Français: `Tous les chapitres, c'est-à-dire toutes les sections du corps du livre, sauf les séparateurs de partie. Les chapitres non inclus dans l'export sont modifiés eux aussi. Les pages liminaires et finales ne sont pas modifiées.`
- **de** Deutsch: `Alle Kapitel heißt: jeder Abschnitt im Hauptteil des Buchs außer den Teil-Trennern. Kapitel, die nicht in den Export aufgenommen sind, werden ebenfalls geändert. Frontmatter und Anhang werden nicht geändert.`
- **it** Italiano: `Tutti i capitoli significa tutte le sezioni del corpo del libro, tranne i divisori di parte. Cambiano anche i capitoli non inclusi nell'esportazione. Le pagine iniziali e finali non cambiano.`
- **pt** Português: `Todos os capítulos são todas as secções do corpo do livro, exceto os divisores de parte. Os capítulos não incluídos na exportação também são alterados. As páginas iniciais e finais não são alteradas.`
- **nl** Nederlands: `Elk hoofdstuk betekent: elke sectie in de hoofdtekst van het boek, behalve deelscheidingen. Hoofdstukken die niet in de export zijn opgenomen, worden ook gewijzigd. Het voormateriaal en de secties achterin worden niet gewijzigd.`
- **pl** Polski: `Wszystkie rozdziały to każda sekcja w treści głównej książki oprócz separatorów części. Rozdziały nieuwzględnione w eksporcie też się zmieniają. Materiały wstępne i końcowe się nie zmieniają.`
- **ru** Русский: `Все главы — это все разделы основного текста книги, кроме разделителей частей. Главы, не включённые в экспорт, тоже изменяются. Начальные и заключительные страницы не изменяются.`
- **tr** Türkçe: `Tüm bölümler, kısım ayırıcıları dışında kitabın gövdesindeki her bölümdür. Dışa aktarıma dahil edilmeyen bölümler de değişir. Ön ve arka sayfalar değişmez.`
- **ar** العربية: `كل الفصول تعني كل قسم في متن الكتاب ما عدا فواصل الأجزاء. الفصول غير المضمّنة في التصدير تتغيّر أيضًا. الصفحات الأولى والأخيرة لا تتغيّر.`
- **ja** 日本語: `「すべての章」とは、本文にあるセクションのうち、部の区切りを除くすべてです。書き出しに含めていない章も変更されます。前付けと後付けは変更されません。`
- **zh-Hans** 简体中文: `“所有章节”指正文中的每一节，部分隔页除外。未包含在导出中的章节也会更改。前置页和后置页不会更改。`
- **hi** हिन्दी: `हर अध्याय का मतलब है किताब के मुख्य हिस्से का हर सेक्शन, भाग-विभाजकों को छोड़कर। जो अध्याय एक्सपोर्ट में शामिल नहीं हैं, वे भी बदलेंगे। शुरुआती पन्ने और आखिरी पन्ने नहीं बदलेंगे।`
- **mr** मराठी: `प्रत्येक प्रकरण म्हणजे पुस्तकाच्या मुख्य भागातील भाग-विभाजक सोडून प्रत्येक विभाग. एक्सपोर्टमध्ये समाविष्ट नसलेली प्रकरणेही बदलतात. सुरुवातीची पाने आणि शेवटची पाने बदलत नाहीत.`

### `everych.pick`

- **en** (source): Settings to copy from this chapter
- **es** Español: `Ajustes que se copian de este capítulo`
- **fr** Français: `Réglages à copier depuis ce chapitre`
- **de** Deutsch: `Einstellungen, die aus diesem Kapitel kopiert werden`
- **it** Italiano: `Impostazioni da copiare da questo capitolo`
- **pt** Português: `Definições a copiar deste capítulo`
- **nl** Nederlands: `Instellingen die uit dit hoofdstuk worden gekopieerd`
- **pl** Polski: `Ustawienia kopiowane z tego rozdziału`
- **ru** Русский: `Настройки, которые копируются из этой главы`
- **tr** Türkçe: `Bu bölümden kopyalanacak ayarlar`
- **ar** العربية: `الإعدادات التي تُنسخ من هذا الفصل`
- **ja** 日本語: `この章からコピーする設定`
- **zh-Hans** 简体中文: `从本章复制的设置`
- **hi** हिन्दी: `इस अध्याय से कॉपी करने वाली सेटिंग्स`
- **mr** मराठी: `या प्रकरणातून कॉपी करायची सेटिंग्ज`

### `everych.here`

- **en** (source): This chapter: {value}
- **es** Español: `Este capítulo: {value}`
- **fr** Français: `Ce chapitre : {value}`
- **de** Deutsch: `Dieses Kapitel: {value}`
- **it** Italiano: `Questo capitolo: {value}`
- **pt** Português: `Este capítulo: {value}`
- **nl** Nederlands: `Dit hoofdstuk: {value}`
- **pl** Polski: `Ten rozdział: {value}`
- **ru** Русский: `Эта глава: {value}`
- **tr** Türkçe: `Bu bölüm: {value}`
- **ar** العربية: `هذا الفصل: {value}`
- **ja** 日本語: `この章：{value}`
- **zh-Hans** 简体中文: `本章：{value}`
- **hi** हिन्दी: `यह अध्याय: {value}`
- **mr** मराठी: `हे प्रकरण: {value}`

### `everych.count`

- **en** (source): Other chapters that would change: {n} of {total}
- **es** Español: `Otros capítulos que cambiarían: {n} de {total}`
- **fr** Français: `Autres chapitres qui changeraient : {n} sur {total}`
- **de** Deutsch: `Andere Kapitel, die sich ändern würden: {n} von {total}`
- **it** Italiano: `Altri capitoli che cambierebbero: {n} su {total}`
- **pt** Português: `Outros capítulos que mudariam: {n} de {total}`
- **nl** Nederlands: `Andere hoofdstukken die zouden veranderen: {n} van {total}`
- **pl** Polski: `Inne rozdziały, które by się zmieniły: {n} z {total}`
- **ru** Русский: `Другие главы, которые изменятся: {n} из {total}`
- **tr** Türkçe: `Değişecek diğer bölümler: {n} / {total}`
- **ar** العربية: `الفصول الأخرى التي ستتغيّر: {n} من {total}`
- **ja** 日本語: `変更されるほかの章：{total} 章中 {n} 章`
- **zh-Hans** 简体中文: `将更改的其他章节：{total} 章中的 {n} 章`
- **hi** हिन्दी: `बाकी अध्याय जो बदलेंगे: {total} में से {n}`
- **mr** मराठी: `बदलतील अशी इतर प्रकरणे: {total} पैकी {n}`

### `everych.same`

- **en** (source): Every other chapter already has this.
- **es** Español: `Todos los demás capítulos ya lo tienen así.`
- **fr** Français: `Tous les autres chapitres ont déjà ce réglage.`
- **de** Deutsch: `Alle anderen Kapitel haben das bereits.`
- **it** Italiano: `Tutti gli altri capitoli sono già così.`
- **pt** Português: `Todos os outros capítulos já estão assim.`
- **nl** Nederlands: `Elk ander hoofdstuk heeft dit al.`
- **pl** Polski: `Wszystkie pozostałe rozdziały już to mają.`
- **ru** Русский: `Во всех остальных главах уже так.`
- **tr** Türkçe: `Diğer bütün bölümlerde zaten böyle.`
- **ar** العربية: `كل الفصول الأخرى على هذا الإعداد بالفعل.`
- **ja** 日本語: `ほかの章はすべて、すでにこの設定です。`
- **zh-Hans** 简体中文: `其他章节都已是这个设置。`
- **hi** हिन्दी: `बाकी हर अध्याय में यह पहले से है।`
- **mr** मराठी: `इतर प्रत्येक प्रकरणात हे आधीच आहे.`

### `everych.plateCount`

- **en** (source): Other chapters with a plate that would change: {n} of {total}
- **es** Español: `Otros capítulos con lámina que cambiarían: {n} de {total}`
- **fr** Français: `Autres chapitres avec une planche qui changeraient : {n} sur {total}`
- **de** Deutsch: `Andere Kapitel mit Tafel, die sich ändern würden: {n} von {total}`
- **it** Italiano: `Altri capitoli con una tavola che cambierebbero: {n} su {total}`
- **pt** Português: `Outros capítulos com gravura que mudariam: {n} de {total}`
- **nl** Nederlands: `Andere hoofdstukken met een plaat die zouden veranderen: {n} van {total}`
- **pl** Polski: `Inne rozdziały z planszą, które by się zmieniły: {n} z {total}`
- **ru** Русский: `Другие главы с вклейкой, которые изменятся: {n} из {total}`
- **tr** Türkçe: `Levhası olup değişecek diğer bölümler: {n} / {total}`
- **ar** العربية: `الفصول الأخرى ذات اللوحة التي ستتغيّر: {n} من {total}`
- **ja** 日本語: `変更される、口絵のあるほかの章：{total} 章中 {n} 章`
- **zh-Hans** 简体中文: `将更改的其他带插图章节：{total} 章中的 {n} 章`
- **hi** हिन्दी: `चित्र-पेज वाले बाकी अध्याय जो बदलेंगे: {total} में से {n}`
- **mr** मराठी: `चित्रपान असलेली, बदलतील अशी इतर प्रकरणे: {total} पैकी {n}`

### `everych.plateSame`

- **en** (source): Every other chapter with a plate already has this.
- **es** Español: `Todos los demás capítulos con lámina ya lo tienen así.`
- **fr** Français: `Tous les autres chapitres avec une planche ont déjà ce réglage.`
- **de** Deutsch: `Alle anderen Kapitel mit Tafel haben das bereits.`
- **it** Italiano: `Tutti gli altri capitoli con una tavola sono già così.`
- **pt** Português: `Todos os outros capítulos com gravura já estão assim.`
- **nl** Nederlands: `Elk ander hoofdstuk met een plaat heeft dit al.`
- **pl** Polski: `Wszystkie pozostałe rozdziały z planszą już to mają.`
- **ru** Русский: `Во всех остальных главах с вклейкой уже так.`
- **tr** Türkçe: `Levhası olan diğer bütün bölümlerde zaten böyle.`
- **ar** العربية: `كل الفصول الأخرى ذات اللوحة على هذا الإعداد بالفعل.`
- **ja** 日本語: `口絵のあるほかの章はすべて、すでにこの設定です。`
- **zh-Hans** 简体中文: `其他带插图的章节都已是这个设置。`
- **hi** हिन्दी: `चित्र-पेज वाले बाकी हर अध्याय में यह पहले से है।`
- **mr** मराठी: `चित्रपान असलेल्या इतर प्रत्येक प्रकरणात हे आधीच आहे.`

### `everych.plateNone`

- **en** (source): No other chapter has a plate.
- **es** Español: `Ningún otro capítulo tiene lámina.`
- **fr** Français: `Aucun autre chapitre n'a de planche.`
- **de** Deutsch: `Kein anderes Kapitel hat eine Tafel.`
- **it** Italiano: `Nessun altro capitolo ha una tavola.`
- **pt** Português: `Nenhum outro capítulo tem gravura.`
- **nl** Nederlands: `Geen ander hoofdstuk heeft een plaat.`
- **pl** Polski: `Żaden inny rozdział nie ma planszy.`
- **ru** Русский: `Ни в одной другой главе нет вклейки.`
- **tr** Türkçe: `Başka hiçbir bölümde levha yok.`
- **ar** العربية: `لا يوجد فصل آخر له لوحة.`
- **ja** 日本語: `口絵のある章はほかにありません。`
- **zh-Hans** 简体中文: `没有其他章节带有卷首插图。`
- **hi** हिन्दी: `किसी और अध्याय में चित्र-पेज नहीं है।`
- **mr** मराठी: `इतर कोणत्याही प्रकरणाला चित्रपान नाही.`

### `everych.platePair`

- **en** (source): Chapters with an opening plate that would get this backdrop: {n}. In print a plate faces its chapter's opening page, so the plate and the backdrop are side by side.
- **es** Español: `Capítulos con lámina de apertura que recibirían este fondo: {n}. En la impresión, la lámina queda frente a la página de apertura de su capítulo, así que la lámina y el fondo quedan uno junto al otro.`
- **fr** Français: `Chapitres avec une planche d'ouverture qui recevraient cet arrière-plan : {n}. À l'impression, la planche fait face à la page d'ouverture de son chapitre : la planche et l'arrière-plan sont donc côte à côte.`
- **de** Deutsch: `Kapitel mit Eröffnungstafel, die diesen Hintergrund bekämen: {n}. Im Druck steht die Tafel der Eröffnungsseite ihres Kapitels gegenüber, Tafel und Hintergrund stehen also nebeneinander.`
- **it** Italiano: `Capitoli con una tavola di apertura che riceverebbero questo sfondo: {n}. In stampa la tavola sta di fronte alla pagina di apertura del suo capitolo, quindi la tavola e lo sfondo sono affiancati.`
- **pt** Português: `Capítulos com gravura de abertura que receberiam este fundo: {n}. Na impressão, a gravura fica de frente para a página de abertura do seu capítulo, por isso a gravura e o fundo ficam lado a lado.`
- **nl** Nederlands: `Hoofdstukken met een openingsplaat die deze achtergrond zouden krijgen: {n}. In druk staat de plaat tegenover de openingspagina van het hoofdstuk, dus de plaat en de achtergrond staan naast elkaar.`
- **pl** Polski: `Rozdziały z planszą otwierającą, które dostałyby to tło: {n}. W druku plansza leży naprzeciw strony otwierającej swój rozdział, więc plansza i tło znajdą się obok siebie.`
- **ru** Русский: `Главы со вступительной вклейкой, которые получат этот фон: {n}. В печати вклейка стоит напротив первой страницы своей главы, поэтому вклейка и фон окажутся рядом.`
- **tr** Türkçe: `Açılış levhası olup bu arka planı alacak bölümler: {n}. Baskıda levha, bölümünün açılış sayfasının karşısında durur; yani levha ile arka plan yan yana gelir.`
- **ar** العربية: `الفصول ذات لوحة الافتتاح التي ستحصل على هذه الخلفية: {n}. في الطباعة تقابل اللوحةُ صفحةَ افتتاح فصلها، فتكون اللوحة والخلفية متجاورتين.`
- **ja** 日本語: `この背景が付くことになる、口絵のある章：{n} 章。印刷では口絵はその章の最初のページと向かい合うので、口絵と背景が隣り合います。`
- **zh-Hans** 简体中文: `将获得这个背景且带有卷首插图的章节：{n} 章。印刷时，插图与该章的开篇页相对，因此插图和背景会并排出现。`
- **hi** हिन्दी: `शुरुआती चित्र-पेज वाले अध्याय जिन्हें यह पृष्ठभूमि मिलेगी: {n}। प्रिंट में चित्र-पेज अपने अध्याय के पहले पेज के सामने होता है, इसलिए चित्र-पेज और पृष्ठभूमि आमने-सामने रहते हैं।`
- **mr** मराठी: `सुरुवातीचे चित्रपान असलेली, ही पार्श्वभूमी मिळणारी प्रकरणे: {n}. प्रिंटमध्ये चित्रपान त्याच्या प्रकरणाच्या सुरुवातीच्या पानासमोर असते, म्हणून चित्रपान आणि पार्श्वभूमी शेजारी शेजारी येतात.`

### `everych.alone`

- **en** (source): This book has no other chapter.
- **es** Español: `Este libro no tiene ningún otro capítulo.`
- **fr** Français: `Ce livre n'a pas d'autre chapitre.`
- **de** Deutsch: `Dieses Buch hat kein anderes Kapitel.`
- **it** Italiano: `Questo libro non ha altri capitoli.`
- **pt** Português: `Este livro não tem mais nenhum capítulo.`
- **nl** Nederlands: `Dit boek heeft geen ander hoofdstuk.`
- **pl** Polski: `Ta książka nie ma innego rozdziału.`
- **ru** Русский: `В этой книге нет других глав.`
- **tr** Türkçe: `Bu kitapta başka bölüm yok.`
- **ar** العربية: `لا يوجد في هذا الكتاب فصل آخر.`
- **ja** 日本語: `この本にほかの章はありません。`
- **zh-Hans** 简体中文: `这本书没有其他章节。`
- **hi** हिन्दी: `इस किताब में कोई और अध्याय नहीं है।`
- **mr** मराठी: `या पुस्तकात दुसरे कोणतेही प्रकरण नाही.`

### `everych.replace`

- **en** (source): A chapter that changes loses the setting it has now. Only the ticked settings are copied; no text is changed.
- **es** Español: `Un capítulo que cambia pierde el ajuste que tiene ahora. Solo se copian los ajustes marcados; no se cambia ningún texto.`
- **fr** Français: `Un chapitre qui change perd le réglage qu'il a maintenant. Seuls les réglages cochés sont copiés ; aucun texte n'est modifié.`
- **de** Deutsch: `Ein Kapitel, das sich ändert, verliert die Einstellung, die es jetzt hat. Nur die angekreuzten Einstellungen werden kopiert; kein Text wird geändert.`
- **it** Italiano: `Un capitolo che cambia perde l'impostazione che ha ora. Si copiano solo le impostazioni spuntate; nessun testo viene modificato.`
- **pt** Português: `Um capítulo que muda perde a definição que tem agora. Só são copiadas as definições assinaladas; nenhum texto é alterado.`
- **nl** Nederlands: `Een hoofdstuk dat verandert, verliest de instelling die het nu heeft. Alleen de aangevinkte instellingen worden gekopieerd; er wordt geen tekst gewijzigd.`
- **pl** Polski: `Rozdział, który się zmienia, traci ustawienie, które ma teraz. Kopiowane są tylko zaznaczone ustawienia; żaden tekst się nie zmienia.`
- **ru** Русский: `Глава, которая изменяется, теряет настройку, которая у неё сейчас. Копируются только отмеченные настройки; текст не изменяется.`
- **tr** Türkçe: `Değişen bir bölüm şu anki ayarını kaybeder. Yalnızca işaretlenen ayarlar kopyalanır; hiçbir metin değişmez.`
- **ar** العربية: `الفصل الذي يتغيّر يفقد إعداده الحالي. لا تُنسخ إلا الإعدادات المحدَّدة؛ ولا يتغيّر أي نص.`
- **ja** 日本語: `変更される章は、いまの設定を失います。コピーされるのはチェックを入れた設定だけで、本文は変更されません。`
- **zh-Hans** 简体中文: `被更改的章节会失去它现在的设置。只复制勾选的设置；不更改任何文字。`
- **hi** हिन्दी: `जो अध्याय बदलेगा, उसकी अभी की सेटिंग चली जाएगी। सिर्फ़ टिक की गई सेटिंग्स कॉपी होंगी; कोई टेक्स्ट नहीं बदलेगा।`
- **mr** मराठी: `जे प्रकरण बदलेल त्याचे आत्ताचे सेटिंग जाईल. फक्त खूण केलेली सेटिंग्ज कॉपी होतात; कोणताही मजकूर बदलत नाही.`

### `everych.back`

- **en** (source): Undo is offered in the message that follows, for a few seconds. A snapshot of the book as it is now is also saved in History first, named “{snap}”; restoring from a snapshot also brings back the text as it was then.
- **es** Español: `El mensaje que aparece después ofrece Deshacer durante unos segundos. Antes se guarda además en el Historial una instantánea del libro tal como está ahora, llamada «{snap}»; restaurar desde una instantánea también devuelve el texto tal como estaba entonces.`
- **fr** Français: `Le message qui suit propose Annuler pendant quelques secondes. Un instantané du livre tel qu'il est maintenant est aussi enregistré d'abord dans l'Historique, sous le nom « {snap} » ; restaurer depuis un instantané ramène aussi le texte tel qu'il était alors.`
- **de** Deutsch: `Die Meldung danach bietet einige Sekunden lang Rückgängig an. Außerdem wird zuerst ein Schnappschuss des Buchs in seinem jetzigen Stand im Verlauf gespeichert, unter dem Namen „{snap}“; beim Wiederherstellen aus einem Schnappschuss kommt auch der Text so zurück, wie er damals war.`
- **it** Italiano: `Il messaggio che segue offre Annulla per alcuni secondi. Prima viene anche salvata nella Cronologia un'istantanea del libro com'è ora, con il nome «{snap}»; ripristinare da un'istantanea riporta anche il testo com'era allora.`
- **pt** Português: `A mensagem que se segue oferece Anular durante alguns segundos. Antes disso é também guardado no Histórico um instantâneo do livro como está agora, com o nome «{snap}»; restaurar a partir de um instantâneo traz também de volta o texto como estava então.`
- **nl** Nederlands: `De melding die volgt biedt enkele seconden Ongedaan maken aan. Daarvóór wordt ook een momentopname van het boek zoals het nu is in Geschiedenis bewaard, met de naam ‘{snap}’; herstellen vanuit een momentopname brengt ook de tekst terug zoals die toen was.`
- **pl** Polski: `Komunikat, który pojawi się potem, przez kilka sekund oferuje Cofnij. Wcześniej w Historii zapisywana jest też migawka książki w obecnym stanie, o nazwie „{snap}”; przywrócenie z migawki przywraca także tekst taki, jaki był wtedy.`
- **ru** Русский: `Сообщение, которое появится после этого, несколько секунд предлагает «Отменить». Кроме того, сначала в Истории сохраняется снимок книги в её нынешнем виде под названием «{snap}»; восстановление из снимка возвращает и текст таким, каким он был тогда.`
- **tr** Türkçe: `Ardından çıkan ileti birkaç saniye boyunca Geri al seçeneğini sunar. Ayrıca önce kitabın şimdiki hâlinin bir anlık görüntüsü “{snap}” adıyla Geçmiş’e kaydedilir; bir anlık görüntüden geri yüklemek metni de o zamanki hâline döndürür.`
- **ar** العربية: `الرسالة التي تظهر بعد ذلك تعرض «تراجع» لبضع ثوانٍ. وتُحفظ أولًا في السجلّ لقطة من الكتاب كما هو الآن باسم «{snap}»؛ والاستعادة من لقطة تعيد النص أيضًا كما كان حينها.`
- **ja** 日本語: `このあと表示されるメッセージで、数秒のあいだ「元に戻す」を選べます。また、先に現在の本のスナップショットが「{snap}」という名前で履歴に保存されます。スナップショットから復元すると、本文もそのときの状態に戻ります。`
- **zh-Hans** 简体中文: `随后出现的消息会在几秒钟内提供“撤销”。此外，会先把现在的书保存为历史记录中的一份快照，名为“{snap}”；从快照恢复时，文字也会回到当时的样子。`
- **hi** हिन्दी: `इसके बाद आने वाले मैसेज में कुछ सेकंड के लिए पहले जैसा करने का विकल्प मिलेगा। किताब अभी जैसी है, उसका एक स्नैपशॉट भी पहले इतिहास में “{snap}” नाम से सेव होता है; स्नैपशॉट से वापस लाने पर टेक्स्ट भी तब जैसा था वैसा लौट आता है।`
- **mr** मराठी: `पुढच्या संदेशात काही सेकंदांसाठी पूर्ववत करण्याचा पर्याय मिळेल. त्याआधी पुस्तक आत्ता जसे आहे त्याचा स्नॅपशॉटही इतिहासात “{snap}” या नावाने सेव्ह होतो; स्नॅपशॉटमधून परत आणल्यास तेव्हाचा मजकूरही परत येतो.`

### `everych.apply`

- **en** (source): Use on every chapter
- **es** Español: `Usar en todos los capítulos`
- **fr** Français: `Appliquer à tous les chapitres`
- **de** Deutsch: `Für alle Kapitel übernehmen`
- **it** Italiano: `Usa in tutti i capitoli`
- **pt** Português: `Usar em todos os capítulos`
- **nl** Nederlands: `Gebruiken voor elk hoofdstuk`
- **pl** Polski: `Użyj we wszystkich rozdziałach`
- **ru** Русский: `Применить ко всем главам`
- **tr** Türkçe: `Tüm bölümlerde kullan`
- **ar** العربية: `استخدام في كل الفصول`
- **ja** 日本語: `すべての章に使う`
- **zh-Hans** 简体中文: `用于所有章节`
- **hi** हिन्दी: `हर अध्याय पर लागू करें`
- **mr** मराठी: `प्रत्येक प्रकरणाला लावा`

### `everych.on`

- **en** (source): On
- **es** Español: `Activado`
- **fr** Français: `Activé`
- **de** Deutsch: `Ein`
- **it** Italiano: `Attivato`
- **pt** Português: `Ativado`
- **nl** Nederlands: `Aan`
- **pl** Polski: `Włączone`
- **ru** Русский: `Вкл.`
- **tr** Türkçe: `Açık`
- **ar** العربية: `مفعَّل`
- **ja** 日本語: `オン`
- **zh-Hans** 简体中文: `开`
- **hi** हिन्दी: `चालू`
- **mr** मराठी: `चालू`

### `everych.off`

- **en** (source): Off
- **es** Español: `Desactivado`
- **fr** Français: `Désactivé`
- **de** Deutsch: `Aus`
- **it** Italiano: `Disattivato`
- **pt** Português: `Desativado`
- **nl** Nederlands: `Uit`
- **pl** Polski: `Wyłączone`
- **ru** Русский: `Выкл.`
- **tr** Türkçe: `Kapalı`
- **ar** العربية: `معطَّل`
- **ja** 日本語: `オフ`
- **zh-Hans** 简体中文: `关`
- **hi** हिन्दी: `बंद`
- **mr** मराठी: `बंद`

### `everych.plateFit`

- **en** (source): Plate fit
- **es** Español: `Ajuste de la lámina`
- **fr** Français: `Cadrage de la planche`
- **de** Deutsch: `Einpassung der Tafel`
- **it** Italiano: `Adattamento della tavola`
- **pt** Português: `Ajuste da gravura`
- **nl** Nederlands: `Passing van de plaat`
- **pl** Polski: `Dopasowanie planszy`
- **ru** Русский: `Размещение вклейки`
- **tr** Türkçe: `Levhanın sığdırılması`
- **ar** العربية: `ملاءمة اللوحة`
- **ja** 日本語: `口絵の収め方`
- **zh-Hans** 简体中文: `插图的适应方式`
- **hi** हिन्दी: `चित्र-पेज का फ़िट`
- **mr** मराठी: `चित्रपानाची मांडणी`

### `everych.done`

- **en** (source): Other chapters changed. {list}
- **es** Español: `Otros capítulos cambiados. {list}`
- **fr** Français: `Autres chapitres modifiés. {list}`
- **de** Deutsch: `Andere Kapitel geändert. {list}`
- **it** Italiano: `Altri capitoli modificati. {list}`
- **pt** Português: `Outros capítulos alterados. {list}`
- **nl** Nederlands: `Andere hoofdstukken gewijzigd. {list}`
- **pl** Polski: `Inne rozdziały zmienione. {list}`
- **ru** Русский: `Другие главы изменены. {list}`
- **tr** Türkçe: `Diğer bölümler değiştirildi. {list}`
- **ar** العربية: `تغيّرت فصول أخرى. {list}`
- **ja** 日本語: `ほかの章を変更しました。{list}`
- **zh-Hans** 简体中文: `已更改其他章节。{list}`
- **hi** हिन्दी: `बाकी अध्याय बदल दिए गए। {list}`
- **mr** मराठी: `इतर प्रकरणे बदलली. {list}`

### `everych.doneItem`

- **en** (source): {setting}: {n}
- **es** Español: `{setting}: {n}`
- **fr** Français: `{setting} : {n}`
- **de** Deutsch: `{setting}: {n}`
- **it** Italiano: `{setting}: {n}`
- **pt** Português: `{setting}: {n}`
- **nl** Nederlands: `{setting}: {n}`
- **pl** Polski: `{setting}: {n}`
- **ru** Русский: `{setting}: {n}`
- **tr** Türkçe: `{setting}: {n}`
- **ar** العربية: `{setting}: {n}`
- **ja** 日本語: `{setting}：{n}`
- **zh-Hans** 简体中文: `{setting}：{n}`
- **hi** हिन्दी: `{setting}: {n}`
- **mr** मराठी: `{setting}: {n}`

### `everych.nothing`

- **en** (source): Every other chapter already had these settings. Nothing was changed.
- **es** Español: `Todos los demás capítulos ya tenían estos ajustes. No se cambió nada.`
- **fr** Français: `Tous les autres chapitres avaient déjà ces réglages. Rien n'a été modifié.`
- **de** Deutsch: `Alle anderen Kapitel hatten diese Einstellungen bereits. Nichts wurde geändert.`
- **it** Italiano: `Tutti gli altri capitoli avevano già queste impostazioni. Non è stato modificato nulla.`
- **pt** Português: `Todos os outros capítulos já tinham estas definições. Nada foi alterado.`
- **nl** Nederlands: `Elk ander hoofdstuk had deze instellingen al. Er is niets gewijzigd.`
- **pl** Polski: `Wszystkie pozostałe rozdziały miały już te ustawienia. Nic nie zostało zmienione.`
- **ru** Русский: `Во всех остальных главах уже были эти настройки. Ничего не изменено.`
- **tr** Türkçe: `Diğer bütün bölümlerde bu ayarlar zaten vardı. Hiçbir şey değiştirilmedi.`
- **ar** العربية: `كل الفصول الأخرى كانت على هذه الإعدادات بالفعل. لم يتغيّر شيء.`
- **ja** 日本語: `ほかの章はすべて、すでにこの設定でした。何も変更していません。`
- **zh-Hans** 简体中文: `其他章节都已是这些设置。没有任何更改。`
- **hi** हिन्दी: `बाकी हर अध्याय में ये सेटिंग्स पहले से थीं। कुछ भी नहीं बदला गया।`
- **mr** मराठी: `इतर प्रत्येक प्रकरणात ही सेटिंग्ज आधीच होती. काहीही बदलले नाही.`

### `everych.failed`

- **en** (source): The settings could not be copied. Nothing was changed. The error was: {error}
- **es** Español: `No se pudieron copiar los ajustes. No se cambió nada. El error fue: {error}`
- **fr** Français: `Les réglages n'ont pas pu être copiés. Rien n'a été modifié. L'erreur était : {error}`
- **de** Deutsch: `Die Einstellungen konnten nicht kopiert werden. Nichts wurde geändert. Der Fehler war: {error}`
- **it** Italiano: `Non è stato possibile copiare le impostazioni. Non è stato modificato nulla. L'errore era: {error}`
- **pt** Português: `Não foi possível copiar as definições. Nada foi alterado. O erro foi: {error}`
- **nl** Nederlands: `De instellingen konden niet worden gekopieerd. Er is niets gewijzigd. De fout was: {error}`
- **pl** Polski: `Nie udało się skopiować ustawień. Nic nie zostało zmienione. Błąd: {error}`
- **ru** Русский: `Не удалось скопировать настройки. Ничего не изменено. Ошибка: {error}`
- **tr** Türkçe: `Ayarlar kopyalanamadı. Hiçbir şey değiştirilmedi. Hata şuydu: {error}`
- **ar** العربية: `تعذّر نسخ الإعدادات. لم يتغيّر شيء. الخطأ: {error}`
- **ja** 日本語: `設定をコピーできませんでした。何も変更していません。エラー：{error}`
- **zh-Hans** 简体中文: `无法复制这些设置。没有任何更改。错误：{error}`
- **hi** हिन्दी: `सेटिंग्स कॉपी नहीं हो सकीं। कुछ भी नहीं बदला गया। गड़बड़ी यह थी: {error}`
- **mr** मराठी: `सेटिंग्ज कॉपी करता आली नाहीत. काहीही बदलले नाही. त्रुटी अशी होती: {error}`

### `everych.undonePart`

- **en** (source): Undone, except chapters changed again since: {n}. They are left as they are, and the snapshot “{snap}” in History still holds the earlier settings.
- **es** Español: `Deshecho, salvo los capítulos que volvieron a cambiar desde entonces: {n}. Se dejan como están, y la instantánea «{snap}» del Historial conserva los ajustes anteriores.`
- **fr** Français: `Annulé, sauf pour les chapitres modifiés de nouveau depuis : {n}. Ils sont laissés tels quels, et l'instantané « {snap} » de l'Historique garde les réglages précédents.`
- **de** Deutsch: `Rückgängig gemacht, außer bei Kapiteln, die seitdem erneut geändert wurden: {n}. Sie bleiben, wie sie sind, und der Schnappschuss „{snap}“ im Verlauf enthält noch die früheren Einstellungen.`
- **it** Italiano: `Annullato, tranne che per i capitoli modificati di nuovo nel frattempo: {n}. Restano come sono, e l'istantanea «{snap}» nella Cronologia conserva le impostazioni precedenti.`
- **pt** Português: `Anulado, exceto nos capítulos alterados de novo entretanto: {n}. Ficam como estão, e o instantâneo «{snap}» no Histórico ainda guarda as definições anteriores.`
- **nl** Nederlands: `Ongedaan gemaakt, behalve bij hoofdstukken die sindsdien opnieuw zijn gewijzigd: {n}. Die blijven zoals ze zijn, en de momentopname ‘{snap}’ in Geschiedenis bewaart nog de eerdere instellingen.`
- **pl** Polski: `Cofnięto, z wyjątkiem rozdziałów zmienionych ponownie od tego czasu: {n}. Zostają bez zmian, a migawka „{snap}” w Historii nadal przechowuje wcześniejsze ustawienia.`
- **ru** Русский: `Отменено, кроме глав, которые с тех пор изменились снова: {n}. Они оставлены как есть, а снимок «{snap}» в Истории по-прежнему хранит прежние настройки.`
- **tr** Türkçe: `Geri alındı; o zamandan beri yeniden değiştirilen bölümler hariç: {n}. Onlar olduğu gibi bırakıldı ve Geçmiş’teki “{snap}” anlık görüntüsü önceki ayarları hâlâ saklıyor.`
- **ar** العربية: `تم التراجع، ما عدا الفصول التي تغيّرت مجددًا منذ ذلك الحين: {n}. تُركت كما هي، وما زالت اللقطة «{snap}» في السجلّ تحفظ الإعدادات السابقة.`
- **ja** 日本語: `元に戻しました。ただし、その後さらに変更された章（{n} 章）はそのままにしました。履歴のスナップショット「{snap}」に以前の設定が残っています。`
- **zh-Hans** 简体中文: `已撤销，但此后又有改动的章节除外：{n} 章。它们保持原样，历史记录中的快照“{snap}”仍保存着之前的设置。`
- **hi** हिन्दी: `पहले जैसा कर दिया गया, सिवाय उन अध्यायों के जो इसके बाद फिर बदले गए: {n}। उन्हें जैसा है वैसा छोड़ दिया गया है, और इतिहास में स्नैपशॉट “{snap}” में पुरानी सेटिंग्स अब भी हैं।`
- **mr** मराठी: `पूर्ववत केले, फक्त त्यानंतर पुन्हा बदललेली प्रकरणे सोडून: {n}. ती आहेत तशीच ठेवली आहेत, आणि इतिहासातील “{snap}” या स्नॅपशॉटमध्ये आधीची सेटिंग्ज अजून आहेत.`

### The three keys about poems

Added the same day, once Poem Mode was on main. A poem takes no drop cap and no lead-in, so those two rows are not
offered from a poem and never change one. When a poem is left out, the row's count line uses these three keys in
place of `everych.count` and `everych.same`. Each draft is that language's `everych.count` with one sentence after
it, and uses the noun for a poem that its Poem Mode strings use (section 4).

### `everych.proseCount`

- **en** (source): Other chapters that would change: {n} of {total}. Poems are left as they are.
- **es** Español: `Otros capítulos que cambiarían: {n} de {total}. Los poemas se dejan como están.`
- **fr** Français: `Autres chapitres qui changeraient : {n} sur {total}. Les poèmes restent tels quels.`
- **de** Deutsch: `Andere Kapitel, die sich ändern würden: {n} von {total}. Gedichte bleiben, wie sie sind.`
- **it** Italiano: `Altri capitoli che cambierebbero: {n} su {total}. Le poesie restano come sono.`
- **pt** Português: `Outros capítulos que mudariam: {n} de {total}. Os poemas ficam como estão.`
- **nl** Nederlands: `Andere hoofdstukken die zouden veranderen: {n} van {total}. Gedichten blijven zoals ze zijn.`
- **pl** Polski: `Inne rozdziały, które by się zmieniły: {n} z {total}. Wiersze zostają bez zmian.`
- **ru** Русский: `Другие главы, которые изменятся: {n} из {total}. Стихотворения остаются как есть.`
- **tr** Türkçe: `Değişecek diğer bölümler: {n} / {total}. Şiirler olduğu gibi kalır.`
- **ar** العربية: `الفصول الأخرى التي ستتغيّر: {n} من {total}. القصائد تبقى كما هي.`
- **ja** 日本語: `変更されるほかの章：{total} 章中 {n} 章。詩はそのままです。`
- **zh-Hans** 简体中文: `将更改的其他章节：{total} 章中的 {n} 章。诗歌保持不变。`
- **hi** हिन्दी: `बाकी अध्याय जो बदलेंगे: {total} में से {n}। कविताओं को जैसा है वैसा छोड़ा गया है।`
- **mr** मराठी: `बदलतील अशी इतर प्रकरणे: {total} पैकी {n}. कविता आहेत तशाच ठेवल्या जातात.`

### `everych.proseSame`

- **en** (source): Every other chapter that is not a poem already has this.
- **es** Español: `Todos los demás capítulos que no son poemas ya lo tienen así.`
- **fr** Français: `Tous les autres chapitres qui ne sont pas des poèmes ont déjà ce réglage.`
- **de** Deutsch: `Alle anderen Kapitel, die keine Gedichte sind, haben das bereits.`
- **it** Italiano: `Tutti gli altri capitoli che non sono poesie sono già così.`
- **pt** Português: `Todos os outros capítulos que não são poemas já estão assim.`
- **nl** Nederlands: `Elk ander hoofdstuk dat geen gedicht is, heeft dit al.`
- **pl** Polski: `Wszystkie pozostałe rozdziały, które nie są wierszami, już to mają.`
- **ru** Русский: `Во всех остальных главах, кроме стихотворений, уже так.`
- **tr** Türkçe: `Şiir olmayan diğer bütün bölümlerde zaten böyle.`
- **ar** العربية: `كل الفصول الأخرى التي ليست قصائد على هذا الإعداد بالفعل.`
- **ja** 日本語: `詩ではないほかの章はすべて、すでにこの設定です。`
- **zh-Hans** 简体中文: `其他不是诗歌的章节都已是这个设置。`
- **hi** हिन्दी: `बाकी हर अध्याय में, जो कविता नहीं है, यह पहले से है।`
- **mr** मराठी: `कविता नसलेल्या इतर प्रत्येक प्रकरणात हे आधीच आहे.`

### `everych.proseNone`

- **en** (source): Every other chapter is a poem, and poems are left as they are.
- **es** Español: `Todos los demás capítulos son poemas, y los poemas se dejan como están.`
- **fr** Français: `Tous les autres chapitres sont des poèmes, et les poèmes restent tels quels.`
- **de** Deutsch: `Alle anderen Kapitel sind Gedichte, und Gedichte bleiben, wie sie sind.`
- **it** Italiano: `Tutti gli altri capitoli sono poesie, e le poesie restano come sono.`
- **pt** Português: `Todos os outros capítulos são poemas, e os poemas ficam como estão.`
- **nl** Nederlands: `Elk ander hoofdstuk is een gedicht, en gedichten blijven zoals ze zijn.`
- **pl** Polski: `Wszystkie pozostałe rozdziały są wierszami, a wiersze zostają bez zmian.`
- **ru** Русский: `Все остальные главы — стихотворения, а стихотворения остаются как есть.`
- **tr** Türkçe: `Diğer bütün bölümler şiir; şiirler olduğu gibi kalır.`
- **ar** العربية: `كل الفصول الأخرى قصائد، والقصائد تبقى كما هي.`
- **ja** 日本語: `ほかの章はすべて詩です。詩はそのままです。`
- **zh-Hans** 简体中文: `其他章节都是诗歌，诗歌保持不变。`
- **hi** हिन्दी: `बाकी हर अध्याय एक कविता है, और कविताओं को जैसा है वैसा छोड़ा जाता है।`
- **mr** मराठी: `इतर प्रत्येक प्रकरण कविता आहे, आणि कविता आहेत तशाच ठेवल्या जातात.`

## 6. The keystroke rescue: letters that could not be put back (2 keys, 2026-11-27)

When a change made in another tab takes away letters this writer had just typed, the studio's keystroke rescue puts
them back between their words (`studio/src/editor/rescueEditor.ts`). Letters it could not put back (the other tab had
them and deleted them, or their words were gone) are told once, quietly, with the exact count, as an Info toast
(`studio/src/editor/rescueNotice.ts`, `ChapterEditor.tsx`; V's ruling). A report with nothing lost says nothing.
Its 2 keys are in `client/index.html` `UI_STRINGS` (the `BEUK:keystrokerescue` block, `RESCUE_STRINGS`): `rescue.lost`
and its `Plural` twin `rescue.lostPlural`. English is the source; the English wording itself is V's to confirm in the
PR (the design's draft said "made at the same moment", which is not true of letters the other tab had seen and
deleted). The 12 other languages below are drafts written by Claude: not approved, not read by a native speaker.
The Hindi and Marathi drafts of both keys are in section 7, under "Keys added on main since 340cb22".

How the drafts were made:

- `{n}` is kept byte for byte, once in each string; `studio/test/keystroke-rescue-ui.test.tsx` checks it in every
  language, and that no string is empty, still the English, or has an exclamation mark.
- Plurals: 1.0's rule, the `Plural` twin when n is not 1 (as `offline.pending` / `offline.pendingPlural` and
  `next.textWarning`). **pl**, **ru** and **ar** word the twin with the count after a colon, which fits every count, as
  their `next.textWarningPlural` does. **tr**, **ja** and **zh-Hans** do not pluralise after a number, so their two
  strings are the same.
- Words follow the neighbouring 1.0 strings: the tab as `next.bookReplaced` and `local.detailFailed` name it (pestaña,
  onglet, Tab, scheda, separador, tabblad, karta, вкладка, sekme, علامة تبويب, タブ, 标签页). The address form follows
  each language's 1.0 strings (`bible.seriesKept`, `local.detailFailed`): *tú* in Spanish and Italian, *vous* in
  French, *Sie* in German, the third-person verb in Portuguese ("escreveu"), *u* in Dutch, *siz* in Turkish, *вы* in
  Russian; Polish without a person ("wpisana", as "Wpisana nazwa"); Arabic in the second person ("كتبته", as
  `bible.seriesKept`); Japanese without a pronoun; Chinese *你*.

Points worth a look when you read them:

- **letter**: every draft says letter as the English does (letra, lettre, Buchstabe, lettera, letra, letter, litera,
  буква, harf, حرف, 文字), except **zh-Hans**, which says 字符 (character): 字 alone reads as a Chinese character, and
  `next.textWarning` already uses 字符 there.
- **went with a change**: no language here has a natural word for word "went with". The drafts say "was lost with" (es
  "se perdió con", de "verloren gegangen", it "andata persa", pt "perdeu-se", nl "verloren gegaan bij", tr "kayboldu"),
  "left with" (fr "est partie avec") or "disappeared together with" (pl "zniknęła wraz ze", ru "пропала вместе с",
  ar "ضاع مع", ja "とともに消え", zh-Hans "随…一起消失了").
- **put back**: es "reponer", fr "remise en place", de "wieder eingefügt", it "rimetterla al suo posto", pt "repô-la",
  nl "teruggezet", pl "przywrócić", ru "вернуть", tr "geri getirilemedi", ar "إعادته", ja "元に戻せませんでした",
  zh-Hans "放回原处".
- **fr** says "tapée" for typed, as `ir.k.txtLinesUnsure` ("tapé"); `bible.seriesKept` says "saisi" for a name typed
  into a field.
- **ar** keeps the figure before the noun in the singular ("{n} حرف"), as `next.textWarning` does.
- **ja** "元に戻せませんでした" uses the app's Undo verb (元に戻す), so it may read as "Undo failed". Consider
  "戻せませんでした" or "復元できませんでした". The draft is unchanged: the native reader decides.
- **ru** `rescue.lostPlural` copies the awkward shape of `next.textWarningPlural` ("Набранных вами букв, которые …:
  {n}."). A cleaner draft: "Не удалось вернуть набранные вами буквы, пропавшие вместе с изменением в другой
  вкладке: {n}." The draft is unchanged: the native reader decides.
- If the English changes in the PR, all 24 drafts change with it.

When it is said: once per remote change that cost the writer letters, with the count of letters the other tab
had and deleted (vetoed) plus the letters whose words were gone (unplaced). It is **not** said for a paragraph made
only of this writer's "own" letters, whether the other tab deleted it outright or rebuilt it (ruling R6b,
2026-11-27, premise corrected by R6c; `studio/src/editor/rescueCore.ts`). "Own" means letters carrying this
session's document id. A book reopened from the device keeps its letters' original ids, so there "own" means
letters typed this session; but a book imported this session is written whole under this session's id, so its
imported letters are "own" too, and the rescue cannot tell them from typed ones. It therefore says nothing for an
all-own paragraph (it counts them `uncounted`): this also silences letters really typed this session. Whether to
tell there (and how to avoid a false claim in an import session) is open for V in the PR.

### `rescue.lost`

- **en** (source): {n} letter you typed went with a change made in another tab, and could not be put back.
- **es** Español: `{n} letra que escribiste se perdió con un cambio hecho en otra pestaña y no se pudo reponer.`
- **fr** Français: `{n} lettre que vous avez tapée est partie avec une modification faite dans un autre onglet et n’a pas pu être remise en place.`
- **de** Deutsch: `{n} Buchstabe, den Sie getippt haben, ist mit einer Änderung in einem anderen Tab verloren gegangen und konnte nicht wieder eingefügt werden.`
- **it** Italiano: `{n} lettera che hai scritto è andata persa con una modifica fatta in un’altra scheda e non è stato possibile rimetterla al suo posto.`
- **pt** Português: `{n} letra que escreveu perdeu-se com uma alteração feita noutro separador e não foi possível repô-la.`
- **nl** Nederlands: `{n} letter die u typte is verloren gegaan bij een wijziging in een ander tabblad en kon niet worden teruggezet.`
- **pl** Polski: `{n} wpisana litera zniknęła wraz ze zmianą wprowadzoną w innej karcie i nie dało się jej przywrócić.`
- **ru** Русский: `{n} набранная вами буква пропала вместе с изменением в другой вкладке, и её не удалось вернуть.`
- **tr** Türkçe: `Yazdığınız {n} harf, başka bir sekmede yapılan bir değişiklikle kayboldu ve geri getirilemedi.`
- **ar** العربية: `{n} حرف كتبته ضاع مع تغيير أُجري في علامة تبويب أخرى، وتعذّرت إعادته.`
- **ja** 日本語: `入力した {n} 文字が別のタブでの変更とともに消え、元に戻せませんでした。`
- **zh-Hans** 简体中文: `你输入的 {n} 个字符随另一个标签页中的更改一起消失了，无法放回原处。`

### `rescue.lostPlural`

- **en** (source): {n} letters you typed went with a change made in another tab, and could not be put back.
- **es** Español: `{n} letras que escribiste se perdieron con un cambio hecho en otra pestaña y no se pudieron reponer.`
- **fr** Français: `{n} lettres que vous avez tapées sont parties avec une modification faite dans un autre onglet et n’ont pas pu être remises en place.`
- **de** Deutsch: `{n} Buchstaben, die Sie getippt haben, sind mit einer Änderung in einem anderen Tab verloren gegangen und konnten nicht wieder eingefügt werden.`
- **it** Italiano: `{n} lettere che hai scritto sono andate perse con una modifica fatta in un’altra scheda e non è stato possibile rimetterle al loro posto.`
- **pt** Português: `{n} letras que escreveu perderam-se com uma alteração feita noutro separador e não foi possível repô-las.`
- **nl** Nederlands: `{n} letters die u typte zijn verloren gegaan bij een wijziging in een ander tabblad en konden niet worden teruggezet.`
- **pl** Polski: `Nie dało się przywrócić wpisanych liter, które zniknęły wraz ze zmianą wprowadzoną w innej karcie: {n}.`
- **ru** Русский: `Набранных вами букв, которые пропали вместе с изменением в другой вкладке и которые не удалось вернуть: {n}.`
- **tr** Türkçe: `Yazdığınız {n} harf, başka bir sekmede yapılan bir değişiklikle kayboldu ve geri getirilemedi.`
- **ar** العربية: `عدد الأحرف التي كتبتها وضاعت مع تغيير أُجري في علامة تبويب أخرى وتعذّرت إعادتها: {n}.`
- **ja** 日本語: `入力した {n} 文字が別のタブでの変更とともに消え、元に戻せませんでした。`
- **zh-Hans** 简体中文: `你输入的 {n} 个字符随另一个标签页中的更改一起消失了，无法放回原处。`

## 7. Hindi and Marathi — two whole interface packs (3,012 keys each, 2026-11-26; 3,026 after merging main, 2026-11-27)

**Every string in both packs is an unreviewed draft written by Claude.** V asked for them so his parents can use the studio
and give feedback; V (and they) are the native-speaker review. Nothing here is approved until V says so.

Where they live: `client/index.html`, the `BEUK:ui-hi-mr` block (after `/BEUK:next-strings`), one `UI_STRINGS["hi"]` and one
`UI_STRINGS["mr"]` object carrying every key of `UI_STRINGS.en`. The easiest review is in the studio itself: the language
menu (globe, top right) → हिन्दी or मराठी.

How they were made:

- Register (V, 2026-11-26): Hindi is everyday Hindustani with common English loanwords (किताब, सेव करें, एक्सपोर्ट), polite आप.
  Marathi is everyday Pune/Mumbai Marathi, तुम्ही, no nukta. Western digits throughout.
- One shared glossary for every chunk: `docs/ui-hi-mr-glossary.md`. Change a term there first, then in the pack.
- A checker proved, for every key: present, the same `{placeholders}`, the same HTML tags, Devanagari present where the
  English has words, no added exclamation marks, no nukta in Marathi.
- Sentences that name another Beuk screen use that screen's translated label in quotes. The account page stays English,
  so "Download all my data" is quoted in English.

Words most worth a look (each appears many times, so changing one means a find-and-replace across the pack):

| English | Hindi draft | Marathi draft | Why it's worth a look |
|---|---|---|---|
| Covenant | अनुबंध | करार | both lean "contract"; the feature is the book's people/places/things |
| book | किताब | पुस्तक | |
| section | सेक्शन | विभाग | |
| chapter | अध्याय | प्रकरण | |
| shelf | शेल्फ़ (masculine) | शेल्फ | Hindi gender was mixed in the drafts; normalised to आपका शेल्फ़ |
| Paper / Candlelight themes | कागज़ / मोमबत्ती की रोशनी | कागद / मेणबत्ती | |
| export / preview | एक्सपोर्ट / प्रीव्यू | एक्सपोर्ट / प्रीव्ह्यू | loanwords on purpose |
| Lore (Covenant entry type) | दंतकथा | दंतकथा | means "legend"; alternative कहानी की दुनिया / कथेचे जग |
| Pass / Fail | पास / फ़ेल | पास / फेल | |
| Stop (read aloud) | रोकें | थांबवा | kept apart from Close (बंद करें / बंद करा) |

Strings to check on screen, not just in the list:

- `ir.card.sections`, `ir.card.pages` (and their `Plural` twins): sentence fragments joined at runtime.
- `creator.sample*`: Theme Creator sample text is translated (as ja, ar and ru are), so it shows in Devanagari, not in the
  Latin face being previewed.
- The interface font: Karla/Inter have no Devanagari, so the menus fall back to the device's own Devanagari sans
  (`Nirmala UI` on Windows, `Kohinoor Devanagari` on Apple, `Noto Sans Devanagari` on Android). No font file was added.

Also drafts in this set:

- `STARTER_TEXT.hi` and `STARTER_TEXT.mr` (the 13 back-matter starter texts: About the Author, Acknowledgements, Also by, the
  review and newsletter asks, the colophon). Hindi `about.first` says लिखता/लिखती हूँ because the writer's gender is unknown.
- Marathi is now a book language too (`LANG_PACKS.mr`, dictation `mr-IN`): the studio's rule is that every interface
  language is also a book language. Devanagari text is told apart from Hindi by its commonest words (आहे, आणि, नाही …
  against है, और, नहीं …); a writer can always pick the language by hand. Since the 2026-11-27 review the Marathi list
  holds only words Hindi does not use (होता / होती / होते / आता / केले / पण / तुम्ही were taken out), Marathi needs a clear
  margin (at least 3 of its words and twice the Hindi count), and anything less stays Hindi, as it was before Marathi.

### Keys added on main since 340cb22 (14 keys, 2026-11-27)

Merging main into this branch brought 14 English keys that the hi/mr packs did not have yet. The l10n guard
(`tests/localization.test.ts`) requires every interface language to carry every English key, so each got a Hindi and a
Marathi draft, written into the `BEUK:ui-hi-mr` block in English key order. **All 28 are UNSIGNED drafts; none is approved.** They were drafted by
Claude by hand, with `docs/ui-hi-mr-glossary.md` and the neighbouring hi/mr strings (no translation service or API was
called), in the same register as the rest of the packs: Hindi with आप, Marathi with तुम्ही, no nukta in Marathi, Western
digits, `{placeholders}` byte for byte.

Every other pack still carries English placeholders for `preview.deviceLabel`, `preview.desk.toggle` and the ten cover
picture keys (main's `BEUK:coverpan strings` says so until V signs off); hi and mr have drafts for them because these two
packs are whole drafts anyway. If V prefers the English placeholders there too, they can be swapped back.

Points worth a look:

- **rescue.lost / rescue.lostPlural**: "went with a change" is said as "went along with a change" (hi चला गया / चले गए,
  mr गेले / गेली); "put back" as hi वापस नहीं लाया जा सका (as restore → वापस लाएँ) and mr पुन्हा जागेवर आणता आले नाही.
  Letter is अक्षर in both, as `next.textWarning` says it.
- **front cover**: hi सामने वाला कवर and mr पुढचे मुखपृष्ठ, as `covermk.spine.bgFront` ("Follow the front") already says.
- **Picture — across / down**: the slider names are said by direction (hi दाएँ-बाएँ / ऊपर-नीचे, mr डावीकडे-उजवीकडे / वर-खाली).
- **store.c.cdpi.fixZoom** names the slider in quotes by its translated label (“तस्वीर — ज़ूम”, “चित्र — झूम”), per the
  glossary's rule for naming another control; the English has the label in parentheses without quotes.
- **soft** (a picture that may look soft): hi धुंधली, mr धूसर, as `store.c.textK.tintsFix` says it.

#### `preview.deviceLabel`

- where: the preview device menu's accessible name (`data-i18n-aria` on `#deviceBar`)
- **en** (source): Preview device
- **hi** हिन्दी: `प्रीव्यू डिवाइस`
- **mr** मराठी: `प्रीव्ह्यू डिव्हाइस`

#### `preview.desk.toggle`

- where: the reading desk's fold button (`BEUK:deskfold`)
- **en** (source): Chapters and page counts
- **hi** हिन्दी: `अध्याय और पेजों की गिनती`
- **mr** मराठी: `प्रकरणे आणि पानसंख्या`

#### `rescue.lost`

- where: the keystroke rescue (`BEUK:keystrokerescue`, section 6)
- **en** (source): {n} letter you typed went with a change made in another tab, and could not be put back.
- **hi** हिन्दी: `आपने जो {n} अक्षर टाइप किया था, वह दूसरे टैब में किए गए एक बदलाव के साथ चला गया, और उसे वापस नहीं लाया जा सका।`
- **mr** मराठी: `तुम्ही टाइप केलेले {n} अक्षर दुसऱ्या टॅबमध्ये केलेल्या एका बदलासोबत गेले, आणि ते पुन्हा जागेवर आणता आले नाही.`

#### `rescue.lostPlural`

- where: the keystroke rescue, the `Plural` twin
- **en** (source): {n} letters you typed went with a change made in another tab, and could not be put back.
- **hi** हिन्दी: `आपने जो {n} अक्षर टाइप किए थे, वे दूसरे टैब में किए गए एक बदलाव के साथ चले गए, और उन्हें वापस नहीं लाया जा सका।`
- **mr** मराठी: `तुम्ही टाइप केलेली {n} अक्षरे दुसऱ्या टॅबमध्ये केलेल्या एका बदलासोबत गेली, आणि ती पुन्हा जागेवर आणता आली नाहीत.`

#### `covermk.picHint`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Drag the picture on the cover, away from the text, to choose what shows. It always fills the cover.
- **hi** हिन्दी: `क्या दिखे, यह चुनने के लिए कवर पर तस्वीर को टेक्स्ट से हटकर किसी जगह से खींचें। तस्वीर हमेशा पूरा कवर भरती है।`
- **mr** मराठी: `काय दिसावे ते निवडण्यासाठी मुखपृष्ठावरचे चित्र मजकुरापासून दूर कुठूनही धरून ओढा. चित्र नेहमी संपूर्ण मुखपृष्ठ भरते.`

#### `covermk.picH`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Picture — across
- **hi** हिन्दी: `तस्वीर — दाएँ-बाएँ`
- **mr** मराठी: `चित्र — डावीकडे-उजवीकडे`

#### `covermk.picV`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Picture — down
- **hi** हिन्दी: `तस्वीर — ऊपर-नीचे`
- **mr** मराठी: `चित्र — वर-खाली`

#### `covermk.picZoom`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Picture — zoom
- **hi** हिन्दी: `तस्वीर — ज़ूम`
- **mr** मराठी: `चित्र — झूम`

#### `covermk.resetPic`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Reset picture
- **hi** हिन्दी: `तस्वीर पहले जैसी करें`
- **mr** मराठी: `चित्र पूर्वीसारखे करा`

#### `covermk.picSoft`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): At this zoom the picture prints at about {ppi} pixels per inch on the print cover — under {need}, so it may look soft. Zoom out, or use a larger picture.
- **hi** हिन्दी: `इस ज़ूम पर तस्वीर प्रिंट कवर पर लगभग {ppi} पिक्सेल प्रति इंच पर छपती है — {need} से कम, इसलिए यह धुंधली दिख सकती है। ज़ूम कम करें, या बड़ी तस्वीर लगाएँ।`
- **mr** मराठी: `या झूमवर चित्र प्रिंट मुखपृष्ठावर सुमारे {ppi} पिक्सेल प्रति इंच इतके छापले जाते — {need} पेक्षा कमी, त्यामुळे ते धूसर दिसू शकते. झूम कमी करा, किंवा मोठे चित्र वापरा.`

#### `store.c.cdpi.failZoom`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): The cover artwork “{image}” is zoomed to {zoom} on the front cover, which leaves it {dpi} DPI there; {store} asks for {need}.
- **hi** हिन्दी: `कवर आर्टवर्क “{image}” सामने वाले कवर पर {zoom} तक ज़ूम किया गया है, जिससे वहाँ वह {dpi} DPI रह जाता है; {store} {need} माँगता है।`
- **mr** मराठी: `मुखपृष्ठ चित्र “{image}” पुढच्या मुखपृष्ठावर {zoom} पर्यंत झूम केले आहे, त्यामुळे तिथे ते {dpi} DPI राहते; {store} {need} मागते.`

#### `store.c.cdpi.fixZoom`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): Zoom the picture out in the cover maker (Picture — zoom), or supply a larger picture.
- **hi** हिन्दी: `कवर मेकर में तस्वीर का ज़ूम कम करें (“तस्वीर — ज़ूम”), या बड़ी तस्वीर दें।`
- **mr** मराठी: `मुखपृष्ठ मेकरमध्ये चित्राचा झूम कमी करा (“चित्र — झूम”), किंवा मोठे चित्र द्या.`

#### `covermk.picSoftLarger`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): At this zoom the picture prints at about {ppi} pixels per inch on the print cover — under {need}, so it may look soft. Even at 100% it is about {full}, so zooming out will not sharpen it: use a larger picture.
- **hi** हिन्दी: `इस ज़ूम पर तस्वीर प्रिंट कवर पर लगभग {ppi} पिक्सेल प्रति इंच पर छपती है — {need} से कम, इसलिए यह धुंधली दिख सकती है। 100% पर भी यह लगभग {full} है, इसलिए ज़ूम कम करने से यह साफ़ नहीं होगी: बड़ी तस्वीर लगाएँ।`
- **mr** मराठी: `या झूमवर चित्र प्रिंट मुखपृष्ठावर सुमारे {ppi} पिक्सेल प्रति इंच इतके छापले जाते — {need} पेक्षा कमी, त्यामुळे ते धूसर दिसू शकते. 100% वरसुद्धा ते सुमारे {full} आहे, त्यामुळे झूम कमी केल्याने ते स्पष्ट होणार नाही: मोठे चित्र वापरा.`

#### `store.c.cdpi.okZoom`

- where: cover picture move and zoom (`BEUK:coverpan strings`)
- **en** (source): The cover artwork “{image}” ({px} px) is zoomed to {zoom} on the front cover, which leaves it {dpi} DPI there, its lowest anywhere on the wrap ({need} needed).
- **hi** हिन्दी: `कवर आर्टवर्क “{image}” ({px} px) सामने वाले कवर पर {zoom} तक ज़ूम किया गया है, जिससे वहाँ वह {dpi} DPI देता है — पूरे रैप पर उसका सबसे कम ({need} चाहिए)।`
- **mr** मराठी: `मुखपृष्ठ चित्र “{image}” ({px} px) पुढच्या मुखपृष्ठावर {zoom} पर्यंत झूम केले आहे, त्यामुळे तिथे ते {dpi} DPI देते — संपूर्ण रॅपवरचे त्याचे सर्वात कमी ({need} लागते).`

### Updated drafts: quoted button names that did not match the button (3 strings, 2026-11-27)

A review found three drafts that quote a button by a name the button does not carry. Each now quotes the button's own
label in the same language, character for character. **They are still UNSIGNED drafts**, like the rest of this section;
only the quoted names changed.

#### `store.nc.notRun` (hi)

- quotes `store.runServer`, whose hi label is `सर्वर पर पूरी जाँच चलाएँ`
- was: `इसकी जाँच Beuk सर्वर करता है: “सर्वर की पूरी जाँच चलाएँ” दबाएँ।`
- now: `इसकी जाँच Beuk सर्वर करता है: “सर्वर पर पूरी जाँच चलाएँ” दबाएँ।`

#### `store.nc.notRun` (mr)

- quotes `store.runServer`, whose mr label is `संपूर्ण सर्व्हर तपासणी चालवा`
- was: `हे Beuk सर्व्हर तपासतो: “सर्व्हरची पूर्ण तपासणी चालवा” दाबा.`
- now: `हे Beuk सर्व्हर तपासतो: “संपूर्ण सर्व्हर तपासणी चालवा” दाबा.`

#### `bible.seriesConflictNote` (mr)

- quotes `offline.keepMine` (mr `माझी प्रत ठेवा`), `offline.useShelf` (mr `शेल्फवरची प्रत वापरा`) and `offline.keepBoth`
  (mr `दोन्ही ठेवा`, already right)
- was: `“माझी ठेवा” शेल्फवरील प्रतीच्या जागी या डिव्हाइसवरील प्रत ठेवते. “शेल्फवरील प्रत वापरा” या डिव्हाइसवरील प्रतीच्या जागी शेल्फवरील प्रत ठेवते. मालिकेचा करार एकच असतो, त्यामुळे इथे “दोन्ही ठेवा” नाही.`
- now: `“माझी प्रत ठेवा” शेल्फवरील प्रतीच्या जागी या डिव्हाइसवरील प्रत ठेवते. “शेल्फवरची प्रत वापरा” या डिव्हाइसवरील प्रतीच्या जागी शेल्फवरील प्रत ठेवते. मालिकेचा करार एकच असतो, त्यामुळे इथे “दोन्ही ठेवा” नाही.`
- the hi note already quoted all three hi labels exactly; it is unchanged.

## 8. The ARC panel in the 2.0 studio (59 keys, 2026-11-27)

The author's side of ARC campaigns, slice 1 (`studio/src/arc/ArcPanel.tsx`): a section in the export screen's archive
group ("Run an ARC" / "Open your ARC") and the dialog that starts one campaign for the desk book and runs it (the signup
link, the counts, the reader list with Approve / Decline / Close this copy, Close sign-ups, Delete this ARC). Its keys are in
`client/index.html` `UI_STRINGS`: the `BEUK:arc` block (`ARC_STRINGS`, English and the 12 packs beside it) and, for Hindi
and Marathi, the `BEUK:ui-hi-mr` block, in English key order after `tool.verseInPoem`.

**English.** Three strings are fixed, word for word, by the plan and the spec: `arcp.stamp` (the Global Constraint's author
panel line, V's), `arcp.noReview` and `arcp.deleteConfirm` (the plan's, kept by ruling F15). Every other English string is
Claude's and is V's to confirm in the PR. **All 14 other languages below are drafts written by Claude by hand: not approved,
not read by a native speaker.** No translation service or API was called.

How the drafts were made:

- `{placeholders}` byte for byte (a generator refused any draft whose set differed from English), none empty, none still
  the English, no added exclamation mark, no nukta in Marathi.
- Amazon rule (plan Global Constraints): no draft says "in exchange for a review" or treats a review as owed; `arcp.noReview`
  says readers are never asked and reviewing is their choice, in each language.
- Address form as each pack's neighbouring strings: *tú* (es, it), *vous* (fr), *Sie* (de), the third person (pt), *u*
  (nl), Polish without a person where it can (imperatives as the pack's buttons), *вы* (ru), *siz* (tr), the second person
  (ar), no pronoun (ja), *你* (zh-Hans), *आप* (hi), *तुम्ही* (mr).
- "ARC" stays as the acronym in every language (the section heading explains it once: advance copies, then "(ARC)"); "EPUB",
  "Beuk", "Goodreads" and "Amazon" stay as they are.
- Counts stand after a colon (`arcp.claimedN`, `arcp.pendingN`), so no string needs a plural form. **pl**, **ru** and **tr**
  put the date in `arcp.endedSum` after a colon too, so it reads with any date format.
- Book copy and the Copy button are different words everywhere (es ejemplar / Copiar, de Exemplar / Kopieren, hi प्रति / कॉपी करें …).

Points worth a look:

- **`arcp.mailOff`** fills `{reason}` with the server's English setting name (`ARC_MAIL_FROM is not set`,
  `ARC_SMTP_URL is not set`, or the salt's reason): the name of a server setting is not translated.
- **`arcp.notSent`** fills `{detail}` with the server's English reason for an unsent email.
- **`arcp.stamp`** is the panel's line. The stamp inside readers' EPUBs stays English (ruling F16); these drafts do not change it.
- **ja** `arcp.closeConfirm` says 取り消せません (cannot be cancelled), not 元に戻せません, so it does not read as the app's Undo.
- **ja** `arcp.stamp` says 海賊版の作り手 (a maker of pirated copies) for "pirate"; **zh-Hans** 盗版者; **tr** korsan; **ar** قرصان.
- **de** uses *das ARC* (das Exemplar); **nl** *de ARC*; **mr** neuter *ARC* (तुमचे ARC).
- **hi** `arcp.approval` is "हर पाठक मेरी मंज़ूरी से जुड़े" so it carries no grammatical gender for the writer.

### `arcp.secH`

- **en** (source, Claude's): Advance review copies
- **es** Español: `Ejemplares anticipados (ARC)`
- **fr** Français: `Exemplaires en avant-première (ARC)`
- **de** Deutsch: `Vorab-Exemplare (ARC)`
- **it** Italiano: `Copie in anteprima (ARC)`
- **pt** Português: `Exemplares antecipados (ARC)`
- **nl** Nederlands: `Voorpublicatie-exemplaren (ARC)`
- **pl** Polski: `Egzemplarze przedpremierowe (ARC)`
- **ru** Русский: `Сигнальные экземпляры (ARC)`
- **tr** Türkçe: `Ön okuma kopyaları (ARC)`
- **ar** العربية: `نسخ مسبقة للقرّاء (ARC)`
- **hi** हिन्दी: `रिलीज़ से पहले की प्रतियाँ (ARC)`
- **mr** मराठी: `प्रकाशनापूर्वीच्या प्रती (ARC)`
- **ja** 日本語: `発売前の献本（ARC）`
- **zh-Hans** 简体中文: `预发本（ARC）`

### `arcp.secSub`

- **en** (source, Claude's): Give early readers a free copy before launch. They sign up through an unlisted link, and each copy names its reader.
- **es** Español: `Regala un ejemplar a tus primeros lectores antes del lanzamiento. Se apuntan con un enlace no listado, y cada ejemplar lleva el nombre de su lector.`
- **fr** Français: `Offrez un exemplaire gratuit à vos premiers lecteurs avant la sortie. Ils s'inscrivent par un lien non répertorié, et chaque exemplaire porte le nom de son lecteur.`
- **de** Deutsch: `Geben Sie ersten Lesern vor dem Erscheinen ein kostenloses Exemplar. Die Anmeldung läuft über einen nicht gelisteten Link, und jedes Exemplar nennt seinen Leser.`
- **it** Italiano: `Regala una copia ai tuoi primi lettori prima dell'uscita. Si iscrivono tramite un link non elencato, e ogni copia porta il nome del suo lettore.`
- **pt** Português: `Ofereça um exemplar aos primeiros leitores antes do lançamento. Inscrevem-se através de um link não listado, e cada exemplar tem o nome do seu leitor.`
- **nl** Nederlands: `Geef eerste lezers vóór de verschijning een gratis exemplaar. Ze melden zich aan via een niet-openbare link, en elk exemplaar draagt de naam van de lezer.`
- **pl** Polski: `Pierwsi czytelnicy dostają darmowy egzemplarz przed premierą. Zapisują się przez niepubliczny link, a w każdym egzemplarzu jest imię jego czytelnika.`
- **ru** Русский: `Подарите первым читателям бесплатный экземпляр до выхода книги. Они записываются по неопубликованной ссылке, и в каждом экземпляре указано имя его читателя.`
- **tr** Türkçe: `İlk okurlarınıza çıkıştan önce ücretsiz bir kopya verin. Listelenmeyen bir bağlantıyla kaydolurlar ve her kopyada okurunun adı yazar.`
- **ar** العربية: `امنح قرّاءك الأوائل نسخة مجانية قبل الإصدار. يسجّلون عبر رابط غير مُدرج، وتحمل كل نسخة اسم قارئها.`
- **hi** हिन्दी: `रिलीज़ से पहले अपने पहले पाठकों को एक मुफ़्त प्रति दें। वे एक बिना-सूचीबद्ध लिंक से साइन अप करते हैं, और हर प्रति पर उसके पाठक का नाम होता है।`
- **mr** मराठी: `प्रकाशनापूर्वी तुमच्या पहिल्या वाचकांना एक मोफत प्रत द्या. ते एका यादीत नसलेल्या लिंकवरून नोंदणी करतात, आणि प्रत्येक प्रतीवर तिच्या वाचकाचे नाव असते.`
- **ja** 日本語: `発売前に、最初の読者へ無料の献本を届けます。読者は非公開のリンクから申し込み、献本にはそれぞれ読者の名前が入ります。`
- **zh-Hans** 简体中文: `在发售前，把免费的书送给第一批读者。他们通过不公开的链接报名，每一份都写有读者的名字。`

### `arcp.run`

- **en** (source, Claude's): Run an ARC
- **es** Español: `Iniciar un ARC`
- **fr** Français: `Lancer un ARC`
- **de** Deutsch: `ARC starten`
- **it** Italiano: `Avvia un ARC`
- **pt** Português: `Iniciar um ARC`
- **nl** Nederlands: `Een ARC starten`
- **pl** Polski: `Rozpocznij ARC`
- **ru** Русский: `Запустить ARC`
- **tr** Türkçe: `ARC başlat`
- **ar** العربية: `ابدأ حملة ARC`
- **hi** हिन्दी: `ARC शुरू करें`
- **mr** मराठी: `ARC सुरू करा`
- **ja** 日本語: `ARCを始める`
- **zh-Hans** 简体中文: `开始 ARC`

### `arcp.open`

- **en** (source, Claude's): Open your ARC
- **es** Español: `Abrir tu ARC`
- **fr** Français: `Ouvrir votre ARC`
- **de** Deutsch: `Ihr ARC öffnen`
- **it** Italiano: `Apri il tuo ARC`
- **pt** Português: `Abrir o seu ARC`
- **nl** Nederlands: `Uw ARC openen`
- **pl** Polski: `Otwórz ARC`
- **ru** Русский: `Открыть ваш ARC`
- **tr** Türkçe: `ARC'nizi açın`
- **ar** العربية: `افتح حملة ARC`
- **hi** हिन्दी: `अपना ARC खोलें`
- **mr** मराठी: `तुमचे ARC उघडा`
- **ja** 日本語: `ARCを開く`
- **zh-Hans** 简体中文: `打开你的 ARC`

### `arcp.title`

- **en** (source, Claude's): ARC for “{title}”
- **es** Español: `ARC de «{title}»`
- **fr** Français: `ARC de « {title} »`
- **de** Deutsch: `ARC für „{title}“`
- **it** Italiano: `ARC di «{title}»`
- **pt** Português: `ARC de «{title}»`
- **nl** Nederlands: `ARC voor “{title}”`
- **pl** Polski: `ARC: „{title}”`
- **ru** Русский: `ARC для «{title}»`
- **tr** Türkçe: `“{title}” için ARC`
- **ar** العربية: `حملة ARC لكتاب «{title}»`
- **hi** हिन्दी: `“{title}” का ARC`
- **mr** मराठी: `“{title}” साठी ARC`
- **ja** 日本語: `『{title}』のARC`
- **zh-Hans** 简体中文: `《{title}》的 ARC`

### `arcp.loading`

- **en** (source, Claude's): Reading your ARC…
- **es** Español: `Leyendo tu ARC…`
- **fr** Français: `Lecture de votre ARC…`
- **de** Deutsch: `Ihr ARC wird gelesen…`
- **it** Italiano: `Lettura del tuo ARC…`
- **pt** Português: `A ler o seu ARC…`
- **nl** Nederlands: `Uw ARC wordt gelezen…`
- **pl** Polski: `Wczytywanie ARC…`
- **ru** Русский: `Загружаем ваш ARC…`
- **tr** Türkçe: `ARC'niz okunuyor…`
- **ar** العربية: `جارٍ تحميل حملة ARC…`
- **hi** हिन्दी: `आपका ARC पढ़ा जा रहा है…`
- **mr** मराठी: `तुमचे ARC वाचले जात आहे…`
- **ja** 日本語: `ARCを読み込んでいます…`
- **zh-Hans** 简体中文: `正在读取你的 ARC…`

### `arcp.offline`

- **en** (source, Claude's): Beuk could not be reached. Nothing changed; try again.
- **es** Español: `No se pudo conectar con Beuk. No ha cambiado nada; inténtalo de nuevo.`
- **fr** Français: `Impossible de joindre Beuk. Rien n'a changé ; réessayez.`
- **de** Deutsch: `Beuk ist nicht erreichbar. Nichts wurde geändert; versuchen Sie es erneut.`
- **it** Italiano: `Impossibile raggiungere Beuk. Non è cambiato nulla; riprova.`
- **pt** Português: `Não foi possível contactar o Beuk. Nada mudou; tente novamente.`
- **nl** Nederlands: `Beuk is niet bereikbaar. Er is niets veranderd; probeer het opnieuw.`
- **pl** Polski: `Nie udało się połączyć z Beuk. Nic się nie zmieniło; spróbuj ponownie.`
- **ru** Русский: `Не удалось связаться с Beuk. Ничего не изменилось; попробуйте ещё раз.`
- **tr** Türkçe: `Beuk'e ulaşılamadı. Hiçbir şey değişmedi; yeniden deneyin.`
- **ar** العربية: `تعذّر الوصول إلى Beuk. لم يتغيّر شيء؛ حاول مرة أخرى.`
- **hi** हिन्दी: `Beuk से संपर्क नहीं हो सका। कुछ नहीं बदला; फिर से कोशिश करें।`
- **mr** मराठी: `Beuk शी संपर्क होऊ शकला नाही. काहीही बदलले नाही; पुन्हा प्रयत्न करा.`
- **ja** 日本語: `Beukに接続できませんでした。何も変更されていません。もう一度お試しください。`
- **zh-Hans** 简体中文: `无法连接 Beuk。没有任何更改；请重试。`

### `arcp.mailOff`

- **en** (source, Claude's): ARC email is not set up on this server ({reason}), so a campaign cannot start yet.
- **es** Español: `El correo de los ARC no está configurado en este servidor ({reason}), así que todavía no se puede iniciar una campaña.`
- **fr** Français: `L'e-mail des ARC n'est pas configuré sur ce serveur ({reason}) : une campagne ne peut donc pas encore commencer.`
- **de** Deutsch: `Die ARC-E-Mail ist auf diesem Server nicht eingerichtet ({reason}), daher kann noch keine Kampagne starten.`
- **it** Italiano: `L'email degli ARC non è configurata su questo server ({reason}), quindi non si può ancora avviare una campagna.`
- **pt** Português: `O e-mail dos ARC não está configurado neste servidor ({reason}), por isso ainda não é possível iniciar uma campanha.`
- **nl** Nederlands: `ARC-e-mail is op deze server niet ingesteld ({reason}), dus een campagne kan nog niet starten.`
- **pl** Polski: `Poczta ARC nie jest skonfigurowana na tym serwerze ({reason}), więc kampanii nie można jeszcze rozpocząć.`
- **ru** Русский: `Почта для ARC на этом сервере не настроена ({reason}), поэтому кампанию пока нельзя начать.`
- **tr** Türkçe: `Bu sunucuda ARC e-postası ayarlanmamış ({reason}), bu yüzden henüz bir kampanya başlatılamaz.`
- **ar** العربية: `بريد ARC غير مُعدّ على هذا الخادم ({reason})، لذا لا يمكن بدء حملة بعد.`
- **hi** हिन्दी: `इस सर्वर पर ARC ईमेल सेट नहीं है ({reason}), इसलिए अभी कोई अभियान शुरू नहीं हो सकता।`
- **mr** मराठी: `या सर्व्हरवर ARC ईमेल सेट केलेले नाही ({reason}), त्यामुळे अजून मोहीम सुरू करता येत नाही.`
- **ja** 日本語: `このサーバーではARC用のメールが設定されていません（{reason}）。そのため、まだキャンペーンを始められません。`
- **zh-Hans** 简体中文: `此服务器未设置 ARC 邮件（{reason}），所以暂时还不能开始活动。`

### `arcp.launch`

- **en** (source, Claude's): Launch date
- **es** Español: `Fecha de lanzamiento`
- **fr** Français: `Date de sortie`
- **de** Deutsch: `Erscheinungsdatum`
- **it** Italiano: `Data di uscita`
- **pt** Português: `Data de lançamento`
- **nl** Nederlands: `Verschijningsdatum`
- **pl** Polski: `Data premiery`
- **ru** Русский: `Дата выхода`
- **tr** Türkçe: `Çıkış tarihi`
- **ar** العربية: `تاريخ الإصدار`
- **hi** हिन्दी: `रिलीज़ की तारीख`
- **mr** मराठी: `प्रकाशनाची तारीख`
- **ja** 日本語: `発売日`
- **zh-Hans** 简体中文: `发售日期`

### `arcp.closes`

- **en** (source, Claude's): Sign-ups close
- **es** Español: `Cierre de inscripciones`
- **fr** Français: `Fin des inscriptions`
- **de** Deutsch: `Anmeldeschluss`
- **it** Italiano: `Chiusura iscrizioni`
- **pt** Português: `Fim das inscrições`
- **nl** Nederlands: `Aanmelden sluit`
- **pl** Polski: `Koniec zapisów`
- **ru** Русский: `Запись закрывается`
- **tr** Türkçe: `Kayıtların kapanışı`
- **ar** العربية: `إغلاق التسجيل`
- **hi** हिन्दी: `साइन अप बंद होने की तारीख`
- **mr** मराठी: `नोंदणी बंद होण्याची तारीख`
- **ja** 日本語: `申し込みの締め切り`
- **zh-Hans** 简体中文: `报名截止`

### `arcp.closesHint`

- **en** (source, Claude's): At the end of that day, in your time zone.
- **es** Español: `Al final de ese día, en tu zona horaria.`
- **fr** Français: `À la fin de ce jour-là, dans votre fuseau horaire.`
- **de** Deutsch: `Am Ende dieses Tages, in Ihrer Zeitzone.`
- **it** Italiano: `Alla fine di quel giorno, nel tuo fuso orario.`
- **pt** Português: `No fim desse dia, no seu fuso horário.`
- **nl** Nederlands: `Aan het eind van die dag, in uw tijdzone.`
- **pl** Polski: `Z końcem tego dnia, według lokalnej strefy czasowej.`
- **ru** Русский: `В конце этого дня, по вашему часовому поясу.`
- **tr** Türkçe: `O günün sonunda, sizin saat diliminizde.`
- **ar** العربية: `في نهاية ذلك اليوم، بحسب منطقتك الزمنية.`
- **hi** हिन्दी: `उस दिन के अंत में, आपके टाइम ज़ोन के हिसाब से।`
- **mr** मराठी: `त्या दिवसाच्या शेवटी, तुमच्या टाइम झोननुसार.`
- **ja** 日本語: `その日の終わり（お使いのタイムゾーン）。`
- **zh-Hans** 简体中文: `在那一天结束时，按你的时区。`

### `arcp.copies`

- **en** (source, Claude's): Copies (1 to 50)
- **es** Español: `Ejemplares (de 1 a 50)`
- **fr** Français: `Exemplaires (de 1 à 50)`
- **de** Deutsch: `Exemplare (1 bis 50)`
- **it** Italiano: `Copie (da 1 a 50)`
- **pt** Português: `Exemplares (de 1 a 50)`
- **nl** Nederlands: `Exemplaren (1 tot 50)`
- **pl** Polski: `Egzemplarze (od 1 do 50)`
- **ru** Русский: `Экземпляры (от 1 до 50)`
- **tr** Türkçe: `Kopya sayısı (1 ile 50 arası)`
- **ar** العربية: `النسخ (من 1 إلى 50)`
- **hi** हिन्दी: `प्रतियाँ (1 से 50)`
- **mr** मराठी: `प्रती (1 ते 50)`
- **ja** 日本語: `部数（1〜50）`
- **zh-Hans** 简体中文: `份数（1 到 50）`

### `arcp.copiesBad`

- **en** (source, Claude's): Choose a number of copies from 1 to 50.
- **es** Español: `Elige un número de ejemplares entre 1 y 50.`
- **fr** Français: `Choisissez un nombre d'exemplaires entre 1 et 50.`
- **de** Deutsch: `Wählen Sie eine Anzahl von Exemplaren zwischen 1 und 50.`
- **it** Italiano: `Scegli un numero di copie da 1 a 50.`
- **pt** Português: `Escolha um número de exemplares entre 1 e 50.`
- **nl** Nederlands: `Kies een aantal exemplaren van 1 tot 50.`
- **pl** Polski: `Wybierz liczbę egzemplarzy od 1 do 50.`
- **ru** Русский: `Выберите число экземпляров от 1 до 50.`
- **tr** Türkçe: `1 ile 50 arasında bir kopya sayısı seçin.`
- **ar** العربية: `اختر عدد نسخ من 1 إلى 50.`
- **hi** हिन्दी: `1 से 50 के बीच प्रतियों की संख्या चुनें।`
- **mr** मराठी: `1 ते 50 मधील प्रतींची संख्या निवडा.`
- **ja** 日本語: `部数は1から50の間で選んでください。`
- **zh-Hans** 简体中文: `请选择 1 到 50 之间的份数。`

### `arcp.joining`

- **en** (source, Claude's): Joining
- **es** Español: `Inscripción`
- **fr** Français: `Inscription`
- **de** Deutsch: `Teilnahme`
- **it** Italiano: `Iscrizione`
- **pt** Português: `Inscrição`
- **nl** Nederlands: `Aanmelden`
- **pl** Polski: `Zapisy`
- **ru** Русский: `Запись`
- **tr** Türkçe: `Katılım`
- **ar** العربية: `الانضمام`
- **hi** हिन्दी: `जुड़ने का तरीका`
- **mr** मराठी: `सहभागी होण्याची पद्धत`
- **ja** 日本語: `参加方法`
- **zh-Hans** 简体中文: `加入方式`

### `arcp.instant`

- **en** (source, Claude's): Instant: a reader who confirms their email gets a copy, while copies last
- **es** Español: `Inmediata: quien confirma su correo recibe un ejemplar, mientras queden`
- **fr** Français: `Immédiate : un lecteur qui confirme son e-mail reçoit un exemplaire, dans la limite des exemplaires disponibles`
- **de** Deutsch: `Sofort: Wer seine E-Mail-Adresse bestätigt, erhält ein Exemplar, solange der Vorrat reicht`
- **it** Italiano: `Immediata: chi conferma la propria email riceve una copia, fino a esaurimento`
- **pt** Português: `Imediata: quem confirma o e-mail recebe um exemplar, enquanto houver`
- **nl** Nederlands: `Direct: wie zijn e-mailadres bevestigt, krijgt een exemplaar, zolang de voorraad strekt`
- **pl** Polski: `Od razu: czytelnik, który potwierdzi e-mail, dostaje egzemplarz, dopóki starczy`
- **ru** Русский: `Сразу: читатель, подтвердивший адрес почты, получает экземпляр, пока они есть`
- **tr** Türkçe: `Anında: e-postasını doğrulayan okur, kopyalar tükenene kadar bir kopya alır`
- **ar** العربية: `فوري: القارئ الذي يؤكد بريده يحصل على نسخة ما دامت النسخ متوفرة`
- **hi** हिन्दी: `तुरंत: जो पाठक अपना ईमेल पक्का करता है, उसे एक प्रति मिलती है, जब तक प्रतियाँ बची हों`
- **mr** मराठी: `लगेच: जो वाचक आपला ईमेल पक्का करतो त्याला, प्रती शिल्लक असेपर्यंत, एक प्रत मिळते`
- **ja** 日本語: `すぐに：メールアドレスを確認した読者に、部数がある限り献本が届きます`
- **zh-Hans** 简体中文: `即时：确认邮箱的读者即可获得一份，送完为止`

### `arcp.approval`

- **en** (source, Claude's): I approve each reader
- **es** Español: `Apruebo a cada lector`
- **fr** Français: `J'approuve chaque lecteur`
- **de** Deutsch: `Ich nehme jeden Leser selbst an`
- **it** Italiano: `Approvo ogni lettore`
- **pt** Português: `Aprovo cada leitor`
- **nl** Nederlands: `Ik keur elke lezer goed`
- **pl** Polski: `Zatwierdzam każdego czytelnika`
- **ru** Русский: `Я одобряю каждого читателя`
- **tr** Türkçe: `Her okuru ben onaylarım`
- **ar** العربية: `أوافق على كل قارئ بنفسي`
- **hi** हिन्दी: `हर पाठक मेरी मंज़ूरी से जुड़े`
- **mr** मराठी: `प्रत्येक वाचक माझ्या मंजुरीने`
- **ja** 日本語: `読者を一人ずつ承認する`
- **zh-Hans** 简体中文: `由我逐一批准读者`

### `arcp.approvalHint`

- **en** (source, Claude's): Readers confirm their email and give a profile link (such as Goodreads or Amazon). You approve or decline each one; Beuk never opens the link.
- **es** Español: `Los lectores confirman su correo y dan un enlace a su perfil (por ejemplo, de Goodreads o Amazon). Tú apruebas o rechazas a cada uno; Beuk nunca abre el enlace.`
- **fr** Français: `Les lecteurs confirment leur e-mail et donnent un lien vers leur profil (Goodreads ou Amazon, par exemple). Vous approuvez ou refusez chacun d'eux ; Beuk n'ouvre jamais ce lien.`
- **de** Deutsch: `Leser bestätigen ihre E-Mail-Adresse und geben einen Profil-Link an (zum Beispiel bei Goodreads oder Amazon). Sie nehmen jeden an oder lehnen ihn ab; Beuk öffnet den Link nie.`
- **it** Italiano: `I lettori confermano la propria email e indicano un link al loro profilo (per esempio Goodreads o Amazon). Tu approvi o rifiuti ciascuno; Beuk non apre mai il link.`
- **pt** Português: `Os leitores confirmam o e-mail e indicam um link para o seu perfil (por exemplo, no Goodreads ou na Amazon). Aprova ou recusa cada um; o Beuk nunca abre o link.`
- **nl** Nederlands: `Lezers bevestigen hun e-mailadres en geven een link naar hun profiel (bijvoorbeeld op Goodreads of Amazon). U keurt elke lezer goed of wijst hem af; Beuk opent de link nooit.`
- **pl** Polski: `Czytelnicy potwierdzają e-mail i podają link do swojego profilu (np. w Goodreads lub Amazon). Każdego czytelnika zatwierdza się lub odrzuca ręcznie; Beuk nigdy nie otwiera tego linku.`
- **ru** Русский: `Читатели подтверждают адрес почты и указывают ссылку на свой профиль (например, на Goodreads или Amazon). Вы одобряете или отклоняете каждого; Beuk никогда не открывает эту ссылку.`
- **tr** Türkçe: `Okurlar e-postalarını doğrular ve bir profil bağlantısı verir (örneğin Goodreads veya Amazon). Her birini siz onaylar ya da reddedersiniz; Beuk bağlantıyı asla açmaz.`
- **ar** العربية: `يؤكد القرّاء بريدهم ويقدّمون رابط ملفهم الشخصي (مثل Goodreads أو Amazon). توافق على كل واحد منهم أو ترفضه؛ ولا يفتح Beuk الرابط أبدًا.`
- **hi** हिन्दी: `पाठक अपना ईमेल पक्का करते हैं और अपनी प्रोफ़ाइल का लिंक देते हैं (जैसे Goodreads या Amazon)। आप हर एक को मंज़ूरी देते हैं या मना करते हैं; Beuk वह लिंक कभी नहीं खोलता।`
- **mr** मराठी: `वाचक आपला ईमेल पक्का करतात आणि आपल्या प्रोफाइलची लिंक देतात (उदा. Goodreads किंवा Amazon). प्रत्येकाला तुम्ही मंजुरी देता किंवा नकार देता; Beuk ती लिंक कधीच उघडत नाही.`
- **ja** 日本語: `読者はメールアドレスを確認し、プロフィールのリンク（GoodreadsやAmazonなど）を入力します。一人ずつ承認するかお断りするかを選びます。Beukがそのリンクを開くことはありません。`
- **zh-Hans** 简体中文: `读者确认邮箱，并提供个人主页链接（例如 Goodreads 或 Amazon）。你逐一批准或拒绝；Beuk 从不打开这个链接。`

### `arcp.stamp`

- **en** (source, fixed by the plan/spec): Each copy names its reader. That deters sharing; it cannot stop a determined pirate.
- **es** Español: `Cada ejemplar lleva el nombre de su lector. Eso disuade de compartirlo; no puede detener a un pirata decidido.`
- **fr** Français: `Chaque exemplaire porte le nom de son lecteur. Cela dissuade de le partager ; cela ne peut pas arrêter un pirate déterminé.`
- **de** Deutsch: `Jedes Exemplar nennt seinen Leser. Das schreckt vom Weitergeben ab; einen entschlossenen Raubkopierer kann es nicht aufhalten.`
- **it** Italiano: `Ogni copia porta il nome del suo lettore. Questo scoraggia la condivisione; non può fermare un pirata determinato.`
- **pt** Português: `Cada exemplar tem o nome do seu leitor. Isso desencoraja a partilha; não consegue travar um pirata determinado.`
- **nl** Nederlands: `Elk exemplaar draagt de naam van de lezer. Dat ontmoedigt delen; een vastberaden piraat houdt het niet tegen.`
- **pl** Polski: `W każdym egzemplarzu jest imię jego czytelnika. To zniechęca do udostępniania; nie powstrzyma zdeterminowanego pirata.`
- **ru** Русский: `В каждом экземпляре указано имя его читателя. Это удерживает от распространения; решительного пирата это не остановит.`
- **tr** Türkçe: `Her kopyada okurunun adı yazar. Bu, paylaşmayı caydırır; kararlı bir korsanı durduramaz.`
- **ar** العربية: `تحمل كل نسخة اسم قارئها. هذا يردع عن مشاركتها؛ لكنه لا يستطيع إيقاف قرصان مصمّم.`
- **hi** हिन्दी: `हर प्रति पर उसके पाठक का नाम होता है। इससे शेयर करने से लोग रुकते हैं; पर पक्के इरादे वाले पाइरेट को यह नहीं रोक सकता।`
- **mr** मराठी: `प्रत्येक प्रतीवर तिच्या वाचकाचे नाव असते. त्यामुळे शेअर करण्याला आळा बसतो; पण ठाम निश्चय केलेल्या पायरेटला ते थांबवू शकत नाही.`
- **ja** 日本語: `献本にはそれぞれ読者の名前が入ります。共有を思いとどまらせることはできますが、意志の固い海賊版の作り手は止められません。`
- **zh-Hans** 简体中文: `每一份都写有读者的名字。这能阻止随意分享，但挡不住铁了心的盗版者。`

### `arcp.noReview`

- **en** (source, fixed by the plan/spec): Copies are free. Readers are never asked for a review; if they'd like to review it, that's their choice.
- **es** Español: `Los ejemplares son gratis. Nunca se pide una reseña a los lectores; si quieren reseñarlo, es su decisión.`
- **fr** Français: `Les exemplaires sont gratuits. On ne demande jamais d'avis aux lecteurs ; s'ils souhaitent en donner un, c'est leur choix.`
- **de** Deutsch: `Die Exemplare sind kostenlos. Leser werden nie um eine Rezension gebeten; ob sie eine schreiben möchten, entscheiden sie selbst.`
- **it** Italiano: `Le copie sono gratuite. Ai lettori non viene mai chiesta una recensione; se vogliono recensirlo, è una loro scelta.`
- **pt** Português: `Os exemplares são gratuitos. Nunca se pede uma crítica aos leitores; se quiserem escrever uma, a escolha é deles.`
- **nl** Nederlands: `De exemplaren zijn gratis. Lezers wordt nooit om een recensie gevraagd; of ze er een willen schrijven, kiezen ze zelf.`
- **pl** Polski: `Egzemplarze są bezpłatne. Czytelników nigdy nie prosi się o recenzję; jeśli zechcą ją napisać, to ich wybór.`
- **ru** Русский: `Экземпляры бесплатны. У читателей никогда не просят отзыв; если они захотят его написать, это их выбор.`
- **tr** Türkçe: `Kopyalar ücretsizdir. Okurlardan asla yorum istenmez; yorum yazmak isterlerse bu onların seçimidir.`
- **ar** العربية: `النسخ مجانية. لا يُطلب من القرّاء أبدًا كتابة مراجعة؛ وإن رغبوا في مراجعته، فذلك اختيارهم.`
- **hi** हिन्दी: `प्रतियाँ मुफ़्त हैं। पाठकों से कभी रिव्यू नहीं माँगा जाता; अगर वे रिव्यू लिखना चाहें, तो यह उनकी मर्ज़ी है।`
- **mr** मराठी: `प्रती मोफत आहेत. वाचकांना कधीही परीक्षण मागितले जात नाही; त्यांना परीक्षण लिहायचे असेल, तर ती त्यांची निवड आहे.`
- **ja** 日本語: `献本は無料です。読者にレビューを頼むことはありません。レビューを書くかどうかは読者が決めることです。`
- **zh-Hans** 简体中文: `这些书是免费的。读者从不会被要求写书评；如果他们愿意评论，那是他们自己的选择。`

### `arcp.start`

- **en** (source, Claude's): Start the ARC
- **es** Español: `Iniciar el ARC`
- **fr** Français: `Lancer l'ARC`
- **de** Deutsch: `Das ARC starten`
- **it** Italiano: `Avvia l'ARC`
- **pt** Português: `Iniciar o ARC`
- **nl** Nederlands: `De ARC starten`
- **pl** Polski: `Uruchom ARC`
- **ru** Русский: `Начать ARC`
- **tr** Türkçe: `ARC'yi başlat`
- **ar** العربية: `ابدأ الحملة`
- **hi** हिन्दी: `ARC अभियान शुरू करें`
- **mr** मराठी: `ARC मोहीम सुरू करा`
- **ja** 日本語: `ARCを開始`
- **zh-Hans** 简体中文: `开始 ARC 活动`

### `arcp.building`

- **en** (source, Claude's): Building your book's EPUB once, for every reader. This can take a minute.
- **es** Español: `Creando el EPUB de tu libro una sola vez, para todos los lectores. Puede tardar un minuto.`
- **fr** Français: `Création de l'EPUB de votre livre, une seule fois pour tous les lecteurs. Cela peut prendre une minute.`
- **de** Deutsch: `Das EPUB Ihres Buchs wird einmal für alle Leser erstellt. Das kann eine Minute dauern.`
- **it** Italiano: `Creazione dell'EPUB del tuo libro, una volta sola per tutti i lettori. Può richiedere un minuto.`
- **pt** Português: `A criar o EPUB do seu livro uma única vez, para todos os leitores. Pode demorar um minuto.`
- **nl** Nederlands: `Het EPUB van uw boek wordt één keer gemaakt, voor alle lezers. Dit kan een minuut duren.`
- **pl** Polski: `Tworzenie pliku EPUB książki, raz dla wszystkich czytelników. To może potrwać minutę.`
- **ru** Русский: `Создаём EPUB вашей книги один раз для всех читателей. Это может занять минуту.`
- **tr** Türkçe: `Kitabınızın EPUB'ı tüm okurlar için bir kez oluşturuluyor. Bu bir dakika sürebilir.`
- **ar** العربية: `يجري إنشاء ملف EPUB لكتابك مرة واحدة لكل القرّاء. قد يستغرق ذلك دقيقة.`
- **hi** हिन्दी: `सभी पाठकों के लिए आपकी किताब का EPUB एक बार बनाया जा रहा है। इसमें एक मिनट लग सकता है।`
- **mr** मराठी: `सर्व वाचकांसाठी तुमच्या पुस्तकाचे EPUB एकदाच तयार होत आहे. याला एक मिनिट लागू शकतो.`
- **ja** 日本語: `すべての読者のために、この本のEPUBを一度だけ作成しています。1分ほどかかることがあります。`
- **zh-Hans** 简体中文: `正在为所有读者一次性生成这本书的 EPUB。这可能需要一分钟。`

### `arcp.link`

- **en** (source, Claude's): Signup link
- **es** Español: `Enlace de inscripción`
- **fr** Français: `Lien d'inscription`
- **de** Deutsch: `Anmelde-Link`
- **it** Italiano: `Link di iscrizione`
- **pt** Português: `Link de inscrição`
- **nl** Nederlands: `Aanmeldlink`
- **pl** Polski: `Link do zapisów`
- **ru** Русский: `Ссылка для записи`
- **tr** Türkçe: `Kayıt bağlantısı`
- **ar** العربية: `رابط التسجيل`
- **hi** हिन्दी: `साइन अप लिंक`
- **mr** मराठी: `नोंदणीची लिंक`
- **ja** 日本語: `申し込みリンク`
- **zh-Hans** 简体中文: `报名链接`

### `arcp.copy`

- **en** (source, Claude's): Copy
- **es** Español: `Copiar`
- **fr** Français: `Copier`
- **de** Deutsch: `Kopieren`
- **it** Italiano: `Copia`
- **pt** Português: `Copiar`
- **nl** Nederlands: `Kopiëren`
- **pl** Polski: `Kopiuj`
- **ru** Русский: `Копировать`
- **tr** Türkçe: `Kopyala`
- **ar** العربية: `انسخ`
- **hi** हिन्दी: `कॉपी करें`
- **mr** मराठी: `कॉपी करा`
- **ja** 日本語: `コピー`
- **zh-Hans** 简体中文: `复制`

### `arcp.copied`

- **en** (source, Claude's): Copied
- **es** Español: `Copiado`
- **fr** Français: `Copié`
- **de** Deutsch: `Kopiert`
- **it** Italiano: `Copiato`
- **pt** Português: `Copiado`
- **nl** Nederlands: `Gekopieerd`
- **pl** Polski: `Skopiowano`
- **ru** Русский: `Скопировано`
- **tr** Türkçe: `Kopyalandı`
- **ar** العربية: `نُسخ`
- **hi** हिन्दी: `कॉपी हो गया`
- **mr** मराठी: `कॉपी झाले`
- **ja** 日本語: `コピーしました`
- **zh-Hans** 简体中文: `已复制`

### `arcp.unlisted`

- **en** (source, Claude's): Unlisted: Beuk lists it nowhere and asks search engines not to index it. Anyone who has the link can sign up.
- **es** Español: `No listado: Beuk no lo muestra en ningún sitio y pide a los buscadores que no lo indexen. Cualquiera que tenga el enlace puede apuntarse.`
- **fr** Français: `Non répertorié : Beuk ne l'affiche nulle part et demande aux moteurs de recherche de ne pas l'indexer. Toute personne qui a le lien peut s'inscrire.`
- **de** Deutsch: `Nicht gelistet: Beuk zeigt ihn nirgends an und bittet Suchmaschinen, ihn nicht zu indexieren. Wer den Link hat, kann sich anmelden.`
- **it** Italiano: `Non elencato: Beuk non lo mostra da nessuna parte e chiede ai motori di ricerca di non indicizzarlo. Chiunque abbia il link può iscriversi.`
- **pt** Português: `Não listado: o Beuk não o mostra em lado nenhum e pede aos motores de pesquisa que não o indexem. Qualquer pessoa que tenha o link pode inscrever-se.`
- **nl** Nederlands: `Niet openbaar: Beuk toont hem nergens en vraagt zoekmachines hem niet te indexeren. Iedereen die de link heeft, kan zich aanmelden.`
- **pl** Polski: `Niepubliczny: Beuk nigdzie go nie pokazuje i prosi wyszukiwarki, aby go nie indeksowały. Każdy, kto ma ten link, może się zapisać.`
- **ru** Русский: `Не опубликована: Beuk нигде её не показывает и просит поисковые системы не индексировать её. Записаться может любой, у кого есть ссылка.`
- **tr** Türkçe: `Listelenmiyor: Beuk onu hiçbir yerde göstermez ve arama motorlarından dizine eklememelerini ister. Bağlantıya sahip olan herkes kaydolabilir.`
- **ar** العربية: `غير مُدرج: لا يعرضه Beuk في أي مكان ويطلب من محركات البحث عدم فهرسته. يمكن لأي شخص لديه الرابط أن يسجّل.`
- **hi** हिन्दी: `बिना-सूचीबद्ध: Beuk इसे कहीं नहीं दिखाता और सर्च इंजनों से इसे इंडेक्स न करने को कहता है। जिसके पास भी लिंक है, वह साइन अप कर सकता है।`
- **mr** मराठी: `यादीत नसलेली: Beuk ती कुठेही दाखवत नाही आणि सर्च इंजिनना ती इंडेक्स न करण्यास सांगते. ज्याच्याकडे लिंक आहे तो कोणीही नोंदणी करू शकतो.`
- **ja** 日本語: `非公開：Beukはこのリンクをどこにも表示せず、検索エンジンにもインデックスしないよう求めます。リンクを知っている人なら誰でも申し込めます。`
- **zh-Hans** 简体中文: `不公开：Beuk 不在任何地方列出它，并要求搜索引擎不要收录。任何拿到链接的人都可以报名。`

### `arcp.linkHidden`

- **en** (source, Claude's): The signup link is shown only when it is made. To see one again, make a new signup link; the old one then stops working.
- **es** Español: `El enlace de inscripción solo se muestra cuando se crea. Para volver a ver uno, crea un enlace de inscripción nuevo; el anterior deja entonces de funcionar.`
- **fr** Français: `Le lien d'inscription n'est affiché qu'au moment où il est créé. Pour en revoir un, créez un nouveau lien d'inscription ; l'ancien cesse alors de fonctionner.`
- **de** Deutsch: `Der Anmelde-Link wird nur angezeigt, wenn er erstellt wird. Um wieder einen zu sehen, erstellen Sie einen neuen Anmelde-Link; der alte funktioniert dann nicht mehr.`
- **it** Italiano: `Il link di iscrizione viene mostrato solo quando viene creato. Per vederne uno di nuovo, crea un nuovo link di iscrizione; quello vecchio smette allora di funzionare.`
- **pt** Português: `O link de inscrição só é mostrado quando é criado. Para voltar a ver um, crie um novo link de inscrição; o anterior deixa então de funcionar.`
- **nl** Nederlands: `De aanmeldlink wordt alleen getoond wanneer hij wordt gemaakt. Om er weer een te zien, maakt u een nieuwe aanmeldlink; de oude werkt dan niet meer.`
- **pl** Polski: `Link do zapisów jest pokazywany tylko w chwili utworzenia. Aby znów go zobaczyć, utwórz nowy link do zapisów; stary przestanie wtedy działać.`
- **ru** Русский: `Ссылка для записи показывается только в момент создания. Чтобы снова увидеть ссылку, создайте новую ссылку для записи; старая тогда перестанет работать.`
- **tr** Türkçe: `Kayıt bağlantısı yalnızca oluşturulduğu anda gösterilir. Yeniden görmek için yeni bir kayıt bağlantısı oluşturun; eskisi o zaman çalışmaz.`
- **ar** العربية: `يظهر رابط التسجيل فقط عند إنشائه. لرؤية رابط مجددًا، أنشئ رابط تسجيل جديدًا؛ وعندها يتوقف الرابط القديم عن العمل.`
- **hi** हिन्दी: `साइन अप लिंक सिर्फ़ बनाते समय दिखता है। उसे फिर से देखने के लिए नया साइन अप लिंक बनाएँ; तब पुराना लिंक काम करना बंद कर देता है।`
- **mr** मराठी: `नोंदणीची लिंक फक्त तयार करताना दिसते. ती पुन्हा पाहण्यासाठी नवीन नोंदणीची लिंक तयार करा; मग जुनी लिंक काम करणे थांबते.`
- **ja** 日本語: `申し込みリンクは作成したときにだけ表示されます。もう一度表示するには、新しい申し込みリンクを作成してください。古いリンクは使えなくなります。`
- **zh-Hans** 简体中文: `报名链接只在创建时显示。要再次看到链接，请创建新的报名链接；旧链接随即失效。`

### `arcp.newLink`

- **en** (source, Claude's): Make a new signup link
- **es** Español: `Crear un enlace de inscripción nuevo`
- **fr** Français: `Créer un nouveau lien d'inscription`
- **de** Deutsch: `Neuen Anmelde-Link erstellen`
- **it** Italiano: `Crea un nuovo link di iscrizione`
- **pt** Português: `Criar um novo link de inscrição`
- **nl** Nederlands: `Een nieuwe aanmeldlink maken`
- **pl** Polski: `Utwórz nowy link do zapisów`
- **ru** Русский: `Создать новую ссылку для записи`
- **tr** Türkçe: `Yeni kayıt bağlantısı oluştur`
- **ar** العربية: `أنشئ رابط تسجيل جديدًا`
- **hi** हिन्दी: `नया साइन अप लिंक बनाएँ`
- **mr** मराठी: `नवीन नोंदणीची लिंक तयार करा`
- **ja** 日本語: `新しい申し込みリンクを作成`
- **zh-Hans** 简体中文: `创建新的报名链接`

### `arcp.claimedN`

- **en** (source, Claude's): Claimed: {n} of {max}
- **es** Español: `Reclamados: {n} de {max}`
- **fr** Français: `Réclamés : {n} sur {max}`
- **de** Deutsch: `Vergeben: {n} von {max}`
- **it** Italiano: `Assegnate: {n} su {max}`
- **pt** Português: `Atribuídos: {n} de {max}`
- **nl** Nederlands: `Geclaimd: {n} van {max}`
- **pl** Polski: `Odebrane: {n} z {max}`
- **ru** Русский: `Получено: {n} из {max}`
- **tr** Türkçe: `Alınan: {n} / {max}`
- **ar** العربية: `النسخ المأخوذة: {n} من {max}`
- **hi** हिन्दी: `ली गई प्रतियाँ: {max} में से {n}`
- **mr** मराठी: `घेतलेल्या प्रती: {max} पैकी {n}`
- **ja** 日本語: `受け取り済み：{n} / {max}`
- **zh-Hans** 简体中文: `已领取：{n} / {max}`

### `arcp.pendingN`

- **en** (source, Claude's): Waiting for you: {n}
- **es** Español: `Esperando tu respuesta: {n}`
- **fr** Français: `En attente de votre réponse : {n}`
- **de** Deutsch: `Warten auf Sie: {n}`
- **it** Italiano: `In attesa di te: {n}`
- **pt** Português: `À espera da sua resposta: {n}`
- **nl** Nederlands: `Wachten op u: {n}`
- **pl** Polski: `Czekają na decyzję: {n}`
- **ru** Русский: `Ждут вашего решения: {n}`
- **tr** Türkçe: `Onayınızı bekleyen: {n}`
- **ar** العربية: `بانتظار قرارك: {n}`
- **hi** हिन्दी: `आपके फ़ैसले का इंतज़ार: {n}`
- **mr** मराठी: `तुमच्या निर्णयाची वाट: {n}`
- **ja** 日本語: `承認待ち：{n}`
- **zh-Hans** 简体中文: `等你处理：{n}`

### `arcp.launchOn`

- **en** (source, Claude's): Launch: {date}
- **es** Español: `Lanzamiento: {date}`
- **fr** Français: `Sortie : {date}`
- **de** Deutsch: `Erscheinen: {date}`
- **it** Italiano: `Uscita: {date}`
- **pt** Português: `Lançamento: {date}`
- **nl** Nederlands: `Verschijning: {date}`
- **pl** Polski: `Premiera: {date}`
- **ru** Русский: `Выход: {date}`
- **tr** Türkçe: `Çıkış: {date}`
- **ar** العربية: `الإصدار: {date}`
- **hi** हिन्दी: `रिलीज़: {date}`
- **mr** मराठी: `प्रकाशन: {date}`
- **ja** 日本語: `発売：{date}`
- **zh-Hans** 简体中文: `发售：{date}`

### `arcp.closesOn`

- **en** (source, Claude's): Sign-ups close: {date}
- **es** Español: `Las inscripciones cierran: {date}`
- **fr** Français: `Fin des inscriptions : {date}`
- **de** Deutsch: `Anmeldeschluss: {date}`
- **it** Italiano: `Le iscrizioni chiudono: {date}`
- **pt** Português: `As inscrições fecham: {date}`
- **nl** Nederlands: `Aanmelden sluit: {date}`
- **pl** Polski: `Koniec zapisów: {date}`
- **ru** Русский: `Запись закрывается: {date}`
- **tr** Türkçe: `Kayıtlar kapanıyor: {date}`
- **ar** العربية: `يُغلق التسجيل: {date}`
- **hi** हिन्दी: `साइन अप बंद: {date}`
- **mr** मराठी: `नोंदणी बंद: {date}`
- **ja** 日本語: `申し込み締め切り：{date}`
- **zh-Hans** 简体中文: `报名截止：{date}`

### `arcp.holders`

- **en** (source, Claude's): Readers hold {label} ({n})
- **es** Español: `Los lectores tienen {label} ({n})`
- **fr** Français: `Les lecteurs ont {label} ({n})`
- **de** Deutsch: `Leser haben {label} ({n})`
- **it** Italiano: `I lettori hanno {label} ({n})`
- **pt** Português: `Os leitores têm {label} ({n})`
- **nl** Nederlands: `Lezers hebben {label} ({n})`
- **pl** Polski: `Czytelnicy mają {label} ({n})`
- **ru** Русский: `У читателей {label} ({n})`
- **tr** Türkçe: `Okurlardaki sürüm: {label} ({n})`
- **ar** العربية: `لدى القرّاء {label} ({n})`
- **hi** हिन्दी: `पाठकों के पास {label} ({n})`
- **mr** मराठी: `वाचकांकडे {label} ({n})`
- **ja** 日本語: `読者の手元の版：{label}（{n}）`
- **zh-Hans** 简体中文: `读者手中的版本：{label}（{n}）`

### `arcp.modeInstant`

- **en** (source, Claude's): Joining: instant
- **es** Español: `Inscripción: inmediata`
- **fr** Français: `Inscription : immédiate`
- **de** Deutsch: `Teilnahme: sofort`
- **it** Italiano: `Iscrizione: immediata`
- **pt** Português: `Inscrição: imediata`
- **nl** Nederlands: `Aanmelden: direct`
- **pl** Polski: `Zapisy: od razu`
- **ru** Русский: `Запись: сразу`
- **tr** Türkçe: `Katılım: anında`
- **ar** العربية: `الانضمام: فوري`
- **hi** हिन्दी: `जुड़ने का तरीका: तुरंत`
- **mr** मराठी: `सहभागी होण्याची पद्धत: लगेच`
- **ja** 日本語: `参加方法：すぐに`
- **zh-Hans** 简体中文: `加入方式：即时`

### `arcp.modeApproval`

- **en** (source, Claude's): Joining: you approve each reader
- **es** Español: `Inscripción: tú apruebas a cada lector`
- **fr** Français: `Inscription : vous approuvez chaque lecteur`
- **de** Deutsch: `Teilnahme: Sie nehmen jeden Leser selbst an`
- **it** Italiano: `Iscrizione: approvi tu ogni lettore`
- **pt** Português: `Inscrição: aprova cada leitor`
- **nl** Nederlands: `Aanmelden: u keurt elke lezer goed`
- **pl** Polski: `Zapisy: każdy czytelnik zatwierdzany ręcznie`
- **ru** Русский: `Запись: вы одобряете каждого читателя`
- **tr** Türkçe: `Katılım: her okuru siz onaylarsınız`
- **ar** العربية: `الانضمام: توافق على كل قارئ بنفسك`
- **hi** हिन्दी: `जुड़ने का तरीका: हर पाठक को आप मंज़ूरी देते हैं`
- **mr** मराठी: `सहभागी होण्याची पद्धत: प्रत्येक वाचकाला तुम्ही मंजुरी देता`
- **ja** 日本語: `参加方法：読者を一人ずつ承認`
- **zh-Hans** 简体中文: `加入方式：由你逐一批准`

### `arcp.readersH`

- **en** (source, Claude's): Readers
- **es** Español: `Lectores`
- **fr** Français: `Lecteurs`
- **de** Deutsch: `Leser`
- **it** Italiano: `Lettori`
- **pt** Português: `Leitores`
- **nl** Nederlands: `Lezers`
- **pl** Polski: `Czytelnicy`
- **ru** Русский: `Читатели`
- **tr** Türkçe: `Okurlar`
- **ar** العربية: `القرّاء`
- **hi** हिन्दी: `पाठक`
- **mr** मराठी: `वाचक`
- **ja** 日本語: `読者`
- **zh-Hans** 简体中文: `读者`

### `arcp.noReaders`

- **en** (source, Claude's): No reader has signed up yet.
- **es** Español: `Todavía no se ha apuntado ningún lector.`
- **fr** Français: `Aucun lecteur ne s'est encore inscrit.`
- **de** Deutsch: `Noch hat sich kein Leser angemeldet.`
- **it** Italiano: `Nessun lettore si è ancora iscritto.`
- **pt** Português: `Ainda nenhum leitor se inscreveu.`
- **nl** Nederlands: `Er heeft zich nog geen lezer aangemeld.`
- **pl** Polski: `Nikt jeszcze się nie zapisał.`
- **ru** Русский: `Пока никто не записался.`
- **tr** Türkçe: `Henüz kaydolan okur yok.`
- **ar** العربية: `لم يسجّل أي قارئ بعد.`
- **hi** हिन्दी: `अभी तक किसी पाठक ने साइन अप नहीं किया है।`
- **mr** मराठी: `अजून कोणत्याही वाचकाने नोंदणी केलेली नाही.`
- **ja** 日本語: `まだ申し込んだ読者はいません。`
- **zh-Hans** 简体中文: `还没有读者报名。`

### `arcp.stPending`

- **en** (source, Claude's): Waiting
- **es** Español: `Esperando`
- **fr** Français: `En attente`
- **de** Deutsch: `Wartet`
- **it** Italiano: `In attesa`
- **pt** Português: `À espera`
- **nl** Nederlands: `Wacht`
- **pl** Polski: `Czeka`
- **ru** Русский: `Ждёт`
- **tr** Türkçe: `Bekliyor`
- **ar** العربية: `بالانتظار`
- **hi** हिन्दी: `इंतज़ार में`
- **mr** मराठी: `वाट पाहत आहे`
- **ja** 日本語: `承認待ち`
- **zh-Hans** 简体中文: `等待中`

### `arcp.stClaimed`

- **en** (source, Claude's): Has a copy
- **es** Español: `Tiene un ejemplar`
- **fr** Français: `A un exemplaire`
- **de** Deutsch: `Hat ein Exemplar`
- **it** Italiano: `Ha una copia`
- **pt** Português: `Tem um exemplar`
- **nl** Nederlands: `Heeft een exemplaar`
- **pl** Polski: `Ma egzemplarz`
- **ru** Русский: `Есть экземпляр`
- **tr** Türkçe: `Kopyası var`
- **ar** العربية: `لديه نسخة`
- **hi** हिन्दी: `प्रति मिल गई`
- **mr** मराठी: `प्रत मिळाली`
- **ja** 日本語: `献本あり`
- **zh-Hans** 简体中文: `已有一份`

### `arcp.stClosed`

- **en** (source, Claude's): Copy closed
- **es** Español: `Ejemplar cerrado`
- **fr** Français: `Exemplaire fermé`
- **de** Deutsch: `Exemplar geschlossen`
- **it** Italiano: `Copia chiusa`
- **pt** Português: `Exemplar fechado`
- **nl** Nederlands: `Exemplaar gesloten`
- **pl** Polski: `Egzemplarz zamknięty`
- **ru** Русский: `Экземпляр закрыт`
- **tr** Türkçe: `Kopya kapatıldı`
- **ar** العربية: `أُغلقت النسخة`
- **hi** हिन्दी: `प्रति बंद`
- **mr** मराठी: `प्रत बंद`
- **ja** 日本語: `献本を閉じました`
- **zh-Hans** 简体中文: `已关闭`

### `arcp.stDeclined`

- **en** (source, Claude's): Declined
- **es** Español: `Rechazado`
- **fr** Français: `Refusé`
- **de** Deutsch: `Abgelehnt`
- **it** Italiano: `Rifiutato`
- **pt** Português: `Recusado`
- **nl** Nederlands: `Afgewezen`
- **pl** Polski: `Odrzucony`
- **ru** Русский: `Отклонён`
- **tr** Türkçe: `Reddedildi`
- **ar** العربية: `مرفوض`
- **hi** हिन्दी: `मना किया गया`
- **mr** मराठी: `नकार दिला`
- **ja** 日本語: `お断り済み`
- **zh-Hans** 简体中文: `已拒绝`

### `arcp.profile`

- **en** (source, Claude's): Profile link, as the reader typed it (Beuk does not open it): {link}
- **es** Español: `Enlace al perfil, tal como lo escribió el lector (Beuk no lo abre): {link}`
- **fr** Français: `Lien du profil, tel que le lecteur l'a saisi (Beuk ne l'ouvre pas) : {link}`
- **de** Deutsch: `Profil-Link, wie der Leser ihn eingegeben hat (Beuk öffnet ihn nicht): {link}`
- **it** Italiano: `Link al profilo, come l'ha scritto il lettore (Beuk non lo apre): {link}`
- **pt** Português: `Link do perfil, tal como o leitor o escreveu (o Beuk não o abre): {link}`
- **nl** Nederlands: `Profiellink, zoals de lezer hem typte (Beuk opent hem niet): {link}`
- **pl** Polski: `Link do profilu, tak jak wpisał go czytelnik (Beuk go nie otwiera): {link}`
- **ru** Русский: `Ссылка на профиль, как её ввёл читатель (Beuk её не открывает): {link}`
- **tr** Türkçe: `Profil bağlantısı, okurun yazdığı gibi (Beuk onu açmaz): {link}`
- **ar** العربية: `رابط الملف الشخصي كما كتبه القارئ (لا يفتحه Beuk): {link}`
- **hi** हिन्दी: `प्रोफ़ाइल लिंक, जैसा पाठक ने लिखा (Beuk इसे नहीं खोलता): {link}`
- **mr** मराठी: `प्रोफाइलची लिंक, वाचकाने लिहिल्याप्रमाणे (Beuk ती उघडत नाही): {link}`
- **ja** 日本語: `プロフィールのリンク（読者が入力したまま。Beukは開きません）：{link}`
- **zh-Hans** 简体中文: `个人主页链接，按读者输入的原样显示（Beuk 不会打开）：{link}`

### `arcp.approve`

- **en** (source, Claude's): Approve
- **es** Español: `Aprobar`
- **fr** Français: `Approuver`
- **de** Deutsch: `Annehmen`
- **it** Italiano: `Approva`
- **pt** Português: `Aprovar`
- **nl** Nederlands: `Goedkeuren`
- **pl** Polski: `Zatwierdź`
- **ru** Русский: `Одобрить`
- **tr** Türkçe: `Onayla`
- **ar** العربية: `وافق`
- **hi** हिन्दी: `मंज़ूरी दें`
- **mr** मराठी: `मंजुरी द्या`
- **ja** 日本語: `承認`
- **zh-Hans** 简体中文: `批准`

### `arcp.decline`

- **en** (source, Claude's): Decline
- **es** Español: `Rechazar`
- **fr** Français: `Refuser`
- **de** Deutsch: `Ablehnen`
- **it** Italiano: `Rifiuta`
- **pt** Português: `Recusar`
- **nl** Nederlands: `Afwijzen`
- **pl** Polski: `Odrzuć`
- **ru** Русский: `Отклонить`
- **tr** Türkçe: `Reddet`
- **ar** العربية: `ارفض`
- **hi** हिन्दी: `मना करें`
- **mr** मराठी: `नकार द्या`
- **ja** 日本語: `お断りする`
- **zh-Hans** 简体中文: `拒绝`

### `arcp.revoke`

- **en** (source, Claude's): Close this copy
- **es** Español: `Cerrar este ejemplar`
- **fr** Français: `Fermer cet exemplaire`
- **de** Deutsch: `Dieses Exemplar schließen`
- **it** Italiano: `Chiudi questa copia`
- **pt** Português: `Fechar este exemplar`
- **nl** Nederlands: `Dit exemplaar sluiten`
- **pl** Polski: `Zamknij ten egzemplarz`
- **ru** Русский: `Закрыть этот экземпляр`
- **tr** Türkçe: `Bu kopyayı kapat`
- **ar** العربية: `أغلق هذه النسخة`
- **hi** हिन्दी: `यह प्रति बंद करें`
- **mr** मराठी: `ही प्रत बंद करा`
- **ja** 日本語: `この献本を閉じる`
- **zh-Hans** 简体中文: `关闭这份`

### `arcp.revokeConfirm`

- **en** (source, Claude's): Close this reader's copy? Their link stops working and is never reopened. A copy they already downloaded stays on their device.
- **es** Español: `¿Cerrar el ejemplar de este lector? Su enlace deja de funcionar y nunca se vuelve a abrir. Un ejemplar que ya haya descargado se queda en su dispositivo.`
- **fr** Français: `Fermer l'exemplaire de ce lecteur ? Son lien cesse de fonctionner et n'est jamais rouvert. Un exemplaire qu'il a déjà téléchargé reste sur son appareil.`
- **de** Deutsch: `Das Exemplar dieses Lesers schließen? Sein Link funktioniert dann nicht mehr und wird nie wieder geöffnet. Ein bereits heruntergeladenes Exemplar bleibt auf seinem Gerät.`
- **it** Italiano: `Chiudere la copia di questo lettore? Il suo link smette di funzionare e non viene mai riaperto. Una copia che ha già scaricato resta sul suo dispositivo.`
- **pt** Português: `Fechar o exemplar deste leitor? O link dele deixa de funcionar e nunca é reaberto. Um exemplar que já tenha descarregado fica no dispositivo dele.`
- **nl** Nederlands: `Het exemplaar van deze lezer sluiten? Zijn link werkt dan niet meer en wordt nooit heropend. Een exemplaar dat hij al heeft gedownload, blijft op zijn apparaat.`
- **pl** Polski: `Zamknąć egzemplarz tego czytelnika? Jego link przestanie działać i nigdy nie zostanie ponownie otwarty. Egzemplarz, który już pobrał, zostaje na jego urządzeniu.`
- **ru** Русский: `Закрыть экземпляр этого читателя? Его ссылка перестанет работать и больше никогда не откроется. Экземпляр, который он уже скачал, останется на его устройстве.`
- **tr** Türkçe: `Bu okurun kopyası kapatılsın mı? Bağlantısı çalışmayı bırakır ve bir daha asla açılmaz. Zaten indirdiği bir kopya cihazında kalır.`
- **ar** العربية: `أتريد إغلاق نسخة هذا القارئ؟ يتوقف رابطه عن العمل ولا يُعاد فتحه أبدًا. أما النسخة التي نزّلها بالفعل فتبقى على جهازه.`
- **hi** हिन्दी: `इस पाठक की प्रति बंद करें? उनका लिंक काम करना बंद कर देगा और फिर कभी नहीं खुलेगा। जो प्रति वे पहले ही डाउनलोड कर चुके हैं, वह उनके डिवाइस पर रहेगी।`
- **mr** मराठी: `या वाचकाची प्रत बंद करायची? त्यांची लिंक काम करणे थांबवेल आणि पुन्हा कधीच उघडणार नाही. त्यांनी आधीच डाउनलोड केलेली प्रत त्यांच्या डिव्हाइसवर राहील.`
- **ja** 日本語: `この読者の献本を閉じますか？リンクは使えなくなり、二度と再開されません。すでにダウンロードされた献本は読者の端末に残ります。`
- **zh-Hans** 简体中文: `要关闭这位读者的这份书吗？其链接将失效，且永远不会重新开放。读者已下载的那份会留在其设备上。`

### `arcp.mailStopped`

- **en** (source, Claude's): Asked for no more email from you
- **es** Español: `Pidió no recibir más correos tuyos`
- **fr** Français: `A demandé à ne plus recevoir vos e-mails`
- **de** Deutsch: `Möchte keine E-Mails mehr von Ihnen`
- **it** Italiano: `Ha chiesto di non ricevere più tue email`
- **pt** Português: `Pediu para não receber mais e-mails seus`
- **nl** Nederlands: `Wil geen e-mail meer van u`
- **pl** Polski: `Poprosił o brak kolejnych e-maili od autora`
- **ru** Русский: `Попросил больше не присылать ему ваши письма`
- **tr** Türkçe: `Sizden artık e-posta istemiyor`
- **ar** العربية: `طلب ألّا يتلقى منك بريدًا بعد الآن`
- **hi** हिन्दी: `आपसे और ईमेल न भेजने को कहा है`
- **mr** मराठी: `तुमच्याकडून आणखी ईमेल नको असे सांगितले आहे`
- **ja** 日本語: `あなたからのメールを今後受け取らないよう希望しています`
- **zh-Hans** 简体中文: `已要求不再收到你的邮件`

### `arcp.notSent`

- **en** (source, Claude's): Done, but the email to this reader was not sent: {detail}
- **es** Español: `Hecho, pero el correo a este lector no se envió: {detail}`
- **fr** Français: `C'est fait, mais l'e-mail à ce lecteur n'a pas été envoyé : {detail}`
- **de** Deutsch: `Erledigt, aber die E-Mail an diesen Leser wurde nicht gesendet: {detail}`
- **it** Italiano: `Fatto, ma l'email a questo lettore non è stata inviata: {detail}`
- **pt** Português: `Feito, mas o e-mail para este leitor não foi enviado: {detail}`
- **nl** Nederlands: `Gedaan, maar de e-mail aan deze lezer is niet verstuurd: {detail}`
- **pl** Polski: `Gotowe, ale e-mail do tego czytelnika nie został wysłany: {detail}`
- **ru** Русский: `Готово, но письмо этому читателю не отправлено: {detail}`
- **tr** Türkçe: `Yapıldı, ancak bu okura e-posta gönderilmedi: {detail}`
- **ar** العربية: `تمّ، لكن البريد إلى هذا القارئ لم يُرسَل: {detail}`
- **hi** हिन्दी: `हो गया, पर इस पाठक को ईमेल नहीं भेजा गया: {detail}`
- **mr** मराठी: `झाले, पण या वाचकाला ईमेल पाठवला गेला नाही: {detail}`
- **ja** 日本語: `完了しましたが、この読者へのメールは送信されませんでした：{detail}`
- **zh-Hans** 简体中文: `已完成，但给这位读者的邮件没有发出：{detail}`

### `arcp.suppressedOwner`

- **en** (source, Claude's): This reader asked for no more email from you, so no copy can be sent to them. Decline them instead.
- **es** Español: `Este lector pidió no recibir más correos tuyos, así que no se le puede enviar un ejemplar. Recházalo en su lugar.`
- **fr** Français: `Ce lecteur a demandé à ne plus recevoir vos e-mails : aucun exemplaire ne peut lui être envoyé. Refusez-le plutôt.`
- **de** Deutsch: `Dieser Leser möchte keine E-Mails mehr von Ihnen, daher kann ihm kein Exemplar geschickt werden. Lehnen Sie ihn stattdessen ab.`
- **it** Italiano: `Questo lettore ha chiesto di non ricevere più tue email, quindi non gli si può inviare una copia. Rifiutalo invece.`
- **pt** Português: `Este leitor pediu para não receber mais e-mails seus, por isso não lhe pode ser enviado um exemplar. Recuse-o em vez disso.`
- **nl** Nederlands: `Deze lezer wil geen e-mail meer van u, dus er kan geen exemplaar naar hem worden gestuurd. Wijs hem in plaats daarvan af.`
- **pl** Polski: `Ten czytelnik poprosił o brak kolejnych e-maili od autora, więc nie można wysłać mu egzemplarza. Zamiast tego odrzuć zgłoszenie.`
- **ru** Русский: `Этот читатель попросил больше не присылать ему ваши письма, поэтому отправить ему экземпляр нельзя. Вместо этого отклоните его.`
- **tr** Türkçe: `Bu okur sizden artık e-posta almak istemediğini söyledi, bu yüzden ona kopya gönderilemez. Bunun yerine onu reddedin.`
- **ar** العربية: `طلب هذا القارئ ألّا يتلقى منك بريدًا بعد الآن، لذا لا يمكن إرسال نسخة إليه. ارفضه بدلًا من ذلك.`
- **hi** हिन्दी: `इस पाठक ने आपसे और ईमेल न भेजने को कहा है, इसलिए उन्हें प्रति नहीं भेजी जा सकती। इसके बजाय उन्हें मना करें।`
- **mr** मराठी: `या वाचकाने तुमच्याकडून आणखी ईमेल नको असे सांगितले आहे, त्यामुळे त्यांना प्रत पाठवता येत नाही. त्याऐवजी त्यांना नकार द्या.`
- **ja** 日本語: `この読者はあなたからのメールを今後受け取らないよう希望しているため、献本を送れません。代わりにお断りしてください。`
- **zh-Hans** 简体中文: `这位读者已要求不再收到你的邮件，因此无法给其发送书。请改为拒绝。`

### `arcp.suppressedAll`

- **en** (source, Claude's): This reader asked Beuk for no email from any author, so no copy can be sent to them. Decline them instead.
- **es** Español: `Este lector pidió a Beuk no recibir correos de ningún autor, así que no se le puede enviar un ejemplar. Recházalo en su lugar.`
- **fr** Français: `Ce lecteur a demandé à Beuk de ne recevoir aucun e-mail d'aucun auteur : aucun exemplaire ne peut lui être envoyé. Refusez-le plutôt.`
- **de** Deutsch: `Dieser Leser hat Beuk gebeten, ihm von keinem Autor E-Mails zu schicken, daher kann ihm kein Exemplar geschickt werden. Lehnen Sie ihn stattdessen ab.`
- **it** Italiano: `Questo lettore ha chiesto a Beuk di non ricevere email da nessun autore, quindi non gli si può inviare una copia. Rifiutalo invece.`
- **pt** Português: `Este leitor pediu ao Beuk para não receber e-mails de nenhum autor, por isso não lhe pode ser enviado um exemplar. Recuse-o em vez disso.`
- **nl** Nederlands: `Deze lezer heeft Beuk gevraagd hem van geen enkele auteur e-mail te sturen, dus er kan geen exemplaar naar hem worden gestuurd. Wijs hem in plaats daarvan af.`
- **pl** Polski: `Ten czytelnik poprosił Beuk o brak e-maili od jakiegokolwiek autora, więc nie można wysłać mu egzemplarza. Zamiast tego odrzuć zgłoszenie.`
- **ru** Русский: `Этот читатель попросил Beuk не присылать ему письма ни от одного автора, поэтому отправить ему экземпляр нельзя. Вместо этого отклоните его.`
- **tr** Türkçe: `Bu okur Beuk'ten hiçbir yazardan e-posta almamayı istedi, bu yüzden ona kopya gönderilemez. Bunun yerine onu reddedin.`
- **ar** العربية: `طلب هذا القارئ من Beuk ألّا يتلقى بريدًا من أي مؤلف، لذا لا يمكن إرسال نسخة إليه. ارفضه بدلًا من ذلك.`
- **hi** हिन्दी: `इस पाठक ने Beuk से किसी भी लेखक का ईमेल न भेजने को कहा है, इसलिए उन्हें प्रति नहीं भेजी जा सकती। इसके बजाय उन्हें मना करें।`
- **mr** मराठी: `या वाचकाने Beuk ला कोणत्याही लेखकाकडून ईमेल नको असे सांगितले आहे, त्यामुळे त्यांना प्रत पाठवता येत नाही. त्याऐवजी त्यांना नकार द्या.`
- **ja** 日本語: `この読者はどの著者からもメールを受け取らないようBeukに希望しているため、献本を送れません。代わりにお断りしてください。`
- **zh-Hans** 简体中文: `这位读者已要求 Beuk 不再发送任何作者的邮件，因此无法给其发送书。请改为拒绝。`

### `arcp.closeSignups`

- **en** (source, Claude's): Close sign-ups
- **es** Español: `Cerrar inscripciones`
- **fr** Français: `Clore les inscriptions`
- **de** Deutsch: `Anmeldung schließen`
- **it** Italiano: `Chiudi le iscrizioni`
- **pt** Português: `Fechar inscrições`
- **nl** Nederlands: `Aanmelden sluiten`
- **pl** Polski: `Zamknij zapisy`
- **ru** Русский: `Закрыть запись`
- **tr** Türkçe: `Kayıtları kapat`
- **ar** العربية: `أغلق التسجيل`
- **hi** हिन्दी: `साइन अप बंद करें`
- **mr** मराठी: `नोंदणी बंद करा`
- **ja** 日本語: `申し込みを締め切る`
- **zh-Hans** 简体中文: `截止报名`

### `arcp.closeConfirm`

- **en** (source, Claude's): Close sign-ups now? No one new can join or be approved, and this cannot be undone. Copies already given keep working.
- **es** Español: `¿Cerrar las inscripciones ahora? Nadie más podrá apuntarse ni ser aprobado, y no se puede deshacer. Los ejemplares ya entregados siguen funcionando.`
- **fr** Français: `Clore les inscriptions maintenant ? Plus personne ne pourra s'inscrire ni être approuvé, et c'est définitif. Les exemplaires déjà donnés continuent de fonctionner.`
- **de** Deutsch: `Die Anmeldung jetzt schließen? Niemand kann sich dann noch anmelden oder angenommen werden, und das lässt sich nicht rückgängig machen. Bereits vergebene Exemplare funktionieren weiter.`
- **it** Italiano: `Chiudere le iscrizioni adesso? Nessun altro potrà iscriversi o essere approvato, e non si può annullare. Le copie già date continuano a funzionare.`
- **pt** Português: `Fechar as inscrições agora? Mais ninguém se poderá inscrever nem ser aprovado, e não é possível anular. Os exemplares já atribuídos continuam a funcionar.`
- **nl** Nederlands: `Het aanmelden nu sluiten? Niemand kan zich dan nog aanmelden of worden goedgekeurd, en dit kan niet ongedaan worden gemaakt. Exemplaren die al zijn gegeven, blijven werken.`
- **pl** Polski: `Zamknąć zapisy teraz? Nikt nowy nie będzie mógł się zapisać ani zostać zatwierdzony, a tego nie da się cofnąć. Wydane już egzemplarze nadal działają.`
- **ru** Русский: `Закрыть запись сейчас? Никто новый не сможет записаться или получить одобрение, и это нельзя отменить. Уже выданные экземпляры продолжат работать.`
- **tr** Türkçe: `Kayıtlar şimdi kapatılsın mı? Artık kimse kaydolamaz ya da onaylanamaz ve bu geri alınamaz. Verilmiş kopyalar çalışmaya devam eder.`
- **ar** العربية: `أتريد إغلاق التسجيل الآن؟ لن يتمكن أحد جديد من الانضمام أو نيل الموافقة، ولا يمكن التراجع عن ذلك. تبقى النسخ التي أُعطيت تعمل.`
- **hi** हिन्दी: `अभी साइन अप बंद करें? फिर कोई नया पाठक न जुड़ सकेगा, न उसे मंज़ूरी मिल सकेगी, और इसे पलटा नहीं जा सकता। जो प्रतियाँ दी जा चुकी हैं, वे काम करती रहेंगी।`
- **mr** मराठी: `आता नोंदणी बंद करायची? मग कोणीही नवीन वाचक सहभागी होऊ शकणार नाही किंवा त्याला मंजुरी मिळणार नाही, आणि हे उलटवता येत नाही. आधी दिलेल्या प्रती काम करत राहतील.`
- **ja** 日本語: `今すぐ申し込みを締め切りますか？新しい読者の申し込みや承認はできなくなり、取り消せません。すでに渡した献本は引き続き使えます。`
- **zh-Hans** 简体中文: `现在截止报名吗？之后没有新读者能报名或获得批准，而且无法撤销。已经送出的书仍可使用。`

### `arcp.delete`

- **en** (source, Claude's): Delete this ARC
- **es** Español: `Eliminar este ARC`
- **fr** Français: `Supprimer cet ARC`
- **de** Deutsch: `Dieses ARC löschen`
- **it** Italiano: `Elimina questo ARC`
- **pt** Português: `Eliminar este ARC`
- **nl** Nederlands: `Deze ARC verwijderen`
- **pl** Polski: `Usuń ten ARC`
- **ru** Русский: `Удалить этот ARC`
- **tr** Türkçe: `Bu ARC'yi sil`
- **ar** العربية: `احذف حملة ARC هذه`
- **hi** हिन्दी: `यह ARC हटाएँ`
- **mr** मराठी: `हे ARC हटवा`
- **ja** 日本語: `このARCを削除`
- **zh-Hans** 简体中文: `删除这个 ARC`

### `arcp.deleteConfirm`

- **en** (source, fixed by the plan/spec): Delete this ARC? Its readers' links stop working, and their names and email addresses are removed from Beuk. Copies already inside backups stay until those backups are deleted.
- **es** Español: `¿Eliminar este ARC? Los enlaces de sus lectores dejan de funcionar, y sus nombres y direcciones de correo se borran de Beuk. Lo que ya esté en copias de seguridad se queda hasta que esas copias se eliminen.`
- **fr** Français: `Supprimer cet ARC ? Les liens de ses lecteurs cessent de fonctionner, et leurs noms et adresses e-mail sont effacés de Beuk. Ce qui se trouve déjà dans des sauvegardes y reste jusqu'à la suppression de ces sauvegardes.`
- **de** Deutsch: `Dieses ARC löschen? Die Links seiner Leser funktionieren nicht mehr, und ihre Namen und E-Mail-Adressen werden aus Beuk entfernt. Was bereits in Sicherungen liegt, bleibt dort, bis diese Sicherungen gelöscht werden.`
- **it** Italiano: `Eliminare questo ARC? I link dei suoi lettori smettono di funzionare, e i loro nomi e indirizzi email vengono rimossi da Beuk. Ciò che è già nei backup resta lì finché quei backup non vengono eliminati.`
- **pt** Português: `Eliminar este ARC? Os links dos seus leitores deixam de funcionar, e os nomes e endereços de e-mail deles são removidos do Beuk. O que já estiver em cópias de segurança fica lá até essas cópias de segurança serem eliminadas.`
- **nl** Nederlands: `Deze ARC verwijderen? De links van de lezers werken niet meer, en hun namen en e-mailadressen worden uit Beuk verwijderd. Wat al in back-ups staat, blijft daar tot die back-ups worden verwijderd.`
- **pl** Polski: `Usunąć ten ARC? Linki jego czytelników przestaną działać, a ich imiona i adresy e-mail zostaną usunięte z Beuk. To, co jest już w kopiach zapasowych, pozostaje tam do czasu usunięcia tych kopii.`
- **ru** Русский: `Удалить этот ARC? Ссылки его читателей перестанут работать, а их имена и адреса почты будут удалены из Beuk. То, что уже есть в резервных копиях, останется там, пока эти резервные копии не удалят.`
- **tr** Türkçe: `Bu ARC silinsin mi? Okurlarının bağlantıları çalışmayı bırakır, adları ve e-posta adresleri Beuk'ten kaldırılır. Yedeklerde zaten bulunanlar, o yedekler silinene kadar orada kalır.`
- **ar** العربية: `أتريد حذف حملة ARC هذه؟ تتوقف روابط قرّائها عن العمل، وتُزال أسماؤهم وعناوين بريدهم من Beuk. وما هو موجود بالفعل في النسخ الاحتياطية يبقى فيها حتى تُحذف تلك النسخ.`
- **hi** हिन्दी: `यह ARC हटाएँ? इसके पाठकों के लिंक काम करना बंद कर देंगे, और उनके नाम और ईमेल पते Beuk से हटा दिए जाएँगे। जो पहले से बैकअप में है, वह तब तक रहेगा जब तक वे बैकअप हटाए न जाएँ।`
- **mr** मराठी: `हे ARC हटवायचे? त्याच्या वाचकांच्या लिंक काम करणे थांबवतील, आणि त्यांची नावे व ईमेल पत्ते Beuk मधून काढले जातील. जे आधीच बॅकअपमध्ये आहे, ते ते बॅकअप हटवले जाईपर्यंत तिथे राहील.`
- **ja** 日本語: `このARCを削除しますか？読者のリンクは使えなくなり、読者の名前とメールアドレスはBeukから削除されます。すでにバックアップに含まれているものは、そのバックアップが削除されるまで残ります。`
- **zh-Hans** 简体中文: `删除这个 ARC 吗？其读者的链接将失效，他们的姓名和邮箱地址会从 Beuk 中删除。已经在备份中的内容会保留，直到那些备份被删除。`

### `arcp.deleteYes`

- **en** (source, Claude's): Delete
- **es** Español: `Eliminar`
- **fr** Français: `Supprimer`
- **de** Deutsch: `Löschen`
- **it** Italiano: `Elimina`
- **pt** Português: `Eliminar`
- **nl** Nederlands: `Verwijderen`
- **pl** Polski: `Usuń`
- **ru** Русский: `Удалить`
- **tr** Türkçe: `Sil`
- **ar** العربية: `احذف`
- **hi** हिन्दी: `हटाएँ`
- **mr** मराठी: `हटवा`
- **ja** 日本語: `削除`
- **zh-Hans** 简体中文: `删除`

### `arcp.cancel`

- **en** (source, Claude's): Cancel
- **es** Español: `Cancelar`
- **fr** Français: `Annuler`
- **de** Deutsch: `Abbrechen`
- **it** Italiano: `Annulla`
- **pt** Português: `Cancelar`
- **nl** Nederlands: `Annuleren`
- **pl** Polski: `Anuluj`
- **ru** Русский: `Отмена`
- **tr** Türkçe: `İptal`
- **ar** العربية: `إلغاء`
- **hi** हिन्दी: `रद्द करें`
- **mr** मराठी: `रद्द करा`
- **ja** 日本語: `キャンセル`
- **zh-Hans** 简体中文: `取消`

### `arcp.close`

- **en** (source, Claude's): Close
- **es** Español: `Cerrar`
- **fr** Français: `Fermer`
- **de** Deutsch: `Schließen`
- **it** Italiano: `Chiudi`
- **pt** Português: `Fechar`
- **nl** Nederlands: `Sluiten`
- **pl** Polski: `Zamknij`
- **ru** Русский: `Закрыть`
- **tr** Türkçe: `Kapat`
- **ar** العربية: `إغلاق`
- **hi** हिन्दी: `बंद करें`
- **mr** मराठी: `बंद करा`
- **ja** 日本語: `閉じる`
- **zh-Hans** 简体中文: `关闭`

### `arcp.endedSum`

- **en** (source, Claude's): Your last ARC for this book ended on {date}. Claimed: {n} of {max}. Copies already given keep working.
- **es** Español: `Tu último ARC de este libro terminó el {date}. Reclamados: {n} de {max}. Los ejemplares ya entregados siguen funcionando.`
- **fr** Français: `Votre dernier ARC pour ce livre s'est terminé le {date}. Réclamés : {n} sur {max}. Les exemplaires déjà donnés continuent de fonctionner.`
- **de** Deutsch: `Ihr letztes ARC für dieses Buch endete am {date}. Vergeben: {n} von {max}. Bereits vergebene Exemplare funktionieren weiter.`
- **it** Italiano: `Il tuo ultimo ARC per questo libro è terminato il {date}. Assegnate: {n} su {max}. Le copie già date continuano a funzionare.`
- **pt** Português: `O seu último ARC deste livro terminou a {date}. Atribuídos: {n} de {max}. Os exemplares já atribuídos continuam a funcionar.`
- **nl** Nederlands: `Uw laatste ARC voor dit boek eindigde op {date}. Geclaimd: {n} van {max}. Exemplaren die al zijn gegeven, blijven werken.`
- **pl** Polski: `Ostatni ARC tej książki zakończył się: {date}. Odebrane: {n} z {max}. Wydane już egzemplarze nadal działają.`
- **ru** Русский: `Ваш последний ARC для этой книги закончился: {date}. Получено: {n} из {max}. Уже выданные экземпляры продолжат работать.`
- **tr** Türkçe: `Bu kitap için son ARC'niz sona erdi: {date}. Alınan: {n} / {max}. Verilmiş kopyalar çalışmaya devam eder.`
- **ar** العربية: `انتهت آخر حملة ARC لهذا الكتاب في {date}. النسخ المأخوذة: {n} من {max}. تبقى النسخ التي أُعطيت تعمل.`
- **hi** हिन्दी: `इस किताब का आपका पिछला ARC {date} को खत्म हुआ। ली गई प्रतियाँ: {max} में से {n}। जो प्रतियाँ दी जा चुकी हैं, वे काम करती रहेंगी।`
- **mr** मराठी: `या पुस्तकाचे तुमचे मागचे ARC {date} रोजी संपले. घेतलेल्या प्रती: {max} पैकी {n}. आधी दिलेल्या प्रती काम करत राहतील.`
- **ja** 日本語: `この本の前回のARCは{date}に終了しました。受け取り済み：{n} / {max}。すでに渡した献本は引き続き使えます。`
- **zh-Hans** 简体中文: `这本书上一次的 ARC 已于 {date} 结束。已领取：{n} / {max}。已经送出的书仍可使用。`

### `arcp.endedWaiting`

- **en** (source, Claude's): These readers were still waiting when it ended. Decline them to let them know.
- **es** Español: `Estos lectores seguían esperando cuando terminó. Recházalos para que lo sepan.`
- **fr** Français: `Ces lecteurs attendaient encore quand il s'est terminé. Refusez-les pour qu'ils soient prévenus.`
- **de** Deutsch: `Diese Leser warteten noch, als es endete. Lehnen Sie sie ab, damit sie Bescheid wissen.`
- **it** Italiano: `Questi lettori erano ancora in attesa quando è terminato. Rifiutali perché lo sappiano.`
- **pt** Português: `Estes leitores ainda estavam à espera quando terminou. Recuse-os para que fiquem a saber.`
- **nl** Nederlands: `Deze lezers wachtten nog toen hij eindigde. Wijs ze af, zodat ze het weten.`
- **pl** Polski: `Ci czytelnicy wciąż czekali, gdy się zakończył. Odrzuć ich zgłoszenia, aby się o tym dowiedzieli.`
- **ru** Русский: `Эти читатели ещё ждали, когда он закончился. Отклоните их, чтобы они узнали об этом.`
- **tr** Türkçe: `Bu okurlar, ARC sona erdiğinde hâlâ bekliyordu. Haberleri olsun diye onları reddedin.`
- **ar** العربية: `كان هؤلاء القرّاء لا يزالون بالانتظار عندما انتهت. ارفضهم ليعلموا بذلك.`
- **hi** हिन्दी: `ये पाठक खत्म होने के समय भी इंतज़ार में थे। उन्हें मना करें, ताकि उन्हें पता चल जाए।`
- **mr** मराठी: `हे वाचक ARC संपले तेव्हाही वाट पाहत होते. त्यांना कळावे म्हणून त्यांना नकार द्या.`
- **ja** 日本語: `これらの読者は、終了時にまだ承認を待っていました。お断りすると、読者に知らせが届きます。`
- **zh-Hans** 简体中文: `结束时这些读者仍在等待。拒绝他们，好让他们知道结果。`

### `arcp.newH`

- **en** (source, Claude's): Start a new ARC
- **es** Español: `Iniciar un ARC nuevo`
- **fr** Français: `Lancer un nouvel ARC`
- **de** Deutsch: `Ein neues ARC starten`
- **it** Italiano: `Avvia un nuovo ARC`
- **pt** Português: `Iniciar um novo ARC`
- **nl** Nederlands: `Een nieuwe ARC starten`
- **pl** Polski: `Rozpocznij nowy ARC`
- **ru** Русский: `Начать новый ARC`
- **tr** Türkçe: `Yeni bir ARC başlat`
- **ar** العربية: `ابدأ حملة ARC جديدة`
- **hi** हिन्दी: `नया ARC शुरू करें`
- **mr** मराठी: `नवीन ARC सुरू करा`
- **ja** 日本語: `新しいARCを始める`
- **zh-Hans** 简体中文: `开始新的 ARC`

## 9. ARC reader pages and reader emails (90 keys, 2026-11-27; 4 of them added by the final fix wave)

What a reader of an ARC campaign sees (slice 1, `src/arc/strings.ts`): the claim page, the code page, the waiting page,
the copy page, the Not me / Stop pages, the calm error pages and their footer, and every reader email (the code, the
copy, waiting, approved, declined, and the footer each one carries). The page and the email take the book's language
(`arcLang(snapshot.language)`); a book language with no interface pack reads in English. The tables are in
`src/arc/strings.ts` (`ES` … `ZH`), in English key order.

**English.** Fixed word for word by the plan and the spec: `arc.mail.review`, `arc.mail.stampNote`, `arc.claim.title`,
`.lede`, `.review` (ruling F15), `.submit`, `.stampNote`, `.profile`, `arc.copy.title`, `.for`, `.download`, `.read`,
`.keep`, `arc.theAuthor`; V's: `arc.notMe.body` and `arc.stop.body`. Every other English string is Claude's (Tasks 2, 6
and 7) and is V's to confirm in the PR. **All 14 other languages below are drafts written by Claude by hand:
not approved, not read by a native speaker.** No translation service or API was called.

**Final fix wave (2026-11-27), new or changed drafts in this section:** `arc.mail.code.link` (the code page's link in
the code email, ruling C6), `arc.mail.code.for` (the name the code confirms, final review Important 1),
`arc.page.closedRecover` (the lost-link form on the closed page, final review minor 1), `arc.stop.doneCopy` (new), and
`arc.stop.done` (changed: its second sentence, "Your copy keeps working.", is now `arc.stop.doneCopy`, shown only to a
reader whose copy still opens, ruling C7; each draft was split at the same sentence). All are Claude's English and
Claude's drafts, unsigned like the rest.

**Not translated, on purpose (6 keys, English in every language):**

- `arc.stamp` and `arc.stampPage.title`: the stamp line inside readers' EPUBs and the title of the page it adds (ruling
  F16: an unsigned translation inside a reader's EPUB cannot be recalled from a device). `arcp.stamp` (§8) is the
  panel's line, not this one.
- `arc.mail.goneTitle` and `arc.mail.gone`: the page for a used or unknown mail link knows no reader language (a used
  Not me link names nobody any more), so it is English (`renderMailGonePage`).
- `arc.page.badFormTitle` and `arc.page.badForm` (final fix wave, ruling C7): the page for a form body the server
  refuses to read (too long, too many fields). The body is refused before the route reads its link, so no book and no
  reader language is known (`renderBadFormPage`).

How the drafts were made (`tests/arc-strings.test.ts` checks every mechanical rule):

- Every English key less the four above, none empty, none still the English (except `arc.foot.privacy` in **it** and
  **nl**, "Privacy", as the studio's own `legal.privacy`); `{placeholders}` byte for byte, the same set and count.
  English has no `…Plural` keys, so no draft needs a plural twin.
- Amazon rule (plan Global Constraints): no draft says "in exchange for a review" or treats a review as owed. The test
  holds one pattern per language (that language's "in exchange / in return", "owe" and "must / have to", with
  Unicode word edges; ja, zh-Hans and ar as substrings) and requires each review line to carry its "if you'd like"
  (es *Si quieres*, fr *Si vous souhaitez*, de *Wenn Sie*, it *Se … vuoi*, pt *Se quiser*, nl *Als u*, pl *Jeśli*, ru
  *Если*, tr *isterseniz*, ar *إن رغبت*, hi *अगर आप*, mr *…असेल, तर*, ja *…思ったら*, zh-Hans *如果你*). The patterns are
  Claude's, not a translator's.
- Address form as each studio pack: *tú* (es, it), *vous* (fr), *Sie* (de), the third person (pt, European as the
  pack), *u* (nl), *Ty* (pl, as the pack's *Twój*), *вы* (ru), *siz* (tr), the second person (ar), *आप* (hi), *तुम्ही*
  (mr, no nukta), polite form with no pronoun (ja), *你* (zh-Hans). Footer words are the studio's `legal.privacy` /
  `legal.terms` in each language.
- Book copy words as the §8 panel: es *ejemplar anticipado*, fr *exemplaire en avant-première*, de *Vorab-Exemplar*, it
  *copia in anteprima*, pt *exemplar antecipado*, nl *voorpublicatie-exemplaar*, pl *egzemplarz przedpremierowy*, ru
  *сигнальный экземпляр*, tr *ön okuma kopyası*, ar *نسخة مسبقة*, hi *रिलीज़ से पहले की प्रति*, mr *प्रकाशनापूर्वीची प्रत*,
  ja *献本*, zh-Hans *预发本*.

Points worth a look:

- **`{author}` is a name, or `arc.theAuthor` when the book names none**, so each draft keeps it where any name reads
  and the fallback is chosen to fit every sentence it lands in:
  **de** always in the dative (after *von* / *bei*; the test checks it), fallback *dem Autor*; **es** *su autor*;
  **it** *chi l'ha scritto* and **pt** *quem o escreveu* (no preposition contracts with them, as *dell'autore* / *do
  autor* would need); **fr** *l'auteur*, and *par {author}* where French allows it, since *de* does not elide before a
  vowel-initial name; **pl** and **ru** keep `{author}` in the nominative and never give it a past-tense verb (those
  agree with a gender): labels such as *Nadawca: {author}*, *{author}: ваша заявка одобрена*, *(автор: {author})*, and
  present or future verbs (pl *{author} zgadza się na Twoją prośbę* for "approved"); **ar**, **hi** and **mr** use
  passive or ergative forms so no verb carries the author's gender (hi *{author} की ओर से … दी जा रही हैं*, mr
  *{author} यांनी … मंजूर केली*, ar *تمت موافقة {author}*); **tr** puts no suffix on any placeholder (*{author}
  tarafından*, *{title} için*; the test checks it). As in English, a sentence that starts with the fallback starts in
  lower case (*the author looks at each request* → es *su autor revisa…*).
- **pl** and **ru** past tenses of the *reader* are gendered too, so buttons say "This is not my request" (*To nie moja
  prośba*, *Это не моя заявка*) for "I didn't ask for a copy", and pl uses impersonal forms (*złożono prośbę*).
- **Titles** are quoted where the grammar needs it (a title cannot decline): pl „{title}”, ru «{title}» (with *книги*),
  ja 『{title}』, zh-Hans 《{title}》. Other languages leave `{title}` bare, as English does.
- **`{minutes}`** (30 today): pl and ru write *{minutes} min.* / *{minutes} мин.*, which reads with any number; **ar**
  *{minutes} دقيقة* is right for 11–99 (it would need *دقائق* for 3–10); every other draft reads for any n ≠ 1.
- **Marathi date**: `launchDateText` now formats Marathi with Western digits (*14 फेब्रुवारी, 2027*), as the Marathi
  pack writes every number; Intl's `mr` default is Devanagari digits. Other languages are unchanged.
- **The reader emails go to third parties, so each draft says no more than English**: Not me deletes the name and
  email from this book, closes this copy, and stops mail from any author on Beuk; the backups line says they can
  remain in older backups and that the block is kept in backups too; Stop covers only that author's books and the
  copy keeps working (said only to a reader whose copy still opens, `arc.stop.doneCopy`: ruling C7, final fix wave; the
  14 drafts of `arc.stop.done` were split with the English in the same commit). `arc.stop.body` is V's verbatim line
  and still says "Your copy keeps working." on the button page, for every reader: V's to change, not changed here.
- **`arc.mail.code.for`** keeps `{name}` where any name reads: **pl** *dla osoby: {name}* and **ru** *выдан на имя:
  {name}* keep it in the nominative; **ja** adds さん; **tr** puts no suffix on it (*şu kişi için: {name}*).
- **ja** adds さん after the reader's own name (`arc.wait.lead`, `arc.copy.for`); `arc.mail.notMe` reads "if you have
  no idea about this" (心当たりがない場合), the usual Japanese for "Not you?".
- **zh-Hans** avoids 必须 ("must") everywhere, so the review line ends 这从来都不是硬性要求 ("it is never a requirement").
- **hi** `arc.mail.notMe` / `arc.notMe.title` ask "You didn't ask for it?" (आपने नहीं माँगी थी?), since "it wasn't you"
  (आप नहीं थे / थीं) would need the reader's gender.

### `arc.mail.review`

- **en** (source, fixed by the plan/spec): If you'd like to review it after reading, you're welcome to. It's never required.
- **es** Español: `Si quieres reseñarlo después de leerlo, puedes hacerlo. Nunca es obligatorio.`
- **fr** Français: `Si vous souhaitez donner votre avis sur ce livre après l'avoir lu, libre à vous. Ce n'est jamais obligatoire.`
- **de** Deutsch: `Wenn Sie es nach dem Lesen rezensieren möchten, sind Sie herzlich dazu eingeladen. Pflicht ist das nie.`
- **it** Italiano: `Se dopo averlo letto vuoi recensirlo, fallo pure. Non è mai obbligatorio.`
- **pt** Português: `Se quiser fazer uma crítica depois de o ler, esteja à vontade. Nunca é obrigatório.`
- **nl** Nederlands: `Als u het na het lezen wilt recenseren, mag dat graag. Het is nooit verplicht.`
- **pl** Polski: `Jeśli po lekturze zechcesz napisać recenzję, śmiało. Nigdy nie jest to obowiązkowe.`
- **ru** Русский: `Если после прочтения захотите написать отзыв — пожалуйста. Это никогда не обязательно.`
- **tr** Türkçe: `Okuduktan sonra yorum yazmak isterseniz yazabilirsiniz. Bu hiçbir zaman zorunlu değildir.`
- **ar** العربية: `إن رغبت في مراجعته بعد قراءته، فأهلًا بذلك. وليس ذلك مطلوبًا أبدًا.`
- **hi** हिन्दी: `अगर आप पढ़ने के बाद इसका रिव्यू लिखना चाहें, तो आपका स्वागत है। यह कभी ज़रूरी नहीं है।`
- **mr** मराठी: `वाचून झाल्यावर तुम्हाला परीक्षण लिहायचे असेल, तर तुमचे स्वागत आहे. ते कधीही आवश्यक नाही.`
- **ja** 日本語: `読み終えたあとでレビューを書きたいと思ったら、どうぞご自由に。書く必要はまったくありません。`
- **zh-Hans** 简体中文: `如果你读完后想写书评，非常欢迎。这从来都不是硬性要求。`

### `arc.mail.stampNote`

- **en** (source, fixed by the plan/spec): Your copy shows your name and email on its copyright page.
- **es** Español: `Tu ejemplar muestra tu nombre y tu correo en la página de derechos de autor.`
- **fr** Français: `Votre exemplaire porte votre nom et votre adresse e-mail sur sa page de copyright.`
- **de** Deutsch: `Ihr Exemplar zeigt Ihren Namen und Ihre E-Mail-Adresse auf der Copyright-Seite.`
- **it** Italiano: `La tua copia mostra il tuo nome e la tua email nella pagina del copyright.`
- **pt** Português: `O seu exemplar mostra o seu nome e o seu e-mail na página de direitos de autor.`
- **nl** Nederlands: `Uw exemplaar toont uw naam en e-mailadres op de copyrightpagina.`
- **pl** Polski: `Twój egzemplarz pokazuje Twoje imię i adres e-mail na stronie z prawami autorskimi.`
- **ru** Русский: `В вашем экземпляре на странице с авторскими правами указаны ваше имя и адрес почты.`
- **tr** Türkçe: `Kopyanızın telif hakkı sayfasında adınız ve e-posta adresiniz yer alır.`
- **ar** العربية: `تُظهر نسختك اسمك وبريدك الإلكتروني في صفحة حقوق النشر.`
- **hi** हिन्दी: `आपकी प्रति के कॉपीराइट पेज पर आपका नाम और ईमेल दिखता है।`
- **mr** मराठी: `तुमच्या प्रतीच्या कॉपीराइट पानावर तुमचे नाव आणि ईमेल दिसते.`
- **ja** 日本語: `献本の著作権ページには、お名前とメールアドレスが入っています。`
- **zh-Hans** 简体中文: `你的这一份在版权页上印有你的姓名和邮箱。`

### `arc.mail.why`

- **en** (source, Claude's): You got this email because someone asked for an advance copy of {title} with this address.
- **es** Español: `Recibes este correo porque alguien pidió un ejemplar anticipado de {title} con esta dirección.`
- **fr** Français: `Vous recevez cet e-mail parce que quelqu'un a demandé un exemplaire en avant-première de {title} avec cette adresse.`
- **de** Deutsch: `Sie erhalten diese E-Mail, weil jemand mit dieser Adresse ein Vorab-Exemplar von {title} angefragt hat.`
- **it** Italiano: `Ricevi questa email perché qualcuno ha chiesto una copia in anteprima di {title} con questo indirizzo.`
- **pt** Português: `Recebeu este e-mail porque alguém pediu um exemplar antecipado de {title} com este endereço.`
- **nl** Nederlands: `U krijgt deze e-mail omdat iemand met dit adres een voorpublicatie-exemplaar van {title} heeft aangevraagd.`
- **pl** Polski: `Dostajesz ten e-mail, bo ktoś poprosił z tego adresu o egzemplarz przedpremierowy „{title}”.`
- **ru** Русский: `Вы получили это письмо, потому что кто-то запросил сигнальный экземпляр книги «{title}» на этот адрес.`
- **tr** Türkçe: `Bu e-postayı, biri bu adresle {title} için ön okuma kopyası istediği için aldınız.`
- **ar** العربية: `وصلتك هذه الرسالة لأن أحدهم طلب نسخة مسبقة من {title} بهذا العنوان.`
- **hi** हिन्दी: `आपको यह ईमेल इसलिए मिला, क्योंकि किसी ने इस पते से {title} की रिलीज़ से पहले की प्रति माँगी थी।`
- **mr** मराठी: `कोणीतरी या पत्त्यावरून {title} ची प्रकाशनापूर्वीची प्रत मागितली, म्हणून तुम्हाला हा ईमेल आला आहे.`
- **ja** 日本語: `このメールは、どなたかがこのアドレスで『{title}』の献本を申し込んだため、お送りしています。`
- **zh-Hans** 简体中文: `你收到这封邮件，是因为有人用这个地址申请了《{title}》的预发本。`

### `arc.mail.who`

- **en** (source, Claude's): Sent by {author}, through Beuk.
- **es** Español: `Enviado por {author}, a través de Beuk.`
- **fr** Français: `Envoyé par {author}, via Beuk.`
- **de** Deutsch: `Gesendet von {author}, über Beuk.`
- **it** Italiano: `Inviata da {author}, tramite Beuk.`
- **pt** Português: `Enviado por {author}, através do Beuk.`
- **nl** Nederlands: `Verzonden door {author}, via Beuk.`
- **pl** Polski: `Nadawca: {author}, przez Beuk.`
- **ru** Русский: `Отправитель: {author}, через Beuk.`
- **tr** Türkçe: `Gönderen: {author}, Beuk aracılığıyla.`
- **ar** العربية: `المُرسِل: {author}، عبر Beuk.`
- **hi** हिन्दी: `{author} की ओर से, Beuk के ज़रिए भेजा गया।`
- **mr** मराठी: `{author} यांच्याकडून, Beuk मार्फत पाठवलेला.`
- **ja** 日本語: `送信者：{author}（Beuk経由）`
- **zh-Hans** 简体中文: `发件人：{author}，经由 Beuk 发送。`

### `arc.mail.notMe`

- **en** (source, Claude's): Not you? {url}
- **es** Español: `¿No eres tú? {url}`
- **fr** Français: `Ce n'est pas vous ? {url}`
- **de** Deutsch: `Nicht Sie? {url}`
- **it** Italiano: `Non sei tu? {url}`
- **pt** Português: `Não foi você? {url}`
- **nl** Nederlands: `Bent u dit niet? {url}`
- **pl** Polski: `To nie Ty? {url}`
- **ru** Русский: `Это не вы? {url}`
- **tr** Türkçe: `Siz değil misiniz? {url}`
- **ar** العربية: `لست أنت؟ {url}`
- **hi** हिन्दी: `आपने नहीं माँगी थी? {url}`
- **mr** मराठी: `तुम्ही मागितली नव्हती? {url}`
- **ja** 日本語: `心当たりがない場合：{url}`
- **zh-Hans** 简体中文: `不是你本人？{url}`

### `arc.mail.stop`

- **en** (source, Claude's): No more email from {author}: {url}
- **es** Español: `No recibir más correos de {author}: {url}`
- **fr** Français: `Plus aucun e-mail envoyé par {author} : {url}`
- **de** Deutsch: `Keine E-Mails mehr von {author}: {url}`
- **it** Italiano: `Niente più email da {author}: {url}`
- **pt** Português: `Não receber mais e-mails de {author}: {url}`
- **nl** Nederlands: `Geen e-mail meer van {author}: {url}`
- **pl** Polski: `{author} — bez kolejnych e-maili: {url}`
- **ru** Русский: `Отписаться от писем ({author}): {url}`
- **tr** Türkçe: `E-postaları durdur ({author}): {url}`
- **ar** العربية: `إيقاف رسائل {author}: {url}`
- **hi** हिन्दी: `{author} की ओर से अब कोई ईमेल नहीं: {url}`
- **mr** मराठी: `{author} यांच्याकडून आणखी ईमेल नको: {url}`
- **ja** 日本語: `{author}からのメールを停止：{url}`
- **zh-Hans** 简体中文: `不再接收 {author} 的邮件：{url}`

### `arc.mail.copyLink`

- **en** (source, Claude's): Your copy: {url}
- **es** Español: `Tu ejemplar: {url}`
- **fr** Français: `Votre exemplaire : {url}`
- **de** Deutsch: `Ihr Exemplar: {url}`
- **it** Italiano: `La tua copia: {url}`
- **pt** Português: `O seu exemplar: {url}`
- **nl** Nederlands: `Uw exemplaar: {url}`
- **pl** Polski: `Twój egzemplarz: {url}`
- **ru** Русский: `Ваш экземпляр: {url}`
- **tr** Türkçe: `Kopyanız: {url}`
- **ar** العربية: `نسختك: {url}`
- **hi** हिन्दी: `आपकी प्रति: {url}`
- **mr** मराठी: `तुमची प्रत: {url}`
- **ja** 日本語: `献本はこちら：{url}`
- **zh-Hans** 简体中文: `你的预发本：{url}`

### `arc.theAuthor`

- **en** (source, fixed by the plan/spec): the author
- **es** Español: `su autor`
- **fr** Français: `l'auteur`
- **de** Deutsch: `dem Autor`
- **it** Italiano: `chi l'ha scritto`
- **pt** Português: `quem o escreveu`
- **nl** Nederlands: `de auteur`
- **pl** Polski: `autor`
- **ru** Русский: `автор`
- **tr** Türkçe: `yazar`
- **ar** العربية: `المؤلف`
- **hi** हिन्दी: `लेखक`
- **mr** मराठी: `लेखक`
- **ja** 日本語: `著者`
- **zh-Hans** 简体中文: `作者`

### `arc.mail.code.subject`

- **en** (source, Claude's): Your code for {title}
- **es** Español: `Tu código para {title}`
- **fr** Français: `Votre code pour {title}`
- **de** Deutsch: `Ihr Code für {title}`
- **it** Italiano: `Il tuo codice per {title}`
- **pt** Português: `O seu código para {title}`
- **nl** Nederlands: `Uw code voor {title}`
- **pl** Polski: `Twój kod do „{title}”`
- **ru** Русский: `Ваш код для «{title}»`
- **tr** Türkçe: `{title} için kodunuz`
- **ar** العربية: `رمزك لكتاب {title}`
- **hi** हिन्दी: `{title} के लिए आपका कोड`
- **mr** मराठी: `{title} साठी तुमचा कोड`
- **ja** 日本語: `『{title}』の確認コード`
- **zh-Hans** 简体中文: `《{title}》的验证码`

### `arc.mail.code.lead`

- **en** (source, Claude's): Your code is {code}.
- **es** Español: `Tu código es {code}.`
- **fr** Français: `Votre code est {code}.`
- **de** Deutsch: `Ihr Code lautet {code}.`
- **it** Italiano: `Il tuo codice è {code}.`
- **pt** Português: `O seu código é {code}.`
- **nl** Nederlands: `Uw code is {code}.`
- **pl** Polski: `Twój kod to {code}.`
- **ru** Русский: `Ваш код: {code}.`
- **tr** Türkçe: `Kodunuz: {code}.`
- **ar** العربية: `رمزك هو {code}.`
- **hi** हिन्दी: `आपका कोड {code} है।`
- **mr** मराठी: `तुमचा कोड {code} आहे.`
- **ja** 日本語: `確認コードは {code} です。`
- **zh-Hans** 简体中文: `你的验证码是 {code}。`

### `arc.mail.code.body`

- **en** (source, Claude's): Enter it on the page where you asked for an advance copy of {title} from {author}.
- **es** Español: `Escríbelo en la página donde pediste a {author} un ejemplar anticipado de {title}.`
- **fr** Français: `Saisissez-le sur la page où vous avez demandé un exemplaire en avant-première de {title}, offert par {author}.`
- **de** Deutsch: `Geben Sie ihn auf der Seite ein, auf der Sie bei {author} ein Vorab-Exemplar von {title} angefragt haben.`
- **it** Italiano: `Inseriscilo nella pagina in cui hai chiesto a {author} una copia in anteprima di {title}.`
- **pt** Português: `Introduza-o na página onde pediu a {author} um exemplar antecipado de {title}.`
- **nl** Nederlands: `Vul hem in op de pagina waar u {author} om een voorpublicatie-exemplaar van {title} vroeg.`
- **pl** Polski: `Wpisz go na stronie, na której złożono prośbę o egzemplarz przedpremierowy „{title}”, który rozdaje {author}.`
- **ru** Русский: `Введите его на странице, где вы запрашивали сигнальный экземпляр книги «{title}» (автор: {author}).`
- **tr** Türkçe: `Kodu, {author} tarafından sunulan {title} ön okuma kopyasını istediğiniz sayfaya girin.`
- **ar** العربية: `أدخِله في الصفحة التي طلبت فيها نسخة مسبقة من {title} من {author}.`
- **hi** हिन्दी: `इसे उस पेज पर डालें, जहाँ आपने {author} की {title} की रिलीज़ से पहले की प्रति माँगी थी।`
- **mr** मराठी: `जिथे तुम्ही {author} यांच्याकडे {title} ची प्रकाशनापूर्वीची प्रत मागितली, त्या पानावर तो टाका.`
- **ja** 日本語: `{author}の『{title}』の献本を申し込んだページで、このコードを入力してください。`
- **zh-Hans** 简体中文: `请在你向 {author} 申请《{title}》预发本的页面上输入它。`

### `arc.mail.code.link`

- **en** (source, Claude's — final fix wave): Or enter it on this page: {url}
- **es** Español: `O escríbelo en esta página: {url}`
- **fr** Français: `Ou saisissez-le sur cette page : {url}`
- **de** Deutsch: `Oder geben Sie ihn auf dieser Seite ein: {url}`
- **it** Italiano: `Oppure inseriscilo in questa pagina: {url}`
- **pt** Português: `Ou introduza-o nesta página: {url}`
- **nl** Nederlands: `Of vul hem in op deze pagina: {url}`
- **pl** Polski: `Albo wpisz go na tej stronie: {url}`
- **ru** Русский: `Или введите его на этой странице: {url}`
- **tr** Türkçe: `Ya da kodu bu sayfaya girin: {url}`
- **ar** العربية: `أو أدخِله في هذه الصفحة: {url}`
- **hi** हिन्दी: `या इसे इस पेज पर डालें: {url}`
- **mr** मराठी: `किंवा तो या पानावर टाका: {url}`
- **ja** 日本語: `このページで入力することもできます：{url}`
- **zh-Hans** 简体中文: `也可以在这个页面上输入：{url}`

### `arc.mail.code.for`

- **en** (source, Claude's — final fix wave): This code is for {name}. If that isn't you, don't enter it: ask for a new code with your own name instead.
- **es** Español: `Este código es para {name}. Si no eres tú, no lo escribas: pide un código nuevo con tu propio nombre.`
- **fr** Français: `Ce code est pour {name}. Si ce n'est pas vous, ne le saisissez pas : demandez plutôt un nouveau code à votre nom.`
- **de** Deutsch: `Dieser Code gilt für {name}. Wenn Sie das nicht sind, geben Sie ihn nicht ein: Fordern Sie stattdessen einen neuen Code mit Ihrem eigenen Namen an.`
- **it** Italiano: `Questo codice è per {name}. Se non sei tu, non inserirlo: chiedi invece un nuovo codice con il tuo nome.`
- **pt** Português: `Este código é para {name}. Se não for o seu nome, não o introduza: peça antes um novo código com o seu próprio nome.`
- **nl** Nederlands: `Deze code is voor {name}. Bent u dat niet, vul hem dan niet in, maar vraag een nieuwe code aan met uw eigen naam.`
- **pl** Polski: `Ten kod jest dla osoby: {name}. Jeśli to nie Ty, nie wpisuj go, tylko poproś o nowy kod na własne imię.`
- **ru** Русский: `Этот код выдан на имя: {name}. Если это не вы, не вводите его, а запросите новый код на своё имя.`
- **tr** Türkçe: `Bu kod şu kişi için: {name}. Bu siz değilseniz kodu girmeyin; bunun yerine kendi adınızla yeni bir kod isteyin.`
- **ar** العربية: `هذا الرمز مخصّص لـ {name}. إن لم يكن هذا أنت، فلا تُدخِله، واطلب بدلًا منه رمزًا جديدًا باسمك.`
- **hi** हिन्दी: `यह कोड {name} के लिए है। अगर यह आप नहीं हैं, तो इसे न डालें, बल्कि अपने नाम से नया कोड माँगें।`
- **mr** मराठी: `हा कोड {name} यांच्यासाठी आहे. ते तुम्ही नसाल, तर तो टाकू नका; त्याऐवजी तुमच्या स्वतःच्या नावाने नवीन कोड मागवा.`
- **ja** 日本語: `このコードは{name}さん用です。ご本人でない場合は入力せず、ご自分のお名前で新しいコードを申請してください。`
- **zh-Hans** 简体中文: `这个验证码是给 {name} 的。如果这不是你，请不要输入，改用你自己的名字重新获取验证码。`

### `arc.mail.code.ignore`

- **en** (source, Claude's): If you didn't ask for a copy, you can ignore this email.
- **es** Español: `Si no pediste ningún ejemplar, puedes ignorar este correo.`
- **fr** Français: `Si vous n'avez pas demandé d'exemplaire, vous pouvez ignorer cet e-mail.`
- **de** Deutsch: `Wenn Sie kein Exemplar angefragt haben, können Sie diese E-Mail ignorieren.`
- **it** Italiano: `Se non hai chiesto nessuna copia, puoi ignorare questa email.`
- **pt** Português: `Se não pediu nenhum exemplar, pode ignorar este e-mail.`
- **nl** Nederlands: `Hebt u geen exemplaar aangevraagd, dan kunt u deze e-mail negeren.`
- **pl** Polski: `Jeśli ta prośba nie pochodzi od Ciebie, możesz zignorować ten e-mail.`
- **ru** Русский: `Если вы не запрашивали экземпляр, просто проигнорируйте это письмо.`
- **tr** Türkçe: `Kopya istemediyseniz bu e-postayı yok sayabilirsiniz.`
- **ar** العربية: `إن لم تطلب نسخة، يمكنك تجاهل هذه الرسالة.`
- **hi** हिन्दी: `अगर आपने कोई प्रति नहीं माँगी थी, तो इस ईमेल को अनदेखा करें।`
- **mr** मराठी: `तुम्ही प्रत मागितली नसेल, तर हा ईमेल दुर्लक्षित करा.`
- **ja** 日本語: `献本を申し込んだ覚えがない場合は、このメールを無視してください。`
- **zh-Hans** 简体中文: `如果你没有申请过，可以忽略这封邮件。`

### `arc.mail.ready.subject`

- **en** (source, Claude's): Your advance copy of {title}
- **es** Español: `Tu ejemplar anticipado de {title}`
- **fr** Français: `Votre exemplaire en avant-première de {title}`
- **de** Deutsch: `Ihr Vorab-Exemplar von {title}`
- **it** Italiano: `La tua copia in anteprima di {title}`
- **pt** Português: `O seu exemplar antecipado de {title}`
- **nl** Nederlands: `Uw voorpublicatie-exemplaar van {title}`
- **pl** Polski: `Twój egzemplarz przedpremierowy „{title}”`
- **ru** Русский: `Ваш сигнальный экземпляр «{title}»`
- **tr** Türkçe: `{title} ön okuma kopyanız`
- **ar** العربية: `نسختك المسبقة من {title}`
- **hi** हिन्दी: `{title} की आपकी रिलीज़ से पहले की प्रति`
- **mr** मराठी: `{title} ची तुमची प्रकाशनापूर्वीची प्रत`
- **ja** 日本語: `『{title}』の献本をお届けします`
- **zh-Hans** 简体中文: `你的《{title}》预发本`

### `arc.mail.ready.lead`

- **en** (source, Claude's): Here is your advance copy of {title} from {author}.
- **es** Español: `Aquí tienes tu ejemplar anticipado de {title}, enviado por {author}.`
- **fr** Français: `Voici votre exemplaire en avant-première de {title}, envoyé par {author}.`
- **de** Deutsch: `Hier ist Ihr Vorab-Exemplar von {title}, gesendet von {author}.`
- **it** Italiano: `Ecco la tua copia in anteprima di {title}, inviata da {author}.`
- **pt** Português: `Aqui está o seu exemplar antecipado de {title}, enviado por {author}.`
- **nl** Nederlands: `Hier is uw voorpublicatie-exemplaar van {title}, verzonden door {author}.`
- **pl** Polski: `Oto Twój egzemplarz przedpremierowy „{title}”, który wysyła {author}.`
- **ru** Русский: `Вот ваш сигнальный экземпляр книги «{title}». Автор: {author}.`
- **tr** Türkçe: `{author} tarafından gönderilen {title} ön okuma kopyanız burada.`
- **ar** العربية: `إليك نسختك المسبقة من {title}، من {author}.`
- **hi** हिन्दी: `यह रही {author} की ओर से {title} की आपकी रिलीज़ से पहले की प्रति।`
- **mr** मराठी: `{author} यांच्याकडून {title} ची तुमची प्रकाशनापूर्वीची प्रत ही घ्या.`
- **ja** 日本語: `{author}から『{title}』の献本が届きました。`
- **zh-Hans** 简体中文: `这是 {author} 送给你的《{title}》预发本。`

### `arc.mail.pending.subject`

- **en** (source, Claude's): Your request for {title} is waiting for {author}
- **es** Español: `Tu solicitud de {title} está esperando a {author}`
- **fr** Français: `Votre demande pour {title} est transmise à {author}`
- **de** Deutsch: `Ihre Anfrage für {title} wartet auf eine Antwort von {author}`
- **it** Italiano: `La tua richiesta per {title} attende la risposta di {author}`
- **pt** Português: `O seu pedido de {title} aguarda resposta de {author}`
- **nl** Nederlands: `Uw aanvraag voor {title} wacht op {author}`
- **pl** Polski: `Twoja prośba o „{title}” czeka, aż odpowie {author}`
- **ru** Русский: `{author}: ваша заявка на «{title}» ждёт решения`
- **tr** Türkçe: `{title} isteğiniz yanıt bekliyor: {author}`
- **ar** العربية: `طلبك لكتاب {title} بانتظار ردّ {author}`
- **hi** हिन्दी: `{title} के लिए आपका अनुरोध {author} के पास है`
- **mr** मराठी: `{title} साठीची तुमची विनंती {author} यांच्याकडे प्रलंबित आहे`
- **ja** 日本語: `『{title}』のお申し込みは{author}の確認待ちです`
- **zh-Hans** 简体中文: `你对《{title}》的申请正在等待 {author} 处理`

### `arc.mail.pending.lead`

- **en** (source, Claude's): Thank you for asking for an advance copy of {title}.
- **es** Español: `Gracias por pedir un ejemplar anticipado de {title}.`
- **fr** Français: `Merci d'avoir demandé un exemplaire en avant-première de {title}.`
- **de** Deutsch: `Danke, dass Sie ein Vorab-Exemplar von {title} angefragt haben.`
- **it** Italiano: `Grazie per aver chiesto una copia in anteprima di {title}.`
- **pt** Português: `Obrigado por pedir um exemplar antecipado de {title}.`
- **nl** Nederlands: `Bedankt dat u een voorpublicatie-exemplaar van {title} hebt aangevraagd.`
- **pl** Polski: `Dziękujemy za prośbę o egzemplarz przedpremierowy „{title}”.`
- **ru** Русский: `Спасибо, что запросили сигнальный экземпляр книги «{title}».`
- **tr** Türkçe: `{title} için ön okuma kopyası istediğiniz için teşekkürler.`
- **ar** العربية: `شكرًا لطلبك نسخة مسبقة من {title}.`
- **hi** हिन्दी: `{title} की रिलीज़ से पहले की प्रति माँगने के लिए धन्यवाद।`
- **mr** मराठी: `{title} ची प्रकाशनापूर्वीची प्रत मागितल्याबद्दल धन्यवाद.`
- **ja** 日本語: `『{title}』の献本にお申し込みいただき、ありがとうございます。`
- **zh-Hans** 简体中文: `感谢你申请《{title}》的预发本。`

### `arc.mail.pending.body`

- **en** (source, Claude's): {author} looks at each request. You will get one more email when they decide.
- **es** Español: `{author} revisa cada solicitud. Recibirás un correo más cuando haya una decisión.`
- **fr** Français: `{author} examine chaque demande. Vous recevrez un e-mail de plus une fois la décision prise.`
- **de** Deutsch: `Jede Anfrage wird von {author} geprüft. Sie erhalten noch eine E-Mail, sobald die Entscheidung gefallen ist.`
- **it** Italiano: `{author} esamina ogni richiesta. Riceverai un'altra email quando ci sarà una decisione.`
- **pt** Português: `{author} analisa cada pedido. Receberá mais um e-mail quando houver uma decisão.`
- **nl** Nederlands: `{author} bekijkt elke aanvraag. U krijgt nog één e-mail zodra er een besluit is.`
- **pl** Polski: `{author} przegląda każdą prośbę. Gdy zapadnie decyzja, dostaniesz jeszcze jeden e-mail.`
- **ru** Русский: `{author} рассматривает каждую заявку. Когда решение будет принято, вы получите ещё одно письмо.`
- **tr** Türkçe: `{author} her isteği inceler. Karar verildiğinde bir e-posta daha alacaksınız.`
- **ar** العربية: `تُراجَع الطلبات واحدًا واحدًا لدى {author}. ستصلك رسالة أخرى عند اتخاذ القرار.`
- **hi** हिन्दी: `हर अनुरोध पर फ़ैसला {author} का होता है। फ़ैसला होने पर आपको एक और ईमेल मिलेगा।`
- **mr** मराठी: `{author} प्रत्येक विनंती पाहतात. त्यांनी निर्णय घेतल्यावर तुम्हाला आणखी एक ईमेल येईल.`
- **ja** 日本語: `{author}がお申し込みを一件ずつ確認します。結果が決まりしだい、もう一通メールをお送りします。`
- **zh-Hans** 简体中文: `{author} 会逐一查看每份申请。有结果时，你会再收到一封邮件。`

### `arc.mail.approved.subject`

- **en** (source, Claude's): {author} approved your request for {title}
- **es** Español: `{author} ha aprobado tu solicitud de {title}`
- **fr** Français: `{author} a accepté votre demande pour {title}`
- **de** Deutsch: `Ihre Anfrage für {title} wurde von {author} angenommen`
- **it** Italiano: `{author} ha approvato la tua richiesta per {title}`
- **pt** Português: `{author} aprovou o seu pedido de {title}`
- **nl** Nederlands: `{author} heeft uw aanvraag voor {title} goedgekeurd`
- **pl** Polski: `{author} zgadza się na Twoją prośbę o „{title}”`
- **ru** Русский: `{author}: ваша заявка на «{title}» одобрена`
- **tr** Türkçe: `{author}, {title} isteğinizi onayladı`
- **ar** العربية: `تمت الموافقة على طلبك لكتاب {title} من {author}`
- **hi** हिन्दी: `{author} ने {title} के लिए आपका अनुरोध मंज़ूर कर दिया`
- **mr** मराठी: `{author} यांनी {title} साठीची तुमची विनंती मंजूर केली`
- **ja** 日本語: `{author}が『{title}』のお申し込みを承認しました`
- **zh-Hans** 简体中文: `{author} 已批准你对《{title}》的申请`

### `arc.mail.approved.lead`

- **en** (source, Claude's): {author} approved your request. Here is your advance copy of {title}.
- **es** Español: `{author} ha aprobado tu solicitud. Aquí tienes tu ejemplar anticipado de {title}.`
- **fr** Français: `{author} a accepté votre demande. Voici votre exemplaire en avant-première de {title}.`
- **de** Deutsch: `Ihre Anfrage wurde von {author} angenommen. Hier ist Ihr Vorab-Exemplar von {title}.`
- **it** Italiano: `{author} ha approvato la tua richiesta. Ecco la tua copia in anteprima di {title}.`
- **pt** Português: `{author} aprovou o seu pedido. Aqui está o seu exemplar antecipado de {title}.`
- **nl** Nederlands: `{author} heeft uw aanvraag goedgekeurd. Hier is uw voorpublicatie-exemplaar van {title}.`
- **pl** Polski: `{author} zgadza się na Twoją prośbę. Oto Twój egzemplarz przedpremierowy „{title}”.`
- **ru** Русский: `{author}: ваша заявка одобрена. Вот ваш сигнальный экземпляр книги «{title}».`
- **tr** Türkçe: `{author} isteğinizi onayladı. {title} ön okuma kopyanız burada.`
- **ar** العربية: `تمت موافقة {author} على طلبك. إليك نسختك المسبقة من {title}.`
- **hi** हिन्दी: `{author} ने आपका अनुरोध मंज़ूर कर दिया है। यह रही {title} की आपकी रिलीज़ से पहले की प्रति।`
- **mr** मराठी: `{author} यांनी तुमची विनंती मंजूर केली. {title} ची तुमची प्रकाशनापूर्वीची प्रत ही घ्या.`
- **ja** 日本語: `{author}がお申し込みを承認しました。『{title}』の献本はこちらです。`
- **zh-Hans** 简体中文: `{author} 已批准你的申请。这是你的《{title}》预发本。`

### `arc.mail.declined.subject`

- **en** (source, Claude's): Your request for {title}
- **es** Español: `Tu solicitud de {title}`
- **fr** Français: `Votre demande pour {title}`
- **de** Deutsch: `Ihre Anfrage für {title}`
- **it** Italiano: `La tua richiesta per {title}`
- **pt** Português: `O seu pedido de {title}`
- **nl** Nederlands: `Uw aanvraag voor {title}`
- **pl** Polski: `Twoja prośba o „{title}”`
- **ru** Русский: `Ваша заявка на «{title}»`
- **tr** Türkçe: `{title} isteğiniz`
- **ar** العربية: `طلبك لكتاب {title}`
- **hi** हिन्दी: `{title} के लिए आपका अनुरोध`
- **mr** मराठी: `{title} साठीची तुमची विनंती`
- **ja** 日本語: `『{title}』のお申し込みについて`
- **zh-Hans** 简体中文: `你对《{title}》的申请`

### `arc.mail.declined.lead`

- **en** (source, Claude's): {author} is not sending you an advance copy of {title} this time.
- **es** Español: `Esta vez, {author} no te enviará un ejemplar anticipado de {title}.`
- **fr** Français: `{author} ne vous enverra pas d'exemplaire en avant-première de {title} cette fois-ci.`
- **de** Deutsch: `Diesmal erhalten Sie von {author} kein Vorab-Exemplar von {title}.`
- **it** Italiano: `Questa volta {author} non ti invierà una copia in anteprima di {title}.`
- **pt** Português: `Desta vez, {author} não lhe vai enviar um exemplar antecipado de {title}.`
- **nl** Nederlands: `{author} stuurt u deze keer geen voorpublicatie-exemplaar van {title}.`
- **pl** Polski: `{author} tym razem nie wyśle Ci egzemplarza przedpremierowego „{title}”.`
- **ru** Русский: `{author} в этот раз не отправит вам сигнальный экземпляр книги «{title}».`
- **tr** Türkçe: `{author} bu kez size {title} ön okuma kopyası göndermiyor.`
- **ar** العربية: `لن تصلك نسخة مسبقة من {title} من {author} هذه المرة.`
- **hi** हिन्दी: `इस बार {author} की ओर से आपको {title} की रिलीज़ से पहले की प्रति नहीं भेजी जाएगी।`
- **mr** मराठी: `या वेळी {author} यांच्याकडून तुम्हाला {title} ची प्रकाशनापूर्वीची प्रत पाठवली जाणार नाही.`
- **ja** 日本語: `今回は、{author}から『{title}』の献本をお送りすることはできません。`
- **zh-Hans** 简体中文: `这次 {author} 不会给你寄送《{title}》的预发本。`

### `arc.mail.declined.body`

- **en** (source, Claude's): Thank you for asking.
- **es** Español: `Gracias por pedirlo.`
- **fr** Français: `Merci d'avoir demandé.`
- **de** Deutsch: `Danke für Ihre Anfrage.`
- **it** Italiano: `Grazie per averla chiesta.`
- **pt** Português: `Obrigado por ter pedido.`
- **nl** Nederlands: `Bedankt voor uw aanvraag.`
- **pl** Polski: `Dziękujemy za prośbę.`
- **ru** Русский: `Спасибо за заявку.`
- **tr** Türkçe: `İsteğiniz için teşekkürler.`
- **ar** العربية: `شكرًا لطلبك.`
- **hi** हिन्दी: `माँगने के लिए धन्यवाद।`
- **mr** मराठी: `विचारल्याबद्दल धन्यवाद.`
- **ja** 日本語: `お申し込みいただき、ありがとうございました。`
- **zh-Hans** 简体中文: `感谢你的申请。`

### `arc.claim.title`

- **en** (source, fixed by the plan/spec): {title} — an advance copy from {author}
- **es** Español: `{title} — un ejemplar anticipado de {author}`
- **fr** Français: `{title} — un exemplaire en avant-première offert par {author}`
- **de** Deutsch: `{title} — ein Vorab-Exemplar von {author}`
- **it** Italiano: `{title} — una copia in anteprima da {author}`
- **pt** Português: `{title} — um exemplar antecipado oferecido por {author}`
- **nl** Nederlands: `{title} — een voorpublicatie-exemplaar van {author}`
- **pl** Polski: `„{title}” — egzemplarz przedpremierowy, który rozdaje {author}`
- **ru** Русский: `«{title}» — сигнальный экземпляр. Автор: {author}`
- **tr** Türkçe: `{title} — {author} tarafından bir ön okuma kopyası`
- **ar** العربية: `{title} — نسخة مسبقة من {author}`
- **hi** हिन्दी: `{title} — {author} की ओर से रिलीज़ से पहले की प्रति`
- **mr** मराठी: `{title} — {author} यांच्याकडून प्रकाशनापूर्वीची प्रत`
- **ja** 日本語: `『{title}』 — {author}からの献本`
- **zh-Hans** 简体中文: `《{title}》——来自 {author} 的预发本`

### `arc.claim.lede`

- **en** (source, fixed by the plan/spec): {author} is giving early copies to readers before {date}.
- **es** Español: `{author} regala ejemplares anticipados a lectores antes del {date}.`
- **fr** Français: `{author} offre des exemplaires en avant-première à des lecteurs avant le {date}.`
- **de** Deutsch: `Vor dem {date} gibt es von {author} Vorab-Exemplare für Leser.`
- **it** Italiano: `{author} regala copie in anteprima ai lettori prima del {date}.`
- **pt** Português: `{author} está a oferecer exemplares antecipados a leitores antes de {date}.`
- **nl** Nederlands: `{author} geeft vóór {date} voorpublicatie-exemplaren aan lezers.`
- **pl** Polski: `{author} rozdaje czytelnikom egzemplarze przedpremierowe przed {date}.`
- **ru** Русский: `{author} дарит читателям сигнальные экземпляры до {date}.`
- **tr** Türkçe: `{author}, {date} tarihinden önce okurlara ön okuma kopyaları veriyor.`
- **ar** العربية: `تُقدَّم نسخ مسبقة من {author} للقرّاء قبل {date}.`
- **hi** हिन्दी: `{date} से पहले पाठकों को {author} की ओर से शुरुआती प्रतियाँ दी जा रही हैं।`
- **mr** मराठी: `{author} {date} पूर्वी वाचकांना सुरुवातीच्या प्रती देत आहेत.`
- **ja** 日本語: `{author}が、{date}より前に読者へ献本をお届けしています。`
- **zh-Hans** 简体中文: `{author} 正在 {date} 之前把预发本送给读者。`

### `arc.claim.review`

- **en** (source, fixed by the plan/spec): If you'd like to review it after reading, you're welcome to. It's never required.
- **es** Español: `Si quieres reseñarlo después de leerlo, puedes hacerlo. Nunca es obligatorio.`
- **fr** Français: `Si vous souhaitez donner votre avis sur ce livre après l'avoir lu, libre à vous. Ce n'est jamais obligatoire.`
- **de** Deutsch: `Wenn Sie es nach dem Lesen rezensieren möchten, sind Sie herzlich dazu eingeladen. Pflicht ist das nie.`
- **it** Italiano: `Se dopo averlo letto vuoi recensirlo, fallo pure. Non è mai obbligatorio.`
- **pt** Português: `Se quiser fazer uma crítica depois de o ler, esteja à vontade. Nunca é obrigatório.`
- **nl** Nederlands: `Als u het na het lezen wilt recenseren, mag dat graag. Het is nooit verplicht.`
- **pl** Polski: `Jeśli po lekturze zechcesz napisać recenzję, śmiało. Nigdy nie jest to obowiązkowe.`
- **ru** Русский: `Если после прочтения захотите написать отзыв — пожалуйста. Это никогда не обязательно.`
- **tr** Türkçe: `Okuduktan sonra yorum yazmak isterseniz yazabilirsiniz. Bu hiçbir zaman zorunlu değildir.`
- **ar** العربية: `إن رغبت في مراجعته بعد قراءته، فأهلًا بذلك. وليس ذلك مطلوبًا أبدًا.`
- **hi** हिन्दी: `अगर आप पढ़ने के बाद इसका रिव्यू लिखना चाहें, तो आपका स्वागत है। यह कभी ज़रूरी नहीं है।`
- **mr** मराठी: `वाचून झाल्यावर तुम्हाला परीक्षण लिहायचे असेल, तर तुमचे स्वागत आहे. ते कधीही आवश्यक नाही.`
- **ja** 日本語: `読み終えたあとでレビューを書きたいと思ったら、どうぞご自由に。書く必要はまったくありません。`
- **zh-Hans** 简体中文: `如果你读完后想写书评，非常欢迎。这从来都不是硬性要求。`

### `arc.claim.cover`

- **en** (source, Claude's): The cover of {title}
- **es** Español: `La cubierta de {title}`
- **fr** Français: `La couverture de {title}`
- **de** Deutsch: `Das Cover von {title}`
- **it** Italiano: `La copertina di {title}`
- **pt** Português: `A capa de {title}`
- **nl** Nederlands: `Het omslag van {title}`
- **pl** Polski: `Okładka „{title}”`
- **ru** Русский: `Обложка книги «{title}»`
- **tr** Türkçe: `{title} kapağı`
- **ar** العربية: `غلاف {title}`
- **hi** हिन्दी: `{title} का कवर`
- **mr** मराठी: `{title} चे मुखपृष्ठ`
- **ja** 日本語: `『{title}』の表紙`
- **zh-Hans** 简体中文: `《{title}》的封面`

### `arc.claim.name`

- **en** (source, Claude's): Your name
- **es** Español: `Tu nombre`
- **fr** Français: `Votre nom`
- **de** Deutsch: `Ihr Name`
- **it** Italiano: `Il tuo nome`
- **pt** Português: `O seu nome`
- **nl** Nederlands: `Uw naam`
- **pl** Polski: `Twoje imię`
- **ru** Русский: `Ваше имя`
- **tr** Türkçe: `Adınız`
- **ar** العربية: `اسمك`
- **hi** हिन्दी: `आपका नाम`
- **mr** मराठी: `तुमचे नाव`
- **ja** 日本語: `お名前`
- **zh-Hans** 简体中文: `你的名字`

### `arc.claim.email`

- **en** (source, Claude's): Your email
- **es** Español: `Tu correo electrónico`
- **fr** Français: `Votre adresse e-mail`
- **de** Deutsch: `Ihre E-Mail-Adresse`
- **it** Italiano: `La tua email`
- **pt** Português: `O seu e-mail`
- **nl** Nederlands: `Uw e-mailadres`
- **pl** Polski: `Twój e-mail`
- **ru** Русский: `Ваша электронная почта`
- **tr** Türkçe: `E-posta adresiniz`
- **ar** العربية: `بريدك الإلكتروني`
- **hi** हिन्दी: `आपका ईमेल`
- **mr** मराठी: `तुमचा ईमेल`
- **ja** 日本語: `メールアドレス`
- **zh-Hans** 简体中文: `你的邮箱`

### `arc.claim.profile`

- **en** (source, fixed by the plan/spec): A Goodreads or Amazon profile link
- **es** Español: `Un enlace a tu perfil de Goodreads o Amazon`
- **fr** Français: `Un lien vers votre profil Goodreads ou Amazon`
- **de** Deutsch: `Ein Link zu Ihrem Goodreads- oder Amazon-Profil`
- **it** Italiano: `Un link al tuo profilo Goodreads o Amazon`
- **pt** Português: `Um link para o seu perfil no Goodreads ou na Amazon`
- **nl** Nederlands: `Een link naar uw Goodreads- of Amazon-profiel`
- **pl** Polski: `Link do Twojego profilu w Goodreads lub Amazon`
- **ru** Русский: `Ссылка на ваш профиль в Goodreads или Amazon`
- **tr** Türkçe: `Goodreads veya Amazon profil bağlantınız`
- **ar** العربية: `رابط ملفك الشخصي على Goodreads أو Amazon`
- **hi** हिन्दी: `Goodreads या Amazon प्रोफ़ाइल का लिंक`
- **mr** मराठी: `Goodreads किंवा Amazon प्रोफाइलची लिंक`
- **ja** 日本語: `GoodreadsまたはAmazonのプロフィールのリンク`
- **zh-Hans** 简体中文: `你的 Goodreads 或 Amazon 个人主页链接`

### `arc.claim.profileNote`

- **en** (source, Claude's): {author} sees this link as text. Beuk never opens it.
- **es** Español: `{author} ve este enlace como texto. Beuk nunca lo abre.`
- **fr** Français: `{author} voit ce lien sous forme de texte. Beuk ne l'ouvre jamais.`
- **de** Deutsch: `Bei {author} erscheint dieser Link nur als Text. Beuk öffnet ihn nie.`
- **it** Italiano: `{author} vede questo link come testo. Beuk non lo apre mai.`
- **pt** Português: `{author} vê este link como texto. O Beuk nunca o abre.`
- **nl** Nederlands: `{author} ziet deze link als tekst. Beuk opent hem nooit.`
- **pl** Polski: `{author} widzi ten link jako tekst. Beuk nigdy go nie otwiera.`
- **ru** Русский: `{author} видит эту ссылку как текст. Beuk никогда её не открывает.`
- **tr** Türkçe: `{author} bu bağlantıyı metin olarak görür. Beuk onu asla açmaz.`
- **ar** العربية: `يظهر هذا الرابط عند {author} نصًّا فقط. لا يفتحه Beuk أبدًا.`
- **hi** हिन्दी: `{author} को यह लिंक सिर्फ़ टेक्स्ट के रूप में दिखता है। Beuk इसे कभी नहीं खोलता।`
- **mr** मराठी: `{author} यांना ही लिंक फक्त मजकूर म्हणून दिसते. Beuk ती कधीही उघडत नाही.`
- **ja** 日本語: `このリンクは{author}にテキストとして表示されます。Beukがリンクを開くことはありません。`
- **zh-Hans** 简体中文: `{author} 看到的只是这个链接的文字。Beuk 从不打开它。`

### `arc.claim.approvalNote`

- **en** (source, Claude's): {author} looks at each request and answers by email.
- **es** Español: `{author} revisa cada solicitud y responde por correo.`
- **fr** Français: `{author} examine chaque demande et répond par e-mail.`
- **de** Deutsch: `Jede Anfrage wird von {author} geprüft und per E-Mail beantwortet.`
- **it** Italiano: `{author} esamina ogni richiesta e risponde via email.`
- **pt** Português: `{author} analisa cada pedido e responde por e-mail.`
- **nl** Nederlands: `{author} bekijkt elke aanvraag en antwoordt per e-mail.`
- **pl** Polski: `{author} przegląda każdą prośbę i odpowiada e-mailem.`
- **ru** Русский: `{author} рассматривает каждую заявку и отвечает по почте.`
- **tr** Türkçe: `{author} her isteği inceler ve e-postayla yanıt verir.`
- **ar** العربية: `تُراجَع الطلبات واحدًا واحدًا لدى {author}، ويصلك الردّ بالبريد الإلكتروني.`
- **hi** हिन्दी: `हर अनुरोध पर फ़ैसला {author} का होता है, और जवाब ईमेल से आता है।`
- **mr** मराठी: `{author} प्रत्येक विनंती पाहतात आणि ईमेलने उत्तर देतात.`
- **ja** 日本語: `{author}がお申し込みを一件ずつ確認し、メールでお返事します。`
- **zh-Hans** 简体中文: `{author} 会逐一查看每份申请，并通过邮件答复。`

### `arc.claim.codeNote`

- **en** (source, Claude's): Beuk will email you a 6-digit code to confirm the address.
- **es** Español: `Beuk te enviará por correo un código de 6 dígitos para confirmar la dirección.`
- **fr** Français: `Beuk vous enverra par e-mail un code à 6 chiffres pour confirmer l'adresse.`
- **de** Deutsch: `Beuk schickt Ihnen per E-Mail einen 6-stelligen Code, um die Adresse zu bestätigen.`
- **it** Italiano: `Beuk ti invierà via email un codice di 6 cifre per confermare l'indirizzo.`
- **pt** Português: `O Beuk vai enviar-lhe por e-mail um código de 6 dígitos para confirmar o endereço.`
- **nl** Nederlands: `Beuk mailt u een code van 6 cijfers om het adres te bevestigen.`
- **pl** Polski: `Beuk wyśle Ci e-mailem 6-cyfrowy kod, by potwierdzić adres.`
- **ru** Русский: `Beuk пришлёт вам на почту 6-значный код, чтобы подтвердить адрес.`
- **tr** Türkçe: `Beuk, adresi doğrulamak için size e-postayla 6 haneli bir kod gönderecek.`
- **ar** العربية: `سيرسل إليك Beuk رمزًا من 6 أرقام بالبريد الإلكتروني لتأكيد العنوان.`
- **hi** हिन्दी: `पता पक्का करने के लिए Beuk आपको ईमेल पर 6 अंकों का कोड भेजेगा।`
- **mr** मराठी: `पत्ता निश्चित करण्यासाठी Beuk तुम्हाला ईमेलवर 6 अंकी कोड पाठवेल.`
- **ja** 日本語: `アドレスの確認のため、Beukから6桁のコードをメールでお送りします。`
- **zh-Hans** 简体中文: `Beuk 会给你发送一个 6 位数验证码，用来确认邮箱地址。`

### `arc.claim.honeypot`

- **en** (source, Claude's): Leave this empty
- **es** Español: `Deja esto vacío`
- **fr** Français: `Laissez ce champ vide`
- **de** Deutsch: `Dieses Feld leer lassen`
- **it** Italiano: `Lascia vuoto questo campo`
- **pt** Português: `Deixe este campo vazio`
- **nl** Nederlands: `Laat dit leeg`
- **pl** Polski: `Zostaw to pole puste`
- **ru** Русский: `Оставьте это поле пустым`
- **tr** Türkçe: `Burayı boş bırakın`
- **ar** العربية: `اترك هذا الحقل فارغًا`
- **hi** हिन्दी: `इसे खाली छोड़ें`
- **mr** मराठी: `हे रिकामे ठेवा`
- **ja** 日本語: `この欄は空のままにしてください`
- **zh-Hans** 简体中文: `请留空`

### `arc.claim.submit`

- **en** (source, fixed by the plan/spec): Get my copy
- **es** Español: `Quiero mi ejemplar`
- **fr** Français: `Recevoir mon exemplaire`
- **de** Deutsch: `Mein Exemplar anfordern`
- **it** Italiano: `Richiedi la mia copia`
- **pt** Português: `Quero o meu exemplar`
- **nl** Nederlands: `Mijn exemplaar aanvragen`
- **pl** Polski: `Odbierz egzemplarz`
- **ru** Русский: `Получить экземпляр`
- **tr** Türkçe: `Kopyamı al`
- **ar** العربية: `اطلب نسختي`
- **hi** हिन्दी: `मेरी प्रति पाएँ`
- **mr** मराठी: `माझी प्रत मिळवा`
- **ja** 日本語: `献本を受け取る`
- **zh-Hans** 简体中文: `领取我的预发本`

### `arc.claim.stampNote`

- **en** (source, fixed by the plan/spec): Your copy will show your name and email on its copyright page.
- **es** Español: `Tu ejemplar mostrará tu nombre y tu correo en la página de derechos de autor.`
- **fr** Français: `Votre exemplaire portera votre nom et votre adresse e-mail sur sa page de copyright.`
- **de** Deutsch: `Ihr Exemplar wird Ihren Namen und Ihre E-Mail-Adresse auf der Copyright-Seite zeigen.`
- **it** Italiano: `La tua copia mostrerà il tuo nome e la tua email nella pagina del copyright.`
- **pt** Português: `O seu exemplar vai mostrar o seu nome e o seu e-mail na página de direitos de autor.`
- **nl** Nederlands: `Uw exemplaar toont straks uw naam en e-mailadres op de copyrightpagina.`
- **pl** Polski: `Twój egzemplarz pokaże Twoje imię i adres e-mail na stronie z prawami autorskimi.`
- **ru** Русский: `В вашем экземпляре на странице с авторскими правами будут указаны ваше имя и адрес почты.`
- **tr** Türkçe: `Kopyanızın telif hakkı sayfasında adınız ve e-posta adresiniz yer alacak.`
- **ar** العربية: `ستُظهر نسختك اسمك وبريدك الإلكتروني في صفحة حقوق النشر.`
- **hi** हिन्दी: `आपकी प्रति के कॉपीराइट पेज पर आपका नाम और ईमेल दिखेगा।`
- **mr** मराठी: `तुमच्या प्रतीच्या कॉपीराइट पानावर तुमचे नाव आणि ईमेल दिसेल.`
- **ja** 日本語: `献本の著作権ページには、お名前とメールアドレスが入ります。`
- **zh-Hans** 简体中文: `你的这一份会在版权页上印有你的姓名和邮箱。`

### `arc.claim.err.closed`

- **en** (source, Claude's): Sign-ups for this advance copy have closed.
- **es** Español: `Las inscripciones para este ejemplar anticipado están cerradas.`
- **fr** Français: `Les inscriptions pour cet exemplaire en avant-première sont closes.`
- **de** Deutsch: `Die Anmeldung für dieses Vorab-Exemplar ist geschlossen.`
- **it** Italiano: `Le iscrizioni per questa copia in anteprima sono chiuse.`
- **pt** Português: `As inscrições para este exemplar antecipado estão fechadas.`
- **nl** Nederlands: `De aanmelding voor dit voorpublicatie-exemplaar is gesloten.`
- **pl** Polski: `Zapisy na ten egzemplarz przedpremierowy są zamknięte.`
- **ru** Русский: `Запись на этот сигнальный экземпляр закрыта.`
- **tr** Türkçe: `Bu ön okuma kopyası için kayıtlar kapandı.`
- **ar** العربية: `أُغلق التسجيل لهذه النسخة المسبقة.`
- **hi** हिन्दी: `इस रिलीज़ से पहले की प्रति के लिए साइन अप बंद हो चुके हैं।`
- **mr** मराठी: `या प्रकाशनापूर्वीच्या प्रतीसाठी नोंदणी बंद झाली आहे.`
- **ja** 日本語: `この献本の申し込みは締め切りました。`
- **zh-Hans** 简体中文: `这本预发本的报名已经截止。`

### `arc.claim.err.full`

- **en** (source, Claude's): Every copy has been claimed. Thank you for asking.
- **es** Español: `Ya se han pedido todos los ejemplares. Gracias por pedirlo.`
- **fr** Français: `Tous les exemplaires ont été demandés. Merci d'avoir demandé.`
- **de** Deutsch: `Alle Exemplare sind vergeben. Danke für Ihre Anfrage.`
- **it** Italiano: `Tutte le copie sono state richieste. Grazie per averla chiesta.`
- **pt** Português: `Todos os exemplares já foram pedidos. Obrigado por ter pedido.`
- **nl** Nederlands: `Alle exemplaren zijn al aangevraagd. Bedankt voor uw aanvraag.`
- **pl** Polski: `Wszystkie egzemplarze są już zajęte. Dziękujemy za prośbę.`
- **ru** Русский: `Все экземпляры уже разобраны. Спасибо за заявку.`
- **tr** Türkçe: `Tüm kopyalar alındı. İsteğiniz için teşekkürler.`
- **ar** العربية: `طُلبت كل النسخ. شكرًا لطلبك.`
- **hi** हिन्दी: `सारी प्रतियाँ ली जा चुकी हैं। माँगने के लिए धन्यवाद।`
- **mr** मराठी: `सर्व प्रती घेतल्या गेल्या आहेत. विचारल्याबद्दल धन्यवाद.`
- **ja** 日本語: `献本はすべて申し込み済みです。ご関心をお寄せいただき、ありがとうございます。`
- **zh-Hans** 简体中文: `所有预发本都已被领取。感谢你的申请。`

### `arc.claim.err.blocked`

- **en** (source, Claude's): Beuk can't email this address. Someone using it asked for no more advance-copy email, so no code can be sent.
- **es** Español: `Beuk no puede escribir a esta dirección. Alguien que la usa pidió no recibir más correos de ejemplares anticipados, así que no se puede enviar ningún código.`
- **fr** Français: `Beuk ne peut pas écrire à cette adresse. Quelqu'un qui l'utilise a demandé à ne plus recevoir d'e-mails d'exemplaires en avant-première : aucun code ne peut donc être envoyé.`
- **de** Deutsch: `Beuk kann an diese Adresse keine E-Mails senden. Jemand, der sie nutzt, wollte keine E-Mails zu Vorab-Exemplaren mehr erhalten, daher kann kein Code gesendet werden.`
- **it** Italiano: `Beuk non può scrivere a questo indirizzo. Qualcuno che lo usa ha chiesto di non ricevere più email sulle copie in anteprima, quindi non si può inviare nessun codice.`
- **pt** Português: `O Beuk não pode enviar e-mails para este endereço. Alguém que o usa pediu para não receber mais e-mails de exemplares antecipados, por isso não é possível enviar nenhum código.`
- **nl** Nederlands: `Beuk kan dit adres niet mailen. Iemand die het gebruikt, heeft gevraagd geen e-mail over voorpublicatie-exemplaren meer te sturen, dus er kan geen code worden verstuurd.`
- **pl** Polski: `Beuk nie może wysyłać e-maili na ten adres. Ktoś, kto go używa, poprosił o brak kolejnych e-maili w sprawie egzemplarzy przedpremierowych, więc nie można wysłać kodu.`
- **ru** Русский: `Beuk не может писать на этот адрес. Кто-то, кто им пользуется, попросил больше не присылать письма о сигнальных экземплярах, поэтому код отправить нельзя.`
- **tr** Türkçe: `Beuk bu adrese e-posta gönderemiyor. Bu adresi kullanan biri artık ön okuma kopyası e-postası istemediğini bildirdi, bu yüzden kod gönderilemez.`
- **ar** العربية: `لا يستطيع Beuk مراسلة هذا العنوان. طلب شخص يستخدمه ألّا تصله رسائل النسخ المسبقة بعد الآن، لذا لا يمكن إرسال رمز.`
- **hi** हिन्दी: `Beuk इस पते पर ईमेल नहीं भेज सकता। इसे इस्तेमाल करने वाले किसी व्यक्ति ने रिलीज़ से पहले की प्रतियों वाले ईमेल बंद करने को कहा है, इसलिए कोई कोड नहीं भेजा जा सकता।`
- **mr** मराठी: `Beuk या पत्त्यावर ईमेल पाठवू शकत नाही. हा पत्ता वापरणाऱ्या कोणीतरी प्रकाशनापूर्वीच्या प्रतींचे आणखी ईमेल नकोत असे सांगितले आहे, त्यामुळे कोड पाठवता येत नाही.`
- **ja** 日本語: `Beukはこのアドレスにメールを送れません。このアドレスを使う方から献本に関するメールの停止を希望されているため、コードを送れません。`
- **zh-Hans** 简体中文: `Beuk 无法给这个地址发邮件。使用这个地址的人已要求不再接收预发本邮件，因此无法发送验证码。`

### `arc.claim.err.mailOff`

- **en** (source, Claude's): Beuk can't send advance-copy email right now, so no claim was taken. Please try again later.
- **es** Español: `Ahora mismo Beuk no puede enviar correos de ejemplares anticipados, así que no se ha registrado ninguna solicitud. Vuelve a intentarlo más tarde.`
- **fr** Français: `Beuk ne peut pas envoyer d'e-mails d'exemplaires en avant-première pour le moment : aucune demande n'a donc été enregistrée. Veuillez réessayer plus tard.`
- **de** Deutsch: `Beuk kann gerade keine E-Mails zu Vorab-Exemplaren senden, daher wurde keine Anfrage aufgenommen. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Al momento Beuk non può inviare email sulle copie in anteprima, quindi nessuna richiesta è stata registrata. Riprova più tardi.`
- **pt** Português: `Neste momento, o Beuk não consegue enviar e-mails de exemplares antecipados, por isso nenhum pedido foi registado. Tente novamente mais tarde.`
- **nl** Nederlands: `Beuk kan op dit moment geen e-mail over voorpublicatie-exemplaren versturen, dus er is geen aanvraag opgenomen. Probeer het later opnieuw.`
- **pl** Polski: `Beuk nie może teraz wysyłać e-maili w sprawie egzemplarzy przedpremierowych, więc prośba nie została przyjęta. Spróbuj ponownie później.`
- **ru** Русский: `Сейчас Beuk не может отправлять письма о сигнальных экземплярах, поэтому заявка не принята. Попробуйте позже.`
- **tr** Türkçe: `Beuk şu anda ön okuma kopyası e-postası gönderemiyor, bu yüzden istek alınmadı. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `لا يستطيع Beuk إرسال رسائل النسخ المسبقة الآن، لذا لم يُسجَّل أي طلب. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `Beuk अभी रिलीज़ से पहले की प्रतियों वाले ईमेल नहीं भेज सकता, इसलिए कोई अनुरोध नहीं लिया गया। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `Beuk सध्या प्रकाशनापूर्वीच्या प्रतींचे ईमेल पाठवू शकत नाही, त्यामुळे कोणतीही विनंती घेतली गेली नाही. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `現在Beukは献本に関するメールを送れないため、お申し込みは受け付けられませんでした。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `Beuk 现在无法发送预发本邮件，因此没有接收任何申请。请稍后再试。`

### `arc.claim.err.busy`

- **en** (source, Claude's): Too many tries for now. Please wait a while, then try again.
- **es** Español: `Demasiados intentos por ahora. Espera un rato y vuelve a intentarlo.`
- **fr** Français: `Trop de tentatives pour le moment. Patientez un peu, puis réessayez.`
- **de** Deutsch: `Zu viele Versuche für den Moment. Bitte warten Sie eine Weile und versuchen Sie es dann erneut.`
- **it** Italiano: `Troppi tentativi per ora. Aspetta un po', poi riprova.`
- **pt** Português: `Demasiadas tentativas por agora. Aguarde um pouco e tente novamente.`
- **nl** Nederlands: `Te veel pogingen voor nu. Wacht even en probeer het dan opnieuw.`
- **pl** Polski: `Na razie za dużo prób. Odczekaj chwilę i spróbuj ponownie.`
- **ru** Русский: `Слишком много попыток. Подождите немного и попробуйте снова.`
- **tr** Türkçe: `Şimdilik çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin.`
- **ar** العربية: `محاولات كثيرة جدًا حاليًا. انتظر قليلًا ثم حاول مرة أخرى.`
- **hi** हिन्दी: `अभी बहुत ज़्यादा कोशिशें हो गईं। कृपया थोड़ी देर रुकें, फिर कोशिश करें।`
- **mr** मराठी: `सध्या खूप प्रयत्न झाले आहेत. कृपया थोडा वेळ थांबा, मग पुन्हा प्रयत्न करा.`
- **ja** 日本語: `試行回数が多すぎます。しばらく待ってから、もう一度お試しください。`
- **zh-Hans** 简体中文: `尝试次数太多。请稍等一会儿再试。`

### `arc.claim.err.mailFailed`

- **en** (source, Claude's): Beuk couldn't send the code just now. Please try again later.
- **es** Español: `Beuk no ha podido enviar el código ahora mismo. Vuelve a intentarlo más tarde.`
- **fr** Français: `Beuk n'a pas pu envoyer le code pour le moment. Veuillez réessayer plus tard.`
- **de** Deutsch: `Beuk konnte den Code gerade nicht senden. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Beuk non è riuscito a inviare il codice in questo momento. Riprova più tardi.`
- **pt** Português: `O Beuk não conseguiu enviar o código neste momento. Tente novamente mais tarde.`
- **nl** Nederlands: `Beuk kon de code nu niet versturen. Probeer het later opnieuw.`
- **pl** Polski: `Beuk nie mógł teraz wysłać kodu. Spróbuj ponownie później.`
- **ru** Русский: `Beuk не удалось отправить код. Попробуйте позже.`
- **tr** Türkçe: `Beuk kodu şu anda gönderemedi. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `تعذّر على Beuk إرسال الرمز الآن. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `Beuk अभी कोड नहीं भेज पाया। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `Beuk ला आत्ता कोड पाठवता आला नाही. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `Beukはいまコードを送信できませんでした。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `Beuk 刚才没能发送验证码。请稍后再试。`

### `arc.claim.err.signupsBusy`

- **en** (source, Claude's): Sign-ups are busy right now. Please try again later.
- **es** Español: `Ahora mismo hay muchas inscripciones. Vuelve a intentarlo más tarde.`
- **fr** Français: `Les inscriptions sont saturées pour le moment. Veuillez réessayer plus tard.`
- **de** Deutsch: `Bei der Anmeldung ist gerade viel los. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Le iscrizioni sono molto affollate in questo momento. Riprova più tardi.`
- **pt** Português: `As inscrições estão muito concorridas neste momento. Tente novamente mais tarde.`
- **nl** Nederlands: `Het is nu erg druk met aanmeldingen. Probeer het later opnieuw.`
- **pl** Polski: `Zapisy są teraz przeciążone. Spróbuj ponownie później.`
- **ru** Русский: `Запись сейчас перегружена. Попробуйте позже.`
- **tr** Türkçe: `Kayıtlar şu anda çok yoğun. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `التسجيل مزدحم الآن. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `अभी साइन अप पर बहुत भीड़ है। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `सध्या नोंदणीसाठी खूप गर्दी आहे. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `現在、申し込みが混み合っています。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `现在报名的人太多。请稍后再试。`

### `arc.claim.err.badName`

- **en** (source, Claude's): Please write your name, in at most 60 characters.
- **es** Español: `Escribe tu nombre, con 60 caracteres como máximo.`
- **fr** Français: `Veuillez écrire votre nom, en 60 caractères au maximum.`
- **de** Deutsch: `Bitte geben Sie Ihren Namen ein, mit höchstens 60 Zeichen.`
- **it** Italiano: `Scrivi il tuo nome, al massimo 60 caratteri.`
- **pt** Português: `Escreva o seu nome, com 60 caracteres no máximo.`
- **nl** Nederlands: `Vul uw naam in, met hooguit 60 tekens.`
- **pl** Polski: `Wpisz swoje imię, maksymalnie 60 znaków.`
- **ru** Русский: `Напишите своё имя, не длиннее 60 символов.`
- **tr** Türkçe: `Lütfen adınızı en fazla 60 karakterle yazın.`
- **ar** العربية: `اكتب اسمك، في 60 حرفًا على الأكثر.`
- **hi** हिन्दी: `कृपया अपना नाम लिखें, ज़्यादा से ज़्यादा 60 अक्षरों में।`
- **mr** मराठी: `कृपया तुमचे नाव लिहा, जास्तीत जास्त 60 अक्षरांत.`
- **ja** 日本語: `お名前を60文字以内で入力してください。`
- **zh-Hans** 简体中文: `请填写你的名字，最多 60 个字符。`

### `arc.claim.err.badEmail`

- **en** (source, Claude's): Please check your email address.
- **es** Español: `Revisa tu dirección de correo.`
- **fr** Français: `Veuillez vérifier votre adresse e-mail.`
- **de** Deutsch: `Bitte prüfen Sie Ihre E-Mail-Adresse.`
- **it** Italiano: `Controlla il tuo indirizzo email.`
- **pt** Português: `Verifique o seu endereço de e-mail.`
- **nl** Nederlands: `Controleer uw e-mailadres.`
- **pl** Polski: `Sprawdź swój adres e-mail.`
- **ru** Русский: `Проверьте адрес электронной почты.`
- **tr** Türkçe: `Lütfen e-posta adresinizi kontrol edin.`
- **ar** العربية: `تحقّق من عنوان بريدك الإلكتروني.`
- **hi** हिन्दी: `कृपया अपना ईमेल पता जाँचें।`
- **mr** मराठी: `कृपया तुमचा ईमेल पत्ता तपासा.`
- **ja** 日本語: `メールアドレスをご確認ください。`
- **zh-Hans** 简体中文: `请检查你的邮箱地址。`

### `arc.claim.err.badProfile`

- **en** (source, Claude's): Please add a link to your Goodreads or Amazon profile, starting with https://.
- **es** Español: `Añade un enlace a tu perfil de Goodreads o Amazon que empiece por https://.`
- **fr** Français: `Veuillez ajouter un lien vers votre profil Goodreads ou Amazon, commençant par https://.`
- **de** Deutsch: `Bitte fügen Sie einen Link zu Ihrem Goodreads- oder Amazon-Profil hinzu, der mit https:// beginnt.`
- **it** Italiano: `Aggiungi un link al tuo profilo Goodreads o Amazon che inizi con https://.`
- **pt** Português: `Adicione um link para o seu perfil no Goodreads ou na Amazon que comece por https://.`
- **nl** Nederlands: `Voeg een link naar uw Goodreads- of Amazon-profiel toe die begint met https://.`
- **pl** Polski: `Dodaj link do swojego profilu w Goodreads lub Amazon, zaczynający się od https://.`
- **ru** Русский: `Добавьте ссылку на свой профиль в Goodreads или Amazon, начинающуюся с https://.`
- **tr** Türkçe: `Lütfen https:// ile başlayan bir Goodreads veya Amazon profil bağlantısı ekleyin.`
- **ar** العربية: `أضف رابطًا لملفك الشخصي على Goodreads أو Amazon يبدأ بـ https://.`
- **hi** हिन्दी: `कृपया अपनी Goodreads या Amazon प्रोफ़ाइल का लिंक जोड़ें, जो https:// से शुरू हो।`
- **mr** मराठी: `कृपया तुमच्या Goodreads किंवा Amazon प्रोफाइलची लिंक जोडा, जी https:// ने सुरू होते.`
- **ja** 日本語: `https:// で始まる、GoodreadsまたはAmazonのプロフィールのリンクを追加してください。`
- **zh-Hans** 简体中文: `请添加你的 Goodreads 或 Amazon 个人主页链接，以 https:// 开头。`

### `arc.claim.err.answered`

- **en** (source, Claude's): {author} has already answered a request from this address.
- **es** Español: `{author} ya ha respondido a una solicitud de esta dirección.`
- **fr** Français: `{author} a déjà répondu à une demande venant de cette adresse.`
- **de** Deutsch: `Eine Anfrage von dieser Adresse wurde von {author} bereits beantwortet.`
- **it** Italiano: `{author} ha già risposto a una richiesta da questo indirizzo.`
- **pt** Português: `{author} já respondeu a um pedido deste endereço.`
- **nl** Nederlands: `{author} heeft al gereageerd op een aanvraag van dit adres.`
- **pl** Polski: `{author} — prośba z tego adresu została już rozpatrzona.`
- **ru** Русский: `{author}: на заявку с этого адреса уже дан ответ.`
- **tr** Türkçe: `{author} bu adresten gelen bir isteği zaten yanıtladı.`
- **ar** العربية: `سبق الردّ من {author} على طلب من هذا العنوان.`
- **hi** हिन्दी: `इस पते से आए एक अनुरोध का जवाब {author} की ओर से पहले ही दिया जा चुका है।`
- **mr** मराठी: `{author} यांनी या पत्त्यावरून आलेल्या एका विनंतीला आधीच उत्तर दिले आहे.`
- **ja** 日本語: `このアドレスからのお申し込みには、{author}がすでにお返事しています。`
- **zh-Hans** 简体中文: `{author} 已经答复过来自这个地址的申请。`

### `arc.code.title`

- **en** (source, Claude's): Enter your code
- **es** Español: `Escribe tu código`
- **fr** Français: `Saisissez votre code`
- **de** Deutsch: `Code eingeben`
- **it** Italiano: `Inserisci il tuo codice`
- **pt** Português: `Introduza o seu código`
- **nl** Nederlands: `Vul uw code in`
- **pl** Polski: `Wpisz kod`
- **ru** Русский: `Введите код`
- **tr** Türkçe: `Kodunuzu girin`
- **ar** العربية: `أدخل رمزك`
- **hi** हिन्दी: `अपना कोड डालें`
- **mr** मराठी: `तुमचा कोड टाका`
- **ja** 日本語: `確認コードを入力`
- **zh-Hans** 简体中文: `输入验证码`

### `arc.code.sentTo`

- **en** (source, Claude's): Beuk sent a 6-digit code to {email}. It works for {minutes} minutes.
- **es** Español: `Beuk ha enviado un código de 6 dígitos a {email}. Sirve durante {minutes} minutos.`
- **fr** Français: `Beuk a envoyé un code à 6 chiffres à {email}. Il est valable {minutes} minutes.`
- **de** Deutsch: `Beuk hat einen 6-stelligen Code an {email} gesendet. Er gilt {minutes} Minuten.`
- **it** Italiano: `Beuk ha inviato un codice di 6 cifre a {email}. Vale per {minutes} minuti.`
- **pt** Português: `O Beuk enviou um código de 6 dígitos para {email}. É válido durante {minutes} minutos.`
- **nl** Nederlands: `Beuk heeft een code van 6 cijfers naar {email} gestuurd. Hij werkt {minutes} minuten.`
- **pl** Polski: `Beuk wysłał 6-cyfrowy kod na adres {email}. Jest ważny przez {minutes} min.`
- **ru** Русский: `Beuk отправил 6-значный код на {email}. Он действует {minutes} мин.`
- **tr** Türkçe: `Beuk, {email} adresine 6 haneli bir kod gönderdi. Kod {minutes} dakika geçerli.`
- **ar** العربية: `أرسل Beuk رمزًا من 6 أرقام إلى {email}. يعمل الرمز لمدة {minutes} دقيقة.`
- **hi** हिन्दी: `Beuk ने {email} पर 6 अंकों का कोड भेजा है। यह {minutes} मिनट तक काम करेगा।`
- **mr** मराठी: `Beuk ने {email} वर 6 अंकी कोड पाठवला आहे. तो {minutes} मिनिटे चालेल.`
- **ja** 日本語: `Beukが{email}に6桁のコードを送信しました。コードは{minutes}分間有効です。`
- **zh-Hans** 简体中文: `Beuk 已向 {email} 发送了一个 6 位数验证码，{minutes} 分钟内有效。`

### `arc.code.sentAny`

- **en** (source, Claude's): Beuk sent a 6-digit code to the address you gave. It works for {minutes} minutes.
- **es** Español: `Beuk ha enviado un código de 6 dígitos a la dirección que diste. Sirve durante {minutes} minutos.`
- **fr** Français: `Beuk a envoyé un code à 6 chiffres à l'adresse que vous avez indiquée. Il est valable {minutes} minutes.`
- **de** Deutsch: `Beuk hat einen 6-stelligen Code an die angegebene Adresse gesendet. Er gilt {minutes} Minuten.`
- **it** Italiano: `Beuk ha inviato un codice di 6 cifre all'indirizzo che hai indicato. Vale per {minutes} minuti.`
- **pt** Português: `O Beuk enviou um código de 6 dígitos para o endereço que indicou. É válido durante {minutes} minutos.`
- **nl** Nederlands: `Beuk heeft een code van 6 cijfers naar het opgegeven adres gestuurd. Hij werkt {minutes} minuten.`
- **pl** Polski: `Beuk wysłał 6-cyfrowy kod na podany adres. Jest ważny przez {minutes} min.`
- **ru** Русский: `Beuk отправил 6-значный код на указанный адрес. Он действует {minutes} мин.`
- **tr** Türkçe: `Beuk, verdiğiniz adrese 6 haneli bir kod gönderdi. Kod {minutes} dakika geçerli.`
- **ar** العربية: `أرسل Beuk رمزًا من 6 أرقام إلى العنوان الذي أدخلته. يعمل الرمز لمدة {minutes} دقيقة.`
- **hi** हिन्दी: `Beuk ने आपके दिए पते पर 6 अंकों का कोड भेजा है। यह {minutes} मिनट तक काम करेगा।`
- **mr** मराठी: `Beuk ने तुम्ही दिलेल्या पत्त्यावर 6 अंकी कोड पाठवला आहे. तो {minutes} मिनिटे चालेल.`
- **ja** 日本語: `Beukが入力されたアドレスに6桁のコードを送信しました。コードは{minutes}分間有効です。`
- **zh-Hans** 简体中文: `Beuk 已向你填写的地址发送了一个 6 位数验证码，{minutes} 分钟内有效。`

### `arc.code.label`

- **en** (source, Claude's): Your code
- **es** Español: `Tu código`
- **fr** Français: `Votre code`
- **de** Deutsch: `Ihr Code`
- **it** Italiano: `Il tuo codice`
- **pt** Português: `O seu código`
- **nl** Nederlands: `Uw code`
- **pl** Polski: `Twój kod`
- **ru** Русский: `Ваш код`
- **tr** Türkçe: `Kodunuz`
- **ar** العربية: `رمزك`
- **hi** हिन्दी: `आपका कोड`
- **mr** मराठी: `तुमचा कोड`
- **ja** 日本語: `確認コード`
- **zh-Hans** 简体中文: `验证码`

### `arc.code.submit`

- **en** (source, Claude's): Confirm
- **es** Español: `Confirmar`
- **fr** Français: `Confirmer`
- **de** Deutsch: `Bestätigen`
- **it** Italiano: `Conferma`
- **pt** Português: `Confirmar`
- **nl** Nederlands: `Bevestigen`
- **pl** Polski: `Potwierdź`
- **ru** Русский: `Подтвердить`
- **tr** Türkçe: `Onayla`
- **ar** العربية: `تأكيد`
- **hi** हिन्दी: `पक्का करें`
- **mr** मराठी: `निश्चित करा`
- **ja** 日本語: `確認する`
- **zh-Hans** 简体中文: `确认`

### `arc.code.again`

- **en** (source, Claude's): Ask for a new code
- **es** Español: `Pedir un código nuevo`
- **fr** Français: `Demander un nouveau code`
- **de** Deutsch: `Neuen Code anfordern`
- **it** Italiano: `Chiedi un nuovo codice`
- **pt** Português: `Pedir um novo código`
- **nl** Nederlands: `Een nieuwe code aanvragen`
- **pl** Polski: `Poproś o nowy kod`
- **ru** Русский: `Запросить новый код`
- **tr** Türkçe: `Yeni kod iste`
- **ar** العربية: `اطلب رمزًا جديدًا`
- **hi** हिन्दी: `नया कोड माँगें`
- **mr** मराठी: `नवीन कोड मागवा`
- **ja** 日本語: `新しいコードを申請する`
- **zh-Hans** 简体中文: `重新获取验证码`

### `arc.code.err.wrong`

- **en** (source, Claude's): That code doesn't match. Please check it and try again.
- **es** Español: `Ese código no coincide. Revísalo y vuelve a intentarlo.`
- **fr** Français: `Ce code ne correspond pas. Vérifiez-le et réessayez.`
- **de** Deutsch: `Dieser Code stimmt nicht. Bitte prüfen Sie ihn und versuchen Sie es erneut.`
- **it** Italiano: `Questo codice non corrisponde. Controllalo e riprova.`
- **pt** Português: `Esse código não corresponde. Verifique-o e tente novamente.`
- **nl** Nederlands: `Die code klopt niet. Controleer hem en probeer het opnieuw.`
- **pl** Polski: `Ten kod się nie zgadza. Sprawdź go i spróbuj ponownie.`
- **ru** Русский: `Код не подходит. Проверьте его и попробуйте снова.`
- **tr** Türkçe: `Bu kod eşleşmiyor. Lütfen kontrol edip tekrar deneyin.`
- **ar** العربية: `هذا الرمز غير مطابق. تحقّق منه وحاول مرة أخرى.`
- **hi** हिन्दी: `यह कोड मेल नहीं खाता। कृपया जाँचकर फिर कोशिश करें।`
- **mr** मराठी: `हा कोड जुळत नाही. कृपया तपासून पुन्हा प्रयत्न करा.`
- **ja** 日本語: `コードが一致しません。確認して、もう一度お試しください。`
- **zh-Hans** 简体中文: `验证码不正确。请检查后重试。`

### `arc.code.err.expired`

- **en** (source, Claude's): This code has run out, or was tried too many times. Ask for a new one.
- **es** Español: `Este código ha caducado o se ha probado demasiadas veces. Pide uno nuevo.`
- **fr** Français: `Ce code a expiré, ou a été essayé trop de fois. Demandez-en un nouveau.`
- **de** Deutsch: `Dieser Code ist abgelaufen oder wurde zu oft versucht. Fordern Sie einen neuen an.`
- **it** Italiano: `Questo codice è scaduto, o è stato provato troppe volte. Chiedine uno nuovo.`
- **pt** Português: `Este código expirou ou foi tentado vezes demais. Peça um novo.`
- **nl** Nederlands: `Deze code is verlopen of te vaak geprobeerd. Vraag een nieuwe aan.`
- **pl** Polski: `Ten kod wygasł albo był wpisywany zbyt wiele razy. Poproś o nowy.`
- **ru** Русский: `Срок действия кода истёк, или его вводили слишком много раз. Запросите новый.`
- **tr** Türkçe: `Bu kodun süresi doldu ya da çok fazla denendi. Yeni bir kod isteyin.`
- **ar** العربية: `انتهت صلاحية هذا الرمز، أو جُرّب مرات كثيرة جدًا. اطلب رمزًا جديدًا.`
- **hi** हिन्दी: `इस कोड का समय खत्म हो गया, या इसे बहुत बार आज़माया गया। नया कोड माँगें।`
- **mr** मराठी: `या कोडची मुदत संपली आहे, किंवा तो खूप वेळा वापरून पाहिला गेला. नवीन कोड मागवा.`
- **ja** 日本語: `このコードは有効期限が切れたか、試行回数が多すぎました。新しいコードを申請してください。`
- **zh-Hans** 简体中文: `这个验证码已过期，或尝试次数过多。请重新获取。`

### `arc.code.err.unknown`

- **en** (source, Claude's): This code is no longer valid. Ask for a new one.
- **es** Español: `Este código ya no es válido. Pide uno nuevo.`
- **fr** Français: `Ce code n'est plus valable. Demandez-en un nouveau.`
- **de** Deutsch: `Dieser Code ist nicht mehr gültig. Fordern Sie einen neuen an.`
- **it** Italiano: `Questo codice non è più valido. Chiedine uno nuovo.`
- **pt** Português: `Este código já não é válido. Peça um novo.`
- **nl** Nederlands: `Deze code is niet meer geldig. Vraag een nieuwe aan.`
- **pl** Polski: `Ten kod nie jest już ważny. Poproś o nowy.`
- **ru** Русский: `Этот код больше не действует. Запросите новый.`
- **tr** Türkçe: `Bu kod artık geçerli değil. Yeni bir kod isteyin.`
- **ar** العربية: `لم يعد هذا الرمز صالحًا. اطلب رمزًا جديدًا.`
- **hi** हिन्दी: `यह कोड अब मान्य नहीं है। नया कोड माँगें।`
- **mr** मराठी: `हा कोड आता वैध नाही. नवीन कोड मागवा.`
- **ja** 日本語: `このコードは無効になりました。新しいコードを申請してください。`
- **zh-Hans** 简体中文: `这个验证码已失效。请重新获取。`

### `arc.wait.title`

- **en** (source, Claude's): Your request is with {author}
- **es** Español: `Tu solicitud está en manos de {author}`
- **fr** Français: `Votre demande est transmise à {author}`
- **de** Deutsch: `Ihre Anfrage liegt bei {author}`
- **it** Italiano: `La tua richiesta è nelle mani di {author}`
- **pt** Português: `O seu pedido está com {author}`
- **nl** Nederlands: `Uw aanvraag ligt bij {author}`
- **pl** Polski: `Twoja prośba czeka, aż odpowie {author}`
- **ru** Русский: `{author}: ваша заявка на рассмотрении`
- **tr** Türkçe: `İsteğiniz yanıt bekliyor: {author}`
- **ar** العربية: `طلبك الآن لدى {author}`
- **hi** हिन्दी: `आपका अनुरोध {author} के पास है`
- **mr** मराठी: `तुमची विनंती {author} यांच्याकडे आहे`
- **ja** 日本語: `お申し込みは{author}が確認中です`
- **zh-Hans** 简体中文: `你的申请正在等待 {author} 处理`

### `arc.wait.lead`

- **en** (source, Claude's): Thank you, {name}. Your address is confirmed.
- **es** Español: `Gracias, {name}. Tu dirección está confirmada.`
- **fr** Français: `Merci, {name}. Votre adresse est confirmée.`
- **de** Deutsch: `Danke, {name}. Ihre Adresse ist bestätigt.`
- **it** Italiano: `Grazie, {name}. Il tuo indirizzo è confermato.`
- **pt** Português: `Obrigado, {name}. O seu endereço está confirmado.`
- **nl** Nederlands: `Bedankt, {name}. Uw adres is bevestigd.`
- **pl** Polski: `Dziękujemy, {name}. Twój adres jest potwierdzony.`
- **ru** Русский: `Спасибо, {name}. Ваш адрес подтверждён.`
- **tr** Türkçe: `Teşekkürler, {name}. Adresiniz doğrulandı.`
- **ar** العربية: `شكرًا، {name}. تم تأكيد عنوانك.`
- **hi** हिन्दी: `धन्यवाद, {name}। आपका पता पक्का हो गया है।`
- **mr** मराठी: `धन्यवाद, {name}. तुमचा पत्ता निश्चित झाला आहे.`
- **ja** 日本語: `{name}さん、ありがとうございます。アドレスの確認が完了しました。`
- **zh-Hans** 简体中文: `谢谢你，{name}。你的邮箱地址已确认。`

### `arc.wait.body`

- **en** (source, Claude's): {author} looks at each request. You will get one more email when they decide.
- **es** Español: `{author} revisa cada solicitud. Recibirás un correo más cuando haya una decisión.`
- **fr** Français: `{author} examine chaque demande. Vous recevrez un e-mail de plus une fois la décision prise.`
- **de** Deutsch: `Jede Anfrage wird von {author} geprüft. Sie erhalten noch eine E-Mail, sobald die Entscheidung gefallen ist.`
- **it** Italiano: `{author} esamina ogni richiesta. Riceverai un'altra email quando ci sarà una decisione.`
- **pt** Português: `{author} analisa cada pedido. Receberá mais um e-mail quando houver uma decisão.`
- **nl** Nederlands: `{author} bekijkt elke aanvraag. U krijgt nog één e-mail zodra er een besluit is.`
- **pl** Polski: `{author} przegląda każdą prośbę. Gdy zapadnie decyzja, dostaniesz jeszcze jeden e-mail.`
- **ru** Русский: `{author} рассматривает каждую заявку. Когда решение будет принято, вы получите ещё одно письмо.`
- **tr** Türkçe: `{author} her isteği inceler. Karar verildiğinde bir e-posta daha alacaksınız.`
- **ar** العربية: `تُراجَع الطلبات واحدًا واحدًا لدى {author}. ستصلك رسالة أخرى عند اتخاذ القرار.`
- **hi** हिन्दी: `हर अनुरोध पर फ़ैसला {author} का होता है। फ़ैसला होने पर आपको एक और ईमेल मिलेगा।`
- **mr** मराठी: `{author} प्रत्येक विनंती पाहतात. त्यांनी निर्णय घेतल्यावर तुम्हाला आणखी एक ईमेल येईल.`
- **ja** 日本語: `{author}がお申し込みを一件ずつ確認します。結果が決まりしだい、もう一通メールをお送りします。`
- **zh-Hans** 简体中文: `{author} 会逐一查看每份申请。有结果时，你会再收到一封邮件。`

### `arc.copy.title`

- **en** (source, fixed by the plan/spec): {title} — your advance copy
- **es** Español: `{title} — tu ejemplar anticipado`
- **fr** Français: `{title} — votre exemplaire en avant-première`
- **de** Deutsch: `{title} — Ihr Vorab-Exemplar`
- **it** Italiano: `{title} — la tua copia in anteprima`
- **pt** Português: `{title} — o seu exemplar antecipado`
- **nl** Nederlands: `{title} — uw voorpublicatie-exemplaar`
- **pl** Polski: `„{title}” — Twój egzemplarz przedpremierowy`
- **ru** Русский: `«{title}» — ваш сигнальный экземпляр`
- **tr** Türkçe: `{title} — ön okuma kopyanız`
- **ar** العربية: `{title} — نسختك المسبقة`
- **hi** हिन्दी: `{title} — आपकी रिलीज़ से पहले की प्रति`
- **mr** मराठी: `{title} — तुमची प्रकाशनापूर्वीची प्रत`
- **ja** 日本語: `『{title}』 — あなた専用の献本`
- **zh-Hans** 简体中文: `《{title}》——你的预发本`

### `arc.copy.for`

- **en** (source, fixed by the plan/spec): Prepared for {name}
- **es** Español: `Preparado para {name}`
- **fr** Français: `Préparé pour {name}`
- **de** Deutsch: `Erstellt für {name}`
- **it** Italiano: `Preparata per {name}`
- **pt** Português: `Preparado para {name}`
- **nl** Nederlands: `Gemaakt voor {name}`
- **pl** Polski: `Przygotowany dla: {name}`
- **ru** Русский: `Подготовлен для: {name}`
- **tr** Türkçe: `Hazırlandığı kişi: {name}`
- **ar** العربية: `أُعدّت من أجل {name}`
- **hi** हिन्दी: `{name} के लिए तैयार की गई`
- **mr** मराठी: `{name} यांच्यासाठी तयार केलेली`
- **ja** 日本語: `{name}さん用に作成`
- **zh-Hans** 简体中文: `为 {name} 准备`

### `arc.copy.download`

- **en** (source, fixed by the plan/spec): Download EPUB
- **es** Español: `Descargar EPUB`
- **fr** Français: `Télécharger l'EPUB`
- **de** Deutsch: `EPUB herunterladen`
- **it** Italiano: `Scarica l'EPUB`
- **pt** Português: `Transferir EPUB`
- **nl** Nederlands: `EPUB downloaden`
- **pl** Polski: `Pobierz EPUB`
- **ru** Русский: `Скачать EPUB`
- **tr** Türkçe: `EPUB'u indir`
- **ar** العربية: `تنزيل EPUB`
- **hi** हिन्दी: `EPUB डाउनलोड करें`
- **mr** मराठी: `EPUB डाउनलोड करा`
- **ja** 日本語: `EPUBをダウンロード`
- **zh-Hans** 简体中文: `下载 EPUB`

### `arc.copy.read`

- **en** (source, fixed by the plan/spec): Read in your browser
- **es** Español: `Leer en el navegador`
- **fr** Français: `Lire dans votre navigateur`
- **de** Deutsch: `Im Browser lesen`
- **it** Italiano: `Leggi nel browser`
- **pt** Português: `Ler no navegador`
- **nl** Nederlands: `Lezen in uw browser`
- **pl** Polski: `Czytaj w przeglądarce`
- **ru** Русский: `Читать в браузере`
- **tr** Türkçe: `Tarayıcıda oku`
- **ar** العربية: `اقرأ في المتصفح`
- **hi** हिन्दी: `ब्राउज़र में पढ़ें`
- **mr** मराठी: `ब्राउझरमध्ये वाचा`
- **ja** 日本語: `ブラウザで読む`
- **zh-Hans** 简体中文: `在浏览器中阅读`

### `arc.copy.stampNote`

- **en** (source, Claude's): Your copy shows your name and email on its copyright page.
- **es** Español: `Tu ejemplar muestra tu nombre y tu correo en la página de derechos de autor.`
- **fr** Français: `Votre exemplaire porte votre nom et votre adresse e-mail sur sa page de copyright.`
- **de** Deutsch: `Ihr Exemplar zeigt Ihren Namen und Ihre E-Mail-Adresse auf der Copyright-Seite.`
- **it** Italiano: `La tua copia mostra il tuo nome e la tua email nella pagina del copyright.`
- **pt** Português: `O seu exemplar mostra o seu nome e o seu e-mail na página de direitos de autor.`
- **nl** Nederlands: `Uw exemplaar toont uw naam en e-mailadres op de copyrightpagina.`
- **pl** Polski: `Twój egzemplarz pokazuje Twoje imię i adres e-mail na stronie z prawami autorskimi.`
- **ru** Русский: `В вашем экземпляре на странице с авторскими правами указаны ваше имя и адрес почты.`
- **tr** Türkçe: `Kopyanızın telif hakkı sayfasında adınız ve e-posta adresiniz yer alır.`
- **ar** العربية: `تُظهر نسختك اسمك وبريدك الإلكتروني في صفحة حقوق النشر.`
- **hi** हिन्दी: `आपकी प्रति के कॉपीराइट पेज पर आपका नाम और ईमेल दिखता है।`
- **mr** मराठी: `तुमच्या प्रतीच्या कॉपीराइट पानावर तुमचे नाव आणि ईमेल दिसते.`
- **ja** 日本語: `献本の著作権ページには、お名前とメールアドレスが入っています。`
- **zh-Hans** 简体中文: `你的这一份在版权页上印有你的姓名和邮箱。`

### `arc.copy.keep`

- **en** (source, fixed by the plan/spec): Keep this page: it's your link to your copy.
- **es** Español: `Guarda esta página: es tu enlace a tu ejemplar.`
- **fr** Français: `Gardez cette page : c'est votre lien vers votre exemplaire.`
- **de** Deutsch: `Bewahren Sie diese Seite auf: Sie ist Ihr Link zu Ihrem Exemplar.`
- **it** Italiano: `Conserva questa pagina: è il tuo link alla tua copia.`
- **pt** Português: `Guarde esta página: é o seu link para o seu exemplar.`
- **nl** Nederlands: `Bewaar deze pagina: het is uw link naar uw exemplaar.`
- **pl** Polski: `Zachowaj tę stronę: to Twój link do Twojego egzemplarza.`
- **ru** Русский: `Сохраните эту страницу: это ваша ссылка на ваш экземпляр.`
- **tr** Türkçe: `Bu sayfayı saklayın: kopyanıza giden bağlantınız bu.`
- **ar** العربية: `احتفظ بهذه الصفحة: إنها رابطك إلى نسختك.`
- **hi** हिन्दी: `इस पेज को सँभालकर रखें: यही आपकी प्रति तक पहुँचने का लिंक है।`
- **mr** मराठी: `हे पान जपून ठेवा: तुमच्या प्रतीपर्यंत पोहोचण्याची तुमची लिंक हीच आहे.`
- **ja** 日本語: `このページを保存しておいてください。献本へのリンクはここです。`
- **zh-Hans** 简体中文: `请保存这个页面：它是你获取这本书的链接。`

### `arc.copy.goneTitle`

- **en** (source, Claude's): This copy is closed
- **es** Español: `Este ejemplar está cerrado`
- **fr** Français: `Cet exemplaire est fermé`
- **de** Deutsch: `Dieses Exemplar ist geschlossen`
- **it** Italiano: `Questa copia è chiusa`
- **pt** Português: `Este exemplar está fechado`
- **nl** Nederlands: `Dit exemplaar is gesloten`
- **pl** Polski: `Ten egzemplarz jest zamknięty`
- **ru** Русский: `Этот экземпляр закрыт`
- **tr** Türkçe: `Bu kopya kapatıldı`
- **ar** العربية: `هذه النسخة مغلقة`
- **hi** हिन्दी: `यह प्रति बंद है`
- **mr** मराठी: `ही प्रत बंद आहे`
- **ja** 日本語: `この献本は閉じられました`
- **zh-Hans** 简体中文: `这一份已关闭`

### `arc.copy.gone`

- **en** (source, Claude's): This advance copy is no longer available.
- **es** Español: `Este ejemplar anticipado ya no está disponible.`
- **fr** Français: `Cet exemplaire en avant-première n'est plus disponible.`
- **de** Deutsch: `Dieses Vorab-Exemplar ist nicht mehr verfügbar.`
- **it** Italiano: `Questa copia in anteprima non è più disponibile.`
- **pt** Português: `Este exemplar antecipado já não está disponível.`
- **nl** Nederlands: `Dit voorpublicatie-exemplaar is niet meer beschikbaar.`
- **pl** Polski: `Ten egzemplarz przedpremierowy nie jest już dostępny.`
- **ru** Русский: `Этот сигнальный экземпляр больше недоступен.`
- **tr** Türkçe: `Bu ön okuma kopyası artık kullanılamıyor.`
- **ar** العربية: `لم تعد هذه النسخة المسبقة متاحة.`
- **hi** हिन्दी: `यह रिलीज़ से पहले की प्रति अब उपलब्ध नहीं है।`
- **mr** मराठी: `ही प्रकाशनापूर्वीची प्रत आता उपलब्ध नाही.`
- **ja** 日本語: `この献本は利用できなくなりました。`
- **zh-Hans** 简体中文: `这本预发本已无法获取。`

### `arc.copy.err.limit`

- **en** (source, Claude's): This copy has been downloaded many times in the last hour. Please try again later.
- **es** Español: `Este ejemplar se ha descargado muchas veces en la última hora. Vuelve a intentarlo más tarde.`
- **fr** Français: `Cet exemplaire a été téléchargé de nombreuses fois au cours de la dernière heure. Veuillez réessayer plus tard.`
- **de** Deutsch: `Dieses Exemplar wurde in der letzten Stunde sehr oft heruntergeladen. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Questa copia è stata scaricata molte volte nell'ultima ora. Riprova più tardi.`
- **pt** Português: `Este exemplar foi transferido muitas vezes na última hora. Tente novamente mais tarde.`
- **nl** Nederlands: `Dit exemplaar is het afgelopen uur heel vaak gedownload. Probeer het later opnieuw.`
- **pl** Polski: `Ten egzemplarz był pobierany wiele razy w ciągu ostatniej godziny. Spróbuj ponownie później.`
- **ru** Русский: `За последний час этот экземпляр скачивали много раз. Попробуйте позже.`
- **tr** Türkçe: `Bu kopya son bir saatte çok kez indirildi. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `نُزّلت هذه النسخة مرات كثيرة خلال الساعة الماضية. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `पिछले एक घंटे में यह प्रति कई बार डाउनलोड हुई है। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `गेल्या एका तासात ही प्रत अनेक वेळा डाउनलोड झाली आहे. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `この献本は直近1時間にたくさんダウンロードされました。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `这一份在过去一小时内已被下载很多次。请稍后再试。`

### `arc.copy.err.busy`

- **en** (source, Claude's): Your copy is already being prepared. Please wait a few seconds, then try again.
- **es** Español: `Tu ejemplar ya se está preparando. Espera unos segundos y vuelve a intentarlo.`
- **fr** Français: `Votre exemplaire est déjà en cours de préparation. Patientez quelques secondes, puis réessayez.`
- **de** Deutsch: `Ihr Exemplar wird bereits vorbereitet. Bitte warten Sie ein paar Sekunden und versuchen Sie es dann erneut.`
- **it** Italiano: `La tua copia è già in preparazione. Aspetta qualche secondo, poi riprova.`
- **pt** Português: `O seu exemplar já está a ser preparado. Aguarde alguns segundos e tente novamente.`
- **nl** Nederlands: `Uw exemplaar wordt al klaargemaakt. Wacht een paar seconden en probeer het dan opnieuw.`
- **pl** Polski: `Twój egzemplarz jest już przygotowywany. Odczekaj kilka sekund i spróbuj ponownie.`
- **ru** Русский: `Ваш экземпляр уже готовится. Подождите несколько секунд и попробуйте снова.`
- **tr** Türkçe: `Kopyanız zaten hazırlanıyor. Lütfen birkaç saniye bekleyip tekrar deneyin.`
- **ar** العربية: `نسختك قيد التحضير بالفعل. انتظر بضع ثوانٍ ثم حاول مرة أخرى.`
- **hi** हिन्दी: `आपकी प्रति पहले से तैयार हो रही है। कृपया कुछ सेकंड रुकें, फिर कोशिश करें।`
- **mr** मराठी: `तुमची प्रत आधीच तयार होत आहे. कृपया काही सेकंद थांबा, मग पुन्हा प्रयत्न करा.`
- **ja** 日本語: `献本はすでに準備中です。数秒待ってから、もう一度お試しください。`
- **zh-Hans** 简体中文: `你的预发本正在准备中。请等几秒再试。`

### `arc.copy.err.serverBusy`

- **en** (source, Claude's): Beuk is busy preparing other copies. Please try again in a minute.
- **es** Español: `Beuk está ocupado preparando otros ejemplares. Vuelve a intentarlo dentro de un minuto.`
- **fr** Français: `Beuk est occupé à préparer d'autres exemplaires. Veuillez réessayer dans une minute.`
- **de** Deutsch: `Beuk bereitet gerade andere Exemplare vor. Bitte versuchen Sie es in einer Minute noch einmal.`
- **it** Italiano: `Beuk è impegnato a preparare altre copie. Riprova tra un minuto.`
- **pt** Português: `O Beuk está ocupado a preparar outros exemplares. Tente novamente daqui a um minuto.`
- **nl** Nederlands: `Beuk is bezig andere exemplaren klaar te maken. Probeer het over een minuut opnieuw.`
- **pl** Polski: `Beuk przygotowuje teraz inne egzemplarze. Spróbuj ponownie za minutę.`
- **ru** Русский: `Beuk занят подготовкой других экземпляров. Попробуйте через минуту.`
- **tr** Türkçe: `Beuk başka kopyaları hazırlamakla meşgul. Lütfen bir dakika sonra tekrar deneyin.`
- **ar** العربية: `Beuk مشغول بتحضير نسخ أخرى. حاول مرة أخرى بعد دقيقة.`
- **hi** हिन्दी: `Beuk अभी दूसरी प्रतियाँ तैयार करने में लगा है। कृपया एक मिनट बाद फिर कोशिश करें।`
- **mr** मराठी: `Beuk सध्या इतर प्रती तयार करण्यात व्यस्त आहे. कृपया एका मिनिटाने पुन्हा प्रयत्न करा.`
- **ja** 日本語: `Beukはほかの献本を準備中です。1分ほどしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `Beuk 正忙着准备其他读者的预发本。请一分钟后再试。`

### `arc.copy.err.failed`

- **en** (source, Claude's): Beuk couldn't prepare your copy just now. Please try again later.
- **es** Español: `Beuk no ha podido preparar tu ejemplar ahora mismo. Vuelve a intentarlo más tarde.`
- **fr** Français: `Beuk n'a pas pu préparer votre exemplaire pour le moment. Veuillez réessayer plus tard.`
- **de** Deutsch: `Beuk konnte Ihr Exemplar gerade nicht vorbereiten. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Beuk non è riuscito a preparare la tua copia in questo momento. Riprova più tardi.`
- **pt** Português: `O Beuk não conseguiu preparar o seu exemplar neste momento. Tente novamente mais tarde.`
- **nl** Nederlands: `Beuk kon uw exemplaar nu niet klaarmaken. Probeer het later opnieuw.`
- **pl** Polski: `Beuk nie mógł teraz przygotować Twojego egzemplarza. Spróbuj ponownie później.`
- **ru** Русский: `Beuk не удалось подготовить ваш экземпляр. Попробуйте позже.`
- **tr** Türkçe: `Beuk kopyanızı şu anda hazırlayamadı. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `تعذّر على Beuk تحضير نسختك الآن. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `Beuk अभी आपकी प्रति तैयार नहीं कर पाया। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `Beuk ला आत्ता तुमची प्रत तयार करता आली नाही. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `Beukはいま献本を準備できませんでした。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `Beuk 刚才没能准备好你的预发本。请稍后再试。`

### `arc.notMe.title`

- **en** (source, Claude's): Not you?
- **es** Español: `¿No eres tú?`
- **fr** Français: `Ce n'est pas vous ?`
- **de** Deutsch: `Nicht Sie?`
- **it** Italiano: `Non sei tu?`
- **pt** Português: `Não foi você?`
- **nl** Nederlands: `Bent u dit niet?`
- **pl** Polski: `To nie Ty?`
- **ru** Русский: `Это не вы?`
- **tr** Türkçe: `Siz değil misiniz?`
- **ar** العربية: `لست أنت؟`
- **hi** हिन्दी: `आपने नहीं माँगी थी?`
- **mr** मराठी: `तुम्ही मागितली नव्हती?`
- **ja** 日本語: `お心当たりがありませんか？`
- **zh-Hans** 简体中文: `不是你本人？`

### `arc.notMe.body`

- **en** (source, V's intent, verbatim): If you didn't ask for a copy of {title}, press the button. Beuk deletes your name and email from this book, closes this copy, and won't send this address mail from any author on Beuk again.
- **es** Español: `Si no pediste un ejemplar de {title}, pulsa el botón. Beuk borra tu nombre y tu correo de este libro, cierra este ejemplar y no volverá a enviar correo a esta dirección de parte de ningún autor de Beuk.`
- **fr** Français: `Si vous n'avez pas demandé d'exemplaire de {title}, appuyez sur le bouton. Beuk supprime votre nom et votre adresse e-mail de ce livre, ferme cet exemplaire et n'enverra plus d'e-mail à cette adresse de la part d'aucun auteur sur Beuk.`
- **de** Deutsch: `Wenn Sie kein Exemplar von {title} angefragt haben, drücken Sie auf die Schaltfläche. Beuk löscht Ihren Namen und Ihre E-Mail-Adresse aus diesem Buch, schließt dieses Exemplar und sendet an diese Adresse nie wieder E-Mails, egal von welchem Autor auf Beuk.`
- **it** Italiano: `Se non hai chiesto una copia di {title}, premi il pulsante. Beuk cancella il tuo nome e la tua email da questo libro, chiude questa copia e non invierà mai più email a questo indirizzo da parte di nessun autore su Beuk.`
- **pt** Português: `Se não pediu um exemplar de {title}, carregue no botão. O Beuk apaga o seu nome e o seu e-mail deste livro, fecha este exemplar e não voltará a enviar e-mails para este endereço da parte de nenhum autor no Beuk.`
- **nl** Nederlands: `Hebt u geen exemplaar van {title} aangevraagd? Druk dan op de knop. Beuk verwijdert uw naam en e-mailadres uit dit boek, sluit dit exemplaar en stuurt dit adres nooit meer e-mail namens welke auteur op Beuk dan ook.`
- **pl** Polski: `Jeśli prośba o egzemplarz „{title}” nie pochodzi od Ciebie, naciśnij przycisk. Beuk usunie Twoje imię i adres e-mail z tej książki, zamknie ten egzemplarz i nie wyśle już na ten adres żadnej wiadomości od żadnego autora w Beuk.`
- **ru** Русский: `Если вы не запрашивали экземпляр книги «{title}», нажмите кнопку. Beuk удалит ваше имя и адрес почты из этой книги, закроет этот экземпляр и больше никогда не будет присылать на этот адрес письма ни от одного автора в Beuk.`
- **tr** Türkçe: `{title} için kopya istemediyseniz düğmeye basın. Beuk adınızı ve e-posta adresinizi bu kitaptan siler, bu kopyayı kapatır ve Beuk'teki hiçbir yazar adına bu adrese bir daha e-posta göndermez.`
- **ar** العربية: `إن لم تطلب نسخة من {title}، فاضغط الزر. يحذف Beuk اسمك وبريدك الإلكتروني من هذا الكتاب، ويغلق هذه النسخة، ولن يرسل إلى هذا العنوان بريدًا من أي مؤلف على Beuk بعد الآن.`
- **hi** हिन्दी: `अगर आपने {title} की प्रति नहीं माँगी थी, तो बटन दबाएँ। Beuk इस किताब से आपका नाम और ईमेल हटा देता है, यह प्रति बंद कर देता है, और Beuk पर किसी भी लेखक की ओर से इस पते पर फिर कभी ईमेल नहीं भेजेगा।`
- **mr** मराठी: `तुम्ही {title} ची प्रत मागितली नसेल, तर बटण दाबा. Beuk या पुस्तकातून तुमचे नाव आणि ईमेल हटवते, ही प्रत बंद करते, आणि Beuk वरील कोणत्याही लेखकाकडून या पत्त्यावर पुन्हा कधीही ईमेल पाठवणार नाही.`
- **ja** 日本語: `『{title}』の献本を申し込んだ覚えがない場合は、ボタンを押してください。Beukはこの本からお名前とメールアドレスを削除し、この献本を閉じ、今後Beukのどの著者からもこのアドレスにメールを送りません。`
- **zh-Hans** 简体中文: `如果你没有申请过《{title}》，请按下按钮。Beuk 会从这本书中删除你的名字和邮箱，关闭这一份，并且不会再代表 Beuk 上的任何作者向这个地址发送邮件。`

### `arc.notMe.button`

- **en** (source, Claude's): I didn't ask for a copy
- **es** Español: `Yo no pedí ningún ejemplar`
- **fr** Français: `Je n'ai pas demandé d'exemplaire`
- **de** Deutsch: `Ich habe kein Exemplar angefragt`
- **it** Italiano: `Non ho chiesto nessuna copia`
- **pt** Português: `Não pedi nenhum exemplar`
- **nl** Nederlands: `Ik heb geen exemplaar aangevraagd`
- **pl** Polski: `To nie moja prośba`
- **ru** Русский: `Это не моя заявка`
- **tr** Türkçe: `Kopya istemedim`
- **ar** العربية: `لم أطلب نسخة`
- **hi** हिन्दी: `मैंने प्रति नहीं माँगी थी`
- **mr** मराठी: `मी प्रत मागितली नव्हती`
- **ja** 日本語: `申し込んでいません`
- **zh-Hans** 简体中文: `我没有申请过`

### `arc.notMe.done`

- **en** (source, Claude's): Beuk deleted your name and email from {title}, closed this copy, and won't send this address mail from any author on Beuk again.
- **es** Español: `Beuk ha borrado tu nombre y tu correo de {title}, ha cerrado este ejemplar y no volverá a enviar correo a esta dirección de parte de ningún autor de Beuk.`
- **fr** Français: `Beuk a supprimé votre nom et votre adresse e-mail de {title}, a fermé cet exemplaire et n'enverra plus d'e-mail à cette adresse de la part d'aucun auteur sur Beuk.`
- **de** Deutsch: `Beuk hat Ihren Namen und Ihre E-Mail-Adresse aus {title} gelöscht, dieses Exemplar geschlossen und sendet an diese Adresse nie wieder E-Mails, egal von welchem Autor auf Beuk.`
- **it** Italiano: `Beuk ha cancellato il tuo nome e la tua email da {title}, ha chiuso questa copia e non invierà mai più email a questo indirizzo da parte di nessun autore su Beuk.`
- **pt** Português: `O Beuk apagou o seu nome e o seu e-mail de {title}, fechou este exemplar e não voltará a enviar e-mails para este endereço da parte de nenhum autor no Beuk.`
- **nl** Nederlands: `Beuk heeft uw naam en e-mailadres uit {title} verwijderd, dit exemplaar gesloten en stuurt dit adres nooit meer e-mail namens welke auteur op Beuk dan ook.`
- **pl** Polski: `Beuk usunął Twoje imię i adres e-mail z „{title}”, zamknął ten egzemplarz i nie wyśle już na ten adres żadnej wiadomości od żadnego autora w Beuk.`
- **ru** Русский: `Beuk удалил ваше имя и адрес почты из книги «{title}», закрыл этот экземпляр и больше никогда не будет присылать на этот адрес письма ни от одного автора в Beuk.`
- **tr** Türkçe: `Beuk adınızı ve e-posta adresinizi {title} kitabından sildi, bu kopyayı kapattı ve Beuk'teki hiçbir yazar adına bu adrese bir daha e-posta göndermeyecek.`
- **ar** العربية: `حذف Beuk اسمك وبريدك الإلكتروني من {title}، وأغلق هذه النسخة، ولن يرسل إلى هذا العنوان بريدًا من أي مؤلف على Beuk بعد الآن.`
- **hi** हिन्दी: `Beuk ने {title} से आपका नाम और ईमेल हटा दिया है, यह प्रति बंद कर दी है, और Beuk पर किसी भी लेखक की ओर से इस पते पर फिर कभी ईमेल नहीं भेजेगा।`
- **mr** मराठी: `Beuk ने {title} मधून तुमचे नाव आणि ईमेल हटवले, ही प्रत बंद केली, आणि Beuk वरील कोणत्याही लेखकाकडून या पत्त्यावर पुन्हा कधीही ईमेल पाठवणार नाही.`
- **ja** 日本語: `Beukは『{title}』からお名前とメールアドレスを削除し、この献本を閉じました。今後Beukのどの著者からもこのアドレスにメールを送ることはありません。`
- **zh-Hans** 简体中文: `Beuk 已从《{title}》中删除你的名字和邮箱，关闭了这一份，并且不会再代表 Beuk 上的任何作者向这个地址发送邮件。`

### `arc.notMe.backups`

- **en** (source, Claude's): Like anything Beuk deletes, they can remain in older backups. The block on this address is kept in the backups too.
- **es** Español: `Como todo lo que Beuk borra, pueden seguir en copias de seguridad anteriores. El bloqueo de esta dirección también se guarda en las copias de seguridad.`
- **fr** Français: `Comme tout ce que Beuk supprime, ils peuvent subsister dans d'anciennes sauvegardes. Le blocage de cette adresse est lui aussi conservé dans les sauvegardes.`
- **de** Deutsch: `Wie alles, was Beuk löscht, können sie in älteren Sicherungen erhalten bleiben. Die Sperre dieser Adresse wird ebenfalls in den Sicherungen aufbewahrt.`
- **it** Italiano: `Come tutto ciò che Beuk cancella, possono restare nei backup precedenti. Anche il blocco di questo indirizzo viene conservato nei backup.`
- **pt** Português: `Como tudo o que o Beuk apaga, podem continuar em cópias de segurança mais antigas. O bloqueio deste endereço também fica guardado nas cópias de segurança.`
- **nl** Nederlands: `Zoals alles wat Beuk verwijdert, kunnen ze in oudere back-ups blijven staan. De blokkade van dit adres wordt ook in de back-ups bewaard.`
- **pl** Polski: `Jak wszystko, co Beuk usuwa, mogą one pozostać w starszych kopiach zapasowych. Blokada tego adresu też jest przechowywana w kopiach zapasowych.`
- **ru** Русский: `Как и всё, что удаляет Beuk, эти данные могут оставаться в старых резервных копиях. Блокировка этого адреса тоже хранится в резервных копиях.`
- **tr** Türkçe: `Beuk'in sildiği her şey gibi, bunlar da eski yedeklerde kalabilir. Bu adres için konan engel de yedeklerde saklanır.`
- **ar** العربية: `مثل كل ما يحذفه Beuk، قد يبقيان في نسخ احتياطية أقدم. ويُحفظ حظر هذا العنوان في النسخ الاحتياطية أيضًا.`
- **hi** हिन्दी: `Beuk जो कुछ भी हटाता है, उसकी तरह ये भी पुराने बैकअप में रह सकते हैं। इस पते पर लगी रोक भी बैकअप में रखी जाती है।`
- **mr** मराठी: `Beuk हटवत असलेल्या प्रत्येक गोष्टीप्रमाणे, ही माहिती जुन्या बॅकअपमध्ये राहू शकते. या पत्त्यावरची बंदीही बॅकअपमध्ये ठेवली जाते.`
- **ja** 日本語: `Beukが削除するほかのデータと同じく、古いバックアップには残っている場合があります。このアドレスのブロックもバックアップに保存されます。`
- **zh-Hans** 简体中文: `和 Beuk 删除的其他内容一样，它们可能仍保留在较早的备份中。对这个地址的屏蔽也会保存在备份中。`

### `arc.stop.title`

- **en** (source, Claude's): No more email from {author}
- **es** Español: `No recibir más correos de {author}`
- **fr** Français: `Plus aucun e-mail envoyé par {author}`
- **de** Deutsch: `Keine E-Mails mehr von {author}`
- **it** Italiano: `Niente più email da {author}`
- **pt** Português: `Não receber mais e-mails de {author}`
- **nl** Nederlands: `Geen e-mail meer van {author}`
- **pl** Polski: `{author} — bez kolejnych e-maili`
- **ru** Русский: `Отписаться от писем ({author})`
- **tr** Türkçe: `E-postaları durdur: {author}`
- **ar** العربية: `إيقاف رسائل {author}`
- **hi** हिन्दी: `{author} की ओर से अब कोई ईमेल नहीं`
- **mr** मराठी: `{author} यांच्याकडून आणखी ईमेल नको`
- **ja** 日本語: `{author}からのメールを停止`
- **zh-Hans** 简体中文: `不再接收 {author} 的邮件`

### `arc.stop.body`

- **en** (source, V's intent, verbatim): Press the button and Beuk won't send you any more email about {author}'s books. Your copy keeps working.
- **es** Español: `Pulsa el botón y Beuk no te enviará más correos sobre los libros de {author}. Tu ejemplar sigue funcionando.`
- **fr** Français: `Appuyez sur le bouton et Beuk ne vous enverra plus d'e-mails au sujet des livres écrits par {author}. Votre exemplaire continue de fonctionner.`
- **de** Deutsch: `Drücken Sie auf die Schaltfläche, dann sendet Beuk Ihnen keine E-Mails mehr zu den Büchern von {author}. Ihr Exemplar funktioniert weiter.`
- **it** Italiano: `Premi il pulsante e Beuk non ti invierà più email sui libri di {author}. La tua copia continua a funzionare.`
- **pt** Português: `Carregue no botão e o Beuk não lhe vai enviar mais e-mails sobre os livros de {author}. O seu exemplar continua a funcionar.`
- **nl** Nederlands: `Druk op de knop en Beuk stuurt u geen e-mail meer over de boeken van {author}. Uw exemplaar blijft werken.`
- **pl** Polski: `Naciśnij przycisk, a Beuk nie wyśle Ci już e-maili o książkach, które pisze {author}. Twój egzemplarz nadal działa.`
- **ru** Русский: `Нажмите кнопку, и Beuk больше не будет присылать вам письма о книгах, которые пишет {author}. Ваш экземпляр продолжит работать.`
- **tr** Türkçe: `Düğmeye basın; Beuk size {author} tarafından yazılan kitaplar hakkında artık e-posta göndermez. Kopyanız çalışmaya devam eder.`
- **ar** العربية: `اضغط الزر ولن يرسل إليك Beuk أي بريد آخر عن كتب {author}. ستبقى نسختك تعمل.`
- **hi** हिन्दी: `बटन दबाएँ, तो Beuk आपको {author} की किताबों के बारे में अब कोई ईमेल नहीं भेजेगा। आपकी प्रति काम करती रहेगी।`
- **mr** मराठी: `बटण दाबा, म्हणजे Beuk तुम्हाला {author} यांच्या पुस्तकांबद्दल आणखी ईमेल पाठवणार नाही. तुमची प्रत चालू राहील.`
- **ja** 日本語: `ボタンを押すと、Beukは{author}の本に関するメールを今後お送りしません。献本はそのまま使えます。`
- **zh-Hans** 简体中文: `按下按钮后，Beuk 不会再给你发送关于 {author} 作品的邮件。你的预发本仍然可以使用。`

### `arc.stop.button`

- **en** (source, Claude's): Stop these emails
- **es** Español: `Dejar de recibir estos correos`
- **fr** Français: `Arrêter ces e-mails`
- **de** Deutsch: `Diese E-Mails beenden`
- **it** Italiano: `Interrompi queste email`
- **pt** Português: `Parar estes e-mails`
- **nl** Nederlands: `Deze e-mails stoppen`
- **pl** Polski: `Zatrzymaj te e-maile`
- **ru** Русский: `Больше не присылать эти письма`
- **tr** Türkçe: `Bu e-postaları durdur`
- **ar** العربية: `أوقف هذه الرسائل`
- **hi** हिन्दी: `ये ईमेल रोकें`
- **mr** मराठी: `हे ईमेल थांबवा`
- **ja** 日本語: `このメールを停止する`
- **zh-Hans** 简体中文: `停止这些邮件`

### `arc.stop.done`

- **en** (source, Claude's): Beuk won't send you any more email about {author}'s books.
- **es** Español: `Beuk no te enviará más correos sobre los libros de {author}.`
- **fr** Français: `Beuk ne vous enverra plus d'e-mails au sujet des livres écrits par {author}.`
- **de** Deutsch: `Beuk sendet Ihnen keine E-Mails mehr zu den Büchern von {author}.`
- **it** Italiano: `Beuk non ti invierà più email sui libri di {author}.`
- **pt** Português: `O Beuk não lhe vai enviar mais e-mails sobre os livros de {author}.`
- **nl** Nederlands: `Beuk stuurt u geen e-mail meer over de boeken van {author}.`
- **pl** Polski: `Beuk nie wyśle Ci już e-maili o książkach, które pisze {author}.`
- **ru** Русский: `Beuk больше не будет присылать вам письма о книгах, которые пишет {author}.`
- **tr** Türkçe: `Beuk size {author} tarafından yazılan kitaplar hakkında artık e-posta göndermeyecek.`
- **ar** العربية: `لن يرسل إليك Beuk أي بريد آخر عن كتب {author}.`
- **hi** हिन्दी: `Beuk अब आपको {author} की किताबों के बारे में कोई ईमेल नहीं भेजेगा।`
- **mr** मराठी: `Beuk तुम्हाला {author} यांच्या पुस्तकांबद्दल आणखी ईमेल पाठवणार नाही.`
- **ja** 日本語: `Beukは{author}の本に関するメールを今後お送りしません。`
- **zh-Hans** 简体中文: `Beuk 不会再给你发送关于 {author} 作品的邮件。`

### `arc.stop.doneCopy`

- **en** (source, Claude's — final fix wave): Your copy keeps working.
- **es** Español: `Tu ejemplar sigue funcionando.`
- **fr** Français: `Votre exemplaire continue de fonctionner.`
- **de** Deutsch: `Ihr Exemplar funktioniert weiter.`
- **it** Italiano: `La tua copia continua a funzionare.`
- **pt** Português: `O seu exemplar continua a funcionar.`
- **nl** Nederlands: `Uw exemplaar blijft werken.`
- **pl** Polski: `Twój egzemplarz nadal działa.`
- **ru** Русский: `Ваш экземпляр продолжит работать.`
- **tr** Türkçe: `Kopyanız çalışmaya devam eder.`
- **ar** العربية: `ستبقى نسختك تعمل.`
- **hi** हिन्दी: `आपकी प्रति काम करती रहेगी।`
- **mr** मराठी: `तुमची प्रत चालू राहील.`
- **ja** 日本語: `献本はそのまま使えます。`
- **zh-Hans** 简体中文: `你的预发本仍然可以使用。`

### `arc.mail.doneTitle`

- **en** (source, Claude's): Done
- **es** Español: `Hecho`
- **fr** Français: `C'est fait`
- **de** Deutsch: `Erledigt`
- **it** Italiano: `Fatto`
- **pt** Português: `Feito`
- **nl** Nederlands: `Klaar`
- **pl** Polski: `Gotowe`
- **ru** Русский: `Готово`
- **tr** Türkçe: `Tamam`
- **ar** العربية: `تم`
- **hi** हिन्दी: `हो गया`
- **mr** मराठी: `झाले`
- **ja** 日本語: `完了しました`
- **zh-Hans** 简体中文: `已完成`

### `arc.mail.unavailable`

- **en** (source, Claude's): Beuk can't do this right now, so nothing was changed. Please try again later.
- **es** Español: `Beuk no puede hacer esto ahora mismo, así que no se ha cambiado nada. Vuelve a intentarlo más tarde.`
- **fr** Français: `Beuk ne peut pas faire cela pour le moment : rien n'a donc été modifié. Veuillez réessayer plus tard.`
- **de** Deutsch: `Beuk kann das gerade nicht tun, daher wurde nichts geändert. Bitte versuchen Sie es später noch einmal.`
- **it** Italiano: `Beuk non può farlo in questo momento, quindi non è stato cambiato nulla. Riprova più tardi.`
- **pt** Português: `O Beuk não consegue fazer isto neste momento, por isso nada foi alterado. Tente novamente mais tarde.`
- **nl** Nederlands: `Beuk kan dit nu niet doen, dus er is niets veranderd. Probeer het later opnieuw.`
- **pl** Polski: `Beuk nie może teraz tego zrobić, więc nic nie zostało zmienione. Spróbuj ponownie później.`
- **ru** Русский: `Сейчас Beuk не может это сделать, поэтому ничего не изменилось. Попробуйте позже.`
- **tr** Türkçe: `Beuk bunu şu anda yapamıyor, bu yüzden hiçbir şey değişmedi. Lütfen daha sonra tekrar deneyin.`
- **ar** العربية: `لا يستطيع Beuk فعل ذلك الآن، لذا لم يتغيّر شيء. حاول مرة أخرى لاحقًا.`
- **hi** हिन्दी: `Beuk अभी यह नहीं कर सकता, इसलिए कुछ नहीं बदला गया। कृपया बाद में फिर कोशिश करें।`
- **mr** मराठी: `Beuk सध्या हे करू शकत नाही, त्यामुळे काहीही बदलले नाही. कृपया नंतर पुन्हा प्रयत्न करा.`
- **ja** 日本語: `Beukはいまこの操作を行えないため、何も変更されていません。しばらくしてからもう一度お試しください。`
- **zh-Hans** 简体中文: `Beuk 现在无法执行此操作，因此没有做任何更改。请稍后再试。`

### `arc.page.unknownTitle`

- **en** (source, Claude's): We couldn't find this page
- **es** Español: `No hemos encontrado esta página`
- **fr** Français: `Nous n'avons pas trouvé cette page`
- **de** Deutsch: `Wir konnten diese Seite nicht finden`
- **it** Italiano: `Non abbiamo trovato questa pagina`
- **pt** Português: `Não encontrámos esta página`
- **nl** Nederlands: `We konden deze pagina niet vinden`
- **pl** Polski: `Nie znaleźliśmy tej strony`
- **ru** Русский: `Мы не нашли эту страницу`
- **tr** Türkçe: `Bu sayfayı bulamadık`
- **ar** العربية: `لم نعثر على هذه الصفحة`
- **hi** हिन्दी: `हमें यह पेज नहीं मिला`
- **mr** मराठी: `आम्हाला हे पान सापडले नाही`
- **ja** 日本語: `このページが見つかりませんでした`
- **zh-Hans** 简体中文: `找不到这个页面`

### `arc.page.unknown`

- **en** (source, Claude's): The link may be incomplete. Check that it was copied in full.
- **es** Español: `Puede que el enlace esté incompleto. Comprueba que lo copiaste entero.`
- **fr** Français: `Le lien est peut-être incomplet. Vérifiez qu'il a été copié en entier.`
- **de** Deutsch: `Der Link ist vielleicht unvollständig. Prüfen Sie, ob er vollständig kopiert wurde.`
- **it** Italiano: `Il link potrebbe essere incompleto. Controlla di averlo copiato per intero.`
- **pt** Português: `O link pode estar incompleto. Verifique se foi copiado por inteiro.`
- **nl** Nederlands: `De link is misschien onvolledig. Controleer of hij volledig is gekopieerd.`
- **pl** Polski: `Link może być niepełny. Sprawdź, czy został skopiowany w całości.`
- **ru** Русский: `Возможно, ссылка неполная. Проверьте, что она скопирована целиком.`
- **tr** Türkçe: `Bağlantı eksik olabilir. Tamamen kopyalandığından emin olun.`
- **ar** العربية: `قد يكون الرابط ناقصًا. تحقّق من نسخه كاملًا.`
- **hi** हिन्दी: `हो सकता है लिंक अधूरा हो। देख लें कि वह पूरा कॉपी हुआ है।`
- **mr** मराठी: `लिंक अपूर्ण असू शकते. ती पूर्ण कॉपी झाली आहे का ते तपासा.`
- **ja** 日本語: `リンクが途中で切れている可能性があります。すべてコピーされているか確認してください。`
- **zh-Hans** 简体中文: `链接可能不完整。请检查是否已完整复制。`

### `arc.page.closedTitle`

- **en** (source, Claude's): Sign-ups have closed
- **es** Español: `Las inscripciones están cerradas`
- **fr** Français: `Les inscriptions sont closes`
- **de** Deutsch: `Die Anmeldung ist geschlossen`
- **it** Italiano: `Le iscrizioni sono chiuse`
- **pt** Português: `As inscrições estão fechadas`
- **nl** Nederlands: `De aanmelding is gesloten`
- **pl** Polski: `Zapisy są zamknięte`
- **ru** Русский: `Запись закрыта`
- **tr** Türkçe: `Kayıtlar kapandı`
- **ar** العربية: `أُغلق التسجيل`
- **hi** हिन्दी: `साइन अप बंद हो चुके हैं`
- **mr** मराठी: `नोंदणी बंद झाली आहे`
- **ja** 日本語: `申し込みは締め切りました`
- **zh-Hans** 简体中文: `报名已截止`

### `arc.page.closedRecover`

- **en** (source, Claude's — final fix wave): Already have a copy and lost its link? Enter the name and email you used, and Beuk will email you a code to open it again.
- **es** Español: `¿Ya tienes un ejemplar y perdiste su enlace? Escribe el nombre y el correo que usaste, y Beuk te enviará un código para volver a abrirlo.`
- **fr** Français: `Vous avez déjà un exemplaire et vous avez perdu son lien ? Saisissez le nom et l'adresse e-mail que vous aviez donnés, et Beuk vous enverra un code pour le rouvrir.`
- **de** Deutsch: `Sie haben schon ein Exemplar und den Link verloren? Geben Sie den Namen und die E-Mail-Adresse ein, die Sie verwendet haben, und Beuk schickt Ihnen einen Code, um es wieder zu öffnen.`
- **it** Italiano: `Hai già una copia e ne hai perso il link? Inserisci il nome e l'email che hai usato, e Beuk ti invierà un codice per riaprirla.`
- **pt** Português: `Já tem um exemplar e perdeu o link? Introduza o nome e o e-mail que usou, e o Beuk envia-lhe um código para o voltar a abrir.`
- **nl** Nederlands: `Hebt u al een exemplaar en bent u de link kwijt? Vul de naam en het e-mailadres in die u gebruikte, en Beuk stuurt u een code om het weer te openen.`
- **pl** Polski: `Masz już egzemplarz, ale nie masz już do niego linku? Wpisz imię i e-mail podane przy zapisie, a Beuk wyśle Ci kod, by znów go otworzyć.`
- **ru** Русский: `У вас уже есть экземпляр, но вы потеряли ссылку? Введите имя и адрес почты, которые вы указали, и Beuk пришлёт вам код, чтобы снова его открыть.`
- **tr** Türkçe: `Zaten bir kopyanız var ama bağlantısını mı kaybettiniz? Kullandığınız adı ve e-posta adresini girin; Beuk size kopyayı yeniden açmanız için bir kod gönderir.`
- **ar** العربية: `لديك نسخة وفقدت رابطها؟ أدخِل الاسم والبريد الإلكتروني اللذين استخدمتهما، وسيرسل إليك Beuk رمزًا لتفتحها من جديد.`
- **hi** हिन्दी: `क्या आपके पास पहले से प्रति है और उसका लिंक खो गया है? वही नाम और ईमेल डालें जो आपने दिए थे, और Beuk आपको उसे फिर से खोलने के लिए एक कोड ईमेल करेगा।`
- **mr** मराठी: `तुमच्याकडे आधीच प्रत आहे आणि तिची लिंक हरवली आहे? तुम्ही दिलेले नाव आणि ईमेल टाका, म्हणजे Beuk तुम्हाला ती पुन्हा उघडण्यासाठी एक कोड ईमेल करेल.`
- **ja** 日本語: `すでに献本をお持ちで、リンクをなくしましたか？ 申し込みに使ったお名前とメールアドレスを入力すると、献本を開き直すためのコードをBeukがメールでお送りします。`
- **zh-Hans** 简体中文: `已经有预发本，但找不到链接了？输入你报名时用的名字和邮箱，Beuk 会给你发一个验证码，让你重新打开它。`

### `arc.foot.privacy`

- **en** (source, Claude's): Privacy
- **es** Español: `Privacidad`
- **fr** Français: `Confidentialité`
- **de** Deutsch: `Datenschutz`
- **it** Italiano: `Privacy`
- **pt** Português: `Privacidade`
- **nl** Nederlands: `Privacy`
- **pl** Polski: `Prywatność`
- **ru** Русский: `Конфиденциальность`
- **tr** Türkçe: `Gizlilik`
- **ar** العربية: `الخصوصية`
- **hi** हिन्दी: `प्राइवेसी`
- **mr** मराठी: `गोपनीयता`
- **ja** 日本語: `プライバシー`
- **zh-Hans** 简体中文: `隐私`

### `arc.foot.terms`

- **en** (source, Claude's): Terms
- **es** Español: `Condiciones`
- **fr** Français: `Conditions`
- **de** Deutsch: `Nutzungsbedingungen`
- **it** Italiano: `Termini`
- **pt** Português: `Termos`
- **nl** Nederlands: `Voorwaarden`
- **pl** Polski: `Warunki`
- **ru** Русский: `Условия`
- **tr** Türkçe: `Koşullar`
- **ar** العربية: `الشروط`
- **hi** हिन्दी: `नियम और शर्तें`
- **mr** मराठी: `अटी`
- **ja** 日本語: `利用規約`
- **zh-Hans** 简体中文: `条款`
