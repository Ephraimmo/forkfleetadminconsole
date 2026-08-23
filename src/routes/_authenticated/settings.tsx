import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bell,
  Building2,
  Check,
  Copy,
  Globe,
  ImageIcon,
  Key,
  Loader2,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Trash2,
  Wifi,
  WifiOff,
  Webhook as WebhookIcon,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addWebhookEndpoint,
  createApiKey,
  DRAFTED_SECTIONS,
  fetchSettingsOnce,
  removeWebhookEndpoint,
  rotateApiKey,
  revokeApiKey,
  setWebhookActive,
  subscribeSettings,
  WEBHOOK_EVENT_CATALOG,
  type BrandingSettings,
  type DraftedSection,
  type LocalisationSettings,
  type NotificationSettings,
  type OrganisationSettings,
  type PlatformSettings,
  type SecuritySettings,
  type MediaSettings,
} from "@/lib/settings.firebase";
import { CloudinaryImageUpload } from "@/components/cloudinary-image-upload";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ForkFleet Console" },
      {
        name: "description",
        content:
          "Organisation, branding, security, notification and API settings — persisted to Firebase.",
      },
    ],
  }),
  component: SettingsPage,
});

const SECTION_NAV: { value: string; label: string; icon: typeof Building2 }[] = [
  { value: "organisation", label: "Organisation", icon: Building2 },
  { value: "branding", label: "Branding", icon: Palette },
  { value: "media", label: "Media (Cloudinary)", icon: ImageIcon },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "security", label: "Security", icon: Lock },
  { value: "localisation", label: "Localisation", icon: Globe },
  { value: "api", label: "API & webhooks", icon: Key },
];

const SECTION_LABELS: Record<DraftedSection, string> = {
  organisation: "Organisation",
  branding: "Branding",
  media: "Media (Cloudinary)",
  notifications: "Notifications",
  security: "Security",
  localisation: "Localisation",
};

/* ------------------------------------------------------------- validation */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #F2A93B");

const SCHEMAS = {
  organisation: z.object({
    name: z.string().trim().min(2, "Organisation name is required").max(120),
    trading_name: z.string().trim().min(1, "Trading name is required").max(60),
    support_email: z.string().trim().email("Enter a valid support email"),
    support_phone: z.string().trim().min(7, "Enter a valid phone number").max(24),
    registration_number: z.string().trim().max(40),
    vat_number: z.string().trim().max(30),
    address: z.string().trim().min(5, "Registered address is required").max(200),
  }),
  branding: z.object({
    primary_color: hexColor,
    accent_color: hexColor,
    app_display_name: z.string().trim().min(2, "Display name is required").max(40),
    support_url: z.string().trim().url("Enter a valid URL (https://…)"),
    custom_domain: z
      .string()
      .trim()
      .max(100)
      .refine(
        (v) => v === "" || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v),
        "Enter a domain like orders.example.com",
      ),
  }),
  notifications: z.object({
    order_status_emails: z.boolean(),
    dispatch_alerts: z.boolean(),
    weekly_digest: z.boolean(),
    slack_integration: z.boolean(),
    sms_otp_admin: z.boolean(),
  }),
  security: z.object({
    require_2fa: z.boolean(),
    enforce_sso: z.boolean(),
    auto_logout: z.boolean(),
    min_password_length: z.number().int().min(8, "Minimum 8").max(64, "Maximum 64"),
    session_timeout_minutes: z.number().int().min(5, "Minimum 5").max(1440, "Maximum 1440"),
    log_retention_days: z.number().int(),
    data_residency: z.string().min(2),
  }),
  localisation: z.object({
    language: z.string().min(2),
    currency: z.string().min(2),
    timezone: z.string().min(3),
    distance_unit: z.enum(["km", "mi"]),
  }),
  media: z.object({
    cloudinary_cloud_name: z.string().trim().max(80),
    cloudinary_upload_preset: z.string().trim().max(80),
    logo_url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\//i.test(v), "Enter a valid image URL"),
  }),
} as const;

type Drafts = Partial<{
  organisation: OrganisationSettings;
  branding: BrandingSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  localisation: LocalisationSettings;
  media: MediaSettings;
}>;

