import { api } from "../api.js";
import { offlineDB } from "../offline-db.js";
import { syncManager } from "../sync-manager.js";
import { compressImage } from "../components/image-compressor.js";
import { authStore } from "../auth-store.js";

export class CardController {
  constructor() {
    this.ticket = null;
    this.ticketId = null;
    this.currentPhotoBase64 = null;

    // DOM Элементы (Карточка)
    this.view = document.getElementById("view-detail");
    this.titleEl = document.getElementById("detailTitle");
    this.loadingEl = document.getElementById("cardLoading");
    this.bodyEl = document.getElementById("cardBody");

    // Данные
    this.detailAddress = document.getElementById("detailAddress");
    this.detailDesc = document.getElementById("detailDesc");

    // Кнопки действий
    this.acceptBtn = document.getElementById("acceptBtn");
    this.closeBtn = document.getElementById("closeTicketBtn");

    // Комментарии
    this.commentsContainer = document.getElementById("notesContainerDOM");
    this.composerTextarea = this.view.querySelector(
      ".comment-composer textarea",
    );
    this.photoInput = document.getElementById("photoInput");
    this.sendCommentBtn = document.getElementById("sendCommentBtn");
    this.photoLabel = this.view.querySelector(".btn-attach");
    this.composerBlock = this.view.querySelector(".comment-composer");

    // Модалка закрытия
    this.modal = document.getElementById("closeModal");
    this.solutionInput = document.getElementById("solutionInput");
    this.cancelCloseBtn = document.getElementById("cancelCloseBtn");
    this.confirmCloseBtn = document.getElementById("confirmCloseBtn");

    // Блок решения (для закрытых заявок)
    this.solutionBlock = document.getElementById("solutionBlock");
    this.solutionText = document.getElementById("solutionText");
    this.solutionMeta = document.getElementById("solutionMeta");
  }

  async mount(ticketId) {
    this.ticketId = ticketId;
    this.view.classList.add("active");
    this.titleEl.textContent = `Заявка № ${ticketId}`;

    // 1. Показываем скелетон, скрываем тело карточки
    if (this.loadingEl) this.loadingEl.style.display = "flex";
    if (this.bodyEl) this.bodyEl.style.display = "none";

    // Сбрасываем состояние
    this.currentPhotoBase64 = null;
    this.composerTextarea.value = "";
    this.photoLabel.innerHTML = "📷 Фото";
    this.photoLabel.style.color = "var(--text-muted)";
    this.solutionInput.value = "";
    this.modal.classList.remove("active");

    // 2. Загружаем данные
    await this.loadData();

    // Если заявка не найдена (нет сети или удалена)
    if (!this.ticket) {
      alert("Заявка не найдена или нет связи с сервером.");
      window.location.hash = "#/list";
      return;
    }

    // 3. Скрываем скелетон, показываем данные
    if (this.loadingEl) this.loadingEl.style.display = "none";
    if (this.bodyEl) this.bodyEl.style.display = "flex";

    this.render();
    this.bindEvents();
  }

  async loadData() {
    // 1. Ищем в кэше (мгновенно)
    const tickets = await offlineDB.getList("tickets");
    this.ticket = tickets.find((t) => String(t.id) === String(this.ticketId));

    if (!this.ticket) {
      try {
        // 2. Ищем в открытых с сервера
        const res = await api.post({ data: "open" });
        if (Array.isArray(res)) {
          this.ticket = res.find((t) => String(t.id) === String(this.ticketId));
        }

        // 3. Ищем в закрытых с сервера (архив)
        if (!this.ticket) {
          const closedRes = await api.post({ data: "close", period: "7" });
          if (Array.isArray(closedRes)) {
            this.ticket = closedRes.find(
              (t) => String(t.id) === String(this.ticketId),
            );
          }
        }
      } catch (e) {
        console.error("Ошибка загрузки заявки", e);
      }
    }
  }

  render() {
    // Обновляем данные по ID элементов
    if (this.detailAddress) {
      this.detailAddress.textContent =
        this.ticket.fullAddress || this.ticket.address || "Адрес не указан";
    }
    if (this.detailDesc) {
      this.detailDesc.textContent =
        this.ticket.details || "Описание отсутствует";
    }

    const isNew =
      !this.ticket.notify_status || Number(this.ticket.notify_status) === 0;

    // ЖЕЛЕЗОБЕТОННАЯ ПРОВЕРКА: заявка закрыта, только если type === "close",
    // либо есть реальная дата закрытия, либо текст решения не является прочерком
    const isClosed =
      this.ticket.type === "close" ||
      (this.ticket.close_date && Number(this.ticket.close_date) > 0) ||
      (this.ticket.solution &&
        this.ticket.solution !== "—" &&
        this.ticket.solution !== "-");

    // Логика для ЗАКРЫТЫХ заявок (Архив)
    if (isClosed) {
      if (this.solutionBlock) this.solutionBlock.style.display = "block";
      if (this.solutionText)
        this.solutionText.textContent = this.ticket.solution || "—";

      let metaStr = `Закрыл: ${this.ticket.close_name || "Сотрудник"}`;
      if (this.ticket.close_date) {
        let ts = Number(this.ticket.close_date);
        if (ts < 10000000000) ts *= 1000;
        metaStr += ` (${new Date(ts).toLocaleDateString("ru-RU")})`;
      }
      if (this.solutionMeta) this.solutionMeta.textContent = metaStr;

      // Скрываем кнопки для закрытой заявки
      this.acceptBtn.classList.add("hidden");
      this.closeBtn.classList.add("hidden");
      if (this.composerBlock) this.composerBlock.style.display = "none";
    }
    // Логика для ОТКРЫТЫХ заявок
    else {
      if (this.solutionBlock) this.solutionBlock.style.display = "none";
      if (this.composerBlock) this.composerBlock.style.display = "block";

      if (isNew) {
        this.acceptBtn.classList.remove("hidden");
      } else {
        this.acceptBtn.classList.add("hidden");
      }
      this.closeBtn.classList.remove("hidden");
    }

    this.renderComments();
  }

