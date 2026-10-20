/**
 * Превращает иерархический JSON адресов в плоский массив для IndexedDB
 */
export function flattenAddresses(serverResponse) {
    if (!serverResponse || !serverResponse.message) return [];
    const { city = [], street = [], home = [], object = [] } = serverResponse.message;

    // Создаем карты (словари) для быстрого поиска по ID
    const cityMap = new Map(city.map(c => [c.id, c]));
    const streetMap = new Map(street.map(s => [s.id, s]));
    const homeMap = new Map(home.map(h => [h.id, h]));

    const flatData = [];

    // Проходим по всем лифтам (object) — это самая нижняя сущность
    for (const obj of object) {
        if (!obj.home_id || obj.home_id === 0) continue; // Фильтруем бесхозные

        const h = homeMap.get(obj.home_id);
        if (!h) continue;
        const s = streetMap.get(h.street_id);
        if (!s) continue;
        const c = cityMap.get(s.city_id);
        if (!c) continue;

        // Чистим строки от лишних пробелов
        const cName = c.city_name.trim();
        const sName = s.street_name.trim();
        const hName = h.home_name.trim();
        const oName = obj.object_name.trim();

        // Формируем красивую строку для отображения
        const displayName = `${cName}, ${sName}, д. ${hName}, ${oName}`;

        // Формируем строку для поиска (все в нижнем регистре, без спецсимволов)
        const searchString = `${cName} ${sName} ${hName} ${oName}`
            .toLowerCase()
            .replace(/[^\wа-яё\s]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        flatData.push({
            id: obj.id,             // object_id
            city_id: c.id,
            city_name: cName,
            street_id: s.id,
            home_id: h.id,
            display_name: displayName,
            search_string: searchString
        });
    }

    return flatData;
}