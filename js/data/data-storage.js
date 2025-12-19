(() => {
  const STORAGE_KEYS = Object.freeze({
    markers: 'landMarkers',
    areas: 'landAreas',
    countrySpawn: 'countrySpawn',
    countryAreas: 'countryAreas',
    countryCapitals: 'countryCapitals',
    countryCapitalsSpawn: 'countryCapitalsSpawn',
    countryClaims: 'countryClaims',
    claimsConfig: 'claimsConfig',
    conflictResolvedBoundaries: 'conflictResolvedBoundaries',
    capitalColorModes: 'capitalColorModes'
  });

  const logger = {
    info: (...args) => console.log('[Storage]', ...args),
    warn: (...args) => console.warn('[Storage]', ...args),
    error: (...args) => console.error('[Storage]', ...args)
  };

  async function getStoredJson(key) {
    if (!key || typeof key !== 'string') {
      logger.warn('getStoredJson called without a valid key, skipping lookup.', key);
      return null;
    }

    const rawValue = await window.IndexedDBStorage?.getItem?.(key);
    if (rawValue === null || rawValue === undefined) {
      return null;
    }

    if (typeof rawValue === 'string') {
      try {
        return JSON.parse(rawValue);
      } catch (error) {
        logger.warn(`Unable to parse value for key "${key}" as JSON. Returning raw string.`, error);
        return rawValue;
      }
    }

    return rawValue;
  }

  async function setStoredJson(key, value) {
    if (value === undefined) {
      return;
    }

    if (value === null) {
      await window.IndexedDBStorage?.removeItem?.(key);
      return;
    }

    await window.IndexedDBStorage?.setItem?.(key, value);
  }

  async function removeStoredItem(key) {
    await window.IndexedDBStorage?.removeItem?.(key);
  }

  const api = Object.freeze({
    STORAGE_KEYS,
    getStoredJson,
    setStoredJson,
    removeStoredItem,

    getStoredMarkers: () => getStoredJson(STORAGE_KEYS.markers),
    getStoredAreas: () => getStoredJson(STORAGE_KEYS.areas),
    getStoredCountrySpawn: () => getStoredJson(STORAGE_KEYS.countrySpawn),
    getStoredCountryAreas: () => getStoredJson(STORAGE_KEYS.countryAreas),
    getStoredCountryCapitals: () => getStoredJson(STORAGE_KEYS.countryCapitals),
    getStoredCountryCapitalsSpawn: () => getStoredJson(STORAGE_KEYS.countryCapitalsSpawn),
    getStoredCapitalColorModes: () => getStoredJson(STORAGE_KEYS.capitalColorModes),
    setStoredCapitalColorModes: (value) => setStoredJson(STORAGE_KEYS.capitalColorModes, value),
    getStoredCountryClaims: () => getStoredJson(STORAGE_KEYS.countryClaims),
    setStoredCountryClaims: (value) => setStoredJson(STORAGE_KEYS.countryClaims, value),
    getStoredClaimsConfig: () => getStoredJson(STORAGE_KEYS.claimsConfig),
    setStoredClaimsConfig: (value) => setStoredJson(STORAGE_KEYS.claimsConfig, value),
    getStoredConflictResolvedBoundaries: () => getStoredJson(STORAGE_KEYS.conflictResolvedBoundaries),
    setStoredConflictResolvedBoundaries: (value) => setStoredJson(STORAGE_KEYS.conflictResolvedBoundaries, value)
  });

  window.DynmapStorage = api;
})();

