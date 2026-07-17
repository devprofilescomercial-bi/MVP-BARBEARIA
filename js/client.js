import { supabase } from './supabaseClient.js';
import { state } from './state.js';
import { showAlert, escapeHtml, formatMoney, renderServiceOptions, showScreen } from './shared.js';
import { validateNewBooking, cancelBooking } from './bookingRules.js';

let wiredPicker = false;
let wiredShop = false;

export async function initClientPicker() {
    if (!wiredPicker) {
        wirePickerTabs();
        wiredPicker = true;
    }
    document.querySelectorAll('[data-picker-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-picker-tab="shops"]').classList.add('active');
    document.querySelectorAll('#clientPickerScreen .tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById('pickerShopsTab').classList.add('active');
    await loadShopGrid();
}

function wirePickerTabs() {
    document.querySelectorAll('[data-picker-tab]').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('[data-picker-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.pickerTab;
            document.querySelectorAll('#clientPickerScreen .tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById(`picker${tab === 'shops' ? 'Shops' : tab === 'mybookings' ? 'MyBookings' : 'Profile'}Tab`).classList.add('active');
            if (tab === 'shops') await loadShopGrid();
            if (tab === 'mybookings') await loadClientAllBookings();
            if (tab === 'profile') loadClientProfile();
        });
    });

    document.getElementById('backToShopsBtn').addEventListener('click', async () => {
        state.barbearia = null;
        state.services = [];
        document.querySelectorAll('[data-picker-tab]').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-picker-tab="shops"]').classList.add('active');
        document.querySelectorAll('#clientPickerScreen .tab-content').forEach(el => el.classList.remove('active'));
        document.getElementById('pickerShopsTab').classList.add('active');
        showScreen('clientPickerScreen');
        await loadShopGrid();
    });
}

async function loadShopGrid() {
    const { data, error } = await supabase.from('barbearias').select('*').eq('slug', 'cardoso-barbearia').order('name', { ascending: true });
    const grid = document.getElementById('shopGrid');
    if (error) { grid.innerHTML = '<p class="empty-state">Erro ao carregar barbearias</p>'; return; }
    if (!data.length) { grid.innerHTML = '<p class="empty-state">Nenhuma barbearia cadastrada ainda</p>'; return; }

    grid.innerHTML = data.map(shop => `
        <div class="shop-card" data-shop="${shop.id}">
            ${shop.logo_url
                ? `<img src="${shop.logo_url}" class="shop-card-logo" alt="${escapeHtml(shop.name)}">`
                : `<div class="shop-card-logo">✂️</div>`}
            <h3>${escapeHtml(shop.name)}</h3>
            <p>${escapeHtml(shop.address || 'Endereço não informado')}</p>
        </div>
    `).join('');

    grid.querySelectorAll('[data-shop]').forEach(card => {
        card.addEventListener('click', () => openShop(data.find(s => s.id === card.dataset.shop)));
    });
}

export async function openShopBySlug(slug) {
    const { data, error } = await supabase.from('barbearias').select('*').eq('slug', slug).maybeSingle();
    if (error || !data) return false;
    await openShop(data);
    return true;
}

