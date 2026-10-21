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
    constructor(api, router, onOpenTicketsUpdated) {
    this.api = api;
    this.router = router;
    this.onOpenTicketsUpdated = onOpenTicketsUpdated;
    this.isSyncing = false;
    this._cooldownUntil = 0;

    // AbortController — чтобы при destroy() снять online-слушатель
    this._lifecycleAbort = new AbortController();
    window.addEventListener(
        'online',
        () => this.startSync(),
        { signal: this._lifecycleAbort.signal }
    );
}

destroy() {
    this._lifecycleAbort?.abort();
    this._lifecycleAbort = null;
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

try {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.add('is-syncing');
    window.dispatchEvent(new Event('refreshSyncState'));

    // Используем существующий API networkLed. LED останется зелёным/красным
    // по фактическому исходу последнего api.post — не будет «ложного online».
    networkLed.requestStarted();
    logHistoryAction(`Обнаружено ${count} офлайн-заявок. Начинаем синхронизацию...`);

    await this._syncLoop();
} catch (err) {
    console.error('[SyncManager] Ошибка синхронизации:', err);
} finally {
    this.isSyncing = false;
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.classList.remove('is-syncing');
    networkLed.requestFinished();
    window.dispatchEvent(new Event('refreshSyncState'));
}
    }

    async _syncLoop() {
    let retries = 0;
    let lastSignature = '';

    while (true) {
        const batch = await offlineDB.getOutboxBatch(OFFLINE.SYNC_BATCH_SIZE);
        if (batch.length === 0) break;

        // Защита от зацикливания: если предыдущая итерация была успешной
        // (retries === 0), а очередь не уменьшилась — deleteFromOutbox
        // не сработал. Иначе был бы бесконечный цикл.
        const signature = batch.map(b => b.uuid).join(',');
        if (signature === lastSignature && retries === 0) {
            throw new Error('Синхронизация застряла: очередь не уменьшается после успешного ответа сервера');
        }
        lastSignature = signature;
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
    // 1. Сервер уже принял батч — удаляем из очереди.
    //    Если deleteFromOutbox упадёт (редко) — catch повысит retries,
    //    и батч уйдёт повторно. Идемпотентность — на бэкенде.
    const uuids = batch.map(item => item.uuid);
    await offlineDB.deleteFromOutbox(uuids);

    // 2. Обновляем память и кэш. Сбой здесь НЕ должен превращаться
    //    в retries++ — данные уже на сервере, дубль отправки недопустим.
    if (response.open_tickets && Array.isArray(response.open_tickets)) {
        try {
            await offlineDB.saveTickets('open', response.open_tickets);
        } catch (cacheErr) {
            console.error('[SyncManager] saveTickets failed:', cacheErr);
        }
        if (this.onOpenTicketsUpdated) {
            try {
                this.onOpenTicketsUpdated(response.open_tickets);
            } catch (cbErr) {
                console.error('[SyncManager] onOpenTicketsUpdated failed:', cbErr);
            }
        }
    }

    logHistoryAction(`Успешно синхронизировано ${batch.length} заявок.`);
    retries = 0;

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