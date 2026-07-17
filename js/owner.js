import { supabase } from './supabaseClient.js';
import { state } from './state.js';
import {
    showAlert, escapeHtml, formatDateLong, formatMoney, todayISO,
    slugify, renderServiceOptions
} from './shared.js';
import { validateNewBooking, cancelBooking } from './bookingRules.js';

export function initOwnerOnboarding(onCreated) {
    document.getElementById('onboardingForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('obShopName').value.trim();
        const phone = document.getElementById('obPhone').value.trim();
        const address = document.getElementById('obAddress').value.trim();
        const open_time = document.getElementById('obOpenTime').value;
        const close_time = document.getElementById('obCloseTime').value;

        const slug = await uniqueSlug(name);

        const { data: shop, error } = await supabase.from('barbearias')
            .insert({ owner_id: state.user.id, name, phone, address, open_time, close_time, slug })
            .select().single();

        if (error) {
            showAlert('❌ Não foi possível criar a barbearia: ' + error.message, 'warning');
            return;
        }

        const defaults = [
            { name: 'Corte de Cabelo', price: 45, duration_minutes: 30, sort_order: 1 },
            { name: 'Barba', price: 35, duration_minutes: 20, sort_order: 2 },
            { name: 'Corte + Barba', price: 70, duration_minutes: 45, sort_order: 3 },
            { name: 'Lavagem', price: 25, duration_minutes: 15, sort_order: 4 },
        ].map(s => ({ ...s, barbearia_id: shop.id }));
        await supabase.from('services').insert(defaults);

        state.barbearia = shop;
        showAlert(`✅ Barbearia "${name}" criada!`, 'success');
        onCreated();
    });
}

async function uniqueSlug(name) {
    const base = slugify(name) || 'barbearia';
    let slug = base;
    let i = 1;
    while (true) {
        const { data } = await supabase.from('barbearias').select('id').eq('slug', slug).maybeSingle();
        if (!data) return slug;
        i += 1;
        slug = `${base}-${i}`;
    }
}

let wired = false;

export async function initOwnerDashboard() {
    await loadServices();
    fillSettingsForm();
    renderLogoPreview();

    if (!wired) {
        wireOwnerUI();
        wired = true;
    }

    await showOwnerTab('today');
    subscribeRealtime();
}

function wireOwnerUI() {
    document.querySelectorAll('[data-owner-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-owner-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showOwnerTab(btn.dataset.ownerTab);
        });
    });

    document.getElementById('calendarPrevBtn').addEventListener('click', () => {
        state.calendarMonth -= 1;
        if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
        renderCalendar();
    });
    document.getElementById('calendarNextBtn').addEventListener('click', () => {
        state.calendarMonth += 1;
        if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
        renderCalendar();
    });

    document.getElementById('walkinForm').addEventListener('submit', addWalkinClient);
    document.getElementById('blockForm').addEventListener('submit', blockAvailability);
    document.getElementById('shopSettingsForm').addEventListener('submit', saveShopSettings);
    document.getElementById('addServiceBtn').addEventListener('click', addService);

    document.getElementById('logoUploadBtn').addEventListener('click', () => document.getElementById('logoFileInput').click());
    document.getElementById('logoFileInput').addEventListener('change', uploadLogo);

    document.getElementById('editBookingForm').addEventListener('submit', saveEditedBooking);
    document.getElementById('cancelEditBookingBtn').addEventListener('click', closeEditBookingModal);
    document.getElementById('closeEditBookingModal').addEventListener('click', closeEditBookingModal);
}

