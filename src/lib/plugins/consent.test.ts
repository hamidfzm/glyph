import { describe, expect, it } from "vitest";
import { consentRequest, grantAfterConsent } from "./consent";

describe("consentRequest", () => {
  it("asks for install consent on a first-time sandboxed plugin", () => {
    expect(consentRequest(true, ["workspace:read"], undefined)).toEqual({
      kind: "install",
      newPermissions: ["workspace:read"],
    });
  });

  it("asks for the full-trust warning when the plugin opts out of the sandbox", () => {
    expect(consentRequest(false, [], undefined)).toEqual({
      kind: "fullTrust",
      newPermissions: [],
    });
  });

  it("asks for the full-trust warning even if permissions were granted before", () => {
    const grant = { permissions: ["workspace:read"], fullTrust: false };
    expect(consentRequest(false, ["workspace:read"], grant)?.kind).toBe("fullTrust");
  });

  it("asks fresh consent when an update expands permissions", () => {
    const grant = { permissions: ["workspace:read"], fullTrust: false };
    expect(consentRequest(true, ["workspace:read", "network:example.com"], grant)).toEqual({
      kind: "expanded",
      newPermissions: ["network:example.com"],
    });
  });

  it("stays silent when the grant already covers the declared surface", () => {
    const sandboxed = { permissions: ["workspace:read"], fullTrust: false };
    expect(consentRequest(true, ["workspace:read"], sandboxed)).toBeNull();
    const fullTrust = { permissions: [], fullTrust: true };
    expect(consentRequest(false, [], fullTrust)).toBeNull();
  });

  it("stays silent when an update drops permissions", () => {
    const grant = { permissions: ["workspace:read", "network:example.com"], fullTrust: false };
    expect(consentRequest(true, ["workspace:read"], grant)).toBeNull();
  });
});

describe("grantAfterConsent", () => {
  it("records the accepted permissions and full-trust flag", () => {
    expect(grantAfterConsent(true, ["workspace:read"])).toEqual({
      permissions: ["workspace:read"],
      fullTrust: false,
    });
    expect(grantAfterConsent(false, [])).toEqual({ permissions: [], fullTrust: true });
  });
});
