import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Conecta DS Badge: pílula com fundo suave e texto na cor semântica.
  "inline-flex min-h-6 w-fit items-center justify-center whitespace-nowrap rounded-full border border-transparent px-3 py-1 text-xs font-semibold leading-tight",
  {
    variants: {
      variant: {
        default: "bg-brand-subtle text-on-brand-subtle",
        secondary: "bg-muted text-[color:var(--conecta-color-content-secondary)]",
        destructive: "bg-danger-subtle text-danger",
        success: "bg-success-subtle text-success",
        warning: "bg-warning-subtle text-warning",
        info: "bg-info-subtle text-info",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