async function showOwnerTab(tab) {
    document.querySelectorAll('#ownerDashboardScreen .tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`owner${capitalize(tab)}Tab`).classList.add('active');

    if (tab === 'today') { await loadTodayBookings(); await updateDashboardStats(); }
    if (tab === 'calendar') await renderCalendar();
    if (tab === 'walkin') { renderServiceOptions(document.getElementById('walkinService'), state.services); await loadWalkinList(); }
    if (tab === 'availability') await loadBlockedAvailability();
    if (tab === 'clients') await updateClientsTable();
    if (tab === 'settings') { fillSettingsForm(); renderLogoPreview(); renderServicesEditor(); }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function refreshActiveOwnerTab() {
    const activeBtn = document.querySelector('[data-owner-tab].active');
    if (activeBtn) await showOwnerTab(activeBtn.dataset.ownerTab);
}

function subscribeRealtime() {
    if (state.bookingsChannel) return;
    state.bookingsChannel = supabase.channel(`owner-${state.barbearia.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `barbearia_id=eq.${state.barbearia.id}` }, refreshActiveOwnerTab)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots', filter: `barbearia_id=eq.${state.barbearia.id}` }, refreshActiveOwnerTab)
        .subscribe();
}

// ============ HOJE ============
async function loadTodayBookings() {
    const today = todayISO();
    const { data, error } = await supabase.from('bookings').select('*')
        .eq('barbearia_id', state.barbearia.id).eq('date', today).order('time', { ascending: true });

    const container = document.getElementById('todayBookingsContainer');
    if (error) { container.innerHTML = '<p class="empty-state">Erro ao carregar agendamentos</p>'; return; }
    if (!data.length) { container.innerHTML = '<p class="empty-state">Sem agendamentos para hoje</p>'; return; }

    container.innerHTML = data.map(renderOwnerBookingCard).join('');
    bindBookingCardActions(container, data);
}

async function updateDashboardStats() {
    const today = todayISO();
    const { data, error } = await supabase.from('bookings').select('price,status')
        .eq('barbearia_id', state.barbearia.id).eq('date', today).neq('status', 'cancelled');
    if (error) return;
    document.getElementById('todayBookingsCount').textContent = data.length;
    const revenue = data.reduce((sum, b) => sum + Number(b.price), 0);
    document.getElementById('totalRevenueToday').textContent = `R$ ${formatMoney(revenue)}`;
}

function renderOwnerBookingCard(booking) {
    const cancelled = booking.status === 'cancelled';
    return `
        <div class="booking-card ${cancelled ? 'cancelled' : 'confirmed'}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div class="booking-time">${escapeHtml(booking.time.slice(0,5))}</div>
                    <div class="booking-client-name">${escapeHtml(booking.client_name)}${booking.is_walkin ? ' 🚶' : ''}</div>
                    <div class="text-muted" style="font-size:0.9rem;margin-top:0.3rem;">📱 ${escapeHtml(booking.client_phone || '-')}</div>
                    <div class="text-muted" style="font-size:0.9rem;">${escapeHtml(booking.service_name)} - R$ ${formatMoney(booking.price)}</div>
                    ${booking.notes ? `<div class="text-muted" style="font-size:0.9rem;margin-top:0.3rem;">📝 ${escapeHtml(booking.notes)}</div>` : ''}
                </div>
                <div style="display:flex;gap:0.5rem;flex-direction:column;">
                    <span class="booking-status ${cancelled ? 'cancelled' : 'confirmed'}">${cancelled ? '❌ Cancelado' : '✅ Confirmado'}</span>
                    ${cancelled ? '' : `
                        <button class="btn btn-small btn-secondary" data-edit="${booking.id}">✏️ Editar</button>
                        <button class="btn btn-small btn-danger" data-cancel="${booking.id}">🗑️ Cancelar</button>
                    `}
                </div>
            </div>
        </div>
    `;
}

function bindBookingCardActions(container, bookings) {
    container.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => openEditBookingModal(bookings.find(b => b.id === btn.dataset.edit)));
    });
    container.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.addEventListener('click', () => handleCancelBooking(btn.dataset.cancel));
    });
}

async function handleCancelBooking(bookingId) {
    if (!confirm('Cancelar este agendamento?')) return;
    const { error } = await cancelBooking(bookingId);
    if (error) { showAlert('❌ Erro ao cancelar', 'warning'); return; }
    showAlert('✅ Agendamento cancelado', 'success');
    await refreshActiveOwnerTab();
}

// ============ CALENDÁRIO ============
async function renderCalendar() {
    const year = state.calendarYear;
    const month = state.calendarMonth;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const monthLabel = new Date(year, month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    document.getElementById('calendarMonthLabel').textContent = monthLabel;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = todayISO();

    ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-weekday-label';
        header.textContent = day;
        grid.appendChild(header);
    });

    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const { data } = await supabase.from('bookings').select('date')
        .eq('barbearia_id', state.barbearia.id).gte('date', monthStart).lte('date', monthEnd).neq('status', 'cancelled');
    const datesWithBookings = new Set((data || []).map(b => b.date));

    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day other-month';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;
        if (dateStr === todayStr) dayEl.classList.add('today');
        if (datesWithBookings.has(dateStr)) dayEl.classList.add('has-bookings');
        dayEl.addEventListener('click', () => showSelectedDayBookings(dateStr));
        grid.appendChild(dayEl);
    }

    document.getElementById('selectedDayBookings').innerHTML = '';
}

async function showSelectedDayBookings(dateStr) {
    const { data, error } = await supabase.from('bookings').select('*')
        .eq('barbearia_id', state.barbearia.id).eq('date', dateStr).order('time', { ascending: true });

    const container = document.getElementById('selectedDayBookings');
    if (error) return;
    if (!data.length) {
        container.innerHTML = `<p class="empty-state">Nenhum agendamento em ${formatDateLong(dateStr)}</p>`;
        return;
    }
    container.innerHTML = `
        <div style="margin-top:1rem;padding:1.5rem;background:white;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <h3 style="color:var(--secondary);margin-bottom:1rem;">📅 Agendamentos - ${formatDateLong(dateStr)}</h3>
            ${data.map(renderOwnerBookingCard).join('')}
        </div>
    `;
    bindBookingCardActions(container, data);
}

// ============ WALK-IN ============
async function addWalkinClient(e) {
    e.preventDefault();
    const name = document.getElementById('walkinName').value.trim();
    const phone = document.getElementById('walkinPhone').value.trim();
    const serviceId = document.getElementById('walkinService').value;
    const notes = document.getElementById('walkinNotes').value.trim();

    const service = state.services.find(s => s.id === serviceId);
    if (!service) { showAlert('❌ Selecione um serviço', 'warning'); return; }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const { error } = await supabase.from('bookings').insert({
        barbearia_id: state.barbearia.id,
        client_id: null,
        service_id: service.id,
        client_name: name,
        client_phone: phone,
        service_name: service.name,
        price: service.price,
        date: todayISO(),
        time,
        status: 'confirmed',
        is_walkin: true,
        notes: notes || null
    });

    if (error) { showAlert('❌ Erro ao registrar walk-in', 'warning'); return; }

    showAlert(`✅ Cliente ${name} registrado como walk-in!`, 'success');
    e.target.reset();
    await loadWalkinList();
    await refreshActiveOwnerTab();
}

async function loadWalkinList() {
    const { data, error } = await supabase.from('bookings').select('*')
        .eq('barbearia_id', state.barbearia.id).eq('date', todayISO()).eq('is_walkin', true)
        .order('time', { ascending: true });

    const container = document.getElementById('walkinListContainer');
    if (error || !data.length) { container.innerHTML = '<p class="empty-state">Nenhum walk-in registrado hoje</p>'; return; }

    container.innerHTML = data.map(b => `
        <div class="booking-card ${b.status === 'cancelled' ? 'cancelled' : 'confirmed'}">
            <div class="booking-time">${escapeHtml(b.time.slice(0,5))}</div>
            <div class="booking-client-name">🚶 ${escapeHtml(b.client_name)}</div>
            <div class="text-muted" style="font-size:0.9rem;">📱 ${escapeHtml(b.client_phone || '-')}</div>
            <div class="text-muted" style="font-size:0.9rem;">${escapeHtml(b.service_name)} - R$ ${formatMoney(b.price)}</div>
            <span class="booking-status ${b.status === 'cancelled' ? 'cancelled' : 'confirmed'}">${b.status === 'cancelled' ? '❌ Cancelado' : '✅ Registrado'}</span>
        </div>
    `).join('');
}

// ============ DISPONIBILIDADE ============
async function blockAvailability(e) {
    e.preventDefault();
    const date = document.getElementById('blockDate').value;
    const time = document.getElementById('blockTime').value || null;

    let existing = supabase.from('blocked_slots').select('id').eq('barbearia_id', state.barbearia.id).eq('date', date);
    existing = time ? existing.eq('time', time) : existing.is('time', null);
    const { data: found } = await existing.maybeSingle();
    if (found) { showAlert('⚠️ Este horário já está bloqueado', 'warning'); return; }

    const { error } = await supabase.from('blocked_slots').insert({ barbearia_id: state.barbearia.id, date, time });
    if (error) { showAlert('❌ Erro ao bloquear horário', 'warning'); return; }

    showAlert(time ? `✅ Horário ${time} do dia ${date} bloqueado!` : `✅ Dia ${date} bloqueado inteiro!`, 'success');
    e.target.reset();
    await loadBlockedAvailability();
}

async function loadBlockedAvailability() {
    const { data, error } = await supabase.from('blocked_slots').select('*')
        .eq('barbearia_id', state.barbearia.id).order('date', { ascending: true });

    const container = document.getElementById('blockedAvailabilityList');
    if (error || !data.length) { container.innerHTML = '<p class="empty-state">Nenhum horário bloqueado</p>'; return; }

    container.innerHTML = data.map(b => `
        <div style="background:#f9f9f9;padding:1rem;border-radius:8px;margin-bottom:0.8rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
            <div>
                <strong>${b.time ? `${b.date} às ${b.time.slice(0,5)}` : `${b.date} — dia inteiro`}</strong>
                <p style="margin:0.3rem 0 0 0;color:#666;font-size:0.9rem;">${formatDateLong(b.date)}</p>
            </div>
            <button class="btn btn-small btn-danger" data-unblock="${b.id}">🗑️ Remover</button>
        </div>
    `).join('');

    container.querySelectorAll('[data-unblock]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await supabase.from('blocked_slots').delete().eq('id', btn.dataset.unblock);
            showAlert('✅ Horário desbloqueado!', 'success');
            await loadBlockedAvailability();
        });
    });
}

// ============ CLIENTES ============
async function updateClientsTable() {
    const { data, error } = await supabase.from('bookings').select('client_id,client_name,client_phone,price,status')
        .eq('barbearia_id', state.barbearia.id);

    const tbody = document.getElementById('clientsTableBody');
    if (error) return;

    const map = new Map();
    for (const b of data) {
        const key = b.client_id || `walkin:${b.client_phone}:${b.client_name}`;
        if (!map.has(key)) map.set(key, { name: b.client_name, phone: b.client_phone, count: 0, total: 0 });
        const entry = map.get(key);
        if (b.status !== 'cancelled') {
            entry.count += 1;
            entry.total += Number(b.price);
        }
    }

    const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum cliente ainda</td></tr>'; return; }

    tbody.innerHTML = rows.map(c => `
        <tr>
            <td>${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.phone || '-')}</td>
            <td>${c.count}</td>
            <td>R$ ${formatMoney(c.total)}</td>
        </tr>
    `).join('');
}

// ============ EDITAR AGENDAMENTO ============
let editingBooking = null;

function openEditBookingModal(booking) {
    if (!booking) return;
    editingBooking = booking;
    document.getElementById('editBookingClient').value = booking.client_name;
    document.getElementById('editBookingDate').value = booking.date;
    document.getElementById('editBookingTime').value = booking.time.slice(0, 5);
    document.getElementById('editBookingModal').classList.add('active');
}

function closeEditBookingModal() {
    document.getElementById('editBookingModal').classList.remove('active');
    editingBooking = null;
}

async function saveEditedBooking(e) {
    e.preventDefault();
    if (!editingBooking) return;

    const newDate = document.getElementById('editBookingDate').value;
    const newTime = document.getElementById('editBookingTime').value;

    const result = await validateNewBooking(state.barbearia, newDate, newTime, { excludeBookingId: editingBooking.id });
    if (!result.ok) { showAlert(result.message, 'warning'); return; }

    const { error } = await supabase.from('bookings').update({ date: newDate, time: newTime }).eq('id', editingBooking.id);
    if (error) { showAlert('❌ Erro ao salvar', 'warning'); return; }

    showAlert(`✅ Agendamento atualizado para ${newDate} às ${newTime}!`, 'success');
    closeEditBookingModal();
    await refreshActiveOwnerTab();
}

// ============ PERFIL DA BARBEARIA ============
function fillSettingsForm() {
    document.getElementById('settingsShopName').value = state.barbearia.name;
    document.getElementById('settingsPhone').value = state.barbearia.phone || '';
    document.getElementById('settingsAddress').value = state.barbearia.address || '';
    document.getElementById('settingsOpenTime').value = state.barbearia.open_time.slice(0, 5);
    document.getElementById('settingsCloseTime').value = state.barbearia.close_time.slice(0, 5);
}

async function saveShopSettings(e) {
    e.preventDefault();
    const updates = {
        name: document.getElementById('settingsShopName').value.trim(),
        phone: document.getElementById('settingsPhone').value.trim(),
        address: document.getElementById('settingsAddress').value.trim(),
        open_time: document.getElementById('settingsOpenTime').value,
        close_time: document.getElementById('settingsCloseTime').value,
    };
    const { data, error } = await supabase.from('barbearias').update(updates).eq('id', state.barbearia.id).select().single();
    if (error) { showAlert('❌ Erro ao salvar dados da barbearia', 'warning'); return; }
    state.barbearia = data;
    showAlert('✅ Dados da barbearia atualizados!', 'success');
}

function renderLogoPreview() {
    const img = document.getElementById('logoPreviewImg');
    const placeholder = document.getElementById('logoPreviewPlaceholder');
    if (state.barbearia.logo_url) {
        img.src = state.barbearia.logo_url;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    }
}

async function uploadLogo(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showAlert('❌ Imagem deve ter no máximo 2MB', 'warning'); return; }

    const ext = file.name.split('.').pop();
    const path = `${state.barbearia.id}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage.from('logos').upload(path, file, { upsert: true });
    if (uploadError) { showAlert('❌ Erro ao enviar imagem: ' + uploadError.message, 'warning'); return; }

    const { data: pub } = supabase.storage.from('logos').getPublicUrl(path);
    const logoUrl = `${pub.publicUrl}?t=${Date.now()}`;

    const { data, error } = await supabase.from('barbearias').update({ logo_url: logoUrl }).eq('id', state.barbearia.id).select().single();
    if (error) { showAlert('❌ Erro ao salvar logo', 'warning'); return; }

    state.barbearia = data;
    renderLogoPreview();
    showAlert('✅ Logo atualizada!', 'success');
}

// ============ SERVIÇOS E PREÇOS ============
async function loadServices() {
    const { data, error } = await supabase.from('services').select('*')
        .eq('barbearia_id', state.barbearia.id).order('sort_order', { ascending: true });
    state.services = error ? [] : data;
}

function renderServicesEditor() {
    const container = document.getElementById('servicesEditorList');
    if (!state.services.length) { container.innerHTML = '<p class="empty-state">Nenhum serviço cadastrado</p>'; return; }

    container.innerHTML = state.services.map(s => `
        <div class="service-row" data-service-id="${s.id}">
            <input type="text" value="${escapeHtml(s.name)}" data-field="name">
            <input type="number" min="0" step="0.01" value="${s.price}" data-field="price">
            <span class="text-muted" style="font-size:0.85rem;">R$</span>
            <button class="btn btn-small btn-danger" data-remove-service="${s.id}">🗑️</button>
        </div>
    `).join('');

    container.querySelectorAll('.service-row').forEach(row => {
        const id = row.dataset.serviceId;
        row.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', () => saveServiceField(id, input.dataset.field, input.value));
        });
    });
    container.querySelectorAll('[data-remove-service]').forEach(btn => {
        btn.addEventListener('click', () => removeService(btn.dataset.removeService));
    });
}

