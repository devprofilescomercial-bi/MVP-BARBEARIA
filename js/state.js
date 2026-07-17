// Estado em memória da sessão atual (não é persistência — isso é o Supabase Auth
// que cuida sozinho, guardando o token no localStorage do navegador).
export const state = {
    user: null,        // usuário do Supabase Auth (auth.users)
    profile: null,      // linha em public.profiles (role: 'owner' | 'client')
    barbearia: null,    // dono: a própria barbearia. cliente: a barbearia escolhida agora.
    services: [],       // serviços da barbearia atualmente aberta
    bookingsChannel: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
};

export function resetState() {
    state.user = null;
    state.profile = null;
    state.barbearia = null;
    state.services = [];
    if (state.bookingsChannel) {
        state.bookingsChannel.unsubscribe();
        state.bookingsChannel = null;
    }
}
