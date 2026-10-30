/* Bowmarket: turn a book (or a set's books) all the way round on its own page.
   Drag with a mouse, finger or pen; or focus the stage and use the arrow keys
   (Home puts it back). On arrival the books make one slow turn, unless the
   reader prefers reduced motion. Without this script the books still stand,
   at an angle, and every word on the page is there. */
(function () {
  "use strict";
  var REST_Y = -32, REST_X = 4;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("[data-turn]").forEach(function (stage) {
    var row = stage.querySelector(".bk-row");
    if (!row) return;
    var ry = REST_Y, rx = REST_X, spin = 0, drag = null;
    var hint = stage.parentNode.querySelector(".bm-turn-hint");
    if (hint) hint.hidden = false;

    function show() {
      row.style.setProperty("--ry", ry + "deg");
      row.style.setProperty("--rx", rx + "deg");
    }
    function stopSpin() {
      if (spin) { cancelAnimationFrame(spin); spin = 0; row.classList.remove("is-spinning"); }
    }

    stage.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      stopSpin();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ry: ry, rx: rx };
      stage.classList.add("is-dragging");
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    });
    stage.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      ry = drag.ry + (e.clientX - drag.x) * 0.6;
      rx = Math.max(-35, Math.min(35, drag.rx - (e.clientY - drag.y) * 0.3));
      show();
    });
    function end(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      stage.classList.remove("is-dragging");
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);

    stage.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowLeft") ry -= 20;
      else if (k === "ArrowRight") ry += 20;
      else if (k === "ArrowUp") rx = Math.min(35, rx + 10);
      else if (k === "ArrowDown") rx = Math.max(-35, rx - 10);
      else if (k === "Home") { ry = REST_Y; rx = REST_X; }
      else return;
      e.preventDefault();
      stopSpin();
      show();
    });

    show();
    if (still) return;
    /* one slow turn on arrival, easing to rest; any touch or key takes over */
    var from = REST_Y - 360, t0 = 0, ms = 3600;
    row.classList.add("is-spinning");
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / ms), ease = 1 - Math.pow(1 - p, 3);
      ry = from + (REST_Y - from) * ease;
      show();
      if (p < 1) spin = requestAnimationFrame(step);
      else stopSpin();
    }
    spin = requestAnimationFrame(step);
  });
})();
