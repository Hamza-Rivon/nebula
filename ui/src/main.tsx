import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { Layout } from "./components/Layout";
import { InsightsPage } from "./pages/Insights";
import { OverviewPage } from "./pages/Overview";
import { SessionsPage } from "./pages/Sessions";
import { SessionDetailPage } from "./pages/SessionDetail";
import { RequestsPage } from "./pages/Requests";
import { RequestDetailPage } from "./pages/RequestDetail";
import { ToolsPage } from "./pages/Tools";
import { UsersPage } from "./pages/Users";
import { SearchPage } from "./pages/Search";
import { JobsPage } from "./pages/Jobs";
import { queryClient } from "./queryClient";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/insights" replace />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="sessions/:id" element={<SessionDetailPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="search" element={<SearchPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
