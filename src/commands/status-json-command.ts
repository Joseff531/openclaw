import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { resolveStatusJsonOutput } from "./status-json-runtime.ts";

type StatusJsonCommandOptions = {
  deep?: boolean;
  usage?: boolean;
  timeoutMs?: number;
  all?: boolean;
};

export async function runStatusJsonCommand(params: {
  opts: StatusJsonCommandOptions;
  runtime: RuntimeEnv;
  includeSecurityAudit: boolean;
  includePluginCompatibility?: boolean;
  suppressHealthErrors?: boolean;
  scanStatusJsonFast: (
    opts: { timeoutMs?: number; all?: boolean },
    runtime: RuntimeEnv,
  ) => Promise<{
    scan: Parameters<typeof resolveStatusJsonOutput>[0]["scan"];
    metadataSnapshot: PluginMetadataSnapshot | undefined;
  }>;
}) {
  const { scan, metadataSnapshot } = await params.scanStatusJsonFast(
    { timeoutMs: params.opts.timeoutMs, all: params.opts.all },
    params.runtime,
  );
  writeRuntimeJson(
    params.runtime,
    await resolveStatusJsonOutput({
      scan,
      opts: params.opts,
      includeSecurityAudit: params.includeSecurityAudit,
      includePluginCompatibility: params.includePluginCompatibility,
      suppressHealthErrors: params.suppressHealthErrors,
      metadataSnapshot,
    }),
  );
}
