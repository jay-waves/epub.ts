package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestServeRefreshesVersionAfterExternalChange(t *testing.T) {
	path := filepath.Join(t.TempDir(), "document.epub")
	if err := os.WriteFile(path, []byte("version one"), 0o600); err != nil {
		t.Fatal(err)
	}
	resource, err := NewResource(path)
	if err != nil {
		t.Fatal(err)
	}
	first := httptest.NewRecorder()
	if err := resource.Serve(first, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	firstVersion := first.Header().Get("ETag")

	if err := os.WriteFile(path, []byte("a different version"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Some file systems have coarse timestamp resolution. Force a distinct
	// timestamp as well as a distinct size so the metadata cache is invalidated.
	changed := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
	second := httptest.NewRecorder()
	if err := resource.Serve(second, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
		t.Fatal(err)
	}
	secondVersion := second.Header().Get("ETag")
	if secondVersion == "" || secondVersion == firstVersion {
		t.Fatalf("ETag did not refresh after external change: %q", secondVersion)
	}
}

func TestServeReportsDocumentFilename(t *testing.T) {
	tests := []struct {
		filename string
		expected string
	}{
		{"reader copy.epub", `inline; filename="reader copy.epub"; filename*=UTF-8''reader%20copy.epub`},
		{"中文 书.epub", `inline; filename="__ _.epub"; filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E4%B9%A6.epub`},
	}
	for _, test := range tests {
		t.Run(test.filename, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), test.filename)
			if err := os.WriteFile(path, []byte("epub"), 0o600); err != nil {
				t.Fatal(err)
			}
			resource, err := NewResource(path)
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			if err := resource.Serve(response, httptest.NewRequest(http.MethodHead, "/resource", nil)); err != nil {
				t.Fatal(err)
			}
			if disposition := response.Header().Get("Content-Disposition"); disposition != test.expected {
				t.Fatalf("unexpected Content-Disposition: %q", disposition)
			}
		})
	}
}
