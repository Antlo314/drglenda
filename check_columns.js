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
  console.log('Querying submissions table columns...');
  // We can query using the REST API / RPC or by trying to select specific columns.
  const { data, error } = await supabase.from('submissions').select('id, profile_id, quiz_id, status, score, grade_derivation, question_scores, scoring_method, graded_by, graded_at').limit(1);
  if (error) {
    console.error('Failed to select columns:', error.message, error);
  } else {
    console.log('Success! Columns exist in the database. Returned rows count:', data?.length);
  }
}

run();
