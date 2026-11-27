# Interface strings waiting for V's sign-off

**None of this is approved.** Every translation below is a draft written by Claude: it is not approved, has not been reviewed by a native
speaker, and has not been signed off. V signs off every UI translation personally; until he does, each draft stays on this list.
English text is the source; it is the only column that is final wording.

Last updated 2026-11-27 (the keystroke rescue's two strings: section 6; Hindi and Marathi moved to section 7). Before that: 2026-11-24 ("Use on every chapter": section 5; Poem Mode: section 4; the export screen: section 3, the proof's link words); 2026-11-12 (studio 2.0 cutover, task 6).

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

## 7. Hindi and Marathi — two whole interface packs (3,012 keys each, 2026-11-26)

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
  against है, और, नहीं …); a writer can always pick the language by hand.
