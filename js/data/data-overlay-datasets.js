(() => {
  const OVERLAY_DATASETS = Object.freeze([
    { key: 'territoryMarkers', label: '领地标记（点）' },
    { key: 'territoryAreas', label: '领地区域（面）' },
    { key: 'countrySpawn', label: '国家出生点（点）' },
    { key: 'countryAreas', label: '国家区域（面）' },
    { key: 'countryCapitals', label: '国家首都' },
    { key: 'countryCapitalsSpawn', label: '首都出生点（点）' }
  ]);

  const logger = {
    info: (...args) => console.log('[OverlayDatasets]', ...args),
    warn: (...args) => console.warn('[OverlayDatasets]', ...args),
    error: (...args) => console.error('[OverlayDatasets]', ...args)
  };

  function getDeps() {
    const storage = window.DynmapStorage;
    const parsers = window.DynmapDescParsers;
    if (!storage) {
      throw new Error('Missing DynmapStorage. Ensure js/data/data-storage.js is loaded.');
    }
    if (!parsers) {
      throw new Error('Missing DynmapDescParsers. Ensure js/data/desc-parsers.js is loaded.');
    }
    return { storage, parsers };
  }

  function safeNumber(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function polygonStatsFromXZ(xValues, zValues) {
    if (!Array.isArray(xValues) || !Array.isArray(zValues) || xValues.length !== zValues.length) {
      return null;
    }

    const points = [];
    for (let i = 0; i < xValues.length; i += 1) {
      const x = safeNumber(xValues[i]);
      const z = safeNumber(zValues[i]);
      if (x === null || z === null) {
        continue;
      }
      points.push([x, z]);
    }

    if (points.length === 0) {
      return null;
    }

    let minX = points[0][0];
    let maxX = points[0][0];
    let minZ = points[0][1];
    let maxZ = points[0][1];

    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    let area = 0;
    if (points.length >= 3) {
      for (let i = 0; i < points.length; i += 1) {
        const [x1, z1] = points[i];
        const [x2, z2] = points[(i + 1) % points.length];
        area += x1 * z2 - x2 * z1;
      }
      area = Math.abs(area / 2);
    }

    return {
      minX,
      maxX,
      minZ,
      maxZ,
      centerX,
      centerZ,
      area,
      vertexCount: points.length
    };
  }

  function formatCountry(value) {
    const clean = String(value ?? '').trim();
    return clean ? clean : '无国家';
  }

  function focusMapAtMc(mcX, mcZ) {
    const overlayApi = window.DynmapOverlayLayers;
    const focusFn = overlayApi?.focusMc;
    if (typeof focusFn === 'function') {
      return focusFn(mcX, mcZ);
    }

    const map = overlayApi?.map;
    const converter = overlayApi?.mcToMapCoords;
    if (map && typeof converter === 'function') {
      const coords = converter(mcX, mcZ);
      if (!coords) {
        return false;
      }
      map.setView(coords, Math.min(map.getMaxZoom?.() ?? 2, 2), { animate: true });
      return true;
    }

    logger.warn('Map focus requested but overlay API is missing.');
    return false;
  }

  async function loadOverlayDatasetItems(datasetKey) {
    const { storage, parsers } = getDeps();

    const stripHtml = parsers.stripHtml ?? (value => (typeof value === 'string' ? value : ''));
    const extractCountryFromDesc = parsers.extractCountryFromDesc ?? (() => null);
    const extractPrimaryNameFromDesc = parsers.extractPrimaryNameFromDesc ?? (() => null);
    const extractChunkCountFromDesc = parsers.extractChunkCountFromDesc ?? (() => null);
    const extractCountryTerritoryCountFromDesc = parsers.extractCountryTerritoryCountFromDesc ?? (() => null);
    const extractPlayersTotalFromDesc = parsers.extractPlayersTotalFromDesc ?? (() => null);
    const deriveTerritoryGroupingName = parsers.deriveTerritoryGroupingName ?? (() => null);

    switch (datasetKey) {
      case 'territoryMarkers': {
        const markers = await storage.getStoredMarkers();
        if (!markers || typeof markers !== 'object') {
          return [];
        }
        return Object.entries(markers).map(([id, marker]) => {
          const name = stripHtml(marker?.label) || stripHtml(marker?.name) || id;
          const descSource = typeof marker?.desc === 'string' ? marker.desc : (typeof marker?.markup === 'string' ? marker.markup : '');
          const country =
            extractCountryFromDesc(marker?.markup) ||
            extractCountryFromDesc(marker?.desc) ||
            extractCountryFromDesc(marker?.label);
          const chunks = extractChunkCountFromDesc(descSource);
          const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
          const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
          const territoryCount = extractCountryTerritoryCountFromDesc(descSource);

          const mcX = safeNumber(marker?.x);
          const mcZ = safeNumber(marker?.z);

          return {
            kind: 'point',
            id,
            name,
            country: formatCountry(country),
            mcX,
            mcZ,
            size: 0,
            quantity: 1,
            chunks,
            townPlayers,
            countryPlayers,
            territoryCount
          };
        });
      }
      case 'territoryAreas': {
        const areas = await storage.getStoredAreas();
        if (!areas || typeof areas !== 'object') {
          return [];
        }
        return Object.entries(areas).flatMap(([id, area]) => {
          const stats = polygonStatsFromXZ(area?.x, area?.z);
          if (!stats) {
            return [];
          }

          const descSource = typeof area?.desc === 'string' ? area.desc : (typeof area?.markup === 'string' ? area.markup : '');
          const name =
            extractPrimaryNameFromDesc(area?.markup) ||
            extractPrimaryNameFromDesc(area?.desc) ||
            extractPrimaryNameFromDesc(area?.label) ||
            deriveTerritoryGroupingName(id, area) ||
            `区域 ${id.split('_')[0] || id}`;

          const country =
            extractCountryFromDesc(area?.markup) ||
            extractCountryFromDesc(area?.desc) ||
            extractCountryFromDesc(area?.label);

          const chunks = extractChunkCountFromDesc(descSource);
          const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
          const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
          const territoryCount = extractCountryTerritoryCountFromDesc(descSource);

          return [
            {
              kind: 'polygon',
              id,
              name,
              country: formatCountry(country),
              mcX: stats.centerX,
              mcZ: stats.centerZ,
              size: stats.area,
              quantity: stats.vertexCount,
              chunks,
              townPlayers,
              countryPlayers,
              territoryCount
            }
          ];
        });
      }
      case 'countrySpawn': {
        const countrySpawn = await storage.getStoredCountrySpawn();
        if (!countrySpawn || typeof countrySpawn !== 'object') {
          return [];
        }

        const items = [];
        for (const [countryName, group] of Object.entries(countrySpawn)) {
          const spawns = Array.isArray(group?.spawns) ? group.spawns : [];
          spawns.forEach((spawn, index) => {
            const markerData = spawn?.markerData;
            const descSource = typeof markerData?.desc === 'string' ? markerData.desc : (typeof markerData?.markup === 'string' ? markerData.markup : '');
            const chunks = extractChunkCountFromDesc(descSource);
            const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
            const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
            const territoryCount = extractCountryTerritoryCountFromDesc(descSource);
            const mcX = safeNumber(spawn?.x);
            const mcZ = safeNumber(spawn?.z);
            items.push({
              kind: 'point',
              id: String(spawn?.markerId ?? `${countryName}:spawn:${index}`),
              name: stripHtml(spawn?.name) || String(spawn?.markerId ?? countryName),
              country: formatCountry(countryName),
              mcX,
              mcZ,
              size: 0,
              quantity: 1,
              chunks,
              townPlayers,
              countryPlayers,
              territoryCount
            });
          });
        }
        return items;
      }
      case 'countryAreas': {
        const countryAreas = await storage.getStoredCountryAreas();
        if (!countryAreas || typeof countryAreas !== 'object') {
          return [];
        }

        const items = [];
        for (const [countryName, areas] of Object.entries(countryAreas)) {
          if (!areas || typeof areas !== 'object') {
            continue;
          }
          for (const [areaId, area] of Object.entries(areas)) {
            const stats = polygonStatsFromXZ(area?.x, area?.z);
            if (!stats) {
              continue;
            }
            const descSource = typeof area?.desc === 'string' ? area.desc : (typeof area?.markup === 'string' ? area.markup : '');
            const name =
              extractPrimaryNameFromDesc(area?.markup) ||
              extractPrimaryNameFromDesc(area?.desc) ||
              extractPrimaryNameFromDesc(area?.label) ||
              deriveTerritoryGroupingName(areaId, area) ||
              `区域 ${areaId.split('_')[0] || areaId}`;

            const chunks = extractChunkCountFromDesc(descSource);
            const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
            const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
            const territoryCount = extractCountryTerritoryCountFromDesc(descSource);

            items.push({
              kind: 'polygon',
              id: areaId,
              name,
              country: formatCountry(countryName),
              mcX: stats.centerX,
              mcZ: stats.centerZ,
              size: stats.area,
              quantity: stats.vertexCount,
              chunks,
              townPlayers,
              countryPlayers,
              territoryCount
            });
          }
        }
        return items;
      }
      case 'countryCapitals': {
        const countryCapitals = await storage.getStoredCountryCapitals();
        if (!countryCapitals || typeof countryCapitals !== 'object') {
          return [];
        }

        const items = [];
        for (const [countryName, capitalInfo] of Object.entries(countryCapitals)) {
          const capitalName = stripHtml(capitalInfo?.name) || String(countryName);
          const areas = capitalInfo?.areas;
          if (!areas || typeof areas !== 'object') {
            continue;
          }
          for (const [areaId, area] of Object.entries(areas)) {
            const stats = polygonStatsFromXZ(area?.x, area?.z);
            if (!stats) {
              continue;
            }
            const descSource = typeof area?.desc === 'string' ? area.desc : (typeof area?.markup === 'string' ? area.markup : '');
            const chunks = extractChunkCountFromDesc(descSource);
            const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
            const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
            const territoryCount = extractCountryTerritoryCountFromDesc(descSource);
            items.push({
              kind: 'polygon',
              id: areaId,
              name: capitalName,
              country: formatCountry(countryName),
              mcX: stats.centerX,
              mcZ: stats.centerZ,
              size: stats.area,
              quantity: stats.vertexCount,
              chunks,
              townPlayers,
              countryPlayers,
              territoryCount
            });
          }
        }
        return items;
      }
      case 'countryCapitalsSpawn': {
        const countryCapitalsSpawn = await storage.getStoredCountryCapitalsSpawn();
        if (!countryCapitalsSpawn || typeof countryCapitalsSpawn !== 'object') {
          return [];
        }

        const markers = await storage.getStoredMarkers();
        const items = [];
        for (const [countryName, group] of Object.entries(countryCapitalsSpawn)) {
          const spawns = Array.isArray(group?.spawns) ? group.spawns : [];
          spawns.forEach((spawn, index) => {
            const markerId = String(spawn?.markerId ?? `${countryName}:capitalSpawn:${index}`);
            const markerData = markers && typeof markers === 'object' ? markers[markerId] : null;
            const descSource = typeof markerData?.desc === 'string' ? markerData.desc : (typeof markerData?.markup === 'string' ? markerData.markup : '');
            const chunks = extractChunkCountFromDesc(descSource);
            const townPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'territory' });
            const countryPlayers = extractPlayersTotalFromDesc(descSource, { scope: 'country' });
            const territoryCount = extractCountryTerritoryCountFromDesc(descSource);
            const mcX = safeNumber(spawn?.x);
            const mcZ = safeNumber(spawn?.z);
            items.push({
              kind: 'point',
              id: markerId,
              name: stripHtml(spawn?.name) || String(spawn?.markerId ?? countryName),
              country: formatCountry(countryName),
              mcX,
              mcZ,
              size: 0,
              quantity: 1,
              chunks,
              townPlayers,
              countryPlayers,
              territoryCount
            });
          });
        }
        return items;
      }
      default:
        return [];
    }
  }

  window.DynmapOverlayDatasets = Object.freeze({
    OVERLAY_DATASETS,
    loadOverlayDatasetItems,
    focusMapAtMc
  });
})();

