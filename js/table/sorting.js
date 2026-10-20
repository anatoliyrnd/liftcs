import { tableSettings } from './settings.js';

export function parseDate(dateStr) {
    if (!dateStr || dateStr === '—') return new Date(0);
    const head = String(dateStr).split(' ')[0];
    const sep = head.includes('.') ? '.' : '/';
    const [a, b, y] = head.split(sep).map(Number);
    if (!a || !b || !y) return new Date(0);
    return new Date(y, b - 1, a);
}

export function sortRows(rows, columnId, isAscending) {
    const col = tableSettings.columns.find(c => c.id === columnId);
    const type = col ? col.dataType : 'string';

    rows.sort((rowA, rowB) => {
        const a = rowA.querySelector(`td[data-col-id="${columnId}"]`);
        const b = rowB.querySelector(`td[data-col-id="${columnId}"]`);
        const va = a ? a.textContent.trim() : '';
        const vb = b ? b.textContent.trim() : '';

        if (type === 'number') {
            const na = parseFloat(va || 0), nb = parseFloat(vb || 0);
            return isAscending ? na - nb : nb - na;
        }
        if (type === 'date') {
            const da = parseDate(va), db = parseDate(vb);
            return isAscending ? da - db : db - da;
        }
        return isAscending ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
    });
}