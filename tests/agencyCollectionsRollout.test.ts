import { describe, expect, it } from "vitest";
import {
  getAgencyCollectionsRolloutMap,
  isAgencyEnabledForFallback,
  isAgencyEnabledForPdAutomation,
  resolveAgencyCutoffHourAr,
} from "@/services/collections/core/agencyCollectionsRollout";

describe("agency collections rollout", () => {
  it("defaults to disabled when agency flag is required and no config exists", async () => {
    const rollout = await getAgencyCollectionsRolloutMap({
      agencyIds: [10],
      requireAgencyFlag: true,
      tx: {
        agencyBillingConfig: {
          findMany: async () => [],
        },
      } as never,
    });

    const row = rollout.get(10);
    expect(row?.collections_pd_enabled).toBe(false);
    expect(row?.collections_fallback_enabled).toBe(false);
    expect(isAgencyEnabledForPdAutomation(row)).toBe(false);
  });

  it("reads agency config and applies suspension + cutoff override", async () => {
    const rollout = await getAgencyCollectionsRolloutMap({
      agencyIds: [10, 11],
      requireAgencyFlag: true,
      tx: {
        agencyBillingConfig: {
          findMany: async () => [
            {
              id_agency: 10,
              collections_pd_enabled: true,
              collections_dunning_enabled: true,
              collections_fallback_enabled: true,
              collections_fallback_provider: "CIG_QR",
              collections_fallback_auto_sync_enabled: true,
              collections_suspended: false,
              collections_cutoff_override_hour_ar: 14,
              collections_notes: null,
            },
            {
              id_agency: 11,
              collections_pd_enabled: true,
              collections_dunning_enabled: true,
              collections_fallback_enabled: true,
              collections_fallback_provider: "CIG_QR",
              collections_fallback_auto_sync_enabled: true,
              collections_suspended: true,
              collections_cutoff_override_hour_ar: null,
              collections_notes: null,
            },
          ],
        },
      } as never,
    });

    const agency10 = rollout.get(10);
    const agency11 = rollout.get(11);

    expect(isAgencyEnabledForPdAutomation(agency10)).toBe(true);
    expect(isAgencyEnabledForFallback(agency10)).toBe(true);
    expect(resolveAgencyCutoffHourAr({ rollout: agency10, globalCutoffHourAr: 15 })).toBe(14);

    expect(isAgencyEnabledForPdAutomation(agency11)).toBe(false);
    expect(isAgencyEnabledForFallback(agency11)).toBe(false);
  });

  it("falls back to enabled defaults in legacy clients without agencyBillingConfig model", async () => {
    const rollout = await getAgencyCollectionsRolloutMap({
      agencyIds: [77],
      requireAgencyFlag: true,
      tx: {} as never,
    });

    const row = rollout.get(77);
    expect(row?.collections_pd_enabled).toBe(true);
    expect(row?.collections_fallback_enabled).toBe(true);
    expect(isAgencyEnabledForPdAutomation(row)).toBe(true);
  });
});
