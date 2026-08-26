import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isDemoSignedIn } from "@/lib/session.functions";

async function ensureDemoSignedIn() {
  // SSR guard: there is no localStorage on the server, let the client do the redirect.
  if (typeof window === "undefined") return;
  if (!isDemoSignedIn()) throw redirect({ to: "/auth" });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: ensureDemoSignedIn,
  component: () => <Outlet />,
});
