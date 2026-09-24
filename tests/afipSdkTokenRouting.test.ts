import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAfipSdkAccessToken } from "@/services/afip/accessToken";
import { runAutomation } from "@/services/arca/automationV2";

const original = {
  defaultToken: process.env.AFIP_SDK_ACCESS_TOKEN,
  fallbackToken: process.env.ACCESS_TOKEN,
  bypassCuit: process.env.AFIP_SDK_BYPASS_TAX_ID,
  bypassToken: process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN,
};

describe("Afip SDK issuer routing", () => {
  beforeEach(() => {
    process.env.AFIP_SDK_ACCESS_TOKEN = "default-account";
    delete process.env.ACCESS_TOKEN;
    process.env.AFIP_SDK_BYPASS_TAX_ID = "30-71812456-1";
    process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN = "temporary-account";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      AFIP_SDK_ACCESS_TOKEN: original.defaultToken,
      ACCESS_TOKEN: original.fallbackToken,
      AFIP_SDK_BYPASS_TAX_ID: original.bypassCuit,
      AFIP_SDK_BYPASS_ACCESS_TOKEN: original.bypassToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it("routes only the configured issuer to the temporary account", () => {
    expect(getAfipSdkAccessToken(30718124561)).toBe("temporary-account");
    expect(getAfipSdkAccessToken("30-71812456-1")).toBe("temporary-account");
    expect(getAfipSdkAccessToken(30718124562)).toBe("default-account");
  });

  it("does not fall back to the full account if the temporary token is missing", () => {
    delete process.env.AFIP_SDK_BYPASS_ACCESS_TOKEN;
    expect(() => getAfipSdkAccessToken(30718124561)).toThrow("Falta el token");
    expect(getAfipSdkAccessToken(20407312458)).toBe("default-account");
  });

  it("keeps the same account for an automation and its status poll", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "in_process", id: "job-1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const params = { cuit: "30718124561", username: "27393476198" };
    await runAutomation("create-cert-prod", params);
    await runAutomation("create-cert-prod", params, "job-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer temporary-account");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer temporary-account");
    await runAutomation("create-cert-prod", { cuit: "20407312458" });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer default-account");
  });
});
