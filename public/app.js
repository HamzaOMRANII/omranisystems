(function () {
  const dialog = document.getElementById("unlock");
  const form = document.getElementById("unlock-form");
  const input = document.getElementById("code");
  const errorEl = document.getElementById("unlock-error");
  const appEl = document.getElementById("unlock-app");
  const submitBtn = document.getElementById("unlock-submit");
  const names = {};
  let currentApp = null;

  document.getElementById("year").textContent = new Date().getFullYear();

  document.querySelectorAll(".app").forEach((btn) => {
    names[btn.dataset.app] = btn.dataset.name;
    btn.addEventListener("click", () => openFor(btn.dataset.app));
  });

  function openFor(appId) {
    currentApp = appId;
    appEl.textContent = (names[appId] || appId) + " · " + appId + ".omranisystems.com";
    errorEl.textContent = "";
    input.value = "";
    dialog.showModal();
    input.focus();
  }

  document.getElementById("unlock-cancel").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) {
      errorEl.textContent = "Please enter the code.";
      return;
    }
    submitBtn.disabled = true;
    errorEl.textContent = "";
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: currentApp, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      errorEl.textContent = data.error || "Something went wrong.";
      input.select();
    } catch {
      errorEl.textContent = "Network error. Try again.";
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Opened from a subdomain without a valid code: /unlock?app=pass
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("app");
  // Hidden apps (no tile, e.g. adminchat) are accepted too; the server checks the id.
  if (requested && /^[a-z]{1,20}$/.test(requested)) openFor(requested);
})();
