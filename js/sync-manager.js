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
        this._cooldownUntil = 0; // Время, до которого кнопка заблокирована
        // Слушаем появление сети
        window.addEventListener('online', () => this.startSync());
    }

    async startSync() {
        if (this.isSyncing || !authStore.hasAccess()) return;

        // Проверка кулдауна (если недавно была ошибка)
        if (Date.now() < this._cooldownUntil) {
            const waitMins = Math.ceil((this._cooldownUntil - Date.now()) / 60000);
            notify.warning(`Синхронизация заблокирована. Попробуйте через ${waitMins} мин.`);
            return;
        }

        const count = await offlineDB.getOutboxCount();
        if (count === 0) return;

        this.isSyncing = true;

        // Включаем спиннер на кнопке
        const btn = document.getElementById('refreshBtn');
        if (btn) btn.classList.add('is-syncing');

        window.dispatchEvent(new Event('refreshSyncState')); // Обновляем UI (блокируем кнопку)

        networkLed.setState('loading');
        logHistoryAction(`Обнаружено ${count} офлайн-заявок. Начинаем синхронизацию...`);

        try {
            await this._syncLoop();
        } catch (err) {
            console.error('[SyncManager] Ошибка синхронизации:', err);
        } finally {
            this.isSyncing = false;
            if (btn) btn.classList.remove('is-syncing');
            networkLed.setState('online');
            window.dispatchEvent(new Event('refreshSyncState')); // Разблокируем UI
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
                    await this._showSyncErrorModal(err.message);
                    return; // Прерываем цикл
                }
                // Ждем 2 секунды перед следующей попыткой
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        logHistoryAction('Все офлайн-заявки успешно синхронизированы.');
        notify.success('Офлайн-заявки отправлены на сервер.');
    }

   async _showSyncErrorModal(errorMsg) {
           const user = authStore.getUser() || { id: 'unknown', name: 'Неизвестно' };

           // 1. Получаем количество заявок до формирования текста
           const outboxCount = await offlineDB.getOutboxCount();

           // 2. Формируем диагностический текст
           const diagText = `=== ДИАГНОСТИКА СБОЯ СИНХРОНИЗАЦИИ ===\n` +
               `Время: ${new Date().toLocaleString('ru')}\n` +
               `Пользователь: ${user.name} (ID: ${user.id})\n` +
               `Ошибка сервера: ${errorMsg}\n` +
               `Зависших заявок: ${outboxCount}\n\n` +
               `Скопируйте этот текст и передайте администратору.`;


        // prompt позволяет пользователю скопировать текст
        const action = prompt(
            `Не удалось синхронизировать заявки после 5 попыток.\n\n` +
            `Нажмите ОК, чтобы УДАЛИТЬ заявки и работать онлайн.\n` +
            `Нажмите Отмена, чтобы сохранить заявки и попробовать позже.\n\n` +
            `--- ДИАГНОСТИКА (для копирования) ---\n${diagText}`,
            diagText
        );
       this._cooldownUntil = Date.now() + OFFLINE.SYNC_COOLDOWN_MS;
        // Если пользователь нажал ОК (action !== null)
        if (action !== null) {
            const confirmDelete = confirm("ВНИМАНИЕ! Все офлайн-заявки будут удалены навсегда. Вы уверены?");
            if (confirmDelete) {
                offlineDB.clearOutbox().then(async () => {
                    logHistoryAction('Офлайн-заявки удалены пользователем.');
                    notify.warning('Офлайн-заявки удалены. Вы работаете в онлайн-режиме.');
                    if (this.router) this.router.navigate('#/');

                    // Обновляем кнопку (скрываем бейдж)
                    window.dispatchEvent(new Event('refreshSyncState'));
                });
            }
        } else {
            // Нажали отмену — блокируем кнопку на 3 секунды (защита от спама)
            const btn = document.getElementById('refreshBtn');
            if (btn) {
                btn.disabled = true;
                setTimeout(() => btn.disabled = false, 3000);
            }
        }
    }
}