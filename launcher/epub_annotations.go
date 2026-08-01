package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxEpubAnnotationBytes = 16 << 20
	epubAnnotationEntry    = "META-INF/epub-viewer-annotations.json"
)

var errInvalidEpubAnnotations = errors.New("invalid EPUB annotations")

type epubAnnotationRequest struct {
	Highlights json.RawMessage `json:"highlights"`
}

type epubAnnotationOverlay struct {
	CreatedAt  string          `json:"createdAt"`
	Generator  string          `json:"generator"`
	Highlights json.RawMessage `json:"highlights"`
	UpdatedAt  string          `json:"updatedAt"`
	Version    int             `json:"version"`
}

func (resource *Resource) ReplaceEpubAnnotations(response http.ResponseWriter, request *http.Request) (*WriteResult, *Conflict, error) {
	expected := unquoteETag(request.Header.Get("If-Match"))
	if expected == "" {
		return nil, nil, errPreconditionRequired
	}
	overlay, err := decodeEpubAnnotationOverlay(response, request)
	if err != nil {
		return nil, nil, err
	}

	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		return nil, nil, err
	}
	defer unlock()

	current, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("fingerprint current EPUB: %w", err)
	}
	if current != expected {
		return nil, &Conflict{
			Code:           "version_conflict",
			Message:        "The EPUB changed on disk after it was opened.",
			CurrentVersion: current,
		}, nil
	}

	temp, err := os.CreateTemp(filepath.Dir(resource.path), ".epub.ts-save-*")
	if err != nil {
		return nil, nil, fmt.Errorf("create temporary EPUB: %w", err)
	}
	tempPath := temp.Name()
	keepTemp := false
	defer func() {
		_ = temp.Close()
		if !keepTemp {
			_ = os.Remove(tempPath)
		}
	}()

	hash := sha256.New()
	if err := writeEpubWithAnnotations(resource.path, io.MultiWriter(temp, hash), overlay); err != nil {
		return nil, nil, err
	}
	if info, statErr := os.Stat(resource.path); statErr == nil {
		_ = temp.Chmod(info.Mode().Perm())
	}
	if err := temp.Sync(); err != nil {
		return nil, nil, fmt.Errorf("flush temporary EPUB: %w", err)
	}
	if err := temp.Close(); err != nil {
		return nil, nil, fmt.Errorf("close temporary EPUB: %w", err)
	}

	rechecked, err := fileVersion(resource.path)
	if err != nil {
		return nil, nil, fmt.Errorf("recheck current EPUB: %w", err)
	}
	if rechecked != expected {
		return nil, &Conflict{
			Code:           "version_conflict",
			Message:        "The EPUB changed on disk while its annotations were being saved.",
			CurrentVersion: rechecked,
		}, nil
	}
	if err := atomicReplace(tempPath, resource.path); err != nil {
		return nil, nil, fmt.Errorf("replace EPUB: %w", err)
	}
	keepTemp = true

	version := hex.EncodeToString(hash.Sum(nil))
	info, statErr := os.Stat(resource.path)
	resource.mutex.Lock()
	resource.version = version
	if statErr == nil {
		resource.size = info.Size()
		resource.modTime = info.ModTime()
	}
	resource.mutex.Unlock()
	return &WriteResult{Version: version, Name: filepath.Base(resource.path)}, nil, nil
}

func (resource *Resource) SaveEpubAnnotationsConflictCopy(response http.ResponseWriter, request *http.Request) (*CopyResult, error) {
	overlay, err := decodeEpubAnnotationOverlay(response, request)
	if err != nil {
		return nil, err
	}
	unlock, err := acquireDocumentLock(resource.path)
	if err != nil {
		return nil, err
	}
	defer unlock()

	output, err := createConflictFile(resource.path)
	if err != nil {
		return nil, err
	}
	name := filepath.Base(output.Name())
	complete := false
	defer func() {
		_ = output.Close()
		if !complete {
			_ = os.Remove(output.Name())
		}
	}()

	if err := writeEpubWithAnnotations(resource.path, output, overlay); err != nil {
		return nil, err
	}
	if info, statErr := os.Stat(resource.path); statErr == nil {
		_ = output.Chmod(info.Mode().Perm())
	}
	if err := output.Sync(); err != nil {
		return nil, fmt.Errorf("flush EPUB conflict copy: %w", err)
	}
	if err := output.Close(); err != nil {
		return nil, fmt.Errorf("close EPUB conflict copy: %w", err)
	}
	complete = true
	return &CopyResult{Name: name}, nil
}

