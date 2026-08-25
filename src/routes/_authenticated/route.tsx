import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isSignedInLocally } from "@/lib/session.functions";

async function ensureSignedIn() {
  // SSR guard: there is no localStorage on the server, let the client do the redirect.
  if (typeof window === "undefined") return;
  if (!isSignedInLocally()) throw redirect({ to: "/auth" });
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: ensureSignedIn,
  component: () => <Outlet />,
});
