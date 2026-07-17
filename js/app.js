import { supabase, isConfigured } from './supabaseClient.js';
import { state } from './state.js';
import { showAlert, showScreen } from './shared.js';
import { initAuthScreen, logout, getActiveSession, fetchProfile } from './auth.js';
import { initOwnerOnboarding, initOwnerDashboard } from './owner.js';
import { initClientPicker, openShopBySlug } from './client.js';

// Suporta abrir direto a página de uma barbearia via link/QR code:
// https://seusite.netlify.app/?loja=nome-da-barbearia
const pendingShopSlug = new URLSearchParams(window.location.search).get('loja');

function initBackgroundAnimation() {
    const bgContainer = document.getElementById('backgroundAnimation');
    const positions = [
        { top: '5%', left: '5%' }, { top: '15%', right: '8%' }, { top: '35%', left: '3%' }, { top: '50%', right: '5%' },
        { top: '65%', left: '7%' }, { top: '75%', right: '10%' }, { top: '85%', left: '4%' }, { top: '25%', right: '3%' }
    ];
    positions.forEach((pos, idx) => {
        const div = document.createElement('div');
        div.className = 'floating-tool';
        const size = 70 + (idx % 3) * 8;
        div.style.width = size + 'px';
        div.style.height = size + 'px';
        Object.entries(pos).forEach(([k, v]) => { div.style[k] = v; });
        const isScissors = idx % 2 === 0;
        div.style.color = isScissors ? '#d4af37' : '#8b4513';
        div.innerHTML = isScissors
            ? `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                 <path d="M 20 15 Q 15 15 12 20 Q 10 25 15 35 L 45 50 L 15 65 Q 10 75 12 80 Q 15 85 20 85 Q 28 85 35 75 L 50 60 L 35 45 Q 28 35 20 15 Z"/>
                 <path d="M 80 15 Q 85 15 88 20 Q 90 25 85 35 L 55 50 L 85 65 Q 90 75 88 80 Q 85 85 80 85 Q 72 85 65 75 L 50 60 L 65 45 Q 72 35 80 15 Z"/>
                 <circle cx="50" cy="50" r="5"/>
               </svg>`
            : `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                 <rect x="25" y="15" width="20" height="55" rx="10"/>
                 <path d="M 35 70 L 40 95 L 60 95 L 65 70 Q 50 80 35 70 Z"/>
               </svg>`;
        bgContainer.appendChild(div);
    });
}

function updateNavbarLoggedIn(name) {
    document.getElementById('userInfo').classList.remove('hidden');
    document.getElementById('userNameLabel').textContent = `👋 Olá, ${name}!`;
}

function updateNavbarLoggedOut() {
    document.getElementById('userInfo').classList.add('hidden');
}

async function routeAfterAuth() {
    const profile = await fetchProfile(state.user.id);
    if (!profile) {
        showAlert('❌ Não foi possível carregar seu perfil. Tente novamente.', 'warning');
        return;
    }
    state.profile = profile;
    updateNavbarLoggedIn(profile.name);

    if (profile.role === 'owner') {
        const { data: shop } = await supabase.from('barbearias').select('*').eq('owner_id', state.user.id).maybeSingle();
        if (!shop) {
            showScreen('ownerOnboardingScreen');
        } else {
            state.barbearia = shop;
            showScreen('ownerDashboardScreen');
            await initOwnerDashboard();
        }
    } else {
        if (pendingShopSlug) {
            const opened = await openShopBySlug(pendingShopSlug);
            if (opened) return;
        }
        showScreen('clientPickerScreen');
        await initClientPicker();
    }
}

async function bootstrap() {
    initBackgroundAnimation();

    initAuthScreen({
        onLoginSuccess: routeAfterAuth,
        onSignupSuccess: routeAfterAuth
    });

    initOwnerOnboarding(async () => {
        showScreen('ownerDashboardScreen');
        await initOwnerDashboard();
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await logout();
        updateNavbarLoggedOut();
        showScreen('authScreen');
    });

    if (!isConfigured) {
        showAlert('⚠️ Conecte o Supabase em js/config.js para o app funcionar de verdade', 'warning');
        return;
    }

    const session = await getActiveSession();
    if (session) {
        state.user = session.user;
        await routeAfterAuth();
    }
}

document.addEventListener('DOMContentLoaded', bootstrap);