  renderComments() {
    this.commentsContainer.innerHTML = "";
    const notes = this.ticket.note ? Object.values(this.ticket.note) : [];

    if (notes.length === 0) {
      this.commentsContainer.innerHTML =
        '<div style="color:var(--text-muted); font-size:13px; padding: 10px 0;">Нет комментариев</div>';
      return;
    }

    notes.forEach((n) => {
      let dateStr = "";
      if (n.date) {
        let ts = Number(n.date);
        if (!isNaN(ts)) {
          if (ts < 10000000000) ts *= 1000;
          const d = new Date(ts);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        } else {
          dateStr = String(n.date);
        }
      }

      const div = document.createElement("div");
      div.className = "comment-item";

      let photoHtml = n.photo_url
        ? `<img src="${n.photo_url}" style="max-width:100%; border-radius:8px; margin-top:8px;">`
        : "";

      div.innerHTML = `
        <div class="comment-header">
            <span class="comment-author">${n.user || "Сотрудник"}</span>
            <span class="comment-date">${dateStr}</span>
        </div>
        <div class="comment-text">${n.body || ""}</div>
        ${photoHtml}
      `;
      this.commentsContainer.appendChild(div);
    });

    this.commentsContainer.scrollTop = this.commentsContainer.scrollHeight;
  }

  bindEvents() {
    // Кнопка Назад
    this.view.querySelector(".btn-back").onclick = () => {
      window.location.hash = "#/list";
    };

    // Кнопка Принять
    this.acceptBtn.onclick = async () => {
      this.acceptBtn.disabled = true;
      this.acceptBtn.textContent = "Отправка...";

      const action = {
        payload: {
          action: "calledit",
          call_id: this.ticket.id,
          notify_status: 2,
        },
      };
      const res = await syncManager.sendActionDirectly(action);

      if (res && res.status !== "error") {
        this.ticket.notify_status = 2;
        this.render();
      } else {
        this.acceptBtn.disabled = false;
        this.acceptBtn.textContent = "✓ Принять в работу";
        alert("Ошибка отправки. Проверьте связь.");
      }
    };

    // Прикрепление фото
    this.photoInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        this.photoLabel.innerHTML = "⏳ Сжатие...";
        this.currentPhotoBase64 = await compressImage(file);
        this.photoLabel.innerHTML = "✅ Фото готово";
        this.photoLabel.style.color = "var(--success)";
      } catch (err) {
        alert("Ошибка при обработке фото");
        this.photoLabel.innerHTML = "📷 Фото";
      }
    };

    // Отправка комментария
    this.sendCommentBtn.onclick = async () => {
      const text = this.composerTextarea.value.trim();
      if (!text && !this.currentPhotoBase64) return;

      this.sendCommentBtn.disabled = true;
      this.sendCommentBtn.textContent = "Отправка...";

      const action = {
        payload: {
          action: "callnote",
          call_id: this.ticket.id,
          note: text,
          photo_base64: this.currentPhotoBase64,
        },
      };

      const res = await syncManager.sendActionDirectly(action);

      if (res && res.status !== "error") {
        const newNote = {
          user: "Вы",
          body: text,
          date: Math.floor(Date.now() / 1000),
          type: 0,
        };
        if (!this.ticket.note) this.ticket.note = [];
        this.ticket.note.push(newNote);

        this.composerTextarea.value = "";
        this.currentPhotoBase64 = null;
        this.photoInput.value = "";
        this.photoLabel.innerHTML = "📷 Фото";
        this.photoLabel.style.color = "var(--text-muted)";

        this.renderComments();
      } else {
        alert("Ошибка отправки. Проверьте связь.");
      }

      this.sendCommentBtn.disabled = false;
      this.sendCommentBtn.textContent = "Отправить";
    };

    // Открытие модалки закрытия
    this.closeBtn.onclick = () => {
      this.modal.classList.add("active");
      this.solutionInput.focus();
    };

    // Закрытие модалки
    this.cancelCloseBtn.onclick = () => this.modal.classList.remove("active");
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.modal.classList.remove("active");
    };

    // Подтверждение закрытия заявки
    this.confirmCloseBtn.onclick = async () => {
      const solution = this.solutionInput.value.trim();
      if (solution.length < 6) {
        alert("Опишите решение (минимум 6 символов).");
        return;
      }

      this.confirmCloseBtn.disabled = true;
      this.confirmCloseBtn.textContent = "Закрытие...";

      const action = {
        payload: {
          action: "callClose",
          call_id: this.ticket.id,
          solution: solution,
          user_id: authStore.getUser()?.id || 0,
        },
      };

      const res = await syncManager.sendActionDirectly(action);

      if (res && res.status !== "error") {
        // Если метод removeTicket есть в offlineDB — вызываем его
        if (typeof offlineDB.removeTicket === "function") {
          await offlineDB.removeTicket(this.ticket.id);
        }
        window.location.hash = "#/list";
      } else {
        this.confirmCloseBtn.disabled = false;
        this.confirmCloseBtn.textContent = "Закрыть заявку";
        alert("Ошибка отправки. Проверьте связь.");
      }
    };
  }
}
