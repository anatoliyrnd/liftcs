import { offlineDB } from './offline-db.js';
import { notify } from './components/notify.js';
import { logHistoryAction } from './history-logger.js';

export class SettingsController {
    constructor(api, router) {
        this.api = api;
        this.router = router;
    }

    async mount() {
        // Загрузка городов
        const cities = await offlineDB.getCities();
        const select = document.getElementById('settingsDefaultCity');
        if (select) {
            select.innerHTML = '<option value="">— Не выбран —</option>';
            cities.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                select.appendChild(opt);
            });

            const current = await offlineDB.getConfig('default_city_id');
            if (current) select.value = current;
        }

        // Сохранение города
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.onclick = async () => {
                const val = select.value ? Number(select.value) : null;
                await offlineDB.setConfig('default_city_id', val);
                notify.success('Настройки сохранены');
                logHistoryAction('Изменен город по умолчанию');
            };
        }

        // Очистка кэша
        const clearBtn = document.getElementById('clearAddressCacheBtn');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                if (confirm('Вы уверены, что хотите удалить кэш адресов? Придется скачать их заново.')) {
                    await offlineDB.saveAddresses([]); // Очищаем таблицу
                    localStorage.removeItem('recent_addresses');
                    notify.warning('Кэш адресов очищен. Перезагрузка...');
                    setTimeout(() => window.location.reload(), 1500);
                }
            };
        }
    }

    unmount() {
        // Очистка слушателей при необходимости
    }
}