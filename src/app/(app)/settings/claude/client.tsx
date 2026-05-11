"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function ClaudeConnectClient({
  mcpUrl,
  discoveryUrl,
}: {
  mcpUrl: string;
  discoveryUrl: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="font-medium">MCP server URL</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste this into Claude&rsquo;s Custom Connectors setup.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-muted px-3 py-2 text-xs">
          {mcpUrl}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(mcpUrl)}
        >
          Copy
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        OAuth discovery happens automatically. If Claude asks for additional
        config, it shouldn&rsquo;t — but the discovery doc is at{" "}
        <a href={discoveryUrl} className="underline" target="_blank" rel="noreferrer">
          {discoveryUrl.replace(/^https:\/\//, "")}
        </a>
        .
      </p>
    </div>
  );
}
