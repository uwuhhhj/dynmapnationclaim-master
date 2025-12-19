(() => {
  function stripHtml(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }

    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseCompactNumber(raw) {
    if (raw === null || raw === undefined) {
      return null;
    }
    const normalized = String(raw).replace(/[,，\s]/g, '').trim();
    if (!normalized) {
      return null;
    }
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function extractCountryFromDesc(desc) {
    const cleanDesc = stripHtml(desc);
    if (!cleanDesc) {
      return null;
    }

    const patterns = [
      /这片领土属于国家[:：]?\s*([^，。:\\s]+)/u
    ];

    for (const pattern of patterns) {
      const match = cleanDesc.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  function extractCapitalFromDescStrict(desc) {
    const cleanDesc = stripHtml(desc);
    if (!cleanDesc) {
      return null;
    }

    const patterns = [
      /首都[:：]?\s*([^，。:\s]+)/u
    ];

    for (const pattern of patterns) {
      const match = cleanDesc.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  function extractPrimaryNameFromDesc(desc) {
    const cleanDesc = stripHtml(desc);
    if (!cleanDesc) {
      return null;
    }

    const firstLine = cleanDesc.split(/\n/u)[0]?.trim();
    if (!firstLine) {
      return null;
    }

    const token = firstLine.split(/[\s，。:：；;]+/u)[0]?.trim();
    return token || null;
  }

  function extractChunkCountFromDesc(desc) {
    const clean = stripHtml(desc);
    if (!clean) {
      return null;
    }

    const match = clean.match(/区块[:：]\s*([0-9,，\s]+)/u);
    if (!match || !match[1]) {
      return null;
    }

    return parseCompactNumber(match[1]);
  }

  function extractCountryTerritoryCountFromDesc(desc) {
    const clean = stripHtml(desc);
    if (!clean) {
      return null;
    }

    const match = clean.match(/领土\s*[（(]\s*数量[:：]\s*([0-9,，\s]+)\s*[,，]/u);
    if (!match || !match[1]) {
      return null;
    }

    return parseCompactNumber(match[1]);
  }

  function extractTerritoryPlayersFromDesc(desc) {
    const clean = stripHtml(desc);
    if (!clean) {
      return null;
    }

    const territoryPlayers = clean.match(/玩家\s*[（(]\s*(\d+)\s*[）)]/u);
    if (territoryPlayers && territoryPlayers[1]) {
      return parseCompactNumber(territoryPlayers[1]);
    }

    return null;
  }

  function extractCountryPlayersTotalFromDesc(desc) {
    const clean = stripHtml(desc);
    if (!clean) {
      return null;
    }

    const territorySummary = clean.match(/领土\s*[（(]\s*数量[:：]\s*[0-9,，\s]+\s*[,，]\s*玩家数量[:：]\s*([0-9,，\s]+)/u);
    if (territorySummary && territorySummary[1]) {
      const parsed = parseCompactNumber(territorySummary[1]);
      if (parsed !== null) {
        return parsed;
      }
    }

    const countryTotal = clean.match(/玩家数量[:：]\s*([0-9,，\s]+)/u);
    if (countryTotal && countryTotal[1]) {
      return parseCompactNumber(countryTotal[1]);
    }

    return null;
  }

  function extractPlayersTotalFromDesc(desc, options = {}) {
    const { scope = 'auto' } = options;

    if (scope === 'territory') {
      return extractTerritoryPlayersFromDesc(desc);
    }

    if (scope === 'country') {
      return extractCountryPlayersTotalFromDesc(desc);
    }

    return extractCountryPlayersTotalFromDesc(desc) ?? extractTerritoryPlayersFromDesc(desc);
  }

  function areaContainsTagDelimitedName(source, name) {
    if (!source || !name || typeof source !== 'string' || typeof name !== 'string') {
      return false;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`>${escaped}<`);
    return re.test(source);
  }

  function deriveTerritoryGroupingName(identifier, source) {
    const candidates = [source?.label, source?.name, source?.title];
    for (const candidate of candidates) {
      const cleaned = stripHtml(candidate);
      if (cleaned) {
        return cleaned;
      }
    }

    const fallback = stripHtml(source?.desc);
    if (fallback) {
      const patterns = [
        /领地[:：]\s*([^，。:\\s]+)/u,
        /territory[:：]?\s*([A-Za-z0-9 _'()-]+)/iu
      ];

      for (const pattern of patterns) {
        const match = fallback.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }

      const primarySegment = fallback.split(/[，。:；;\n]/u)[0]?.trim();
      if (primarySegment) {
        return primarySegment;
      }
    }

    if (identifier) {
      return `Territory ${identifier}`;
    }

    return null;
  }

  window.DynmapDescParsers = Object.freeze({
    stripHtml,
    parseCompactNumber,
    extractCountryFromDesc,
    extractCapitalFromDescStrict,
    extractPrimaryNameFromDesc,
    extractChunkCountFromDesc,
    extractCountryTerritoryCountFromDesc,
    extractTerritoryPlayersFromDesc,
    extractCountryPlayersTotalFromDesc,
    extractPlayersTotalFromDesc,
    areaContainsTagDelimitedName,
    deriveTerritoryGroupingName
  });
})();

