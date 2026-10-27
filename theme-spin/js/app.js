(function () {
  "use strict";

  var AGE_KEY = "nsfw-theme-spin-age-ok";
  var SEEN_KEY = "nsfw-theme-spin-seen";
  var HEAT_HINT = {
    soft: "Soft only. Suggestive and explicit stay hidden.",
    suggestive: "Soft and suggestive. Explicit stays hidden.",
    explicit: "Soft, suggestive, and explicit.",
  };

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
    spinning: false,
    spinTimer: 0,
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

  function filters() {
    return {
      lanes: state.lanes,
      heatMax: state.heatMax,
      minScore: state.minScore,
      query: state.query,
      hideSeen: state.hideSeen,
      seen: state.seen,
      themeId: state.themeId,
      packId: state.packId,
    };
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

  function wireSpinAgain(card) {
    var buttons = card.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].textContent === "Spin again") {
        buttons[i].addEventListener("click", spin);
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
      ui.stage.append(el("div", { class: "empty", text: emptyCopy() }));
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
      ui.stage.append(el("div", {
        class: "empty",
        text: pool.length < 2
          ? "A dilemma needs two titles. Loosen the heat, lanes, score, or search."
          : "Start a dilemma to put two titles side by side.",
      }));
      var start = el("button", { type: "button", class: "btn btn-primary", text: "Start dilemma" });
      start.addEventListener("click", function () { startDilemma(null); });
      ui.stage.append(el("div", { class: "actions" }, start));
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
    var pack = currentPack();
    if (pack) {
      var names = pack.themes.map(function (id) { return themeMeta(id).label; }).join(", ");
      var twins = engine.siblings(pack).map(function (other) { return other.title; });
      var twinCopy = twins.length
        ? " It shares its themes with " + twins.join(", ") + ", so those packs list the same titles."
        : " Packs are not private title lists.";
      return "Nothing in " + pack.title + " matches these filters. A title is in this pack when it has any of: " + names + "." + twinCopy + " Loosen heat, lanes, score, or search, or show seen titles.";
    }
    if (!Object.keys(state.lanes).some(function (lane) { return state.lanes[lane]; })) {
      return "Every lane is off. Turn one back on to spin.";
    }
    if (state.hideSeen && state.seen.size) {
      return "Every title in this pool is marked seen. Show seen titles, or clear the list.";
    }
    return "Nothing matches these filters. Lower the score, raise the heat ceiling, or clear the search.";
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

  function renderPacks(poolIds) {
    clear(ui.packs);
    var head = el("div", { class: "section-head" },
      el("h2", { text: "Packs" }),
      el("span", { class: "mini-meta", text: catalog.packs.length + " theme shelves" })
    );
    var intro = el("p", {
      class: "pack-meta",
      text: "Opening a pack spins and filters inside it. Membership is any of the pack’s themes, not a private list. Packs that share the same themes show the same titles.",
    });
    var grid = el("div", { class: "pack-grid" });
    catalog.packs.forEach(function (pack) {
      var count = engine.pool({
        lanes: state.lanes,
        heatMax: state.heatMax,
        minScore: state.minScore,
        query: state.query,
        hideSeen: state.hideSeen,
        seen: state.seen,
        themeId: null,
        packId: pack.id,
      }).length;
      var twins = engine.siblings(pack);
      var card = el("button", {
        type: "button",
        class: "pack-card",
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
      if (!count) {
        card.append(el("p", { class: "sibling-note", text: "Empty with these filters. This pack only keeps titles tagged with its themes." }));
      } else if (twins.length) {
        card.append(el("p", { class: "sibling-note", text: "Same titles as " + twins.map(function (other) { return other.title; }).join(", ") + "." }));
      }
      card.addEventListener("click", function () { openPack(pack.id); });
      grid.append(card);
    });
    ui.packs.append(head, intro, grid);
    ui.packs.dataset.packCount = String(catalog.packs.length);
    ui.packs.dataset.activePool = String(poolIds);
  }

  function render() {
    var pool = activePool();
    var aboveHeat = catalog.titles.filter(function (title) {
      return engine.ranks[title.heat] > engine.ranks[state.heatMax];
    }).length;
    ui.poolLine.textContent = pool.length + " of " + catalog.titles.length + " titles match. " + HEAT_HINT[state.heatMax] + (aboveHeat ? " " + aboveHeat + " sit above this heat." : "");
    ui.poolLine.dataset.count = String(pool.length);
    ui.poolLine.dataset.total = String(catalog.titles.length);
    ui.seenCount.textContent = state.seen.size ? state.seen.size + " seen" : "None seen";
    ui.clearSeen.disabled = state.seen.size === 0;
    ui.clearSeen.textContent = state.seen.size ? "Clear seen (" + state.seen.size + ")" : "Clear seen";
    ui.modeSpin.setAttribute("aria-pressed", state.mode === "spin" ? "true" : "false");
    ui.modeDilemma.setAttribute("aria-pressed", state.mode === "dilemma" ? "true" : "false");
    document.querySelectorAll("[data-lane]").forEach(function (button) {
      var lane = button.dataset.lane;
      button.setAttribute("aria-pressed", state.lanes[lane] ? "true" : "false");
      var count = button.querySelector(".count");
      if (count) count.textContent = String(engine.laneCount(filters(), lane));
    });
    document.querySelectorAll("[data-heat]").forEach(function (button) {
      button.setAttribute("aria-pressed", state.heatMax === button.dataset.heat ? "true" : "false");
    });
    var heatHint = document.getElementById("heat-hint");
    if (heatHint) heatHint.textContent = HEAT_HINT[state.heatMax];
    document.querySelectorAll("[data-theme]").forEach(function (button) {
      var id = button.dataset.theme;
      var on = id ? state.themeId === id : !state.themeId && !state.packId;
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var scoreOut = document.getElementById("score-out");
    if (scoreOut) scoreOut.textContent = String(state.minScore);
    clear(ui.stage);
    clear(ui.shelf);
    renderBanner();
    if (state.mode === "dilemma") renderDilemma(pool);
    else renderSpin(pool);
    ui.stage.dataset.feature = state.featureId || "";
    ui.stage.dataset.mode = state.mode;
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

  function mountFilters() {
    var lanes = el("div", { class: "field" },
      el("div", { class: "field-label", text: "Lanes" })
    );
    var laneRow = el("div", { class: "chip-row", role: "group", "aria-label": "Lanes" });
    catalog.lanes.forEach(function (lane) {
      var button = el("button", {
        type: "button",
        class: "chip",
        "aria-pressed": "true",
        dataset: { lane: lane.id },
      }, lane.label, el("span", { class: "count", text: "0" }));
      button.addEventListener("click", function () {
        stopMotion();
        state.lanes[lane.id] = !state.lanes[lane.id];
        render();
      });
      laneRow.append(button);
    });
    lanes.append(laneRow);

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
    }, el("span", { class: "theme-label", text: "All themes" }), el("span", { class: "theme-key", text: "any" }));
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
        el("span", { class: "theme-key", text: theme.keyword })
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

  function bindChrome() {
    ui.modeSpin.addEventListener("click", spin);
    ui.modeDilemma.addEventListener("click", function () { startDilemma(null); });
    ui.clearSeen.addEventListener("click", function () {
      state.seen.clear();
      saveSeen();
      render();
    });
    document.addEventListener("keydown", function (event) {
      if (document.getElementById("app").hidden) return;
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "s" || event.key === "S") { event.preventDefault(); spin(); }
      if (event.key === "d" || event.key === "D") { event.preventDefault(); startDilemma(null); }
      if (event.key === "1") chooseSide("left");
      if (event.key === "2") chooseSide("right");
    });
  }

  function showApp() {
    document.getElementById("gate").hidden = true;
    document.getElementById("app").hidden = false;
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

    if (!catalog || !engine || !Array.isArray(catalog.titles)) {
      document.getElementById("gate").hidden = true;
      document.getElementById("app").hidden = false;
      ui.stage.append(el("div", { class: "empty", text: "The catalog file did not load. Open the folder over a local server, or keep data/catalog.js next to index.html." }));
      return;
    }

    state.seen = loadSeen();
    document.getElementById("eyebrow").textContent = catalog.titles.length + " titles · " + catalog.packs.length + " packs · " + catalog.themes.length + " themes · 18+";
    mountFilters();
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
