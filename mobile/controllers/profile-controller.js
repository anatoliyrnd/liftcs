import { authStore } from "../auth-store.js";
import { api } from "../api.js";
import { offlineDB } from "../offline-db.js";

export class ProfileController {
  constructor() {
    this.container = document.querySelector(".app-content");
    this.view = null;
  }

  mount() {
    // Удаляем старый экран, если он есть (полная пересборка)
    if (this.view) this.view.remove();

    this.view = document.createElement("div");
    this.view.id = "view-profile";
    this.view.className = "view active";

    this.view.innerHTML = `
        <div class="list-header"><h2>Профиль</h2></div>
        
        <div style="background: var(--bg-card); padding: 16px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border);">
            <div style="font-size: 16px; font-weight: 600; color: var(--text-main);" id="profName">Загрузка...</div>
            <div style="font-size: 13px; color: var(--text-muted);" id="profRole">Механик</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="btn-action" id="logoutBtn" style="background: var(--bg-card); color: var(--text-main); border: 1px solid var(--border);">
                Выйти из системы
            </button>
            
            <button class="btn-action btn-danger" id="clearCacheBtn" style="margin-top: 30px; font-size: 14px;">
                ⚠️ Очистить кэш и выйти
            </button>
        </div>
    `;
    this.container.appendChild(this.view);

    this.bindEvents();
    this.renderData();
  }

  unmount() {
    if (this.view) this.view.classList.remove("active");
  }

  renderData() {
    const user = authStore.getUser();
    if (user) {
      this.view.querySelector("#profName").textContent = user.name || "Механик";
      this.view.querySelector("#profRole").textContent =
        user.role === "engineer" ? "Электромеханик" : user.role || "Сотрудник";
    }
  }

  bindEvents() {
    // Нативные confirm для деструктивных действий
    this.view.querySelector("#logoutBtn").onclick = async () => {
      if (confirm("Выйти из системы?")) {
        localStorage.removeItem("mob_offline_token");
        localStorage.removeItem("mob_offline_user");
        try {
          await api.logout();
        } catch (e) {}
        window.location.hash = "#/login";
        window.location.reload();
      }
    };

    this.view.querySelector("#clearCacheBtn").onclick = async () => {
      if (
        !confirm(
          "Вы уверены, что хотите очистить кэш? Несинхронизированные данные будут потеряны.",
        )
      )
        return;
      if (
        !confirm(
          "ВНИМАНИЕ! Это действие необратимо. Все фото и очередь синхронизации будут удалены. Продолжить?",
        )
      )
        return;

      try {
        document.getElementById("clearCacheBtn").textContent = "Очистка...";
        await offlineDB.clearAll();
        localStorage.clear();
        try {
          await api.logout();
        } catch (e) {}
        alert("Кэш успешно очищен.");
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert("Ошибка при очистке кэша.");
      }
    };
  }
}
