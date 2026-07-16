#!/usr/bin/env node
// deploy-schema.mjs — One-time schema deploy for invite_codes
// Run: node deploy-schema.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const PROJECT_REF = 'uzmhsesmszngkanjsjgy';
const URL = `https://${PROJECT_REF}.supabase.co`;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bWhzZXNtc3puZ2thbmpzamd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MDIxNDcsImV4cCI6MjA5OTI3ODE0N30.Q0-GoEknEoh_GorGK9JgvHNKq9kwLs72fDIkJ4stQNo';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bWhzZXNtc3puZ2thbmpzamd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzcwMjE0NywiZXhwIjoyMDk5Mjc4MTQ3fQ.6hD4DoCTZmhXPGn56lJmlOX2n_Yx0RozbQpaqwZWtyU';

console.log('\n=== نشر هيكل رموز الدعوة ===\n');

// Option 1: Try Management API with service_role key
const sql = readFileSync('supabase/deploy-invite-schema.sql', 'utf8');

try {
    const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
    });
    if (resp.ok) {
        console.log('✅ تم النشر بنجاح عبر Management API!');
        process.exit(0);
    }
    const body = await resp.text();
    console.log(`ℹ️  Management API: ${resp.status} ${body.slice(0, 100)}`);
} catch (e) {
    console.log(`ℹ️  Management API غير متاح: ${e.message}`);
}

// Option 2: Try Supabase CLI
console.log('\nجرّب عبر Supabase CLI...');
try {
    const { execSync } = await import('child_process');
    execSync(`npx supabase db execute --project-ref ${PROJECT_REF}`, {
        input: sql,
        stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log('✅ تم النشر عبر CLI!');
    process.exit(0);
} catch (e) {
    console.log(`ℹ️  CLI غير متاح: ${e.message.slice(0, 100)}`);
}

console.log('\n⚠️  لم نتمكن من النشر تلقائياً.');
console.log('\nالرجاء فتح الرابط التالي في المتصفح:');
console.log(`https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
console.log('\nثم انسخ محتوى الملف: supabase/deploy-invite-schema.sql');
console.log('والصقه في محرر SQL واضغط Run.\n');
