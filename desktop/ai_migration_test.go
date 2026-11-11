package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistryRemovesRetiredAICredentials(t *testing.T) {
	directory := t.TempDir()
	statePath := filepath.Join(directory, stateFilename)
	if err := os.WriteFile(statePath, []byte(`{"version":3,"documents":{"book":{"ID":"book","path":"book.epub","alias":"book.epub"}},"ai":{"apiKey":"old-encrypted-key","baseUrl":"https://example.com"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	masterPath := filepath.Join(directory, "master.key")
	if err := os.WriteFile(masterPath, []byte("old-master-key"), 0600); err != nil {
		t.Fatal(err)
	}
	registry, err := openRegistry(directory)
	if err != nil {
		t.Fatal(err)
	}
	if document := registry.state.Documents["book"]; document.Path != "book.epub" || document.Alias != "book.epub" || document.ExpiresAt.IsZero() {
		t.Fatal("migration damaged the document registry", document)
	}
	content, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]json.RawMessage
	if err := json.Unmarshal(content, &state); err != nil {
		t.Fatal(err)
	}
	if _, ok := state["ai"]; ok || strings.Contains(string(content), "old-encrypted-key") {
		t.Fatal("retired AI configuration remains on disk")
	}
	if _, err := os.Stat(masterPath); !os.IsNotExist(err) {
		t.Fatalf("retired master key remains: %v", err)
	}
	if _, err := openRegistry(directory); err != nil {
		t.Fatal("migration is not idempotent:", err)
	}
}

func TestRegistryRemovesOrphanedAIMasterKey(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "master.key")
	if err := os.WriteFile(path, []byte("orphan"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := openRegistry(directory); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("orphaned master key remains: %v", err)
	}
}

func TestRetiredAIRoutesAreUnavailable(t *testing.T) {
	handler := (&App{}).routes()
	for _, path := range []string{"/api/control/ai", "/api/control/ai-config"} {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(method, path, nil))
			if response.Code != http.StatusNotFound && response.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s: got %d, want 404 or 405", method, path, response.Code)
			}
		}
	}
}
