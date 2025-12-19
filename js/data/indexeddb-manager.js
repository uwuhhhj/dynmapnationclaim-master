/**
 * IndexedDB storage facade backed by Dexie.js.
 * Keeps the existing window.IndexedDBStorage API used across the app.
 */

(function () {
  const DEFAULT_DB_NAME = 'DynmapDB';
  const DEFAULT_TABLE = 'dataStore';

  class DexieKVStore {
    constructor(options = {}) {
      this.dbName = options.dbName || DEFAULT_DB_NAME;
      this.tableName = options.tableName || DEFAULT_TABLE;
      this.version = Number.isFinite(options.version) ? options.version : 1;
      this.db = null;
      this.table = null;
      this.isInitialized = false;
      this.initPromise = null;
    }

    async init() {
      if (this.isInitialized) {
        return;
      }
      if (this.initPromise) {
        return this.initPromise;
      }
      this.initPromise = this._initDexie();
      await this.initPromise;
      this.isInitialized = true;
    }

    async _initDexie() {
      if (!window.Dexie) {
        throw new Error('Dexie.js not found. Ensure js/libs/dexie.min.js is loaded.');
      }

      const db = new window.Dexie(this.dbName);
      db.version(this.version).stores({
        [this.tableName]: 'key, type, timestamp'
      });

      await db.open();
      this.db = db;
      this.table = db.table(this.tableName);
    }

    _coerceStoredValue(value) {
      if (typeof value !== 'string') {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    _coerceReturnValue(value) {
      if (value === null || value === undefined) {
        return null;
      }
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    async setItem(key, value, type = 'default') {
      await this.init();
      await this.table.put({
        key,
        value: this._coerceStoredValue(value),
        type,
        timestamp: Date.now()
      });
    }

    async getItem(key) {
      await this.init();
      const record = await this.table.get(key);
      return this._coerceReturnValue(record ? record.value : null);
    }

    async removeItem(key) {
      await this.init();
      await this.table.delete(key);
    }

    async clear() {
      await this.init();
      await this.table.clear();
    }

    async getAllKeys() {
      await this.init();
      return this.table.toCollection().primaryKeys();
    }

    async length() {
      await this.init();
      return this.table.count();
    }

    async query(options = {}) {
      await this.init();

      const { type, limit, keyPattern } = options || {};
      const keyRegex = keyPattern ? new RegExp(keyPattern) : null;

      let collection = this.table.toCollection();
      if (type) {
        collection = this.table.where('type').equals(type);
      }

      let results = await collection.toArray();
      if (keyRegex) {
        results = results.filter(item => keyRegex.test(item.key));
      }
      if (Number.isFinite(limit) && limit > 0) {
        results = results.slice(0, limit);
      }

      return results.map(item => ({
        key: item.key,
        value: item.value,
        type: item.type,
        timestamp: item.timestamp
      }));
    }

    async getStats() {
      await this.init();
      const [totalItems, data] = await Promise.all([this.table.count(), this.query()]);
      const typeStats = {};
      data.forEach(item => {
        typeStats[item.type] = (typeStats[item.type] || 0) + 1;
      });

      return {
        totalItems,
        typeStats,
        dbName: this.dbName,
        version: this.version
      };
    }

    async batch(operations = []) {
      await this.init();
      const results = [];

      for (const op of operations) {
        try {
          switch (op.type) {
            case 'set':
              await this.setItem(op.key, op.value, op.dataType);
              results.push({ success: true, key: op.key });
              break;
            case 'get': {
              const value = await this.getItem(op.key);
              results.push({ success: true, key: op.key, value });
              break;
            }
            case 'remove':
              await this.removeItem(op.key);
              results.push({ success: true, key: op.key });
              break;
            default:
              results.push({ success: false, key: op.key, error: '未知操作类型' });
          }
        } catch (error) {
          results.push({ success: false, key: op.key, error: error?.message || String(error) });
        }
      }

      return results;
    }

    close() {
      try {
        this.db?.close?.();
      } finally {
        this.db = null;
        this.table = null;
        this.isInitialized = false;
        this.initPromise = null;
      }
    }
  }

  const dbManager = new DexieKVStore();

  const IndexedDBStorage = {
    async setItem(key, value) {
      try {
        await dbManager.setItem(key, value, 'default');
      } catch (error) {
        console.error('Dexie setItem failed:', error);
        throw error;
      }
    },

    async getItem(key) {
      try {
        return await dbManager.getItem(key);
      } catch (error) {
        console.error('Dexie getItem failed:', error);
        return null;
      }
    },

    async removeItem(key) {
      try {
        await dbManager.removeItem(key);
      } catch (error) {
        console.error('Dexie removeItem failed:', error);
        throw error;
      }
    },

    async clear() {
      try {
        await dbManager.clear();
      } catch (error) {
        console.error('Dexie clear failed:', error);
        throw error;
      }
    },

    async getAllKeys() {
      try {
        return await dbManager.getAllKeys();
      } catch (error) {
        console.error('Dexie getAllKeys failed:', error);
        return [];
      }
    },

    async length() {
      try {
        return await dbManager.length();
      } catch (error) {
        console.error('Dexie length failed:', error);
        return 0;
      }
    },

    async query(options) {
      try {
        return await dbManager.query(options);
      } catch (error) {
        console.error('Dexie query failed:', error);
        return [];
      }
    },

    async getStats() {
      try {
        return await dbManager.getStats();
      } catch (error) {
        console.error('Dexie getStats failed:', error);
        return { totalItems: 0, typeStats: {}, dbName: dbManager.dbName, version: dbManager.version };
      }
    },

    async batch(operations) {
      return dbManager.batch(operations);
    },

    close() {
      dbManager.close();
    }
  };

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

  const storageLogger = {
    info: (...args) => console.log('[Storage]', ...args),
    warn: (...args) => console.warn('[Storage]', ...args),
    error: (...args) => console.error('[Storage]', ...args)
  };

  async function getStoredJson(key) {
    if (!key || typeof key !== 'string') {
      storageLogger.warn('getStoredJson called without a valid key, skipping lookup.', key);
      return null;
    }

    try {
      const rawValue = await IndexedDBStorage.getItem(key);
      if (rawValue === null || rawValue === undefined) {
        return null;
      }

      if (typeof rawValue === 'string') {
        try {
          return JSON.parse(rawValue);
        } catch (parseError) {
          storageLogger.warn(`Unable to parse value for key "${key}" as JSON. Returning raw string.`, parseError);
          return rawValue;
        }
      }

      return rawValue;
    } catch (error) {
      storageLogger.warn(`Unable to read key "${key}". Returning null.`, error);
      return null;
    }
  }

  async function setStoredJson(key, value) {
    if (value === undefined) {
      return;
    }

    if (value === null) {
      await IndexedDBStorage.removeItem(key);
      return;
    }

    await IndexedDBStorage.setItem(key, value);
  }

  async function removeStoredItem(key) {
    await IndexedDBStorage.removeItem(key);
  }

  const DynmapStorage = Object.freeze({
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IndexedDBStorage, dbManager, DexieKVStore, DynmapStorage };
  } else {
    window.IndexedDBStorage = IndexedDBStorage;
    window.dbManager = dbManager;
    window.DynmapStorage = DynmapStorage;
  }
})();
