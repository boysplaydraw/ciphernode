import { getTransportKindFromEnv } from "./index";

describe("transport env selection", () => {
  const original = process.env.EXPO_PUBLIC_RELAY_TRANSPORT;

  afterEach(() => {
    process.env.EXPO_PUBLIC_RELAY_TRANSPORT = original;
  });

  it("defaults to socketio compatibility", () => {
    delete process.env.EXPO_PUBLIC_RELAY_TRANSPORT;
    expect(getTransportKindFromEnv()).toBe("socketio");
  });

  it("selects websocket for Go relay", () => {
    process.env.EXPO_PUBLIC_RELAY_TRANSPORT = "websocket";
    expect(getTransportKindFromEnv()).toBe("websocket");
  });
});
