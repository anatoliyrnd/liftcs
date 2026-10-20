import { offlineDB } from './offline-db.js';
import { OFFLINE } from './config.js';
import { notify } from './components/notify.js';
import { logHistoryAction } from './history-logger.js';
import { authStore } from './auth-store.js';
import { networkLed } from './components/network-led.js';

export class SyncManager {
    /**
     * @param {ApiService} api
     * @param {Function} onOpenTicketsUpdated - Колбэк для обновления массива заявок в памяти
     */
    constructor(api, onOpenTicketsUpdated) {
        this.api = api;
        this.onOpenTicketsUpdated = onOpenTicketsUpdated;
        this.isSyncing = false;

        // Слушаем появление сети
        window.addEventListener('online', () => this.startSync());
    }

    async startSync() {
        if (this.isSyncing || !authStore.hasAccess()) return;

        const count = await offlineDB.getOutboxCount();
        if (count === 0) return;

        this.isSyncing = true;
        networkLed.setState('loading'); // Желтый/крутящийся индикатор
        logHistoryAction(`Обнаружено ${count} офлайн-заявок. Начинаем синхронизацию...`);

        try {
            await this._syncLoop();
        } catch (err) {
            console.error('[SyncManager] Ошибка синхронизации:', err);
            logHistoryAction('Сбой синхронизации: ' + err.message);
        } finally {
            this.isSyncing = false;
            networkLed.setState('online'); // Возвращаем зеленый
        }
    }

    async _syncLoop() {
        let retries = 0;

        while (true) {
            const batch = await offlineDB.getOutboxBatch(OFFLINE.SYNC_BATCH_SIZE);
            if (batch.length === 0) break; // Очередь пуста, выходим

            // Формируем данные для сервера (оригинальный автор + сама заявка)
            const ticketsToSend = batch.map(item => ({
                ...item.payload,
                offline_author_id: item.original_author_id,
                offline_author_name: item.original_author_name
            }));

            try {
                // Отправляем пачку (сервер должен вернуть status: ok и полный список open)
                const response = await this.api.post({
                    action: 'callnew_batch', // Новый экшен для батч-загрузки
                    tickets: ticketsToSend
                }, `Отправка заявок (${batch.length} шт.)...`, 'sync');

                if (response && response.status === 'ok') {
                    // 1. Удаляем отправленные заявки из очереди
                    const uuids = batch.map(item => item.uuid);
                    await offlineDB.deleteFromOutbox(uuids);

                    // 2. Обновляем список заявок в памяти и кэше, если сервер их прислал
                    if (response.open_tickets && Array.isArray(response.open_tickets)) {
                        await offlineDB.saveTickets('open', response.open_tickets);
                        if (this.onOpenTicketsUpdated) {
                            this.onOpenTicketsUpdated(response.open_tickets);
                        }
                    }

                    logHistoryAction(`Успешно синхронизировано ${batch.length} заявок.`);
                    retries = 0; // Сбрасываем счетчик ошибок при успехе
                } else {
                    throw new Error(response.message || 'Ошибка сервера');
                }
            } catch (err) {
                retries++;
                if (retries >= OFFLINE.MAX_SYNC_RETRIES) {
                    this._showSyncErrorModal(err.message);
                    return; // Прерываем цикл
                }
                // Ждем 2 секунды перед следующей попыткой
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        logHistoryAction('Все офлайн-заявки успешно синхронизированы.');
        notify.success('Офлайн-заявки отправлены на сервер.');
    }

    _showSyncErrorModal(errorMsg) {
        const confirmDelete = confirm(
            `Не удалось синхронизировать заявки.\n` +
            `Ошибка: ${errorMsg}\n\n` +
            `Продолжить работу в онлайн-режиме? ВСЕ ОФЛАЙН-ЗАЯВКИ БУДУТ УДАЛЕНЫ.`
        );
        if (confirmDelete) {
            offlineDB.clearOutbox().then(() => {
                logHistoryAction('Офлайн-заявки удалены пользователем.');
                notify.info('Офлайн-заявки удалены.');
            });
        }
    }
}