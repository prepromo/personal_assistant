import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { yookassaTestPaymentsEnabled } from "./yookassaClient.js";

describe("yookassaClient", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.YOOKASSA_TEST_PAYMENTS;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.YOOKASSA_TEST_PAYMENTS;
    else process.env.YOOKASSA_TEST_PAYMENTS = prev;
  });

  it("yookassaTestPaymentsEnabled respects env", () => {
    delete process.env.YOOKASSA_TEST_PAYMENTS;
    assert.equal(yookassaTestPaymentsEnabled(), false);
    process.env.YOOKASSA_TEST_PAYMENTS = "1";
    assert.equal(yookassaTestPaymentsEnabled(), true);
    process.env.YOOKASSA_TEST_PAYMENTS = "true";
    assert.equal(yookassaTestPaymentsEnabled(), true);
  });
});
