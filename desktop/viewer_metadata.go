package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxViewerMetadataBytes = 16 << 20

var errInvalidViewerMetadata = errors.New("invalid viewer metadata")

type viewerMetadata map[string]json.RawMessage

type viewerMetadataWrite struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

func (registry *Registry) metadataPath(documentID string) string {
	return filepath.Join(filepath.Dir(registry.path), "metadata", documentID+".json")
}

func (registry *Registry) ReadViewerMetadata(documentID, key string) (json.RawMessage, bool, error) {
	registry.mutex.RLock()
	defer registry.mutex.RUnlock()

	values, err := readViewerMetadataFile(registry.metadataPath(documentID))
	if err != nil {
		return nil, false, err
	}
	value, found := values[key]
	return value, found, nil
}

func (registry *Registry) WriteViewerMetadata(documentID, key string, value json.RawMessage) error {
	registry.mutex.Lock()
	defer registry.mutex.Unlock()

	path := registry.metadataPath(documentID)
	values, err := readViewerMetadataFile(path)
	if err != nil {
		return err
	}
	values[key] = append(json.RawMessage(nil), value...)
	content, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return fmt.Errorf("encode viewer metadata: %w", err)
	}
	content = append(content, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create viewer metadata directory: %w", err)
	}
	return writePrivateFileAtomically(path, ".epub.ts-metadata-*", "viewer metadata", content)
}

func readViewerMetadataFile(path string) (viewerMetadata, error) {
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return make(viewerMetadata), nil
	}
	if err != nil {
		return nil, fmt.Errorf("read viewer metadata: %w", err)
	}
	var values viewerMetadata
	if err := json.Unmarshal(content, &values); err != nil {
		return nil, fmt.Errorf("decode viewer metadata: %w", err)
	}
	if values == nil {
		values = make(viewerMetadata)
	}
	return values, nil
}

func (app *App) handleViewerMetadata(
	document Document,
	response http.ResponseWriter,
	request *http.Request,
) {
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The metadata request did not come from this epub.ts page.")
		return
	}

	switch request.Method {
	case http.MethodGet:
		key := request.URL.Query().Get("key")
		if strings.TrimSpace(key) == "" {
			writeJSONError(response, http.StatusBadRequest, "invalid_metadata", "A metadata key is required.")
			return
		}
		value, found, err := app.registry.ReadViewerMetadata(document.ID, key)
		if err != nil {
			writeJSONError(response, http.StatusInternalServerError, "metadata_read_failed", err.Error())
			return
		}
		if !found {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		writeJSON(response, http.StatusOK, struct {
			Value json.RawMessage `json:"value"`
		}{Value: value})

	case http.MethodPut:
		request.Body = http.MaxBytesReader(response, request.Body, maxViewerMetadataBytes)
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		var input viewerMetadataWrite
		if err := decoder.Decode(&input); err != nil {
			writeJSONError(response, http.StatusBadRequest, "invalid_metadata", errInvalidViewerMetadata.Error())
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			writeJSONError(response, http.StatusBadRequest, "invalid_metadata", "The request must contain one JSON object.")
			return
		}
		if strings.TrimSpace(input.Key) == "" || len(input.Value) == 0 || !json.Valid(input.Value) {
			writeJSONError(response, http.StatusBadRequest, "invalid_metadata", errInvalidViewerMetadata.Error())
			return
		}
		if err := app.registry.WriteViewerMetadata(document.ID, input.Key, input.Value); err != nil {
			writeJSONError(response, http.StatusInternalServerError, "metadata_write_failed", err.Error())
			return
		}
		response.WriteHeader(http.StatusNoContent)

	default:
		response.Header().Set("Allow", "GET, PUT")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
	}
}
