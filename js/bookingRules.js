import { supabase } from './supabaseClient.js';
import { timeToMinutes } from './shared.js';

export async function countBookingsAtSlot(barbeariaId, date, time, excludeBookingId = null) {
    let query = supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('barbearia_id', barbeariaId).eq('date', date).eq('time', time).neq('status', 'cancelled');
    if (excludeBookingId) query = query.neq('id', excludeBookingId);
    const { count, error } = await query;
    if (error) { console.error(error); return 0; }
    return count || 0;
}

export async function isSlotBlocked(barbeariaId, date, time) {
    const { data, error } = await supabase.from('blocked_slots').select('time').eq('barbearia_id', barbeariaId).eq('date', date);
    if (error) { console.error(error); return false; }
    if (data.some(b => b.time === null)) return true; // dia inteiro bloqueado
    return data.some(b => b.time && b.time.slice(0, 5) === time);
}

export function withinBusinessHours(barbearia, time) {
    const openMin = timeToMinutes(barbearia.open_time.slice(0, 5));
    const closeMin = timeToMinutes(barbearia.close_time.slice(0, 5));
    const bookMin = timeToMinutes(time);
    if (bookMin < openMin || bookMin > closeMin) return false;
    if (closeMin - bookMin < barbearia.slot_duration_minutes) return false;
    return true;
}

export async function validateNewBooking(barbearia, date, time, { excludeBookingId = null } = {}) {
    if (!withinBusinessHours(barbearia, time)) {
        return { ok: false, message: `❌ Horário fora do funcionamento (${barbearia.open_time.slice(0, 5)} - ${barbearia.close_time.slice(0, 5)})` };
    }
    if (await isSlotBlocked(barbearia.id, date, time)) {
        return { ok: false, message: '❌ Este horário está indisponível' };
    }
    const count = await countBookingsAtSlot(barbearia.id, date, time, excludeBookingId);
    if (count >= barbearia.max_bookings_per_slot) {
        return { ok: false, message: '❌ Este horário já está lotado (máximo ' + barbearia.max_bookings_per_slot + ' agendamentos)' };
    }
    return { ok: true };
}

export async function hasAnyAvailability(barbearia, date) {
    const openMin = timeToMinutes(barbearia.open_time.slice(0, 5));
    const closeMin = timeToMinutes(barbearia.close_time.slice(0, 5)) - barbearia.slot_duration_minutes;
    const step = barbearia.slot_duration_minutes;

    for (let m = openMin; m <= closeMin; m += step) {
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const blocked = await isSlotBlocked(barbearia.id, date, time);
        if (blocked) continue;
        const count = await countBookingsAtSlot(barbearia.id, date, time);
        if (count < barbearia.max_bookings_per_slot) return true;
    }
    return false;
}

export async function cancelBooking(bookingId) {
    return supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
}
