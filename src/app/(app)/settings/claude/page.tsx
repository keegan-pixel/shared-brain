import { ClaudeConnectClient } from "./client";

const MCP_URL = "https://shared-brain-ecru.vercel.app/api/mcp";
const DISCOVERY_URL = "https://shared-brain-ecru.vercel.app/.well-known/oauth-authorization-server";

export default function ClaudeConnectPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Connect Claude</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hook Claude Desktop, claude.ai web, or Claude mobile up to your
          brain. Once connected, every Claude surface on your Anthropic
          account can read and write your brain.
        </p>
      </div>

      <ClaudeConnectClient mcpUrl={MCP_URL} discoveryUrl={DISCOVERY_URL} />

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">Steps</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>Open Claude Desktop (or claude.ai web)</li>
          <li>
            Settings → <strong>Connectors</strong> (sometimes called{" "}
            <em>Custom Connectors</em> or <em>Integrations</em>) →{" "}
            <strong>Add new</strong>
          </li>
          <li>
            Paste the MCP server URL above into the server URL field
          </li>
          <li>
            Claude will redirect you to a consent page on this site. Approve
            the connection. You&rsquo;ll be back in Claude within seconds.
          </li>
          <li>
            Test it: ask Claude{" "}
            <em>
              &ldquo;Look at everything in my brain and tell me what I should
              focus on this week.&rdquo;
            </em>{" "}
            If Claude returns synthesis based on your content, the connection
            is live.
          </li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          <strong>Note:</strong> Once Claude is connected on one surface
          (Desktop, web, or mobile), the connector is available on every
          surface — they share account state. You don&rsquo;t need to repeat
          this setup per device.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">Project Instructions — full setup</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          New to Claude Projects? Use this. Create a Project in Claude
          Desktop, paste this markdown into Custom Instructions. Includes a
          first-run discovery interview Claude runs to set up your spaces
          and projects conversationally via MCP primitives.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <a
            href="/api/orgs/claude-project-instructions?format=full"
            download
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Download full Project Instructions
          </a>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-medium">Lead-agent patch — add to existing setup</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Already have a Claude Project or lead agent (Cowork, AXIS, XAOC,
          a personal AI assistant, etc.)? Drop these few paragraphs into
          your existing system prompt — they tell your agent what
          shared-brain tools are available and when to reach for them.
          No discovery interview, no rebuild.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <a
            href="/api/orgs/claude-project-instructions?format=short"
            download
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Download lead-agent patch
          </a>
          <span className="text-xs text-muted-foreground">
            Also works as a global Claude rule for cross-Project use.
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-xs text-muted-foreground dark:border-zinc-700 dark:bg-zinc-900">
        <strong>Troubleshooting:</strong> If Claude doesn&rsquo;t see new
        tools after you ship updates, toggle the connector off and back on in
        Claude&rsquo;s settings. Connection state is cached; toggling forces
        a fresh handshake.
      </div>
    </div>
  );
}
