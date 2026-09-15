import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getSignedInFirebaseUser } from "@/lib/auth.firebase";

/**
 * Shown on Access Control screens when the console session is demo-only
 * (no Firebase Auth operator). Privileged database reads/writes are denied
 * by security rules for such sessions, which manifests as "can't grant
 * access" errors — this banner explains the fix before the user hits them.
 */
export function FirebaseSessionBanner() {
  const operator = useQuery({
    queryKey: ["firebase-operator-session"],
    queryFn: getSignedInFirebaseUser,
    staleTime: 30_000,
  });

  if (operator.isLoading || operator.data) return null;

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <CloudOff className="size-4 text-amber-500" />
      <AlertTitle>Demo session — provisioning may fail</AlertTitle>
      <AlertDescription>
        This browser is not signed in to Firebase as a platform administrator, so creating or
        editing Restaurant Management users can be rejected with permission errors. Sign out and
        use Staff Sign In (/auth) with your provisioned console account instead.
      </AlertDescription>
    </Alert>
  );
}
