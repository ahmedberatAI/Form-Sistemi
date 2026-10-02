// Kimlik bakımı (#8/#36/#54/#70/#83/#161/#323): tek zamanlayıcı (app.ts); aralık başına bir kez, bir iş hatası diğerini engellemez.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startIdentityMaintenance } from "../../src/app";

const INTERVAL = 1_000;

function fakes() {
  return {
    identity: { refreshAdulthood: vi.fn(() => 0), purgeStalePending: vi.fn(() => 0) },
    audit: { log: vi.fn() },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startIdentityMaintenance", () => {
  it("açılışta bir kez, sonra her aralıkta tam bir kez çalışır; durdurulunca çalışmaz", () => {
    const d = fakes();
    const timer = startIdentityMaintenance(d, INTERVAL);
    expect(d.identity.refreshAdulthood).toHaveBeenCalledTimes(1);
    expect(d.identity.purgeStalePending).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVAL - 1);
    expect(d.identity.refreshAdulthood).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(d.identity.refreshAdulthood).toHaveBeenCalledTimes(2);
    expect(d.identity.purgeStalePending).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(INTERVAL * 3);
    expect(d.identity.refreshAdulthood).toHaveBeenCalledTimes(5);

    clearInterval(timer);
    vi.advanceTimersByTime(INTERVAL * 5);
    expect(d.identity.refreshAdulthood).toHaveBeenCalledTimes(5);
    expect(d.audit.log).not.toHaveBeenCalled();
  });

  it("bir işin hatası denetim günlüğüne yazılır ve diğer işi engellemez; günlük de yazılamazsa zamanlayıcı çökmez", () => {
    const d = fakes();
    d.identity.refreshAdulthood.mockImplementation(() => {
      throw new Error("boom");
    });
    const timer = startIdentityMaintenance(d, INTERVAL);
    expect(d.identity.purgeStalePending).toHaveBeenCalledTimes(1);
    expect(d.audit.log).toHaveBeenCalledWith(null, "system.maintenance_error", null, { job: "refreshAdulthood", error: "boom" });

    d.audit.log.mockImplementation(() => {
      throw new Error("db kapalı");
    });
    expect(() => vi.advanceTimersByTime(INTERVAL)).not.toThrow();
    expect(d.identity.purgeStalePending).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});
