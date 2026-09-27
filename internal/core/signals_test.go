package core

import "testing"

// A slow subscriber never blocks the publisher, and Drain ends every stream exactly once.
func TestControlHubDropsOnFullAndDrainsOnce(t *testing.T) {
	hub := NewControlHub()
	stream, cancel, ok := hub.Subscribe()
	if !ok {
		t.Fatal("subscription refused before draining")
	}
	defer cancel()
	for i := 0; i < 40; i++ {
		hub.Publish(ControlSignal{Kind: SignalWorkAvailable, OperationID: "op"})
	}
	if len(stream) != 16 {
		t.Fatalf("buffer holds %d signals, want the bounded 16", len(stream))
	}
	hub.Drain()
	hub.Drain()
	seen := 0
	for s := range stream {
		seen++
		if seen <= 16 && s.Kind != SignalWorkAvailable {
			t.Fatalf("signal %d: %s", seen, s.Kind)
		}
	}
	// The drain signal is dropped too when the buffer is full: the closed stream is the fact.
	if seen != 16 {
		t.Fatalf("received %d signals after drain, want 16", seen)
	}
	if _, _, ok := hub.Subscribe(); ok {
		t.Fatal("subscription accepted while draining")
	}
}