async function openShop(shop) {
    state.barbearia = shop;

    const { data: services } = await supabase.from('services').select('*')
        .eq('barbearia_id', shop.id).eq('active', true).order('sort_order', { ascending: true });
    state.services = services || [];

    document.getElementById('clientShopName').textContent = shop.name;
    document.getElementById('clientShopAddress').textContent = shop.address || '';
    const logoEl = document.getElementById('clientShopLogo');
    logoEl.innerHTML = shop.logo_url ? `<img src="${shop.logo_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '✂️';

    renderServiceOptions(document.getElementById('serviceType'), state.services);

    if (!wiredShop) {
        wireShopUI();
        wiredShop = true;
    }

    document.querySelectorAll('[data-shop-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-shop-tab="book"]').classList.add('active');
    document.querySelectorAll('#clientShopScreen .tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById('shopBookTab').classList.add('active');

    showScreen('clientShopScreen');
}

function wireShopUI() {
    document.querySelectorAll('[data-shop-tab]').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('[data-shop-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.shopTab;
            document.querySelectorAll('#clientShopScreen .tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById(tab === 'book' ? 'shopBookTab' : 'shopMyBookingsTab').classList.add('active');
            if (tab === 'myshopbookings') await loadClientShopBookings();
        });
    });

    document.getElementById('bookingForm').addEventListener('submit', bookNow);
}

async function bookNow(e) {
    e.preventDefault();
    const serviceId = document.getElementById('serviceType').value;
    const date = document.getElementById('bookingDate').value;
    const time = document.getElementById('bookingTime').value;
    const notes = document.getElementById('bookingNotes').value.trim();

    const service = state.services.find(s => s.id === serviceId);
    if (!service) { showAlert('❌ Selecione um serviço', 'warning'); return; }

    const result = await validateNewBooking(state.barbearia, date, time);
    if (!result.ok) { showAlert(result.message, 'warning'); return; }

    const alreadyBooked = await clientAlreadyBookedThisSlot(date, time);
    if (alreadyBooked) { showAlert('❌ Você já tem um agendamento neste horário', 'warning'); return; }

    const { error } = await supabase.from('bookings').insert({
        barbearia_id: state.barbearia.id,
        client_id: state.user.id,
        service_id: service.id,
        client_name: state.profile.name,
        client_phone: state.profile.phone,
        service_name: service.name,
        price: service.price,
        date, time,
        status: 'confirmed',
        is_walkin: false,
        notes: notes || null
    });

    if (error) { showAlert('❌ Erro ao agendar: ' + error.message, 'warning'); return; }

    showAlert(`✅ Agendamento confirmado! 📅 ${date} às ${time}`, 'success');
    e.target.reset();
}

async function clientAlreadyBookedThisSlot(date, time) {
    const { count } = await supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('barbearia_id', state.barbearia.id).eq('client_id', state.user.id)
        .eq('date', date).eq('time', time).neq('status', 'cancelled');
    return (count || 0) > 0;
}

async function loadClientShopBookings() {
    const { data, error } = await supabase.from('bookings').select('*')
        .eq('barbearia_id', state.barbearia.id).eq('client_id', state.user.id)
        .order('date', { ascending: false }).order('time', { ascending: false });

    const container = document.getElementById('clientShopBookingsContainer');
    renderClientBookingList(container, data, error);
}

async function loadClientAllBookings() {
    const { data, error } = await supabase.from('bookings').select('*, barbearias(name)')
        .eq('client_id', state.user.id)
        .order('date', { ascending: false }).order('time', { ascending: false });

    const container = document.getElementById('clientAllBookingsContainer');
    renderClientBookingList(container, data, error, true);
}

function renderClientBookingList(container, data, error, showShopTag = false) {
    if (error) { container.innerHTML = '<p class="empty-state">Erro ao carregar agendamentos</p>'; return; }
    if (!data.length) { container.innerHTML = '<p class="empty-state">Você ainda não tem agendamentos</p>'; return; }

    container.innerHTML = data.map(b => {
        const cancelled = b.status === 'cancelled';
        return `
            <div class="booking-card ${cancelled ? 'cancelled' : 'confirmed'}">
                ${showShopTag && b.barbearias ? `<div class="booking-shop-tag">${escapeHtml(b.barbearias.name)}</div>` : ''}
                <div class="booking-time">📅 ${b.date} às ${b.time.slice(0, 5)}</div>
                <div class="booking-client-name">${escapeHtml(b.service_name)}</div>
                <div class="text-muted" style="font-size:0.9rem;margin-top:0.3rem;">💰 R$ ${formatMoney(b.price)}</div>
                ${b.notes ? `<div class="text-muted" style="font-size:0.9rem;">📝 ${escapeHtml(b.notes)}</div>` : ''}
                <div style="margin-top:0.6rem;display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
                    <span class="booking-status ${cancelled ? 'cancelled' : 'confirmed'}">${cancelled ? '❌ Cancelado' : '✅ Confirmado'}</span>
                    ${cancelled ? '' : `<button class="btn btn-small btn-danger" data-cancel="${b.id}">Cancelar</button>`}
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Cancelar este agendamento?')) return;
            const { error: cancelError } = await cancelBooking(btn.dataset.cancel);
            if (cancelError) { showAlert('❌ Erro ao cancelar', 'warning'); return; }
            showAlert('✅ Agendamento cancelado', 'success');
            container.closest('#clientShopScreen') ? await loadClientShopBookings() : await loadClientAllBookings();
        });
    });
}

function loadClientProfile() {
    document.getElementById('clientProfileInfo').innerHTML = `
        <div style="background:rgba(212,175,55,0.1);padding:2rem;border-radius:10px;">
            <p style="margin-bottom:1rem;"><strong>Nome:</strong> ${escapeHtml(state.profile.name)}</p>
            <p style="margin-bottom:1rem;"><strong>Telefone:</strong> ${escapeHtml(state.profile.phone || 'Não informado')}</p>
            <p><strong>Email:</strong> ${escapeHtml(state.profile.email || state.user.email)}</p>
        </div>
    `;
}
