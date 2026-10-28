(function (root) {
  "use strict";

  function heatRanks(catalog) {
    const ranks = {};
    for (const heat of catalog.heats) ranks[heat.id] = heat.rank;
    return ranks;
  }

  function byScore(a, b) {
    return b.score - a.score || a.name.localeCompare(b.name);
  }

  function themeKey(themes) {
    return themes.slice().sort().join("|");
  }

  function shuffle(list, rng) {
    const random = rng || Math.random;
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const swap = arr[i];
      arr[i] = arr[j];
      arr[j] = swap;
    }
    return arr;
  }

  function createEngine(catalog) {
    const ranks = heatRanks(catalog);
    const titleById = {};
    for (const title of catalog.titles) titleById[title.id] = title;

    const packsByKey = {};
    for (const pack of catalog.packs) {
      const key = themeKey(pack.themes);
      if (!packsByKey[key]) packsByKey[key] = [];
      packsByKey[key].push(pack);
    }

    function packById(id) {
      for (const pack of catalog.packs) {
        if (pack.id === id) return pack;
      }
      return null;
    }

    function siblings(pack) {
      if (!pack) return [];
      const group = packsByKey[themeKey(pack.themes)] || [];
      return group.filter((other) => other.id !== pack.id);
    }

    function passes(item, filters) {
      if (!filters.lanes[item.lane]) return false;
      if (ranks[item.heat] > ranks[filters.heatMax]) return false;
      if (item.score < filters.minScore) return false;
      if (filters.hideSeen && filters.seen.has(item.id)) return false;
      const query = (filters.query || "").trim().toLowerCase();
      if (query && item.name.toLowerCase().indexOf(query) === -1) return false;
      return true;
    }

    function pool(filters) {
      let list = catalog.titles.filter((item) => passes(item, filters));
      if (filters.packId) {
        const pack = packById(filters.packId);
        if (pack) {
          const themes = {};
          for (const themeId of pack.themes) themes[themeId] = true;
          list = list.filter((item) => item.themes.some((themeId) => themes[themeId]));
        }
      } else if (filters.themeId) {
        list = list.filter((item) => item.themes.indexOf(filters.themeId) !== -1);
      }
      return list.slice().sort(byScore);
    }

    function laneCount(filters, laneId) {
      const next = {
        lanes: Object.assign({}, filters.lanes),
        heatMax: filters.heatMax,
        minScore: filters.minScore,
        query: filters.query,
        hideSeen: filters.hideSeen,
        seen: filters.seen,
        themeId: filters.themeId,
        packId: filters.packId,
      };
      next.lanes[laneId] = true;
      return pool(next).filter((item) => item.lane === laneId).length;
    }

    function spinDraw(list, count, rng) {
      return shuffle(list, rng).slice(0, count || 8);
    }

    function dilemmaShelf(seedIds, list) {
      const chosen = [];
      const seenSeed = {};
      for (const id of seedIds) {
        if (seenSeed[id] || !titleById[id]) continue;
        seenSeed[id] = true;
        chosen.push(titleById[id]);
        if (chosen.length === 3) break;
      }
      if (!chosen.length) return list.slice(0, 8);
      const themeHits = {};
      for (const seed of chosen) {
        for (const themeId of seed.themes) themeHits[themeId] = true;
      }
      return list
        .filter((item) => !seenSeed[item.id])
        .filter((item) => item.themes.some((themeId) => themeHits[themeId]))
        .map((item) => {
          let overlap = 0;
          for (const themeId of item.themes) if (themeHits[themeId]) overlap += 1;
          return { item: item, overlap: overlap };
        })
        .sort((a, b) => {
          const score = b.overlap * 10 + b.item.score - (a.overlap * 10 + a.item.score);
          return score || a.item.name.localeCompare(b.item.name);
        })
        .slice(0, 8)
        .map((entry) => entry.item);
    }

    function pushSeed(seedIds, id) {
      const next = seedIds.filter((seedId) => seedId !== id);
      next.push(id);
      return next.slice(-3);
    }

    return {
      ranks: ranks,
      titleById: titleById,
      packById: packById,
      siblings: siblings,
      passes: passes,
      pool: pool,
      laneCount: laneCount,
      spinDraw: spinDraw,
      dilemmaShelf: dilemmaShelf,
      pushSeed: pushSeed,
      shuffle: shuffle,
    };
  }

  const NIGHT_PACKS = [
    {
      id: "soft",
      label: "Soft",
      blurb: "Soft heat and light mainstream picks, plus a few named fallbacks.",
    },
    {
      id: "camp",
      label: "Camp",
      blurb: "Campy sexploitation and sex-comedy energy.",
    },
    {
      id: "thriller",
      label: "Thriller",
      blurb: "Erotic thrillers, voyeur themes, and danger.",
    },
    {
      id: "shower",
      label: "Shower",
      blurb: "Anything tagged shower, in any lane.",
    },
    {
      id: "prestige",
      label: "Prestige-sensual",
      blurb: "Art-house sensual titles, soft through suggestive.",
    },
  ];

  const HARD_THEMES = { boobs: true, ass: true, solo: true, public_risk: true };
  const LIGHT_THEMES = {
    athletic: true,
    outdoor: true,
    hotel: true,
    lingerie: true,
    office: true,
    massage: true,
  };
  const SOFT_SEEDS = [
    "No Strings Attached",
    "Magic Mike XXL",
    "Challengers",
    "Magic Mike",
    "Love & Other Drugs",
    "Knocked Up",
  ];
  const CAMP_NEEDLES = [
    "meyer",
    "coffy",
    "foxy",
    "barbarella",
    "vixen",
    "supervixens",
    "ultra-vixens",
    "ultra vixens",
    "faster pussycat",
    "austin powers",
    "bachelor party",
    "showgirls",
    "wild things",
  ];
  const CAMP_FORCE = ["Showgirls", "Wild Things", "American Pie", "Fast Times"];
  const THRILLER_SEEDS = ["Basic Instinct", "Body Heat", "Eyes Wide Shut", "Sliver"];
  const PRESTIGE_SEEDS = [
    "Blue Is the Warmest Color",
    "The Dreamers",
    "Y Tu Mamá También",
    "Secretary",
    "9½ Weeks",
    "Eyes Wide Shut",
  ];

  function listNightPacks() {
    return NIGHT_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label,
      blurb: pack.blurb,
    }));
  }

  function nightPackMeta(packId) {
    for (const pack of NIGHT_PACKS) {
      if (pack.id === packId) return { id: pack.id, label: pack.label, blurb: pack.blurb };
    }
    return null;
  }

  function normalizeName(value) {
    return String(value || "")
      .replace(/½/g, " 1/2 ")
      .replace(/&/g, " and ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function containsNeedle(haystack, needle) {
    const hay = normalizeName(haystack);
    const pin = normalizeName(needle);
    return pin.length > 0 && hay.indexOf(pin) !== -1;
  }

  function nameHit(title, needles) {
    return needles.some((needle) => containsNeedle(title && title.name, needle));
  }

  function themeMap(catalog) {
    const map = {};
    for (const theme of (catalog && catalog.themes) || []) map[theme.id] = theme;
    return map;
  }

  function hasTheme(title, themeId) {
    return (title.themes || []).indexOf(themeId) !== -1;
  }

  function hasHardTheme(title) {
    return (title.themes || []).some((themeId) => HARD_THEMES[themeId]);
  }

  function hasLightTheme(title) {
    return (title.themes || []).some((themeId) => LIGHT_THEMES[themeId]);
  }

  function seenHas(seen, id) {
    if (!seen) return false;
    if (typeof seen.has === "function") return seen.has(id);
    if (Array.isArray(seen)) return seen.indexOf(id) !== -1;
    return false;
  }

  function withinHeat(title, heatMax, ranks) {
    if (!heatMax) return true;
    const titleRank = ranks[title.heat];
    const maxRank = ranks[heatMax];
    if (titleRank == null || maxRank == null) return true;
    return titleRank <= maxRank;
  }

  function topGenre(title) {
    const genres = title.genres || [];
    let top = genres[0];
    for (const genre of genres) {
      if (!top || (genre.score || 0) > (top.score || 0)) top = genre;
    }
    return top ? top.label : "";
  }

  function primaryDanger(title) {
    const tag = normalizeName(title.tag);
    if (tag === "thriller" || tag === "noir" || tag === "mystery" || tag === "crime") return true;
    const top = normalizeName(topGenre(title));
    return top === "thriller" || top === "noir" || top === "mystery";
  }

  function campBlob(title, themes) {
    const parts = [title.name || ""];
    if (title.director) parts.push(title.director);
    if (Array.isArray(title.directors)) parts.push(title.directors.join(" "));
    for (const themeId of title.themes || []) {
      parts.push(themeId);
      const theme = themes[themeId];
      if (theme) parts.push(theme.label || "", theme.keyword || "");
    }
    return parts.join(" ");
  }

  function hotelDanger(title) {
    if (!hasTheme(title, "hotel")) return false;
    if (primaryDanger(title)) return true;
    const why = normalizeName(title.why);
    return why.indexOf("danger") !== -1 || why.indexOf("voyeur") !== -1 || why.indexOf("noir") !== -1;
  }

  function artHouse(title) {
    return (title.genres || []).some((genre) => {
      const label = normalizeName(genre && genre.label);
      return label.indexOf("art house") !== -1 || label.indexOf("arthouse") !== -1;
    });
  }

  function uniqueTitles(list) {
    const seen = {};
    const out = [];
    for (const title of list) {
      if (!title || seen[title.id]) continue;
      seen[title.id] = true;
      out.push(title);
    }
    return out;
  }

  function softCandidates(titles) {
    let list = titles.filter((title) => title.heat === "soft" && !hasHardTheme(title));
    const light = list.filter(hasLightTheme);
    if (light.length) list = light;
    const mainstream = list.filter((title) => title.lane === "mainstream");
    if (mainstream.length >= 3) list = mainstream;
    if (list.length < 3) {
      const broad = titles.filter((title) => title.heat === "soft");
      list = uniqueTitles(list.concat(broad));
    }
    const seeds = titles.filter((title) => nameHit(title, SOFT_SEEDS) && title.heat !== "explicit");
    return uniqueTitles(list.concat(seeds));
  }

  function matchesCamp(title, themes) {
    if (nameHit(title, CAMP_FORCE)) return true;
    const blob = campBlob(title, themes);
    return CAMP_NEEDLES.some((needle) => containsNeedle(blob, needle));
  }

  function preferSuggestive(list) {
    const suggestive = list.filter((title) => title.heat === "suggestive");
    if (!suggestive.length) return list;
    return list.filter((title) => title.heat !== "explicit");
  }

  function matchesThriller(title) {
    if (nameHit(title, THRILLER_SEEDS)) return true;
    if (hasTheme(title, "public_risk")) return true;
    if (hotelDanger(title)) return true;
    return title.lane === "mainstream"
      && (title.heat === "soft" || title.heat === "suggestive")
      && primaryDanger(title);
  }

  function mentionsShower(title, themes) {
    return (title.themes || []).some((themeId) => {
      if (containsNeedle(themeId, "shower")) return true;
      const theme = themes[themeId];
      if (!theme) return false;
      return containsNeedle(theme.label, "shower") || containsNeedle(theme.keyword, "shower");
    });
  }

  function showerCandidates(titles, themes) {
    const exact = titles.filter((title) => hasTheme(title, "shower"));
    if (exact.length) return exact;
    return titles.filter((title) => mentionsShower(title, themes));
  }

  function matchesPrestige(title) {
    if (title.heat === "explicit") return false;
    if (nameHit(title, PRESTIGE_SEEDS)) return title.heat === "soft" || title.heat === "suggestive";
    if (title.lane !== "mainstream") return false;
    if (title.heat !== "soft" && title.heat !== "suggestive") return false;
    return artHouse(title);
  }

  function candidatesFor(titles, packId, themes) {
    if (packId === "soft") return softCandidates(titles);
    if (packId === "camp") return preferSuggestive(titles.filter((title) => matchesCamp(title, themes)));
    if (packId === "thriller") return titles.filter(matchesThriller);
    if (packId === "shower") return showerCandidates(titles, themes);
    if (packId === "prestige") return titles.filter(matchesPrestige);
    return [];
  }

  function buildNightPool(catalog, packId, options) {
    const opts = options || {};
    const titles = (catalog && catalog.titles) || [];
    const ranks = opts.ranks || heatRanks(catalog || { heats: [] });
    const themes = themeMap(catalog);
    return candidatesFor(titles, packId, themes)
      .filter((title) => withinHeat(title, opts.heatMax, ranks))
      .filter((title) => !(opts.hideSeen && seenHas(opts.seen, title.id)))
      .slice()
      .sort(byScore);
  }

  function drawNightTitle(pool, rng, avoidId) {
    const random = rng || Math.random;
    if (!pool || !pool.length) return null;
    let choices = pool;
    if (avoidId && pool.length > 1) {
      const next = pool.filter((title) => title.id !== avoidId);
      if (next.length) choices = next;
    }
    const index = Math.floor(random() * choices.length);
    const safe = Math.max(0, Math.min(choices.length - 1, index));
    return choices[safe] || null;
  }

  function drawNightAll(catalog, options, rng) {
    const random = rng || Math.random;
    const used = {};
    const picks = [];
    for (const pack of NIGHT_PACKS) {
      const pool = buildNightPool(catalog, pack.id, options).filter((title) => !used[title.id]);
      const title = drawNightTitle(pool, random);
      if (!title) continue;
      used[title.id] = true;
      picks.push({ packId: pack.id, label: pack.label, title: title });
    }
    return picks;
  }

  function formatNightCopy(picks) {
    return (picks || []).map((pick) => {
      const label = pick.label || (nightPackMeta(pick.packId) || {}).label || pick.packId;
      const title = pick.title || {};
      return label + " — " + title.name + " (" + title.year + ")";
    }).join("\n");
  }

  root.SpinLogic = {
    createEngine: createEngine,
    listNightPacks: listNightPacks,
    nightPackMeta: nightPackMeta,
    buildNightPool: buildNightPool,
    drawNightTitle: drawNightTitle,
    drawNightAll: drawNightAll,
    formatNightCopy: formatNightCopy,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
