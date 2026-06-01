package protocol

import "testing"

func TestDecodeRequiresEvent(t *testing.T) {
	_, err := Decode([]byte(`{"data":{}}`))
	if err == nil {
		t.Fatal("expected missing event error")
	}
}

func TestDecodeEnvelope(t *testing.T) {
	env, err := Decode([]byte(`{"event":"register","requestId":"1","data":{"userId":"u"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if env.Event != "register" || env.RequestID != "1" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
}
