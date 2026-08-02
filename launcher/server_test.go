package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDocumentRoutesExposeOnlyEpubOperations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "book.epub")
	if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
		t.Fatal(err)
	}
	document := Document{ID: "document", Path: path, ExpiresAt: time.Now().Add(time.Hour)}
	app := &App{
		registry:  &Registry{state: persistentState{Documents: map[string]Document{document.ID: document}}},
		resources: make(map[string]*Resource),
	}

	assertDocumentStatus(t, app, http.MethodHead, "/api/documents/document", http.StatusOK)
	assertDocumentStatus(t, app, http.MethodPut, "/api/documents/document", http.StatusMethodNotAllowed)
	assertDocumentStatus(t, app, http.MethodPost, "/api/documents/document/copy", http.StatusNotFound)
	assertDocumentStatus(t, app, http.MethodPost, "/api/documents/document/annotations", http.StatusMethodNotAllowed)
}

func assertDocumentStatus(t *testing.T, app *App, method, target string, expected int) {
	t.Helper()
	response := httptest.NewRecorder()
	app.handleDocument(response, httptest.NewRequest(method, target, nil))
	if response.Code != expected {
		t.Fatalf("%s %s: status=%d, want %d", method, target, response.Code, expected)
	}
}
