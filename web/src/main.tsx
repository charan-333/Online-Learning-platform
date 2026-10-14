import 'katex/dist/katex.min.css';
import './styles.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { AdminAudit, AdminImport, AdminLayout, AdminOverview, AdminQuestionEdit, AdminQuestions } from './pages/Admin';
import { AdminEmail } from './pages/AdminEmail';
import { AdminExamPattern } from './pages/AdminPattern';
import { AdminReview } from './pages/AdminReview';
import { Analytics } from './pages/Analytics';
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Diagnostic } from './pages/Diagnostic';
import { CalcGym, Formulas } from './pages/Formulas';
import { DilrList, DilrSetPage, PassagePage, ReadingList } from './pages/Labs';
import { LessonPage } from './pages/Lesson';
import { MasteryHelp, Notes, Search, Settings } from './pages/Misc';
import { MockAnalysis, MockRun, Mocks } from './pages/Mocks';
import { Onboarding } from './pages/Onboarding';
import { Plan } from './pages/Plan';
import { Practice, PracticeModes, QuestionBank } from './pages/Questions';
import { ErrorLog, Revision } from './pages/Review';
import { Strategy } from './pages/Strategy';
import { Syllabus, TopicPage } from './pages/Syllabus';
import { Tutor } from './pages/Tutor';

function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, profile, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  const free = ['/onboarding', '/diagnostic', '/settings'];
  if (profile && !profile.onboarding_completed && !free.includes(loc.pathname) && !loc.pathname.startsWith('/admin')) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="diagnostic" element={<Diagnostic />} />
        <Route path="lesson" element={<LessonPage />} />
        <Route path="lesson/:id" element={<LessonPage />} />
        <Route path="revision" element={<Revision />} />
        <Route path="plan" element={<Plan />} />
        <Route path="syllabus" element={<Syllabus />} />
        <Route path="syllabus/:id" element={<TopicPage />} />
        <Route path="formulas" element={<Formulas />} />
        <Route path="calc-gym" element={<CalcGym />} />
        <Route path="tutor" element={<Tutor />} />
        <Route path="tutor/:id" element={<Tutor />} />
        <Route path="questions" element={<QuestionBank />} />
        <Route path="modes" element={<PracticeModes />} />
        <Route path="practice" element={<Practice />} />
        <Route path="practice/:id" element={<Practice />} />
        <Route path="reading" element={<ReadingList />} />
        <Route path="reading/:id" element={<PassagePage />} />
        <Route path="dilr" element={<DilrList />} />
        <Route path="dilr/:id" element={<DilrSetPage />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="mocks" element={<Mocks />} />
        <Route path="mocks/run/:attemptId" element={<MockRun />} />
        <Route path="mocks/analysis/:attemptId" element={<MockAnalysis />} />
        <Route path="errors" element={<ErrorLog />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="notes" element={<Notes />} />
        <Route path="search" element={<Search />} />
        <Route path="settings" element={<Settings />} />
        <Route path="help/mastery" element={<MasteryHelp />} />
        <Route path="admin" element={<RequireAuth admin><AdminLayout /></RequireAuth>}>
          <Route index element={<AdminOverview />} />
          <Route path="import" element={<AdminImport />} />
          <Route path="questions" element={<AdminQuestions />} />
          <Route path="questions/:id" element={<AdminQuestionEdit />} />
          <Route path="review" element={<AdminReview />} />
          <Route path="exam-pattern" element={<AdminExamPattern />} />
          <Route path="email" element={<AdminEmail />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
        <Route path="*" element={<div className="empty">Page not found.</div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
