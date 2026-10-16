import { SERVER_VERSION } from "./server";

vi.mock("../package.json", () => ({ default: { version: "9.8.7" } }));

describe("MCP software identity", () => {
  it("reports the installed package version to hosts", () => {
    expect(SERVER_VERSION).toBe("9.8.7");
  });
});
