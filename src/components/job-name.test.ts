import assert from "node:assert/strict";
import test from "node:test";
import { splitJobName } from "./job-name";

test("a known vendor shortcode becomes an icon segment", () => {
  const segments = splitJobName(":nvidia: (H200) Language Models Shard 3");
  assert.deepEqual(
    segments.map((segment) => segment.type),
    ["icon", "text"],
  );
  assert.equal(segments[0].type === "icon" && segments[0].icon.title, "NVIDIA");
  assert.equal(
    segments[1].type === "text" && segments[1].text,
    "(H200) Language Models Shard 3",
  );
});

test("amd and docker shortcodes resolve too, case-insensitively", () => {
  for (const [code, title] of [
    [":amd:", "AMD"],
    [":AMD:", "AMD"],
    [":docker:", "Docker"],
  ] as const) {
    const segments = splitJobName(`${code} build image`);
    assert.equal(segments[0].type === "icon" && segments[0].icon.title, title);
  }
});

test("an unknown shortcode is stripped, not shown literally", () => {
  const segments = splitJobName(":tensorrt: engine build");
  assert.deepEqual(segments, [{ type: "text", text: "engine build" }]);
});

test("a name without shortcodes passes through unchanged", () => {
  assert.deepEqual(splitJobName("lint"), [{ type: "text", text: "lint" }]);
});