const relative = (iso: string | null): string => {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return formatDistanceToNow(date, { addSuffix: true });
};

/* ------------------------------------------------------------------- page  */

function SettingsPage() {
  return (
    <PermissionGate
      required={["settings.manage", "users.view"]}
      breadcrumb={["Platform", "Settings"]}
      title="Settings"
      description="Organisation, branding, security, notifications and API integrations — stored live in Firebase."
    >
      {(staff) => (
        <SettingsWorkspace
          canManage={staff.hasPermission("settings.manage")}
          actorEmail={staff.session?.email ?? null}
        />
      )}
    </PermissionGate>
  );
}

type StaffHook = ReturnType<typeof import("@/hooks/use-staff-session").useStaffSession>;

function SettingsWorkspace({
  canManage,
  actorEmail,
}: {
  canManage: boolean;
  actorEmail: string | null;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [draftAt, setDraftAt] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<DraftedSection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState("organisation");

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: fetchSettingsOnce,
  });

  // Real-time settings — changes by other administrators stream in instantly.
  useEffect(() => {
    return subscribeSettings((value) => queryClient.setQueryData(["platform-settings"], value));
  }, [queryClient]);

  const settings = settingsQuery.data;

  // Drop drafts that now match the server (someone saved the same values).
  useEffect(() => {
    if (!settings) return;
    setDrafts((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const section of DRAFTED_SECTIONS) {
        const draft = next[section];
        if (draft && JSON.stringify(draft) === JSON.stringify(settings[section])) {
          delete next[section];
          changed = true;
        }
      }
      return changed ? next : next;
    });
  }, [settings]);

  const dirty = (section: DraftedSection) =>
    drafts[section] !== undefined &&
    !!settings &&
    JSON.stringify(drafts[section]) !== JSON.stringify(settings[section]);

  const conflicting = (section: DraftedSection) => {
    if (!settings || !dirty(section)) return false;
    const meta = settings.sectionMeta[section];
    if (!meta?.updated_at) return false;
    const updatedAt = new Date(meta.updated_at).getTime();
    return Number.isFinite(updatedAt) && updatedAt > (draftAt[section] ?? 0);
  };

  function update<S extends DraftedSection>(section: S, patch: Partial<PlatformSettings[S]>): void {
    setDrafts((previous) => ({
      ...previous,
      [section]: {
        ...(drafts[section] ?? settings?.[section] ?? {}),
        ...patch,
      } as PlatformSettings[S],
    }));
    setDraftAt((previous) => ({ ...previous, [section]: Date.now() }));
  }

  function discard(section: DraftedSection) {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[section];
      return next;
    });
    setErrors((previous) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (!key.startsWith(`${section}.`)) next[key] = value;
      }
      return next;
    });
  }

  async function save(section: DraftedSection) {
    if (!settings) return;
    const value = drafts[section] ?? settings[section];
    const parsed = SCHEMAS[section].safeParse(value);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = `${section}.${String(issue.path[0] ?? "")}`;
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors((previous) => {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(previous)) {
          if (!key.startsWith(`${section}.`)) next[key] = value;
        }
        return { ...next, ...fieldErrors };
      });
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setErrors((previous) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (!key.startsWith(`${section}.`)) next[key] = value;
      }
      return next;
    });
    setSaving(section);
    const result = await updateSettingsSectionPublic(section, value, actorEmail);
    setSaving(null);
    if (result.ok) {
      toast.success(`${SECTION_LABELS[section]} settings saved to Firebase`);
      discard(section);
    } else {
      toast.error(result.error ?? "Failed to save settings.");
    }
  }

  if (settingsQuery.isLoading || !settings) {
    return (
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Skeleton className="h-64 w-full" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const err = (section: DraftedSection, field: string) => errors[`${section}.${field}`];

  const shellProps = (section: DraftedSection) => ({
    dirty: dirty(section),
    conflict: conflicting(section),
    saving: saving === section,
    readOnly: !canManage,
    onSave: () => void save(section),
    onDiscard: () => discard(section),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Last change {relative(settings.meta.updated_at)}
          {settings.meta.updated_by ? ` by ${settings.meta.updated_by}` : ""} · changes save
          straight to the Realtime Database
        </p>
        <Badge variant="outline" className="gap-1.5 font-normal">
          {settingsQuery.isError ? (
            <>
              <WifiOff className="size-3 text-amber-500" />
              Offline — showing cached values
            </>
          ) : (
            <>
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <Wifi className="size-3 text-emerald-500" />
              Firebase live
            </>
          )}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardContent className="p-2">
            <Tabs
              value={activeSection}
              onValueChange={setActiveSection}
              orientation="vertical"
              className="w-full"
            >
              <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 bg-transparent p-0">
                {SECTION_NAV.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="justify-start gap-2 rounded-md px-3 py-2 data-[state=active]:bg-muted"
                  >
                    <tab.icon className="size-4" />
                    <span className="text-sm">{tab.label}</span>
                    {DRAFTED_SECTIONS.includes(tab.value as DraftedSection) &&
                      dirty(tab.value as DraftedSection) && (
                        <span
                          className="ml-auto size-1.5 rounded-full bg-primary"
                          aria-label="Unsaved changes"
                        />
                      )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Tabs value={activeSection} onValueChange={setActiveSection} orientation="vertical">
            <TabsContent value="organisation">
              <SectionShell
                title="Organisation profile"
                desc="How your business appears across the console, receipts and invoices."
                {...shellProps("organisation")}
              >
                {(readOnly) => (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Organisation name" error={err("organisation", "name")}>
                      <Input
                        value={valueOf(settings, drafts, "organisation").name}
                        disabled={readOnly}
                        onChange={(e) => update("organisation", { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Trading name" error={err("organisation", "trading_name")}>
                      <Input
                        value={valueOf(settings, drafts, "organisation").trading_name}
                        disabled={readOnly}
                        onChange={(e) => update("organisation", { trading_name: e.target.value })}
                      />
                    </Field>
                    <Field label="Support email" error={err("organisation", "support_email")}>
                      <Input
                        type="email"
                        value={valueOf(settings, drafts, "organisation").support_email}
                        disabled={readOnly}
                        onChange={(e) => update("organisation", { support_email: e.target.value })}
                      />
                    </Field>
                    <Field label="Support phone" error={err("organisation", "support_phone")}>
                      <Input
                        value={valueOf(settings, drafts, "organisation").support_phone}
                        disabled={readOnly}
                        onChange={(e) => update("organisation", { support_phone: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Registration number"
                      error={err("organisation", "registration_number")}
                    >
                      <Input
                        value={valueOf(settings, drafts, "organisation").registration_number}
                        disabled={readOnly}
                        onChange={(e) =>
                          update("organisation", { registration_number: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="VAT number" error={err("organisation", "vat_number")}>
                      <Input
                        value={valueOf(settings, drafts, "organisation").vat_number}
                        disabled={readOnly}
                        onChange={(e) => update("organisation", { vat_number: e.target.value })}
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Registered address" error={err("organisation", "address")}>
                        <Input
                          value={valueOf(settings, drafts, "organisation").address}
                          disabled={readOnly}
                          onChange={(e) => update("organisation", { address: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </SectionShell>

              <SectionShell
                title="Billing"
                desc="Subscription plan and billing contact."
                className="mt-4"
                hideFooter
              >
                {() => (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
                    <div>
                      <p className="text-sm font-medium">Enterprise plan</p>
                      <p className="text-xs text-muted-foreground">
                        Unlimited restaurants, drivers and orders. Billing cycle renews on the 1st
                        of each month.
                      </p>
                    </div>
                    <Badge className="border-transparent bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
                      Active
                    </Badge>
                  </div>
                )}
              </SectionShell>
            </TabsContent>

            <TabsContent value="branding">
              <SectionShell
                title="Customer app branding"
                desc="Colours, app name and support links shown to diners on emails and apps."
                {...shellProps("branding")}
              >
                {(readOnly) => {
                  const branding = valueOf(settings, drafts, "branding");
                  return (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="grid gap-4 md:grid-cols-2">
                        <ColorField
                          label="Primary brand colour"
                          value={branding.primary_color}
                          error={err("branding", "primary_color")}
                          disabled={readOnly}
                          onChange={(hex) => update("branding", { primary_color: hex })}
                        />
                        <ColorField
                          label="Accent colour"
                          value={branding.accent_color}
                          error={err("branding", "accent_color")}
                          disabled={readOnly}
                          onChange={(hex) => update("branding", { accent_color: hex })}
                        />
                        <Field label="App display name" error={err("branding", "app_display_name")}>
                          <Input
                            value={branding.app_display_name}
                            disabled={readOnly}
                            onChange={(e) =>
                              update("branding", { app_display_name: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="Support URL" error={err("branding", "support_url")}>
                          <Input
                            value={branding.support_url}
                            disabled={readOnly}
                            onChange={(e) => update("branding", { support_url: e.target.value })}
                          />
                        </Field>
                        <div className="md:col-span-2">
                          <Field
                            label="Custom domain (optional)"
                            error={err("branding", "custom_domain")}
                            hint="Point your own domain at the customer ordering site."
                          >
                            <Input
                              placeholder="orders.example.com"
                              value={branding.custom_domain}
                              disabled={readOnly}
                              onChange={(e) =>
                                update("branding", { custom_domain: e.target.value })
                              }
                            />
                          </Field>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Live preview</p>
                        <div className="overflow-hidden rounded-xl border border-border">
                          <div
                            className="flex items-center gap-2 p-4 font-semibold text-white"
                            style={{ backgroundColor: branding.primary_color }}
                          >
                            🍴 {branding.app_display_name || "App name"}
                          </div>
                          <div className="space-y-2 bg-background p-4">
                            <div className="h-2 w-2/3 rounded-full bg-muted" />
                            <div className="h-2 w-1/2 rounded-full bg-muted" />
                            <div className="flex gap-2 pt-1">
                              <span
                                className="rounded-md px-2.5 py-1 text-xs font-medium text-white"
                                style={{ backgroundColor: branding.accent_color }}
                              >
                                Track order
                              </span>
                              <span className="rounded-md border border-border px-2.5 py-1 text-xs">
                                Menu
                              </span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Updates as you type — saved values apply to customer emails and receipts.
                        </p>
                      </div>
                    </div>
                  );
                }}
              </SectionShell>
            </TabsContent>

            <TabsContent value="media">
              <SectionShell
                title="Media (Cloudinary)"
                desc="Images upload to Cloudinary via an unsigned upload preset. The API secret is not stored and is never used in the browser."
                {...shellProps("media")}
              >
                {(readOnly) => {
                  const media = valueOf(settings, drafts, "media");
                  return (
                    <div className="grid gap-6 md:grid-cols-2">
                      <Field
                        label="Cloud name"
                        error={err("media", "cloudinary_cloud_name")}
                        hint="From your Cloudinary dashboard (Cloud name)."
                      >
                        <Input
                          value={media.cloudinary_cloud_name}
                          disabled={readOnly}
                          placeholder="your_cloud_name"
                          onChange={(e) =>
                            update("media", { cloudinary_cloud_name: e.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="Upload preset (unsigned)"
                        error={err("media", "cloudinary_upload_preset")}
                        hint="Settings → Upload → Upload presets → Signing mode: Unsigned."
                      >
                        <Input
                          value={media.cloudinary_upload_preset}
                          disabled={readOnly}
                          placeholder="ml_default"
                          onChange={(e) =>
                            update("media", { cloudinary_upload_preset: e.target.value })
                          }
                        />
                      </Field>
                      <div className="md:col-span-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                        If these fields are empty, the console falls back to{" "}
                        <code className="rounded bg-muted px-1">VITE_CLOUDINARY_CLOUD_NAME</code> /{" "}
                        <code className="rounded bg-muted px-1">VITE_CLOUDINARY_UPLOAD_PRESET</code>{" "}
                        for local development only. Never put an API Key or API Secret in{" "}
                        <code className="rounded bg-muted px-1">VITE_*</code> env vars.
                      </div>
                      <div className="md:col-span-2">
                        <CloudinaryImageUpload
                          label="Platform logo"
                          context="settings_logo"
                          value={media.logo_url}
                          disabled={readOnly}
                          previewAspect="square"
                          overrides={{
                            cloudName: media.cloudinary_cloud_name,
                            uploadPreset: media.cloudinary_upload_preset,
                          }}
                          onChange={(url) => update("media", { logo_url: url })}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          Upload sets the logo URL in this draft — click Save to persist it with the
                          Cloudinary settings.
                        </p>
                      </div>
                    </div>
                  );
                }}
              </SectionShell>
            </TabsContent>

            <TabsContent value="notifications">
              <SectionShell
                title="Default notifications"
                desc="System-wide defaults for staff notification routing. Triggers can be customised on the Notifications page."
                {...shellProps("notifications")}
              >
                {(readOnly) => {
                  const notifications = valueOf(settings, drafts, "notifications");
                  return (
                    <div className="space-y-4">
                      <ToggleRow
                        label="Order status emails to customers"
                        desc="Customers get an email at each stage (confirmed, out-for-delivery, delivered)."
                        checked={notifications.order_status_emails}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("notifications", { order_status_emails: v })}
                      />
                      <ToggleRow
                        label="Dispatch alerts to managers"
                        desc="Late orders, driver offline and other critical events."
                        checked={notifications.dispatch_alerts}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("notifications", { dispatch_alerts: v })}
                      />
                      <ToggleRow
                        label="Weekly digest email"
                        desc="KPI summary delivered every Monday at 07:00."
                        checked={notifications.weekly_digest}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("notifications", { weekly_digest: v })}
                      />
                      <ToggleRow
                        label="Slack integration"
                        desc="Post dispatch alerts to your #ops Slack channel."
                        checked={notifications.slack_integration}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("notifications", { slack_integration: v })}
                      />
                      <ToggleRow
                        label="SMS OTP for admin logins"
                        desc="Require 2FA via SMS for super admins."
                        checked={notifications.sms_otp_admin}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("notifications", { sms_otp_admin: v })}
                      />
                    </div>
                  );
                }}
              </SectionShell>
            </TabsContent>

            <TabsContent value="security">
              <SectionShell
                title="Authentication & access"
                desc="Password policy, SSO and session controls."
                {...shellProps("security")}
              >
                {(readOnly) => {
                  const security = valueOf(settings, drafts, "security");
                  return (
                    <div className="space-y-4">
                      <ToggleRow
                        label="Require two-factor authentication for all admins"
                        desc="Enforces an authenticator app for every platform admin."
                        checked={security.require_2fa}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("security", { require_2fa: v })}
                      />
                      <ToggleRow
                        label="Enforce SSO via SAML"
                        desc="Restrict access to your identity provider (Okta, Azure AD, Google Workspace)."
                        checked={security.enforce_sso}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("security", { enforce_sso: v })}
                      />
                      <ToggleRow
                        label="Auto-logout after inactivity"
                        desc="Sessions expire after the configured timeout with no activity."
                        checked={security.auto_logout}
                        disabled={readOnly}
                        onCheckedChange={(v) => update("security", { auto_logout: v })}
                      />
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field
                          label="Minimum password length"
                          error={err("security", "min_password_length")}
                        >
                          <Input
                            type="number"
                            min={8}
                            max={64}
                            value={security.min_password_length}
                            disabled={readOnly}
                            onChange={(e) =>
                              update("security", {
                                min_password_length: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </Field>
                        <Field
                          label="Session timeout (minutes)"
                          error={err("security", "session_timeout_minutes")}
                        >
                          <Input
                            type="number"
                            min={5}
                            max={1440}
                            value={security.session_timeout_minutes}
                            disabled={readOnly}
                            onChange={(e) =>
                              update("security", {
                                session_timeout_minutes: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  );
                }}
              </SectionShell>

              <SectionShell
                title="Audit & compliance"
                desc="Tamper-evident logging and retention."
                className="mt-4"
                {...shellProps("security")}
              >
                {(readOnly) => {
                  const security = valueOf(settings, drafts, "security");
                  return (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Log retention">
                        <Select
                          value={String(security.log_retention_days)}
                          disabled={readOnly}
                          onValueChange={(v) =>
                            update("security", { log_retention_days: Number(v) })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="90">90 days</SelectItem>
                            <SelectItem value="180">180 days</SelectItem>
                            <SelectItem value="365">1 year</SelectItem>
                            <SelectItem value="2555">7 years</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Data residency region">
                        <Select
                          value={security.data_residency}
                          disabled={readOnly}
                          onValueChange={(v) => update("security", { data_residency: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="af-south-1">Africa (Cape Town)</SelectItem>
                            <SelectItem value="eu-west-1">EU (Ireland)</SelectItem>
                            <SelectItem value="us-east-1">US East (Virginia)</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  );
                }}
              </SectionShell>
            </TabsContent>

            <TabsContent value="localisation">
              <SectionShell
                title="Locale"
                desc="Default language, currency, timezone and unit preferences."
                {...shellProps("localisation")}
              >
                {(readOnly) => {
                  const locale = valueOf(settings, drafts, "localisation");
                  return (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Default language">
                        <Select
                          value={locale.language}
                          disabled={readOnly}
                          onValueChange={(v) => update("localisation", { language: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en-ZA">English (South Africa)</SelectItem>
                            <SelectItem value="en-GB">English (UK)</SelectItem>
                            <SelectItem value="af-ZA">Afrikaans</SelectItem>
                            <SelectItem value="zu-ZA">isiZulu</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Default currency">
                        <Select
                          value={locale.currency}
                          disabled={readOnly}
                          onValueChange={(v) => update("localisation", { currency: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ZAR">South African Rand (ZAR)</SelectItem>
                            <SelectItem value="USD">US Dollar (USD)</SelectItem>
                            <SelectItem value="EUR">Euro (EUR)</SelectItem>
                            <SelectItem value="GBP">British Pound (GBP)</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Timezone">
                        <Select
                          value={locale.timezone}
                          disabled={readOnly}
                          onValueChange={(v) => update("localisation", { timezone: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Africa/Johannesburg">
                              Africa/Johannesburg (SAST, UTC+2)
                            </SelectItem>
                            <SelectItem value="UTC">UTC</SelectItem>
                            <SelectItem value="Europe/London">Europe/London</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Distance unit">
                        <Select
                          value={locale.distance_unit}
                          disabled={readOnly}
                          onValueChange={(v) =>
                            update("localisation", {
                              distance_unit: v === "mi" ? "mi" : "km",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="km">Kilometres</SelectItem>
                            <SelectItem value="mi">Miles</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  );
                }}
              </SectionShell>
            </TabsContent>

            <TabsContent value="api">
              <ApiSection settings={settings} canManage={canManage} actorEmail={actorEmail} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- API tab   */

function ApiSection({
  settings,
  canManage,
  actorEmail,
}: {
  settings: PlatformSettings;
  canManage: boolean;
  actorEmail: string | null;
}) {
  const { keys, webhooks } = settings.api;
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [secretReveal, setSecretReveal] = useState<{ label: string; secret: string } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<(typeof keys)[number] | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<(typeof keys)[number] | null>(null);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [removeWebhookTarget, setRemoveWebhookTarget] = useState<(typeof webhooks)[number] | null>(
    null,
  );

  const rotateMutation = useMutation({
    mutationFn: (input: { id: string }) => rotateApiKey({ ...input, actorEmail }),
    onSuccess: (result, input) => {
      if (result.ok) {
        const key = keys.find((k) => k.id === input.id);
        setSecretReveal({ label: key?.label ?? "API key", secret: result.secret });
        toast.success("Key rotated — the previous secret stopped working immediately");
      } else {
        toast.error(result.error ?? "Failed to rotate key.");
      }
      setRotateTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { id: string }) => revokeApiKey({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("API key revoked");
      else toast.error(result.error ?? "Failed to revoke key.");
      setRevokeTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleWebhookMutation = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      setWebhookActive({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error ?? "Failed to update endpoint.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeWebhookMutation = useMutation({
    mutationFn: (input: { id: string }) => removeWebhookEndpoint({ ...input, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) toast.success("Webhook endpoint removed");
      else toast.error(result.error ?? "Failed to remove endpoint.");
      setRemoveWebhookTarget(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <SectionShell
        title="API keys"
        desc="Server-side keys for the ForkFleet API. Full secrets are shown once at creation or rotation — only the masked fingerprint is stored."
        hideFooter
      >
        {() => (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {key.label}
                    <Badge
                      className={
                        key.environment === "production"
                          ? "border-transparent bg-amber-500/15 text-amber-400 hover:bg-amber-500/15"
                          : ""
                      }
                      variant={key.environment === "production" ? "secondary" : "outline"}
                    >
                      {key.environment}
                    </Badge>
                  </p>
                  <code className="mt-0.5 block font-mono text-xs text-muted-foreground">
                    {key.masked_key}
                  </code>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Created {relative(key.created_at)}
                    {key.rotated_at ? ` · rotated ${relative(key.rotated_at)}` : ""}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      title="Full keys are only shown once, at creation or rotation"
                    >
                      Reveal
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rotateMutation.isPending}
                      onClick={() => setRotateTarget(key)}
                    >
                      <RefreshCw className="mr-1.5 size-3.5" />
                      Rotate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      disabled={revokeMutation.isPending}
                      onClick={() => setRevokeTarget(key)}
                    >
                      Revoke
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {keys.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No API keys yet. Generate one to integrate with the ForkFleet API.
              </p>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setKeyDialogOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                Generate new key
              </Button>
            )}
          </div>
        )}
      </SectionShell>

      <SectionShell
        title="Webhook endpoints"
        desc="Receive HTTPS callbacks when orders, drivers, payments and restaurants change."
        className="mt-4"
        hideFooter
      >
        {() => (
          <div className="space-y-3">
            {webhooks.map((webhook) => (
              <div
                key={webhook.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <div className="min-w-0">
                  <code className="block truncate text-xs">{webhook.url}</code>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {webhook.events.map((event) => (
                      <Badge key={event} variant="outline" className="font-mono text-[10px]">
                        {event}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Added {relative(webhook.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {canManage && (
                    <>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {webhook.is_active ? "Delivering" : "Paused"}
                        <Switch
                          checked={webhook.is_active}
                          disabled={toggleWebhookMutation.isPending}
                          onCheckedChange={(checked) =>
                            toggleWebhookMutation.mutate({ id: webhook.id, isActive: checked })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        aria-label="Remove endpoint"
                        disabled={removeWebhookMutation.isPending}
                        onClick={() => setRemoveWebhookTarget(webhook)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                  {!canManage && (
                    <Badge variant="outline">{webhook.is_active ? "Delivering" : "Paused"}</Badge>
                  )}
                </div>
              </div>
            ))}
            {webhooks.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No webhook endpoints configured.
              </p>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setWebhookDialogOpen(true)}>
                <Plus className="mr-1.5 size-3.5" />
                Add endpoint
              </Button>
            )}
          </div>
        )}
      </SectionShell>

      <GenerateKeyDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        actorEmail={actorEmail}
        onCreated={(label, secret) => setSecretReveal({ label, secret })}
      />
      <AddWebhookDialog
        open={webhookDialogOpen}
        onOpenChange={setWebhookDialogOpen}
        actorEmail={actorEmail}
      />

      <SecretRevealDialog reveal={secretReveal} onClose={() => setSecretReveal(null)} />

      <AlertDialog
        open={rotateTarget !== null}
        onOpenChange={(open) => !open && setRotateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate “{rotateTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The current secret stops working immediately. Any service still using it must be
              updated with the new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rotateTarget) rotateMutation.mutate({ id: rotateTarget.id });
                setRotateTarget(null);
              }}
            >
              Rotate key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The key is deleted permanently. Requests signed with it will be rejected from that
              moment on. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate({ id: revokeTarget.id });
                setRevokeTarget(null);
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeWebhookTarget !== null}
        onOpenChange={(open) => !open && setRemoveWebhookTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="font-mono text-xs">{removeWebhookTarget?.url}</code> will stop
              receiving events immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeWebhookTarget)
                  removeWebhookMutation.mutate({ id: removeWebhookTarget.id });
                setRemoveWebhookTarget(null);
              }}
            >
              Remove endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function GenerateKeyDialog({
  open,
  onOpenChange,
  actorEmail,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
  onCreated: (label: string, secret: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [environment, setEnvironment] = useState<"production" | "test">("production");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setEnvironment("production");
      setError(null);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () => createApiKey({ label, environment, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(`${result.record.label} created`);
        onCreated(result.record.label, result.secret);
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5" />
            Generate API key
          </DialogTitle>
          <DialogDescription>
            Creates a new key against the ForkFleet API. The full secret is shown once, right after
            creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="api-key-label">Label</Label>
            <Input
              id="api-key-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. ERP integration"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select
              value={environment}
              onValueChange={(v) => setEnvironment(v === "test" ? "test" : "production")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || label.trim().length < 2}
          >
            {createMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Generate key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddWebhookDialog({
  open,
  onOpenChange,
  actorEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actorEmail: string | null;
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["order.*"]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setEvents(["order.*"]);
      setError(null);
    }
  }, [open]);

  const addMutation = useMutation({
    mutationFn: () => addWebhookEndpoint({ url, events, actorEmail }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Webhook endpoint added");
        onOpenChange(false);
      } else {
        setError(result.error ?? "Failed to add endpoint.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleEvent(event: string, checked: boolean) {
    setEvents((current) =>
      checked ? [...current, event] : current.filter((entry) => entry !== event),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WebhookIcon className="size-5" />
            Add webhook endpoint
          </DialogTitle>
          <DialogDescription>
            We&apos;ll POST a signed JSON payload to this HTTPS URL for each subscribed event.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.example.com/hooks/forkfleet"
              type="url"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Events</Label>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
              {WEBHOOK_EVENT_CATALOG.map((event) => (
                <label key={event} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={events.includes(event)}
                    onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                  />
                  <span className="font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || !url.trim()}
          >
            {addMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretRevealDialog({
  reveal,
  onClose,
}: {
  reveal: { label: string; secret: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [reveal]);

  if (!reveal) return null;

  return (
    <Dialog open={reveal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="size-5 text-amber-500" />
            Copy your key now
          </DialogTitle>
          <DialogDescription>
            This is the only time the full secret for <strong>{reveal.label}</strong> is shown.
            Store it somewhere safe — we only keep the masked fingerprint.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{reveal.secret}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(reveal.secret);
              setCopied(true);
              toast.success("API key copied to clipboard");
            }}
          >
            {copied ? (
              <Check className="mr-1.5 size-3.5 text-emerald-500" />
            ) : (
              <Copy className="mr-1.5 size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I&apos;ve stored it safely</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- primitives */

/** Imported lazily to keep this module's import graph flat. */
async function updateSettingsSectionPublic(
  section: DraftedSection,
  value: unknown,
  actorEmail: string | null,
) {
  const { updateSettingsSection } = await import("@/lib/settings.firebase");
  return updateSettingsSection({ section, value: value as Record<string, unknown>, actorEmail });
}

function valueOf<S extends DraftedSection>(
  settings: PlatformSettings,
  drafts: Drafts,
  section: S,
): PlatformSettings[S] {
  return (drafts[section] ?? settings[section]) as PlatformSettings[S];
}

function SectionShell({
  title,
  desc,
  children,
  className,
  dirty = false,
  conflict = false,
  saving = false,
  readOnly = false,
  hideFooter = false,
  onSave,
  onDiscard,
}: {
  title: string;
  desc: string;
  children: React.ReactNode | ((readOnly: boolean) => React.ReactNode);
  className?: string;
  dirty?: boolean;
  conflict?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  hideFooter?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
          {dirty && !readOnly && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Unsaved
            </Badge>
          )}
        </div>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conflict && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="flex-1">
              <p className="font-medium text-amber-500">These values changed on the server</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Another administrator saved this section after you started editing. Review your
                changes and save again, or discard them.
              </p>
              {onDiscard && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={onDiscard}
                >
                  <RotateCcw className="mr-1.5 size-3" />
                  Discard my changes
                </Button>
              )}
            </div>
          </div>
        )}
        {typeof children === "function" ? children(readOnly) : children}
        {!hideFooter && !readOnly && onSave && (
          <>
            <Separator />
            <div className="flex justify-end gap-2">
              {dirty && onDiscard && (
                <Button variant="ghost" onClick={onDiscard} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button onClick={onSave} disabled={!dirty || saving}>
                {saving ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-3.5" />
                )}
                Save changes
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ColorField({
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  disabled?: boolean;
  onChange: (hex: string) => void;
}) {
  const sanitized = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          type="color"
          value={sanitized}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-10 w-16 shrink-0 p-1"
          aria-label={`${label} picker`}
        />
        <Input
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="font-mono text-xs"
          maxLength={7}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}
