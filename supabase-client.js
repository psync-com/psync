// Cliente Supabase compartido — PSYNC
// Usado por: formulario.html, panel interno, etc.
// La anon key es pública por diseño; el acceso real está controlado por
// las políticas de Row Level Security (RLS) configuradas en Supabase.

const SUPABASE_URL = 'https://ngtkghhjkdrwcxavktxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ndGtnaGhqa2Ryd2N4YXZrdHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MTkxNjAsImV4cCI6MjA5NTQ5NTE2MH0.MB3RlA5iFdd1PB62ftx6pqfkucZTNbBnpQ_641G86I0';

const psyncDB = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
