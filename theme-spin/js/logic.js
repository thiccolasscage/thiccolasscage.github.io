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

  root.SpinLogic = { createEngine: createEngine };
})(typeof globalThis !== "undefined" ? globalThis : this);
