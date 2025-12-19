(() => {
  const logger = {
    info: (...args) => console.log('[CountryProcessor]', ...args),
    warn: (...args) => console.warn('[CountryProcessor]', ...args),
    error: (...args) => console.error('[CountryProcessor]', ...args)
  };

  function getDeps() {
    const storage = window.DynmapStorage;
    const parsers = window.DynmapDescParsers;
    const domain = window.DynmapDomain;
    if (!storage) {
      throw new Error('Missing DynmapStorage. Ensure js/data/indexeddb-manager.js is loaded.');
    }
    if (!parsers) {
      throw new Error('Missing DynmapDescParsers. Ensure js/data/desc-parsers.js is loaded.');
    }
    if (!domain) {
      throw new Error('Missing DynmapDomain. Ensure js/data/data-domain.js is loaded.');
    }
    return { storage, parsers, domain };
  }

  async function processCountryData(markers, areas) {
    const { storage, parsers, domain } = getDeps();
    const { DynmapTerritory, DynmapCountry } = domain;

    logger.info('Processing country level data');

    const markerData = markers ?? (await storage.getStoredMarkers());
    const areaData = areas ?? (await storage.getStoredAreas());

    if (!markerData && !areaData) {
      logger.warn('No marker or area data available for country processing.');
      return { countrySpawn: {}, countryAreas: {}, countryCapitals: {}, countryCapitalsSpawn: {} };
    }

    const countries = new Map();

    function ensureCountry(name) {
      if (!countries.has(name)) {
        countries.set(name, new DynmapCountry(name));
      }
      return countries.get(name);
    }

    if (markerData) {
      for (const [markerId, marker] of Object.entries(markerData)) {
        const territory = DynmapTerritory.fromMarker(markerId, marker);
        const countryName = territory.getCountry(parsers);
        if (!countryName) {
          continue;
        }
        const country = ensureCountry(countryName);
        country.addMarker(territory);
      }
    }

    if (areaData) {
      for (const [areaId, area] of Object.entries(areaData)) {
        const territory = DynmapTerritory.fromArea(areaId, area);
        const countryName = territory.getCountry(parsers);
        if (!countryName) {
          continue;
        }
        const country = ensureCountry(countryName);
        country.addArea(territory, parsers);
      }
    }

    const countrySpawn = {};
    const countryAreas = {};
    const countryCapitals = {};
    const countryCapitalsSpawn = {};

    for (const [countryName, country] of countries.entries()) {
      country.resolveCapitalArea(parsers);
      country.finalizeCapitalSpawn(markerData ?? {}, parsers);

      if (country.hasMarkers()) {
        countrySpawn[countryName] = country.spawnGroup;
      }

      if (Object.keys(country.areaMap).length) {
        countryAreas[countryName] = country.areaMap;
      }

      if (country.capitalInfo.name) {
        countryCapitals[countryName] = {
          name: country.capitalInfo.name,
          areas: country.capitalInfo.areas ?? {}
        };
      }

      if (country.capitalSpawnGroup?.spawns?.length) {
        countryCapitalsSpawn[countryName] = country.capitalSpawnGroup;
      }
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
