import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { LangProvider } from "./lib/i18n";
import { api, getToken } from "./lib/api";
import { ToastProvider, Spinner } from "./components/ui";
import { StaffLayout, StudentLayout } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tracker from "./pages/Tracker";
import Resume from "./pages/Resume";
import Points from "./pages/Points";
import AdvisorHub from "./pages/AdvisorHub";
import Notifications from "./pages/Notifications";
import StaffStudents from "./pages/StaffStudents";
import StaffStudent from "./pages/StaffStudent";
import Onboarding from "./pages/Onboarding";
import { StaffResume, StaffResumes } from "./pages/StaffResumes";
import { TemplateEditor, TemplateLibrary } from "./pages/ResumeTemplates";
import JobRadar from "./pages/JobRadar";
import JobsForYou from "./pages/JobsForYou";
import JobTracking from "./pages/JobTracking";
import Dashboards from "./pages/Dashboards";
import Automations from "./pages/Automations";
import SetPassword from "./pages/SetPassword";
import { AdminAudit, AdminPauses, AdminPeople, AdminRules } from "./pages/Admin";

function Guard({ staff, children }: { staff?: boolean; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  const isStaff = user.role !== "student";
  if (staff && !isStaff) return <Navigate to="/" replace />;
  if (!staff && isStaff) return <Navigate to="/staff" replace />;
  return <>{children}</>;
}

function WithLang({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <LangProvider userLang={user?.language} userChose={user?.language_set} onSave={(l) => (getToken() ? api.put("/auth/language", { language: l }) : undefined)}>{children}</LangProvider>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route element={<Guard><StudentLayout /></Guard>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tracker" element={<Tracker />} />
        <Route path="/jobs" element={<JobsForYou />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/points" element={<Points />} />
        <Route path="/advisor" element={<AdvisorHub />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route element={<Guard staff><StaffLayout /></Guard>}>
        <Route path="/staff" element={<StaffStudents />} />
        <Route path="/staff/students/:id" element={<StaffStudent />} />
        <Route path="/staff/notifications" element={<Notifications staff />} />
        <Route path="/staff/onboarding" element={<Onboarding />} />
        <Route path="/staff/jobs" element={<JobRadar />} />
        <Route path="/staff/jobs/shared" element={<JobTracking />} />
        <Route path="/staff/dashboards" element={<Dashboards />} />
        <Route path="/staff/automations" element={<Automations />} />
        <Route path="/staff/resumes" element={<StaffResumes />} />
        <Route path="/staff/resumes/templates" element={<TemplateLibrary />} />
        <Route path="/staff/resumes/templates/:tid" element={<TemplateEditor />} />
        <Route path="/staff/resumes/:id" element={<StaffResume />} />
        <Route path="/admin" element={<AdminPauses />} />
        <Route path="/admin/rules" element={<AdminRules />} />
        <Route path="/admin/people" element={<AdminPeople />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter><AuthProvider><WithLang><ToastProvider><App /></ToastProvider></WithLang></AuthProvider></BrowserRouter>
  </React.StrictMode>,
);
