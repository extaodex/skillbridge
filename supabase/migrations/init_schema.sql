-- SKILLBRIDGE Africa - Schéma de base de données
-- Version 2.0

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profils étudiants
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    bio TEXT,
    school TEXT,
    study_domain TEXT,
    avatar_url TEXT,
    availability TEXT,
    total_credits INTEGER DEFAULT 0,
    level TEXT DEFAULT 'Contributeur',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Catalogue des compétences
CREATE TABLE skills (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT
);

-- Association profils-compétences
CREATE TABLE profile_skills (
    id SERIAL PRIMARY KEY,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('taught', 'wanted')),
    UNIQUE(profile_id, skill_id, type)
);

-- Séances / demandes
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    skill_id INTEGER REFERENCES skills(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'refused', 'scheduled', 'in_progress', 'completed', 'contested', 'cancelled')),
    mode TEXT CHECK (mode IN ('online', 'in_person')),
    scheduled_at TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 30,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journal des crédits
CREATE TABLE credit_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    credits INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Catalogue des badges
CREATE TABLE badges (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT
);

-- Badges obtenus
CREATE TABLE user_badges (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id INTEGER REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, badge_id)
);

-- Avis
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signalements
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    reported_user_id UUID REFERENCES profiles(id),
    session_id UUID REFERENCES sessions(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_sessions_requester ON sessions(requester_id);
CREATE INDEX idx_sessions_teacher ON sessions(teacher_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);

-- Badges par défaut
INSERT INTO badges (name, description, icon) VALUES
    ('Premier partage', 'Première séance d$aide validée', 'award'),
    ('Polyvalent', 'Enseignement de trois compétences différentes', 'shuffle'),
    ('Régulier', 'Contribution pendant quatre semaines distinctes', 'calendar'),
    ('Mentor apprécié', 'Retours positifs vérifiés', 'heart'),
    ('Esprit communautaire', 'Participation validée à des activités collectives', 'users');

-- Fonction pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Politiques
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Sessions are viewable by participants" ON sessions FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = teacher_id);
CREATE POLICY "Users can create session requests" ON sessions FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "Users can update their sessions" ON sessions FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = teacher_id);

CREATE POLICY "Credit ledger is viewable by owner" ON credit_ledger FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Notifications viewable by owner" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Notifications updatable by owner" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Notifications insertable by authenticated" ON notifications FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Politiques manquantes pour credit_ledger
CREATE POLICY "Credit ledger insertable by authenticated" ON credit_ledger FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Fonction RPC atomique : attribution des crédits lors de la validation d'une séance
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
  -- Verrouiller la ligne pour éviter la double validation
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Session not found');
  END IF;

  -- Idempotence : déjà complétée
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object('already_completed', true, 'credits_awarded', 0);
  END IF;

  -- Vérifier que la séance est dans un état validable
  IF v_session.status NOT IN ('pending', 'accepted', 'scheduled', 'in_progress') THEN
    RETURN jsonb_build_object('error', 'Session not in a completable state');
  END IF;

  v_credits := FLOOR(COALESCE(v_session.duration_minutes, 30) / 30.0);

  -- Marquer la séance comme complétée
  UPDATE sessions SET status = 'completed' WHERE id = p_session_id;

  IF v_credits > 0 THEN
    -- Éviter le double crédit
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