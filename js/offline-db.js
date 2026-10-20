import { openDB } from './vendor/idb.js';

class OfflineDB {
    constructor() {
        this.dbPromise = openDB('LiftCallsDB', 1, {
            upgrade(db) {
                // Настройки и кэш конфига
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'key' });
                }
                // Плоский список адресов для поиска
                if (!db.objectStoreNames.contains('address_flat')) {
                    const store = db.createObjectStore('address_flat', { keyPath: 'id' });
                    store.createIndex('city_id', 'city_id');
                }
                // Очередь неотправленных заявок
                if (!db.objectStoreNames.contains('outbox')) {
                    db.createObjectStore('outbox', { keyPath: 'uuid' });
                }
                // Кэш заявок (для отображения без сети)
                if (!db.objectStoreNames.contains('tickets_cache')) {
                    db.createObjectStore('tickets_cache', { keyPath: 'id' });
                }
            }
        });
    }

    // --- Конфиг ---
    async setConfig(key, value) {
        const db = await this.dbPromise;
        await db.put('config', { key, value });
    }

    async getConfig(key) {
        const db = await this.dbPromise;
        const res = await db.get('config', key);
        return res ? res.value : null;
    }

    // --- Адреса ---
    async saveAddresses(flatAddresses) {
        const db = await this.dbPromise;
        const tx = db.transaction('address_flat', 'readwrite');
        const store = tx.objectStore('address_flat');
        await store.clear(); // Очищаем старые
        for (const addr of flatAddresses) {
            store.put(addr); // Не ждем await, чтобы быстрее
        }
        await tx.done;
    }

    async getCities() {
        const db = await this.dbPromise;
        const all = await db.getAll('address_flat');
        const citiesMap = new Map();
        for (const item of all) {
            if (!citiesMap.has(item.city_id)) {
                citiesMap.set(item.city_id, { id: item.city_id, name: item.city_name });
            }
        }
        return Array.from(citiesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
    async searchAddresses(cityId, query) {
        const db = await this.dbPromise;
        const all = await db.getAllFromIndex('address_flat', 'city_id', cityId);
        const q = query.toLowerCase().trim();

        // Если пусто — отдаем первые 50
        if (!q) {
            return all.slice(0, 50);
        }

        // Разбиваем запрос на токены (слова)
        const tokens = q.split(' ').filter(t => t.length > 0);
        const results = [];

        for (const item of all) {
            // Разбиваем строку поиска на слова
            const words = item.search_string.split(' ');

            // Проверяем: каждое слово из запроса должно быть началом хотя бы одного слова в базе
            const isMatch = tokens.every(token =>
                words.some(word => word.startsWith(token))
            );

            if (isMatch) {
                results.push(item);
                if (results.length >= 50) break; // Ограничиваем 50 результатами
            }
        }

        return results;
    }
    // --- Очередь заявок (Outbox) ---
    async addToOutbox(ticket) {
        const db = await this.dbPromise;
        await db.put('outbox', ticket);
    }

    async getOutboxCount() {
        const db = await this.dbPromise;
        return await db.count('outbox');
    }

    async getOutboxBatch(limit = 10) {
        const db = await this.dbPromise;
        const all = await db.getAll('outbox');
        return all.slice(0, limit); // Берем первые N
    }
    async getAllFromOutbox() {
        const db = await this.dbPromise;
        return await db.getAll('outbox');
    }
    async deleteFromOutbox(uuids) {
        const db = await this.dbPromise;
        const tx = db.transaction('outbox', 'readwrite');
        for (const id of uuids) {
            tx.objectStore('outbox').delete(id);
        }
        await tx.done;
    }

    async clearOutbox() {
        const db = await this.dbPromise;
        await db.clear('outbox');
    }
}

export const offlineDB = new OfflineDB();