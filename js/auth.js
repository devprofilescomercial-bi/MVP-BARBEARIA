import { supabase, isConfigured } from './supabaseClient.js';
import { state, resetState } from './state.js';
import { showAlert } from './shared.js';

let selectedRole = 'client';

export function initAuthScreen({ onLoginSuccess, onSignupSuccess }) {
    const roleClientBtn = document.getElementById('roleClientBtn');
    const roleOwnerBtn = document.getElementById('roleOwnerBtn');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const showSignupLink = document.getElementById('showSignupLink');
    const showLoginLink = document.getElementById('showLoginLink');

    function setRole(role) {
        selectedRole = role;
        roleClientBtn.classList.toggle('active', role === 'client');
        roleOwnerBtn.classList.toggle('active', role === 'owner');
    }
    roleClientBtn.addEventListener('click', () => setRole('client'));
    roleOwnerBtn.addEventListener('click', () => setRole('owner'));

    showSignupLink.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        showSignupLink.parentElement.classList.add('hidden');
        showLoginLink.classList.remove('hidden');
    });
    showLoginLink.querySelector('a').addEventListener('click', () => {
        signupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        showLoginLink.classList.add('hidden');
        showSignupLink.parentElement.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isConfigured) {
            showAlert('⚠️ O app ainda não está conectado ao Supabase (veja js/config.js)', 'warning');
            return;
        }
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const password = document.getElementById('loginPassword').value;

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            showAlert('❌ Email ou senha incorretos', 'warning');
            return;
        }
        state.user = data.user;
        showAlert('✅ Login realizado!', 'success');
        loginForm.reset();
        onLoginSuccess();
    });

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isConfigured) {
            showAlert('⚠️ O app ainda não está conectado ao Supabase (veja js/config.js)', 'warning');
            return;
        }
        const name = document.getElementById('signupName').value.trim();
        const phone = document.getElementById('signupPhone').value.trim();
        const email = document.getElementById('signupEmail').value.trim().toLowerCase();
        const password = document.getElementById('signupPassword').value;

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { role: selectedRole, name, phone } }
        });

        if (error) {
            showAlert(`❌ ${translateAuthError(error.message)}`, 'warning');
            return;
        }

        signupForm.reset();

        if (!data.session) {
            showAlert('✅ Conta criada! Verifique seu email para confirmar o acesso.', 'success');
            showLoginLink.querySelector('a').click();
            return;
        }

        state.user = data.user;
        showAlert(`✅ Bem-vindo(a), ${name}!`, 'success');
        onSignupSuccess();
    });
}

export async function logout() {
    if (isConfigured) await supabase.auth.signOut();
    resetState();
}

export async function getActiveSession() {
    if (!isConfigured) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
}

export async function fetchProfile(userId, { retry = true } = {}) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (!data && retry) {
        // o trigger que cria o profile pode levar um instante a mais logo após o cadastro
        await new Promise(r => setTimeout(r, 600));
        return fetchProfile(userId, { retry: false });
    }
    if (error) console.error('Erro ao buscar perfil:', error);
    return data;
}

function translateAuthError(message) {
    if (message.includes('already registered')) return 'Este email já está cadastrado';
    if (message.includes('Password should be')) return 'Senha muito curta (mínimo 6 caracteres)';
    if (message.includes('valid email')) return 'Email inválido';
    return message;
}
