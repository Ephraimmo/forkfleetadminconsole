import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UtensilsCrossed, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEMO_CREDENTIALS,
  signInDemoWithCredentials,
  signInDemoAs,
  writeStoredFirebaseSession,
  type DemoCredential,
  type StaffSession,
} from "@/lib/session.functions";
import { signInStaffWithFirebase } from "@/lib/auth.firebase";
import { profiles } from "@/lib/demo-store";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Staff Sign In | ForkFleet Operations Console" },
      {
        name: "description",
        content:
          "Secure sign-in for ForkFleet staff: administrators, dispatchers, restaurant managers, finance and support teams.",
      },
      { property: "og:title", content: "Staff Sign In | ForkFleet Operations Console" },
      {
        property: "og:description",
        content: "Secure role-based access to the ForkFleet delivery management portal.",
      },
    ],
  }),
  component: AuthPage,
});

const credentials = z.object({
  email: z.string().trim().email({ message: "Enter a valid work email" }).max(255),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const quickAccounts = useMemo<DemoCredential[]>(() => DEMO_CREDENTIALS, []);

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = credentials.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await signInDemoWithCredentials(parsed.data);
    setBusy(false);
    if (!result.ok) {
      toast.error("Invalid demo credentials. Try one of the quick accounts below.");
      setErrors({ email: "No demo staff member matches those credentials." });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["staff-session"] });
    toast.success(`Welcome back, ${result.session?.fullName ?? "staff member"}`);
    navigate({ to: "/dashboard", replace: true });
  }

  async function quickSignIn(cred: DemoCredential) {
    setBusy(true);
    const profile = profiles.find((p) => p.email === cred.email);
    if (profile) signInDemoAs(profile.user_id);
    queryClient.invalidateQueries({ queryKey: ["staff-session"] });
    await new Promise((r) => setTimeout(r, 150));
    setBusy(false);
    toast.success(`Signed in as ${cred.label} (${cred.rolePreview})`);
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 lg:flex">
        <div className="grid-noise pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-5" />
          </span>
          <span className="font-display text-lg font-semibold">ForkFleet</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            The control room behind every delivery on your network.
          </h2>
          <p className="text-sm text-muted-foreground">
            Restaurants, kitchens, dispatch, fleet, finance and support — one operations console,
            fifteen permission-scoped roles, a full audit trail on every action.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            Demo mode — sign in uses static staff accounts only. No Supabase calls are made.
          </div>
        </div>
        <p className="relative text-xs text-muted-foreground">
          Enterprise food ordering &amp; delivery management
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Staff access</CardTitle>
            <CardDescription>
              Sign in with your ForkFleet account. Password for the demo accounts below is{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">demo12345</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="signin-email">Work email</Label>
                <Input
                  id="signin-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue="avery.cole@forkfleet.demo"
                  required
                />
                {errors["email"] && <p className="text-xs text-destructive">{errors["email"]}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin-password">Password</Label>
                <Input
                  id="signin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  defaultValue="demo12345"
                  required
                />
                {errors["password"] && (
                  <p className="text-xs text-destructive">{errors["password"]}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              Demo accounts
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                Pick a role to explore a permission-scoped view.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {quickAccounts.map((acc) => (
                  <Button
                    key={acc.email}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start px-3 py-2 text-left"
                    disabled={busy}
                    onClick={() => void quickSignIn(acc)}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{acc.label}</span>
                      <span className="text-[11px] text-muted-foreground">{acc.rolePreview}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
