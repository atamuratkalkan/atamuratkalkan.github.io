(() => {
  "use strict";

  const VALID_SIZES = new Set(["large", "medium", "small"]);
  const GALLERY_KEYS = [
    "animalStudies",
    "experimentsInColour",
    "lightAndShadowStudies",
    "photography"
  ];

  const galleryData = {};
  const galleryElements = new Map(
    [...document.querySelectorAll("[data-gallery]")].map((element) => [
      element.dataset.gallery,
      element
    ])
  );

  const lightbox = document.querySelector("#artwork-lightbox");
  const lightboxImage = lightbox.querySelector(".lightbox__image");
  const lightboxTitle = lightbox.querySelector("#lightbox-title");
  const lightboxMetadata = lightbox.querySelector(".lightbox__metadata");
  const lightboxClose = lightbox.querySelector(".lightbox__close");
  const lightboxPrevious = lightbox.querySelector(".lightbox__previous");
  const lightboxNext = lightbox.querySelector(".lightbox__next");

  const menuButton = document.querySelector(".menu-button");
  const mobileMenu = document.querySelector(".mobile-menu");
  const mobileMenuClose = document.querySelector(".mobile-menu__close");
  const menuOverlay = document.querySelector(".menu-overlay");

  let activeOverlay = null;
  let overlayReturnFocus = null;
  let lightboxSection = null;
  let lightboxIndex = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;

  function warn(message, details) {
    if (details === undefined) {
      console.warn(`[Artwork catalogue] ${message}`);
      return;
    }
    console.warn(`[Artwork catalogue] ${message}`, details);
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normaliseArtwork(item, sectionKey, index) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warn(`${sectionKey}[${index}] is not an artwork object and was skipped.`);
      return null;
    }

    const id = cleanText(item.id);
    const image = cleanText(item.image);
    const alt = cleanText(item.alt);

    if (!id || !image || !alt) {
      warn(
        `${sectionKey}[${index}] is missing id, image, or alt text and was skipped.`,
        item
      );
      return null;
    }

    const title = cleanText(item.title) || "TITLE TO REPLACE";
    const year = cleanText(item.year) || "YEAR TO REPLACE";
    const medium = cleanText(item.medium) || "MEDIUM TO REPLACE";

    if (!cleanText(item.title) || !cleanText(item.year) || !cleanText(item.medium)) {
      warn(`${id} has missing display information; replacement text is being shown.`);
    }

    const size = VALID_SIZES.has(item.size) ? item.size : "medium";
    if (!VALID_SIZES.has(item.size)) {
      warn(`${id} has an invalid size; "medium" is being used.`);
    }

    const width = Number.isInteger(item.width) && item.width > 0 ? item.width : null;
    const height = Number.isInteger(item.height) && item.height > 0 ? item.height : null;

    if (!width || !height) {
      warn(`${id} has no valid width and height. The image will still load.`);
    }

    return { id, title, year, medium, image, alt, size, width, height, sectionKey };
  }

  function imageSizes(size, isPhotography) {
    if (isPhotography) {
      if (size === "large") {
        return "(max-width: 640px) 90vw, (max-width: 900px) 46vw, 42vw";
      }
      return "(max-width: 640px) 78vw, (max-width: 900px) 30vw, 28vw";
    }

    if (size === "large") {
      return "(max-width: 640px) 100vw, (max-width: 900px) 92vw, 58vw";
    }
    if (size === "small") {
      return "(max-width: 640px) 78vw, (max-width: 900px) 38vw, 28vw";
    }
    return "(max-width: 640px) 90vw, (max-width: 900px) 46vw, 43vw";
  }

  function handleBrokenImage(image, artwork) {
    warn(`The image for "${artwork.title}" could not be loaded: ${artwork.image}`);

    const replacement = document.createElement("div");
    replacement.className = "artwork__image-error";
    replacement.setAttribute("role", "img");
    replacement.setAttribute("aria-label", `${artwork.alt}. Image unavailable.`);
    replacement.textContent = "Image unavailable — check the path in data/artworks.json";

    const trigger = image.closest(".artwork__trigger");
    if (trigger) {
      trigger.disabled = true;
      trigger.setAttribute("aria-label", `${artwork.title}: image unavailable`);
    }
    image.replaceWith(replacement);
  }

  function createArtworkElement(artwork, index) {
    const figure = document.createElement("figure");
    figure.className = `artwork artwork--${artwork.size}`;
    figure.dataset.artworkId = artwork.id;

    const trigger = document.createElement("button");
    trigger.className = "artwork__trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", `Open ${artwork.title}`);

    const image = document.createElement("img");
    image.className = "artwork__image";
    image.src = artwork.image;
    image.alt = artwork.alt;
    image.decoding = "async";
    image.sizes = imageSizes(artwork.size, artwork.sectionKey === "photography");

    const isFirstMajorArtwork =
      artwork.sectionKey === "animalStudies" && index === 0;
    image.loading = isFirstMajorArtwork ? "eager" : "lazy";
    if (isFirstMajorArtwork) {
      image.fetchPriority = "high";
    }

    if (artwork.width && artwork.height) {
      image.width = artwork.width;
      image.height = artwork.height;
    }

    image.addEventListener("error", () => handleBrokenImage(image, artwork), {
      once: true
    });
    trigger.append(image);

    const caption = document.createElement("figcaption");
    caption.className = "artwork__caption";

    const title = document.createElement("h3");
    title.className = "artwork__title";
    title.textContent = artwork.title;

    const metadata = document.createElement("p");
    metadata.className = "artwork__metadata";

    const year = document.createElement("span");
    year.textContent = artwork.year;

    const medium = document.createElement("span");
    medium.textContent = artwork.medium;

    metadata.append(year, medium);
    caption.append(title, metadata);
    figure.append(trigger, caption);

    trigger.addEventListener("click", () => {
      openLightbox(artwork.sectionKey, index, trigger);
    });

    return figure;
  }

  function hideEmptySection(sectionKey) {
    const section = document.querySelector(`[data-gallery-section="${sectionKey}"]`);
    if (section) {
      section.hidden = true;
    }
    document.querySelectorAll(`[data-nav-item="${sectionKey}"]`).forEach((item) => {
      item.hidden = true;
    });
  }

  function renderGalleries(data) {
    GALLERY_KEYS.forEach((sectionKey) => {
      const gallery = galleryElements.get(sectionKey);
      const sourceItems = Array.isArray(data[sectionKey]) ? data[sectionKey] : [];

      if (!Array.isArray(data[sectionKey])) {
        warn(`${sectionKey} is missing or is not an array; its section is hidden.`);
      }

      const artworks = sourceItems
        .map((item, index) => normaliseArtwork(item, sectionKey, index))
        .filter(Boolean);

      galleryData[sectionKey] = artworks;

      if (!gallery || artworks.length === 0) {
        hideEmptySection(sectionKey);
        return;
      }

      const fragment = document.createDocumentFragment();
      artworks.forEach((artwork, index) => {
        fragment.append(createArtworkElement(artwork, index));
      });
      gallery.replaceChildren(fragment);
    });
  }

  async function loadArtworkData() {
    try {
      const response = await fetch("data/artworks.json", { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      renderGalleries(data);
    } catch (error) {
      warn(
        "The artwork data could not be loaded. Preview the site through a local web server and check that data/artworks.json contains valid JSON.",
        error
      );
      GALLERY_KEYS.forEach(hideEmptySection);
    }
  }

  function getFocusableElements(container) {
    return [
      ...container.querySelectorAll(
        'a[href], button:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((element) => !element.closest("[hidden]"));
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !activeOverlay) {
      return;
    }

    const focusable = getFocusableElements(activeOverlay);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function lockPage(overlay, returnFocus) {
    activeOverlay = overlay;
    overlayReturnFocus = returnFocus || document.activeElement;
    document.body.classList.add("is-locked");
  }

  function unlockPage() {
    document.body.classList.remove("is-locked");
    activeOverlay = null;
    const returnTarget = overlayReturnFocus;
    overlayReturnFocus = null;
    if (returnTarget && document.contains(returnTarget)) {
      returnTarget.focus({ preventScroll: true });
    }
  }

  function updateLightbox() {
    const artworks = galleryData[lightboxSection] || [];
    const artwork = artworks[lightboxIndex];
    if (!artwork) {
      closeLightbox();
      return;
    }

    lightboxImage.src = artwork.image;
    lightboxImage.alt = artwork.alt;
    lightboxTitle.textContent = artwork.title;
    lightboxMetadata.textContent = `${artwork.year} · ${artwork.medium}`;

    const hasMultiple = artworks.length > 1;
    lightboxPrevious.hidden = !hasMultiple;
    lightboxNext.hidden = !hasMultiple;
  }

  function openLightbox(sectionKey, index, trigger) {
    if (activeOverlay === mobileMenu) {
      closeMobileMenu(false);
    }

    lightboxSection = sectionKey;
    lightboxIndex = index;
    updateLightbox();
    lightbox.hidden = false;
    lockPage(lightbox, trigger);
    lightboxClose.focus({ preventScroll: true });
  }

  function closeLightbox() {
    if (lightbox.hidden) {
      return;
    }
    lightbox.hidden = true;
    lightboxImage.src = "images/favicon/favicon-placeholder.png";
    lightboxImage.alt = "";
    unlockPage();
  }

  function moveLightbox(direction) {
    const artworks = galleryData[lightboxSection] || [];
    if (artworks.length < 2) {
      return;
    }
    lightboxIndex = (lightboxIndex + direction + artworks.length) % artworks.length;
    updateLightbox();
  }

  function openMobileMenu() {
    menuOverlay.hidden = false;
    mobileMenu.inert = false;
    mobileMenu.setAttribute("aria-hidden", "false");
    mobileMenu.classList.add("is-open");
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation menu");
    lockPage(mobileMenu, menuButton);
    mobileMenuClose.focus({ preventScroll: true });
  }

  function closeMobileMenu(restoreFocus = true) {
    if (!mobileMenu.classList.contains("is-open")) {
      return;
    }
    mobileMenu.classList.remove("is-open");
    mobileMenu.inert = true;
    mobileMenu.setAttribute("aria-hidden", "true");
    menuOverlay.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation menu");

    if (restoreFocus) {
      unlockPage();
    } else {
      document.body.classList.remove("is-locked");
      activeOverlay = null;
      overlayReturnFocus = null;
    }
  }

  function setActiveSection(sectionKey) {
    document.querySelectorAll("[data-section-link]").forEach((link) => {
      if (link.dataset.sectionLink === sectionKey) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function updateActiveSection() {
    const sections = [
      ...document.querySelectorAll("[data-page-section]:not([hidden])")
    ];
    if (sections.length === 0) {
      return;
    }

    const marker = window.innerHeight * 0.34;
    let current = sections[0];

    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= marker) {
        current = section;
      }
    });

    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = sections[sections.length - 1];
    }

    setActiveSection(current.dataset.pageSection);
  }

  let scrollFrame = null;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame !== null) {
        return;
      }
      scrollFrame = window.requestAnimationFrame(() => {
        updateActiveSection();
        scrollFrame = null;
      });
    },
    { passive: true }
  );

  menuButton.addEventListener("click", () => {
    if (mobileMenu.classList.contains("is-open")) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });
  mobileMenuClose.addEventListener("click", () => closeMobileMenu());
  menuOverlay.addEventListener("click", () => closeMobileMenu());
  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeMobileMenu());
  });

  lightboxClose.addEventListener("click", closeLightbox);
  lightboxPrevious.addEventListener("click", () => moveLightbox(-1));
  lightboxNext.addEventListener("click", () => moveLightbox(1));
  lightbox.querySelector(".lightbox__stage").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeLightbox();
    }
  });

  lightbox.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary) {
        return;
      }
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
    },
    { passive: true }
  );

  lightbox.addEventListener(
    "pointerup",
    (event) => {
      if (!event.isPrimary) {
        return;
      }
      const deltaX = event.clientX - pointerStartX;
      const deltaY = event.clientY - pointerStartY;

      if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }
      moveLightbox(deltaX > 0 ? -1 : 1);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    trapFocus(event);

    if (event.key === "Escape") {
      if (!lightbox.hidden) {
        closeLightbox();
      } else if (mobileMenu.classList.contains("is-open")) {
        closeMobileMenu();
      }
      return;
    }

    if (!lightbox.hidden && event.key === "ArrowLeft") {
      event.preventDefault();
      moveLightbox(-1);
    } else if (!lightbox.hidden && event.key === "ArrowRight") {
      event.preventDefault();
      moveLightbox(1);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && mobileMenu.classList.contains("is-open")) {
      closeMobileMenu(false);
    }
    updateActiveSection();
  });

  document.querySelectorAll("[data-section-link]").forEach((link) => {
    link.addEventListener("click", () => setActiveSection(link.dataset.sectionLink));
  });

  setActiveSection("animalStudies");
  loadArtworkData().finally(updateActiveSection);
})();
