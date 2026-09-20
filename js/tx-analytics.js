/*
 * TrueXpanse Standard Analytics — vanilla build (static sites)
 * Mirrors the event taxonomy of src/components/Analytics.tsx on Next.js client
 * sites so every Quantum Marketing client reports the SAME events and can be
 * compared side by side.
 *
 * TO ACTIVATE: paste the GA4 Measurement ID below. Until it is set this file
 * loads nothing and records nothing — no tag, no fake events.
 */
(function () {
  "use strict";

  var GA_ID = "";            // e.g. "G-XXXXXXXXXX"
  var ADS_ID = "";           // e.g. "AW-XXXXXXXXX" (optional)
  var ADS_LEAD_LABEL = "";   // e.g. "abcDEFghi" (optional, pairs with ADS_ID)

  /* MAT first-party traffic beacon — counts EVERY visit (direct, Maps, social,
     referral), which Google-organic estimates cannot see. Fires regardless of
     whether GA4 is configured. No cookies, nothing personal collected. */
  try {
    navigator.sendBeacon(
      "https://truexpansemat.com/api/site-visit",
      JSON.stringify({
        t: "3979885038f67c93",
        p: location.pathname,
        s: location.search,
        r: document.referrer
      })
    );
  } catch (e) {}

  if (!GA_ID) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);

  gtag("js", new Date());
  gtag("config", GA_ID);
  if (ADS_ID) gtag("config", ADS_ID);

  function track(name, params) {
    gtag("event", name, params || {});
  }
  window.txTrack = track;

  function pagePath() {
    return window.location.pathname + window.location.search;
  }

  function placement(el) {
    var n = el;
    while (n && n !== document.body) {
      var tag = (n.tagName || "").toLowerCase();
      if (tag === "header" || tag === "nav") return "header";
      if (tag === "footer") return "footer";
      var cls = (typeof n.className === "string" ? n.className : "").toLowerCase();
      if (cls.indexOf("hero") > -1) return "hero";
      if (cls.indexOf("sticky") > -1 || cls.indexOf("float") > -1) return "sticky";
      n = n.parentNode;
    }
    return "body";
  }

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";

    if (href.indexOf("tel:") === 0) {
      track("phone_call_click", {
        phone_number: href.replace("tel:", ""),
        link_placement: placement(a),
        page_path: pagePath()
      });
      return;
    }

    if (href.indexOf("mailto:") === 0) {
      track("email_click", { page_path: pagePath() });
      return;
    }

    if (/\.(pdf|docx?|xlsx?|zip)(\?|$)/i.test(href)) {
      track("file_download", { file_name: href.split("/").pop(), page_path: pagePath() });
      return;
    }

    if (href && /^https?:/i.test(href) && href.indexOf(window.location.hostname) === -1) {
      track("outbound_click", { link_url: href, page_path: pagePath() });
    }
  }, true);

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.tagName !== "FORM") return;
    var nameField = form.querySelector('input[name="form-name"]');
    var formId = (nameField && nameField.value) || form.getAttribute("name") || "unnamed";

    track("generate_lead", {
      form_id: formId,
      page_path: pagePath(),
      lead_type: formId.indexOf("guide") > -1 ? "lead_magnet" : "quote_request"
    });

    if (ADS_ID && ADS_LEAD_LABEL) {
      gtag("event", "conversion", { send_to: ADS_ID + "/" + ADS_LEAD_LABEL });
    }
  }, true);

  var marks = [25, 50, 75, 90];
  var hit = {};
  function onScroll() {
    var doc = document.documentElement;
    var h = doc.scrollHeight - doc.clientHeight;
    if (h <= 0) return;
    var pct = (doc.scrollTop / h) * 100;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (pct >= m && !hit[m]) {
        hit[m] = true;
        track("scroll_depth", { percent_scrolled: m, page_path: pagePath() });
      }
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  var start = Date.now();
  window.addEventListener("beforeunload", function () {
    var secs = Math.round((Date.now() - start) / 1000);
    if (secs >= 10) track("engaged_time", { seconds: secs, page_path: pagePath() });
  });
})();
