import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ComingSoonFeature {
  label: string;
  description: string;
}

/**
 * A polished "coming soon" placeholder used for menu sections that are on
 * the roadmap but not yet wired up in demo mode. Shows feature bullets, an
 * "in roadmap" badge and a subtle callout.
 */
export function ComingSoon({
  icon: Icon,
  title,
  tagline,
  badge = "Roadmap",
  features,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  tagline: string;
  badge?: string;
  features: ComingSoonFeature[];
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-dashed">
        <CardHeader className="flex-row items-start gap-4 space-y-0">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{title}</CardTitle>
              <Badge variant="secondary" className="gap-1 text-[10px] uppercase tracking-wider">
                <Sparkles className="size-3" /> {badge}
              </Badge>
            </div>
            <CardDescription className="mt-1.5">{tagline}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.label}
                className="rounded-lg border border-border/70 bg-muted/30 p-3"
              >
                <p className="text-sm font-medium">{f.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
