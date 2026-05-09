import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  billingTestBonusDays,
  buildSubscriptionInvoicePayload,
  parseCabinetUserIdFromInvoicePayload,
} from "./botTelegramBilling.js";

describe("botTelegramBilling", () => {
  it("round-trips invoice payload", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const p = buildSubscriptionInvoicePayload(id);
    assert.equal(parseCabinetUserIdFromInvoicePayload(p), id);
    assert.equal(parseCabinetUserIdFromInvoicePayload("nope"), null);
  });

  it("billingTestBonusDays clamps", () => {
    const prev = process.env.BILLING_TEST_BONUS_DAYS;
    delete process.env.BILLING_TEST_BONUS_DAYS;
    assert.equal(billingTestBonusDays(), 7);
    process.env.BILLING_TEST_BONUS_DAYS = "200";
    assert.equal(billingTestBonusDays(), 90);
    process.env.BILLING_TEST_BONUS_DAYS = prev;
  });
});
