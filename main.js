import { Router } from "./js/route/router.js";
import { ApiService } from "./js/api-service.js";
import {
  mainPageTemplate,
  createPageTemplate,
  detailsPageTemplate,
  loginPageTemplate,
  settingsPageTemplate,
} from "./js/route/pages.js";
import { NotificationsPoller } from "./js/notifications-poller.js";
import { setRouter as setNotifyRouter } from "./js/components/notify.js";
import { ThemeController } from "./js/theme-controller.js";
import { MenuManager } from "./js/route/menu-manager.js";
import { InactivityTracker } from "./js/route/inactivity-tracker.js";
import { API, AUTH } from "./js/config.js"; // <--- Добавлен AUTH
import { authStore } from "./js/auth-store.js";
import { TicketsController } from "./js/tickets-controller.js";
import { CreateController } from "./js/create-controller.js";
import { DetailsController } from "./js/details-controller.js";
import { LoginController } from "./js/login-controller.js";
import { notify } from "./js/components/notify.js";
import { logHistoryAction } from "./js/history-logger.js";
import { offlineDB } from "./js/offline-db.js";
import { flattenAddresses } from "./js/utils/address-flattener.js";
import { SyncManager } from "./js/sync-manager.js";
import { SettingsController } from "./js/settings-controller.js"; // Новый импорт
const api = new ApiService(API.URL, { local: false });
const router = new Router(() => authStore.hasAccess());

let openTicketsArray = [];
let closedTicketsArray = [];
//instance
const openTicketsCtrl = new TicketsController(api, router, "open");
const closedTicketsCtrl = new TicketsController(api, router, "close");
const createCtrl = new CreateController(api, router);
const detailsCtrl = new DetailsController(api, router);
const loginCtrl = new LoginController(api, router);
const settingsCtrl = new SettingsController(api, router);
let menuManager = null;
let notifPoller = null;
let inactivityTracker = null;
let syncManager = null; // <--- ВЫНЕСЕНО В НАЧАЛО

