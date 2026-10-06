/* Runs on Career Hub pages: when the student signs in on the web app, hand the token to the extension
 * so they don't have to sign in twice. Only accepts messages from the page's own origin. */
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (d && d.source === "geekforce-hub" && d.type === "token") {
    chrome.runtime.sendMessage({ type: "hubToken", token: d.token || null, hubUrl: location.origin });
  }
});
try {
  const t = localStorage.getItem("gf_token");
  if (t) chrome.runtime.sendMessage({ type: "hubToken", token: t, hubUrl: location.origin });
} catch (_) { /* storage blocked */ }
