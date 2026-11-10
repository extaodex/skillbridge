// SKILLBRIDGE Africa - Edge Function: Confirm Session & Award Credits
export default async (req) => {
  const { SupabaseClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  
  const supabase = new SupabaseClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_ANON_KEY')
  );

  const authHeader = req.headers.get('authorization');
  const { data: { user } } = await supabase.auth.getUser(authHeader);
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { session_id, confirmed } = await req.json();

  // Get session
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (fetchError || !session) return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });

  if (session.requester_id !== user.id && session.teacher_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Not a participant' }), { status: 403 });
  }

  // Update session status to completed
  const { data, error } = await supabase
    .from('sessions')
    .update({ status: 'completed' })
    .eq('id', session_id)
    .select()
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  // Award credits to teacher (30 min = 1 credit)
  const credits = Math.floor((session.duration_minutes || 30) / 30);
  
  if (credits > 0) {
    const { error: creditError } = await supabase
      .from('credit_ledger')
      .insert({
        user_id: session.teacher_id,
        session_id: session.id,
        credits,
        reason: `Séance validée - ${session.duration_minutes} minutes`
      });

    if (!creditError) {
      // Update teacher's total credits
      const { data: profile } = await supabase
        .from('profiles')
        .select('total_credits')
        .eq('id', session.teacher_id)
        .single();

      const newTotal = (profile?.total_credits || 0) + credits;
      await supabase
        .from('profiles')
        .update({ total_credits: newTotal })
        .eq('id', session.teacher_id);

      // Determine level
      let level = 'Contributeur';
      if (newTotal >= 50) level = 'Ambassadeur du savoir';
      else if (newTotal >= 25) level = 'Expert solidaire';
      else if (newTotal >= 10) level = 'Mentor actif';
      else if (newTotal >= 3) level = 'Contributeur';

      await supabase
        .from('profiles')
        .update({ level })
        .eq('id', session.teacher_id);

      // Notify teacher
      await supabase.from('notifications').insert({
        user_id: session.teacher_id,
        type: 'credits_awarded',
        title: 'Crédits attribués !',
        body: `Vous avez gagné ${credits} SkillCredit(s)`
      });
    }
  }

  return new Response(JSON.stringify({ session: data, credits_awarded: credits }), { status: 200 });
};