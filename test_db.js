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
  console.log('Fetching profiles...');
  const { data: profiles, error: pError } = await supabase.from('profiles').select('*');
  if (pError) console.error('Profiles error:', pError);
  else console.log('Profiles count:', profiles?.length);

  console.log('Fetching submissions...');
  const { data: submissions, error: sError } = await supabase.from('submissions').select('*');
  if (sError) console.error('Submissions error:', sError);
  else {
    console.log('Submissions count:', submissions?.length);
    submissions.forEach(s => {
      console.log(`Sub: id=${s.id}, profile_id=${s.profile_id}, quiz_id=${s.quiz_id}, status=${s.status}, score=${s.score}, total=${s.total}, correct=${s.correct}`);
    });
  }
}

run();
