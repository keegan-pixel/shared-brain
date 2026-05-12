"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  /** Override the rendered label. Default: "Copy" + Copy icon. */
  label?: React.ReactNode;
  /** Override the "copied!" feedback text. Default: "Copied!" + Check icon. */
  copiedLabel?: React.ReactNode;
  size?: "default" | "sm" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
  /** How long the "Copied!" state stays visible (ms). */
  feedbackMs?: number;
  disabled?: boolean;
};

/**
 * Reusable copy-to-clipboard button with inline "Copied!" feedback.
 * Each instance manages its own state — no global toast provider needed.
 *
 * Usage:
 *   <CopyButton text={syncKey} />
 *   <CopyButton text={installCommand} size="sm" variant="outline" />
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  size = "sm",
  variant = "outline",
  className,
  feedbackMs = 1500,
  disabled,
}: Props) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), feedbackMs);
    } catch {
      // Clipboard API can fail in non-secure contexts or when permission denied.
      // Fail silently — user can always select + copy manually.
    }
  };

  const defaultLabel = (
    <>
      <Copy className="h-3 w-3" />
      Copy
    </>
  );
  const defaultCopied = (
    <>
      <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
      Copied!
    </>
  );

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className={cn("transition-colors", className)}
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {copied ? (copiedLabel ?? defaultCopied) : (label ?? defaultLabel)}
    </Button>
  );
}
