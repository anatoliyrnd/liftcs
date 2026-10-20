/**
 * Контроллер экрана #/login.
 */
import { authStore } from './auth-store.js';
import { notify } from './components/notify.js';
import { logHistoryAction } from './history-logger.js';

export class LoginController {
    constructor(apiInstance, routerInstance) {
        this.api = apiInstance;
        this.router = routerInstance;
    }

    mount() {
        const form = document.getElementById('loginForm');
        const nameInput = document.getElementById('loginName');
        const pwdInput = document.getElementById('loginPassword');
        const autoInput = document.getElementById('loginAutoLogin');
        const errorBox = document.getElementById('loginError');
        const submitBtn = document.getElementById('loginSubmit');

        if (!form) return;

        // Фокус на поле логина
        setTimeout(() => nameInput && nameInput.focus(), 50);

        form.onsubmit = async (e) => {
            e.preventDefault();
            errorBox.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Вход...';

            const name = nameInput.value.trim();
            const pwd = pwdInput.value;
            const auto = autoInput.checked;

            try {
                const resp = await this.api.login(name, pwd, auto);

                if (resp && resp.status === 'ok' && resp.access_token) {
                    authStore.setSession(resp.access_token, resp.expires_at, resp.user);
                    logHistoryAction('Вход выполнен: ' + (resp.user && resp.user.name || name));
                    notify.success('Добро пожаловать, ' + (resp.user && resp.user.name || name));
                    this.router.navigate('#/');
                    // Принудительная перезагрузка страницы
                    window.location.reload();
                    return;
                }

                const msg = (resp && resp.message) || 'Не удалось войти.';
                const code = (resp && resp.code) || '';
                let friendly = msg;

                if (code === 'invalid_credentials') friendly = 'Неверное имя или пароль.';
                else if (code === 'user_blocked') friendly = 'Учётная запись заблокирована.';
                else if (code === 'device_mismatch') friendly = 'Устройство изменилось. Введите пароль заново.';
                else if (code === 'invalid_input') friendly = 'Проверьте логин и пароль.';
                else if (code === 'network_error') friendly = 'Нет связи с сервером. Проверьте соединение.';

                errorBox.textContent = friendly;
                errorBox.style.display = 'block';
                logHistoryAction('Ошибка входа: ' + friendly);
                notify.error(friendly);

            } catch (err) {
                console.error('[LoginController] Ошибка:', err);
                errorBox.textContent = 'Сбой сети при попытке входа.';
                errorBox.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти';
            }
        };
    }

    unmount() {
        const form = document.getElementById('loginForm');
        if (form) form.onsubmit = null;
    }
}