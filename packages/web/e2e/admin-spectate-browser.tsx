import React from "react";
import { createRoot } from "react-dom/client";
import { AdminDuelWatch, AdminDraftWatch } from "@/components/admin-console/live-watch";
createRoot(document.getElementById("root")!).render(window.location.pathname.includes("/draft/") ? <AdminDraftWatch slug="draft" /> : <AdminDuelWatch slug="duel" />);
