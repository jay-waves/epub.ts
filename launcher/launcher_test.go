package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEpubProductIdentity(t *testing.T) {
	if DefaultListenAddress != "127.0.0.1:23120" || DefaultPublicHost != "epub.ts.localhost" {
		t.Fatalf("unexpected product endpoint: %s %s", DefaultListenAddress, DefaultPublicHost)
	}
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
