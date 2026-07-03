"use strict";

/*
  NIVO WEB — MAIN JS
  Producción estática:
  - Header dinámico
  - Menú móvil accesible
  - Scroll suave con offset
  - FAQ interactivo
  - Animaciones reveal
  - Scroll spy
  - Año automático
  - Efecto premium en cards
  - Mejora de formulario Netlify
*/

document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const header = document.getElementById("header");
  const menuBtn = document.getElementById("menuBtn");
  const mobilePanel = document.getElementById("mobilePanel");
  const year = document.getElementById("year");

  const faqItems = document.querySelectorAll(".faq-item");
  const revealItems = document.querySelectorAll(".reveal");
  const allInternalLinks = document.querySelectorAll('a[href^="#"]');
  const desktopNavLinks = document.querySelectorAll('.nav-links a[href^="#"]');
  const mobileNavLinks = document.querySelectorAll('.mobile-links a[href^="#"]');
  const contactForm = document.querySelector(".contact-form");

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* =========================================================
     FOOTER YEAR
  ========================================================= */

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  /* =========================================================
     HEADER STATE
  ========================================================= */

  const setHeaderState = () => {
    if (!header) return;

    if (window.scrollY > 16) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  };

  setHeaderState();

  window.addEventListener("scroll", setHeaderState, {
    passive: true,
  });

  /* =========================================================
     MOBILE MENU
  ========================================================= */

  const isMobileMenuOpen = () => {
    return Boolean(mobilePanel && mobilePanel.classList.contains("active"));
  };

  const openMobileMenu = () => {
    if (!mobilePanel || !menuBtn) return;

    mobilePanel.classList.add("active");
    menuBtn.classList.add("active");
    body.classList.add("no-scroll");

    menuBtn.setAttribute("aria-expanded", "true");
    mobilePanel.setAttribute("aria-hidden", "false");
  };

  const closeMobileMenu = () => {
    if (!mobilePanel || !menuBtn) return;

    mobilePanel.classList.remove("active");
    menuBtn.classList.remove("active");
    body.classList.remove("no-scroll");

    menuBtn.setAttribute("aria-expanded", "false");
    mobilePanel.setAttribute("aria-hidden", "true");
  };

  if (menuBtn && mobilePanel) {
    menuBtn.addEventListener("click", () => {
      if (isMobileMenuOpen()) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    mobilePanel.addEventListener("click", (event) => {
      const target = event.target;

      if (target instanceof HTMLAnchorElement) {
        closeMobileMenu();
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMobileMenuOpen()) {
        closeMobileMenu();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1120 && isMobileMenuOpen()) {
        closeMobileMenu();
      }
    });
  }

  /* =========================================================
     SMOOTH SCROLL WITH HEADER OFFSET
  ========================================================= */

  const getHeaderOffset = () => {
    return header ? header.offsetHeight : 0;
  };

  allInternalLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");

      if (!href || href === "#") return;

      const target = document.querySelector(href);

      if (!target) return;

      event.preventDefault();

      const targetPosition =
        target.getBoundingClientRect().top +
        window.scrollY -
        getHeaderOffset() +
        8;

      window.scrollTo({
        top: targetPosition,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });

      closeMobileMenu();
    });
  });

  /* =========================================================
     FAQ ACCORDION
  ========================================================= */

  faqItems.forEach((item) => {
    const button = item.querySelector(".faq-question");

    if (!button) return;

    const isActive = item.classList.contains("active");
    button.setAttribute("aria-expanded", isActive ? "true" : "false");

    button.addEventListener("click", () => {
      const currentlyActive = item.classList.contains("active");

      faqItems.forEach((otherItem) => {
        const otherButton = otherItem.querySelector(".faq-question");

        otherItem.classList.remove("active");

        if (otherButton) {
          otherButton.setAttribute("aria-expanded", "false");
        }
      });

      if (!currentlyActive) {
        item.classList.add("active");
        button.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* =========================================================
     REVEAL ANIMATIONS
  ========================================================= */

  if (prefersReducedMotion) {
    revealItems.forEach((item) => {
      item.classList.add("visible");
    });
  } else if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.12,
        rootMargin: "0px 0px -46px 0px",
      }
    );

    revealItems.forEach((item, index) => {
      const delay = Math.min(index * 28, 220);
      item.style.transitionDelay = `${delay}ms`;
      revealObserver.observe(item);
    });
  } else {
    revealItems.forEach((item) => {
      item.classList.add("visible");
    });
  }

  /* =========================================================
     SCROLL SPY
  ========================================================= */

  const spySections = Array.from(
    document.querySelectorAll(
      "#servicios, #usuarios, #conductores, #comercios, #agentes, #seguridad, #zonas, #faq"
    )
  );

  const clearActiveNav = () => {
    desktopNavLinks.forEach((link) => link.classList.remove("active"));
    mobileNavLinks.forEach((link) => link.classList.remove("active"));
  };

  const setActiveNav = (sectionId) => {
    clearActiveNav();

    const desktopLink = document.querySelector(
      `.nav-links a[href="#${sectionId}"]`
    );

    const mobileLink = document.querySelector(
      `.mobile-links a[href="#${sectionId}"]`
    );

    if (desktopLink) {
      desktopLink.classList.add("active");
    }

    if (mobileLink) {
      mobileLink.classList.add("active");
    }
  };

  if ("IntersectionObserver" in window && spySections.length > 0) {
    const spyObserver = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visibleEntries.length === 0) return;

        const activeSection = visibleEntries[0].target;

        if (activeSection && activeSection.id) {
          setActiveNav(activeSection.id);
        }
      },
      {
        threshold: [0.22, 0.35, 0.5, 0.65],
        rootMargin: "-20% 0px -58% 0px",
      }
    );

    spySections.forEach((section) => spyObserver.observe(section));
  }

  /* =========================================================
     PREMIUM MOUSE LIGHT EFFECT
  ========================================================= */

  const interactiveCards = document.querySelectorAll(
    ".service-card, .visual-card, .security-card, .zone-card, .dashboard-preview-card, .contact-copy, .contact-form"
  );

  interactiveCards.forEach((card) => {
    card.addEventListener("mousemove", (event) => {
      if (window.innerWidth <= 900) return;

      const rect = card.getBoundingClientRect();

      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      card.style.setProperty("--mouse-x", `${x}%`);
      card.style.setProperty("--mouse-y", `${y}%`);
    });

    card.addEventListener("mouseleave", () => {
      card.style.removeProperty("--mouse-x");
      card.style.removeProperty("--mouse-y");
    });
  });

  /* =========================================================
     IMAGE LOADING STATE
  ========================================================= */

  const lazyImages = document.querySelectorAll("img[loading='lazy']");

  lazyImages.forEach((image) => {
    image.addEventListener(
      "load",
      () => {
        image.classList.add("is-loaded");
      },
      { once: true }
    );

    if (image.complete) {
      image.classList.add("is-loaded");
    }
  });

  /* =========================================================
     NETLIFY FORM ENHANCEMENT
     No bloquea el submit. Netlify procesa el formulario.
  ========================================================= */

  if (contactForm) {
    const submitButton = contactForm.querySelector("button[type='submit']");

    contactForm.addEventListener("submit", () => {
      if (!submitButton) return;

      submitButton.disabled = true;
      submitButton.classList.add("is-submitting");

      const originalText = submitButton.innerHTML;

      submitButton.dataset.originalText = originalText;
      submitButton.innerHTML = "Enviando información...";

      setTimeout(() => {
        if (!submitButton) return;

        submitButton.disabled = false;
        submitButton.classList.remove("is-submitting");

        if (submitButton.dataset.originalText) {
          submitButton.innerHTML = submitButton.dataset.originalText;
        }
      }, 8000);
    });
  }

  /* =========================================================
     LOCAL ADMIN SAFETY MESSAGE
  ========================================================= */

  const adminLinks = document.querySelectorAll('a[href="admin/login.html"]');

  adminLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const isLocalFile = window.location.protocol === "file:";

      if (!isLocalFile) return;

      event.preventDefault();

      alert(
        "El acceso Admin se activará cuando creemos admin/login.html y subamos el sitio a Netlify."
      );
    });
  });

  /* =========================================================
     ACCESSIBILITY FOCUS MANAGEMENT
  ========================================================= */

  document.addEventListener("focusin", (event) => {
    if (!isMobileMenuOpen()) return;
    if (!mobilePanel || !menuBtn) return;

    const target = event.target;

    if (!(target instanceof HTMLElement)) return;

    const focusInsideMenu = mobilePanel.contains(target);
    const focusOnButton = menuBtn.contains(target);

    if (!focusInsideMenu && !focusOnButton) {
      closeMobileMenu();
    }
  });
});