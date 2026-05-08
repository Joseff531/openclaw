import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyStatusScanDefaults,
  createStatusMemorySearchConfig,
  createStatusMemorySearchManager,
  createStatusScanSharedMocks,
  createStatusSummary,
  loadStatusScanModuleForTest,
  type StatusScanModuleTestMocks,
  withTemporaryEnv,
} from "./status.scan.test-helpers.js";

const mocks: StatusScanModuleTestMocks = {
  ...createStatusScanSharedMocks("status-fast-json"),
  getStatusCommandSecretTargetIds: vi.fn(() => []),
  resolveMemorySearchConfig: vi.fn(),
  loadPluginMetadataSnapshot: vi.fn(),
};

let originalForceStderr: boolean;
let loggingStateRef: typeof import("../logging/state.js").loggingState;
let scanStatusJsonFast: typeof import("./status.scan.fast-json.js").scanStatusJsonFast;

const minimalSnapshot = {
  policyHash: "test",
  plugins: [],
  byPluginId: new Map(),
  index: { plugins: [], installRecords: [], diagnostics: [] },
  manifestRegistry: { plugins: [], byPluginId: new Map() },
  diagnostics: [],
  registryDiagnostics: [],
  owners: {
    channels: new Map(),
    channelConfigs: new Map(),
    providers: new Map(),
    modelCatalogProviders: new Map(),
    cliBackends: new Map(),
    setupProviders: new Map(),
    commandAliases: new Map(),
    contracts: new Map(),
  },
  metrics: {
    registrySnapshotMs: 0,
    manifestRegistryMs: 0,
    ownerMapsMs: 0,
    totalMs: 0,
    indexPluginCount: 0,
    manifestPluginCount: 0,
  },
  normalizePluginId: (id: string) => id,
} as never;

function configureFastJsonStatus() {
  applyStatusScanDefaults(mocks, {
    sourceConfig: createStatusMemorySearchConfig(),
    resolvedConfig: createStatusMemorySearchConfig(),
    summary: createStatusSummary({ byAgent: [] }),
    memoryManager: createStatusMemorySearchManager(),
  });
  mocks.getStatusCommandSecretTargetIds.mockReturnValue([]);
  mocks.resolveMemorySearchConfig.mockReturnValue({
    store: { path: "/tmp/main.sqlite" },
  });
  (mocks.loadPluginMetadataSnapshot as ReturnType<typeof vi.fn>).mockReturnValue(minimalSnapshot);
}

beforeAll(async () => {
  configureFastJsonStatus();
  ({ scanStatusJsonFast } = await loadStatusScanModuleForTest(mocks, { fastJson: true }));
  ({ loggingState: loggingStateRef } = await import("../logging/state.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  configureFastJsonStatus();
  originalForceStderr = loggingStateRef.forceConsoleToStderr;
  loggingStateRef.forceConsoleToStderr = false;
});

afterEach(() => {
  loggingStateRef.forceConsoleToStderr = originalForceStderr;
});

describe("scanStatusJsonFast", () => {
  it("does not preload configured channel plugins for the lean JSON path", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).not.toHaveBeenCalled();
    expect(loggingStateRef.forceConsoleToStderr).toBe(false);
  });

  it("keeps resolved and source channel configs available without loading runtime plugins", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);
    applyStatusScanDefaults(mocks, {
      hasConfiguredChannels: true,
      sourceConfig: {
        channels: {
          telegram: {
            botToken: {
              source: "file",
              provider: "vault",
              id: "/telegram/bot-token",
            },
          },
        },
      } as never,
      resolvedConfig: {
        marker: "resolved-snapshot",
        channels: {
          telegram: {
            botToken: "resolved-token",
          },
        },
      } as never,
    });

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.ensurePluginRegistryLoaded).not.toHaveBeenCalled();
    expect(mocks.resolveCommandSecretRefsViaGateway).toHaveBeenCalled();
  });

  it("skips plugin compatibility loading even when configured channels are present", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.buildPluginCompatibilityNotices).not.toHaveBeenCalled();
  });

  it("keeps the fast JSON summary off the channel plugin summary path", async () => {
    mocks.hasPotentialConfiguredChannels.mockReturnValue(true);

    await scanStatusJsonFast({}, {} as never);

    expect(mocks.getStatusSummary).toHaveBeenCalledWith(
      expect.objectContaining({ includeChannelSummary: false }),
    );
  });

  it("skips memory inspection for the lean status --json fast path", async () => {
    const { scan } = await scanStatusJsonFast({}, {} as never);

    expect(scan.memory).toBeNull();
    expect(mocks.hasPotentialConfiguredChannels).toHaveBeenCalledWith(
      expect.any(Object),
      process.env,
      { includePersistedAuthState: false },
    );
    expect(mocks.resolveMemorySearchConfig).not.toHaveBeenCalled();
    expect(mocks.getMemorySearchManager).not.toHaveBeenCalled();
  });

  it("restores memory inspection when --all is requested", async () => {
    const { scan } = await scanStatusJsonFast({ all: true }, {} as never);

    expect(scan.memory).toEqual(expect.objectContaining({ agentId: "main" }));
    expect(mocks.resolveMemorySearchConfig).toHaveBeenCalled();
    expect(mocks.getMemorySearchManager).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        agents: expect.objectContaining({
          defaults: expect.objectContaining({
            memorySearch: expect.any(Object),
          }),
        }),
      }),
      agentId: "main",
      purpose: "status",
    });
  });

  it("skips gateway and update probes on cold-start status --json", async () => {
    await withTemporaryEnv(
      {
        VITEST: undefined,
        VITEST_POOL_ID: undefined,
        NODE_ENV: undefined,
      },
      async () => {
        await scanStatusJsonFast({}, {} as never);
      },
    );

    expect(mocks.getUpdateCheckResult).not.toHaveBeenCalled();
    expect(mocks.probeGateway).not.toHaveBeenCalled();
  });

  it("builds the plugin metadata snapshot exactly once and returns it for reuse", async () => {
    const { metadataSnapshot } = await scanStatusJsonFast({}, {} as never);

    expect(mocks.loadPluginMetadataSnapshot).toHaveBeenCalledTimes(1);
    expect(metadataSnapshot).toBeDefined();
    expect(metadataSnapshot).toBe(
      (mocks.loadPluginMetadataSnapshot as ReturnType<typeof vi.fn>).mock.results[0]?.value,
    );
  });
});
