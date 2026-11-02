import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { useWorkerAuth } from "./auth";
import { Loading, Shell } from "./components/Shell";
import { ToastProvider } from "./components/ui";
import { AppDataProvider } from "./data";
import { startAnalytics } from "./lib/analytics";
import { Activity } from "./views/Activity";
import { Budgets } from "./views/Budgets";
import { Overview } from "./views/Overview";
import { Recurring } from "./views/Recurring";
import { Categories, PaymentMethods, Settings } from "./views/Settings";
import { Setup } from "./views/Setup";
import { SignIn, VerifyEmail } from "./views/SignIn";
import { Spaces } from "./views/Spaces";
import "./styles.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
startAnalytics();

function SignedIn() {
  const auth = useWorkerAuth();
  if (auth.isLoading) return <Loading />;
  if (!auth.isAuthenticated) return <SignIn />;
  return (
    <AppDataProvider loading={<Loading />} setup={<Setup />}>
      <Shell />
    </AppDataProvider>
  );
}

const router = createBrowserRouter(
  [
    { path: "/verify-email", element: <VerifyEmail /> },
    {
      element: <SignedIn />,
      children: [
        { index: true, element: <Overview /> },
        { path: "activity", element: <Activity /> },
        { path: "budgets", element: <Budgets /> },
        { path: "settings", element: <Settings /> },
        { path: "settings/spaces", element: <Spaces /> },
        { path: "settings/categories", element: <Categories /> },
        { path: "settings/payment-methods", element: <PaymentMethods /> },
        { path: "settings/repeating", element: <Recurring /> },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: "/app" },
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ConvexProviderWithAuth client={convex} useAuth={useWorkerAuth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ConvexProviderWithAuth>
  </StrictMode>,
);
