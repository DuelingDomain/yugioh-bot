(() => {
  "use strict";

  const storageKey = "dueling-domain-review-2026-10-06";
  const preferences = { width: "1440", links: "mk" };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && ["1440", "390"].includes(saved.width)) preferences.width = saved.width;
    if (saved && ["mk", "nomk"].includes(saved.links)) preferences.links = saved.links;
  } catch {
    // The review remains usable when storage is blocked or contains invalid JSON.
  }

  const screenshots = [...document.querySelectorAll("img[data-src-pattern]")];
  const widthButtons = [...document.querySelectorAll("[data-width-option]")];
  const linksButtons = [...document.querySelectorAll("[data-links-option]")];
  const desktopCards = [...document.querySelectorAll("[data-desktop-only]")];
  const status = document.getElementById("view-status");

  function render() {
    document.body.dataset.width = preferences.width;
    desktopCards.forEach((card) => { card.hidden = preferences.width === "390"; });

    screenshots.forEach((img) => {
      const pattern = img.dataset.srcPattern;
      const src = pattern.replace("{w}", preferences.width).replace("{links}", preferences.links);
      const width = pattern.includes("{w}") ? Number(preferences.width) : 1440;
      img.width = width;
      img.height = width === 390 ? Number(img.dataset.phoneHeight || 844) : 900;
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.closest("a").setAttribute("href", src);

      if (img.dataset.altBase) {
        img.alt = `${img.dataset.altBase}, ${preferences.links === "mk" ? "with marketing links" : "before cutover, marketing links hidden"}`;
      }
      img.closest("a").setAttribute("aria-label", `Open full size: ${img.alt} (${width}px)`);
    });

    widthButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.widthOption === preferences.width));
    });
    linksButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.linksOption === preferences.links));
    });
  }

  function updatePreference(key, value) {
    preferences[key] = value;
    render();
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // A storage failure must not interrupt either toggle.
    }
    status.textContent = `${preferences.width === "1440" ? "Desktop 1440" : "Phone 390"} screenshots. State grid: ${preferences.links === "mk" ? "with marketing links" : "before cutover"}.`;
  }

  widthButtons.forEach((button) => {
    button.addEventListener("click", () => updatePreference("width", button.dataset.widthOption));
  });
  linksButtons.forEach((button) => {
    button.addEventListener("click", () => updatePreference("links", button.dataset.linksOption));
  });
  render();

  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightbox-image");
  const lightboxTitle = document.getElementById("lightbox-title");
  const viewport = lightbox.querySelector(".lightbox-viewport");
  let opener = null;

  document.querySelectorAll("a.screenshot").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      if (typeof lightbox.showModal !== "function") return;
      event.preventDefault();
      const img = link.querySelector("img");
      opener = link;
      lightboxImage.src = link.getAttribute("href");
      lightboxImage.alt = img.alt;
      lightboxImage.width = img.width;
      lightboxImage.height = img.height;
      lightboxTitle.textContent = `${img.alt} — ${img.width} × ${img.height}`;
      lightbox.showModal();
      document.body.classList.add("lightbox-open");
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    });
  });

  document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });
  // Native dialog handles Escape, contains keyboard focus and makes the page inert.
  lightbox.addEventListener("close", () => {
    document.body.classList.remove("lightbox-open");
    if (opener) opener.focus({ preventScroll: true });
    lightboxImage.removeAttribute("src");
  });
})();
