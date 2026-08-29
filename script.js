(() => {
  "use strict";

  const VALID_SIZES = new Set(["large", "medium", "small"]);
  const GALLERY_KEYS = [
    "animalStudies",
    "experimentsInColour",
    "lightAndShadowStudies"
  ];
  const EMPTY_GALLERY_MESSAGES = {
    experimentsInColour: "Coming soon."
  };
  const LIGHT_SHADOW_GALLERY_KEY = "lightAndShadowStudies";
  const MAX_VIEWER_SCALE = 8;
  const MIN_VIEWER_SCALE = 1;
  const DETAIL_VIEW_SCALE = 2.75;
  const VIEWER_ZOOM_EPSILON = 0.01;
  const shouldOpenAtAnimalStudies = window.location.hash === "";

  const galleryData = {};
  const galleryElements = new Map(
    [...document.querySelectorAll("[data-gallery]")].map((element) => [
      element.dataset.gallery,
      element
    ])
  );

  const lightbox = document.querySelector("#artwork-lightbox");
  const lightboxImage = lightbox.querySelector(".lightbox__image");
  const lightboxStage = lightbox.querySelector(".lightbox__stage");
  const lightboxTitle = lightbox.querySelector("#lightbox-title");
  const lightboxMetadata = lightbox.querySelector(".lightbox__metadata");
  const lightboxStatus = lightbox.querySelector("#lightbox-status");
  const lightboxClose = lightbox.querySelector(".lightbox__close");
  const lightboxPrevious = lightbox.querySelector(".lightbox__previous");
  const lightboxNext = lightbox.querySelector(".lightbox__next");
  const lightboxZoomToggle = lightbox.querySelector(".lightbox__zoom-toggle");

  const menuButton = document.querySelector(".menu-button");
  const mobileMenu = document.querySelector(".mobile-menu");
  const mobileMenuClose = document.querySelector(".mobile-menu__close");
  const menuOverlay = document.querySelector(".menu-overlay");

  let activeOverlay = null;
  let overlayReturnFocus = null;
  let lightboxSection = null;
  let lightboxIndex = 0;
  let viewerScale = 1;
  let viewerPanX = 0;
  let viewerPanY = 0;
  let viewerGestureStart = null;
  let viewerGestureHadMultiplePointers = false;
  let suppressViewerClick = false;
  let viewerHoverFrame = null;
  let viewerHoverPosition = null;
  let lightShadowLayoutFrame = null;
  const viewerPointers = new Map();

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

  function imageSizes(size) {
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
    if (artwork.sectionKey === LIGHT_SHADOW_GALLERY_KEY) {
      scheduleLightShadowLayout();
    }
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
    image.sizes = imageSizes(artwork.size);

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
    if (artwork.sectionKey === LIGHT_SHADOW_GALLERY_KEY) {
      image.addEventListener("load", scheduleLightShadowLayout, { once: true });
    }
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

  function showEmptyGalleryMessage(sectionKey, gallery) {
    const section = document.querySelector(`[data-gallery-section="${sectionKey}"]`);
    if (section) {
      section.hidden = false;
    }
    document.querySelectorAll(`[data-nav-item="${sectionKey}"]`).forEach((item) => {
      item.hidden = false;
    });

    gallery.classList.remove("gallery");
    gallery.classList.add("section-introduction");
    gallery.textContent = EMPTY_GALLERY_MESSAGES[sectionKey];
  }

  function layoutLightShadowGallery() {
    const gallery = galleryElements.get(LIGHT_SHADOW_GALLERY_KEY);
    if (!gallery) {
      return;
    }

    const artworks = [...gallery.querySelectorAll(".artwork")];
    artworks.forEach((artwork) => {
      artwork.style.removeProperty("grid-row-end");
    });

    const galleryStyles = window.getComputedStyle(gallery);
    if (galleryStyles.display !== "grid" || artworks.length === 0) {
      return;
    }

    const rowHeight = Number.parseFloat(galleryStyles.gridAutoRows);
    const rowGap = Number.parseFloat(galleryStyles.rowGap);
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      return;
    }

    const effectiveGap = Number.isFinite(rowGap) ? rowGap : 0;
    const rowUnit = rowHeight + effectiveGap;
    const artworkHeights = artworks.map(
      (artwork) => artwork.getBoundingClientRect().height
    );

    artworks.forEach((artwork, index) => {
      const rowSpan = Math.max(
        1,
        Math.ceil((artworkHeights[index] + effectiveGap) / rowUnit)
      );
      artwork.style.gridRowEnd = `span ${rowSpan}`;
    });
  }

  function scheduleLightShadowLayout() {
    if (lightShadowLayoutFrame !== null) {
      return;
    }

    lightShadowLayoutFrame = window.requestAnimationFrame(() => {
      lightShadowLayoutFrame = null;
      layoutLightShadowGallery();
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

      if (!gallery) {
        hideEmptySection(sectionKey);
        return;
      }

      if (artworks.length === 0) {
        if (EMPTY_GALLERY_MESSAGES[sectionKey]) {
          showEmptyGalleryMessage(sectionKey, gallery);
        } else {
          hideEmptySection(sectionKey);
        }
        return;
      }

      const fragment = document.createDocumentFragment();
      artworks.forEach((artwork, index) => {
        fragment.append(createArtworkElement(artwork, index));
      });
      gallery.replaceChildren(fragment);
      if (sectionKey === LIGHT_SHADOW_GALLERY_KEY) {
        scheduleLightShadowLayout();
      }
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

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function viewerIsZoomed() {
    return viewerScale > MIN_VIEWER_SCALE + VIEWER_ZOOM_EPSILON;
  }

  function viewerPanLimits(scale = viewerScale) {
    return {
      x: Math.max(0, (lightboxImage.offsetWidth * scale - lightboxStage.clientWidth) / 2),
      y: Math.max(0, (lightboxImage.offsetHeight * scale - lightboxStage.clientHeight) / 2)
    };
  }

  function announceViewerStatus(message) {
    lightboxStatus.textContent = "";
    window.requestAnimationFrame(() => {
      lightboxStatus.textContent = message;
    });
  }

  function updateViewerControls() {
    const isZoomed = viewerIsZoomed();
    lightboxStage.classList.toggle("is-zoomed", isZoomed);
    lightboxZoomToggle.textContent = isZoomed ? "Fit" : "Zoom";
    lightboxZoomToggle.setAttribute("aria-pressed", String(isZoomed));
    lightboxZoomToggle.setAttribute(
      "aria-label",
      isZoomed ? "Fit artwork to screen" : "Open artwork detail view"
    );
  }

  function setViewerView(scale, panX, panY, announcement = "") {
    viewerScale = clamp(scale, MIN_VIEWER_SCALE, MAX_VIEWER_SCALE);
    const limits = viewerPanLimits(viewerScale);
    viewerPanX = clamp(panX, -limits.x, limits.x);
    viewerPanY = clamp(panY, -limits.y, limits.y);

    lightboxImage.style.transform =
      `translate3d(${viewerPanX}px, ${viewerPanY}px, 0) scale(${viewerScale})`;
    updateViewerControls();

    if (announcement) {
      announceViewerStatus(announcement);
    }
  }

  function resetViewer(announce = false) {
    viewerPointers.clear();
    viewerGestureStart = null;
    viewerGestureHadMultiplePointers = false;
    suppressViewerClick = false;
    viewerHoverPosition = null;
    if (viewerHoverFrame !== null) {
      window.cancelAnimationFrame(viewerHoverFrame);
      viewerHoverFrame = null;
    }
    setViewerView(1, 0, 0, announce ? "Artwork fitted to screen." : "");
  }

  function zoomViewerAt(scale, clientX, clientY, announcement = "") {
    const stageBounds = lightboxStage.getBoundingClientRect();
    if (!stageBounds.width || !stageBounds.height) {
      return;
    }

    const nextScale = clamp(scale, MIN_VIEWER_SCALE, MAX_VIEWER_SCALE);
    const stageCentreX = stageBounds.left + stageBounds.width / 2;
    const stageCentreY = stageBounds.top + stageBounds.height / 2;
    const artworkPointX = (clientX - stageCentreX - viewerPanX) / viewerScale;
    const artworkPointY = (clientY - stageCentreY - viewerPanY) / viewerScale;
    const nextPanX = clientX - stageCentreX - artworkPointX * nextScale;
    const nextPanY = clientY - stageCentreY - artworkPointY * nextScale;

    setViewerView(nextScale, nextPanX, nextPanY, announcement);
  }

  function toggleDetailView(clientX, clientY) {
    if (viewerIsZoomed()) {
      resetViewer(true);
      return;
    }

    const stageBounds = lightboxStage.getBoundingClientRect();
    const zoomX = Number.isFinite(clientX)
      ? clientX
      : stageBounds.left + stageBounds.width / 2;
    const zoomY = Number.isFinite(clientY)
      ? clientY
      : stageBounds.top + stageBounds.height / 2;
    zoomViewerAt(
      DETAIL_VIEW_SCALE,
      zoomX,
      zoomY,
      "Artwork detail view opened at 275% of fitted size."
    );
  }

  function panViewerWithCursor(clientX, clientY) {
    viewerHoverPosition = { x: clientX, y: clientY };
    if (viewerHoverFrame !== null) {
      return;
    }

    viewerHoverFrame = window.requestAnimationFrame(() => {
      viewerHoverFrame = null;
      if (!viewerHoverPosition || !viewerIsZoomed() || lightbox.hidden) {
        return;
      }

      const stageBounds = lightboxStage.getBoundingClientRect();
      if (!stageBounds.width || !stageBounds.height) {
        return;
      }

      const relativeX = clamp(
        (viewerHoverPosition.x - stageBounds.left) / stageBounds.width,
        0,
        1
      );
      const relativeY = clamp(
        (viewerHoverPosition.y - stageBounds.top) / stageBounds.height,
        0,
        1
      );
      const limits = viewerPanLimits();
      setViewerView(
        viewerScale,
        (0.5 - relativeX) * 2 * limits.x,
        (0.5 - relativeY) * 2 * limits.y
      );
    });
  }

  function handleViewerWheel(event) {
    if (lightbox.hidden) {
      return;
    }

    event.preventDefault();
    const deltaMultiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
    const zoomFactor = Math.exp(-event.deltaY * deltaMultiplier * 0.0015);
    zoomViewerAt(viewerScale * zoomFactor, event.clientX, event.clientY);
  }

  function pointerDistance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function pointerMidpoint(first, second) {
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2
    };
  }

  function handleViewerPointerDown(event) {
    if (event.pointerType === "mouse") {
      return;
    }

    const pointer = {
      x: event.clientX,
      y: event.clientY,
      previousX: event.clientX,
      previousY: event.clientY
    };
    viewerPointers.set(event.pointerId, pointer);
    lightboxStage.setPointerCapture(event.pointerId);

    if (viewerPointers.size === 1) {
      viewerGestureStart = { x: event.clientX, y: event.clientY };
      viewerGestureHadMultiplePointers = false;
      suppressViewerClick = false;
    } else {
      viewerGestureHadMultiplePointers = true;
      suppressViewerClick = true;
    }
  }

  function handleViewerPointerMove(event) {
    const pointer = viewerPointers.get(event.pointerId);
    if (!pointer) {
      if (
        event.pointerType === "mouse" &&
        event.target === lightboxImage &&
        viewerIsZoomed()
      ) {
        panViewerWithCursor(event.clientX, event.clientY);
      }
      return;
    }

    const previousPointers = [...viewerPointers.values()].map((item) => ({ ...item }));
    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (
      viewerGestureStart &&
      Math.hypot(
        event.clientX - viewerGestureStart.x,
        event.clientY - viewerGestureStart.y
      ) > 5
    ) {
      suppressViewerClick = true;
    }

    const currentPointers = [...viewerPointers.values()];
    if (currentPointers.length >= 2) {
      event.preventDefault();
      const oldFirst = {
        x: previousPointers[0].x,
        y: previousPointers[0].y
      };
      const oldSecond = {
        x: previousPointers[1].x,
        y: previousPointers[1].y
      };
      const newFirst = currentPointers[0];
      const newSecond = currentPointers[1];
      const oldDistance = pointerDistance(oldFirst, oldSecond);
      const newDistance = pointerDistance(newFirst, newSecond);

      if (oldDistance > 0 && newDistance > 0) {
        const oldMidpoint = pointerMidpoint(oldFirst, oldSecond);
        const newMidpoint = pointerMidpoint(newFirst, newSecond);
        const stageBounds = lightboxStage.getBoundingClientRect();
        const stageCentreX = stageBounds.left + stageBounds.width / 2;
        const stageCentreY = stageBounds.top + stageBounds.height / 2;
        const artworkPointX =
          (oldMidpoint.x - stageCentreX - viewerPanX) / viewerScale;
        const artworkPointY =
          (oldMidpoint.y - stageCentreY - viewerPanY) / viewerScale;
        const nextScale = clamp(
          viewerScale * (newDistance / oldDistance),
          MIN_VIEWER_SCALE,
          MAX_VIEWER_SCALE
        );
        const nextPanX =
          newMidpoint.x - stageCentreX - artworkPointX * nextScale;
        const nextPanY =
          newMidpoint.y - stageCentreY - artworkPointY * nextScale;
        setViewerView(nextScale, nextPanX, nextPanY);
      }
      return;
    }

    if (viewerIsZoomed()) {
      event.preventDefault();
      setViewerView(
        viewerScale,
        viewerPanX + event.clientX - pointer.previousX,
        viewerPanY + event.clientY - pointer.previousY
      );
    }
  }

  function finishViewerPointer(event) {
    const pointer = viewerPointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    const start = viewerGestureStart;
    const canSwipe =
      viewerPointers.size === 1 &&
      !viewerGestureHadMultiplePointers &&
      !viewerIsZoomed() &&
      start;

    viewerPointers.delete(event.pointerId);
    if (lightboxStage.hasPointerCapture(event.pointerId)) {
      lightboxStage.releasePointerCapture(event.pointerId);
    }

    if (canSwipe) {
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (Math.abs(deltaX) >= 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
        moveLightbox(deltaX > 0 ? -1 : 1);
        suppressViewerClick = true;
      }
    }

    if (viewerPointers.size === 0) {
      viewerGestureStart = null;
      viewerGestureHadMultiplePointers = false;
    } else {
      const remainingPointer = [...viewerPointers.values()][0];
      remainingPointer.previousX = remainingPointer.x;
      remainingPointer.previousY = remainingPointer.y;
    }
  }

  function updateLightbox() {
    const artworks = galleryData[lightboxSection] || [];
    const artwork = artworks[lightboxIndex];
    if (!artwork) {
      closeLightbox();
      return;
    }

    resetViewer();
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
    resetViewer();
    lightbox.hidden = true;
    lightboxImage.src = "images/favicon/favicon-placeholder.png";
    lightboxImage.alt = "";
    lightboxStatus.textContent = "";
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

  function positionInitialSection() {
    if (
      !shouldOpenAtAnimalStudies ||
      (window.location.hash && window.location.hash !== "#animal-studies")
    ) {
      return;
    }

    const animalStudies = document.querySelector("#animal-studies");
    if (!animalStudies) {
      return;
    }

    window.history.replaceState(null, "", "#animal-studies");
    animalStudies.scrollIntoView();
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
  lightboxZoomToggle.addEventListener("click", () => toggleDetailView());
  lightboxImage.addEventListener("load", () => {
    if (!lightbox.hidden) {
      setViewerView(viewerScale, viewerPanX, viewerPanY);
    }
  });
  lightboxImage.addEventListener("dragstart", (event) => event.preventDefault());
  lightboxImage.addEventListener("click", (event) => {
    event.stopPropagation();
    if (suppressViewerClick) {
      suppressViewerClick = false;
      return;
    }
    toggleDetailView(event.clientX, event.clientY);
  });
  lightboxStage.addEventListener("wheel", handleViewerWheel, { passive: false });
  lightboxStage.addEventListener("pointerdown", handleViewerPointerDown);
  lightboxStage.addEventListener("pointermove", handleViewerPointerMove, {
    passive: false
  });
  lightboxStage.addEventListener("pointerup", finishViewerPointer);
  lightboxStage.addEventListener("pointercancel", finishViewerPointer);
  lightboxStage.addEventListener("click", (event) => {
    if (suppressViewerClick) {
      suppressViewerClick = false;
      return;
    }
    if (event.target === event.currentTarget) {
      closeLightbox();
    }
  });

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
    if (!lightbox.hidden) {
      setViewerView(viewerScale, viewerPanX, viewerPanY);
    }
    scheduleLightShadowLayout();
    updateActiveSection();
  });

  document.querySelectorAll("[data-section-link]").forEach((link) => {
    link.addEventListener("click", () => setActiveSection(link.dataset.sectionLink));
  });

  const requestedSection = [...document.querySelectorAll("[data-page-section]")].find(
    (section) => `#${section.id}` === window.location.hash
  );

  positionInitialSection();
  if (shouldOpenAtAnimalStudies) {
    window.addEventListener("load", positionInitialSection, { once: true });
  }

  setActiveSection(requestedSection?.dataset.pageSection || "animalStudies");
  if (document.fonts) {
    document.fonts.ready.then(scheduleLightShadowLayout);
  }
  loadArtworkData().finally(updateActiveSection);
})();
