import { ListController } from "./controllers/list-controller.js";
import { CardController } from "./controllers/card-controller.js";
import { LoginController } from "./controllers/login-controller.js";
import { syncManager } from "./sync-manager.js";
import { api } from "./api.js";
import { authStore } from "./auth-store.js";
import { offlineDB } from "./offline-db.js";
import { ClosedController } from "./controllers/closed-controller.js";
const closedController = new ClosedController();
const listController = new ListController();
const cardController = new CardController();
const loginController = new LoginController();

function updateBottomNav(route) {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.remove("active");
    const href = el.getAttribute("href");
    if (href === route || (route.startsWith("#/detail") && href === "#/list")) {
      el.classList.add("active");
    }
  });
}

async function handleRoute() {
  let hash = window.location.hash || "#/list";

  // 1. Проверка авторизации
  let isAuthorized = authStore.hasAccess();
  if (!isAuthorized) {
    const offlineToken = localStorage.getItem("mob_offline_token");
    const offlineUser = localStorage.getItem("mob_offline_user");
    if (offlineToken && offlineUser) {
      authStore.setSession(offlineToken, null, JSON.parse(offlineUser));
      isAuthorized = true;
    }
  }

  if (!isAuthorized && hash !== "#/login") {
    window.location.hash = "#/login";
    return;
  }

  if (isAuthorized && hash === "#/login") {
    window.location.hash = "#/list";
    return;
  }

  // 2. Скрываем все экраны и меню
  document
    .querySelectorAll(".view")
    .forEach((el) => el.classList.remove("active"));
  const bottomNav = document.querySelector(".bottom-nav");

  // 3. Роутинг
  if (hash === "#/login") {
    bottomNav.style.display = "none";
    loginController.mount();
  } else {
    bottomNav.style.display = "flex";
    updateBottomNav(hash);

    if (hash === "#/list") {
      await listController.mount();
    } else if (hash === "#/closed") {
      await closedController.mount();
    } else if (hash.startsWith("#/detail/")) {
      const ticketId = hash.split("/")[2];
      await cardController.mount(ticketId);
    } else if (hash === "#/tasks") {
      // Временная заглушка для задач
      const main = document.querySelector(".app-content");
      let tasksView = document.getElementById("view-tasks");
      if (!tasksView) {
        tasksView = document.createElement("div");
        tasksView.id = "view-tasks";
        tasksView.className = "view";
        tasksView.innerHTML = `<div style="text-align:center; padding: 40px; color: var(--text-muted);">Раздел Задачи (в разработке)...</div>`;
        main.appendChild(tasksView);
      }
      tasksView.classList.add("active");
    } else if (hash === "#/profile") {
      renderProfile();
    }
  }
}

// Функция для отрисовки профиля (создаем HTML динамически)
function renderProfile() {
  console.log(">>> Запущена отрисовка профиля <<<"); // <--- ДОБАВИТЬ ВОТ ЭТУ СТРОКУ
  const main = document.querySelector(".app-content");
  let profileView = document.getElementById("view-profile");

  if (!profileView) {
    console.log(">>> Создаю HTML профиля <<<");
    profileView = document.createElement("div");
    profileView.id = "view-profile";
    profileView.className = "view";
    profileView.innerHTML = `
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
    main.appendChild(profileView);

    // Привязываем кнопки
    document.getElementById("logoutBtn").onclick = async () => {
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

    document.getElementById("clearCacheBtn").onclick = async () => {
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

  // Заполняем данными пользователя
  const user = authStore.getUser();
  if (user) {
    document.getElementById("profName").textContent = user.name || "Механик";
    document.getElementById("profRole").textContent =
      user.role === "engineer" ? "Электромеханик" : user.role || "Сотрудник";
  }

  profileView.classList.add("active");
}

document.addEventListener("DOMContentLoaded", () => {
  window.addEventListener("hashchange", handleRoute);
  handleRoute();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.error(err));
  }

  // Запускаем синхронизацию ТОЛЬКО если мы авторизованы
  if (authStore.hasAccess() || localStorage.getItem("mob_offline_token")) {
    if (navigator.onLine) {
      syncManager.updateNetworkStatus("online");
      // Обернем в setTimeout, чтобы не блокировать загрузку UI
      setTimeout(() => syncManager.startSync(), 1000);
    } else {
      syncManager.updateNetworkStatus("offline");
    }
  }
});
