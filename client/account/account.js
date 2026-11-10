/* The account page's forms (/account). The page itself is server-
   rendered and readable without this script; this only sends the forms
   to the JSON API and says, plainly, what happened. */
(function () {
  "use strict";
  var msg = document.querySelector("[data-msg]");

  function say(text, bad) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = "portal-msg" + (bad ? " bad" : "");
    msg.hidden = !text;
    if (text) msg.scrollIntoView({ block: "nearest" });
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {}, url: res.url };
      });
    }, function () {
      return { status: 0, data: {}, url: "" };
    });
  }

  /* The answer came from this page's own origin (no redirect elsewhere). */
  function sameOrigin(r) {
    try { return !!r.url && new URL(r.url).origin === location.origin; } catch (e) { return false; }
  }

  var UNREACHABLE = "The server is out of reach just now. Nothing has changed — try again in a moment.";
  var TOO_MANY = "That has been tried a few times in a row. Please wait a little and try again.";

  function common(r) {
    if (r.status === 0) return UNREACHABLE;
    if (r.status === 429) return TOO_MANY;
    if (r.status === 401) return "You are signed out. Sign in again from the studio to use this page.";
    return null;
  }

  function busy(form, on) {
    var b = form.querySelector("button[type=submit]");
    if (b) b.disabled = on;
  }

  function field(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? el.value : "";
  }

  /* ---------------- Two-step sign-in ----------------
     Off: the button opens the password step; /start answers with the
     key and the QR code; the 6-digit code turns it on; the recovery codes
     are shown once. The key and the codes live only in the page: they
     are never logged or stored, and are cleared when the flow ends. */
  var twostep = document.querySelector("[data-twostep]");
  function part(sel) { return twostep ? twostep.querySelector(sel) : null; }
  var shownCodes = null;

  function groupsOf4(s) { return String(s).replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 "); }

  /* The QR code is inserted as markup only when it is plainly the
     server's inline SVG: it starts with <svg and carries no script, no
     event handler, no link and no embedded document. Otherwise the key
     text alone is shown. */
  function safeQrSvg(s) {
    if (typeof s !== "string") return null;
    var t = s.trim();
    if (t.slice(0, 4).toLowerCase() !== "<svg") return null;
    if (/<script|<foreignobject|<iframe|<object|<embed|<use\b|<image\b|javascript:|href\s*=|\son[a-z]+\s*=/i.test(t)) return null;
    return t;
  }

  function clearSetup() {
    var key = part("[data-twostep-key]");
    var qr = part("[data-twostep-qr]");
    if (key) key.textContent = "";
    if (qr) { qr.textContent = ""; qr.hidden = true; }
    twostep.querySelectorAll("form").forEach(function (f) { f.reset(); });
    var startForm = part('form[data-form="twostep-start"]');
    if (startForm) startForm.hidden = true;
    var scan = part("[data-twostep-scan]");
    if (scan) scan.hidden = true;
    var begin = part("[data-twostep-begin]");
    if (begin) begin.hidden = false;
  }

  function showCodes(codes) {
    var list = part("[data-recovery-list]");
    var step = part("[data-twostep-codes]");
    if (!list || !step || !Array.isArray(codes)) return false;
    shownCodes = codes.map(function (c) { return String(c); });
    list.textContent = "";
    shownCodes.forEach(function (c) {
      var li = document.createElement("li");
      li.textContent = c;
      list.appendChild(li);
    });
    var begin = part("[data-twostep-begin]");
    if (begin) begin.hidden = true;
    step.hidden = false;
    step.scrollIntoView({ block: "nearest" });
    return true;
  }

  function codesText() {
    var who = document.querySelector("[data-email]");
    return "Beuk recovery codes" + (who ? " for " + who.textContent : "") + "\n\n" +
      "Each code signs you in once, in place of the code from your authenticator app.\n\n" +
      shownCodes.join("\n") + "\n";
  }

  function secondFactorRefusal(r) {
    var c = common(r);
    if (c) return c;
    if (r.status === 403) return "The current password isn't right.";
    if (r.status === 400) return "That code didn't work. Type the newest code from the app, or a recovery code you haven't used.";
    return null;
  }

  if (twostep) {
    twostep.querySelectorAll("[data-twostep-cancel]").forEach(function (b) {
      b.addEventListener("click", function () { say("", false); clearSetup(); });
    });
    var copyBtn = part("[data-recovery-copy]");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      if (!shownCodes) return;
      var cant = "Copying didn't work in this browser. Select the codes and copy them, or download them as a text file.";
      if (!navigator.clipboard || !navigator.clipboard.writeText) { say(cant, true); return; }
      navigator.clipboard.writeText(shownCodes.join("\n")).then(function () {
        say("The recovery codes are copied. Paste them somewhere safe.", false);
      }, function () { say(cant, true); });
    });
    var downloadBtn = part("[data-recovery-download]");
    if (downloadBtn) downloadBtn.addEventListener("click", function () {
      if (!shownCodes) return;
      var url = URL.createObjectURL(new Blob([codesText()], { type: "text/plain;charset=utf-8" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = "beuk-recovery-codes.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var doneBtn = part("[data-recovery-done]");
    if (doneBtn) doneBtn.addEventListener("click", function () {
      shownCodes = null;
      var list = part("[data-recovery-list]");
      if (list) list.textContent = "";
      location.reload();
    });
  }

  var handlers = {
    "twostep-start": function (form) {
      busy(form, true);
      post("/api/account/two-step/start", { currentPassword: field(form, "currentPassword") }).then(function (r) {
        busy(form, false);
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status === 403) { say("The current password isn't right.", true); return; }
        if (r.status === 409) { say("Two-step sign-in is already on. Reload the page to see it.", true); return; }
        if (r.status !== 200 || typeof r.data.secret !== "string") { say(r.data.error || UNREACHABLE, true); return; }
        form.reset();
        form.hidden = true;
        var key = part("[data-twostep-key]");
        var qr = part("[data-twostep-qr]");
        if (key) key.textContent = groupsOf4(r.data.secret);
        var svg = sameOrigin(r) ? safeQrSvg(r.data.qrSvg) : null;
        if (qr) {
          qr.textContent = "";
          if (svg) qr.innerHTML = svg;
          qr.hidden = !svg;
        }
        var scan = part("[data-twostep-scan]");
        if (scan) scan.hidden = false;
        var code = part('form[data-form="twostep-enable"] input[name="code"]');
        if (code) code.focus();
      });
    },
    "twostep-enable": function (form) {
      var code = field(form, "code").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) { say("Type the 6 digits the app shows for Beuk.", true); return; }
      busy(form, true);
      post("/api/account/two-step/enable", { code: code }).then(function (r) {
        busy(form, false);
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status === 400) { say("That code didn't work. Check that the time on your phone is right, and type the newest code.", true); return; }
        if (r.status === 409) { clearSetup(); say("This setup is no longer current, perhaps because of another tab. Start again.", true); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        clearSetup();
        showCodes(r.data.recoveryCodes);
        say("Two-step sign-in is on. Save your recovery codes now: they are shown only this once.", false);
      });
    },
    "twostep-off": function (form) {
      busy(form, true);
      post("/api/account/two-step/disable", { currentPassword: field(form, "currentPassword"), code: field(form, "code") }).then(function (r) {
        busy(form, false);
        var refused = secondFactorRefusal(r);
        if (refused) { say(refused, true); return; }
        if (r.status === 409) { say("Two-step sign-in is already off. Reloading the page.", false); setTimeout(function () { location.reload(); }, 1500); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        form.reset();
        say("Two-step sign-in is off. Signing in asks for your password only.", false);
        setTimeout(function () { location.reload(); }, 1500);
      });
    },
    "twostep-codes": function (form) {
      busy(form, true);
      post("/api/account/two-step/recovery-codes", { currentPassword: field(form, "currentPassword"), code: field(form, "code") }).then(function (r) {
        busy(form, false);
        var refused = secondFactorRefusal(r);
        if (refused) { say(refused, true); return; }
        if (r.status === 409) { say("Two-step sign-in is off. Reloading the page.", false); setTimeout(function () { location.reload(); }, 1500); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        form.reset();
        var more = part("[data-twostep-codes-more]");
        if (more) more.open = false;
        showCodes(r.data.recoveryCodes);
        say("Here are your new recovery codes. The old ones no longer work.", false);
      });
    },
    password: function (form) {
      var next = field(form, "newPassword");
      if (next.length < 8) { say("The new password needs at least 8 characters.", true); return; }
      busy(form, true);
      post("/api/auth/password", { currentPassword: field(form, "currentPassword"), newPassword: next }).then(function (r) {
        busy(form, false);
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status === 403) { say("The current password isn't right.", true); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        form.reset();
        var n = typeof r.data.otherSessionsRevoked === "number" ? r.data.otherSessionsRevoked : 0;
        say("Your password is changed. " + (n === 1 ? "1 other device was signed out." : n + " other devices were signed out."), false);
      });
    },
    email: function (form) {
      busy(form, true);
      post("/api/account/email", { currentPassword: field(form, "currentPassword"), newEmail: field(form, "newEmail") }).then(function (r) {
        busy(form, false);
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status === 403) { say("The current password isn't right.", true); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        form.reset();
        say("A confirmation link is on its way to " + r.data.pendingEmail + ". Your address changes when you open it; until then nothing changes.", false);
        setTimeout(function () { location.reload(); }, 2500);
      });
    },
    "delete": function (form) {
      busy(form, true);
      post("/api/account/delete", { currentPassword: field(form, "currentPassword"), confirmPhrase: field(form, "confirmPhrase") }).then(function (r) {
        busy(form, false);
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status === 403) { say("The current password isn't right. Nothing was deleted.", true); return; }
        if (r.status !== 200) { say((r.data.error || UNREACHABLE) + " Nothing was deleted.", true); return; }
        location.href = r.data.next || "/account/deleted";
      });
    }
  };

  function goBilling(btn, path) {
    btn.disabled = true;
    say("", false);
    post(path).then(function (r) {
      var c = common(r);
      if (c) { btn.disabled = false; say(c, true); return; }
      if (r.status === 200 && r.data.url) { location.href = r.data.url; return; }
      btn.disabled = false;
      if (r.status === 409 && r.data.status) { say("This account already has a plan. Manage billing shows it.", true); return; }
      say(r.data.reason || "Stripe can't be reached just now. Nothing has changed; try again in a moment.", true);
    });
  }

  var actions = {
    resend: function (btn) {
      btn.disabled = true;
      post("/api/account/confirm/resend").then(function (r) {
        btn.disabled = false;
        var c = common(r);
        if (c) { say(c, true); return; }
        if (r.status !== 200) { say(r.data.error || UNREACHABLE, true); return; }
        if (r.data.alreadyConfirmed) { say("Your address is already confirmed.", false); return; }
        if (r.data.emailDelivery === "not-configured") { say("Email isn't set up on this server yet, so no link was sent.", true); return; }
        if (!r.data.sent) { say("The link couldn't be sent just now. Try again later.", true); return; }
        say("A new confirmation link is on its way. Earlier links no longer work.", false);
      });
    },
    "cancel-email": function (btn) {
      btn.disabled = true;
      post("/api/account/email/cancel").then(function (r) {
        btn.disabled = false;
        var c = common(r);
        if (c) { say(c, true); return; }
        say("The change is cancelled. Your address stays as it is.", false);
        setTimeout(function () { location.reload(); }, 1500);
      });
    },
    /* Plan: "Choose a plan" opens Stripe Checkout, "Manage billing" the
       Stripe Customer Portal. The server decides everything; this only
       follows the URL it answers with, or says why there is none. */
    "twostep-start": function () {
      var begin = part("[data-twostep-begin]");
      var form = part('form[data-form="twostep-start"]');
      if (!form) return;
      if (begin) begin.hidden = true;
      form.hidden = false;
      var pw = form.querySelector('input[name="currentPassword"]');
      if (pw) pw.focus();
    },
    upgrade: function (btn) { goBilling(btn, "/api/billing/checkout"); },
    manage: function (btn) { goBilling(btn, "/api/billing/portal"); },
    everywhere: function (btn) {
      if (!window.confirm("Sign out every device, this one included? Your books stay on your shelf.")) return;
      btn.disabled = true;
      post("/api/auth/sessions/revoke-all").then(function (r) {
        btn.disabled = false;
        if (r.status === 0 || r.status === 429) { say(common(r), true); return; }
        location.href = "/account";
      });
    }
  };

  /* "Download all my data": ask the server first, so a refusal (too
     many tries, too large, signed out) is said here instead of being
     saved as a file. Without this script the plain link still works. */
  document.querySelectorAll("a[data-export]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      say("", false);
      fetch("/api/account/export/check", { credentials: "same-origin", cache: "no-store" }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, data: data || {} };
        });
      }, function () {
        return { status: 0, data: {} };
      }).then(function (r) {
        if (r.status === 200) {
          say("Your data is on its way. Your browser saves it as one ZIP file.", false);
          location.href = link.getAttribute("href");
          return;
        }
        var c = r.status === 413 ? null : common(r);
        if (c) { say(c, true); return; }
        var text = r.data.error ? String(r.data.error) : UNREACHABLE;
        say(text.charAt(0).toUpperCase() + text.slice(1) + ".", true);
      });
    });
  });

  /* ---------------- Where you're signed in ----------------
     Every live session from /api/account/sessions, newest first, with a
     Sign out on every row but this device's. */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    // UTC, as the server-rendered dates on this page (humanDate) are.
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  var sessionList = document.querySelector("[data-sessions]");

  function sessionNote(text) {
    var li = document.createElement("li");
    li.className = "muted";
    li.textContent = text;
    sessionList.textContent = "";
    sessionList.appendChild(li);
  }

  function signOutDevice(btn, li, id) {
    btn.disabled = true;
    say("", false);
    post("/api/account/sessions/" + encodeURIComponent(id) + "/revoke").then(function (r) {
      if (r.status === 204) { li.remove(); say("That device is signed out.", false); return; }
      if (r.status === 404) { li.remove(); say("That device was already signed out.", false); return; }
      btn.disabled = false;
      var c = common(r);
      if (c) { say(c, true); return; }
      if (r.status === 400) { say("That's the device you're using. Sign out everywhere signs this one out too.", true); return; }
      say(UNREACHABLE, true);
    });
  }

  function sessionRow(s) {
    var li = document.createElement("li");
    var div = document.createElement("div");
    var title = document.createElement("span");
    title.className = "item-title";
    title.textContent = String(s.label || "");
    if (s.current) {
      var here = document.createElement("span");
      here.className = "this-device";
      here.textContent = "This device";
      title.appendChild(document.createTextNode(" "));
      title.appendChild(here);
    }
    var meta = document.createElement("span");
    meta.className = "item-meta";
    meta.textContent = "signed in " + day(s.createdAt) + (s.lastSeenAt ? " · last active " + day(s.lastSeenAt) : "");
    div.appendChild(title);
    div.appendChild(meta);
    li.appendChild(div);
    if (!s.current && typeof s.id === "string") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "linkish item-link";
      btn.textContent = "Sign out";
      btn.addEventListener("click", function () { signOutDevice(btn, li, s.id); });
      li.appendChild(btn);
    }
    return li;
  }

  if (sessionList) {
    fetch("/api/account/sessions", { credentials: "same-origin", cache: "no-store" }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {} };
      });
    }, function () {
      return { status: 0, data: {} };
    }).then(function (r) {
      if (r.status !== 200 || !Array.isArray(r.data.sessions)) {
        sessionNote(r.status === 401 ? common(r) : "The list couldn't be loaded just now. Reload the page to try again.");
        return;
      }
      sessionList.textContent = "";
      r.data.sessions.forEach(function (s) { if (s && typeof s === "object") sessionList.appendChild(sessionRow(s)); });
    });
  }

  document.querySelectorAll("form[data-form]").forEach(function (form) {
    var h = handlers[form.getAttribute("data-form")];
    if (!h) return;
    form.addEventListener("submit", function (e) { e.preventDefault(); say("", false); h(form); });
  });
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    var a = actions[btn.getAttribute("data-action")];
    if (!a) return;
    btn.addEventListener("click", function () { say("", false); a(btn); });
  });
})();
