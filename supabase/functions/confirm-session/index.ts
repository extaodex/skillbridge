// SKILLBRIDGE Africa - Edge Function: Confirm Session & Award Credits
export default async (req) => {
  const { SupabaseClient } = await import('https://esm.sh/@supabase/supabase-js@2');

  const supabase = new SupabaseClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY')
  );

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { session_id } = body || {};
  if (!session_id) {
    return new Response(JSON.stringify({ error: 'session_id is required' }), { status: 400 });
  }

  // Vérifier que l'utilisateur est participant
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('requester_id, teacher_id')
    .eq('id', session_id)
    .single();

  if (fetchError || !session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
  }

  if (session.requester_id !== user.id && session.teacher_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Not a participant' }), { status: 403 });
  }

  // Attribution atomique via RPC (SECURITY DEFINER)
  const { data, error } = await supabase.rpc('award_session_credits', {
    p_session_id: session_id,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify(data), { status: 200 });
};