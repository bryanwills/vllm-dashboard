import assert from "node:assert/strict";
import test from "node:test";
import {
  commitUrl,
  notificationStateFor,
  pullRequestUrl,
} from "./alerts-shared";

test("an alert with no outbox row reads as unnotified", () => {
  assert.equal(notificationStateFor([]), "unnotified");
});

test("delivery to Slack outranks the attempts that preceded it", () => {
  assert.equal(notificationStateFor(["retrying", "delivered"]), "delivered");
});

test("an undelivered alert reports its worst outstanding attempt", () => {
  assert.equal(notificationStateFor(["pending", "dead_letter"]), "dead_letter");
  assert.equal(notificationStateFor(["pending", "retrying"]), "retrying");
  assert.equal(notificationStateFor(["pending"]), "pending");
});

test("GitHub links resolve from a commit and a pull request number", () => {
  assert.equal(
    commitUrl("1f4c9a2b7d3e5f6a8b9c0d1e2f3a4b5c6d7e8f90"),
    "https://github.com/vllm-project/vllm/commit/1f4c9a2b7d3e5f6a8b9c0d1e2f3a4b5c6d7e8f90",
  );
  assert.equal(
    pullRequestUrl("24680"),
    "https://github.com/vllm-project/vllm/pull/24680",
  );
  assert.equal(pullRequestUrl(null), null);
});
