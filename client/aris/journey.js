/* /aris — the journey's plate. A card face opens the one shared <dialog>:
   the art at its true 3:2 beside the copy, Esc / ✕ / backdrop to close.
   Without <dialog> support nothing breaks — the faces simply stay cards. */
(function () {
  'use strict';
  var plate = document.querySelector('.aris-plate');
  if (!plate || typeof plate.showModal !== 'function') return;
  var img = plate.querySelector('img');
  var kick = plate.querySelector('.aris-card-kicker');
  var title = plate.querySelector('.aris-plate-title');
  var body = plate.querySelector('.aris-plate-body');
  Array.prototype.forEach.call(document.querySelectorAll('.aris-card'), function (card) {
    var face = card.querySelector('.aris-card-face');
    var copy = card.querySelector('.aris-card-copy');
    if (!face || !copy) return;
    face.addEventListener('click', function () {
      img.src = face.querySelector('img').src;
      kick.textContent = face.querySelector('.aris-card-kicker').textContent;
      title.textContent = face.querySelector('.aris-card-title').textContent;
      body.innerHTML = copy.innerHTML;
      plate.showModal();
    });
  });
  plate.querySelector('.aris-plate-close').addEventListener('click', function () { plate.close(); });
  plate.addEventListener('click', function (e) { if (e.target === plate) plate.close(); });
})();
