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
        return { status: res.status, data: data || {} };
      });
    }, function () {
      return { status: 0, data: {} };
    });
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

  var handlers = {
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
