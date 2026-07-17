export function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '80px';
    alertDiv.style.right = '20px';
    alertDiv.style.maxWidth = '320px';
    alertDiv.style.zIndex = '1000';
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 3500);
}

// Escapa texto vindo de usuários (nome, observações, etc.) antes de jogar em innerHTML,
// pra evitar que alguém digite HTML/script e ele seja executado na tela de outra pessoa.
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function formatDateLong(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatMoney(value) {
    return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function slugify(text) {
    return text
        .toString()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}

export function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

export function renderServiceOptions(selectEl, services) {
    const active = services.filter(s => s.active);
    selectEl.innerHTML = '<option value="">Selecione um serviço...</option>' +
        active.map(s => `<option value="${s.id}">${escapeHtml(s.name)} - R$ ${formatMoney(s.price)}</option>`).join('');
}

export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}
