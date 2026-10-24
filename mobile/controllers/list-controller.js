import { api } from "../api.js";
import { syncManager } from "../sync-manager.js";
import { offlineDB } from "../offline-db.js";
import { escapeHtml } from "../utils/sanitize.js";
import { formatTime } from "../utils/format.js";
import { ui } from "../components/ui-modal.js";
import { API } from "../config.js"; // Для TICKETS_REFRESH_MS

export class ListController {
  constructor() {
    this.container = document.querySelector("#view-list .cards-container");
    this.totalCountEl = document.getElementById("totalTicketsCount");
    this.newCountEl = document.getElementById("newTicketsCount");
    this.newBlock = document.getElementById("newTicketsBlock");
    this.acceptAllBtn = document.getElementById("acceptAllBtn");
    this.view = document.getElementById("view-list");

    this.tickets = [];

    // Состояния для Polling
    this.pollingTimer = null;
    this._inFlight = false;

    // Биндим контекст для visibilitychange
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  async mount() {
    this.view.classList.add("active");

    this.container.innerHTML =
      '<div style="text-align:center; padding: 40px; color: var(--text-muted);">Загрузка заявок...</div>';

    await this.loadData();
    this.render();
    this.bindEvents();

    // Запускаем фоновое обновление и слежку за фокусом
    this.startPolling();
    document.addEventListener("visibilitychange", this._onVisibilityChange);
  }

  unmount() {
    this.stopPolling();
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    this.view.classList.remove("active");
  }

  async loadData() {
    try {
      const response = await api.post({ data: "open" }, null, "mobile_list");

      if (Array.isArray(response)) {
        this.tickets = response;
        await offlineDB.saveList("tickets", response);
      } else {
        throw new Error("Неверный формат ответа от сервера");
      }
    } catch (e) {
      console.warn("[ListController] Нет сети, загрузка из кэша...", e);
      this.tickets = await offlineDB.getList("tickets");
    }
  }

  // ==========================================================================
  // POLLING (Автообновление каждые 5 минут)
  // ==========================================================================
  startPolling() {
    this.stopPolling();
    this.pollingTimer = setInterval(() => this._poll(), API.TICKETS_REFRESH_MS);
  }

  stopPolling() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  async _poll(force = false) {
    // Если не форсировано, проверяем условия
    if (!force) {
      if (document.visibilityState !== "visible") return; // Свернуто
      if (!navigator.onLine) return; // Офлайн
      if (syncManager.isSyncing) return; // Идет общая синхронизация
      if (this._inFlight) return; // Уже идет запрос (например, acceptAll)
    }

    this._inFlight = true;
    try {
      // Тихий запрос (без индикатора загрузки)
      const response = await api.post({ data: "open" }, null);

      if (Array.isArray(response)) {
        this.tickets = response;
        await offlineDB.saveList("tickets", response);

        // Сохраняем позицию скролла перед перерисовкой
        const appContent = document.querySelector(".app-content");
        const scrollTop = appContent ? appContent.scrollTop : 0;

        this.render();

        // Восстанавливаем скролл
        if (appContent) appContent.scrollTop = scrollTop;
      }
    } catch (e) {
      console.warn("[ListController] Ошибка фонового обновления", e);
    } finally {
      this._inFlight = false;
    }
  }

  _onVisibilityChange() {
    if (document.visibilityState === "visible") {
      // Пользователь вернулся в приложение — делаем мгновенный refresh
      // и перезапускаем таймер (чтобы 5 минут отсчитывались заново)
      this._poll(true);
      this.startPolling();
    } else {
      // Пользователь свернул приложение — останавливаем таймер
      this.stopPolling();
    }
  }

  // ==========================================================================
  // РЕНДЕР
  // ==========================================================================
  render() {
    if (!this.container) return;

    const isTicketNew = (status) => {
      const s = Number(status);
      return s === 0 || status === null || status === undefined || isNaN(s);
    };

    const newTickets = this.tickets.filter((t) => isTicketNew(t.notify_status));

    this.totalCountEl.textContent = this.tickets.length;

    if (newTickets.length > 0) {
      this.newCountEl.textContent = newTickets.length;
      this.newBlock.classList.remove("hidden");
      this.acceptAllBtn.classList.remove("hidden");
    } else {
      this.newBlock.classList.add("hidden");
      this.acceptAllBtn.classList.add("hidden");
    }

    this.container.innerHTML = "";

    if (this.tickets.length === 0) {
      this.container.innerHTML =
        '<div style="text-align:center; padding: 40px; color: var(--text-muted);">Нет открытых заявок</div>';
      return;
    }

    const sortedTickets = [...this.tickets].sort((a, b) => {
      const aWeight =
        (a.alert_level === 3 ? 100 : 0) +
        (isTicketNew(a.notify_status) ? 10 : 0);
      const bWeight =
        (b.alert_level === 3 ? 100 : 0) +
        (isTicketNew(b.notify_status) ? 10 : 0);
      if (aWeight !== bWeight) return bWeight - aWeight;
      return 0;
    });

    sortedTickets.forEach((ticket) => {
      const isNew = isTicketNew(ticket.notify_status);
      const timeString = formatTime(ticket.date || ticket.call_date);

      const card = document.createElement("div");
      card.className = "ticket-card";
      card.dataset.id = ticket.id;

      if (ticket.alert_level === 3)
        card.style.borderLeftColor = "var(--danger)";
      else if (isNew) card.style.borderLeftColor = "var(--warning)";
      else card.style.borderLeftColor = "var(--success)";

      const addressText =
        ticket.fullAddress || ticket.address || "Адрес не указан";
      const detailsRaw = ticket.details || "Без описания";
      const shortDetails =
        detailsRaw.length > 80
          ? detailsRaw.substring(0, 80) + "..."
          : detailsRaw;

      card.innerHTML = `
                <div class="card-top">
                    <span class="card-id">№ ${escapeHtml(ticket.id)}</span>
                    <span class="card-status ${isNew ? "status-open" : "status-work"}">
                        ${isNew ? "Новая" : "В работе"}
                    </span>
                </div>
                <div class="card-address">${escapeHtml(addressText)}</div>
                <div class="card-desc">${escapeHtml(shortDetails)}</div>
                <div class="card-bottom">
                    <span class="card-date">${escapeHtml(timeString)}</span>
                    <span class="card-arrow">→</span>
                </div>
            `;

      card.addEventListener("click", () => {
        window.location.hash = `#/detail/${ticket.id}`;
      });

      this.container.appendChild(card);
    });
  }

  bindEvents() {
    this.acceptAllBtn.onclick = async () => {
      if (this._inFlight) return; // Защита от двойного клика

      const newTickets = this.tickets.filter((t) => !t.notify_status);
      if (newTickets.length === 0) return;

      if (!confirm(`Принять в работу ${newTickets.length} новых заявок?`))
        return;

      this._inFlight = true; // Блокируем polling на время массового действия
      this.acceptAllBtn.disabled = true;
      this.acceptAllBtn.textContent = "Принятие...";

      try {
        for (const ticket of newTickets) {
          const action = {
            payload: {
              action: "calledit",
              call_id: ticket.id,
              notify_status: 2,
            },
          };

          const res = await syncManager.sendActionDirectly(action);

          if (res && res.status !== "error") {
            ticket.notify_status = 2;
            await offlineDB.updateTicket(ticket.id, { notify_status: 2 });
          }
        }
      } finally {
        this._inFlight = false;
        this.acceptAllBtn.disabled = false;
        this.acceptAllBtn.textContent = "Принять все";
        this.render();
      }
    };
  }
}
