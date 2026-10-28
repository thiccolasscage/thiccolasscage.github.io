(function () {
  "use strict";

  var AGE_KEY = "nsfw-theme-spin-age-ok";
  var SEEN_KEY = "nsfw-theme-spin-seen";
  var CATALOG_MODE_KEY = "nsfw-theme-spin-catalog-mode";
  var HEAT_HINT = {
    soft: "Soft only. Suggestive and explicit stay hidden.",
    suggestive: "Soft and suggestive. Explicit stays hidden.",
    explicit: "Soft, suggestive, and explicit.",
  };
  var CATALOG_MODES = [
    {
      id: "reddit",
      label: "Reddit",
      detail: "Communities and subs",
      lanePhrase: "reddit",
      note: "Reddit mode · reddit only",
      lanes: ["reddit"],
    },
    {
      id: "movies",
      label: "Movies",
      detail: "Theatrical films with posters",
      lanePhrase: "mainstream",
      note: "Movies mode · mainstream only",
      lanes: ["mainstream"],
    },
    {
      id: "studio",
      label: "Studio",
      detail: "Adult studio scenes, explicit heat",
      lanePhrase: "studio",
      note: "Studio mode · studio only",
      lanes: ["studio"],
    },
    {
      id: "streamer",
      label: "Streamer",
      detail: "Streamer and clip-style titles",
      lanePhrase: "streamer",
      note: "Streamer mode · streamer only",
      lanes: ["streamer"],
    },
    {
      id: "everything",
      label: "Everything",
      detail: "All four lanes",
      lanePhrase: "every lane",
      note: "Everything · all lanes",
      lanes: ["mainstream", "studio", "streamer", "reddit"],
    },
  ];

  var catalog = window.NSFW_CATALOG;
  var engine = catalog && window.SpinLogic ? window.SpinLogic.createEngine(catalog) : null;

  var state = {
    lanes: { mainstream: true, studio: true, streamer: true, reddit: true },
    heatMax: "suggestive",
    minScore: 60,
    query: "",
    hideSeen: true,
    themeId: null,
    packId: null,
    seen: new Set(),
    mode: "spin",
    featureId: null,
    drawnIds: [],
    shelfLabel: "",
    dilemma: { leftId: null, rightId: null, seeds: [], round: 0 },
    night: { packId: "soft", featureId: null, byPack: {}, notice: "", copyText: "" },
    spinning: false,
    spinTimer: 0,
    catalogMode: null,
    catalogModeChosen: false,
    moodOpen: false,
  };

  var ui = {};

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  function loadSeen() {
    var known = {};
    catalog.titles.forEach(function (title) { known[title.id] = true; });
    try {
      var parsed = JSON.parse(storeGet(SEEN_KEY) || "[]");
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter(function (id) { return typeof id === "string" && known[id]; }));
    } catch (err) {
      return new Set();
    }
  }

  function saveSeen() {
    storeSet(SEEN_KEY, JSON.stringify(Array.from(state.seen)));
  }

  function catalogModeById(id) {
    for (var i = 0; i < CATALOG_MODES.length; i += 1) {
      if (CATALOG_MODES[i].id === id) return CATALOG_MODES[i];
    }
    return null;
  }

  function catalogModeMeta() {
    return catalogModeById(state.catalogMode) || catalogModeById("everything");
  }

  function isCatalogLocked() {
    return !!state.catalogMode && state.catalogMode !== "everything";
  }

  function lanesFromList(ids) {
    var lanes = { mainstream: false, studio: false, streamer: false, reddit: false };
    ids.forEach(function (id) { lanes[id] = true; });
    return lanes;
  }

  function effectiveLanes() {
    if (!isCatalogLocked()) return state.lanes;
    return lanesFromList(catalogModeMeta().lanes);
  }

  function countInLanes(lanes) {
    var total = 0;
    catalog.titles.forEach(function (title) {
      if (lanes[title.lane]) total += 1;
    });
    return total;
  }

  function modeCatalogCount(mode) {
    return countInLanes(lanesFromList(mode.lanes));
  }

  function loadCatalogMode() {
    var value = storeGet(CATALOG_MODE_KEY);
    return catalogModeById(value) ? value : null;
  }

  function filters() {
    return {
      lanes: effectiveLanes(),
      heatMax: state.heatMax,
      minScore: state.minScore,
      query: state.query,
      hideSeen: state.hideSeen,
      seen: state.seen,
      themeId: state.themeId,
      packId: state.packId,
    };
  }

  function hottestHeat() {
    var hottest = catalog.heats[0];
    catalog.heats.forEach(function (heat) {
      if (engine.ranks[heat.id] > engine.ranks[hottest.id]) hottest = heat;
    });
    return hottest;
  }

  function modeHeatGap() {
    var lanes = effectiveLanes();
    var inLane = catalog.titles.filter(function (title) { return lanes[title.lane]; });
    if (!inLane.length) return null;
    var visible = inLane.some(function (title) {
      return engine.ranks[title.heat] <= engine.ranks[state.heatMax];
    });
    if (visible) return null;
    var ordered = catalog.heats.slice().sort(function (a, b) { return a.rank - b.rank; });
    for (var i = 0; i < ordered.length; i += 1) {
      var heat = ordered[i];
      if (engine.ranks[heat.id] <= engine.ranks[state.heatMax]) continue;
      var opens = inLane.some(function (title) {
        return engine.ranks[title.heat] <= engine.ranks[heat.id];
      });
      if (opens) return heat;
    }
    return null;
  }

  function syncCatalogOffset() {
    if (!ui.catalogBar) return;
    document.documentElement.style.setProperty("--catalog-offset", ui.catalogBar.offsetHeight + "px");
  }

  function activePool() {
    return engine.pool(filters());
  }

  function stopMotion() {
    window.clearInterval(state.spinTimer);
    state.spinning = false;
  }

  function idsInPool(pool) {
    var ids = {};
    pool.forEach(function (title) { ids[title.id] = true; });
    return ids;
  }

  function titleById(id) {
    return id ? engine.titleById[id] : null;
  }

  function laneMeta(id) {
    for (var i = 0; i < catalog.lanes.length; i += 1) {
      if (catalog.lanes[i].id === id) return catalog.lanes[i];
    }
    return { id: id, label: id };
  }

  function heatMeta(id) {
    for (var i = 0; i < catalog.heats.length; i += 1) {
      if (catalog.heats[i].id === id) return catalog.heats[i];
    }
    return { id: id, label: id };
  }

  function themeMeta(id) {
    for (var i = 0; i < catalog.themes.length; i += 1) {
      if (catalog.themes[i].id === id) return catalog.themes[i];
    }
    return { id: id, label: id, keyword: id };
  }

  function currentPack() {
    return state.packId ? engine.packById(state.packId) : null;
  }

  function runtimeText(title) {
    if (title.lane === "reddit") return "pack";
    var hours = Math.floor(title.runtimeMin / 60);
    var minutes = title.runtimeMin % 60;
    if (hours === 0) return minutes + "m";
    if (minutes === 0) return hours + "h";
    return hours + "h " + minutes + "m";
  }

  function hostOf(href) {
    if (href.indexOf("reddit://") === 0) return "reddit app";
    try { return new URL(href).hostname.replace(/^www\./, ""); } catch (err) { return "link"; }
  }

  function safeUrl(href) {
    if (typeof href !== "string") return null;
    if (href.indexOf("reddit://reddit/") === 0) return href;
    try {
      var url = new URL(href);
      if (url.protocol === "https:" || url.protocol === "http:") return href;
    } catch (err) {
      return null;
    }
    return null;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    var data = attrs || {};
    Object.keys(data).forEach(function (key) {
      var value = data[key];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "dataset") {
        Object.keys(value).forEach(function (name) { node.dataset[name] = value[name]; });
      } else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    });
    for (var i = 2; i < arguments.length; i += 1) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function poster(title, className) {
    var frame = el("div", { class: "poster " + (className || "") + " lane-" + title.lane });
    frame.append(el("span", { class: "score-pill", text: String(title.score) }));
    if (state.seen.has(title.id)) frame.append(el("span", { class: "seen-flag", text: "Seen" }));
    if (title.posterKey) {
      var img = el("img", {
        src: "posters/" + encodeURIComponent(title.posterKey) + ".jpg",
        alt: "Poster for " + title.name,
      });
      img.addEventListener("error", function () {
        img.remove();
        frame.classList.add("is-placeholder");
        frame.append(placeholder(title));
      });
      frame.append(img);
    } else {
      frame.classList.add("is-placeholder");
      frame.append(placeholder(title));
    }
    return frame;
  }

  function placeholder(title) {
    var source = title.name.replace(/^r\//, "");
    return el("div", { class: "ph" },
      el("span", { class: "ph-lane", text: laneMeta(title.lane).label }),
      el("span", { class: "ph-letter", text: source.slice(0, 1).toUpperCase() }),
      el("span", { class: "ph-name", text: title.name })
    );
  }

  function openReddit(href, links) {
    var web = null;
    links.forEach(function (link) {
      var safe = safeUrl(link.href);
      if (!web && safe && safe.indexOf("https://") === 0) web = safe;
    });
    var frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.src = href;
    document.body.append(frame);
    window.setTimeout(function () {
      frame.remove();
      if (web && document.visibilityState === "visible") {
        window.open(web, "_blank", "noopener,noreferrer");
      }
    }, 800);
  }

  function watchLinks(title) {
    var wrap = el("div", { class: "links" });
    var links = Array.isArray(title.links) ? title.links : [];
    links.forEach(function (link) {
      var href = safeUrl(link.href);
      if (!href) return;
      var label = link.label || hostOf(href);
      if (href.indexOf("reddit://") === 0) {
        var button = el("button", { type: "button", class: "watch-link" },
          el("span", { class: "watch-label", text: label }),
          el("span", { class: "watch-host", text: "Try app, then web" })
        );
        button.addEventListener("click", function () { openReddit(href, links); });
        wrap.append(button);
        return;
      }
      wrap.append(el("a", {
        class: "watch-link",
        href: href,
        target: "_blank",
        rel: "noopener noreferrer",
      },
        el("span", { class: "watch-label", text: label }),
        el("span", { class: "watch-host", text: hostOf(href) })
      ));
    });
    return wrap;
  }

  function genreBlock(title) {
    var wrap = el("div", { class: "genres" });
    (title.genres || []).forEach(function (genre) {
      var score = Math.max(0, Math.min(100, Number(genre.score) || 0));
      var bar = el("div", { class: "genre-bar" });
      var fill = el("span");
      fill.style.width = score + "%";
      bar.append(fill);
      wrap.append(el("div", { class: "genre" },
        el("div", { class: "genre-top" },
          el("span", { text: genre.label }),
          el("span", { text: String(score) })
        ),
        bar
      ));
    });
    return wrap;
  }

  function tagRow(title) {
    var row = el("div", { class: "tag-row" });
    row.append(el("span", { class: "tag", text: laneMeta(title.lane).label }));
    row.append(el("span", { class: "tag heat-" + title.heat, text: heatMeta(title.heat).label }));
    if (title.tag) row.append(el("span", { class: "tag", text: title.tag }));
    title.themes.forEach(function (themeId) {
      var theme = themeMeta(themeId);
      var chip = el("button", { type: "button", class: "tag", text: theme.label });
      chip.addEventListener("click", function () { selectTheme(themeId); });
      row.append(chip);
    });
    return row;
  }

  function seenButton(title) {
    var seen = state.seen.has(title.id);
    var button = el("button", {
      type: "button",
      class: seen ? "btn btn-primary" : "btn btn-ghost",
      text: seen ? "Seen" : "Mark seen",
    });
    button.addEventListener("click", function () { toggleSeen(title.id); });
    return button;
  }

  function detailCard(title) {
    return el("article", { class: "stage-card feature", dataset: { titleId: title.id } },
      poster(title, "poster-lg"),
      el("div", { class: "feature-copy" },
        el("h2", { class: "title", text: title.name }),
        el("p", { class: "meta", text: title.year + " · " + runtimeText(title) + " · score " + title.score }),
        el("p", { class: "why", text: title.why || "" }),
        tagRow(title),
        genreBlock(title),
        watchLinks(title),
        el("div", { class: "actions" },
          seenButton(title),
          el("button", { type: "button", class: "btn btn-ghost", text: "Spin again" })
        )
      )
    );
  }

  function wireSpinAgain(card, handler) {
    var buttons = card.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].textContent === "Spin again") {
        buttons[i].addEventListener("click", handler || spin);
      }
    }
  }

  function renderSpin(pool) {
    var inPool = idsInPool(pool);
    var feature = titleById(state.featureId);
    if (feature && !inPool[feature.id] && !state.spinning) {
      feature = null;
      state.featureId = null;
    }
    if (!feature && state.drawnIds.length) {
      for (var i = 0; i < state.drawnIds.length; i += 1) {
        var candidate = titleById(state.drawnIds[i]);
        if (candidate && inPool[candidate.id]) {
          feature = candidate;
          state.featureId = candidate.id;
          break;
        }
      }
    }
    if (!feature && pool.length && !state.spinning) {
      feature = pool[0];
      state.featureId = feature.id;
    }
    if (!pool.length && !feature) {
      appendEmpty(emptyCopy());
      return;
    }
    if (!feature) {
      ui.stage.append(el("div", { class: "empty", text: "Spin draws eight titles from the current pool and puts one up front." }));
      return;
    }
    var card = detailCard(feature);
    var actions = card.querySelector(".actions");
    var dilemma = el("button", { type: "button", class: "btn btn-ghost", text: "Dilemma with this" });
    dilemma.addEventListener("click", function () { startDilemma(feature.id); });
    actions.append(dilemma);
    wireSpinAgain(card);
    if (state.spinning) card.classList.add("is-spinning");
    ui.stage.append(card);
    renderShelf(state.shelfLabel || "Also drawn", state.drawnIds);
  }

  function pickCard(title, side) {
    var card = el("article", { class: "pick-card", dataset: { titleId: title.id, side: side } });
    card.append(poster(title, "poster-md"));
    card.append(el("h2", { class: "title", text: title.name }));
    card.append(el("p", { class: "meta", text: laneMeta(title.lane).label + " · " + heatMeta(title.heat).label + " · score " + title.score + " · " + title.year + " · " + runtimeText(title) }));
    card.append(el("p", { class: "why", text: title.why || "" }));
    card.append(tagRow(title));
    card.append(genreBlock(title));
    card.append(watchLinks(title));
    var choose = el("button", { type: "button", class: "btn btn-primary", text: "This one" });
    choose.addEventListener("click", function () { chooseSide(side); });
    var actions = el("div", { class: "actions" }, choose, seenButton(title));
    card.append(actions);
    return card;
  }

  function renderDilemma(pool) {
    var left = titleById(state.dilemma.leftId);
    var right = titleById(state.dilemma.rightId);
    if (pool.length < 2 || !left || !right) {
      var locked = isCatalogLocked();
      var needTwo = locked
        ? "A dilemma needs two titles in " + catalogModeMeta().label + ". Loosen the heat, score, or search, or switch catalog."
        : "A dilemma needs two titles. Loosen the heat, lanes, score, or search.";
      appendEmpty(pool.length < 2 && modeHeatGap() ? emptyCopy() : (pool.length < 2 ? needTwo : "Start a dilemma to put two titles side by side."));
      if (!modeHeatGap()) {
        var start = el("button", { type: "button", class: "btn btn-primary", text: "Start dilemma" });
        start.addEventListener("click", function () { startDilemma(null); });
        ui.stage.append(el("div", { class: "actions" }, start));
      }
      return;
    }
    var head = el("p", {
      class: "kicker",
      text: state.dilemma.seeds.length
        ? "Round " + state.dilemma.round + " · the pick stays, a closer title steps up"
        : "Round " + state.dilemma.round + " · pick the one you would rather watch",
    });
    ui.stage.append(head);
    ui.stage.append(el("div", { class: "versus" },
      pickCard(left, "left"),
      el("div", { class: "vs", text: "or" }),
      pickCard(right, "right")
    ));
    var again = el("button", { type: "button", class: "btn btn-ghost", text: "New pair" });
    again.addEventListener("click", function () { startDilemma(null); });
    ui.stage.append(el("div", { class: "actions" }, again));
    var label = state.dilemma.seeds.length ? "Closest to your picks" : "Highest scores in this pool";
    renderShelf(label, state.drawnIds);
  }

  function renderShelf(label, ids) {
    var inPool = idsInPool(activePool());
    var visible = ids.map(titleById).filter(function (title) {
      return title && inPool[title.id] && title.id !== state.featureId && !(state.hideSeen && state.seen.has(title.id));
    });
    if (!visible.length) return;
    var head = el("div", { class: "shelf-head" },
      el("h2", { text: label }),
      el("span", { class: "mini-meta", text: String(visible.length) })
    );
    var grid = el("div", { class: "shelf-grid" });
    visible.forEach(function (title) {
      var card = el("button", {
        type: "button",
        class: "mini-card" + (title.id === state.featureId ? " is-on" : ""),
        dataset: { titleId: title.id },
      });
      card.append(poster(title, "poster-sm"));
      card.append(el("span", { class: "mini-name", text: title.name }));
      card.append(el("p", { class: "mini-meta", text: laneMeta(title.lane).label + " · " + heatMeta(title.heat).label }));
      card.addEventListener("click", function () { onShelfClick(title.id); });
      grid.append(card);
    });
    ui.shelf.append(head, grid);
  }

  function onShelfClick(id) {
    if (state.mode === "dilemma" && state.dilemma.leftId && id !== state.dilemma.leftId) {
      state.dilemma.rightId = id;
      render();
      return;
    }
    state.mode = "spin";
    state.featureId = id;
    render();
  }

  function emptyCopy() {
    var mode = catalogModeMeta();
    var locked = isCatalogLocked();
    var gap = modeHeatGap();
    var pack = currentPack();
    var modeBit = locked ? " " + mode.note + "." : "";
    if (gap) {
      var scope = locked ? mode.label + " only includes " + mode.lanePhrase + " titles. " : "";
      var packBit = pack ? " " + pack.title + " stays empty until that ceiling moves." : "";
      return scope + "The heat ceiling is " + heatMeta(state.heatMax).label + ", so every title in this catalog is hidden. Raise it to " + gap.label + "." + packBit;
    }
    if (pack) {
      var names = pack.themes.map(function (id) { return themeMeta(id).label; }).join(", ");
      var twins = engine.siblings(pack).map(function (other) { return other.title; });
      var twinCopy = twins.length
        ? " It shares its themes with " + twins.join(", ") + ", so those packs list the same titles."
        : " Packs are not private title lists.";
      var laneHint = locked ? " Lanes stay on " + mode.lanePhrase + " while this catalog is selected." : " Loosen heat, lanes, score, or search, or show seen titles.";
      return "Nothing in " + pack.title + " matches these filters." + modeBit + " A title is in this pack when it has any of: " + names + "." + twinCopy + laneHint;
    }
    var lanes = effectiveLanes();
    if (!Object.keys(lanes).some(function (lane) { return lanes[lane]; })) {
      return "Every lane is off. Turn one back on to spin.";
    }
    if (state.hideSeen && state.seen.size) {
      var seenPool = engine.pool({
        lanes: lanes,
        heatMax: state.heatMax,
        minScore: state.minScore,
        query: state.query,
        hideSeen: false,
        seen: state.seen,
        themeId: state.themeId,
        packId: state.packId,
      });
      if (seenPool.length) {
        return "Every title in this pool is marked seen. Show seen titles, or clear the list." + modeBit;
      }
    }
    if (state.themeId) {
      return "Nothing tagged " + themeMeta(state.themeId).label + " matches these filters." + modeBit + " Clear the theme, lower the score, or raise the heat ceiling.";
    }
    if (locked) {
      return "Nothing in " + mode.label + " matches these filters." + modeBit + " Lower the score, raise the heat ceiling, or clear the search.";
    }
    return "Nothing matches these filters. Lower the score, raise the heat ceiling, or clear the search.";
  }

  function heatRaiseControl() {
    var gap = modeHeatGap();
    if (!gap) return null;
    var button = el("button", {
      type: "button",
      class: "btn btn-primary",
      text: "Raise heat to " + gap.label,
    });
    button.addEventListener("click", function () {
      stopMotion();
      state.heatMax = gap.id;
      if (state.mode === "dilemma") startDilemma(null);
      else if (state.mode === "night") spinNightPack(state.night.packId || "soft");
      else spin();
    });
    return button;
  }

  function appendEmpty(text) {
    ui.stage.append(el("div", { class: "empty", text: text }));
    var raise = heatRaiseControl();
    if (raise) ui.stage.append(el("div", { class: "actions" }, raise));
  }

  function renderBanner() {
    clear(ui.banner);
    var pack = currentPack();
    if (!pack && !state.themeId) return;
    var banner = el("div", { class: "banner" });
    if (pack) {
      var themeNames = pack.themes.map(function (id) { return themeMeta(id).label + " (" + themeMeta(id).keyword + ")"; });
      banner.append(el("strong", { text: pack.title }));
      banner.append(document.createTextNode(" includes a title when it has any of " + themeNames.join(" or ") + ". " + pack.blurb));
      var twins = engine.siblings(pack);
      if (twins.length) {
        banner.append(el("p", {
          class: "sibling-note",
          text: "Same titles as " + twins.map(function (other) { return other.title; }).join(", ") + ". Those packs use the same theme tags, so the shelf matches.",
        }));
      }
      var leave = el("button", { type: "button", class: "btn btn-ghost", text: "Leave pack" });
      leave.addEventListener("click", function () {
        stopMotion();
        state.packId = null;
        render();
      });
      banner.append(el("div", { class: "actions" }, leave));
    } else if (state.themeId) {
      var theme = themeMeta(state.themeId);
      banner.append(el("strong", { text: theme.label }));
      banner.append(document.createTextNode(" · search keyword " + theme.keyword + ". Spin stays inside titles tagged with this theme."));
      var clearTheme = el("button", { type: "button", class: "btn btn-ghost", text: "All themes" });
      clearTheme.addEventListener("click", function () {
        stopMotion();
        state.themeId = null;
        render();
      });
      banner.append(el("div", { class: "actions" }, clearTheme));
    }
    ui.banner.append(banner);
  }

  function packCount(packId, wide) {
    var hottest = hottestHeat();
    return engine.pool({
      lanes: effectiveLanes(),
      heatMax: wide ? hottest.id : state.heatMax,
      minScore: wide ? 50 : state.minScore,
      query: wide ? "" : state.query,
      hideSeen: wide ? false : state.hideSeen,
      seen: state.seen,
      themeId: null,
      packId: packId,
    }).length;
  }

  function renderPacks(poolIds) {
    clear(ui.packs);
    var mode = catalogModeMeta();
    var locked = isCatalogLocked();
    var gap = modeHeatGap();
    var matched = 0;
    var available = 0;
    var grid = el("div", { class: "pack-grid" });
    catalog.packs.forEach(function (pack) {
      var count = packCount(pack.id, false);
      var openCount = packCount(pack.id, true);
      if (count) matched += 1;
      if (openCount) available += 1;
      var twins = engine.siblings(pack);
      var card = el("button", {
        type: "button",
        class: "pack-card" + (count ? "" : " is-empty"),
        "aria-pressed": state.packId === pack.id ? "true" : "false",
      });
      card.append(el("span", { class: "pack-title", text: pack.title }));
      card.append(el("p", { class: "pack-meta", text: count + " in the current filters" }));
      card.append(el("p", { class: "pack-blurb", text: pack.blurb }));
      var themes = el("div", { class: "tag-row" });
      pack.themes.forEach(function (themeId) {
        var theme = themeMeta(themeId);
        themes.append(el("span", { class: "tag", text: theme.label + " · " + theme.keyword }));
      });
      card.append(themes);
      if (!count && !openCount) {
        card.append(el("p", {
          class: "pack-empty",
          text: locked
            ? "Empty in " + mode.label + ". No " + mode.lanePhrase + " titles use these themes."
            : "Empty with these filters. This pack only keeps titles tagged with its themes.",
        }));
      } else if (!count && gap) {
        card.append(el("p", {
          class: "pack-empty",
          text: "Hidden until heat is " + gap.label + ". " + openCount + (locked ? " " + mode.lanePhrase : "") + " titles in this pack.",
        }));
      } else if (!count) {
        card.append(el("p", {
          class: "pack-empty",
          text: "None match the current heat, score, search, or seen filter. " + openCount + " in this pack " + (locked ? "are in " + mode.label : "match the lanes") + " if those loosen.",
        }));
      } else if (twins.length) {
        card.append(el("p", { class: "sibling-note", text: "Same titles as " + twins.map(function (other) { return other.title; }).join(", ") + "." }));
      }
      card.addEventListener("click", function () { openPack(pack.id); });
      grid.append(card);
    });
    var meta = locked
      ? available + " of " + catalog.packs.length + " include " + mode.label + " · " + matched + " match filters"
      : catalog.packs.length + " theme shelves";
    var head = el("div", { class: "section-head" },
      el("h2", { text: "Packs" }),
      el("span", { class: "mini-meta", text: meta })
    );
    var introText = locked
      ? "Packs follow " + mode.label + " (" + mode.lanePhrase + " only). A pack shows Empty when none of its themes are on those titles. Opening a pack spins inside it."
      : "Opening a pack spins and filters inside it. Membership is any of the pack’s themes, not a private list. Packs that share the same themes show the same titles.";
    var intro = el("p", { class: "pack-meta", text: introText });
    ui.packs.append(head, intro, grid);
    ui.packs.dataset.packCount = String(catalog.packs.length);
    ui.packs.dataset.activePool = String(poolIds);
    ui.packs.dataset.filled = String(available);
  }

  function syncCatalogChrome() {
    var mode = catalogModeMeta();
    var locked = isCatalogLocked();
    var app = document.getElementById("app");
    if (app) app.dataset.catalogMode = state.catalogMode || "";
    document.querySelectorAll("[data-catalog-mode]").forEach(function (button) {
      button.setAttribute("aria-checked", button.dataset.catalogMode === state.catalogMode ? "true" : "false");
    });
    document.querySelectorAll("[data-mood]").forEach(function (button) {
      button.setAttribute("aria-checked", button.dataset.mood === state.catalogMode ? "true" : "false");
    });
    if (ui.laneRow) ui.laneRow.hidden = locked;
    if (ui.laneNote) {
      ui.laneNote.hidden = !locked;
      ui.laneNote.textContent = locked ? mode.note : "";
    }
    var lanesNow = effectiveLanes();
    document.querySelectorAll("[data-lane]").forEach(function (button) {
      var lane = button.dataset.lane;
      button.disabled = locked;
      button.setAttribute("aria-pressed", lanesNow[lane] ? "true" : "false");
      var count = button.querySelector(".count");
      if (count && !locked) count.textContent = String(engine.laneCount(filters(), lane));
    });
    if (ui.catalogStatus) {
      if (!state.catalogModeChosen) ui.catalogStatus.textContent = "Choose a catalog to start.";
      else if (locked) ui.catalogStatus.textContent = mode.note + ".";
      else ui.catalogStatus.textContent = "Everything · all four lanes. Lane checkboxes in Filters still apply.";
    }
    var eyebrow = document.getElementById("eyebrow");
    if (eyebrow) {
      eyebrow.textContent = locked
        ? mode.label + " · " + modeCatalogCount(mode) + " titles · 18+"
        : catalog.titles.length + " titles · " + catalog.packs.length + " packs · " + catalog.themes.length + " themes · 18+";
    }
    if (ui.stage) ui.stage.dataset.catalogMode = state.catalogMode || "";
    syncCatalogOffset();
  }

  function render() {
    var pool = activePool();
    var mode = catalogModeMeta();
    var locked = isCatalogLocked();
    var universe = locked ? modeCatalogCount(mode) : catalog.titles.length;
    var lanesNow = effectiveLanes();
    var aboveHeat = catalog.titles.filter(function (title) {
      var inLane = locked ? lanesNow[title.lane] : true;
      return inLane && engine.ranks[title.heat] > engine.ranks[state.heatMax];
    }).length;
    var lead = locked
      ? pool.length + " of " + universe + " in " + mode.label + ". "
      : pool.length + " of " + universe + " titles match. ";
    if (state.mode === "night") {
      var nightPack = nightPackMeta(state.night.packId) || nightPackMeta("soft");
      var nightCount = nightPool(nightPack.id).length;
      ui.poolLine.textContent = "Birthday Night · " + nightPack.label + " · " + nightCount + " in this pack. " + HEAT_HINT[state.heatMax];
    } else {
      ui.poolLine.textContent = lead + HEAT_HINT[state.heatMax] + (aboveHeat ? " " + aboveHeat + " sit above this heat." : "");
    }
    ui.poolLine.dataset.count = String(state.mode === "night" ? nightPool(state.night.packId || "soft").length : pool.length);
    ui.poolLine.dataset.total = String(universe);
    ui.poolLine.dataset.catalogMode = state.catalogMode || "";
    ui.seenCount.textContent = state.seen.size ? state.seen.size + " seen" : "None seen";
    ui.clearSeen.disabled = state.seen.size === 0;
    ui.clearSeen.textContent = state.seen.size ? "Clear seen (" + state.seen.size + ")" : "Clear seen";
    ui.modeSpin.setAttribute("aria-pressed", state.mode === "spin" ? "true" : "false");
    ui.modeDilemma.setAttribute("aria-pressed", state.mode === "dilemma" ? "true" : "false");
    if (ui.modeNight) ui.modeNight.setAttribute("aria-pressed", state.mode === "night" ? "true" : "false");
    syncCatalogChrome();
    document.querySelectorAll("[data-heat]").forEach(function (button) {
      button.setAttribute("aria-pressed", state.heatMax === button.dataset.heat ? "true" : "false");
    });
    var heatHint = document.getElementById("heat-hint");
    if (heatHint) heatHint.textContent = HEAT_HINT[state.heatMax];
    document.querySelectorAll("[data-theme]").forEach(function (button) {
      var id = button.dataset.theme;
      var on = id ? state.themeId === id : !state.themeId && !state.packId;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      var countEl = button.querySelector(".theme-count");
      if (!countEl) return;
      var themeCount = engine.pool({
        lanes: effectiveLanes(),
        heatMax: state.heatMax,
        minScore: state.minScore,
        query: state.query,
        hideSeen: state.hideSeen,
        seen: state.seen,
        themeId: id || null,
        packId: null,
      }).length;
      countEl.textContent = String(themeCount);
      button.classList.toggle("is-empty", !!id && themeCount === 0);
    });
    var scoreOut = document.getElementById("score-out");
    if (scoreOut) scoreOut.textContent = String(state.minScore);
    clear(ui.stage);
    clear(ui.shelf);
    if (ui.nightStage) ui.nightStage.hidden = state.mode !== "night";
    if (ui.packs) ui.packs.hidden = state.mode === "night";
    var skip = document.querySelector(".skip");
    if (skip) skip.setAttribute("href", state.mode === "night" ? "#night-stage" : "#stage");
    if (state.mode === "night") {
      clear(ui.banner);
      clear(ui.nightStage);
      renderNight();
      ui.stage.dataset.feature = "";
      ui.stage.dataset.mode = "night";
    } else {
      if (ui.nightStage) clear(ui.nightStage);
      renderBanner();
      if (state.mode === "dilemma") renderDilemma(pool);
      else renderSpin(pool);
      ui.stage.dataset.feature = state.featureId || "";
      ui.stage.dataset.mode = state.mode;
    }
    renderPacks(pool.length);
  }

  function spin() {
    stopMotion();
    var pool = activePool();
    state.mode = "spin";
    var drawn = engine.spinDraw(pool, 8);
    state.drawnIds = drawn.map(function (title) { return title.id; });
    state.featureId = drawn.length ? drawn[0].id : null;
    state.shelfLabel = state.packId ? "Drawn from this pack" : "Also drawn";
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.clearInterval(state.spinTimer);
    if (reduce || drawn.length < 2) {
      state.spinning = false;
      render();
      return;
    }
    state.spinning = true;
    var frame = 0;
    state.spinTimer = window.setInterval(function () {
      frame += 1;
      var live = activePool();
      if (live.length) state.featureId = live[Math.floor(Math.random() * live.length)].id;
      if (frame >= 7) {
        window.clearInterval(state.spinTimer);
        state.spinning = false;
        state.featureId = drawn[0].id;
      }
      render();
    }, 70);
    render();
  }

  function browsePack(pack) {
    stopMotion();
    state.mode = "spin";
    state.packId = pack.id;
    state.themeId = pack.themes[0] || null;
    var list = activePool();
    var top = list.slice(0, 12);
    state.drawnIds = top.map(function (title) { return title.id; });
    state.featureId = top.length ? top[0].id : null;
    state.shelfLabel = "Top of " + pack.title;
    state.spinning = false;
    window.clearInterval(state.spinTimer);
    render();
    var stage = document.getElementById("stage");
    if (stage && stage.scrollIntoView) stage.scrollIntoView({ block: "start" });
  }

  function openPack(id) {
    var pack = engine.packById(id);
    if (!pack) return;
    browsePack(pack);
  }

  function selectTheme(id) {
    stopMotion();
    state.packId = null;
    state.themeId = id;
    state.mode = "spin";
    var list = activePool();
    var top = list.slice(0, 12);
    state.drawnIds = top.map(function (title) { return title.id; });
    state.featureId = top.length ? top[0].id : null;
    state.shelfLabel = "Top of " + themeMeta(id).label;
    render();
  }

  function startDilemma(seedId) {
    stopMotion();
    var pool = activePool();
    state.mode = "dilemma";
    if (pool.length < 2) {
      state.dilemma = { leftId: null, rightId: null, seeds: [], round: 0 };
      state.drawnIds = [];
      render();
      return;
    }
    var seeds = seedId ? [seedId] : [];
    var left = seedId ? titleById(seedId) : null;
    if (!left || pool.every(function (title) { return title.id !== left.id; })) {
      var pair = engine.shuffle(pool).slice(0, 2);
      state.dilemma = { leftId: pair[0].id, rightId: pair[1].id, seeds: [], round: 1 };
      state.drawnIds = pool.slice(0, 8).map(function (title) { return title.id; });
      state.featureId = pair[0].id;
      render();
      return;
    }
    var shelf = engine.dilemmaShelf(seeds, pool);
    var right = null;
    for (var i = 0; i < shelf.length; i += 1) {
      if (shelf[i].id !== left.id) { right = shelf[i]; break; }
    }
    if (!right) {
      var rest = pool.filter(function (title) { return title.id !== left.id; });
      right = rest[0];
    }
    state.dilemma = { leftId: left.id, rightId: right ? right.id : null, seeds: seeds, round: 1 };
    state.drawnIds = shelf.map(function (title) { return title.id; });
    state.featureId = left.id;
    render();
  }

  function chooseSide(side) {
    if (state.mode !== "dilemma") return;
    var winnerId = side === "right" ? state.dilemma.rightId : state.dilemma.leftId;
    var winner = titleById(winnerId);
    if (!winner) return;
    var seeds = engine.pushSeed(state.dilemma.seeds, winner.id);
    var pool = activePool();
    var shelf = engine.dilemmaShelf(seeds, pool);
    var challenger = null;
    for (var i = 0; i < shelf.length; i += 1) {
      if (shelf[i].id !== winner.id) { challenger = shelf[i]; break; }
    }
    if (!challenger) {
      var rest = engine.shuffle(pool.filter(function (title) { return title.id !== winner.id; }));
      challenger = rest[0] || null;
    }
    state.dilemma = {
      leftId: winner.id,
      rightId: challenger ? challenger.id : null,
      seeds: seeds,
      round: state.dilemma.round + 1,
    };
    state.drawnIds = shelf.map(function (title) { return title.id; });
    state.featureId = winner.id;
    render();
  }

  function toggleSeen(id) {
    if (state.seen.has(id)) state.seen.delete(id);
    else state.seen.add(id);
    saveSeen();
    render();
  }

  function nightPackMeta(packId) {
    var packs = window.SpinLogic.listNightPacks();
    for (var i = 0; i < packs.length; i += 1) {
      if (packs[i].id === packId) return packs[i];
    }
    return packs[0];
  }

  function nightOptions() {
    return {
      hideSeen: state.hideSeen,
      seen: state.seen,
      heatMax: state.heatMax,
    };
  }

  function nightPool(packId) {
    return window.SpinLogic.buildNightPool(catalog, packId, nightOptions());
  }

  function tonightEntries() {
    var picks = [];
    window.SpinLogic.listNightPacks().forEach(function (pack) {
      var title = titleById(state.night.byPack[pack.id]);
      if (!title) return;
      picks.push({ packId: pack.id, label: pack.label, title: title });
    });
    return picks;
  }

  function showNight() {
    stopMotion();
    state.mode = "night";
    if (!state.night.packId) state.night.packId = "soft";
    render();
    if (ui.nightStage && ui.nightStage.scrollIntoView) ui.nightStage.scrollIntoView({ block: "start" });
  }

  function spinNightPack(packId) {
    stopMotion();
    state.mode = "night";
    state.night.packId = packId;
    state.night.notice = "";
    state.night.copyText = "";
    var pool = nightPool(packId);
    var drawn = window.SpinLogic.drawNightTitle(pool, Math.random, state.night.byPack[packId] || null);
    if (drawn) {
      state.night.byPack[packId] = drawn.id;
      state.night.featureId = drawn.id;
    } else {
      state.night.featureId = null;
    }
    render();
  }

  function spinAllNight() {
    stopMotion();
    state.mode = "night";
    state.night.notice = "";
    state.night.copyText = "";
    var picks = window.SpinLogic.drawNightAll(catalog, nightOptions());
    var byPack = {};
    picks.forEach(function (pick) { byPack[pick.packId] = pick.title.id; });
    state.night.byPack = byPack;
    if (picks.length) {
      state.night.packId = picks[0].packId;
      state.night.featureId = picks[0].title.id;
    } else {
      state.night.featureId = null;
    }
    render();
  }

  function copyNight() {
    var picks = tonightEntries();
    var text = window.SpinLogic.formatNightCopy(picks);
    if (!text) {
      state.night.notice = "Spin a pack before copying.";
      state.night.copyText = "";
      render();
      return;
    }
    var copied = function () {
      state.night.notice = "Copied " + picks.length + (picks.length === 1 ? " pick." : " picks.");
      state.night.copyText = "";
      render();
    };
    var failed = function () {
      state.night.notice = "Clipboard unavailable. The night list is in the box below.";
      state.night.copyText = text;
      render();
      var box = document.getElementById("night-copy-fallback");
      if (box) {
        box.focus();
        box.select();
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(copied, failed);
      return;
    }
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.append(area);
      area.select();
      var ok = document.execCommand("copy");
      area.remove();
      if (ok) copied();
      else failed();
    } catch (err) {
      failed();
    }
  }

  function nightEmptyCopy(pack) {
    var atHeat = window.SpinLogic.buildNightPool(catalog, pack.id, {
      hideSeen: false,
      seen: state.seen,
      heatMax: state.heatMax,
    });
    if (state.hideSeen && atHeat.length) {
      return "Every " + pack.label + " title at this heat is marked seen. Show seen titles, or clear the list.";
    }
    var gap = modeHeatGap();
    if (!atHeat.length && gap) {
      return pack.label + " has nothing at the " + heatMeta(state.heatMax).label + " ceiling. Raise heat to " + gap.label + ".";
    }
    return "Nothing in " + pack.label + " is in the catalog at this heat.";
  }

  function renderTonight() {
    var picks = tonightEntries();
    var copy = el("button", {
      type: "button",
      class: "btn btn-ghost",
      text: "Copy night",
      disabled: picks.length ? false : true,
    });
    copy.addEventListener("click", copyNight);
    var wrap = el("section", { class: "tonight", "aria-label": "Tonight" },
      el("div", { class: "shelf-head" },
        el("h2", { text: "Tonight" }),
        el("span", { class: "mini-meta", text: picks.length + " of 5" })
      ),
      el("div", { class: "actions" }, copy)
    );
    if (state.night.notice) {
      wrap.append(el("p", { class: "copy-note", text: state.night.notice, "aria-live": "polite" }));
    }
    if (state.night.copyText) {
      wrap.append(el("textarea", {
        id: "night-copy-fallback",
        class: "night-copy-fallback",
        readonly: true,
        rows: "6",
        "aria-label": "Tonight list",
      }));
    }
    if (!picks.length) {
      wrap.append(el("p", { class: "pack-meta", text: "Up to five picks, one per pack. Copy night writes the pack, title, and year." }));
      return wrap;
    }
    var list = el("div", { class: "tonight-list" });
    picks.forEach(function (pick) {
      var button = el("button", {
        type: "button",
        class: "tonight-item" + (pick.title.id === state.night.featureId ? " is-on" : ""),
      },
        el("span", { class: "tonight-pack", text: pick.label }),
        el("span", { class: "tonight-title", text: pick.title.name + " (" + pick.title.year + ")" })
      );
      button.addEventListener("click", function () {
        state.night.packId = pick.packId;
        state.night.featureId = pick.title.id;
        state.night.notice = "";
        render();
      });
      list.append(button);
    });
    wrap.append(list);
    if (state.night.copyText) {
      var box = wrap.querySelector("#night-copy-fallback");
      if (box) box.value = state.night.copyText;
    }
    return wrap;
  }

  function renderNight() {
    var packs = window.SpinLogic.listNightPacks();
    var active = nightPackMeta(state.night.packId);
    ui.nightStage.dataset.mode = "night";
    ui.nightStage.dataset.pack = active.id;
    ui.nightStage.dataset.feature = state.night.featureId || "";
    ui.nightStage.append(el("div", { class: "night-intro" },
      el("p", { class: "eyebrow", text: "Birthday Night" }),
      el("h2", { text: "Five packs" }),
      el("p", {
        class: "pack-meta",
        text: "Soft, Camp, Thriller, Shower, or Prestige-sensual. Spin one pack, or spin all five. Hide seen uses the same seen list as Spin.",
      })
    ));
    var chips = el("div", { class: "chip-row night-packs", role: "group", "aria-label": "Birthday Night packs" });
    packs.forEach(function (pack) {
      var count = nightPool(pack.id).length;
      var button = el("button", {
        type: "button",
        class: "chip night-pack" + (count ? "" : " is-empty"),
        "aria-pressed": pack.id === active.id ? "true" : "false",
        dataset: { nightPack: pack.id },
      }, pack.label, el("span", { class: "count", text: String(count) }));
      button.addEventListener("click", function () { spinNightPack(pack.id); });
      chips.append(button);
    });
    var spinOne = el("button", { type: "button", class: "btn", text: "Spin " + active.label });
    spinOne.addEventListener("click", function () { spinNightPack(active.id); });
    var spinAll = el("button", { type: "button", class: "btn btn-primary", text: "Spin all five" });
    spinAll.addEventListener("click", spinAllNight);
    ui.nightStage.append(chips, el("div", { class: "night-actions actions" }, spinOne, spinAll));

    var result = el("div", { class: "night-result" });
    var feature = titleById(state.night.featureId);
    var currentPool = nightPool(active.id);
    if (feature) {
      result.append(el("p", { class: "kicker", text: active.label }));
      var card = detailCard(feature);
      wireSpinAgain(card, function () { spinNightPack(state.night.packId || active.id); });
      result.append(card);
    } else if (!currentPool.length) {
      result.append(el("div", { class: "empty", text: nightEmptyCopy(active) }));
      var atHeat = window.SpinLogic.buildNightPool(catalog, active.id, {
        hideSeen: false,
        seen: state.seen,
        heatMax: state.heatMax,
      });
      if (!(state.hideSeen && atHeat.length)) {
        var raise = heatRaiseControl();
        if (raise) result.append(el("div", { class: "actions" }, raise));
      }
    } else {
      result.append(el("div", {
        class: "empty",
        text: "Spin " + active.label + " draws one random title from " + currentPool.length + " in this pack.",
      }));
    }
    ui.nightStage.append(result, renderTonight());
  }

  function mountFilters() {
    var lanes = el("div", { class: "field" },
      el("div", { class: "field-label", text: "Lanes" })
    );
    var laneNote = el("p", { id: "lane-lock-note", class: "hint lane-lock-note", hidden: true });
    var laneRow = el("div", { id: "lane-row", class: "chip-row", role: "group", "aria-label": "Lanes" });
    ui.laneNote = laneNote;
    ui.laneRow = laneRow;
    catalog.lanes.forEach(function (lane) {
      var button = el("button", {
        type: "button",
        class: "chip",
        "aria-pressed": "true",
        dataset: { lane: lane.id },
      }, lane.label, el("span", { class: "count", text: "0" }));
      button.addEventListener("click", function () {
        if (isCatalogLocked()) return;
        stopMotion();
        state.lanes[lane.id] = !state.lanes[lane.id];
        render();
      });
      laneRow.append(button);
    });
    lanes.append(laneNote, laneRow);

    var heat = el("div", { class: "field" },
      el("div", { class: "field-label", text: "Heat ceiling" })
    );
    var heatRow = el("div", { class: "chip-row", role: "radiogroup", "aria-label": "Heat ceiling" });
    catalog.heats.forEach(function (item) {
      var button = el("button", {
        type: "button",
        class: "chip",
        dataset: { heat: item.id },
        "aria-pressed": item.id === state.heatMax ? "true" : "false",
        text: item.label,
      });
      button.addEventListener("click", function () {
        stopMotion();
        state.heatMax = item.id;
        render();
      });
      heatRow.append(button);
    });
    heat.append(heatRow, el("p", { class: "hint", id: "heat-hint", text: HEAT_HINT[state.heatMax] }));

    var scoreLabel = el("div", { class: "field-label" },
      el("span", { text: "Minimum score" }),
      el("span", { id: "score-out", text: String(state.minScore) })
    );
    var score = el("input", {
      id: "min-score",
      class: "score",
      type: "range",
      min: "50",
      max: "90",
      step: "1",
      value: String(state.minScore),
      "aria-label": "Minimum score",
    });
    score.addEventListener("input", function () {
      stopMotion();
      state.minScore = Number(score.value);
      render();
    });

    var search = el("input", {
      id: "name-search",
      class: "search",
      type: "search",
      placeholder: "Search titles",
      "aria-label": "Search titles",
      autocomplete: "off",
    });
    search.addEventListener("input", function () {
      stopMotion();
      state.query = search.value;
      render();
    });

    var hide = el("input", { id: "hide-seen", type: "checkbox" });
    hide.checked = true;
    hide.addEventListener("change", function () {
      stopMotion();
      state.hideSeen = hide.checked;
      render();
    });

    var themes = el("div", { class: "theme-grid" });
    var all = el("button", {
      type: "button",
      class: "theme-chip",
      dataset: { theme: "" },
      "aria-pressed": "true",
    },
      el("span", { class: "theme-label", text: "All themes" }),
      el("span", { class: "theme-key", text: "any" }),
      el("span", { class: "theme-count", text: "0" })
    );
    all.addEventListener("click", function () {
      stopMotion();
      state.themeId = null;
      state.packId = null;
      render();
    });
    themes.append(all);
    catalog.themes.forEach(function (theme) {
      var button = el("button", {
        type: "button",
        class: "theme-chip",
        dataset: { theme: theme.id },
        "aria-pressed": "false",
      },
        el("span", { class: "theme-label", text: theme.label }),
        el("span", { class: "theme-key", text: theme.keyword }),
        el("span", { class: "theme-count", text: "0" })
      );
      button.addEventListener("click", function () { selectTheme(theme.id); });
      themes.append(button);
    });

    ui.filters.append(
      el("h2", { text: "Filters" }),
      lanes,
      heat,
      el("div", { class: "field" }, scoreLabel, score),
      el("label", { class: "field", for: "name-search" },
        el("div", { class: "field-label", text: "Name" }),
        search
      ),
      el("label", { class: "check-row", for: "hide-seen" }, hide, "Hide seen"),
      el("div", { class: "field" },
        el("div", { class: "field-label", text: "Themes" }),
        themes,
        el("p", { class: "hint", text: "The small word is the theme’s search keyword." })
      )
    );
  }

  function setCatalogMode(id) {
    if (!catalogModeById(id)) return;
    var changed = state.catalogMode !== id || !state.catalogModeChosen;
    state.catalogMode = id;
    state.catalogModeChosen = true;
    state.started = true;
    storeSet(CATALOG_MODE_KEY, id);
    closeMood();
    if (!changed) {
      render();
      return;
    }
    stopMotion();
    if (state.mode === "dilemma") startDilemma(null);
    else if (state.mode === "night") render();
    else spin();
  }

  function closeMood() {
    var wasOpen = state.moodOpen;
    state.moodOpen = false;
    if (ui.mood) ui.mood.hidden = true;
    var app = document.getElementById("app");
    if (app) app.inert = false;
    document.body.classList.remove("mood-open");
    if (wasOpen && ui.changeMode) ui.changeMode.focus();
  }

  function openMood() {
    if (!ui.mood) return;
    stopMotion();
    state.moodOpen = true;
    ui.mood.hidden = false;
    document.body.classList.add("mood-open");
    var app = document.getElementById("app");
    if (app) app.inert = true;
    var firstRun = !state.catalogModeChosen;
    if (ui.moodKeep) ui.moodKeep.hidden = firstRun;
    if (firstRun && ui.stage) {
      clear(ui.stage);
      clear(ui.shelf);
      if (ui.poolLine) ui.poolLine.textContent = "Choose a catalog to start.";
    } else if (!firstRun) {
      render();
    }
    if (ui.moodLede) {
      ui.moodLede.textContent = firstRun
        ? "Pick a pool. Reddit is communities, Movies are films, Studio is adult scenes, and Streamer is clips. Everything mixes all four. Looking for, at the top, switches it later. Night keeps its own packs."
        : "This changes which titles Spin and Dilemma draw. Night keeps its own packs and still follows the heat ceiling and Hide seen.";
    }
    document.querySelectorAll("[data-mood]").forEach(function (button) {
      button.setAttribute("aria-checked", button.dataset.mood === state.catalogMode ? "true" : "false");
    });
    var focusId = state.catalogMode || CATALOG_MODES[0].id;
    var current = ui.mood.querySelector('[data-mood="' + focusId + '"]');
    if (current) current.focus();
  }

  function mountCatalog() {
    CATALOG_MODES.forEach(function (mode) {
      var count = modeCatalogCount(mode);
      var chip = el("button", {
        type: "button",
        class: "catalog-chip",
        role: "radio",
        "aria-checked": "false",
        dataset: { catalogMode: mode.id },
      }, mode.label, el("span", { class: "count", text: String(count) }));
      chip.addEventListener("click", function () { setCatalogMode(mode.id); });
      ui.catalogModes.append(chip);

      var option = el("button", {
        type: "button",
        class: "mood-option",
        role: "radio",
        "aria-checked": "false",
        dataset: { mood: mode.id },
      },
        el("span", { class: "mood-name", text: mode.label }),
        el("span", { class: "mood-detail", text: mode.detail + " · " + count + " titles" })
      );
      option.addEventListener("click", function () { setCatalogMode(mode.id); });
      ui.moodOptions.append(option);
    });

    ui.catalogModes.addEventListener("keydown", function (event) {
      if (state.moodOpen) return;
      var key = event.key;
      if (key !== "ArrowRight" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowUp") return;
      var buttons = ui.catalogModes.querySelectorAll("[data-catalog-mode]");
      if (!buttons.length) return;
      event.preventDefault();
      var current = 0;
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i] === document.activeElement) current = i;
      }
      var delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      var next = buttons[(current + delta + buttons.length) % buttons.length];
      next.focus();
      setCatalogMode(next.dataset.catalogMode);
    });
  }

  function trapMoodTab(event) {
    if (event.key !== "Tab" || !ui.mood) return;
    var focusables = ui.mood.querySelectorAll("button:not([hidden])");
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindChrome() {
    ui.modeSpin.addEventListener("click", spin);
    ui.modeDilemma.addEventListener("click", function () { startDilemma(null); });
    if (ui.modeNight) ui.modeNight.addEventListener("click", showNight);
    ui.clearSeen.addEventListener("click", function () {
      state.seen.clear();
      saveSeen();
      render();
    });
    if (ui.changeMode) ui.changeMode.addEventListener("click", openMood);
    if (ui.moodKeep) ui.moodKeep.addEventListener("click", closeMood);
    if (ui.mood) {
      ui.mood.addEventListener("click", function (event) {
        if (event.target === ui.mood && state.catalogModeChosen) closeMood();
      });
    }
    window.addEventListener("resize", syncCatalogOffset);
    document.addEventListener("keydown", function (event) {
      if (state.moodOpen) {
        if (event.key === "Escape" && state.catalogModeChosen) {
          event.preventDefault();
          closeMood();
        }
        trapMoodTab(event);
        return;
      }
      if (document.getElementById("app").hidden) return;
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "s" || event.key === "S") { event.preventDefault(); spin(); }
      if (event.key === "d" || event.key === "D") { event.preventDefault(); startDilemma(null); }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        if (state.mode === "night") spinNightPack(state.night.packId || "soft");
        else showNight();
      }
      if (event.key === "1") chooseSide("left");
      if (event.key === "2") chooseSide("right");
    });
  }

  function showApp() {
    document.getElementById("gate").hidden = true;
    document.getElementById("app").hidden = false;
    if (!state.catalogModeChosen) {
      openMood();
      return;
    }
    if (!state.started) {
      state.started = true;
      spin();
    }
  }

  function boot() {
    ui.filters = document.getElementById("filters");
    ui.poolLine = document.getElementById("pool-line");
    ui.banner = document.getElementById("banner");
    ui.stage = document.getElementById("stage");
    ui.shelf = document.getElementById("shelf");
    ui.packs = document.getElementById("packs");
    ui.seenCount = document.getElementById("seen-count");
    ui.clearSeen = document.getElementById("clear-seen");
    ui.modeSpin = document.getElementById("mode-spin");
    ui.modeDilemma = document.getElementById("mode-dilemma");
    ui.modeNight = document.getElementById("mode-night");
    ui.nightStage = document.getElementById("night-stage");
    ui.catalogBar = document.getElementById("catalog-bar");
    ui.catalogModes = document.getElementById("catalog-modes");
    ui.catalogStatus = document.getElementById("catalog-status");
    ui.changeMode = document.getElementById("change-mode");
    ui.mood = document.getElementById("mood");
    ui.moodLede = document.getElementById("mood-lede");
    ui.moodOptions = document.getElementById("mood-options");
    ui.moodKeep = document.getElementById("mood-keep");

    if (!catalog || !engine || !Array.isArray(catalog.titles)) {
      document.getElementById("gate").hidden = true;
      document.getElementById("app").hidden = false;
      if (ui.catalogBar) ui.catalogBar.hidden = true;
      ui.stage.append(el("div", { class: "empty", text: "The catalog file did not load. Open the folder over a local server, or keep data/catalog.js next to index.html." }));
      return;
    }

    state.seen = loadSeen();
    var storedMode = loadCatalogMode();
    if (storedMode) {
      state.catalogMode = storedMode;
      state.catalogModeChosen = true;
    }
    mountFilters();
    mountCatalog();
    bindChrome();
    render();

    document.getElementById("age-accept").addEventListener("click", function () {
      storeSet(AGE_KEY, "1");
      showApp();
    });
    document.getElementById("age-return").addEventListener("click", function () {
      storeSet(AGE_KEY, "1");
      showApp();
    });
    document.getElementById("age-leave").addEventListener("click", function () {
      document.getElementById("gate-card").hidden = true;
      document.getElementById("left-panel").hidden = false;
    });

    if (storeGet(AGE_KEY) === "1") showApp();
    else document.getElementById("age-accept").focus();
  }

  boot();
})();
