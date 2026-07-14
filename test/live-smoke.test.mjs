import assert from "node:assert/strict";
import test from "node:test";
import { assertLiveSmokeConsent } from "../scripts/live-smoke.mjs";

test("requires both explicit consent values before a live subscription smoke", () => {
  assert.throws(() => assertLiveSmokeConsent({}), /Live smoke refused/);
  assert.throws(
    () => assertLiveSmokeConsent({ DUET_LIVE_SMOKE: "1" }),
    /Live smoke refused/
  );
  assert.doesNotThrow(() =>
    assertLiveSmokeConsent({
      DUET_LIVE_SMOKE: "1",
      DUET_LIVE_SMOKE_CONFIRM: "I_ACCEPT_SUBSCRIPTION_USAGE"
    })
  );
});
