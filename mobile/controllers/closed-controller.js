import { api } from "../api.js";

export class ClosedController {
  constructor() {
    this.view = document.getElementById("view-closed");
    this.container = document.getElementById("closedContainer");
    this.periodBtns = this.view.querySelectorAll(".period-btn");
    this.currentPeriod = "1"; // По умолчанию 1 день
  }

  async mount() {
    this.view.classList.add("active");
    this.bindEvents();
    await this.loadData(this.currentPeriod);
  }

  bindEvents() {
    this.periodBtns.forEach((btn) => {
      btn.onclick = () => {
        this.periodBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.currentPeriod = btn.dataset.period;
        this.loadData(this.currentPeriod);
      };
    });
  }

  async loadData(period) {
    this.container.innerHTML =
      '<div style="text-align:center; padding: 40px; color: var(--text-muted);">Загрузка архива...</div>';

    try {
      const response = await api.post(
        { data: "close", period: period },
        null,
        "closed_list",
      );

      if (Array.isArray(response)) {
        this.render(response);
      } else {
        this.container.innerHTML =
          '<div style="text-align:center; padding: 40px; color: var(--danger);">Ошибка формата данных</div>';
      }
    } catch (e) {
      this.container.innerHTML =
        '<div style="text-align:center; padding: 40px; color: var(--danger);">Нет связи с сервером.<br>Архив доступен только онлайн.</div>';
    }
  }

  render(tickets) {
    this.container.innerHTML = "";

    if (tickets.length === 0) {
      this.container.innerHTML =
        '<div style="text-align:center; padding: 40px; color: var(--text-muted);">За этот период закрытых заявок нет</div>';
      return;
    }

    tickets.forEach((ticket) => {
      const card = document.createElement("div");
      card.className = "ticket-card closed";
      card.dataset.id = ticket.id;

      let dateStr = "";
      const rawDate = ticket.close_date || ticket.date;
      if (rawDate) {
        let ts = Number(rawDate);
        if (ts < 10000000000) ts *= 1000;
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          dateStr =
            d.toLocaleDateString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
            }) +
            " " +
            d.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            });
        }
      }

      const addressText =
        ticket.fullAddress || ticket.address || "Адрес не указан";
      const solutionText = ticket.solution || "Решение не указано";

      card.innerHTML = `
        <div class="card-top">
          <span class="card-id">№ ${ticket.id}</span>
          <span class="card-status status-work" style="color: var(--success); background: rgba(34,197,94,0.15);">Закрыта</span>
        </div>
        <div class="card-address">${addressText}</div>
        <div class="card-solution">✅ ${solutionText}</div>
        <div class="card-bottom" style="margin-top: 8px;">
          <span class="card-date">${dateStr}</span>
          <span class="card-arrow">→</span>
        </div>
      `;

      card.addEventListener("click", () => {
        window.location.hash = `#/detail/${ticket.id}`;
      });

      this.container.appendChild(card);
    });
  }
}
