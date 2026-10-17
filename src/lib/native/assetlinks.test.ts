import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const readProjectFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("Android verification setup", () => {
  it("publishes exactly the installed local test build identity", () => {
    assert.deepEqual(JSON.parse(readProjectFile("public/.well-known/assetlinks.json")), [{
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.flynfeelholiday.app",
        sha256_cert_fingerprints: ["79:93:9F:84:5D:F4:3D:67:90:92:6B:46:4C:49:F5:C3:4C:AE:6D:23:EA:F8:58:4A:73:AE:A2:D1:57:17:B7:CD"],
      },
    }]);
  });

  it("sets the Vercel verification response to application/json", () => {
    const config = JSON.parse(readProjectFile("vercel.json"));
    const rule = config.headers.find((entry: { source: string }) => entry.source === "/.well-known/assetlinks.json");
    assert.ok(rule);
    assert.ok(rule.headers.some((header: { key: string; value: string }) => header.key === "Content-Type" && header.value === "application/json"));
  });
});