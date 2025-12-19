(() => {
  const DATA_SOURCE_URL = 'https://map.simmc.cc/tiles/_markers_/marker_world.json';
  const LOCAL_DATA_SOURCE_URL = 'data/marker_world.json';
  const LAND_SET_NAMESPACE = 'me.angeschossen.lands';

  const logger = {
    info: (...args) => console.log('[DataFetch]', ...args),
    warn: (...args) => console.warn('[DataFetch]', ...args),
    error: (...args) => console.error('[DataFetch]', ...args)
  };

  function getDeps() {
    const storage = window.DynmapStorage;
    const countryProcessor = window.DynmapCountryProcessor;
    if (!storage) {
      throw new Error('Missing DynmapStorage. Ensure js/data/data-storage.js is loaded.');
    }
    if (!countryProcessor?.processCountryData) {
      throw new Error('Missing DynmapCountryProcessor. Ensure js/data/data-country.js is loaded.');
    }
    return { storage, countryProcessor };
  }

  async function fetchRemoteData() {
    async function fetchJson(url, sourceLabel) {
      logger.info(`Fetching ${sourceLabel} marker data from`, url);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    }

    try {
      return await fetchJson(DATA_SOURCE_URL, 'remote');
    } catch (remoteError) {
      logger.warn('Remote marker fetch failed, trying local fallback.', remoteError);
      try {
        return await fetchJson(LOCAL_DATA_SOURCE_URL, 'local');
      } catch (localError) {
        const combinedError = new Error(
          `Remote fetch failed (${remoteError?.message ?? remoteError}); local fallback failed (${localError?.message ?? localError})`
        );
        combinedError.remoteError = remoteError;
        combinedError.localError = localError;
        throw combinedError;
      }
    }
  }

  function extractLandData(rawData) {
    const landSet = rawData?.sets?.[LAND_SET_NAMESPACE];
    if (!landSet) {
      logger.warn('Land set not found in remote payload.');
      return { markers: {}, areas: {} };
    }

    return {
      markers: landSet.markers ?? {},
      areas: landSet.areas ?? {}
    };
  }

  async function persistFetchedData(markers, areas) {
    const { storage } = getDeps();
    await Promise.all([
      storage.setStoredJson(storage.STORAGE_KEYS.markers, markers ?? {}),
      storage.setStoredJson(storage.STORAGE_KEYS.areas, areas ?? {})
    ]);
  }

  async function fetchAndStoreAllData(options = {}) {
    const { storage, countryProcessor } = getDeps();

    const {
      showStatus = true,
      onStatus,
      onDataUpdated,
      onAfterRefresh
    } = options;

    if (showStatus) {
      onStatus?.('info', '正在从服务器获取最新数据...');
    }

    const rawData = await fetchRemoteData();
    const { markers, areas } = extractLandData(rawData);
    const markersCount = Object.keys(markers).length;
    const areasCount = Object.keys(areas).length;

    await persistFetchedData(markers, areas);
    const countryData = await countryProcessor.processCountryData(markers, areas);
    const storedCapitalColorModes = await storage.getStoredCapitalColorModes();

    onDataUpdated?.({
      markers,
      areas,
      countrySpawn: countryData?.countrySpawn ?? {},
      countryAreas: countryData?.countryAreas ?? {},
      countryCapitals: countryData?.countryCapitals ?? {},
      countryCapitalsSpawn: countryData?.countryCapitalsSpawn ?? {},
      capitalColorModes: storedCapitalColorModes ?? {}
    });

    if (showStatus) {
      onStatus?.('success', `成功存储 ${markersCount} 个标记、${areasCount} 个区域`);
    }

    logger.info(
      'Remote data stored. markers:',
      markersCount,
      'areas:',
      areasCount,
      'capitals:',
      Object.keys(countryData?.countryCapitals ?? {}).length
    );

    await onAfterRefresh?.();
    return { markers, areas, countryData };
  }

  window.DynmapDataFetch = Object.freeze({
    fetchRemoteData,
    extractLandData,
    persistFetchedData,
    fetchAndStoreAllData
  });
})();

