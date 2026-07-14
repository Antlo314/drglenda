import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Attempting to register info@umof.org...');
  try {
    const { data, error } = await supabase.auth.signUp({
      email: 'info@umof.org',
      password: 'TempPassword123!',
    });
    if (error) {
      console.error('Registration failed:', error.message, error);
    } else {
      console.log('Registration result:', data);
    }
  } catch (e) {
    console.error('Caught error:', e);
  }
}

run();
