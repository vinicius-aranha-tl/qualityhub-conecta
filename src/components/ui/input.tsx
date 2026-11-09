import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Conecta DS Input: borda default, hover/foco na cor de ação do tema.
          "flex h-11 w-full rounded-md border border-input bg-card px-3 py-1 text-base text-foreground transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-primary-hover focus-visible:border-primary-hover focus-visible:outline-none focus-visible:shadow-[0_0_0_0.125rem_color-mix(in_srgb,var(--conecta-color-action-primary-hover)_22%,transparent)] disabled:cursor-not-allowed disabled:bg-muted disabled:text-[color:var(--conecta-color-content-disabled)] md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
