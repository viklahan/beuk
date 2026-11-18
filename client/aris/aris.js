/* The /aris page's controls. The page is server-rendered and readable
   without this script; this fills the controls from /api/aris/status:
   signed out, the quiet line stays; signed in, the opt-in, the voice dial
   and the keys appear. Errors say the API's own words. */
(function () {
  "use strict";
  var root = document.querySelector("[data-aris-controls]");
  if (!root) return;
  var quiet = root.querySelector("[data-aris-signed-out]");
  var panel = root.querySelector("[data-aris-signed-in]");
  var msg = root.querySelector("[data-aris-msg]");

  function say(text, bad) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = "aris-msg" + (bad ? " bad" : "");
    msg.hidden = !text;
  }

  function call(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {} };
      });
    }, function () {
      return { status: 0, data: {} };
    });
  }

  var UNREACHABLE = "The server is out of reach just now. Nothing has changed — try again in a moment.";
  var TOO_MANY = "That has been tried a few times in a row. Please wait a little and try again.";

  var GONE = "Aris is not available here just now. Nothing has changed.";

  /* Aris switched off since this tab loaded: drop the controls, keep the quiet line. */
  function gone() {
    panel.hidden = true;
    panel.textContent = "";
    quiet.hidden = false;
  }

  function common(r) {
    if (r.status === 0) return UNREACHABLE;
    if (r.status === 429) return TOO_MANY;
    if (r.status === 404) return GONE;
    if (r.status === 401) return "You are signed out. Sign in again from the studio to use this page.";
    return null;
  }

  /* A failed call: the shared words, else the API's own, else its status. */
  function fail(r) {
    if (r.status === 404) gone();
    say(common(r) || (r.data && r.data.error) || "That did not go through (" + r.status + ").", true);
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function block(title) {
    var b = el("div", { "class": "aris-block" });
    b.appendChild(el("h3", {}, title));
    return b;
  }

  function refresh() {
    call("GET", "/api/aris/status").then(function (s) {
      if (s.status === 200) render(s.data);
      else if (s.status === 404) { gone(); fail(s); }
    });
  }

  function render(status) {
    panel.textContent = "";

    var summon = block("Summon Aris");
    var row = el("div", { "class": "aris-row" });
    var cb = el("input", { type: "checkbox", id: "aris-optin" });
    cb.checked = !!status.optedIn;
    row.appendChild(cb);
    row.appendChild(el("label", { "for": "aris-optin" }, "Summon Aris in my studio"));
    summon.appendChild(row);
    summon.appendChild(el("p", { "class": "aris-hint" }, status.optedIn
      ? "Aris is summoned. Untick to send Aris away; your keys stay put."
      : "Off until you say so. Nothing is sent anywhere before then."));
    cb.addEventListener("change", function () {
      cb.disabled = true;
      call("PUT", "/api/aris/settings", { optedIn: cb.checked }).then(function (r) {
        if (r.status === 200) { render(r.data); say(r.data.optedIn ? "Aris is summoned." : "Aris is sent away."); }
        else { cb.checked = !cb.checked; cb.disabled = false; fail(r); }
      });
    });
    panel.appendChild(summon);

    var voice = block("Voice");
    var vrow = el("div", { "class": "aris-row" });
    [["laconic", "Laconic"], ["homeric", "Homeric"]].forEach(function (v) {
      var id = "aris-voice-" + v[0];
      var rb = el("input", { type: "radio", name: "aris-voice", id: id, value: v[0] });
      rb.checked = status.voice === v[0];
      rb.addEventListener("change", function () {
        call("PUT", "/api/aris/settings", { voice: v[0] }).then(function (r) {
          if (r.status === 200) { render(r.data); say("Aris will be " + v[1].toLowerCase() + "."); }
          else { refresh(); fail(r); }
        });
      });
      vrow.appendChild(rb);
      vrow.appendChild(el("label", { "for": id }, v[1]));
    });
    voice.appendChild(vrow);
    voice.appendChild(el("p", { "class": "aris-hint" }, "Laconic is few words; Homeric lets Aris sing a little. Only the way Aris talks changes. The drafts stay yours."));
    panel.appendChild(voice);

    var keys = block("Your keys");
    if (status.keys && status.keys.length) {
      var ul = el("ul", { "class": "aris-keys" });
      status.keys.forEach(function (k) {
        var li = el("li");
        li.appendChild(el("span", {}, k.provider + " · …" + k.last4 + (k.baseUrl ? " · " + k.baseUrl : "")));
        var del = el("button", { type: "button" }, "Delete");
        del.addEventListener("click", function () {
          del.disabled = true;
          call("DELETE", "/api/aris/key/" + encodeURIComponent(k.provider)).then(function (r) {
            if (r.status === 204 || r.status === 200) { refresh(); say("The " + k.provider + " key is gone."); }
            else { del.disabled = false; fail(r); }
          });
        });
        li.appendChild(del);
        ul.appendChild(li);
      });
      keys.appendChild(ul);
    } else {
      keys.appendChild(el("p", { "class": "aris-hint" }, "No keys yet. Aris writes with your own key, from the provider you choose."));
    }

    var form = el("form", { "class": "aris-keyform", autocomplete: "off" });
    var r1 = el("div", { "class": "aris-row" });
    var sel = el("select", { name: "provider", "aria-label": "Provider" });
    [["openrouter", "OpenRouter"], ["anthropic", "Anthropic"], ["openai-compat", "OpenAI-compatible"]].forEach(function (p) {
      sel.appendChild(el("option", { value: p[0] }, p[1]));
    });
    var secret = el("input", { type: "password", name: "apiKey", placeholder: "Paste your API key", "aria-label": "API key", autocomplete: "off", spellcheck: "false" });
    r1.appendChild(sel);
    r1.appendChild(secret);
    form.appendChild(r1);
    var r2 = el("div", { "class": "aris-row" });
    r2.hidden = true;
    var base = el("input", { type: "url", name: "baseUrl", placeholder: "https://your-endpoint.example/v1", "aria-label": "Base URL" });
    r2.appendChild(base);
    form.appendChild(r2);
    sel.addEventListener("change", function () { r2.hidden = sel.value !== "openai-compat"; });
    var save = el("button", { type: "submit" }, "Save key");
    var r3 = el("div", { "class": "aris-row" });
    r3.appendChild(save);
    form.appendChild(r3);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = { provider: sel.value, apiKey: secret.value };
      if (sel.value === "openai-compat" && base.value.trim()) body.baseUrl = base.value.trim();
      save.disabled = true;
      call("PUT", "/api/aris/key", body).then(function (r) {
        save.disabled = false;
        if (r.status === 200) {
          secret.value = "";
          refresh();
          say("Saved the " + r.data.provider + " key, ending …" + r.data.last4 + ". Only the last four show again.");
        } else fail(r);
      });
    });
    keys.appendChild(form);
    panel.appendChild(keys);
  }

  call("GET", "/api/aris/status").then(function (r) {
    if (r.status === 200) {
      quiet.hidden = true;
      panel.hidden = false;
      render(r.data);
    }
    /* 401 (signed out) and anything else: the quiet line stays. */
  });
})();
