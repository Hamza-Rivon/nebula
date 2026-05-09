import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/Overview";
import { SessionsPage } from "./pages/Sessions";
import { SessionDetailPage } from "./pages/SessionDetail";
import { RequestsPage } from "./pages/Requests";
import { RequestDetailPage } from "./pages/RequestDetail";
import { ProvidersPage } from "./pages/Providers";
import { ToolsPage } from "./pages/Tools";
import { UsersPage } from "./pages/Users";
import { SearchPage } from "./pages/Search";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="requests/:id" element={<RequestDetailPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="providers" element={<ProvidersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