func decodeEpubAnnotationOverlay(response http.ResponseWriter, request *http.Request) ([]byte, error) {
	limited := http.MaxBytesReader(response, request.Body, maxEpubAnnotationBytes)
	decoder := json.NewDecoder(limited)
	decoder.DisallowUnknownFields()
	var payload epubAnnotationRequest
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("%w: %v", errInvalidEpubAnnotations, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("%w: request must contain one JSON object", errInvalidEpubAnnotations)
	}

	var highlights []json.RawMessage
	if len(payload.Highlights) == 0 || json.Unmarshal(payload.Highlights, &highlights) != nil || highlights == nil {
		return nil, fmt.Errorf("%w: highlights must be an array", errInvalidEpubAnnotations)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	overlay, err := json.MarshalIndent(epubAnnotationOverlay{
		CreatedAt:  now,
		Generator:  "epub-viewer-extension",
		Highlights: payload.Highlights,
		UpdatedAt:  now,
		Version:    1,
	}, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode EPUB annotations: %w", err)
	}
	return append(overlay, '\n'), nil
}

func writeEpubWithAnnotations(sourcePath string, destination io.Writer, overlay []byte) error {
	source, err := zip.OpenReader(sourcePath)
	if err != nil {
		return fmt.Errorf("open EPUB archive: %w", err)
	}
	defer source.Close()

	writer := zip.NewWriter(destination)
	for _, entry := range source.File {
		if entry.Name == epubAnnotationEntry {
			continue
		}
		input, err := entry.OpenRaw()
		if err != nil {
			_ = writer.Close()
			return fmt.Errorf("open raw EPUB entry %q: %w", entry.Name, err)
		}
		header := entry.FileHeader
		output, err := writer.CreateRaw(&header)
		if err != nil {
			_ = writer.Close()
			return fmt.Errorf("copy EPUB entry header %q: %w", entry.Name, err)
		}
		if _, err := io.Copy(output, input); err != nil {
			_ = writer.Close()
			return fmt.Errorf("copy EPUB entry %q: %w", entry.Name, err)
		}
	}

	header := &zip.FileHeader{Name: epubAnnotationEntry, Method: zip.Deflate}
	header.SetModTime(time.Now())
	output, err := writer.CreateHeader(header)
	if err != nil {
		_ = writer.Close()
		return fmt.Errorf("create EPUB annotation entry: %w", err)
	}
	if _, err := output.Write(overlay); err != nil {
		_ = writer.Close()
		return fmt.Errorf("write EPUB annotations: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finish EPUB archive: %w", err)
	}
	return nil
}

func createConflictFile(documentPath string) (*os.File, error) {
	directory := filepath.Dir(documentPath)
	extension := filepath.Ext(documentPath)
	stem := strings.TrimSuffix(filepath.Base(documentPath), extension)
	timestamp := time.Now().Format("20060102-150405")

	for attempt := 0; attempt < 100; attempt++ {
		suffix := ""
		if attempt > 0 {
			suffix = fmt.Sprintf("-%d", attempt+1)
		}
		name := fmt.Sprintf("%s (epub.ts conflict %s%s)%s", stem, timestamp, suffix, extension)
		output, err := os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			return output, nil
		}
		if !os.IsExist(err) {
			return nil, fmt.Errorf("create conflict copy: %w", err)
		}
	}
	return nil, errors.New("could not allocate a unique conflict-copy filename")
}
