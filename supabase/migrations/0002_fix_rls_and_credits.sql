-- Delta migration : RLS manquantes + attribution atomique des crédits
-- À exécuter sur les projets déjà déployés avec init_schema.sql v2.0

CREATE POLICY IF NOT EXISTS "Notifications insertable by authenticated"
  ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY IF NOT EXISTS "Credit ledger insertable by authenticated"
  ON credit_ledger FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION award_session_credits(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session sessions%ROWTYPE;
  v_credits INTEGER;
  v_new_total INTEGER;
  v_level TEXT;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('already_completed', true, 'credits_awarded', 0);
  END IF;

  IF v_session.status NOT IN ('pending', 'accepted', 'scheduled', 'in_progress') THEN
    RETURN jsonb_build_object('error', 'Session not in a completable state');
  END IF;

  v_credits := FLOOR(COALESCE(v_session.duration_minutes, 30) / 30.0);

  UPDATE sessions SET status = 'completed' WHERE id = p_session_id;

  IF v_credits > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM credit_ledger WHERE session_id = p_session_id) THEN
      INSERT INTO credit_ledger (user_id, session_id, credits, reason)
      VALUES (v_session.teacher_id, v_session.id, v_credits,
              'Séance validée - ' || v_session.duration_minutes || ' minutes');

      SELECT COALESCE(total_credits, 0) INTO v_new_total
      FROM profiles WHERE id = v_session.teacher_id;

      v_new_total := COALESCE(v_new_total, 0) + v_credits;

      IF v_new_total >= 50 THEN v_level := 'Ambassadeur du savoir';
      ELSIF v_new_total >= 25 THEN v_level := 'Expert solidaire';
      ELSIF v_new_total >= 10 THEN v_level := 'Mentor actif';
      ELSE v_level := 'Contributeur';
      END IF;

      UPDATE profiles
      SET total_credits = v_new_total, level = v_level
      WHERE id = v_session.teacher_id;

      INSERT INTO notifications (user_id, type, title, body)
      VALUES (v_session.teacher_id, 'credits_awarded', 'Crédits attribués !',
              'Vous avez gagné ' || v_credits || ' SkillCredit(s)');
    END IF;
  END IF;

  RETURN jsonb_build_object('session_id', p_session_id, 'credits_awarded', v_credits, 'status', 'completed');
END;
$$;