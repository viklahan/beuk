# Interface strings waiting for V's sign-off

**None of this is approved.** Every translation below is a draft written by Claude: it is not approved, has not been reviewed by a native
speaker, and has not been signed off. V signs off every UI translation personally; until he does, each draft stays on this list.
English text is the source; it is the only column that is final wording.

Last updated 2026-11-12 (studio 2.0 cutover, task 6).

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
