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