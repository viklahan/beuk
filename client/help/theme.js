/* Beuk Help — runs in <head>, before first paint, so a writer who chose
   Candlelight in the studio never sees a flash of Paper. Same key and
   values as the studio (beuk.theme.v1 = paper | candlelight; no saved
   choice = Paper, whatever the system colour scheme says). Also picks
   the guides' detail level (beuk.help.detail.v1 = plain | tech; default
   plain) and marks the page as scripted. Storage can be blocked: every
   read is guarded and the page renders the same without it. */
(function () {
  var root = document.documentElement;
  try {
    if (window.localStorage && localStorage.getItem("beuk.theme.v1") === "candlelight") root.setAttribute("data-theme", "candlelight");
  } catch (e) {}
  var detail = "plain";
  try {
    var d = window.localStorage && localStorage.getItem("beuk.help.detail.v1");
    if (d === "plain" || d === "tech") detail = d;
  } catch (e) {}
  root.setAttribute("data-detail", detail);
  root.className += (root.className ? " " : "") + "js";
})();
