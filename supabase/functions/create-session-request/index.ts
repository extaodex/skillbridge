// SKILLBRIDGE Africa - Edge Function: Create Session Request
export default async (req) => {
  const { SupabaseClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  
  const supabase = new SupabaseClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY')
  );

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { teacher_id, skill_id, mode, scheduled_at, duration_minutes } = await req.json();

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      requester_id: user.id,
      teacher_id,
      skill_id,
      mode,
      scheduled_at,
      duration_minutes: duration_minutes || 30,
      status: 'pending'
    })
    .select()
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  // Notify teacher
  await supabase.from('notifications').insert({
    user_id: teacher_id,
    type: 'new_request',
    title: 'Nouvelle demande',
    body: `Quelqu'un demande d'apprendre une compétence avec vous`
  });

  return new Response(JSON.stringify(data), { status: 201 });
};