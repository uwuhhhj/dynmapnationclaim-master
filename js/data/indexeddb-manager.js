/**
 * IndexedDB 数据管理器
 * 提供统一的数据存储接口，替代 localStorage
 * 支持更复杂的数据结构和更大的存储容量
 */

class IndexedDBManager {
    constructor(dbName = 'DynmapDB', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.storeName = 'dataStore';

        // 初始化状态
        this.isInitialized = false;
        this.initPromise = null;
    }

    /**
     * 初始化数据库
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._initDatabase();
        await this.initPromise;
        this.isInitialized = true;
    }

    /**
     * 内部数据库初始化方法
     * @returns {Promise<void>}
     * @private
     */
    _initDatabase() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('IndexedDB 不被当前浏览器支持'));
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                reject(new Error(`数据库打开失败: ${request.error}`));
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB 数据库初始化成功');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建对象存储空间
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'key' });

                    // 创建索引
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('type', 'type', { unique: false });

                    console.log('✅ 创建了新的对象存储空间:', this.storeName);
                }
            };
        });
    }

    /**
     * 存储数据
     * @param {string} key - 数据键
     * @param {any} value - 数据值
     * @param {string} type - 数据类型（可选）
     * @returns {Promise<void>}
     */
    async set(key, value, type = 'default') {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            const data = {
                key,
                value,
                type,
                timestamp: Date.now()
            };

            const request = store.put(data);

            request.onsuccess = () => {
                console.log(`✅ 数据已存储: ${key}`);
                resolve();
            };

            request.onerror = () => {
                reject(new Error(`存储数据失败: ${request.error}`));
            };
        });
    }

    /**
     * 获取数据
     * @param {string} key - 数据键
     * @returns {Promise<any>} 数据值，如果不存在返回 null
     */
    async get(key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : null);
            };

            request.onerror = () => {
                reject(new Error(`获取数据失败: ${request.error}`));
            };
        });
    }

    /**
     * 删除数据
     * @param {string} key - 数据键
     * @returns {Promise<boolean>} 删除是否成功
     */
    async remove(key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => {
                console.log(`✅ 数据已删除: ${key}`);
                resolve(true);
            };

            request.onerror = () => {
                reject(new Error(`删除数据失败: ${request.error}`));
            };
        });
    }

    /**
     * 查询数据
     * @param {Object} options - 查询选项
     * @param {string} options.type - 按类型过滤
     * @param {number} options.limit - 限制结果数量
     * @param {string} options.keyPattern - 键名模式匹配
     * @returns {Promise<Array>} 查询结果数组
     */
    async query(options = {}) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const results = [];

            let request;
            if (options.type) {
                // 按类型查询
                const index = store.index('type');
                request = index.openCursor(IDBKeyRange.only(options.type));
            } else {
                // 查询所有
                request = store.openCursor();
            }

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const data = cursor.value;

                    // 键名模式匹配
                    if (options.keyPattern) {
                        const regex = new RegExp(options.keyPattern);
                        if (!regex.test(data.key)) {
                            cursor.continue();
                            return;
                        }
                    }

                    results.push({
                        key: data.key,
                        value: data.value,
                        type: data.type,
                        timestamp: data.timestamp
                    });

                    // 限制结果数量
                    if (options.limit && results.length >= options.limit) {
                        resolve(results);
                        return;
                    }

                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => {
                reject(new Error(`查询数据失败: ${request.error}`));
            };
        });
    }

    /**
     * 获取所有键名
     * @returns {Promise<Array<string>>} 所有键名数组
     */
    async getAllKeys() {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(new Error(`获取键名失败: ${request.error}`));
            };
        });
    }

    /**
     * 清除所有数据
     * @returns {Promise<void>}
     */
    async clear() {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('✅ 所有数据已清除');
                resolve();
            };

            request.onerror = () => {
                reject(new Error(`清除数据失败: ${request.error}`));
            };
        });
    }

    /**
     * 获取数据库统计信息
     * @returns {Promise<Object>} 统计信息
     */
    async getStats() {
        await this.init();

        const keys = await this.getAllKeys();
        const data = await this.query();

        const typeStats = {};
        data.forEach(item => {
            typeStats[item.type] = (typeStats[item.type] || 0) + 1;
        });

        return {
            totalItems: keys.length,
            typeStats,
            dbName: this.dbName,
            version: this.version
        };
    }

    /**
     * 批量操作
     * @param {Array} operations - 操作数组，每个操作包含 {type, key, value}
     * @returns {Promise<Array>} 操作结果数组
     */
    async batch(operations) {
        await this.init();

        const results = [];

        for (const op of operations) {
            try {
                switch (op.type) {
                    case 'set':
                        await this.set(op.key, op.value, op.dataType);
                        results.push({ success: true, key: op.key });
                        break;
                    case 'get':
                        const value = await this.get(op.key);
                        results.push({ success: true, key: op.key, value });
                        break;
                    case 'remove':
                        await this.remove(op.key);
                        results.push({ success: true, key: op.key });
                        break;
                    default:
                        results.push({ success: false, key: op.key, error: '未知操作类型' });
                }
            } catch (error) {
                results.push({ success: false, key: op.key, error: error.message });
            }
        }

        return results;
    }

    /**
     * 关闭数据库连接
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.isInitialized = false;
            this.initPromise = null;
            console.log('✅ IndexedDB 连接已关闭');
        }
    }
}

// 创建全局实例
const dbManager = new IndexedDBManager();

// 导出兼容 localStorage 的接口
const IndexedDBStorage = {
    /**
     * 设置数据（兼容 localStorage.setItem）
     * @param {string} key
     * @param {string} value
     */
    async setItem(key, value) {
        try {
            // 如果 value 是字符串，尝试解析为 JSON 以保持兼容性
            let parsedValue = value;
            if (typeof value === 'string') {
                try {
                    parsedValue = JSON.parse(value);
                } catch {
                    // 如果解析失败，保持原字符串
                    parsedValue = value;
                }
            }
            await dbManager.set(key, parsedValue);
        } catch (error) {
            console.error('IndexedDB setItem 失败:', error);
            throw error;
        }
    },

    /**
     * 获取数据（兼容 localStorage.getItem）
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async getItem(key) {
        try {
            const value = await dbManager.get(key);
            if (value === null) return null;

            // 为了兼容 localStorage，返回 JSON 字符串
            return typeof value === 'string' ? value : JSON.stringify(value);
        } catch (error) {
            console.error('IndexedDB getItem 失败:', error);
            return null;
        }
    },

    /**
     * 删除数据（兼容 localStorage.removeItem）
     * @param {string} key
     */
    async removeItem(key) {
        try {
            await dbManager.remove(key);
        } catch (error) {
            console.error('IndexedDB removeItem 失败:', error);
            throw error;
        }
    },

    /**
     * 清除所有数据（兼容 localStorage.clear）
     */
    async clear() {
        try {
            await dbManager.clear();
        } catch (error) {
            console.error('IndexedDB clear 失败:', error);
            throw error;
        }
    },

    /**
     * 获取所有键名（兼容 localStorage.key）
     * @returns {Promise<Array<string>>}
     */
    async getAllKeys() {
        try {
            return await dbManager.getAllKeys();
        } catch (error) {
            console.error('IndexedDB getAllKeys 失败:', error);
            return [];
        }
    },

    /**
     * 获取数据数量（兼容 localStorage.length）
     * @returns {Promise<number>}
     */
    async length() {
        try {
            const keys = await this.getAllKeys();
            return keys.length;
        } catch (error) {
            console.error('IndexedDB length 失败:', error);
            return 0;
        }
    }
};



// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IndexedDBManager, IndexedDBStorage, dbManager };
} else {
    window.IndexedDBManager = IndexedDBManager;
    window.IndexedDBStorage = IndexedDBStorage;
    window.dbManager = dbManager;
}
