const SUPABASE_URL = 'https://sknqilquzxowxqgvwraq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxAJPHPBBuYFUcQNncH_Qw_1v3zk1s3'; 


const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabase = _supabase;