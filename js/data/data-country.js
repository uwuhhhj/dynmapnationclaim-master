(() => {
  const logger = {
    info: (...args) => console.log('[CountryProcessor]', ...args),
    warn: (...args) => console.warn('[CountryProcessor]', ...args),
    error: (...args) => console.error('[CountryProcessor]', ...args)
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

  async function processCountryData(markers, areas) {
    const { storage, parsers } = getDeps();
    const {
      extractCountryFromDesc,
      extractCapitalFromDescStrict,
      extractPrimaryNameFromDesc,
      areaContainsTagDelimitedName,
      stripHtml
    } = parsers;

    logger.info('Processing country level data…');

    const markerData = markers ?? (await storage.getStoredMarkers());
    const areaData = areas ?? (await storage.getStoredAreas());

    if (!markerData && !areaData) {
      logger.warn('No marker or area data available for country processing.');
      return { countrySpawn: {}, countryAreas: {}, countryCapitals: {}, countryCapitalsSpawn: {} };
    }

    const countrySpawn = {};
    const countryAreas = {};
    const countryCapitals = {};
    const countryCapitalsSpawn = {};

    if (markerData) {
      for (const [markerId, marker] of Object.entries(markerData)) {
        const countryName =
          extractCountryFromDesc(marker?.markup) ||
          extractCountryFromDesc(marker?.desc) ||
          extractCountryFromDesc(marker?.label);

        if (!countryName) {
          continue;
        }

        if (!countrySpawn[countryName]) {
          countrySpawn[countryName] = { spawns: [] };
        }

        if (marker?.x !== undefined && marker?.z !== undefined) {
          countrySpawn[countryName].spawns.push({
            x: marker.x,
            z: marker.z,
            y: marker.y ?? 64,
            name: marker.label || markerId,
            markerId,
            markerData: marker
          });
        }

        countrySpawn[countryName][markerId] = marker;
      }
    }

    if (areaData) {
      for (const [areaId, area] of Object.entries(areaData)) {
        const countryName =
          extractCountryFromDesc(area?.markup) ||
          extractCountryFromDesc(area?.desc) ||
          extractCountryFromDesc(area?.label);

        if (!countryName) {
          continue;
        }

        if (!countryAreas[countryName]) {
          countryAreas[countryName] = {};
        }

        countryAreas[countryName][areaId] = area;

        const capitalName =
          extractCapitalFromDescStrict(area?.markup) ||
          extractCapitalFromDescStrict(area?.desc) ||
          extractCapitalFromDescStrict(area?.label);

        if (capitalName) {
          if (!countryCapitals[countryName]) {
            countryCapitals[countryName] = { name: capitalName, areas: {} };
          } else if (!countryCapitals[countryName].areas) {
            countryCapitals[countryName].areas = {};
          }

          countryCapitals[countryName].name = capitalName;

          const matchesCapitalArea =
            areaContainsTagDelimitedName(area?.markup, capitalName) ||
            areaContainsTagDelimitedName(area?.label, capitalName) ||
            areaContainsTagDelimitedName(area?.desc, capitalName);

          if (matchesCapitalArea) {
            countryCapitals[countryName].areas[areaId] = area;
          }
        }
      }
    }

    Object.entries(countryCapitals).forEach(([countryName, capitalInfo]) => {
      if (!capitalInfo || typeof capitalInfo !== 'object') {
        return;
      }

      if (!capitalInfo.areas || typeof capitalInfo.areas !== 'object') {
        capitalInfo.areas = {};
      }

      if (Object.keys(capitalInfo.areas).length > 0) {
        return;
      }

      const capitalName = capitalInfo.name;
      if (!capitalName) {
        return;
      }

      const ownedAreas = countryAreas[countryName];
      if (!ownedAreas || typeof ownedAreas !== 'object') {
        return;
      }

      const entries = Object.entries(ownedAreas);
      if (!entries.length) {
        return;
      }

      const exactMatch = entries.find(([, area]) => {
        const primaryName =
          extractPrimaryNameFromDesc(area?.markup) ||
          extractPrimaryNameFromDesc(area?.desc) ||
          extractPrimaryNameFromDesc(area?.label);
        return primaryName === capitalName;
      });

      if (exactMatch) {
        const [areaId, area] = exactMatch;
        capitalInfo.areas[areaId] = area;
        return;
      }

      const includesMatch = entries.find(([, area]) => {
        const cleanText = stripHtml(area?.markup) || stripHtml(area?.desc) || stripHtml(area?.label);
        return cleanText ? cleanText.includes(capitalName) : false;
      });

      if (includesMatch) {
        const [areaId, area] = includesMatch;
        capitalInfo.areas[areaId] = area;
        return;
      }

      if (entries.length === 1) {
        const [areaId, area] = entries[0];
        capitalInfo.areas[areaId] = area;
      }
    });

    if (markerData) {
      Object.entries(countryCapitals).forEach(([countryName, capitalInfo]) => {
        const capitalName = capitalInfo?.name || countryName;
        const capitalAreas = capitalInfo?.areas || {};
        const areaIds = Object.keys(capitalAreas);

        let spawnMarkerId = null;
        let spawnMarker = null;
        let sourceAreaId = null;

        if (areaIds.length) {
          sourceAreaId = areaIds[0];
          const underscoreIdx = sourceAreaId.lastIndexOf('_');
          const baseId = underscoreIdx > 0 ? sourceAreaId.slice(0, underscoreIdx) : sourceAreaId;
          const candidateMarkerId = `${baseId}_spawn`;
          const candidateMarker = markerData[candidateMarkerId];
          if (candidateMarker && candidateMarker.x !== undefined && candidateMarker.z !== undefined) {
            spawnMarkerId = candidateMarkerId;
            spawnMarker = candidateMarker;
          }
        }

        if (!spawnMarker) {
          const targetLabel = String(capitalName || '');
          for (const [markerId, marker] of Object.entries(markerData)) {
            if (!markerId.endsWith('_spawn')) {
              continue;
            }
            if (marker?.label !== targetLabel) {
              continue;
            }

            const parsedCountry =
              extractCountryFromDesc(marker?.markup) ||
              extractCountryFromDesc(marker?.desc) ||
              extractCountryFromDesc(marker?.label);

            if (parsedCountry && parsedCountry !== countryName) {
              continue;
            }

            if (marker?.x === undefined || marker?.z === undefined) {
              continue;
            }

            spawnMarkerId = markerId;
            spawnMarker = marker;
            break;
          }
        }

        if (!spawnMarker || spawnMarker.x === undefined || spawnMarker.z === undefined) {
          return;
        }

        countryCapitalsSpawn[countryName] = {
          spawns: [
            {
              x: spawnMarker.x,
              z: spawnMarker.z,
              y: spawnMarker.y ?? 64,
              name: capitalName,
              markerId: spawnMarkerId,
              sourceAreaId
            }
          ]
        };
      });
    }

    await Promise.all([
      storage.setStoredJson(storage.STORAGE_KEYS.countrySpawn, countrySpawn),
      storage.setStoredJson(storage.STORAGE_KEYS.countryAreas, countryAreas),
      storage.setStoredJson(storage.STORAGE_KEYS.countryCapitals, countryCapitals),
      storage.setStoredJson(storage.STORAGE_KEYS.countryCapitalsSpawn, countryCapitalsSpawn)
    ]);

    logger.info(
      `Country data stored. spawn groups: ${Object.keys(countrySpawn).length}, area groups: ${Object.keys(countryAreas).length}, capital groups: ${Object.keys(countryCapitals).length}`
    );

    return { countrySpawn, countryAreas, countryCapitals, countryCapitalsSpawn };
  }

  window.DynmapCountryProcessor = Object.freeze({ processCountryData });
})();

