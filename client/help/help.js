/* Beuk Help (H1/H2) — small progressive enhancements over pages that
   already work without JavaScript:
   - theme toggle (Paper / Candlelight, the studio's beuk.theme.v1 key);
   - search: the form posts to /help/search without JS; with JS the
     results come from GET /api/help/search and render in place;
   - the error dictionary's area filter;
   - guide steps ↔ the right-hand pane: selecting a step (or a "What it
     checks" line) shows its pane and highlights the lines it names;
   - "Plain English / With the technical bits" (beuk.help.detail.v1);
   - the Founders' Shelf form (POST /api/founders/apply).
   No inline handlers, no eval — the enforced CSP allows it as-is. */
(function () {
  "use strict";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var store = {
    get: function (k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) {} }
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* ---- theme ---- */
  var root = document.documentElement;
  var themeBtn = $("[data-theme-toggle]");
  function syncTheme() {
    var dark = root.getAttribute("data-theme") === "candlelight";
    if (themeBtn) {
      themeBtn.textContent = dark ? "Paper" : "Candlelight";
      themeBtn.setAttribute("aria-label", dark ? "Switch to the Paper theme" : "Switch to the Candlelight theme");
    }
  }
  if (themeBtn) {
    themeBtn.hidden = false;
    syncTheme();
    themeBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "candlelight" ? "paper" : "candlelight";
      if (next === "candlelight") root.setAttribute("data-theme", "candlelight");
      else root.removeAttribute("data-theme");
      store.set("beuk.theme.v1", next);
      syncTheme();
    });
  }

  /* ---- search ---- */
  function snippet(s) { return esc(s).replace(/«/g, "<mark>").replace(/»/g, "</mark>"); }
  function hitHtml(h, logId) {
    var how = h.match === "code" ? "matched " + h.matchedCode : h.match === "similar" ? "similar spelling" : "";
    var data = ' data-ref="' + esc(h.ref) + '"' + (logId ? ' data-log="' + esc(logId) + '"' : "");
    if (h.kind === "error") {
      return '<a class="hit err" href="' + esc(h.url) + '"' + data + '><span class="code">' + esc(h.code) + '</span><span class="t">' + esc(h.title) + "</span>" +
        (how ? '<span class="how">' + esc(how) + "</span>" : "") + '<span class="snip">' + snippet(h.snippet) + "</span></a>";
    }
    return '<a class="hit" href="' + esc(h.url) + '"' + data + '><span class="t">' + esc(h.title) + "</span>" +
      (how ? '<span class="how">' + esc(how) + "</span>" : "") + '<span class="snip">' + snippet(h.snippet) + "</span></a>";
  }
  function group(label, hits, logId) {
    if (!hits.length) return "";
    return '<div class="hits"><p class="kicker">' + label + " · " + hits.length + '</p><div class="hit-list">' +
      hits.map(function (h) { return hitHtml(h, logId); }).join("") + "</div></div>";
  }
  function renderResults(out, r) {
    var html = "";
    if (r.codes && r.codes.length) html += '<p class="muted small">Codes in what you searched: ' + r.codes.map(function (c) { return "<code>" + esc(c) + "</code>"; }).join(" ") + "</p>";
    html += group("Error codes", r.errors, r.logId) + group("Guides", r.guides, r.logId) + group("Sections of guides", r.sections, r.logId);
    if (!r.total) {
      html += '<div class="no-hits"><p>Nothing in the guides or the error dictionary matches that yet.</p><p class="muted small">Searches are logged as the first 200 characters and the number of results — never who searched.</p>' +
        (out.getAttribute("data-support") || "") + "</div>";
    }
    out.innerHTML = '<div class="results" data-total="' + r.total + '">' + html + "</div>";
  }
  $$("[data-help-search]").forEach(function (form) {
    var ta = $("textarea", form);
    var clear = $("[data-search-clear]", form);
    var wrap = form.parentNode;
    var out = $("[data-search-out]", wrap);
    var fit = function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 220) + "px"; };
    var syncClear = function () { if (clear) clear.hidden = !ta.value.trim(); };
    ta.addEventListener("input", function () { fit(); syncClear(); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.submit(); }
    });
    fit(); syncClear();
    if (clear) clear.addEventListener("click", function () { ta.value = ""; fit(); syncClear(); if (out) out.innerHTML = ""; ta.focus(); });
    if (!out || !window.fetch) return;
    // The no-results contact line comes from the server (data-support,
    // present only when SUPPORT_EMAIL is configured) — never invented here.
    var seq = 0;
    var run = function (q) {
      var mine = ++seq;
      out.innerHTML = '<p class="muted small">Searching…</p>';
      // A long pasted report goes in the body; a URL has a length limit.
      var long = q.length > 1500;
      fetch(long ? "/api/help/search" : "/api/help/search?q=" + encodeURIComponent(q), long
        ? { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ q: q }) }
        : { headers: { accept: "application/json" } })
        .then(function (res) {
          if (res.status === 429) {
            var wait = res.headers.get("Retry-After") || "a few";
            throw new Error("That's a lot of searching in a short time — please wait " + wait + " seconds and try again.");
          }
          if (!res.ok) throw new Error("The search didn't answer (" + res.status + "). The guides and the dictionary below still work.");
          return res.json();
        })
        .then(function (r) { if (mine === seq) renderResults(out, r); })
        .catch(function (err) { if (mine === seq) out.innerHTML = '<p class="no-hits">' + esc(err && err.message ? err.message : "The search didn't answer.") + "</p>"; });
    };
    form.addEventListener("submit", function (e) {
      var q = ta.value.trim();
      e.preventDefault();
      if (!q) { out.innerHTML = ""; return; }
      if (q.length <= 1500 && window.history && history.replaceState && /^\/help\/search/.test(location.pathname)) history.replaceState(null, "", "/help/search?q=" + encodeURIComponent(q));
      run(q);
    });
    $$(".chips a[data-q]", wrap).forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        ta.value = a.getAttribute("data-q"); fit(); syncClear();
        run(ta.value);
      });
    });
    wrap.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a.hit[data-log]");
      if (!a) return;
      try {
        fetch("/api/help/search/click", { method: "POST", keepalive: true, headers: { "content-type": "application/json" },
          body: JSON.stringify({ logId: a.getAttribute("data-log"), ref: a.getAttribute("data-ref") }) }).catch(function () {});
      } catch (err) {}
    });
  });

  /* ---- error dictionary filter ---- */
  $$("[data-cat-filter]").forEach(function (bar) {
    bar.hidden = false;
    var table = bar.parentNode.querySelector(".err-table") || $(".err-table");
    $$("button[data-cat]", bar).forEach(function (b) {
      b.addEventListener("click", function () {
        var cat = b.getAttribute("data-cat");
        $$("button[data-cat]", bar).forEach(function (x) { var on = x === b; x.setAttribute("aria-pressed", on ? "true" : "false"); x.classList.toggle("on", on); });
        $$(".err-row", table).forEach(function (row) { row.hidden = !(cat === "all" || row.getAttribute("data-cat") === cat); });
      });
    });
  });
  // A #BEUK-… fragment opens that row.
  if (/^#BEUK-[A-Z]\d{3}$/.test(location.hash)) { var row = document.getElementById(location.hash.slice(1)); if (row && row.tagName === "DETAILS") row.open = true; }

  /* ---- detail level ---- */
  var seg = $("[data-detail]");
  if (seg) {
    seg.hidden = false;
    var syncDetail = function () {
      var d = root.getAttribute("data-detail") || "plain";
      $$("button[data-detail-set]", seg).forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-detail-set") === d ? "true" : "false"); });
    };
    syncDetail();
    $$("button[data-detail-set]", seg).forEach(function (b) {
      b.addEventListener("click", function () { var d = b.getAttribute("data-detail-set"); root.setAttribute("data-detail", d); store.set("beuk.help.detail.v1", d); syncDetail(); });
    });
  }

  /* ---- steps ↔ pane ---- */
  var paneBox = $(".g-pane");
  if (paneBox) {
    var panes = $$(".pane", paneBox);
    var tabs = $$("[data-tab]", paneBox);
    var tabBar = $("[data-tabs]", paneBox);
    if (tabBar && panes.length > 1) tabBar.hidden = false;
    var picks = $$(".pick");
    var show = function (id, hl, from) {
      panes.forEach(function (p) {
        var on = p.getAttribute("data-pane-id") === id;
        p.hidden = !on;
        p.removeAttribute("data-start-hidden");
        if (!on) return;
        var first = null;
        $$(".ln", p).forEach(function (ln) {
          var t = ln.textContent || "";
          var lit = !!hl.length && hl.some(function (h) { return t.indexOf(h) !== -1; });
          ln.classList.toggle("lit", lit);
          if (lit && !first) first = ln;
        });
        if (first) {
          var box = $(".pane-lines", p);
          box.scrollTop = Math.max(0, first.offsetTop - box.offsetTop - 24);
        }
      });
      tabs.forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-tab") === id ? "true" : "false"); });
      picks.forEach(function (x) { x.classList.toggle("on", x === from); });
    };
    var pickFrom = function (el) {
      var hl = (el.getAttribute("data-hl") || "").split("|").filter(Boolean);
      show(el.getAttribute("data-pane"), hl, el);
      if (window.matchMedia && window.matchMedia("(max-width: 899px)").matches) paneBox.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    picks.forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("a")) return; // links inside a step keep working
        pickFrom(el);
      });
    });
    tabs.forEach(function (t) { t.addEventListener("click", function () { show(t.getAttribute("data-tab"), [], null); }); });
    var firstStep = $(".step.pick");
    if (firstStep && window.matchMedia && !window.matchMedia("(max-width: 899px)").matches) pickFrom(firstStep);
    else if (panes.length) show(panes[0].getAttribute("data-pane-id"), [], null);
  }

  /* ---- Founders' Shelf ---- */
  var ff = document.getElementById("founders-form");
  if (ff) {
    ff.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(ff);
      var result = document.getElementById("founders-result");
      fetch("/api/founders/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), email: data.get("email"), about: data.get("about") })
      })
        .then(function (res) { return res.json().then(function (body) { return { status: res.status, body: body }; }); })
        .then(function (r) {
          if (result) result.textContent = r.body.message || r.body.error || "Something went awry — please try again.";
          if (r.status === 201) ff.reset();
        })
        .catch(function () { if (result) result.textContent = "That did not get through — please try again in a moment."; });
    });
  }
})();