async function saveServiceField(serviceId, field, value) {
    const payload = { [field]: field === 'price' ? Number(value) : value.trim() };
    const { error } = await supabase.from('services').update(payload).eq('id', serviceId);
    if (error) { showAlert('❌ Erro ao salvar serviço', 'warning'); return; }
    const service = state.services.find(s => s.id === serviceId);
    if (service) service[field] = payload[field];
    showAlert('✅ Serviço atualizado', 'success');
}

async function removeService(serviceId) {
    if (!confirm('Remover este serviço? Ele deixará de aparecer para novos agendamentos.')) return;
    const { error } = await supabase.from('services').delete().eq('id', serviceId);
    if (error) { showAlert('❌ Erro ao remover serviço', 'warning'); return; }
    state.services = state.services.filter(s => s.id !== serviceId);
    renderServicesEditor();
    showAlert('✅ Serviço removido', 'success');
}

async function addService() {
    const { data, error } = await supabase.from('services').insert({
        barbearia_id: state.barbearia.id,
        name: 'Novo Serviço',
        price: 0,
        duration_minutes: state.barbearia.slot_duration_minutes,
        sort_order: state.services.length + 1
    }).select().single();

    if (error) { showAlert('❌ Erro ao criar serviço', 'warning'); return; }
    state.services.push(data);
    renderServicesEditor();
}
