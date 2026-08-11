package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveTargetAcceptsOnlyEpub(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.epub")
	if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveTarget(path); err != nil {
		t.Fatal(err)
	}
	wrong := filepath.Join(t.TempDir(), "paper.pdf")
	if err := os.WriteFile(wrong, []byte("pdf"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveTarget(wrong); err == nil {
		t.Fatal("accepted a PDF")
	}
}

func TestRegisterRenewsExistingDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.epub")
	if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(time.Hour)
	document := Document{ID: "existing", Path: path, ExpiresAt: expires}
	registry := &Registry{
		path: filepath.Join(t.TempDir(), "state.json"),
		state: persistentState{
			Version:   stateVersion,
			Documents: map[string]Document{document.ID: document},
		},
	}

	renewed, err := registry.Register(path)
	if err != nil {
		t.Fatal(err)
	}
	if renewed.ID != document.ID {
		t.Fatalf("registration changed document ID: %q", renewed.ID)
	}
	if !renewed.ExpiresAt.After(expires) {
		t.Fatalf("registration did not renew expiry: %s", renewed.ExpiresAt)
	}
}
