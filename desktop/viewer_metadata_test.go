package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

func TestViewerMetadataPersistsOutsideBrowserStorage(t *testing.T) {
	directory := t.TempDir()
	registry := &Registry{path: filepath.Join(directory, stateFilename)}
	value := json.RawMessage(`[{"value":"epubcfi(/6/2)"}]`)

	if err := registry.WriteViewerMetadata("document", "reading-annotations:book", value); err != nil {
		t.Fatal(err)
	}

	reopened := &Registry{path: filepath.Join(directory, stateFilename)}
	stored, found, err := reopened.ReadViewerMetadata("document", "reading-annotations:book")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("metadata was not persisted")
	}
	var got, want any
	if err := json.Unmarshal(stored, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(value, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("metadata=%s, want %s", stored, value)
	}
}

func TestViewerMetadataKeepsAnEmptyAnnotationList(t *testing.T) {
	registry := &Registry{path: filepath.Join(t.TempDir(), stateFilename)}
	value := json.RawMessage(`[]`)

	if err := registry.WriteViewerMetadata("document", "reading-annotations:book", value); err != nil {
		t.Fatal(err)
	}
	stored, found, err := registry.ReadViewerMetadata("document", "reading-annotations:book")
	if err != nil {
		t.Fatal(err)
	}
	if !found || string(stored) != "[]" {
		t.Fatalf("metadata=%s, found=%v", stored, found)
	}
}