function syncAuthUI() {
  const historyWrapper = document.getElementById("historyWrapper");
  const userProfileWrapper = document.getElementById("userProfileWrapper");
  const navUserAvatar = document.getElementById("navUserAvatar");
  const navUserName = document.getElementById("navUserName");

  const user = authStore.getUser();
  const isAuth = authStore.hasAccess();

  if (isAuth && user) {
    if (historyWrapper) historyWrapper.style.display = "flex";
    if (userProfileWrapper) userProfileWrapper.style.display = "flex";

    if (navUserName) navUserName.textContent = user.name || "Пользователь";
    if (navUserAvatar) {
      navUserAvatar.textContent = user.name
        ? user.name.charAt(0).toUpperCase()
        : "U";
    }

    if (!notifPoller) {
      notifPoller = new NotificationsPoller(api);
      notifPoller.start();
    }
    if (!inactivityTracker) {
      inactivityTracker = new InactivityTracker(router, 30 * 60 * 1000);
      inactivityTracker.startTracking();
    }
  } else {
    if (historyWrapper) historyWrapper.style.display = "none";
    if (userProfileWrapper) userProfileWrapper.style.display = "none";

    if (notifPoller) {
      notifPoller.stop();
      notifPoller = null;
    }
    if (inactivityTracker) {
      inactivityTracker.stopTracking();
      inactivityTracker = null;
    }
    const menu = document.getElementById("dynamicMenu");
    if (menu) menu.innerHTML = "";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  new ThemeController("themeToggle");
  setNotifyRouter(router);

  window.addEventListener("triggerSync", () => {
    if (syncManager) syncManager.startSync();
  });

  window.addEventListener("refreshSyncState", () => {
    if (openTicketsCtrl) openTicketsCtrl._updateSyncButton();
  });

  // 1. Обход авторизации или обычный вход
  if (AUTH.BYPASS_AUTH) {
    console.warn("⚠️ ВНИМАНИЕ: Авторизация отключена (BYPASS_AUTH = true)!");
    authStore.setSession("mock-token", Date.now() + 86400000, {
      id: 1,
      name: "Тестовый Доступ",
      role: "guest", // Роль перезапишется из config, который придет с сервера
    });
  } else {
    await api.tryAutoLogin();
  }

  if (authStore.hasAccess()) {
    menuManager = new MenuManager(api, router, "dynamicMenu");
    await menuManager.initialize();

    try {
      console.log("[App] Проверка адресов в офлайн-базе...");
      let cities = await offlineDB.getCities();

      if (cities.length === 0) {
        console.log("[App] Адресов нет. Качаем с сервера...");
        const response = await api.post(
          { data: "loadAddress" },
          "Загрузка справочника адресов...",
          "global",
        );

        if (response && response.status === "ok") {
          const flatData = flattenAddresses(response);
          await offlineDB.saveAddresses(flatData);
          console.log(
            `[App] Успешно сохранено ${flatData.length} адресов в IndexedDB.`,
          );
        }
      } else {
        console.log(
          "[App] Адреса уже есть в базе (городов: " + cities.length + ").",
        );
      }
    } catch (err) {
      console.error("[App] Ошибка при загрузке адресов:", err);
    }
  }

  syncAuthUI();

  // Меню профиля
  const userProfileBtn = document.getElementById("userProfileBtn");
  const userDropdown = document.getElementById("userDropdown");
  const userProfileWrapper = document.getElementById("userProfileWrapper");

  if (userProfileBtn && userDropdown) {
    userProfileBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = userDropdown.classList.contains("show");
      if (isOpen) {
        userDropdown.classList.remove("show");
        userProfileWrapper.classList.remove("open");
      } else {
        userDropdown.classList.add("show");
        userProfileWrapper.classList.add("open");
      }
    };

    document.addEventListener("click", (e) => {
      if (!userProfileWrapper.contains(e.target)) {
        userDropdown.classList.remove("show");
        userProfileWrapper.classList.remove("open");
      }
    });
  }

  // Кнопка выхода
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api.logout();
      authStore.clear();
      syncAuthUI();
      logHistoryAction("Вы вышли из системы");
      notify.info("Вы вышли из системы");
      router.navigate("#/login");
    };
  }

  const navLogo = document.getElementById("navLogo");
  if (navLogo) navLogo.addEventListener("click", () => router.navigate("#/"));

  // 2. Слушатель потери сессии (отключаем в тестовом режиме)
  if (!AUTH.BYPASS_AUTH) {
    window.addEventListener(ApiService.AUTH_LOST_EVENT, (e) => {
      authStore.clear();
      syncAuthUI();
      const reason = e.detail && e.detail.reason;
      let msg = "Сессия истекла, войдите заново";
      if (reason === "device_mismatch")
        msg = "Устройство изменилось, войдите заново";
      logHistoryAction(msg);
      notify.warning(msg);
      router.navigate("#/login");
    });
  }

  // Роуты
  router.addRoute(
    "#/login",
    () => loginPageTemplate(),
    () => loginCtrl.mount(),
  );
  router.addRoute(
    "#/",
    () => mainPageTemplate(),
    () => {
      closedTicketsCtrl.unmount();
      openTicketsCtrl.mount(openTicketsArray);
    },
  );
  router.addRoute(
    "#/closed",
    () => mainPageTemplate(),
    () => {
      openTicketsCtrl.unmount();
      closedTicketsCtrl.mount(closedTicketsArray);
    },
  );
  router.addRoute(
    "#/create",
    () => createPageTemplate(),
    () => {
      openTicketsCtrl.unmount();
      createCtrl.unmount();
      createCtrl.mount(openTicketsArray);
    },
  );
  router.addRoute(
    "#/ticket",
    (ticketId) => detailsPageTemplate(ticketId),
    (ticketId) => {
      openTicketsCtrl.unmount();
      const allTicketsCombined = [...openTicketsArray, ...closedTicketsArray];
      detailsCtrl.mount(ticketId, allTicketsCombined);
    },
  );
  router.addRoute(
    "#/settings",
    () => settingsPageTemplate(),
    () => settingsCtrl.mount(),
  );
  window.addEventListener("hashchange", () => {
    const hash = window.location.hash || "#/";
    if (hash === "#/login" || hash === "#/") {
      detailsCtrl.unmount();
      createCtrl.unmount();
    }
  });

  const createPlaceholderRoute = (title) => () =>
    `<div class="container"><h1>${title}</h1><p style="color:var(--text-secondary); margin-top:10px;">Экран находится в разработке автономного режима.</p></div>`;
  router.addRoute("#/reports", createPlaceholderRoute("Аналитические Отчеты"));
  router.addRoute(
    "#/addresses",
    createPlaceholderRoute("Реестр лифтовых адресов"),
  );
  router.addRoute(
    "#/more",
    createPlaceholderRoute("Прочие инструменты диспетчера"),
  );
  router.addRoute("#/profile", createPlaceholderRoute("Личный кабинет"));

  // 3. Инициализация SyncManager (без const!)
  // === УПРАВЛЕНИЕ СВОРАЧИВАНИЕМ БЛОКА "ИСТОРИЯ" ===
  // (Вынесено из SyncManager, чтобы работать сразу при загрузке)
  const historyWrapper = document.getElementById("historyWrapper");
  const historyTitle = document.getElementById("historyTitle");

  if (historyTitle && historyWrapper) {
    historyTitle.style.cursor = "pointer";
    historyTitle.onclick = () => {
      historyWrapper.classList.toggle("is-collapsed");
    };
  }

  // 3. Инициализация SyncManager
  syncManager = new SyncManager(api, router, (newTickets) => {
    openTicketsArray.length = 0;
    openTicketsArray.push(...newTickets);

    if (window.location.hash === "#/" || window.location.hash === "") {
      openTicketsCtrl.refreshFromMemory(openTicketsArray);
    }
  }); // <-- Убрана опечатка };)

  // Делаем инстанс доступным для контроллера таблицы
  window.syncManagerInstance = syncManager;

  if (navigator.onLine) {
    setTimeout(() => syncManager.startSync(), 1000);
  }

  // 5. Регистрация Service Worker для PWA
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          console.log(
            "✅ Service Worker зарегистрирован. Область:",
            registration.scope,
          );
        })
        .catch((error) => {
          console.error("❌ Ошибка регистрации Service Worker:", error);
        });
    });
  }

  // 4. Ручной старт роутера
  router._handleRoute();
});
