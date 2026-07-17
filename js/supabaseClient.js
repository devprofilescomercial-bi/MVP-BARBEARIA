import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.startsWith('COLOQUE_AQUI') && !SUPABASE_ANON_KEY.startsWith('COLOQUE_AQUI');

export const supabase = isConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
