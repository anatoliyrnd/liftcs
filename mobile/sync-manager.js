import { offlineDB } from "./offline-db.js";
import { api } from "./api.js";

export class SyncManager {
  constructor() {
    this.isSyncing = false;
    this.retryTimer = null;
    this.retryCount = 0;
    this.retryDelays = [60, 180, 600]; // 1 мин, 3 мин, 10 мин (в секундах)

    // Слушаем появление сети
    window.addEventListener("online", () => {
      this.updateNetworkStatus("online");
      this.startSync();
    });
    window.addEventListener("offline", () => {
      this.updateNetworkStatus("offline");
    });
  }

  // Обновление плашки "Онлайн/Офлайн" в шапке
  updateNetworkStatus(status) {
    const el = document.getElementById("networkStatus");
    const text = el.querySelector(".text");
    el.className = "network-status " + status;

    if (status === "online") text.textContent = "Онлайн";
    else if (status === "offline") text.textContent = "Нет сети";
    else if (status === "sync") text.textContent = "Синхр...";
    else if (status === "error") text.textContent = "Ошибка синх.";
  }

  // Вызывается при старте приложения или по кнопке "Синхронизировать"
  async startSync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.updateNetworkStatus("sync");

    try {
      // 1. Сначала пытаемся отправить накопленную очередь
      await this._processQueue();

      // 2. Затем скачиваем свежие списки с сервера
      await this._pullData();

      this.updateNetworkStatus("online");
      this.retryCount = 0; // Сбрасываем счетчик ошибок при успехе
    } catch (error) {
      console.error("[SyncManager] Ошибка синхронизации:", error);
      this.updateNetworkStatus("error");
    } finally {
      this.isSyncing = false;
    }
  }

  // Попытка отправить действие сразу (Принять, Коммент, Закрыть)
  async sendActionDirectly(action) {
    let attempts = 0;
    this.updateNetworkStatus("sync");

    while (attempts < 3) {
      try {
        const res = await api.post(action.payload);

        // Если это сетевая ошибка (нет связи) — пробуем еще раз
        if (res && res.status === "error" && res.code === "network_error") {
          throw new Error("network_error");
        }

        // Если сервер ответил (даже если это логическая ошибка 400/500) — связь есть!
        if (res) {
          this.updateNetworkStatus("online");
          return res;
        }
      } catch (e) {
        attempts++;
        if (attempts < 3) await new Promise((r) => setTimeout(r, 2000)); // Пауза 2 сек
      }
    }

    // Если 3 попытки провалились (сеть так и не появилась) — сохраняем в офлайн-очередь
    console.warn(
      "[SyncManager] Сервер недоступен. Сохраняем в очередь:",
      action,
    );
    await offlineDB.addToQueue(action);
    this.updateNetworkStatus("offline");
    return { status: "offline_saved" }; // <--- Возвращаем специальный статус
  }

  // Проход по очереди и отправка пачками (если есть)
  async _processQueue() {
    const queue = await offlineDB.getQueue();
    if (queue.length === 0) return;

    const sentUuids = [];
    for (const action of queue) {
      try {
        const res = await api.post(action.payload);
        if (res && res.status !== "network_error") {
          // Сервер ответил (даже если это 400 ошибка, мы ее обработали) — удаляем из очереди
          sentUuids.push(action.uuid);
        }
      } catch (e) {
        // Если упало по сети — прерываем цикл, попробуем позже
        throw new Error("Сеть пропала во время синхронизации очереди");
      }
    }

    if (sentUuids.length > 0) {
      await offlineDB.removeFromQueue(sentUuids);
    }

    // Если в очереди что-то осталось — запускаем таймер ретрая
    const remaining = await offlineDB.getQueue();
    if (remaining.length > 0) {
      this._scheduleRetry();
    }
  }

  // Запуск таймера 1-3-10 минут
  _scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);

    if (this.retryCount >= this.retryDelays.length) {
      this.updateNetworkStatus("error"); // Все попытки исчерпаны, ждем кнопки от юзера
      return;
    }

    const delay = this.retryDelays[this.retryCount] * 1000;
    console.log(`[SyncManager] Следующая попытка через ${delay / 1000} сек.`);

    this.retryTimer = setTimeout(() => {
      this.retryCount++;
      this.startSync();
    }, delay);
  }

  // Скачивание свежих данных с сервера
  async _pullData() {
    try {
      // Запрашиваем открытые заявки и задачи
      const tickets = await api.post({ data: "open" });
      if (Array.isArray(tickets)) {
        await offlineDB.saveList("tickets", tickets);
      }

      const tasks = await api.post({ data: "tasks" }); // Предполагаем, что такой экшен будет
      if (Array.isArray(tasks)) {
        await offlineDB.saveList("tasks", tasks);
      }
    } catch (e) {
      console.warn("Не удалось обновить списки с сервера", e);
    }
  }
}

export const syncManager = new SyncManager();
