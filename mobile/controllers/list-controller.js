import { api } from "../api.js"; // Твой существующий сервис
import { syncManager } from "../sync-manager.js";
import { offlineDB } from "../offline-db.js";

export class ListController {
  constructor() {
    this.container = document.querySelector("#view-list .cards-container");
    this.totalCountEl = document.getElementById("totalTicketsCount");
    this.newCountEl = document.getElementById("newTicketsCount");
    this.newBlock = document.getElementById("newTicketsBlock");
    this.acceptAllBtn = document.getElementById("acceptAllBtn");

    this.tickets = [];
  }

  async mount() {
    document.getElementById("view-list").classList.add("active");

    // Показываем заглушку загрузки
    this.container.innerHTML =
      '<div style="text-align:center; padding: 40px; color: var(--text-muted);">Загрузка заявок...</div>';

    await this.loadData();
    this.render();
    this.bindEvents();
  }

  async loadData() {
    try {
      // 1. Пытаемся получить данные с реального сервера
      const response = await api.post({ data: "open" }, null, "mobile_list");

      if (Array.isArray(response)) {
        this.tickets = response;
        // 2. Сохраняем в кэш для офлайн-режима
        await offlineDB.saveList("tickets", response);
      } else {
        throw new Error("Неверный формат ответа от сервера");
      }
    } catch (e) {
      // 3. Если сети нет или сервер недоступен — берем из IndexedDB
      console.warn("[ListController] Нет сети, загрузка из кэша...", e);
      this.tickets = await offlineDB.getList("tickets");
    }
  }
  render() {
    if (!this.container) return;

    // ФИКС 1: Приводим статус к числу и проверяем разные варианты
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
      return 0; // Убрали сортировку по дате, чтобы не падало на Invalid Date
    });

    sortedTickets.forEach((ticket) => {
      const isNew = isTicketNew(ticket.notify_status);

      // ФИКС 2: Умный парсинг даты
      let timeString = "—";
      const rawDate = ticket.date || ticket.call_date;
      if (rawDate) {
        let ts = Number(rawDate);
        if (!isNaN(ts)) {
          // Если timestamp в секундах (меньше 10 млрд), переводим в миллисекунды
          if (ts < 10000000000) ts *= 1000;
          const dateObj = new Date(ts);
          if (!isNaN(dateObj.getTime())) {
            timeString = dateObj.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        } else {
          // Если это уже готовая строка
          timeString = String(rawDate);
        }
      }

      const card = document.createElement("div");
      card.className = "ticket-card";
      card.dataset.id = ticket.id;

      if (ticket.alert_level === 3) {
        card.style.borderLeftColor = "var(--danger)";
      } else if (isNew) {
        card.style.borderLeftColor = "var(--warning)";
      } else {
        card.style.borderLeftColor = "var(--success)";
      }

      // ФИКС 3: Проверяем разные поля для адреса
      const addressText =
        ticket.fullAddress || ticket.address || "Адрес не указан";

      const shortDetails =
        ticket.details && ticket.details.length > 80
          ? ticket.details.substring(0, 80) + "..."
          : ticket.details || "Без описания";

      card.innerHTML = `
                <div class="card-top">
                    <span class="card-id">№ ${ticket.id}</span>
                    <span class="card-status ${isNew ? "status-open" : "status-work"}">
                        ${isNew ? "Новая" : "В работе"}
                    </span>
                </div>
                <div class="card-address">${addressText}</div>
                <div class="card-desc">${shortDetails}</div>
                <div class="card-bottom">
                    <span class="card-date">${timeString}</span>
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
    // Обработка кнопки "Принять все"
    this.acceptAllBtn.onclick = async () => {
      const newTickets = this.tickets.filter((t) => !t.notify_status);
      if (newTickets.length === 0) return;

      if (!confirm(`Принять в работу ${newTickets.length} новых заявок?`))
        return;

      this.acceptAllBtn.disabled = true;
      this.acceptAllBtn.textContent = "Принятие...";

      let successCount = 0;

      for (const ticket of newTickets) {
        // Формируем payload строго по протоколу v4.0 для calledit
        const action = {
          payload: {
            action: "calledit",
            call_id: ticket.id,
            notify_status: 2, // 2 = "Принял через WEB"
          },
        };

        // syncManager сам сделает 3 попытки, если упадет — сохранит в очередь
        const res = await syncManager.sendActionDirectly(action);

        if (res && res.status !== "error") {
          ticket.notify_status = 2; // Обновляем локально
          successCount++;
        }
      }

      this.acceptAllBtn.disabled = false;
      this.acceptAllBtn.textContent = "Принять все";

      // Перерисовываем (кнопка и бейдж исчезнут)
      this.render();
    };
  }
}
