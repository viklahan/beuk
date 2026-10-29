/* Beuk School page script (src/school/render.ts pages). Everything here is
   an enhancement: without it the three lesson views stack and no progress
   is shown. Progress is read and written only for a signed-in writer
   (/api/school/progress answers 401 otherwise, and then nothing is kept,
   here or in the browser). */
(function () {
  var body = document.body;
  body.classList.add('js');
  var course = body.getAttribute('data-course');
  var lesson = body.getAttribute('data-lesson');

  /* --- stage chips (home) --- */
  var say = document.querySelector('[data-stage-say]');
  var sayBase = say ? say.textContent : '';
  var SAY = {
    idea: 'Just an idea: start with the studio walkthrough, so you know what the book can become.',
    draft: 'Drafting: the desk, the outline and the look of the book while you write.',
    ship: 'Ready to publish: covers, export, checks and getting the book to readers.'
  };
  document.querySelectorAll('.chip[data-stage]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var on = chip.getAttribute('aria-pressed') !== 'true';
      document.querySelectorAll('.chip[data-stage]').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
      if (on) chip.setAttribute('aria-pressed', 'true');
      var st = on ? chip.getAttribute('data-stage') : null;
      document.querySelectorAll('.cc[data-stages]').forEach(function (cc) {
        var fits = !st || (' ' + cc.getAttribute('data-stages') + ' ').indexOf(' ' + st + ' ') >= 0;
        cc.setAttribute('data-dim', fits ? '0' : '1');
      });
      if (say) say.textContent = st ? SAY[st] : sayBase;
    });
  });

  /* --- lesson views: Watch / Listen / Read --- */
  var tabs = document.querySelector('.modes');
  if (tabs) {
    tabs.hidden = false;
    var pick = function (mode) {
      tabs.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-mode') === mode)); });
      document.querySelectorAll('[data-mode-panel]').forEach(function (p) {
        var show = p.getAttribute('data-mode-panel') === mode;
        if (!show) p.querySelectorAll('[data-media]').forEach(function (m) { m.pause(); });
        p.hidden = !show;
      });
    };
    tabs.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.getAttribute('data-mode')); });
    });
    pick(tabs.querySelector('[data-mode]').getAttribute('data-mode'));
  }
  document.querySelectorAll('[data-seek]').forEach(function (b) {
    b.addEventListener('click', function () {
      var panel = b.closest('[data-mode-panel]');
      var media = panel && panel.querySelector('[data-media]');
      if (!media) return;
      media.currentTime = Number(b.getAttribute('data-seek')) || 0;
      media.play();
    });
  });

  /* --- progress (signed-in only) --- */
  if (!course) return;
  var done = {};
  var key = function (c, l) { return c + '/' + l; };
  var paint = function () {
    var lessons = (body.getAttribute('data-lessons') || '').split(' ').filter(Boolean);
    document.querySelectorAll('.ls[data-lesson]').forEach(function (row) {
      var d = !!done[key(course, row.getAttribute('data-lesson'))];
      row.setAttribute('data-done', d ? '1' : '0');
      var mark = row.querySelector('[data-done-mark]');
      if (mark) mark.hidden = !d;
    });
    if (lessons.length) {
      var n = lessons.filter(function (l) { return done[key(course, l)]; }).length;
      var p = document.querySelector('[data-course-progress]');
      if (p) { p.hidden = false; p.textContent = n + ' of ' + lessons.length + ' lessons done'; }
      var next = lessons.filter(function (l) { return !done[key(course, l)]; })[0];
      var resume = document.querySelector('[data-resume]');
      if (resume && n > 0 && next) {
        resume.href = '/school/' + course + '/' + next;
        resume.textContent = 'Continue: lesson ' + (lessons.indexOf(next) + 1);
      }
    }
    var t = document.querySelector('[data-done-toggle]');
    if (t && lesson) {
      var isDone = !!done[key(course, lesson)];
      t.setAttribute('aria-pressed', String(isDone));
      t.textContent = isDone ? 'Done ✓ (undo)' : 'Mark lesson done';
    }
  };
  var take = function (list) {
    done = {};
    (list || []).forEach(function (r) { done[key(r.course, r.lesson)] = r.completedAt; });
    var box = document.querySelector('[data-done-box]');
    var signin = document.querySelector('[data-signin-box]');
    if (box) box.hidden = false;
    if (signin) signin.hidden = true;
    var note = document.querySelector('[data-signin-note]');
    if (note) note.textContent = 'Signed in: Beuk remembers the lessons you mark done.';
    paint();
  };
  fetch('/api/school/progress', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j) take(j.done); })
    .catch(function () {});
  var toggle = document.querySelector('[data-done-toggle]');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var want = !done[key(course, lesson)];
      var note = document.querySelector('[data-done-note]');
      fetch('/api/school/progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course: course, lesson: lesson, done: want })
      })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) { take(j.done); if (note) note.textContent = want ? 'Saved to your account.' : 'Marked as not done.'; })
        .catch(function () { if (note) note.textContent = 'That did not save. Check you are still signed in, then try again.'; });
    });
  }
})();
